const {carregarPastas, geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual: lista as pastas do GeoGrid (id/nome/pastaMãe) + uma
// amostra de itensRede de alguns tipos, SEM o filtro ehJebnet - pra entender
// como a Infolink aparece estruturalmente na conta (nome de pasta? padrão de
// sigla?) antes de escrever um export específico pra ela. Uso temporário,
// apagar depois (mesmo padrão do antigo geogrid-audit-splitter.js).
module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  try {
    const pastaInfo = await carregarPastas();
    const pastas = Array.from(pastaInfo.entries()).map(([id, info]) => ({id, ...info}));

    const amostras = {};
    const tipos = (req.query.tipos || 'terminal,caixa').split(',');
    for (const tipo of tipos) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=1&registrosPorPagina=50`);
      amostras[tipo] = {
        totalRegistros: dados.totalRegistros,
        registros: (dados.registros || []).map(item => {
          const d = item.dados || {};
          const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
          const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;
          return {id: d.id, sigla: d.sigla, pastaId, pastaNome: folder && folder.nome, pastaMae: folder && folder.nomePai};
        }),
      };
    }

    res.status(200).json({ok: true, totalPastas: pastas.length, pastas, amostras});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
