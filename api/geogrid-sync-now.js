const {getDb, carregarPastas, sincronizarPaginaTipo} = require('./_lib/geogrid');

// Disparo manual só de "terminal" (CTOs), pro botão "Sincronizar agora" do
// painel de Numeração de CTOs — não pede o segredo de admin (diferente de
// geogrid-full-sync) porque só faz a mesma coisa que o cron diário já faz
// sozinho, só que na hora.
//
// Paginado: recebe ?pagina=N (o front chama de novo, N+1, enquanto
// "temMais" vier true) - antes fazia o tipo inteiro numa chamada só, mas
// com a conta maior (Jebnet + Infolink, ~13700 terminais = 28 páginas de
// 500) isso estourava o tempo de execução da função no meio do caminho, sem
// gravar nada e sem erro visível. Cada página sozinha sempre termina rápido.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({erro: 'método não permitido'});
    return;
  }

  const pagina = parseInt(req.query.pagina, 10) || 1;
  const db = getDb();
  const statusRef = db.collection('mapa_rede_meta').doc('sync_manual');

  try {
    if (pagina === 1) {
      const snap = await statusRef.get();
      // Uma trava "emAndamento" travada há mais de 5 min é lixo de uma
      // execução anterior que foi morta por timeout no meio do caminho -
      // nesse caso o código que desligaria a trava nunca chegou a rodar.
      // Sem isso, toda sincronização nova ficava recusada pra sempre.
      const travaVelha = snap.exists && snap.data().emAndamento
        && (Date.now() - (snap.data().iniciadoEm || 0)) > 5 * 60 * 1000;
      if (snap.exists && snap.data().emAndamento && !travaVelha) {
        res.status(429).json({erro: 'já tem uma sincronização em andamento, aguarde'});
        return;
      }
      await statusRef.set({emAndamento: true, iniciadoEm: Date.now()}, {merge: true});
    }

    const pastaInfo = await carregarPastas();
    const {totalTipo, recebidos, gravados, semId, temMais} = await sincronizarPaginaTipo('terminal', pagina, pastaInfo);

    if (!temMais) {
      await statusRef.set({emAndamento: false, ultimaEm: Date.now()}, {merge: true});
    }

    res.status(200).json({ok: true, pagina, totalTipo, recebidos, gravados, semId, temMais});
  } catch (e) {
    console.error(`geogridSyncNow falhou na página ${pagina}:`, e);
    await statusRef.set({emAndamento: false}, {merge: true}).catch(() => {});
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
