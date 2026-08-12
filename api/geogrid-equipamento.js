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
// Antes só a página do mapa-campo tinha senha (protege a tela, não a API) - quem
// descobrisse essa URL conseguia consultar splitter/fibra de qualquer CTO sem
// nunca passar pela senha. Agora exige um token fixo (MAPA_CAMPO_TOKEN) que o
// front só manda depois de validar a senha - mesmo nível de proteção (afasta
// acesso casual/roteiro automático, não é criptografia de verdade), mas fecha
// o acesso direto via URL.
module.exports = async function handler(req, res) {
  if (req.headers['x-mapa-campo-token'] !== process.env.MAPA_CAMPO_TOKEN) {
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
    const registros = dados.registros || [];
    if (!registros.length) {
      res.status(200).json({ok: true, splitter: null, fibra: null});
      return;
    }

    // Quando tem splitter em cascata (ex.: um 1x2 alimentando um 1x8), cada
    // "registro" é um equipamento diferente vinculado à mesma CTO. O que interessa
    // pra "qual fibra alimenta essa caixa" é o que está fundido direto num CABO
    // (fusaoEm.dados.idCabo) - os outros têm a entrada fundida na SAÍDA de outro
    // equipamento (fusaoEm.dados.idEquipamento), ou seja, são estágios internos.
    const fusaoDoRegistro = (r) => {
      const entradaPorta = r.portas && r.portas[0];
      return entradaPorta && entradaPorta.fusaoEm && entradaPorta.fusaoEm.dados;
    };
    const registroDeEntrada = registros.find(r => {
      const fusao = fusaoDoRegistro(r);
      return fusao && fusao.idCabo;
    }) || registros[0];

    const tipoDados = registroDeEntrada.tipo && registroDeEntrada.tipo.dados;
    const descricao = (tipoDados && tipoDados.descricao) || null;
    const m = descricao && descricao.match(/(\d+\s*x\s*\d+)/i);
    const splitter = m ? m[1].replace(/\s+/g, '') : descricao;

    const fusao = fusaoDoRegistro(registroDeEntrada);
    const fibra = fusao ? corDaFibra(fusao.fibra) : null;

    res.status(200).json({ok: true, splitter, fibra});
  } catch (e) {
    console.error(`geogridEquipamento falhou pro item ${id}:`, e);
    res.status(500).json({erro: String(e.message || e)});
  }
};
