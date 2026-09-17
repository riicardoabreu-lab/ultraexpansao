const {geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual (não grava nada): tenta alguns caminhos prováveis da
// API do GeoGrid atrás de dados de CABO (linhas/rotas) - hoje o app só
// sincroniza itens PONTO (terminal, caixa, rack, estação, pontoAcesso,
// interesse, reserva - ver TIPOS_SINCRONIZADOS em _lib/geogrid.js); cabos
// vêm de um KMZ estático, atualizado manualmente. Usado só pra descobrir se
// dá pra puxar cabo também via API, sem precisar adivinhar às cegas (mesma
// ideia do geogrid-diagnostico-cx.js). Apaga esse arquivo depois de usar.
const CANDIDATOS = [
  '/cabos?pagina=1&registrosPorPagina=5',
  '/trechosCabo?pagina=1&registrosPorPagina=5',
  '/rotasCabo?pagina=1&registrosPorPagina=5',
  '/segmentosCabo?pagina=1&registrosPorPagina=5',
  '/rotas?pagina=1&registrosPorPagina=5',
  '/itensRede?item[]=cabo&pagina=1&registrosPorPagina=5',
  '/itensRede?item[]=trechoCabo&pagina=1&registrosPorPagina=5',
];

module.exports = async function handler(req, res) {
  if (req.query.segredo !== process.env.GEOGRID_SYNC_SECRET) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const resultados = [];
  for (const caminho of CANDIDATOS) {
    try {
      const dados = await geogridFetch(caminho);
      resultados.push({
        caminho,
        ok: true,
        totalRegistros: dados.totalRegistros,
        amostra: JSON.stringify(dados.registros ? dados.registros.slice(0, 1) : dados).slice(0, 2000),
      });
    } catch (e) {
      resultados.push({caminho, ok: false, erro: String(e.message || e)});
    }
  }

  res.status(200).json({resultados});
};

module.exports.config = {maxDuration: 60};
