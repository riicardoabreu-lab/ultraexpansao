const {getSupabase, sincronizarTipos, TIPOS_SINCRONIZADOS, removerItem} = require('./_lib/geogrid');

// Disparo manual (uma vez pra popular, ou pra forçar uma ressincronização completa):
// varre um tipo de item (ou todos, se "tipo" não for informado) e grava cada um
// na tabela mapa_rede do Supabase (ver _lib/geogrid.js). Em produção (Vercel,
// limite de tempo por execução) chame um tipo por vez: ?segredo=...&tipo=terminal,
// depois &tipo=poste, etc.
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
      await removerItem(req.query.removerId);
      res.status(200).json({ok: true, removido: req.query.removerId});
    } catch (e) {
      console.error('remoção por id falhou:', e);
      res.status(500).json({erro: String(e.message || e)});
    }
    return;
  }

  // ?tipo=X&remover=1: apaga os itens desse tipo em vez de sincronizar (usado uma
  // vez pra limpar um tipo que saiu de TIPOS_SINCRONIZADOS, ex.: postes).
  if (req.query.remover === '1') {
    if (!tipoParam) {
      res.status(400).json({erro: 'informe ?tipo= pra remover'});
      return;
    }
    try {
      const supabase = getSupabase();
      const {error, count} = await supabase.from('mapa_rede').delete({count: 'exact'}).eq('item', tipoParam);
      if (error) throw new Error(error.message);
      res.status(200).json({ok: true, tipo: tipoParam, totalRemovidos: count || 0});
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
