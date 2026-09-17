const admin = require('firebase-admin');
const {createClient} = require('@supabase/supabase-js');

// Conta "alencar" no GeoGrid (Jebnet). Não é segredo por si só - só funciona com o api-key.
const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Tipos de item de rede que viram ponto no mapa. "reserva" é local reservado pra
// uma futura caixa/CTO - útil pro técnico ver onde já tem posição planejada. Fora:
// "grupoAcesso" (conta 0 registros nesta conta) e "poste" (muito numeroso - 4300+ -
// e não é o que os técnicos precisam localizar em campo).
const TIPOS_SINCRONIZADOS = ['terminal', 'caixa', 'rack', 'estacao', 'pontoAcesso', 'interesse', 'reserva'];

// Credencial via FIREBASE_SERVICE_ACCOUNT_B64 (o .json inteiro da service
// account, em base64, numa variável só) - muito mais à prova de erro de
// copiar/colar do que separar em 3 variáveis com quebra de linha dentro.
// Usado só pro cursor do cron (mapa_rede_meta/cron_cursor, 1 doc só, sem
// problema de cota) - os itens de rede em si (terminal/caixa/rack/...) vão
// pro Supabase (ver getSupabase), não mais pro Firestore (ver histórico:
// a cota gratuita de gravação/leitura do Firestore estourou 2 dias seguidos
// com o volume dessa conta do GeoGrid).
function carregarCredencial() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return {
      projectId: json.project_id,
      clientEmail: json.client_email,
      privateKey: json.private_key,
    };
  }
  // Fallback pro formato antigo (3 variáveis separadas), caso ainda em uso.
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

let dbSingleton = null;
function getDb() {
  if (!dbSingleton) {
    if (!admin.apps.length) {
      admin.initializeApp({credential: admin.credential.cert(carregarCredencial())});
    }
    dbSingleton = admin.firestore();
  }
  return dbSingleton;
}

// Cliente admin do Supabase (service_role - ignora RLS, só usado no backend
// nunca no navegador). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são
// variáveis de ambiente da Vercel (mesma ideia do FIREBASE_SERVICE_ACCOUNT_B64
// acima - nunca commitadas no repo).
let supabaseSingleton = null;
function getSupabase() {
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {persistSession: false},
    });
  }
  return supabaseSingleton;
}

// Tenta de novo (backoff bem curto) só em 429 (limite de requisições por
// minuto da API do GeoGrid) - erro passageiro, diferente de um 4xx/5xx "de
// verdade". Backoff precisa ficar pequeno: a função roda na Vercel com um
// teto de tempo de execução - um backoff longo (ex.: 1.5s/3s/4.5s) já
// estourava esse teto sozinho e a função morria com a própria página de
// erro da Vercel (HTML, não JSON), em vez do erro do GeoGrid aparecer no
// log do sincronizador.
//
// TIMEOUT_MS corta a chamada se o GeoGrid simplesmente não responder (em vez
// de devolver um 429 rápido) - visto na prática: depois de várias
// sincronizações seguidas em pouco tempo, uma chamada ficou pendurada até a
// própria Vercel matar a função sozinha 300s depois (timeout da plataforma,
// não erro nosso) - sem isso, um travamento do lado do GeoGrid consumia todo
// o orçamento de execução da função de uma vez, sem chance de retry nenhum.
// IMPORTANTE: o timer precisa cobrir também o res.json() (leitura do corpo),
// não só o fetch() em si - uma primeira versão cancelava o timer assim que
// os cabeçalhos chegavam (fetch() resolvido) e só DEPOIS chamava res.json(),
// deixando a leitura do corpo (potencialmente grande, até 500 registros) sem
// proteção nenhuma - continuou travando os mesmos 300s mesmo com o timeout
// "ativo".
const TIMEOUT_MS = 8000;
async function geogridFetch(path, tentativa = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEOGRID_BASE}${path}`, {
      headers: {'api-key': process.env.GEOGRID_API_KEY},
      signal: controller.signal,
    });
    if (res.status === 429 && tentativa <= 2) {
      clearTimeout(timer);
      await new Promise(r => setTimeout(r, tentativa * 400));
      return geogridFetch(path, tentativa + 1);
    }
    if (!res.ok) {
      throw new Error(`GeoGrid ${path} -> HTTP ${res.status}`);
    }
    return await res.json(); // ainda dentro do try - continua coberto pelo mesmo signal/timer
  } catch (e) {
    if (e.name === 'AbortError' && tentativa <= 2) {
      return geogridFetch(path, tentativa + 1);
    }
    throw e.message && e.message.startsWith('GeoGrid ')
      ? e
      : new Error(`GeoGrid ${path} -> ${e.name === 'AbortError' ? 'sem resposta em ' + TIMEOUT_MS + 'ms' : e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Busca todas as pastas (só 75 hoje) e monta id -> {nome, nomePai}, pra resolver
// localidade (pasta do item) e município (pasta-mãe) sem precisar de outra chamada.
// Cacheada em memória por alguns minutos: o botão "Sincronizar" chama isso uma
// vez por página/tipo (dezenas de vezes por clique, 7 tipos x várias páginas),
// e pastas raramente mudam - sem cache isso sozinho já esgota o limite de
// requisições por minuto da API do GeoGrid (HTTP 429), mesmo sem nada de
// errado na sincronização em si. O cache vive na instância "quente" da função
// da Vercel (não sobrevive a cold start, e nem precisa).
const PASTAS_CACHE_MS = 5 * 60 * 1000;
let pastasCache = null; // {mapa, expiraEm}
async function carregarPastas() {
  if (pastasCache && pastasCache.expiraEm > Date.now()) return pastasCache.mapa;

  const mapa = new Map();
  let pagina = 1;
  for (;;) {
    const dados = await geogridFetch(`/pastas?pagina=${pagina}&registrosPorPagina=200`);
    for (const p of dados.registros || []) {
      mapa.set(String(p.id), {nome: p.nome, nomePai: p.nomePai});
    }
    const total = parseInt(dados.totalRegistros, 10) || 0;
    if (pagina * 200 >= total || !dados.registros || dados.registros.length === 0) break;
    pagina++;
  }
  pastasCache = {mapa, expiraEm: Date.now() + PASTAS_CACHE_MS};
  return mapa;
}

// O campo "observacao" do GeoGrid é HTML livre digitado pela equipe, tipo:
// "<pre>SPLITTER: 1x8 / 1x16\nCABO: 4 12fo\nFIBRA: \nPOTÊNCIA: 25,69 dbm</pre>..."
// Extrai os campos estruturados de dentro desse texto, quando presentes.
function extrairInfoObservacao(observacao) {
  if (!observacao) return {};
  const texto = String(observacao).replace(/<[^>]+>/g, ' ');
  const pegar = (rotulo) => {
    // [ \t]* (não \s*) depois dos dois-pontos - \s* cruzaria a quebra de linha e
    // pegaria o valor do PRÓXIMO campo quando este estiver vazio (ex.: "FIBRA:\n").
    const m = texto.match(new RegExp(rotulo + '[ \\t]*:[ \\t]*([^\\n]+)', 'i'));
    const valor = m ? m[1].trim() : null;
    return valor || null;
  };
  return {
    splitter: pegar('SPLITTER'),
    cabo: pegar('CABO'),
    fibra: pegar('FIBRA'),
    potencia: pegar('POT[ÊE]NCIA'),
  };
}

// Normaliza um item (seja do retorno de /itensRede - tem "pasta": {id,...} -
// ou de /itensRede/{id}/mapa - tem só "idPasta") pra uma linha da tabela
// mapa_rede no Supabase (colunas em snake_case).
function montarLinha(item, pastaInfo) {
  const dados = item.dados || {};
  const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
  const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;
  const id = dados.id;

  const linha = {
    id: String(id),
    item: dados.item || null,
    sigla: dados.sigla || null,
    latitude: dados.latitude != null ? Number(dados.latitude) : null,
    longitude: dados.longitude != null ? Number(dados.longitude) : null,
    municipio: (folder && folder.nomePai) || null,
    localidade: (folder && folder.nome) || null,
    status: dados.status || null,
    atualizado_em: new Date().toISOString(),
  };

  if (dados.item === 'terminal') {
    const m = (dados.sigla || '').match(/\d+/);
    linha.numero = m ? parseInt(m[0], 10) : null;
  }

  if (dados.item === 'terminal' || dados.item === 'caixa') {
    Object.assign(linha, extrairInfoObservacao(dados.observacao));
  }

  return linha;
}

// A conta do GeoGrid tem VÁRIOS clientes misturados (Jebnet, Infolink, "Dnet",
// e a pasta "CLIENTES-LINKS" com provedores concorrentes) - só a Jebnet deve
// ser gravada. Filtrar aqui, ANTES de gravar, em vez de só na hora de mostrar
// no mapa (como era antes) - sincronizar itens que nunca vão aparecer
// desperdiça banco à toa. Mesmo critério já validado no mapa-campo (ver
// MUNICIPIOS_JEBNET lá): a Jebnet só atua na região de Itapipoca e
// adjacências - região confirmada batendo com as pastas do export "Jebnet -
// Itapipoca" do GeoGrid (KMZ 15/09/2026).
const MUNICIPIOS_JEBNET = ['itapipoca', 'miraima', 'tururu', 'baleia', 'amontada', 'trairi', 'uruburetama'];
function normalizar(txt) {
  return (txt || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function ehMunicipioJebnet(municipio) {
  const m = normalizar(municipio);
  if (!m || m === 'clientes-links') return m.includes('jebnet');
  return MUNICIPIOS_JEBNET.some(c => m.includes(c)) || m.includes('jebnet');
}
// Terminal (CTO) da Jebnet de verdade também exige sigla "CTO-" + dígito e
// numeração >= 20000 - existe pelo menos um item "CTO-01 Iparana" (número
// baixo) numa cidade da lista acima que ainda assim não é da Jebnet, então a
// cidade sozinha não basta pra terminal.
function ehJebnetTerminal(linha) {
  const sigla = (linha.sigla || '').trim();
  return /^cto-\d/i.test(sigla) && Number(linha.numero) >= 20000;
}
function ehJebnet(linha) {
  if (!ehMunicipioJebnet(linha.municipio)) return false;
  if (linha.item === 'terminal' && !ehJebnetTerminal(linha)) return false;
  return true;
}

async function gravarLinhas(linhas) {
  if (!linhas.length) return;
  const supabase = getSupabase();
  const {error} = await supabase.from('mapa_rede').upsert(linhas, {onConflict: 'id'});
  if (error) throw new Error(`Supabase upsert falhou: ${error.message}`);
}

// Varre os tipos informados na API do GeoGrid e grava cada item na tabela
// mapa_rede do Supabase (upsert em lote por página - até 500 itens numa
// gravação só, bem mais barato que Firestore). Usada tanto pelo endpoint
// manual (geogrid-full-sync) quanto pelo cron diário. Não remove itens que
// sumiram do GeoGrid (isso já não acontecia na versão antiga tampouco - só
// o webhook cuida de remoção, item a item, na hora que o GeoGrid avisa que
// sumiu).
async function sincronizarTipos(tipos) {
  const pastaInfo = await carregarPastas();

  const resumo = {};
  let totalGravados = 0;

  for (const tipo of tipos) {
    let pagina = 1;
    let totalTipo = 0;

    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;

      const linhas = [];
      for (const item of registros) {
        const id = item.dados && item.dados.id;
        if (!id) continue;
        const linha = montarLinha(item, pastaInfo);
        if (!ehJebnet(linha)) continue; // outro cliente da conta (Infolink, Dnet etc.) - não grava
        linhas.push(linha);
        totalGravados++;
      }
      await gravarLinhas(linhas);

      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }

    resumo[tipo] = totalTipo;
  }

  return {resumo, totalGravados};
}

// Sincroniza só UMA página (até 500 itens) de um tipo, em vez do tipo
// inteiro de uma vez. Criado porque a conta cresceu muito (Jebnet + Infolink
// juntas, ~13700 terminais = 28 páginas) e sincronizarTipos([tipo]) inteiro
// não cabe mais no tempo de execução de uma função da Vercel (timeout
// silencioso no meio do caminho). O chamador (endpoint) itera página a
// página; cada chamada é curta e sempre termina dentro do limite.
async function sincronizarPaginaTipo(tipo, pagina, pastaInfo) {
  const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
  const registros = dados.registros || [];
  const totalTipo = parseInt(dados.totalRegistros, 10) || 0;

  // semIdCount conta itens sem "dados.id" (ficam de fora silenciosamente).
  // foraDaJebnet conta itens de outro cliente da conta (Infolink, Dnet etc.) -
  // filtrados aqui, antes de gravar, pra não sincronizar o que nunca deveria
  // aparecer (ver ehJebnet acima).
  let gravados = 0;
  let semId = 0;
  let foraDaJebnet = 0;
  const linhas = [];
  for (const item of registros) {
    const id = item.dados && item.dados.id;
    if (!id) { semId++; continue; }
    const linha = montarLinha(item, pastaInfo);
    if (!ehJebnet(linha)) { foraDaJebnet++; continue; }
    linhas.push(linha);
    gravados++;
  }
  await gravarLinhas(linhas);

  const temMais = registros.length > 0 && pagina * 500 < totalTipo;
  return {totalTipo, recebidos: registros.length, gravados, semId, foraDaJebnet, temMais};
}

// Upsert/remoção de UM item só (usado pelo webhook).
async function upsertItem(linha) {
  await gravarLinhas([linha]);
}
async function removerItem(id) {
  const supabase = getSupabase();
  const {error} = await supabase.from('mapa_rede').delete().eq('id', String(id));
  if (error) throw new Error(`Supabase delete falhou: ${error.message}`);
}

module.exports = {
  admin, getDb, getSupabase, geogridFetch, carregarPastas, montarLinha, ehJebnet,
  sincronizarTipos, sincronizarPaginaTipo, TIPOS_SINCRONIZADOS,
  upsertItem, removerItem,
};
