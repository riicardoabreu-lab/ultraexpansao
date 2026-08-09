const admin = require('firebase-admin');

// Conta "alencar" no GeoGrid (Jebnet). Não é segredo por si só - só funciona com o api-key.
const GEOGRID_BASE = 'https://eros.geogridmaps.com.br/alencar/api/v3';

// Tipos de item de rede que viram ponto no mapa. Fora: "reserva" (reserva de porta,
// não é um ponto físico), "grupoAcesso" (conta 0 registros nesta conta) e "poste"
// (muito numeroso - 4300+ - e não é o que os técnicos precisam localizar em campo).
const TIPOS_SINCRONIZADOS = ['terminal', 'caixa', 'rack', 'estacao', 'pontoAcesso', 'interesse'];

let dbSingleton = null;
function getDb() {
  if (!dbSingleton) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        }),
      });
    }
    dbSingleton = admin.firestore();
  }
  return dbSingleton;
}

async function geogridFetch(path) {
  const res = await fetch(`${GEOGRID_BASE}${path}`, {
    headers: {'api-key': process.env.GEOGRID_API_KEY},
  });
  if (!res.ok) {
    throw new Error(`GeoGrid ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

// Busca todas as pastas (só 75 hoje) e monta id -> {nome, nomePai}, pra resolver
// localidade (pasta do item) e município (pasta-mãe) sem precisar de outra chamada.
async function carregarPastas() {
  const mapa = new Map();
  let pagina = 1;
  for (;;) {
    const dados = await geogridFetch(`/pastas?pagina=${pagina}&registrosPorPagina=200`);
    for (const p of dados.registros || []) {
      mapa.set(String(p.id), {nome: p.nome, nomePai: p.nomePai});
    }
    const total = parseInt(dados.totalRegistros, 10) || 0;
    if (pagina * 200 >= total || !dados.registros || dados.registros.length === 0) break;
    pagina++;
  }
  return mapa;
}

// Normaliza um item (seja do retorno de /itensRede - tem "pasta": {id,...} -
// ou de /itensRede/{id}/mapa - tem só "idPasta") pro doc que vai pro Firestore.
function montarDoc(item, pastaInfo) {
  const dados = item.dados || {};
  const pastaId = (item.pasta && item.pasta.id) || item.idPasta || null;
  const folder = pastaId != null ? pastaInfo.get(String(pastaId)) : null;

  const doc = {
    item: dados.item || null,
    sigla: dados.sigla || null,
    latitude: dados.latitude != null ? Number(dados.latitude) : null,
    longitude: dados.longitude != null ? Number(dados.longitude) : null,
    municipio: (folder && folder.nomePai) || null,
    localidade: (folder && folder.nome) || null,
    status: dados.status || null,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (dados.item === 'terminal') {
    const m = (dados.sigla || '').match(/\d+/);
    doc.numero = m ? parseInt(m[0], 10) : null;
  }

  return doc;
}

// Varre os tipos informados na API do GeoGrid e grava cada item em mapa_rede/{id}.
// Usada tanto pelo endpoint manual (geogrid-full-sync) quanto pelo cron diário.
async function sincronizarTipos(tipos) {
  const db = getDb();
  const pastaInfo = await carregarPastas();

  const resumo = {};
  let totalGravados = 0;

  for (const tipo of tipos) {
    let pagina = 1;
    let totalTipo = 0;

    for (;;) {
      const dados = await geogridFetch(`/itensRede?item[]=${tipo}&pagina=${pagina}&registrosPorPagina=500`);
      const registros = dados.registros || [];
      totalTipo = parseInt(dados.totalRegistros, 10) || 0;

      for (let i = 0; i < registros.length; i += 500) {
        const lote = registros.slice(i, i + 500);
        const batch = db.batch();
        for (const item of lote) {
          const id = item.dados && item.dados.id;
          if (!id) continue;
          batch.set(db.collection('mapa_rede').doc(String(id)), montarDoc(item, pastaInfo), {merge: true});
          totalGravados++;
        }
        await batch.commit();
      }

      if (registros.length === 0 || pagina * 500 >= totalTipo) break;
      pagina++;
    }

    resumo[tipo] = totalTipo;
  }

  return {resumo, totalGravados};
}

module.exports = {admin, getDb, geogridFetch, carregarPastas, montarDoc, sincronizarTipos, TIPOS_SINCRONIZADOS};
