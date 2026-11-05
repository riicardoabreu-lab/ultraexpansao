const {geogridFetch} = require('./_lib/geogrid');

// Diagnóstico pontual: devolve a resposta CRUA de /diagrama/equipamentos/{id}
// (sem o resumo que geogrid-equipamento.js já extrai) - pra entender a
// estrutura completa do registro de equipamento (ids, campos editáveis) antes
// de tentar corrigir um nome errado. Uso temporário.
module.exports = async function handler(req, res) {
  const token = req.headers['x-mapa-campo-token'] || req.query.token;
  if (token !== process.env.MAPA_CAMPO_TOKEN) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }
  const id = req.query.id;
  if (!id) {
    res.status(400).json({erro: 'informe ?id='});
    return;
  }
  try {
    const dados = await geogridFetch(`/diagrama/equipamentos/${id}`);
    res.status(200).json(dados);
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 30};
