const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Diagnóstico pontual (não grava nada): varre a conta "alencar" do GeoGrid
// atrás das pastas da Infolink Telecom e conta os splitters 1x8/1x16 das
// caixas/terminais dela. Usa um token à parte (GEOGRID_API_KEY_DIAG, só em
// preview/branch) em vez do GEOGRID_API_KEY de produção, pra não misturar
// com a sincronização normal (que só grava a Jebnet).
async function geogridFetch(path, token, tentativa = 1) {
  const res = await fetch(`${GEOGRID_BASE}${path}`, {headers: {'api-key': token}});
  if (res.status === 429 && tentativa <= 15) {
    const espera = Math.min(tentativa * 3000, 20000);
    console.log(`GEOGRID_429 path=${path} tentativa=${tentativa} esperando=${espera}ms`);
    await new Promise(r => setTimeout(r, espera));
    return geogridFetch(path, token, tentativa + 1);
  }
  if (!res.ok) throw new Error(`GeoGrid ${path} -> HTTP ${res.status}`);
  return res.json();
}

function normalizar(txt) {
  return (txt || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function extrairSplitter(observacao) {
  if (!observacao) return null;
  const texto = String(observacao).replace(/<[^>]+>/g, ' ');
  const m = texto.match(/SPLITTER[ \t]*:[ \t]*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

// A conta não tem uma pasta chamada "Infolink" - ela é a dona "padrão" (pastas
// de cidade direto embaixo de "Raiz": Fortaleza - CE, Eusébio - CE, Aquiraz -
// CE etc.). Jebnet, Dnet, GigaNet e CLIENTES-LINKS são os outros clientes
// revendidos na mesma conta - excluídos por nome de raiz/ancestral.
const RAIZES_NAO_INFOLINK = [
  'jebnet', 'dnet', 'giganet', 'clientes-links', 'clientes ptp',
  'palmares', 'pernambuco', 'teste', 'raiz',
];
function ehRaizNaoInfolink(nome) {
  const n = normalizar(nome);
  return RAIZES_NAO_INFOLINK.some(r => n.includes(r));
}

async function carregarPastasInfolink(token) {
  const mapa = new Map(); // id -> {nome, nomePai}
  const porNome = new Map(); // nome -> {nome, nomePai} (nomePai é o NOME do pai, não id)
  let pagina = 1;
  for (;;) {
    const dados = await geogridFetch(`/pastas?pagina=${pagina}&registrosPorPagina=200`, token);
    for (const p of dados.registros || []) {
      mapa.set(String(p.id), {nome: p.nome, nomePai: p.nomePai});
      porNome.set(p.nome, {nome: p.nome, nomePai: p.nomePai});
    }
    const total = parseInt(dados.totalRegistros, 10) || 0;
    if (pagina * 200 >= total || !dados.registros || dados.registros.length === 0) break;
    pagina++;
    await new Promise(r => setTimeout(r, 350));
  }

  // Sobe a cadeia de ancestrais (por NOME, já que nomePai não é id) até achar
  // uma raiz excluída, "Raiz" em si, ou um pai órfão (nomePai null em outra
  // pasta que não a própria) - órfão é tratado como não-Infolink por segurança.
  function ehInfolink(id) {
    let atual = mapa.get(id);
    let passos = 0;
    while (atual && passos < 20) {
      if (ehRaizNaoInfolink(atual.nome)) return false;
      // nomePai null numa pasta que não seja a própria "Raiz" é pasta órfã/
      // duplicada (visto na prática: duplica nome de pasta do Dnet/GigaNet já
      // excluída em outro lugar da árvore) - trata como não-Infolink por segurança.
      if (atual.nomePai == null) return false;
      if (ehRaizNaoInfolink(atual.nomePai)) return false;
      if (normalizar(atual.nomePai) === 'raiz') return true;
      const pai = porNome.get(atual.nomePai);
      if (!pai) return true; // pai não listado (nome genérico reusado) - assume dentro da árvore principal
      atual = pai;
      passos++;
    }
    return true;
  }

  const idsInfolink = new Set();
  for (const id of mapa.keys()) {
    if (ehInfolink(id)) idsInfolink.add(id);
  }
  return {mapa, idsInfolink};
}

module.exports = async function handler(req, res) {
  const token = process.env.GEOGRID_API_KEY_DIAG;
  if (!token) {
    res.status(500).json({erro: 'GEOGRID_API_KEY_DIAG não configurada'});
    return;
  }

  try {
    if (req.query && req.query.listarPastas) {
      const {mapa} = await carregarPastasInfolink(token);
      const todas = [...mapa.entries()].map(([id, f]) => ({id, nome: f.nome, nomePai: f.nomePai}));
      res.status(200).json({ok: true, pastas: todas});
      return;
    }

    const {mapa: pastaInfo, idsInfolink} = await carregarPastasInfolink(token);
    console.log(`GEOGRID_PASTAS_OK total=${pastaInfo.size} infolink=${idsInfolink.size}`);
    const pastasInfolinkListadas = [...idsInfolink].map(id => {
      const f = pastaInfo.get(id);
      return {id, nome: f.nome, nomePai: f.nomePai};
    });

    const tipo = (req.query && req.query.tipo) || 'caixa';
    const pagina = parseInt((req.query && req.query.pagina) || '1', 10);

    const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`, token);
    const registros = dados.registros || [];
    const totalTipo = parseInt(dados.totalRegistros, 10) || 0;
    const totalPaginas = Math.ceil(totalTipo / 500) || 0;

    const splitterCount = {};
    const exemplos = [];
    let totalInfolinkPagina = 0;
    for (const item of registros) {
      const d = item.dados || {};
      const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
      if (pastaId == null || !idsInfolink.has(String(pastaId))) continue;
      totalInfolinkPagina++;
      const splitter = extrairSplitter(d.observacao);
      const chave = splitter ? splitter.replace(/\s+/g, '') : '(sem splitter informado)';
      splitterCount[chave] = (splitterCount[chave] || 0) + 1;
      const folder = pastaInfo.get(String(pastaId));
      exemplos.push({
        sigla: d.sigla || null, item: d.item, splitter,
        localidade: folder ? folder.nome : null,
        lat: d.latitude != null ? Number(d.latitude) : null,
        lon: d.longitude != null ? Number(d.longitude) : null,
      });
    }

    res.status(200).json({
      ok: true, tipo, pagina, totalPaginas, totalTipoNaConta: totalTipo,
      recebidos: registros.length, totalInfolinkPagina, splitterCount, exemplos,
      pastasInfolink: pagina === 1 ? pastasInfolinkListadas : undefined,
    });
  } catch (e) {
    console.error('geogridInfolinkSplitters falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 300};
