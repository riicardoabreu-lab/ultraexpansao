const {getSupabase, geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual: varre as CTOs (terminal) já sincronizadas em mapa_rede
// e, pra cada uma, consulta /diagrama/equipamentos/{id} no GeoGrid (mesmo
// endpoint que api/geogrid-equipamento.js usa sob demanda no popup do
// mapa-campo) pra saber se tem splitter cadastrado no diagrama de fibra.
// "registros" vazio = sem nenhum equipamento na CTO (caso do "CTO-20893" nas
// capturas de tela do app GeoGrid, sem splitter instalado).
//
// Paginado (offset/limite) porque são milhares de CTOs e cada uma é uma
// chamada HTTP separada na API do GeoGrid - não cabe numa execução só da
// Vercel. Uso temporário (apagar depois de gerar o relatório), mesmo padrão
// do antigo api/geogrid-diag-cabos.js.
module.exports = async function handler(req, res) {
  if (req.headers['x-mapa-campo-token'] !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const offset = parseInt(req.query.offset || '0', 10);
  const limite = Math.min(parseInt(req.query.limite || '80', 10), 200);

  const supabase = getSupabase();
  const query = supabase
    .from('mapa_rede')
    .select('id, sigla, municipio, localidade', {count: offset === 0 ? 'exact' : undefined})
    .eq('item', 'terminal')
    .order('id', {ascending: true})
    .range(offset, offset + limite - 1);

  const {data: linhas, count, error} = await query;
  if (error) {
    res.status(500).json({erro: error.message});
    return;
  }

  const semSplitter = [];
  for (const linha of linhas || []) {
    try {
      const dados = await geogridFetch(`/diagrama/equipamentos/${linha.id}`);
      const registros = dados.registros || [];
      if (!registros.length) {
        semSplitter.push({id: linha.id, sigla: linha.sigla, municipio: linha.municipio, localidade: linha.localidade});
      }
    } catch (e) {
      semSplitter.push({id: linha.id, sigla: linha.sigla, municipio: linha.municipio, localidade: linha.localidade, erro: String(e.message || e)});
    }
  }

  res.status(200).json({
    ok: true,
    totalTerminais: count != null ? count : undefined,
    offset,
    limite,
    processados: (linhas || []).length,
    temMais: (linhas || []).length === limite,
    proximoOffset: offset + (linhas || []).length,
    semSplitter,
  });
};

module.exports.config = {maxDuration: 60};
