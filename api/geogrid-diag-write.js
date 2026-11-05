// Diagnóstico pontual: testa chamadas cruas (OPTIONS/POST/PUT/PATCH) na API
// do GeoGrid pra descobrir se existe endpoint de escrita pra corrigir o nome
// de um equipamento (campo "sigla" de /diagrama/equipamentos, ex.:
// "IFL_DIV109035" devia virar "CTO-21671 - Splitter 1x8 Conectorizado APC").
// Mesmo padrão usado antes pra descobrir que /cabos é só de escrita (POST).
// Uso temporário - NÃO reaproveita geogridFetch (só faz GET) porque aqui
// precisa de método/corpo variáveis.
const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const path = req.query.path;
  if (!path) {
    res.status(400).json({erro: 'informe ?path=/algumacoisa'});
    return;
  }
  const method = (req.query.method || 'OPTIONS').toUpperCase();
  let body = undefined;
  if (req.query.body) {
    try { body = JSON.parse(req.query.body); } catch { body = req.query.body; }
  }
  // ?form=1: manda como application/x-www-form-urlencoded (PHP clássico só
  // popula $_POST a partir disso - JSON bruto no corpo fica invisível pro
  // $_POST a menos que o controller leia php://input manualmente, que não
  // parece ser o caso aqui - os dois primeiros testes com JSON devolveram o
  // MESMO erro de "não encontrado" tanto vazio quanto preenchido).
  const form = req.query.form === '1';

  try {
    let sendBody;
    let contentType;
    if (body && form) {
      sendBody = new URLSearchParams(body).toString();
      contentType = 'application/x-www-form-urlencoded';
    } else if (body) {
      sendBody = JSON.stringify(body);
      contentType = 'application/json';
    }
    const r = await fetch(`${GEOGRID_BASE}${path}`, {
      method,
      headers: {
        'api-key': process.env.GEOGRID_API_KEY,
        ...(contentType ? {'Content-Type': contentType} : {}),
      },
      body: sendBody,
    });
    const headersObj = {};
    r.headers.forEach((v, k) => { headersObj[k] = v; });
    let texto;
    try { texto = await r.text(); } catch (e) { texto = `(falha ao ler corpo: ${e.message})`; }
    res.status(200).json({ok: true, status: r.status, headers: headersObj, corpo: texto.slice(0, 3000)});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 30};
