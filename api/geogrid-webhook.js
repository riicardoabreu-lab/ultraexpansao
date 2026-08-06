const {getDb, geogridFetch, carregarPastas, montarDoc} = require('./_lib/geogrid');

// Recebe o POST que o GeoGrid dispara quando um item muda (configurado em
// Menu -> Configuração integração, dentro do GeoGrid). O formato exato do corpo
// não está documentado - tentamos extrair o id do item de alguns campos comuns
// e logamos o payload bruto pra ajustar se necessário depois do primeiro evento real.
module.exports = async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (auth !== process.env.GEOGRID_WEBHOOK_SECRET) {
    console.warn('Webhook do GeoGrid recebido com Authorization inválido');
    res.status(403).send('não autorizado');
    return;
  }

  console.log('Webhook do GeoGrid recebido:', JSON.stringify(req.body));

  const body = req.body || {};
  const id = body.idItemRede || body.id || (body.dados && body.dados.id);
  if (!id) {
    console.warn('Não consegui extrair o id do item do payload do webhook - ajustar extração', body);
    res.status(200).send('recebido, sem id identificado');
    return;
  }

  try {
    const db = getDb();
    const item = await geogridFetch(`/itensRede/${id}/mapa`);

    if (!item || item === false || !item.dados) {
      await db.collection('mapa_rede').doc(String(id)).delete();
      console.log(`Item ${id} removido de mapa_rede (não existe mais no GeoGrid)`);
    } else {
      const pastaInfo = await carregarPastas();
      await db.collection('mapa_rede').doc(String(id)).set(montarDoc(item, pastaInfo), {merge: true});
      console.log(`Item ${id} atualizado em mapa_rede`);
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error(`Falha ao processar webhook do item ${id}:`, e);
    res.status(500).send('erro ao processar webhook');
  }
};
