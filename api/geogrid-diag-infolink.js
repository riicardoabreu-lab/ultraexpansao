// Diagnóstico pontual: busca ao vivo no GeoGrid quantas caixas Infolink
// (pasta-mãe "Raiz") têm splitter 1x8/1x16, pra responder uma pergunta do
// usuário sem precisar recarregar toda a mapa_rede_grupo (que só tem
// terminal pra Infolink, sem coluna splitter). Uso temporário.
const {geogridFetch, carregarPastas, montarLinha} = require('./_lib/geogrid');

module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipo = req.query.tipo || 'caixa';

  try {
    const pastaInfo = await carregarPastas();

    let pagina = 1;
    let totalTipo = 0;
    let totalInfolink = 0;
    const comSplitter = [];
    let com1x8 = 0;
    let com1x16 = 0;
    let semSplitterInfo = 0;

    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;

      for (const item of registros) {
        const id = item.dados && item.dados.id;
        if (!id) continue;
        const linha = montarLinha(item, pastaInfo);
        if ((linha.municipio || '').trim().toLowerCase() !== 'raiz') continue;
        totalInfolink++;
        if (!linha.splitter) {
          semSplitterInfo++;
          if (comSplitter.length < 5) {
            comSplitter.push({sigla: linha.sigla, localidade: linha.localidade, observacao: (item.dados && item.dados.observacao) || null});
          }
          continue;
        }
        const s = linha.splitter.toLowerCase();
        if (/1x8/.test(s)) com1x8++;
        if (/1x16/.test(s)) com1x16++;
      }

      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }

    res.status(200).json({
      ok: true, tipo, totalTipo, totalInfolink, semSplitterInfo, com1x8, com1x16,
      amostra: comSplitter.slice(0, 20),
    });
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
