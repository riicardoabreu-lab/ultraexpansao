const {geogridFetch} = require('./_lib/geogrid');

// Chamado sob demanda pelo front-end (mapa-campo) quando o técnico abre o popup
// de uma CTO - não vale a pena pré-sincronizar isso pras ~1600 CTOs de uma vez
// (é uma chamada por item na API do GeoGrid). Devolve o splitter (ex.: "1 x 8")
// e a cor de cada porta de entrada/saída, que é como a equipe identifica a fibra
// fisicamente na caixa.
module.exports = async function handler(req, res) {
  const id = req.query.id;
  if (!id) {
    res.status(400).json({erro: 'informe ?id='});
    return;
  }

  try {
    const dados = await geogridFetch(`/diagrama/equipamentos/${id}`);
    const registro = dados.registros && dados.registros[0];
    if (!registro) {
      res.status(200).json({ok: true, splitter: null, entradas: [], saidas: []});
      return;
    }

    const tipoDados = registro.tipo && registro.tipo.dados;
    const descricao = (tipoDados && tipoDados.descricao) || null;
    const m = descricao && descricao.match(/(\d+\s*x\s*\d+)/i);
    const splitter = m ? m[1].replace(/\s+/g, '') : descricao;

    const cores = registro.cores || {};
    const paraLista = (obj) => Object.entries(obj || {}).map(([porta, cor]) => ({porta, cor}));

    res.status(200).json({
      ok: true,
      splitter,
      entradas: paraLista(cores.entradas),
      saidas: paraLista(cores.saidas),
    });
  } catch (e) {
    console.error(`geogridEquipamento falhou pro item ${id}:`, e);
    res.status(500).json({erro: String(e.message || e)});
  }
};
