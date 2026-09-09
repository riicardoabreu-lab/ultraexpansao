const {geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual (não grava nada no Firestore): varre um tipo de item
// direto na API do GeoGrid (fonte da verdade) atrás de sigla começando com
// "CX" - usado pra descobrir se as CTOs Infolink existem na conta "alencar"
// mas classificadas com um tipo diferente do que a gente sincroniza hoje
// (TIPOS_SINCRONIZADOS, em _lib/geogrid.js), ou se nem aparecem na API.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({erro: 'método não permitido'});
    return;
  }

  const tipo = req.query.tipo;
  if (!tipo) {
    res.status(400).json({erro: 'informe ?tipo='});
    return;
  }

  try {
    let pagina = 1;
    let totalTipo = 0;
    let totalCx = 0;
    const exemplos = [];
    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;
      for (const item of registros) {
        const sigla = item.dados && item.dados.sigla;
        if (sigla && /^cx/i.test(sigla)) {
          totalCx++;
          if (exemplos.length < 8) exemplos.push(sigla);
        }
      }
      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }
    res.status(200).json({ok: true, tipo, totalTipo, totalCx, exemplos});
  } catch (e) {
    console.error(`geogridDiagnosticoCx falhou pro tipo ${tipo}:`, e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
