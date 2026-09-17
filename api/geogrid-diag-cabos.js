const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Diagnóstico pontual (não grava nada): /cabos respondeu HTTP 405 (Method Not
// Allowed) na primeira rodada - existe de verdade, só não aceita GET. Testa
// outros métodos/variações pra descobrir como ler de lá. Apagar depois de
// descobrir o caminho certo (ver histórico do commit que criou esse arquivo).
async function sonda(caminho, metodo) {
  try {
    const res = await fetch(`${GEOGRID_BASE}${caminho}`, {
      method: metodo,
      headers: {'api-key': process.env.GEOGRID_API_KEY},
    });
    const allow = res.headers.get('allow');
    let corpo = '';
    try { corpo = (await res.text()).slice(0, 500); } catch (e) {}
    return {caminho, metodo, status: res.status, allow, corpo};
  } catch (e) {
    return {caminho, metodo, erro: String(e.message || e)};
  }
}

module.exports = async function handler(req, res) {
  if (req.query.token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const resultados = await Promise.all([
    sonda('/cabos', 'OPTIONS'),
    sonda('/cabos', 'POST'),
    sonda('/cabos?pagina=1&registrosPorPagina=5', 'POST'),
    sonda('/cabos/listar', 'GET'),
    sonda('/cabos/1', 'GET'),
  ]);

  res.status(200).json({resultados});
};

module.exports.config = {maxDuration: 60};
