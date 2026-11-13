const {getDb} = require('./_lib/geogrid');

// Diagnóstico pontual (só leitura, via Admin SDK - ignora firestore.rules):
// confere se os lançamentos de produção_equipe estão realmente gravados no
// Firestore depois do ajuste das regras de segurança.
module.exports = async function handler(req, res) {
  try {
    const db = getDb();
    const snap = await db.collection('producao_equipe').orderBy('data', 'desc').limit(10).get();
    const dias = snap.docs.map(d => ({id: d.id, ...d.data()}));

    const configSnap = await db.collection('producao_equipe_config').doc('times').get();
    const times = configSnap.exists ? configSnap.data() : null;

    res.status(200).json({ok: true, totalDiasRetornados: dias.length, dias, times});
  } catch (e) {
    console.error('producaoEquipeCheck falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};
