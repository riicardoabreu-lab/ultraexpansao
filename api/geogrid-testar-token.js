// Teste pontual (não grava nada, não usa GEOGRID_API_KEY do ambiente): recebe
// um token pelo corpo da requisição (nunca por querystring, pra não ficar em
// log de acesso) e testa direto na API do GeoGrid com ELE, pra ver se acha
// sigla "CX..." antes de trocar a variável de ambiente de verdade na Vercel.
const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({erro: 'método não permitido'});
    return;
  }

  const {token, tipo} = req.body || {};
  if (!token || !tipo) {
    res.status(400).json({erro: 'informe token e tipo no corpo da requisição'});
    return;
  }

  try {
    let pagina = 1;
    let totalTipo = 0;
    let totalCx = 0;
    const exemplos = [];
    for (;;) {
      const resp = await fetch(`${GEOGRID_BASE}/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`, {
        headers: {'api-key': token},
      });
      if (!resp.ok) {
        res.status(200).json({ok: false, erro: `GeoGrid respondeu HTTP ${resp.status} (token inválido ou sem permissão?)`});
        return;
      }
      const dados = await resp.json();
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;
      for (const item of registros) {
        const sigla = item.dados && item.dados.sigla;
        if (sigla && /^cx/i.test(sigla)) {
          totalCx++;
          if (exemplos.length < 8) exemplos.push(sigla);
        }
      }
      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }
    res.status(200).json({ok: true, tipo, totalTipo, totalCx, exemplos});
  } catch (e) {
    console.error('geogridTestarToken falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
