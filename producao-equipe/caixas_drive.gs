/**
 * CAIXAS -> DRIVE  (Google Apps Script)
 * Recebe caixa + ate 3 fotos do app, numera sozinho (a partir de 25000),
 * salva as fotos no Drive como 25000.jpg, 25000 (2).jpg, 25000 (3).jpg
 * e registra a caixa numa planilha.
 *
 * Instalar: script.google.com > Novo projeto > colar tudo > Implantar >
 * Nova implantacao > Aplicativo da Web > Executar como: EU > Acesso: Qualquer pessoa.
 * Copie a URL /exec e cole no caixa.html (constante API).
 */
// Caixas do KMZ da IP2 ja ocupam 25000 a 26455; as NOVAS comecam em 26456.
var NUMERO_EXISTENTE_MIN = 25000;
var NUMERO_INICIAL = 26456;
var CHAVE = 'troque-esta-chave';   // mesma chave no caixa.html

function props_() { return PropertiesService.getScriptProperties(); }

function pasta_() {
  var p = props_(), id = p.getProperty('PASTA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Caixas - Fotos');
  p.setProperty('PASTA', f.getId());
  return f;
}

// Pasta por projeto: sem projeto = pasta raiz 'Caixas - Fotos'; IP2 Fortaleza = 'fotos IP2 Fortaleza';
// Connect = 'Fotos Connect'; qualquer outro projeto = 'Fotos <projeto>'.
function pastaProjeto_(projeto) {
  var raiz = pasta_(), pj = String(projeto || '').trim();
  if (!pj) return raiz;
  var nome = /connect/i.test(pj) ? 'Fotos Connect' : (/ip2/i.test(pj) && /fortaleza/i.test(pj)) ? 'fotos IP2 Fortaleza' : 'Fotos ' + pj.replace(/[\\\/:*?"<>|\r\n]+/g, ' ').trim().substring(0, 60);
  var key = 'PASTA_' + nome, p = props_(), id = p.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = raiz.getFoldersByName(nome);
  var f = it.hasNext() ? it.next() : raiz.createFolder(nome);
  p.setProperty(key, f.getId());
  return f;
}

function planilha_() {
  var p = props_(), id = p.getProperty('PLANILHA'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) {} }
  if (!ss) {
    ss = SpreadsheetApp.create('Caixas - Cadastro');
    ss.getSheets()[0].setName('Caixas').appendRow(
      ['Numero', 'Data/hora', 'Tecnico', 'Tipo', 'Latitude', 'Longitude', 'Observacao', 'Fotos', 'Link fotos', 'ID']);
    p.setProperty('PLANILHA', ss.getId());
  }
  var sh = ss.getSheetByName('Caixas');
  if (sh.getRange(1, 11).getValue() === '') sh.getRange(1, 11).setValue('Link mapa');
  return sh;
}

// completa o Link mapa das linhas que ainda nao tem (ex.: caixas importadas do KMZ)
function completarLinks_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var v = sh.getRange(2, 5, n, 2).getValues(), k = sh.getRange(2, 11, n, 1).getValues(), mudou = false;
  for (var i = 0; i < n; i++) {
    if (k[i][0] === '' && v[i][0] !== '' && v[i][1] !== '') { k[i][0] = linkMapa_(v[i][0], v[i][1]); mudou = true; }
  }
  if (mudou) sh.getRange(2, 11, n, 1).setValues(k);
}

function linkMapa_(lat, lng) {
  return 'https://www.google.com/maps?q=' + String(lat).replace(',', '.') + ',' + String(lng).replace(',', '.');
}

function saida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var sh = planilha_();
  completarLinks_(sh);
  var n = Math.max(sh.getLastRow() - 1, 0);
  return saida_({ ok: true, caixas: n, pasta: pasta_().getUrl(), planilha: sh.getParent().getUrl() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.chave !== CHAVE) return saida_({ ok: false, erro: 'chave' });
    lock.waitLock(30000);
    var sh = planilha_();

    // idempotencia: se o celular reenviar a mesma caixa, devolve o numero ja dado
    var last = sh.getLastRow();
    if (last > 1) {
      var ids = sh.getRange(2, 10, last - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) {
        if (ids[i][0] === d.id) {
          return saida_({ ok: true, numero: sh.getRange(i + 2, 1).getValue(), repetido: true });
        }
      }
    }

    var p = props_();
    // Observacao comecando com um numero ja existente (ex.: "25123" ou "25123 - Rua X")
    // = foto de caixa que ja existe: usa esse numero e NAO gasta numero novo.
    var mm = String(d.obs || '').match(/^\s*(\d{5})(?!\d)/);
    var exist = mm ? parseInt(mm[1], 10) : 0;
    var num;
    var numTxt = String(d.numeroTexto || '').trim();
    if (numTxt) {
      // foto de ponto do mapa KMZ: usa o numero/nome do proprio ponto e NAO gasta numero novo
      num = numTxt;
    } else if (exist >= NUMERO_EXISTENTE_MIN && exist < NUMERO_INICIAL) {
      num = exist;
    } else {
      num = Math.max(parseInt(p.getProperty('PROX') || '0', 10), NUMERO_INICIAL);
      p.setProperty('PROX', String(num + 1));
    }

    var pasta = pastaProjeto_(d.projeto), links = [], fotos = d.fotos || [];
    var porProjeto = pasta.getId() !== pasta_().getId();
    // nome do arquivo = o que o tecnico digitou em Observacao (sem caracteres proibidos); sem texto, usa o numero
    var base = String(d.obs || '').replace(/[\\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80) || String(num);
    // projeto com pasta propria (Connect...): arquivo = numero da caixa (26500.jpg, 26500 (2).jpg),
    // igual as fotos extraidas do KMZ; se ja existe, continua a sequencia (2), (3)...
    if (porProjeto && /^\d{5,12}$/.test(String(num))) base = String(num);
    var seq = 0;
    for (var k = 0; k < fotos.length && k < 3; k++) {
      var nome;
      do { seq++; nome = base + (seq === 1 ? '' : ' (' + seq + ')') + '.jpg'; }
      while (porProjeto && pasta.getFilesByName(nome).hasNext());
      var blob = Utilities.newBlob(Utilities.base64Decode(fotos[k]), 'image/jpeg', nome);
      links.push(pasta.createFile(blob).getUrl());
    }
    sh.appendRow([num, new Date(), d.tecnico || '', d.tipo || '', d.lat || '', d.lng || '',
                  d.obs || '', links.length, links.join('\n'), d.id,
                  (d.lat !== undefined && d.lat !== '') ? linkMapa_(d.lat, d.lng) : '']);
    return saida_({ ok: true, numero: num, fotos: links.length });
  } catch (err) {
    return saida_({ ok: false, erro: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
