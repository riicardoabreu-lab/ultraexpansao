const {carregarPastas, sincronizarPaginaTipo, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Acionado pelo botão "🔄 Sincronizar" do mapa-campo - mesma sincronização do
// cron diário (geogrid-cron-sync), só que sob demanda, quando o técnico acabou
// de editar algo no GeoGrid e não quer esperar até o próximo dia. Protegido pelo
// mesmo token do front (MAPA_CAMPO_TOKEN, ver geogrid-equipamento.js) em vez do
// GEOGRID_SYNC_SECRET do endpoint administrativo - só sincroniza (sem os poderes
// de apagar/remover de geogrid-full-sync), então não precisa do segredo maior.
//
// Paginado (?pagina=N): a conta cresceu muito (Jebnet + Infolink juntas) e
// sincronizar um tipo inteiro numa chamada só estourava o tempo de execução
// da Vercel no meio do caminho, sem gravar nada e sem erro visível - mesmo
// problema já corrigido no botão "Sincronizar agora" do numeracao-ctos
// (ver geogrid-sync-now.js). O front chama de novo, página seguinte,
// enquanto "temMais" vier true.
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
  const pagina = parseInt(req.query.pagina, 10) || 1;

  try {
    const pastaInfo = await carregarPastas();
    const {totalTipo, recebidos, gravados, semId, temMais} = await sincronizarPaginaTipo(tipoParam, pagina, pastaInfo);
    res.status(200).json({ok: true, tipo: tipoParam, pagina, totalTipo, recebidos, gravados, semId, temMais});
  } catch (e) {
    console.error(`geogridManualSync falhou (tipo ${tipoParam}, página ${pagina}):`, e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
