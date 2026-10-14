const {carregarPastas, geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual: busca uma sigla (ou trecho dela) entre os itens de
// rede do GeoGrid, pra achar onde uma caixa/CTO "já existente" está
// cadastrada de verdade (o próprio GeoGrid avisa "sigla já existente" mas
// não mostra onde). Varre um tipo inteiro (iterando páginas de 500)
// comparando sigla (case-insensitive, substring). Uso temporário.
module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipo = req.query.tipo || 'caixa';
  const busca = (req.query.q || '').toLowerCase().trim();
  if (!busca) {
    res.status(400).json({erro: 'informe ?q=trecho da sigla'});
    return;
  }

  try {
    const pastaInfo = await carregarPastas();
    const achados = [];
    let pagina = 1;
    let totalTipo = 0;
    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;
      for (const item of registros) {
        const d = item.dados || {};
        const sigla = (d.sigla || '');
        if (!sigla.toLowerCase().includes(busca)) continue;
        const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
        const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;
        achados.push({
          id: d.id, sigla, latitude: d.latitude, longitude: d.longitude,
          localidade: folder && folder.nome, municipio: folder && folder.nomePai,
        });
      }
      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }
    res.status(200).json({ok: true, tipo, busca, totalTipo, encontrados: achados.length, achados});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
