const {removerItem} = require('./_lib/geogrid');
module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) { res.status(403).json({erro: 'não autorizado'}); return; }
  const idsParam = req.query.id;
  if (!idsParam) { res.status(400).json({erro: 'informe ?id= (aceita vários separados por vírgula)'}); return; }
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  const removidos = []; const erros = [];
  for (const id of ids) {
    try { await removerItem(id); removidos.push(id); }
    catch (e) { erros.push({id, erro: String(e.message || e)}); }
  }
  res.status(200).json({ok: true, removidos, erros});
};
module.exports.config = {maxDuration: 30};
