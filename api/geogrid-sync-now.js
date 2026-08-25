const {getDb, sincronizarTipos} = require('./_lib/geogrid');

// Disparo manual só de "terminal" (CTOs), pro botão "Sincronizar agora" do
// painel de Numeração de CTOs — não pede o segredo de admin (diferente de
// geogrid-full-sync) porque só faz a mesma coisa que o cron diário já faz
// sozinho, só que na hora. Um pequeno cooldown evita clique duplo/spam.
const COOLDOWN_MS = 30 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({erro: 'método não permitido'});
    return;
  }

  const db = getDb();
  const statusRef = db.collection('mapa_rede_meta').doc('sync_manual');

  try {
    const snap = await statusRef.get();
    const agora = Date.now();
    if (snap.exists) {
      const dados = snap.data();
      if (dados.emAndamento) {
        res.status(429).json({erro: 'já tem uma sincronização em andamento, aguarde'});
        return;
      }
      if (dados.ultimaEm && (agora - dados.ultimaEm) < COOLDOWN_MS) {
        res.status(429).json({erro: 'aguarde alguns segundos antes de sincronizar de novo'});
        return;
      }
    }

    await statusRef.set({emAndamento: true, iniciadoEm: agora}, {merge: true});
    const {resumo, totalGravados} = await sincronizarTipos(['terminal']);
    await statusRef.set({emAndamento: false, ultimaEm: Date.now(), totalGravados}, {merge: true});
    res.status(200).json({ok: true, resumo, totalGravados});
  } catch (e) {
    console.error('geogridSyncNow falhou:', e);
    await statusRef.set({emAndamento: false}, {merge: true}).catch(() => {});
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
