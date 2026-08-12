const {sincronizarTipos, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Disparado pelo Vercel Cron (ver vercel.json) todo dia às 7:30 (America/Fortaleza).
// A Vercel autentica automaticamente com "Authorization: Bearer $CRON_SECRET" -
// não precisa (nem deve) expor segredo nenhum na URL do cron.
module.exports = async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({erro: 'não autorizado'});
    return;
  }

  try {
    const {resumo, totalGravados} = await sincronizarTipos(TIPOS_SINCRONIZADOS);
    console.log('geogridCronSync concluído:', JSON.stringify(resumo));
    res.status(200).json({ok: true, resumo, totalGravados});
  } catch (e) {
    console.error('geogridCronSync falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
