const {geogridFetch, carregarPastas, montarLinha, ehJebnet, upsertItem, removerItem} = require('./_lib/geogrid');

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
    const item = await geogridFetch(`/itensRede/${id}/mapa`);

    if (!item || item === false || !item.dados) {
      await removerItem(id);
      console.log(`Item ${id} removido (não existe mais no GeoGrid)`);
    } else {
      const pastaInfo = await carregarPastas();
      const linha = montarLinha(item, pastaInfo);
      if (!ehJebnet(linha)) {
        // outro cliente da conta (Infolink, Dnet etc.) - garante que não fica
        // gravado (caso já existisse de uma sincronização anterior ao filtro)
        await removerItem(id);
        console.log(`Item ${id} ignorado (não é da Jebnet: município ${linha.municipio})`);
      } else {
        await upsertItem(linha);
        console.log(`Item ${id} atualizado`);
      }
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error(`Falha ao processar webhook do item ${id}:`, e);
    res.status(500).send('erro ao processar webhook');
  }
};
