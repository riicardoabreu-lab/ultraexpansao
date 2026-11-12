const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Diagnóstico pontual (não grava nada): varre a conta "alencar" do GeoGrid
// atrás das pastas da Infolink Telecom e conta os splitters 1x8/1x16 das
// caixas/terminais dela. Usa um token à parte (GEOGRID_API_KEY_DIAG, só em
// preview/branch) em vez do GEOGRID_API_KEY de produção, pra não misturar
// com a sincronização normal (que só grava a Jebnet).
async function geogridFetch(path, token, tentativa = 1) {
  const res = await fetch(`${GEOGRID_BASE}${path}`, {headers: {'api-key': token}});
  if (res.status === 429 && tentativa <= 10) {
    await new Promise(r => setTimeout(r, tentativa * 2000));
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

async function carregarPastasInfolink(token) {
  const mapa = new Map(); // id -> {nome, nomePai}
  const idsInfolink = new Set();
  let pagina = 1;
  for (;;) {
    const dados = await geogridFetch(`/pastas?pagina=${pagina}&registrosPorPagina=200`, token);
    for (const p of dados.registros || []) {
      mapa.set(String(p.id), {nome: p.nome, nomePai: p.nomePai});
      if (normalizar(p.nome).includes('infolink') || normalizar(p.nomePai).includes('infolink')) {
        idsInfolink.add(String(p.id));
      }
    }
    const total = parseInt(dados.totalRegistros, 10) || 0;
    if (pagina * 200 >= total || !dados.registros || dados.registros.length === 0) break;
    pagina++;
    await new Promise(r => setTimeout(r, 350));
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
    const {mapa: pastaInfo, idsInfolink} = await carregarPastasInfolink(token);
    const pastasInfolinkListadas = [...idsInfolink].map(id => {
      const f = pastaInfo.get(id);
      return {id, nome: f.nome, nomePai: f.nomePai};
    });

    const tiposParam = (req.query && req.query.tipos) || 'caixa';
    const tipos = tiposParam.split(',').map(t => t.trim()).filter(Boolean);
    const resumo = {};
    const splitterCount = {};
    const exemplos = [];
    let totalInfolink = 0;

    for (const tipo of tipos) {
      let pagina = 1;
      let totalTipo = 0;
      let totalTipoInfolink = 0;
      for (;;) {
        const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`, token);
        const registros = dados.registros || [];
        totalTipo = parseInt(dados.totalRegistros, 10) || 0;
        for (const item of registros) {
          const d = item.dados || {};
          const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
          if (pastaId == null || !idsInfolink.has(String(pastaId))) continue;
          totalTipoInfolink++;
          totalInfolink++;
          const splitter = extrairSplitter(d.observacao);
          const chave = splitter ? splitter.replace(/\s+/g, '') : '(sem splitter informado)';
          splitterCount[chave] = (splitterCount[chave] || 0) + 1;
          if (exemplos.length < 40) {
            const folder = pastaInfo.get(String(pastaId));
            exemplos.push({
              sigla: d.sigla || null, item: d.item, splitter,
              localidade: folder ? folder.nome : null,
              lat: d.latitude != null ? Number(d.latitude) : null,
              lon: d.longitude != null ? Number(d.longitude) : null,
            });
          }
        }
        if (registros.length === 0 || pagina * 500 >= totalTipo) break;
        pagina++;
        await new Promise(r => setTimeout(r, 350));
      }
      resumo[tipo] = {totalNaConta: totalTipo, totalInfolink: totalTipoInfolink};
    }

    res.status(200).json({ok: true, pastasInfolink: pastasInfolinkListadas, resumo, totalInfolink, splitterCount, exemplos});
  } catch (e) {
    console.error('geogridInfolinkSplitters falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 300};
