const {sincronizarTipos, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Acionado pelo botão "🔄 Sincronizar" do mapa-campo - mesma sincronização do
// cron diário (geogrid-cron-sync), só que sob demanda, quando o técnico acabou
// de editar algo no GeoGrid e não quer esperar até o próximo dia. Protegido pelo
// mesmo token do front (MAPA_CAMPO_TOKEN, ver geogrid-equipamento.js) em vez do
// GEOGRID_SYNC_SECRET do endpoint administrativo - só sincroniza (sem os poderes
// de apagar/remover de geogrid-full-sync), então não precisa do segredo maior.
module.exports = async function handler(req, res) {
  if (req.headers['x-mapa-campo-token'] !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipoParam = req.query.tipo;
  if (!tipoParam || !TIPOS_SINCRONIZADOS.includes(tipoParam)) {
    res.status(400).json({erro: `informe ?tipo= válido`, tiposValidos: TIPOS_SINCRONIZADOS});
    return;
  }

  try {
    const {resumo, totalGravados} = await sincronizarTipos([tipoParam]);
    res.status(200).json({ok: true, resumo, totalGravados});
  } catch (e) {
    console.error('geogridManualSync falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
