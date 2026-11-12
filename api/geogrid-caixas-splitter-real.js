const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Diagnóstico pontual (não grava nada): pra cada caixa de atendimento da
// Infolink, consulta GET /equipamentos/itemRede/{id}/portas (equipamento real
// instalado, via atendimento[]=S + modoProjeto[]=N) e extrai o splitter de
// verdade (1x8, 1x16...) dos dados do equipamento - mais confiável que o
// texto livre do campo "observacao" (usado em geogrid-infolink-splitters.js).
// Usa o mesmo token à parte (GEOGRID_API_KEY_DIAG, só em preview/branch).
async function geogridFetch(path, token, tentativa = 1) {
  const res = await fetch(`${GEOGRID_BASE}${path}`, {headers: {'api-key': token}});
  if (res.status === 429 && tentativa <= 15) {
    const espera = Math.min(tentativa * 3000, 20000);
    console.log(`GEOGRID_429 path=${path} tentativa=${tentativa} esperando=${espera}ms`);
    await new Promise(r => setTimeout(r, espera));
    return geogridFetch(path, token, tentativa + 1);
  }
  if (!res.ok) throw new Error(`GeoGrid ${path} -> HTTP ${res.status}`);
  return res.json();
}

function normalizar(txt) {
  return (txt || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Mesmo critério de exclusão do geogrid-infolink-splitters.js: a conta não
// tem pasta "Infolink" - ela é a dona "padrão" (pastas de cidade direto
// embaixo de "Raiz"). Jebnet/Dnet/GigaNet/CLIENTES-LINKS são excluídos.
const RAIZES_NAO_INFOLINK = [
  'jebnet', 'dnet', 'giganet', 'clientes-links', 'clientes ptp',
  'palmares', 'pernambuco', 'teste',
];
function ehRaizNaoInfolink(nome) {
  const n = normalizar(nome);
  return RAIZES_NAO_INFOLINK.some(r => n.includes(r));
}

async function carregarPastasInfolink(token) {
  const mapa = new Map();
  const porNome = new Map();
  let pagina = 1;
  for (;;) {
    const dados = await geogridFetch(`/pastas?pagina=${pagina}&registrosPorPagina=200`, token);
    for (const p of dados.registros || []) {
      mapa.set(String(p.id), {nome: p.nome, nomePai: p.nomePai});
      porNome.set(p.nome, {nome: p.nome, nomePai: p.nomePai});
    }
    const total = parseInt(dados.totalRegistros, 10) || 0;
    if (pagina * 200 >= total || !dados.registros || dados.registros.length === 0) break;
    pagina++;
    await new Promise(r => setTimeout(r, 350));
  }

  function ehInfolink(id) {
    let atual = mapa.get(id);
    let passos = 0;
    while (atual && passos < 20) {
      if (ehRaizNaoInfolink(atual.nome)) return false;
      if (atual.nomePai == null) return false;
      if (ehRaizNaoInfolink(atual.nomePai)) return false;
      if (normalizar(atual.nomePai) === 'raiz') return true;
      const pai = porNome.get(atual.nomePai);
      if (!pai) return true;
      atual = pai;
      passos++;
    }
    return true;
  }

  const idsInfolink = new Set();
  for (const id of mapa.keys()) {
    if (ehInfolink(id)) idsInfolink.add(id);
  }
  return {mapa, idsInfolink};
}

// Varre o objeto de equipamento procurando uma string tipo "1x8"/"1X16" em
// qualquer campo de texto (robusto a não sabermos o nome exato do campo até
// ver uma resposta real - por isso o modo ?amostra= abaixo mostra o JSON cru
// de um item antes de confiar nessa extração em massa).
function extrairSplitterDoEquipamento(registro) {
  const candidatos = [];
  const visitar = (obj, profundidade) => {
    if (!obj || profundidade > 4) return;
    if (typeof obj === 'string') { candidatos.push(obj); return; }
    if (typeof obj !== 'object') return;
    for (const v of Object.values(obj)) visitar(v, profundidade + 1);
  };
  visitar(registro.dados, 0);
  for (const texto of candidatos) {
    const m = String(texto).match(/\b(\d+)\s*x\s*(\d+)\b/i);
    if (m) return `${m[1]}x${m[2]}`;
  }
  return null;
}

module.exports = async function handler(req, res) {
  const token = process.env.GEOGRID_API_KEY_DIAG;
  if (!token) {
    res.status(500).json({erro: 'GEOGRID_API_KEY_DIAG não configurada'});
    return;
  }

  try {
    const {mapa: pastaInfo, idsInfolink} = await carregarPastasInfolink(token);

    const tipo = (req.query && req.query.tipo) || 'terminal';
    const pagina = parseInt((req.query && req.query.pagina) || '1', 10);
    const porPagina = parseInt((req.query && req.query.porPagina) || '500', 10);
    const amostra = req.query && req.query.amostra === '1';
    const atendimento = (req.query && req.query.atendimento) || 'S';
    const modoProjeto = (req.query && req.query.modoProjeto) || 'N';

    const listaDados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=${porPagina}`, token);
    const registros = listaDados.registros || [];
    const totalCaixasNaConta = parseInt(listaDados.totalRegistros, 10) || 0;
    const totalPaginas = Math.ceil(totalCaixasNaConta / porPagina) || 0;

    const caixasInfolink = registros.filter(item => {
      const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
      return pastaId != null && idsInfolink.has(String(pastaId));
    });

    if (amostra) {
      const alvo = caixasInfolink[0];
      if (!alvo) {
        res.status(200).json({ok: true, aviso: 'nenhuma caixa Infolink nesta página pra amostrar'});
        return;
      }
      const idItemRede = alvo.dados && alvo.dados.id;
      const bruto = await geogridFetch(
        `/equipamentos/itemRede/${idItemRede}/portas?atendimento[]=${atendimento}&modoProjeto[]=${modoProjeto}`,
        token
      );
      res.status(200).json({ok: true, sigla: alvo.dados && alvo.dados.sigla, idItemRede, respostaCrua: bruto});
      return;
    }

    const splitterCount = {};
    const exemplos = [];
    let semEquipamento = 0;
    for (const item of caixasInfolink) {
      const d = item.dados || {};
      const idItemRede = d.id;
      let splitter = null;
      try {
        const equip = await geogridFetch(
          `/equipamentos/itemRede/${idItemRede}/portas?atendimento[]=${atendimento}&modoProjeto[]=${modoProjeto}`,
          token
        );
        const registrosEquip = equip.registros || [];
        for (const r of registrosEquip) {
          splitter = extrairSplitterDoEquipamento(r);
          if (splitter) break;
        }
      } catch (e) {
        console.log(`GEOGRID_EQUIP_ERRO idItemRede=${idItemRede} erro=${e.message}`);
      }
      if (!splitter) semEquipamento++;
      const chave = splitter || '(sem equipamento de atendimento)';
      splitterCount[chave] = (splitterCount[chave] || 0) + 1;
      const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
      const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;
      exemplos.push({sigla: d.sigla || null, splitter, localidade: folder ? folder.nome : null});
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`GEOGRID_CAIXAS_EQUIP_OK pagina=${pagina} caixasInfolinkNaPagina=${caixasInfolink.length} semEquipamento=${semEquipamento}`);
    res.status(200).json({
      ok: true, pagina, totalPaginas, totalCaixasNaConta,
      caixasInfolinkNaPagina: caixasInfolink.length, semEquipamento,
      splitterCount, exemplos,
    });
  } catch (e) {
    console.error('geogridCaixasSplitterReal falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 300};
