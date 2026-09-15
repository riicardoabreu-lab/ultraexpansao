const {getDb, carregarPastas, sincronizarPaginaTipo, TIPOS_SINCRONIZADOS} = require('./_lib/geogrid');

// Disparado pelo Vercel Cron (ver vercel.json) todo dia às 7:30 (America/Fortaleza).
// A Vercel autentica automaticamente com "Authorization: Bearer $CRON_SECRET" -
// não precisa (nem deve) expor segredo nenhum na URL do cron.
//
// Pagina internamente (tipo por tipo, página por página) respeitando um
// orçamento de tempo - a versão antiga (sincronizarTipos inteiro numa
// chamada só) estourava o tempo de execução no meio do caminho com a conta
// maior (Jebnet + Infolink), sem terminar nenhum tipo.
//
// Retoma de um cursor salvo (mapa_rede_meta/cron_cursor) em vez de sempre
// recomeçar do primeiro tipo ("terminal", o maior - 28+ páginas): sem isso,
// um dia sempre gastaria o orçamento inteiro nele e tipos menores como
// "reserva" nunca chegariam a ser sincronizados. Assim, se um dia não dá
// tempo de terminar tudo (ou a cota do Firestore acabar no meio - ver
// RESOURCE_EXHAUSTED nos logs), o dia seguinte continua de onde parou.
const ORCAMENTO_MS = 45 * 1000; // margem de segurança dentro dos 60s da função

module.exports = async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({erro: 'não autorizado'});
    return;
  }

  const inicio = Date.now();
  const db = getDb();
  const cursorRef = db.collection('mapa_rede_meta').doc('cron_cursor');

  const cursorSnap = await cursorRef.get();
  let tipoIndex = (cursorSnap.exists && cursorSnap.data().tipoIndex) || 0;
  let pagina = (cursorSnap.exists && cursorSnap.data().pagina) || 1;
  if (tipoIndex >= TIPOS_SINCRONIZADOS.length) tipoIndex = 0;

  const resumo = {};
  let totalGravados = 0;
  let parouPorTempo = false;

  try {
    const pastaInfo = await carregarPastas();

    while (tipoIndex < TIPOS_SINCRONIZADOS.length) {
      const tipo = TIPOS_SINCRONIZADOS[tipoIndex];
      let totalTipo = 0;
      for (;;) {
        if (Date.now() - inicio > ORCAMENTO_MS) { parouPorTempo = true; break; }
        const r = await sincronizarPaginaTipo(tipo, pagina, pastaInfo);
        totalTipo = r.totalTipo;
        totalGravados += r.gravados;
        if (!r.temMais) break;
        pagina++;
      }
      resumo[tipo] = {totalTipo, ateAPagina: pagina};
      if (parouPorTempo) break;
      tipoIndex++;
      pagina = 1;
    }

    // Terminou tudo (chegou ao fim da lista de tipos) - volta o cursor pro
    // início pra amanhã fazer uma rodada de reconciliação completa de novo.
    const proximoTipoIndex = tipoIndex >= TIPOS_SINCRONIZADOS.length ? 0 : tipoIndex;
    const proximaPagina = tipoIndex >= TIPOS_SINCRONIZADOS.length ? 1 : pagina;
    await cursorRef.set({tipoIndex: proximoTipoIndex, pagina: proximaPagina, atualizadoEm: Date.now()});

    console.log('geogridCronSync concluído:', JSON.stringify({resumo, totalGravados, parouPorTempo, proximoTipoIndex, proximaPagina}));
    res.status(200).json({ok: true, resumo, totalGravados, parouPorTempo, continuaEm: {tipo: TIPOS_SINCRONIZADOS[proximoTipoIndex], pagina: proximaPagina}});
  } catch (e) {
    console.error('geogridCronSync falhou:', e);
    res.status(500).json({erro: String(e.message || e), resumoParcial: resumo, totalGravadosParcial: totalGravados});
  }
};

module.exports.config = {maxDuration: 60};
