const {geogridFetch} = require('./_lib/geogrid');

// Padrão de 12 cores usado pelo provedor pra identificar fibra dentro de um cabo
// (confirmado batendo com o diagrama real do GeoGrid: fibra 5 = vermelha). Cabos
// com mais de 12 fibras repetem o ciclo por tubo - por isso o módulo 12.
const PADRAO_CORES_FIBRA = [
  {hex: '#00ff00', nome: 'verde'},
  {hex: '#ffff66', nome: 'amarela'},
  {hex: '#ffffff', nome: 'branca'},
  {hex: '#0000ff', nome: 'azul'},
  {hex: '#ff0000', nome: 'vermelha'},
  {hex: '#cc00ff', nome: 'violeta'},
  {hex: '#660000', nome: 'marrom'},
  {hex: '#ff33ff', nome: 'rosa'},
  {hex: '#000000', nome: 'preta'},
  {hex: '#666666', nome: 'cinza'},
  {hex: '#ff6600', nome: 'laranja'},
  {hex: '#00ffff', nome: 'água-marinha'},
];

function corDaFibra(numero) {
  const n = parseInt(numero, 10);
  if (!n || n < 1) return null;
  const cor = PADRAO_CORES_FIBRA[(n - 1) % 12];
  return {numero: n, hex: cor.hex, nome: cor.nome};
}

// Chamado sob demanda pelo front-end (mapa-campo) quando o técnico abre o popup
// de uma CTO - não vale a pena pré-sincronizar isso pras ~1600 CTOs de uma vez
// (é uma chamada por item na API do GeoGrid). Devolve o splitter (ex.: "1x8") e
// qual fibra (número + cor) alimenta a entrada do splitter dessa CTO.
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
      res.status(200).json({ok: true, splitter: null, fibra: null});
      return;
    }

    const tipoDados = registro.tipo && registro.tipo.dados;
    const descricao = (tipoDados && tipoDados.descricao) || null;
    const m = descricao && descricao.match(/(\d+\s*x\s*\d+)/i);
    const splitter = m ? m[1].replace(/\s+/g, '') : descricao;

    // A entrada do splitter é fundida (fusão) numa fibra específica de um cabo -
    // é o número dessa fibra que define a cor (não a cor "de conector" da porta).
    const entradaPorta = registro.portas && registro.portas[0];
    const fusao = entradaPorta && entradaPorta.fusaoEm && entradaPorta.fusaoEm.dados;
    const fibra = fusao ? corDaFibra(fusao.fibra) : null;

    res.status(200).json({ok: true, splitter, fibra});
  } catch (e) {
    console.error(`geogridEquipamento falhou pro item ${id}:`, e);
    res.status(500).json({erro: String(e.message || e)});
  }
};
