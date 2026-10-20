const {removerItem} = require('./_lib/geogrid');

// Diagnóstico pontual: apaga um item órfão específico de mapa_rede (sumiu do
// GeoGrid mas ficou pra trás, porque a sincronização normal só
// adiciona/atualiza - ver geogrid-full-sync.js, que já tem esse mesmo
// ?removerId= mas exige GEOGRID_SYNC_SECRET, indisponível aqui). Uso
// temporário.
module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const id = req.query.id;
  if (!id) {
    res.status(400).json({erro: 'informe ?id='});
    return;
  }

  try {
    await removerItem(id);
    res.status(200).json({ok: true, removido: id});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 30};
