// Diagnóstico pontual: testa chamadas cruas (OPTIONS/POST/PUT/PATCH) na API
// do GeoGrid pra descobrir se existe endpoint de escrita pra corrigir o nome
// de um equipamento (campo "sigla" de /diagrama/equipamentos, ex.:
// "IFL_DIV109035" devia virar "CTO-21671 - Splitter 1x8 Conectorizado APC").
// api-key sozinha não bastou (POST/PUT/PATCH em /equipamentos sempre
// devolveu "não encontrado" pros ids, mesmo corretos) - suspeita de que a
// escrita de verdade exige sessão de usuário logado, não só api-key. Testa
// agora passando um token de sessão (?session=...) como cookie PHPSESSID,
// que foi o cookie que a própria API devolveu nas tentativas anteriores.
// Uso temporário.
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
  const form = req.query.form === '1';
  const session = req.query.session; // token de sessão (cookie PHPSESSID)

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
    const noApiKey = req.query.noApiKey === '1';
    const headers = {
      ...(noApiKey ? {} : {'api-key': process.env.GEOGRID_API_KEY}),
      ...(contentType ? {'Content-Type': contentType} : {}),
      ...(session ? {'Cookie': `PHPSESSID=${session}`} : {}),
    };
    const r = await fetch(`${GEOGRID_BASE}${path}`, {method, headers, body: sendBody});
    const headersObj = {};
    r.headers.forEach((v, k) => { headersObj[k] = v; });
    let texto;
    try { texto = await r.text(); } catch (e) { texto = `(falha ao ler corpo: ${e.message})`; }
    res.status(200).json({
      ok: true,
      status: r.status,
      headers: headersObj,
      corpo: texto.slice(0, 3000),
      enviado: {headers: Object.keys(headers).reduce((o, k) => (o[k] = k === 'api-key' ? '(oculto)' : headers[k], o), {}), body: sendBody},
    });
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 30};
