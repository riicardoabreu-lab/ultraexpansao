const admin = require('firebase-admin');

// Diagnóstico temporário (só leitura) - inspeciona o doc compartilhado
// aquisicoes_backups/equipe pra conferir se o campo "updated" está
// preenchido de verdade (uma sessão nova só aplica o snapshot da nuvem se
// updated > window._lastKnownUpdated, que começa em 0 numa sessão nova -
// se o doc real tiver updated ausente/0, nenhuma sessão nova jamais
// aplicaria os dados reais, independente de qualquer race condition no
// cliente). Remover este arquivo depois de rodar.
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
    const snap = await db.collection('aquisicoes_backups').doc('equipe').get();
    if (!snap.exists) { res.status(404).json({ error: 'doc não existe' }); return; }
    const data = snap.data();
    res.status(200).json({
      updated: data.updated,
      updatedTipo: typeof data.updated,
      updatedComoData: data.updated ? new Date(data.updated).toISOString() : null,
      totalEmpresas: (data.empresas || []).length,
      nomes: (data.empresas || []).map(e => e.nome),
      temRedeInfolink: !!data.redeInfolink,
    });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
