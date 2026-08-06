const {getDb, geogridFetch, carregarPastas, montarDoc, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

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
  const tipos = tipoParam ? [tipoParam] : TIPOS_SINCRONIZADOS;
  if (tipoParam && !TIPOS_SINCRONIZADOS.includes(tipoParam)) {
    res.status(400).json({erro: `tipo inválido: ${tipoParam}`, tiposValidos: TIPOS_SINCRONIZADOS});
    return;
  }

  try {
    const db = getDb();
    const pastaInfo = await carregarPastas();

    const resumo = {};
    let totalGravados = 0;

    for (const tipo of tipos) {
      let pagina = 1;
      let totalTipo = 0;

      for (;;) {
        const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
        const registros = dados.registros || [];
        totalTipo = parseInt(dados.totalRegistros, 10) || 0;

        for (let i = 0; i < registros.length; i += 500) {
          const lote = registros.slice(i, i + 500);
          const batch = db.batch();
          for (const item of lote) {
            const id = item.dados && item.dados.id;
            if (!id) continue;
            batch.set(db.collection('mapa_rede').doc(String(id)), montarDoc(item, pastaInfo), {merge: true});
            totalGravados++;
          }
          await batch.commit();
        }

        if (registros.length === 0 || pagina * 500 >= totalTipo) break;
        pagina++;
      }

      resumo[tipo] = totalTipo;
    }

    res.status(200).json({ok: true, resumo, totalGravados});
  } catch (e) {
    console.error('geogridFullSync falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
