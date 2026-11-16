const admin = require('firebase-admin');

// Diagnóstico temporário (só leitura) - checa quais provedores têm a
// "bandeirinha" kmz:{name} no doc compartilhado (aquisicoes_backups) mas
// NÃO têm o arquivo de verdade completo em aquisicoes_kmz (manifesto +
// todas as partes), sintoma do bug de regra do Firestore já corrigido
// (ver commit 70a09f1) - uploads feitos ANTES do fix ficaram com a
// bandeirinha "tem rede" propagada pra equipe, mas sem os pedaços do
// arquivo terem sido gravados de verdade. Remover este arquivo depois de
// rodar (ver aviso em CLAUDE.md sobre scripts temporários).
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
    const backup = await db.collection('aquisicoes_backups').doc('equipe').get();
    if (!backup.exists) { res.status(404).json({ error: 'aquisicoes_backups/equipe não existe' }); return; }
    const empresas = (backup.data().empresas || []).filter(e => e.kmz);

    const resultados = [];
    for (const e of empresas) {
      const manifesto = await db.collection('aquisicoes_kmz').doc(e.id).get();
      if (!manifesto.exists) {
        resultados.push({ nome: e.nome, id: e.id, status: 'SEM MANIFESTO NA NUVEM - precisa reenviar' });
        continue;
      }
      const { totalPartes } = manifesto.data();
      const partesSnap = await db.collection('aquisicoes_kmz').doc(e.id).collection('partes').get();
      const partesComDados = partesSnap.docs.filter(d => (d.data().data || '').length > 0).length;
      if (partesSnap.size < (totalPartes || 0) || partesComDados < (totalPartes || 0)) {
        resultados.push({ nome: e.nome, id: e.id, status: `INCOMPLETO - manifesto espera ${totalPartes} parte(s), só ${partesComDados} com dados na nuvem - precisa reenviar` });
      } else {
        resultados.push({ nome: e.nome, id: e.id, status: 'OK' });
      }
    }
    res.status(200).json({ total: empresas.length, resultados });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
