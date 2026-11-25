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

function planilha_() {
  var p = props_(), id = p.getProperty('PLANILHA'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) {} }
  if (!ss) {
    ss = SpreadsheetApp.create('Caixas - Cadastro');
    ss.getSheets()[0].setName('Caixas').appendRow(
      ['Numero', 'Data/hora', 'Tecnico', 'Tipo', 'Latitude', 'Longitude', 'Observacao', 'Fotos', 'Link fotos', 'ID']);
    p.setProperty('PLANILHA', ss.getId());
  }
  return ss.getSheetByName('Caixas');
}

function saida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var sh = planilha_(), n = Math.max(sh.getLastRow() - 1, 0);
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
    if (exist >= NUMERO_EXISTENTE_MIN && exist < NUMERO_INICIAL) {
      num = exist;
    } else {
      num = Math.max(parseInt(p.getProperty('PROX') || '0', 10), NUMERO_INICIAL);
      p.setProperty('PROX', String(num + 1));
    }

    var pasta = pasta_(), links = [], fotos = d.fotos || [];
    // nome do arquivo = o que o tecnico digitou em Observacao (sem caracteres proibidos); sem texto, usa o numero
    var base = String(d.obs || '').replace(/[\\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80) || String(num);
    for (var k = 0; k < fotos.length && k < 3; k++) {
      var nome = base + (k === 0 ? '' : ' (' + (k + 1) + ')') + '.jpg';
      var blob = Utilities.newBlob(Utilities.base64Decode(fotos[k]), 'image/jpeg', nome);
      links.push(pasta.createFile(blob).getUrl());
    }
    sh.appendRow([num, new Date(), d.tecnico || '', d.tipo || '', d.lat || '', d.lng || '',
                  d.obs || '', links.length, links.join('\n'), d.id]);
    return saida_({ ok: true, numero: num, fotos: links.length });
  } catch (err) {
    return saida_({ ok: false, erro: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
