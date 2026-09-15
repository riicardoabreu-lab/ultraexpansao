const {admin, getDb, sincronizarTipos, TIPOS_SINCRONIZADOS, N_PACOTES, nomePacote, removerItemPacote} = require('./_lib/geogrid');

// Disparo manual (uma vez pra popular, ou pra forçar uma ressincronização completa):
// varre um tipo de item (ou todos, se "tipo" não for informado) e grava cada um
// agrupado em pacotes (ver _lib/geogrid.js). Em produção (Vercel, limite de tempo
// por execução) chame um tipo por vez: ?segredo=...&tipo=terminal, depois &tipo=poste, etc.
module.exports = async function handler(req, res) {
  if (req.query.segredo !== process.env.GEOGRID_SYNC_SECRET) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipoParam = req.query.tipo;

  // ?removerId=X: apaga um item órfão específico (sumiu do GeoGrid mas ficou pra
  // trás, porque a sincronização normal só adiciona/atualiza).
  if (req.query.removerId) {
    try {
      await removerItemPacote(req.query.removerId);
      res.status(200).json({ok: true, removido: req.query.removerId});
    } catch (e) {
      console.error('remoção por id falhou:', e);
      res.status(500).json({erro: String(e.message || e)});
    }
    return;
  }

  // ?tipo=X&remover=1: apaga os itens desse tipo em vez de sincronizar (usado uma
  // vez pra limpar um tipo que saiu de TIPOS_SINCRONIZADOS, ex.: postes). Varre
  // todos os N_PACOTES (são poucos) e remove as entradas com esse tipo de cada um.
  if (req.query.remover === '1') {
    if (!tipoParam) {
      res.status(400).json({erro: 'informe ?tipo= pra remover'});
      return;
    }
    try {
      const db = getDb();
      let totalRemovidos = 0;
      for (let idx = 0; idx < N_PACOTES; idx++) {
        const ref = db.collection('mapa_rede_pacotes').doc(nomePacote(idx));
        const snap = await ref.get();
        if (!snap.exists) continue;
        const itens = snap.data().itens || {};
        const patch = {};
        for (const [id, doc] of Object.entries(itens)) {
          if (doc && doc.item === tipoParam) { patch[`itens.${id}`] = admin.firestore.FieldValue.delete(); totalRemovidos++; }
        }
        if (Object.keys(patch).length) await ref.set(patch, {merge: true});
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
