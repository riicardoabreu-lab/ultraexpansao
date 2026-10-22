const {geogridFetch, carregarPastas, montarLinha, ehJebnet, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Diagnóstico pontual (só leitura, não grava nada) pra preparar o filtro por
// cliente do "mapa do grupo" (Infolink + Dnet + Giga Net Fortaleza + Jebnet).
// Hoje só existe ehJebnet() (região + sigla "CTO-" + número >= 20000) -- tudo
// que não bate com isso é descartado na sincronização normal (geogrid.js:
// "outro cliente da conta -- não grava"), mas nunca foi agrupado/inspecionado
// pra saber o padrão de sigla de cada uma das outras marcas.
//
// Varre um tipo (?tipo=terminal, por ex.) e agrupa só os itens que ehJebnet()
// REJEITA, por município, com total + amostra de siglas -- dá pra ver de cara
// se Infolink/Dnet/Giga Net Fortaleza têm um prefixo de sigla reconhecível
// (ex.: a suspeita antiga em geogrid-diagnostico-cx.js era sigla "CX" pra
// Infolink) e em quais municípios cada uma aparece, pra depois escrever um
// ehInfolink()/ehDnet()/ehGigaNetFortaleza() igual ehJebnet().
//
// Uso: GET /api/geogrid-mapa-grupo-diagnostico?segredo=...&tipo=terminal
// (sem &tipo=, roda "terminal" por padrão -- é o tipo onde a sigla mais
// importa; rode de novo trocando tipo= por "caixa", "rack" etc. se precisar).
module.exports = async function handler(req, res) {
  if (req.query.segredo !== process.env.GEOGRID_SYNC_SECRET) {
    res.status(403).json({erro: 'não autorizado'});
    return;
  }

  const tipo = req.query.tipo || 'terminal';
  if (!TIPOS_SINCRONIZADOS.includes(tipo)) {
    res.status(400).json({erro: `tipo inválido: ${tipo}`, tiposValidos: TIPOS_SINCRONIZADOS});
    return;
  }

  try {
    const pastaInfo = await carregarPastas();
    const pastas = [...pastaInfo.entries()].map(([id, p]) => ({id, nome: p.nome, nomePai: p.nomePai}));

    let pagina = 1;
    let totalTipo = 0;
    let totalJebnet = 0;
    let totalOutros = 0;
    const porMunicipio = new Map(); // município -> {total, siglas: []}

    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;

      for (const item of registros) {
        const id = item.dados && item.dados.id;
        if (!id) continue;
        const linha = montarLinha(item, pastaInfo);
        if (ehJebnet(linha)) { totalJebnet++; continue; }
        totalOutros++;

        const chave = linha.municipio || '(sem município)';
        if (!porMunicipio.has(chave)) porMunicipio.set(chave, {total: 0, siglas: []});
        const info = porMunicipio.get(chave);
        info.total++;
        if (info.siglas.length < 8 && linha.sigla) info.siglas.push(linha.sigla);
      }

      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }

    const naoJebnetPorMunicipio = [...porMunicipio.entries()]
      .map(([municipio, info]) => ({municipio, total: info.total, exemplosSigla: info.siglas}))
      .sort((a, b) => b.total - a.total);

    res.status(200).json({
      ok: true,
      tipo,
      totalTipo,
      totalJebnet,
      totalOutros,
      naoJebnetPorMunicipio,
      totalPastas: pastas.length,
      pastas,
    });
  } catch (e) {
    console.error('geogridMapaGrupoDiagnostico falhou:', e);
    res.status(500).json({erro: String(e.message || e)});
  }
};

module.exports.config = {maxDuration: 60};
