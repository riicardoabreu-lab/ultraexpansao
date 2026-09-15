const admin = require('firebase-admin');

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

// Tenta de novo (backoff bem curto) só em 429 (limite de requisições por
// minuto da API do GeoGrid) - erro passageiro, diferente de um 4xx/5xx "de
// verdade". Backoff precisa ficar pequeno: a função roda na Vercel com um
// teto de tempo de execução (maxDuration é ignorado/limitado em planos sem
// Pro) - um backoff longo (ex.: 1.5s/3s/4.5s) já estourava esse teto sozinho
// e a função morria com a própria página de erro da Vercel (HTML, não JSON),
// em vez do erro do GeoGrid aparecer no log do sincronizador.
async function geogridFetch(path, tentativa = 1) {
  const res = await fetch(`${GEOGRID_BASE}${path}`, {
    headers: {'api-key': process.env.GEOGRID_API_KEY},
  });
  if (res.status === 429 && tentativa <= 2) {
    await new Promise(r => setTimeout(r, tentativa * 400));
    return geogridFetch(path, tentativa + 1);
  }
  if (!res.ok) {
    throw new Error(`GeoGrid ${path} -> HTTP ${res.status}`);
  }
  return res.json();
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
// ou de /itensRede/{id}/mapa - tem só "idPasta") pro doc que vai pro Firestore.
function montarDoc(item, pastaInfo) {
  const dados = item.dados || {};
  const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
  const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;

  const doc = {
    item: dados.item || null,
    sigla: dados.sigla || null,
    latitude: dados.latitude != null ? Number(dados.latitude) : null,
    longitude: dados.longitude != null ? Number(dados.longitude) : null,
    municipio: (folder && folder.nomePai) || null,
    localidade: (folder && folder.nome) || null,
    status: dados.status || null,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (dados.item === 'terminal') {
    const m = (dados.sigla || '').match(/\d+/);
    doc.numero = m ? parseInt(m[0], 10) : null;
  }

  if (dados.item === 'terminal' || dados.item === 'caixa') {
    Object.assign(doc, extrairInfoObservacao(dados.observacao));
  }

  return doc;
}

// ---- Armazenamento em "pacotes" (poucos documentos grandes) ----
// Guardar 1 documento por item (13700+ só de terminal) estourava a cota
// gratuita de gravação do Firestore (20 mil/dia) numa sincronização só.
// Em vez disso, TODOS os itens (qualquer tipo) são agrupados num pool único
// de N_PACOTES "pacotes" fixos (mapa_rede_pacotes/pacote_{indice}), cada um
// um objeto {id: doc} - uma sincronização inteira agora usa umas centenas de
// gravações, não dezenas de milhares. O índice do pacote de um item é
// sempre o mesmo (baseado só no id, sem depender do tipo) - importante pro
// webhook de REMOÇÃO: quando um item some do GeoGrid, só se sabe o id (não
// dá mais pra consultar o tipo dele), então o pacote precisa ser achável só
// com o id. O tipo de cada item fica dentro do próprio doc (campo "item",
// já gravado por montarDoc), não no nome do pacote.
const N_PACOTES = 24;
function indicePacote(id) {
  const n = parseInt(id, 10);
  if (Number.isFinite(n)) return Math.abs(n) % N_PACOTES;
  // fallback pra id não-numérico (não deveria acontecer, mas por segurança)
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % N_PACOTES;
}
function nomePacote(indice) { return `pacote_${indice}`; }

// Varre os tipos informados na API do GeoGrid e grava cada item agrupado em
// pacotes. Usada tanto pelo endpoint manual (geogrid-full-sync) quanto pelo
// cron diário. Não remove pacotes/itens que sumiram do GeoGrid (isso já não
// acontecia na versão antiga tampouco - só o webhook cuida de remoção,
// item a item, na hora que o GeoGrid avisa que sumiu).
async function sincronizarTipos(tipos) {
  const db = getDb();
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

      const porPacote = new Map(); // indice -> {id: doc}
      for (const item of registros) {
        const id = item.dados && item.dados.id;
        if (!id) continue;
        const idx = indicePacote(id);
        if (!porPacote.has(idx)) porPacote.set(idx, {});
        porPacote.get(idx)[String(id)] = montarDoc(item, pastaInfo);
        totalGravados++;
      }
      for (const [idx, itens] of porPacote) {
        const patch = {};
        for (const [id, doc] of Object.entries(itens)) patch[`itens.${id}`] = doc;
        patch.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('mapa_rede_pacotes').doc(nomePacote(idx)).set(patch, {merge: true});
      }

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
// página; cada chamada é curta e sempre termina dentro do limite. Grava em
// pacotes (ver acima), não mais 1 documento por item.
async function sincronizarPaginaTipo(tipo, pagina, pastaInfo) {
  const db = getDb();
  const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
  const registros = dados.registros || [];
  const totalTipo = parseInt(dados.totalRegistros, 10) || 0;

  // semIdCount conta itens sem "dados.id" (ficam de fora silenciosamente) -
  // exposto pra diagnosticar se um lote inteiro de itens (ex.: os da
  // Infolink) está sendo descartado aqui em vez de gravado.
  let gravados = 0;
  let semId = 0;
  const porPacote = new Map(); // indice -> {id: doc}
  for (const item of registros) {
    const id = item.dados && item.dados.id;
    if (!id) { semId++; continue; }
    const idx = indicePacote(id);
    if (!porPacote.has(idx)) porPacote.set(idx, {});
    porPacote.get(idx)[String(id)] = montarDoc(item, pastaInfo);
    gravados++;
  }
  for (const [idx, itens] of porPacote) {
    const patch = {};
    for (const [id, doc] of Object.entries(itens)) patch[`itens.${id}`] = doc;
    patch.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('mapa_rede_pacotes').doc(nomePacote(idx)).set(patch, {merge: true});
  }

  const temMais = registros.length > 0 && pagina * 500 < totalTipo;
  return {totalTipo, recebidos: registros.length, gravados, semId, temMais};
}

// Upsert/remoção de UM item só (usado pelo webhook) - acha o pacote certo
// só com o id (não precisa saber o tipo, nem escanear nada) e só mexe
// naquele campo específico dentro dele.
async function upsertItemPacote(id, doc) {
  const db = getDb();
  const idx = indicePacote(id);
  await db.collection('mapa_rede_pacotes').doc(nomePacote(idx)).set({
    [`itens.${id}`]: doc,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}
async function removerItemPacote(id) {
  const db = getDb();
  const idx = indicePacote(id);
  await db.collection('mapa_rede_pacotes').doc(nomePacote(idx)).set({
    [`itens.${id}`]: admin.firestore.FieldValue.delete(),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

module.exports = {
  admin, getDb, geogridFetch, carregarPastas, montarDoc,
  sincronizarTipos, sincronizarPaginaTipo, TIPOS_SINCRONIZADOS,
  N_PACOTES, indicePacote, nomePacote, upsertItemPacote, removerItemPacote,
};
