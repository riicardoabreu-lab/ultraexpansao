const {carregarPastas, geogridFetch} = require('./_lib/geogrid');

// Diagnóstico/export pontual: lista os itens de rede da Infolink (não da
// Jebnet) pra gerar um KMZ com a área de atendimento dela. A conta do
// GeoGrid não tem uma pasta "Infolink" - ela é dona das cidades "normais"
// direto na raiz ("Aquiraz - CE", "Eusébio - CE", "Fortaleza - CE" etc,
// sempre terminando em " - CE"/" - PE"), diferente de Jebnet ("Jebnet -
// Itapipoca"), Dnet ("DNET - Fortaleza"/"Dnet - Fortaleza..."), GigaNet
// ("GigaNet - Barra Do Ceará...") e CLIENTES-LINKS, que têm pasta própria
// com nome de marca (ver amostra tirada em api/geogrid-diag-pastas.js).
//
// Itens da Infolink ficam direto na pasta da cidade (ex.: pastaId aponta
// pra "Eusébio - CE" em si) OU numa sub-pasta de bairro dentro da cidade
// (ex.: "Alameda" dentro de "Fortaleza - CE") - por isso o classificador
// testa tanto o nome da própria pasta do item quanto o nome da pasta-mãe.
function ehNomeCidadeInfolink(nome) {
  return /\s-\s(CE|PE)$/i.test(nome || '') && !/jebnet|dnet|giganet|clientes-links|teste/i.test(nome || '');
}
function resolverInfolink(folder) {
  if (!folder) return null;
  if (ehNomeCidadeInfolink(folder.nome)) return {municipio: folder.nome, localidade: folder.nome};
  if (ehNomeCidadeInfolink(folder.nomePai)) return {municipio: folder.nomePai, localidade: folder.nome};
  return null;
}

module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipo = req.query.tipo;
  if (!tipo) {
    res.status(400).json({erro: 'informe ?tipo='});
    return;
  }
  const pagina = parseInt(req.query.pagina, 10) || 1;

  try {
    const pastaInfo = await carregarPastas();
    const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
    const registros = dados.registros || [];
    const totalTipo = parseInt(dados.totalRegistros, 10) || 0;

    const infolink = [];
    for (const item of registros) {
      const d = item.dados || {};
      if (d.latitude == null || d.longitude == null) continue;
      const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
      const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;
      const grupo = resolverInfolink(folder);
      if (!grupo) continue;
      infolink.push({lat: Number(d.latitude), lng: Number(d.longitude), municipio: grupo.municipio, localidade: grupo.localidade});
    }

    const temMais = registros.length > 0 && pagina * 500 < totalTipo;
    res.status(200).json({ok: true, tipo, pagina, totalTipo, recebidos: registros.length, infolink, temMais});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
