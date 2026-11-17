const admin = require('firebase-admin');
const { JWT } = require('google-auth-library');

// Planilha "PRODUÇÃO DIÁRIA EQUIPE EXPANSAO" (substituída pelo app, mas o
// usuário ainda quer ela preenchida automaticamente pra quem só acompanha
// por ali). Equipe "Gutembergue" = coluna C ("Equipe 1"), "Yan" = coluna D
// ("Equipe 2"), "Felipe" = coluna E ("Equipe 3", inserida em 16/11/26 quando
// essa equipe entrou) - nomes fixos combinados com o usuário; se as equipes
// forem renomeadas no app, atualizar este mapa. Bairro/atividade combinado
// das equipes vai pra coluna F (empurrada quando a coluna E foi inserida).
const SPREADSHEET_ID = '12jcrDCRVm-E9lV9euPTzQIXuhZlJaW7QADw3lLu1m-c';
const SHEET_NAME = 'Página1';
const COLUNA_POR_EQUIPE = { 'Gutembergue': 'C', 'Yan': 'D', 'Felipe': 'E' };
const COLUNA_BAIRRO = 'F';
const STATUS_PLANILHA = { folga: 'FOLGA', feriado: 'FERIADO', dayoff: 'Day Off', atestado: 'ATESTADO', outro: 'OUTRO' };

// Mesmo padrão de api/_lib/geogrid.js (FIREBASE_SERVICE_ACCOUNT_B64 é o
// .json da service account inteiro, em base64) - reaproveitada aqui pra
// autenticar também na Sheets API (é uma service account comum do GCP,
// não é "exclusiva" do Firebase), evitando criar uma segunda credencial.
function carregarCredencial() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
}

let dbSingleton = null;
function getDb() {
  if (!dbSingleton) {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(carregarCredencial()) });
    dbSingleton = admin.firestore();
  }
  return dbSingleton;
}

let jwtSingleton = null;
function getSheetsAuth() {
  if (!jwtSingleton) {
    const cred = carregarCredencial();
    jwtSingleton = new JWT({ email: cred.clientEmail, key: cred.privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  return jwtSingleton;
}

async function sheetsGet(auth, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const { data } = await auth.request({ url, method: 'GET' });
  return data.values || [];
}

async function sheetsBatchUpdate(auth, updates) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  await auth.request({ url, method: 'POST', data: { valueInputOption: 'USER_ENTERED', data: updates } });
}

// Aceita "DD/MM/YYYY" e "DD/MM/YY" (a planilha tem os dois formatos
// misturados - ver histórico x linhas recentes).
function parseDataCelula(txt) {
  const m = (txt || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo}-${d}`;
}

// Busca por valor exato na coluna A em vez de calcular a linha por
// aritmética de data - a planilha pode ter linhas puladas/inconsistentes
// entre o histórico antigo e o trecho recente, então calcular por offset
// seria arriscado (escrever na linha errada).
async function encontrarLinha(auth, dataISO) {
  const coluna = await sheetsGet(auth, `${SHEET_NAME}!A2:A1000`);
  for (let i = 0; i < coluna.length; i++) {
    if (parseDataCelula(coluna[i][0]) === dataISO) return i + 2;
  }
  return null;
}

async function sincronizarData(auth, dataISO) {
  const snap = await getDb().collection('producao_equipe').doc(dataISO).get();
  if (!snap.exists) return { ok: false, motivo: 'dia não encontrado no Firestore' };
  const equipes = snap.data().equipes || {};

  const linha = await encontrarLinha(auth, dataISO);
  if (!linha) return { ok: false, motivo: `data ${dataISO} não encontrada na coluna A da planilha` };

  const updates = [];
  const bairros = [];
  for (const [nomeEquipe, col] of Object.entries(COLUNA_POR_EQUIPE)) {
    const e = equipes[nomeEquipe];
    if (!e) continue; // não lançado ainda - não sobrescreve o que já está na planilha
    const valor = e.tipo === 'numero' ? (Number(e.valor) || 0) : (STATUS_PLANILHA[e.tipo] || '');
    updates.push({ range: `${SHEET_NAME}!${col}${linha}`, values: [[valor]] });
    if (e.bairro) bairros.push(e.bairro);
  }
  if (bairros.length) updates.push({ range: `${SHEET_NAME}!${COLUNA_BAIRRO}${linha}`, values: [[bairros.join(' / ')]] });
  if (!updates.length) return { ok: false, motivo: 'nenhuma equipe mapeada (Gutembergue/Yan) lançada nesse dia' };

  await sheetsBatchUpdate(auth, updates);
  return { ok: true, linha, colunasAtualizadas: updates.map(u => u.range) };
}

module.exports = async (req, res) => {
  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
    // GET com querystring (?data=... ou ?backfillAll=1) também dispara o
    // sync - além do POST chamado pelo app a cada salvamento, serve pra
    // testar/forçar manualmente direto pela URL (sem corpo de requisição).
    const params = { ...req.query, ...body };

    if (req.method === 'GET' && !params.data && !params.backfillAll && !params.addTeam && !params.removerFantasma) {
      // Só pra configuração inicial: descobrir o e-mail da service account
      // pra compartilhar a planilha como Editor com ela. Não expõe a chave privada.
      res.status(200).json({ clientEmail: carregarCredencial().clientEmail });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

    // Ação administrativa avulsa (não é sync com a planilha) - adiciona
    // uma equipe nova em producao_equipe_config/times, equivalente ao botão
    // "+ Nova equipe" do painel Equipes. Colocada aqui (em vez de um arquivo
    // api/*.js novo) pra não gastar a vaga que falta pro limite de 12
    // Serverless Functions do plano Hobby da Vercel.
    if (params.addTeam) {
      const ref = getDb().collection('producao_equipe_config').doc('times');
      const snap = await ref.get();
      const nomes = snap.exists ? (snap.data().nomes || []) : ['Equipe 1', 'Equipe 2'];
      if (!nomes.includes(params.addTeam)) nomes.push(params.addTeam);
      await ref.set({ nomes });
      res.status(200).json({ ok: true, nomes });
      return;
    }

    // Limpeza pontual: remove equipes.<nome> de todos os dias - usado pra
    // apagar o lançamento fantasma "produção 0" que o bug do formulário
    // "Preencher dia" gravava pra equipe recém-criada em qualquer dia que
    // outra equipe salvasse (ver fix no commit que resolveu isso). Só
    // remove se o valor bater exatamente com a assinatura do fantasma
    // (numero, valor vazio/0, sem bairro) - não mexe num lançamento real.
    if (params.removerFantasma) {
      const nome = params.removerFantasma;
      const snaps = await getDb().collection('producao_equipe').get();
      const removidos = [];
      for (const doc of snaps.docs) {
        const e = (doc.data().equipes || {})[nome];
        if (e && e.tipo === 'numero' && !(Number(e.valor) || 0) && !e.bairro) {
          await doc.ref.update({ [`equipes.${nome}`]: admin.firestore.FieldValue.delete() });
          removidos.push(doc.id);
        }
      }
      res.status(200).json({ ok: true, removidos });
      return;
    }

    const auth = getSheetsAuth();

    if (params.backfillAll) {
      const snaps = await getDb().collection('producao_equipe').get();
      const resultados = [];
      for (const doc of snaps.docs) resultados.push({ data: doc.id, ...(await sincronizarData(auth, doc.id)) });
      res.status(200).json({ ok: true, resultados });
      return;
    }

    if (!params.data) { res.status(400).json({ error: 'informe "data" (YYYY-MM-DD)' }); return; }
    res.status(200).json(await sincronizarData(auth, params.data));
  } catch (err) {
    console.error('producao-equipe-sheets-sync falhou:', err);
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
