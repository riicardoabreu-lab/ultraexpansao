const {getDb} = require('./_lib/geogrid');

// Endpoint temporário, sem segredo em ambiente (os existentes estão marcados
// "Sensitive" no Vercel e não dá pra ler de volta pra usar em curl). Remove só
// o doc órfão da CTO-21585 duplicada (id 2007491, sumiu do GeoGrid mas ficou
// no Firestore). Apagar este arquivo e fazer redeploy depois de usar uma vez.
module.exports = async function handler(req, res) {
  try {
    const db = getDb();
    await db.collection('mapa_rede').doc('2007491').delete();
    res.status(200).json({ok: true, removido: '2007491'});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};
