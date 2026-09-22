const {getSupabase, geogridFetch} = require('./_lib/geogrid');

// Sincroniza a coluna tem_splitter de mapa_rede (só terminal/CTO) consultando
// /diagrama/equipamentos/{id} no GeoGrid - mesmo endpoint que
// api/geogrid-equipamento.js usa sob demanda no popup, só que aqui o
// resultado fica gravado (não é só mostrado na hora). "registros" vazio =
// nenhum equipamento cadastrado na CTO = sem splitter.
//
// Uma chamada por CTO na API do GeoGrid, com limite de requisições por
// minuto bem apertado (visto na prática: rajada sem pausa vira 429 em quase
// tudo) - por isso pagina em lotes pequenos com pausa entre cada chamada,
// igual api/geogrid-manual-sync.js pagina por tipo/página; o front-end
// (botão "🔌 Verificar splitters" no mapa-campo) chama isso em loop até
// "temMais" vir false.
module.exports = async function handler(req, res) {
  // Aceita o token por query string também (além do header) - só pra dar
  // pra disparar manualmente (ex.: ferramenta que não manda header custom),
  // mesmo padrão do antigo diagnóstico geogrid-audit-splitter.js.
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const offset = parseInt(req.query.offset || '0', 10);
  const limite = Math.min(parseInt(req.query.limite || '30', 10), 40);
  const pausaMs = Math.min(parseInt(req.query.pausaMs || '900', 10), 2000);

  const supabase = getSupabase();
  const {data: linhas, count, error} = await supabase
    .from('mapa_rede')
    .select('id', {count: offset === 0 ? 'exact' : undefined})
    .eq('item', 'terminal')
    .order('id', {ascending: true})
    .range(offset, offset + limite - 1);
  if (error) {
    res.status(500).json({erro: error.message});
    return;
  }

  let atualizados = 0;
  const erros = [];
  let primeira = true;
  for (const linha of linhas || []) {
    if (!primeira) await new Promise(r => setTimeout(r, pausaMs));
    primeira = false;
    try {
      const dados = await geogridFetch(`/diagrama/equipamentos/${linha.id}`);
      const temSplitter = (dados.registros || []).length > 0;
      const {error: upErro} = await supabase
        .from('mapa_rede')
        .update({tem_splitter: temSplitter})
        .eq('id', linha.id);
      if (upErro) throw new Error(upErro.message);
      atualizados++;
    } catch (e) {
      erros.push({id: linha.id, erro: String(e.message || e)});
    }
  }

  res.status(200).json({
    ok: true,
    totalTerminais: count != null ? count : undefined,
    offset,
    limite,
    processados: (linhas || []).length,
    atualizados,
    temMais: (linhas || []).length === limite,
    proximoOffset: offset + (linhas || []).length,
    erros,
  });
};

module.exports.config = {maxDuration: 60};
