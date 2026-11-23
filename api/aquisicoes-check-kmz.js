const admin = require('firebase-admin');

// Diagnóstico temporário (só leitura) - inspeciona especificamente o
// documento da rede da Infolink (aquisicoes_kmz/_infolink_rede) pra ver em
// que formato está gravado. Remover depois de rodar.
function carregarCredencial() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
}
function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(carregarCredencial()) });
  return admin.firestore();
}

module.exports = async (req, res) => {
  try {
    const db = getDb();
    const manifesto = await db.collection('aquisicoes_kmz').doc('_infolink_rede').get();
    if (!manifesto.exists) { res.status(200).json({ existe: false }); return; }
    const data = manifesto.data();
    const partesSnap = await db.collection('aquisicoes_kmz').doc('_infolink_rede').collection('partes').get();
    res.status(200).json({
      existe: true,
      campos: Object.keys(data),
      name: data.name,
      totalPartes: data.totalPartes,
      temDataUrl: !!data.dataUrl,
      tamanhoDataUrl: data.dataUrl ? data.dataUrl.length : 0,
      partesEncontradas: partesSnap.size,
    });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
