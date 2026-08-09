const {getDb, sincronizarTipos, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Disparo manual (uma vez pra popular, ou pra forçar uma ressincronização completa):
// varre um tipo de item (ou todos, se "tipo" não for informado) e grava cada um em
// mapa_rede/{id}. Em produção (Vercel, limite de tempo por execução) chame um tipo
// por vez: ?segredo=...&tipo=terminal, depois &tipo=poste, etc.
module.exports = async function handler(req, res) {
  if (req.query.segredo !== process.env.GEOGRID_SYNC_SECRET) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipoParam = req.query.tipo;

  // ?tipo=X&remover=1: apaga do Firestore os itens desse tipo em vez de sincronizar
  // (usado uma vez pra limpar um tipo que saiu de TIPOS_SINCRONIZADOS, ex.: postes).
  if (req.query.remover === '1') {
    if (!tipoParam) {
      res.status(400).json({erro: 'informe ?tipo= pra remover'});
      return;
    }
    try {
      const db = getDb();
      let totalRemovidos = 0;
      for (;;) {
        const snap = await db.collection('mapa_rede').where('item', '==', tipoParam).limit(500).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        totalRemovidos += snap.size;
        if (snap.size < 500) break;
      }
      res.status(200).json({ok: true, tipo: tipoParam, totalRemovidos});
    } catch (e) {
      console.error('remoção falhou:', e);
      res.status(500).json({erro: String(e.message || e)});
    }
    return;
  }

  const tipos = tipoParam ? [tipoParam] : TIPOS_SINCRONIZADOS;
  if (tipoParam && !TIPOS_SINCRONIZADOS.includes(tipoParam)) {
    res.status(400).json({erro: `tipo inválido: ${tipoParam}`, tiposValidos: TIPOS_SINCRONIZADOS});
    return;
  }

  try {
    const {resumo, totalGravados} = await sincronizarTipos(tipos);
    res.status(200).json({ok: true, resumo, totalGravados});
  } catch (e) {
    console.error('geogridFullSync falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
