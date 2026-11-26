const { getSupabase } = require('./_lib/geogrid');

// Proxy pro mapa-grupo/ - antes o navegador consultava o Supabase direto
// com a chave anon/publishable (hardcoded na página), e a tabela
// mapa_rede_grupo tinha leitura liberada (RLS "to anon") pra qualquer um
// com essa chave, sem precisar nem abrir a página (revisão de segurança,
// 2026-11-26). Agora:
// - a senha nunca fica no código da página, só aqui (MAPA_GRUPO_TOKEN, env
//   var da Vercel) - o navegador manda o que a pessoa digitou, este
//   endpoint que confere;
// - a leitura em si usa a service_role key (ignora RLS), e a política de
//   leitura pública da tabela foi removida (ver supabase.sql) - sem passar
//   por aqui, ninguém lê mapa_rede_grupo de fora.
module.exports = async (req, res) => {
  try {
    const senha = req.method === 'POST' ? (req.body && req.body.senha) : req.query.senha;
    if (!senha || senha !== process.env.MAPA_GRUPO_TOKEN) {
      res.status(401).json({ error: 'senha incorreta' });
      return;
    }
    const PAGINA = 1000;
    const linhas = [];
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await getSupabase()
        .from('mapa_rede_grupo')
        .select('*')
        .range(desde, desde + PAGINA - 1);
      if (error) throw error;
      linhas.push(...data);
      if (data.length < PAGINA) break;
    }
    res.status(200).json({ linhas });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
