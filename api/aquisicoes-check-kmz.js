const {getDb} = require('./_lib/geogrid');

// Diagnóstico pontual (só leitura): lista os manifestos de aquisicoes_kmz
// pra confirmar se os uploads recentes (LHISP Connect, HDS Telecom, Rede
// da Infolink) realmente chegaram na nuvem depois da correção da regra do
// Firestore.
module.exports = async function handler(req, res) {
  try {
    const db = getDb();
    const snap = await db.collection('aquisicoes_kmz').get();
    const manifestos = snap.docs.map(d => ({id: d.id, ...d.data()}))
      .sort((a, b) => (b.atualizado_em || 0) - (a.atualizado_em || 0));
    res.status(200).json({ok: true, total: manifestos.length, manifestos});
  } catch (e) {
    console.error('aquisicoesCheckKmz falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};
