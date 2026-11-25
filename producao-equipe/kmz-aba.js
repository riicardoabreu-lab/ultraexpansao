/* Aba KMZ: escolhe o projeto (provedor), importa um KMZ/KML e mostra no mapa só o que
   pertence àquele projeto. Usado por producao-equipe/index.html e tecnico.html.
   Guarda no Firestore: producao_equipe_provedores/{projeto}/kmz/{meta, p000.., l000..}
   (subcoleção do provedor - já coberta pelas regras de producao_equipe_provedores).
   Depende de: Leaflet (L), JSZip e de window._kmzApi = {carregar, salvar, apagar}. */
(function(){
'use strict';
var CORES = ['#22c55e','#3b82f6','#ef4444','#f59e0b','#a855f7','#ec4899','#14b8a6','#eab308','#f97316','#84cc16','#06b6d4','#94a3b8'];
var LIM_ARQ = 80 * 1024 * 1024;      // KMZ acima disso (com fotos) trava o celular
var LIM_PARTE = 300000;               // caracteres por documento (Firestore: 1 MiB)
var S = { cfg:null, map:null, prov:'', dados:null, grupos:[], marcadores:[], rotulados:[], atual:null, pos:null, montado:false, camadas:{}, base:null, off:{}, abertos:{}, extra:[] };

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function semAcento(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function msg(t, erro){ var el=$('kz-status'); if(el){ el.textContent=t||''; el.style.color = erro ? '#ef4444' : 'var(--mu,#8a8a96)'; } }

// ---------- CSS ----------
function css(){
  if($('kz-css')) return;
  var st=document.createElement('style'); st.id='kz-css';
  st.textContent =
  '.kz-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}'+
  '.kz-top select{background:var(--bg,#0f0f11);border:1px solid var(--b2,rgba(255,255,255,.13));border-radius:10px;padding:10px 12px;color:var(--tx,#f0f0f2);font:inherit;min-width:180px}'+
  '.kz-btn{padding:9px 14px;border-radius:10px;border:1px solid var(--b2,rgba(255,255,255,.13));background:var(--s2,#222228);color:var(--tx,#f0f0f2);font:600 13px inherit;cursor:pointer}'+
  '.kz-btn.pri{background:var(--ac,#6a00b8);border-color:var(--ac,#6a00b8);color:#fff}'+
  '.kz-btn:disabled{opacity:.4;pointer-events:none}'+
  '#kz-status{font-size:12.5px;color:var(--mu,#8a8a96);flex:1;min-width:160px}'+
  '.kz-body{display:grid;grid-template-columns:320px 1fr;gap:10px;position:relative}'+
  '.kz-mapwrap{position:relative;border:1px solid var(--b1,rgba(255,255,255,.07));border-radius:14px;overflow:hidden;background:#111}'+
  '#kz-map{height:68vh;min-height:360px}'+
  '.kz-side{background:var(--s1,#18181c);border:1px solid var(--b1,rgba(255,255,255,.07));border-radius:14px;padding:10px;max-height:68vh;overflow:auto}'+
  '.kz-side input[type=search]{width:100%;background:var(--bg,#0f0f11);border:1px solid var(--b2,rgba(255,255,255,.13));border-radius:9px;padding:9px 11px;color:var(--tx,#f0f0f2);font:inherit;margin-bottom:8px}'+
  '.kz-res{background:var(--s2,#222228);border-radius:9px;margin-bottom:8px;overflow:hidden}'+
  '.kz-res div{padding:8px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--b1,rgba(255,255,255,.07))}'+
  '.kz-pasta{display:flex;align-items:center;gap:8px;padding:7px 4px;font-size:13px;border-bottom:1px solid var(--b1,rgba(255,255,255,.07))}'+
  '.kz-pasta i{width:12px;height:12px;border-radius:3px;flex:none}'+
  '.kz-pasta span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
  '.kz-pasta small{color:var(--mu,#8a8a96)}'+
  '#kz-card{position:absolute;left:0;right:0;bottom:0;z-index:1000;background:var(--s1,#18181c);border-top:1px solid var(--b2,rgba(255,255,255,.13));padding:12px 14px;display:none}'+
  '#kz-card{max-height:75%;overflow:auto}.kz-ef label{display:block;font-size:11.5px;color:var(--mu,#8a8a96);margin:6px 0 2px}.kz-ef input,.kz-ef textarea,.kz-ef select{width:100%;box-sizing:border-box;background:var(--bg,#0f0f11);border:1px solid var(--b2,rgba(255,255,255,.13));border-radius:9px;padding:8px 10px;color:var(--tx,#f0f0f2);font:inherit}'+
  '#kz-card h4{margin:0 0 2px;font-size:15px}#kz-card .p{font-size:11.5px;color:var(--mu,#8a8a96);margin-bottom:6px}'+
  '#kz-card pre{margin:0 0 8px;white-space:pre-wrap;font:12.5px/1.4 inherit;color:var(--tx,#f0f0f2);max-height:90px;overflow:auto}'+
  '#kz-card .acoes{display:flex;gap:8px;flex-wrap:wrap}'+
  '.kz-lbl{background:rgba(0,0,0,.65);color:#fff;border:0;box-shadow:none;font-size:11px;padding:1px 5px}'+
  '.kz-lbl:before{display:none}'+
  '.kz-vazio{padding:3rem 1rem;text-align:center;color:var(--mu,#8a8a96);font-size:13.5px}'+
  '.kz-n{display:flex;align-items:center;gap:6px;padding:8px 6px;margin-bottom:5px;background:var(--s2,#222228);border:1px solid var(--b1,rgba(255,255,255,.07));border-radius:9px;font-size:13px}'+
  '.kz-n .sw{width:6px;align-self:stretch;border-radius:3px;flex:none}'+
  '.kz-n .tx{flex:1;min-width:0;cursor:pointer}.kz-n .tx b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
  '.kz-n .tx small{color:var(--mu,#8a8a96);font-size:11.5px}'+
  '.kz-n .ch{width:26px;height:26px;border:0;background:none;color:var(--tx,#f0f0f2);font-size:15px;cursor:pointer;flex:none}'+
  '.kz-n input{width:18px;height:18px;flex:none}.kz-n input[type=color]{width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}'+
  '.kz-menu{display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 7px 8px}.kz-menu .kz-btn{padding:6px 9px;font-size:12px}'+
  '.kz-fil{margin-left:14px;border-left:2px solid var(--b2,rgba(255,255,255,.13));padding-left:6px}'+
  '#kz-tog{display:none;position:absolute;top:10px;left:56px;z-index:1050}'+
  '.kz-bar{display:none;position:absolute;top:10px;left:10px;z-index:1050;gap:0;background:#f6f0fa;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);overflow:hidden}'+
  '.kz-bar button{width:46px;height:44px;border:0;background:none;font-size:20px;color:#222;cursor:pointer;border-right:1px solid #ddd}.kz-bar button:last-child{border:0}'+
  '#kz-add{position:absolute;right:12px;bottom:18px;z-index:1050;width:58px;height:58px;border-radius:50%;border:0;background:#f6f0fa;color:#222;font-size:22px;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:pointer}'+
  '#kz-cross{display:none;position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;z-index:900;pointer-events:none}'+
  '#kz-pbar{display:none;position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:1060;flex-direction:column;align-items:center;gap:8px}'+
  '#kz-pbar button{min-width:76px;height:52px;border:0;border-radius:10px;background:#f6f0fa;color:#222;font-size:16px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.5);padding:0 14px}'+
  '#kz-pco{background:#f6f0fa;color:#222;border-radius:10px;padding:6px 14px;font-size:13px;text-align:left;box-shadow:0 2px 6px rgba(0,0,0,.5)}'+
  '#kz-card.kz-cardfull{top:0;bottom:0;max-height:none;overflow:auto;padding:16px}'+
  '#kmz-root.kz-full{position:fixed;left:0;top:0;right:0;bottom:0;height:100dvh;z-index:3000;background:var(--bg,#0f0f11);padding:0;margin:0}'+
  '#kmz-root.kz-full .kz-body{display:block;height:100%}'+
  '#kmz-root.kz-full .kz-mapwrap{position:absolute;left:0;top:0;right:0;bottom:0;border:0;border-radius:0}'+
  '#kmz-root.kz-full #kz-map{height:100%;min-height:0}'+
  '#kmz-root.kz-full .kz-side{position:absolute;left:0;top:0;bottom:0;width:88%;max-width:380px;max-height:none;border-radius:0;z-index:3100;display:none;overflow:auto;background:#f6f0fa;color:#222}'+
  '#kmz-root.kz-full .kz-side.aberto{display:block}'+
  '#kmz-root.kz-full .kz-bar{display:flex}'+
  '#kz-bd{display:none;position:absolute;left:0;top:0;right:0;bottom:0;z-index:3050;background:rgba(0,0,0,.35)}.kz-side.aberto + #kz-bd{display:block}'+
  '#kmz-root.kz-full #kz-tog{display:none}#kmz-root.kz-full #kz-sx{display:block!important}'+
  '#kmz-root.kz-full .leaflet-control-zoom{display:none}'+
  '#kmz-root.kz-full .leaflet-top.leaflet-left{top:62px}'+
  '#kmz-root.kz-full .kz-top{display:flex;flex-direction:column;align-items:stretch;margin:0 0 8px}'+
  '#kmz-root.kz-full .kz-top select,#kmz-root.kz-full .kz-side input[type=search]{background:#fff;color:#222;border-color:#ccc}'+
  '#kmz-root.kz-full .kz-btn{background:#e8dff0;color:#222;border-color:#d4c6e0}'+
  '#kmz-root.kz-full .kz-btn.pri{background:var(--ac,#6a00b8);color:#fff}'+
  '#kmz-root.kz-full #kz-status{color:#555!important}'+
  '#kmz-root.kz-full .kz-n{background:#fff;color:#222;border-color:#ddd}#kmz-root.kz-full .kz-n .tx small{color:#666}#kmz-root.kz-full .kz-n .ch{color:#222}'+
  '#kmz-root.kz-full .kz-res{background:#fff;color:#222}#kmz-root.kz-full .kz-vazio{color:#666}'+
  '@media(max-width:760px){.kz-body{grid-template-columns:1fr}#kz-map{height:62vh}'+
  '.kz-side{position:absolute;left:0;top:0;bottom:0;width:88%;max-height:none;z-index:1100;display:none;box-shadow:4px 0 18px rgba(0,0,0,.5)}.kz-side.aberto{display:block}#kz-tog{display:block}}';
  document.head.appendChild(st);
}

// ---------- parse KML/KMZ ----------
function dec(s){ var t=document.createElement('textarea'); t.innerHTML=s; return t.value; }
function limpar(s){
  if(!s) return '';
  var t=String(s), i, u;
  for(i=0;i<4;i++){ u=dec(t); if(u===t) break; t=u; }
  t=t.replace(/<img[^>]*>/gi,'').replace(/<\/(pre|p|div|li|tr)>|<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'');
  t=dec(t);
  return t.split('\n').map(function(x){return x.trim();}).filter(Boolean).join('\n').slice(0,400);
}
function filhoTexto(el, tag){
  for(var i=0;i<el.children.length;i++) if(el.children[i].localName===tag) return (el.children[i].textContent||'').trim();
  return '';
}
function coords(txt){
  var out=[], partes=(txt||'').trim().split(/\s+/);
  for(var i=0;i<partes.length;i++){
    var c=partes[i].split(','), lng=parseFloat(c[0]), lat=parseFloat(c[1]);
    if(isFinite(lat)&&isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180) out.push([+lat.toFixed(6),+lng.toFixed(6)]);
  }
  return out;
}
function lerKml(txt){
  var xml=new DOMParser().parseFromString(txt,'application/xml');
  if(xml.getElementsByTagName('parsererror').length) throw new Error('Arquivo KML inválido');
  var pastas=[], idx={}, pts=[], lns=[], ignorados=0;
  function ip(p){ if(!(p in idx)){ idx[p]=pastas.length; pastas.push(p); } return idx[p]; }
  function placemark(el, path){
    var nome=filhoTexto(el,'name'), desc=limpar(filhoTexto(el,'description')), n=0;
    var pts_=el.getElementsByTagName('Point');
    for(var i=0;i<pts_.length;i++){
      var c=coords(pts_[i].getElementsByTagName('coordinates')[0] ? pts_[i].getElementsByTagName('coordinates')[0].textContent : '');
      if(c.length){ var m=/^\s*(\d{5})(?!\d)/.exec(nome); pts.push([m?m[1]:'', nome, c[0][0], c[0][1], ip(path||'(sem pasta)'), desc]); n++; }
    }
    var ls=el.getElementsByTagName('LineString');
    for(var j=0;j<ls.length;j++){
      var cc=coords(ls[j].getElementsByTagName('coordinates')[0] ? ls[j].getElementsByTagName('coordinates')[0].textContent : '');
      if(cc.length>1){ lns.push([ip(path||'(sem pasta)'), nome, cc]); n++; }
    }
    if(!n) ignorados++;
  }
  function walk(no, path){
    for(var i=0;i<no.children.length;i++){
      var el=no.children[i], t=el.localName;
      if(t==='Folder'||t==='Document'){ var nm=filhoTexto(el,'name'); walk(el, nm ? (path? path+'/'+nm : nm) : path); }
      else if(t==='Placemark') placemark(el, path);
    }
  }
  var raiz=xml.documentElement;
  for(var i=0;i<raiz.children.length;i++){
    var el=raiz.children[i];
    if(el.localName==='Document'||el.localName==='Folder') walk(el,''); else if(el.localName==='Placemark') placemark(el,'');
  }
  return { pastas:pastas, pts:pts, lns:lns, ignorados:ignorados };
}
function lerArquivo(file){
  if(file.size > LIM_ARQ) return Promise.reject(new Error('Arquivo muito grande ('+Math.round(file.size/1048576)+' MB). Use o KMZ leve, sem fotos.'));
  var nome=(file.name||'').toLowerCase();
  if(nome.slice(-4)==='.kml') return file.text().then(lerKml);
  return JSZip.loadAsync(file).then(function(z){
    var kml=null; z.forEach(function(p,f){ if(!f.dir && /\.kml$/i.test(p) && (!kml || /(^|\/)doc\.kml$/i.test(p))) kml=f; });
    if(!kml) throw new Error('Não achei nenhum .kml dentro do KMZ');
    return kml.async('string').then(lerKml);
  });
}

// ---------- gravação (partes pequenas) ----------
function partir(tipo, itens){
  var partes=[], atual=[], tam=0;
  itens.forEach(function(it){
    var l=JSON.stringify(it).length;
    if(atual.length && tam+l>LIM_PARTE){ partes.push(atual); atual=[]; tam=0; }
    atual.push(it); tam+=l;
  });
  if(atual.length) partes.push(atual);
  return partes.map(function(d,i){ return { id: tipo+('000'+i).slice(-3), d:d }; });
}
function salvar(prov, r, nomeArq, cores, icones){
  var partes=partir('p',r.pts).concat(partir('l',r.lns));
  var meta={ pastas:r.pastas, nPts:r.pts.length, nLns:r.lns.length, partes:partes.map(function(p){return p.id;}), atualizado:Date.now(), arquivo:nomeArq||'', cores:cores||{}, icones:icones||{} };
  return window._kmzApi.salvar(prov, meta, partes).then(function(){ return meta; });
}
var ICONES={ circulo:'Círculo', quadrado:'Caixa (■)', losango:'CTO (◆)', triangulo:'CEO (▲)', pino:'Pino', estrela:'Estrela' };
var ICONE_LISTA=['circulo','quadrado','losango','triangulo','pino','estrela'];
function mkIcon(tipo, cor){
  var f='fill="'+cor+'" stroke="#000" stroke-width="1.5"', sh='';
  if(tipo==='quadrado') sh='<rect x="3" y="3" width="18" height="18" rx="2" '+f+'/>';
  else if(tipo==='losango') sh='<polygon points="12,1 23,12 12,23 1,12" '+f+'/>';
  else if(tipo==='triangulo') sh='<polygon points="12,2 23,21 1,21" '+f+'/>';
  else if(tipo==='estrela') sh='<polygon points="12,1 15,9 23,9 17,14 19,22 12,17 5,22 7,14 1,9 9,9" '+f+'/>';
  else sh='<path d="M12 23C12 23 4 14 4 9a8 8 0 0 1 16 0c0 5-8 14-8 14z" '+f+'/><circle cx="12" cy="9" r="3" fill="#fff"/>';
  return L.divIcon({ className:'kz-ic', html:'<svg width="24" height="24" viewBox="0 0 24 24">'+sh+'</svg>', iconSize:[24,24], iconAnchor:tipo==='pino'?[12,22]:[12,12] });
}
function grupoDe(i){ return S.grupos[i] || {icone:'circulo',cor:CORES[0]}; }
function icoHtml(id, ic, cor, g){
  return '<label>Ícone</label><select id="'+id+'-ic"><option value="">Igual à pasta</option>'+ICONE_LISTA.map(function(k){ return '<option value="'+k+'"'+(k===ic?' selected':'')+'>'+ICONES[k]+'</option>'; }).join('')+'</select>'+
    '<label>Cor</label><div style="display:flex;gap:10px;align-items:center"><input type="color" id="'+id+'-cor" value="'+(cor||g.cor)+'" style="width:46px;height:34px;padding:0;flex:none"><label style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" id="'+id+'-cf" style="width:auto"'+(cor?'':' checked')+'> usar a cor da pasta</label></div>';
}
function icoLer(id){ return { ic:$(id+'-ic').value, cor:$(id+'-cf').checked?'':$(id+'-cor').value }; }
function icoLigar(id, selPasta){
  var prev=+$(selPasta).value;
  $(selPasta).onchange=function(){
    var novo=+this.value, gA=grupoDe(prev), gN=grupoDe(novo), v=icoLer(id);
    var icA=v.ic||gA.icone||'circulo', corA=v.cor||gA.cor;
    if(icA!==(gN.icone||'circulo') || corA.toLowerCase()!==gN.cor.toLowerCase()){
      if(confirm('O ícone ou a cor da pasta de destino é diferente.\nUsar o ícone e a cor da pasta?')){ $(id+'-ic').value=''; $(id+'-cf').checked=true; }
      else { $(id+'-ic').value=icA; $(id+'-cf').checked=false; $(id+'-cor').value=corA; }
    }
    if($(id+'-cf').checked) $(id+'-cor').value=gN.cor;
    prev=novo;
  };
}
function chave(p){ return 'k'+String(p[2]).replace(/[-.]/g,function(c){return c==='-'?'m':'p';})+'_'+String(p[3]).replace(/[-.]/g,function(c){return c==='-'?'m':'p';}); }
function montarDados(carregado){
  var meta=carregado.meta, pts=[], lns=[];
  carregado.partes.sort(function(a,b){return a.id<b.id?-1:1;}).forEach(function(p){
    if(!/^[pl]\d{3}$/.test(p.id)) return; var d=JSON.parse(p.j); if(p.id.charAt(0)==='p') pts=pts.concat(d); else lns=lns.concat(d);
  });
  var ed={}; Object.keys(carregado.edits||{}).forEach(function(k){ try{ ed[k]=JSON.parse(carregado.edits[k]); }catch(e){} });
  Object.keys(ed).forEach(function(k){ var e=ed[k]; if(e&&e.novo){ var ix=(meta.pastas||[]).indexOf(e.p); pts.push(['',e.n,e.lat,e.lng,ix>=0?ix:0,e.d||'',e.r||'',e.ic||'',e.cor||'']); } });
  pts.forEach(function(p){ var e=ed[chave(p)]; if(e){ if(e.n) p[1]=e.n; if(e.d!=null) p[5]=e.d; if(e.r!=null) p[6]=e.r; if(e.ic!=null) p[7]=e.ic; if(e.cor!=null) p[8]=e.cor; if(e.p){ var ix=(meta.pastas||[]).indexOf(e.p); if(ix>=0) p[4]=ix; } } });
  pts=pts.filter(function(p){ var e=ed[chave(p)]; return !(e&&e.del); });
  return { pastas:meta.pastas||[], pts:pts, lns:lns, meta:meta, ed:ed };
}

// ---------- mapa ----------
function montar(){
  var root=$('kmz-root'); if(!root || S.montado) return;
  css();
  root.innerHTML =
   '<div class="kz-top"><select id="kz-proj"></select>'+
   '<button class="kz-btn" id="kz-novo">➕ Novo projeto</button>'+
   '<button class="kz-btn pri" id="kz-imp">📂 Importar KMZ</button>'+
   '<button class="kz-btn" id="kz-xk">⬇️ KMZ</button><button class="kz-btn" id="kz-xl">⬇️ KML</button>'+
   '<input type="file" id="kz-file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml,application/zip" hidden>'+
   '<button class="kz-btn" id="kz-del">🗑️ Apagar KMZ do projeto</button>'+
   '<div id="kz-status"></div></div>'+
   '<div class="kz-body"><aside class="kz-side" id="kz-side"><button class="kz-btn" id="kz-sx" style="display:none;width:100%;margin-bottom:8px">✕ Fechar menu</button><button class="kz-btn" id="kz-addp" style="width:100%;margin-bottom:8px">📁 Adicionar pasta</button><input type="search" id="kz-busca" placeholder="Buscar nº ou nome da caixa"><div id="kz-res"></div><div id="kz-pastas"></div></aside><div id="kz-bd"></div>'+
   '<div class="kz-mapwrap"><button class="kz-btn" id="kz-tog">☰ Pastas</button>'+
   '<div class="kz-bar"><button id="kz-b-menu" title="Menu">☰</button><button id="kz-b-busca" title="Buscar">🔍</button><button id="kz-b-sair" title="Voltar ao painel">⬅</button></div>'+
   '<button id="kz-add" title="Adicionar caixa">➕📍</button><div id="kz-cross"><svg width="54" height="54" viewBox="0 0 54 54"><circle cx="27" cy="27" r="14" fill="rgba(255,255,255,.35)" stroke="#000" stroke-width="4"/><path d="M27 2v14M27 38v14M2 27h14M38 27h14" stroke="#000" stroke-width="4"/><path d="M27 2v14M27 38v14M2 27h14M38 27h14" stroke="#fff" stroke-width="1.5"/></svg></div><div id="kz-pbar"><div style="display:flex;gap:10px"><button id="kz-pn">Cancelar</button><button id="kz-pok">OK</button><button id="kz-pg" title="Ir para minha localização">🛰️</button></div><div id="kz-pco"></div></div><div id="kz-map"></div><div id="kz-card"></div></div></div>';
  S.montado=true;
  S.map=L.map('kz-map',{renderer:L.canvas({tolerance:12}),zoomControl:true}).setView([-3.78,-38.49],12);
  var sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,maxNativeZoom:19,attribution:'Esri'});
  var rua=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,maxNativeZoom:19,attribution:'© OpenStreetMap'});
  sat.addTo(S.map);
  L.control.layers({'Satélite':sat,'Ruas':rua},null,{position:'topright'}).addTo(S.map);
  var Loc=L.Control.extend({ onAdd:function(){ var b=L.DomUtil.create('button','kz-btn'); b.textContent='📍'; b.title='Minha localização'; b.style.cssText='width:38px;height:38px;font-size:18px;padding:0'; L.DomEvent.on(b,'click',function(e){ L.DomEvent.stop(e); S.map.locate({setView:true,maxZoom:18,enableHighAccuracy:true}); }); return b; } });
  new Loc({position:'topleft'}).addTo(S.map);
  S.map.on('locationfound',function(e){ if(S.pos) S.map.removeLayer(S.pos); S.pos=L.circleMarker(e.latlng,{radius:8,color:'#fff',weight:2,fillColor:'#2563eb',fillOpacity:1}).addTo(S.map); });
  S.map.on('locationerror',function(){ msg('Não consegui a localização. Ative o GPS.',true); });
  S.map.on('moveend zoomend', rotular);
  S.map.on('click', function(){ fecharCard(); $('kz-side').classList.remove('aberto'); });
  $('kz-imp').onclick=function(){ if(!S.prov){ msg('Escolha o projeto primeiro.',true); return; } $('kz-file').value=''; $('kz-file').click(); };
  $('kz-file').onchange=function(){ if(this.files[0]) importar(this.files[0]); };
  $('kz-del').onclick=apagar;
  $('kz-bd').onclick=function(){ $('kz-side').classList.remove('aberto'); };
  $('kz-sx').onclick=function(){ $('kz-side').classList.remove('aberto'); };
  $('kz-novo').onclick=novoProjeto;
  $('kz-b-menu').onclick=function(){ $('kz-side').classList.toggle('aberto'); };
  $('kz-b-busca').onclick=function(){ $('kz-side').classList.add('aberto'); setTimeout(function(){ $('kz-busca').focus(); },50); };
  $('kz-b-sair').onclick=sairTela;
  $('kz-add').onclick=novaCaixa;
  $('kz-xk').onclick=function(){ exportar('kmz'); }; $('kz-xl').onclick=function(){ exportar('kml'); };
  $('kz-addp').onclick=function(){ addPasta(''); };
  $('kz-tog').onclick=function(){ $('kz-side').classList.toggle('aberto'); };
  $('kz-proj').onchange=function(){ selecionar(this.value); };
  $('kz-busca').oninput=buscar;
}
function popularProjetos(){
  var sel=$('kz-proj'), nomes=(S.cfg.getProvedores()||[]).slice(); S.extra.forEach(function(n){ if(nomes.indexOf(n)<0) nomes.push(n); }); nomes.sort();
  var antes=S.prov || localStorage.getItem('kmz_projeto') || '';
  sel.innerHTML='<option value="">— Escolha o projeto —</option>'+nomes.map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>';}).join('');
  if(nomes.indexOf(antes)>=0){ sel.value=antes; if(antes!==S.prov || !S.dados) selecionar(antes); }
  else if(!nomes.length) msg('Nenhum projeto cadastrado. Cadastre o provedor na aba Provedores.');
}
function limparMapa(){
  S.grupos.forEach(function(g){ S.map.removeLayer(g.camada); });
  S.grupos=[]; S.marcadores=[]; S.rotulados=[]; S.dados=null; fecharCard();
  $('kz-pastas').innerHTML=''; $('kz-res').innerHTML='';
}
function selecionar(nome){
  S.prov=nome; localStorage.setItem('kmz_projeto', nome||'');
  limparMapa();
  if(!nome){ msg('Escolha o projeto para ver o KMZ dele.'); return; }
  msg('Carregando…');
  window._kmzApi.carregar(nome).then(function(c){
    if(S.prov!==nome) return;
    if(!c){ S.dados={pastas:[],pts:[],lns:[],meta:{}}; desenhar(); msg('Projeto sem KMZ. Importe um KMZ ou adicione pastas.'); return; }
    S.dados=montarDados(c); S.off={}; desenhar();
  }).catch(function(e){ console.error(e); msg('Erro ao carregar: '+(e.message||e), true); });
}
function importar(file){
  msg('Lendo '+file.name+'…');
  var prov=S.prov;
  lerArquivo(file).then(function(r){
    if(!r.pts.length && !r.lns.length) throw new Error('Nenhum ponto ou linha no arquivo ('+r.ignorados+' itens ignorados).');
    if(S.dados && (S.dados.pts.length||S.dados.lns.length) && !confirm('O projeto "'+prov+'" já tem um KMZ. Substituir pelo novo ('+r.pts.length+' pontos)?')) { msg('Importação cancelada.'); return; }
    msg('Salvando '+r.pts.length+' pontos e '+r.lns.length+' linhas…');
    return salvar(prov, r, file.name).then(function(metaSalva){
      if(S.prov!==prov) return;
      limparMapa(); S.off={}; S.dados={pastas:r.pastas,pts:r.pts,lns:r.lns,meta:metaSalva,ed:{}}; desenhar();
    });
  }).catch(function(e){ console.error(e); msg('Não consegui importar: '+(e.message||e), true); });
}
function apagar(){
  if(!S.prov || !S.dados || !(S.dados.pts.length||S.dados.lns.length||S.dados.pastas.length)){ msg('Este projeto não tem KMZ.'); return; }
  if(!confirm('Apagar o KMZ do projeto "'+S.prov+'"? Isso não apaga as fotos do Drive.')) return;
  var prov=S.prov;
  window._kmzApi.apagar(prov).then(function(){ limparMapa(); S.dados={pastas:[],pts:[],lns:[],meta:{}}; desenhar(); msg('KMZ do projeto apagado.'); }).catch(function(e){ msg('Erro ao apagar: '+(e.message||e), true); });
}
function desenhar(){
  var d=S.dados, np=d.pastas.length, tot=[];
  for(var i=0;i<np;i++) tot.push({ i:i, nome:d.pastas[i], pts:0, lns:0, cor:((d.meta&&d.meta.cores&&d.meta.cores[d.pastas[i]])||CORES[i%CORES.length]), camada:L.layerGroup(), on:!S.off[d.pastas[i]], linhas:[], icone:((d.meta&&d.meta.icones&&d.meta.icones[d.pastas[i]])||'circulo') });
  S.grupos=tot; var limites=[];
  d.lns.forEach(function(l){
    var g=tot[l[0]]; if(!g) return; g.lns++;
    var pl=L.polyline(l[2],{color:g.cor,weight:3,opacity:.85}).bindTooltip(esc(l[1]||'cabo'),{sticky:true}).addTo(g.camada); g.linhas.push(pl);
  });
  d.pts.forEach(function(p){
    var g=tot[p[4]]; if(!g) return; g.pts++;
    var ic=p[7]||g.icone||'circulo', cr=p[8]||g.cor;
    var m=(ic!=='circulo') ? L.marker([p[2],p[3]],{icon:mkIcon(ic,cr),bubblingMouseEvents:false}) : L.circleMarker([p[2],p[3]],{radius:8,color:'#000',weight:1,fillColor:cr,fillOpacity:.95,bubblingMouseEvents:false});
    m.on('click',function(){ abrirCard(p); var sd=$('kz-side'); if(sd) sd.classList.remove('aberto'); });
    m.addTo(g.camada); m._p=p; m._g=g; S.marcadores.push(m); limites.push([p[2],p[3]]);
  });
  tot.forEach(function(g){ if(g.on) g.camada.addTo(S.map); });
  if(!S.semZoom){ if(limites.length) S.map.fitBounds(limites,{padding:[30,30],maxZoom:17}); else if(d.lns.length) S.map.fitBounds(d.lns[0][2]); }
  montarArvore();
  var dt=d.meta&&d.meta.atualizado ? new Date(d.meta.atualizado).toLocaleDateString('pt-BR') : '';
  if(!d.pts.length && !d.lns.length) { msg('Projeto vazio. Importe um KMZ ou adicione pastas.'); } else msg(d.pts.length+' pontos'+(d.lns.length?' · '+d.lns.length+' linhas':'')+' · '+(d.meta&&d.meta.arquivo||'KMZ')+(dt?' · '+dt:''));
  setTimeout(function(){ S.map.invalidateSize(); rotular(); },50);
}
function montarArvore(){
  var nodes={}, raiz=[];
  S.grupos.forEach(function(g){
    var acc='', pai=null;
    g.nome.split('/').forEach(function(nm){
      acc=acc?acc+'/'+nm:nm; var n=nodes[acc];
      if(!n){ n=nodes[acc]={nome:nm,path:acc,filhos:[],grupos:[]}; (pai?pai.filhos:raiz).push(n); }
      pai=n;
    });
    pai.grupos.push(g);
  });
  function gs(n){ var r=n.grupos.slice(); n.filhos.forEach(function(f){ r=r.concat(gs(f)); }); return r; }
  function html(n){
    var todos=gs(n), tot=0, vis=0, on=0;
    todos.forEach(function(g){ tot+=g.pts; if(g.on){ vis+=g.pts; on++; } });
    var cor=(n.grupos[0]||todos[0]||{}).cor||'#888';
    var h='<div class="kz-n"><span class="sw" style="background:'+cor+'"></span>'+
      (n.filhos.length?'<button class="ch" data-t="'+n.id+'">'+(S.abertos[n.path]?'⌄':'›')+'</button>':'')+
      '<div class="tx" data-t="'+n.id+'"><b>'+esc(n.nome)+'</b><small>'+vis+'/'+tot+' marcadores</small></div>'+
      '<input type="color" data-k="'+n.id+'" value="'+cor+'" title="Cor dos ícones">'+
      '<button class="ch" data-m="'+n.id+'" title="Opções da pasta">⋮</button>'+
      '<input type="checkbox" data-c="'+n.id+'"'+(on===todos.length&&todos.length?' checked':'')+'></div>';
    if(S.menu===n.path) h+='<div class="kz-menu"><button class="kz-btn" data-a="'+n.id+'">＋ Subpasta</button><button class="kz-btn" data-i="'+n.id+'">🔷 Ícone</button><button class="kz-btn" data-r="'+n.id+'">✏️ Renomear</button><button class="kz-btn" data-x="'+n.id+'">🗑️ Excluir</button></div>';
    if(S.abertos[n.path] && n.filhos.length) h+='<div class="kz-fil">'+n.filhos.map(html).join('')+'</div>';
    return h;
  }
  var lista=[]; (function num(a){ a.forEach(function(n){ n.id=lista.length; lista.push(n); num(n.filhos); }); })(raiz);
  function pintar(){ $('kz-pastas').innerHTML=raiz.map(html).join('') || '<div class="kz-vazio">Sem pastas.</div>'; }
  $('kz-pastas').onclick=function(e){
    var mm=e.target.closest('[data-m]'); if(mm){ var pm=lista[+mm.dataset.m].path; S.menu=(S.menu===pm?'':pm); pintar(); return; }
    var ic=e.target.closest('[data-i]'); if(ic){ iconePasta(lista[+ic.dataset.i].path); return; }
    var rr=e.target.closest('[data-r]'); if(rr){ renomearPasta(lista[+rr.dataset.r].path); return; }
    var xx=e.target.closest('[data-x]'); if(xx){ excluirPasta(lista[+xx.dataset.x].path); return; }
    var ad=e.target.closest('[data-a]'); if(ad){ S.menu=''; addPasta(lista[+ad.dataset.a].path); return; }
    var t=e.target.closest('[data-t]'); if(!t) return; var n=lista[+t.dataset.t];
    if(n.filhos.length){ S.abertos[n.path]=!S.abertos[n.path]; pintar(); }
    else { var g=n.grupos[0]; if(g && g.pts){ var b=[]; S.marcadores.forEach(function(m){ if(m._g===g) b.push(m.getLatLng()); }); if(b.length) S.map.fitBounds(L.latLngBounds(b),{maxZoom:18,padding:[30,30]}); $('kz-side').classList.remove('aberto'); } }
  };
  $('kz-pastas').onchange=function(e){
    if(e.target.dataset.k!=null){ corPasta(gs(lista[+e.target.dataset.k]), e.target.value); pintar(); return; }
    var id=e.target.dataset.c; if(id==null) return; var on=e.target.checked;
    gs(lista[+id]).forEach(function(g){ g.on=on; if(on){ delete S.off[g.nome]; g.camada.addTo(S.map); } else { S.off[g.nome]=1; S.map.removeLayer(g.camada); } });
    pintar(); rotular();
  };
  pintar();
}
function metaAtual(){
  var d=S.dados, m=d.meta||{};
  return { pastas:d.pastas, nPts:d.pts.length, nLns:d.lns.length, partes:m.partes||[], atualizado:m.atualizado||Date.now(), arquivo:m.arquivo||'', cores:m.cores||{}, icones:m.icones||{} };
}
function gravarMeta(){ S.dados.meta=metaAtual(); return window._kmzApi.salvarMeta(S.prov, S.dados.meta); }
function redesenhar(){
  var d=S.dados; var z=S.semZoom; S.semZoom=true;
  S.grupos.forEach(function(g){ S.map.removeLayer(g.camada); });
  S.grupos=[]; S.marcadores=[]; S.rotulados=[]; fecharCard(); desenhar(); S.semZoom=z;
}
function corPasta(grupos, cor){
  var m=S.dados.meta=S.dados.meta||{}; m.cores=m.cores||{};
  grupos.forEach(function(g){
    g.cor=cor; m.cores[g.nome]=cor;
    g.linhas.forEach(function(l){ l.setStyle({color:cor}); });
  });
  S.marcadores.forEach(function(mk){ if(grupos.indexOf(mk._g)>=0){ var cc=mk._p[8]||cor; if(mk.setStyle) mk.setStyle({fillColor:cc}); else mk.setIcon(mkIcon(mk._p[7]||mk._g.icone,cc)); } });
  gravarMeta().catch(function(e){ msg('Erro ao salvar cor: '+(e.message||e),true); });
}
function iconePasta(path){
  var txt='Ícone das caixas desta pasta (as caixas seguem o ícone da pasta):\n'+ICONE_LISTA.map(function(k,i){ return (i+1)+' = '+ICONES[k]; }).join('\n');
  var r=parseInt(prompt(txt,'1'),10); if(!(r>=1 && r<=ICONE_LISTA.length)) return;
  var tipo=ICONE_LISTA[r-1], m=S.dados.meta=S.dados.meta||{}; m.icones=m.icones||{};
  S.grupos.filter(function(g){ return sob(g.nome,path); }).forEach(function(g){ m.icones[g.nome]=tipo; });
  S.menu=''; redesenhar();
  gravarMeta().then(function(){ msg('Ícone alterado.'); }).catch(function(e){ msg('Erro ao salvar: '+(e.message||e),true); });
}
function addPasta(pai){
  if(!S.prov){ msg('Escolha o projeto primeiro.',true); return; }
  var nm=(prompt(pai?'Nome da subpasta em "'+pai+'":':'Nome da nova pasta:')||'').replace(/\//g,'-').trim();
  if(!nm) return;
  var path=pai?pai+'/'+nm:nm;
  if(S.dados.pastas.indexOf(path)>=0){ msg('Já existe uma pasta com esse nome.',true); return; }
  S.dados.pastas.push(path);
  if(pai) S.abertos[pai]=true;
  var sup=pai; while(sup){ S.abertos[sup]=true; sup=sup.indexOf('/')>=0?sup.slice(0,sup.lastIndexOf('/')):''; }
  redesenhar();
  gravarMeta().then(function(){ msg('Pasta "'+nm+'" criada.'); }).catch(function(e){ msg('Erro ao salvar pasta: '+(e.message||e),true); });
}
function sob(path, base){ return path===base || path.indexOf(base+'/')===0; }
function salvarEditsTodos(){
  var o={}; var ed=S.dados.ed||{}; Object.keys(ed).forEach(function(k){ o[k]=JSON.stringify(ed[k]); });
  return window._kmzApi.salvarEdits(S.prov, o);
}
function renomearPasta(path){
  var atual=path.split('/').pop(), pai=path.indexOf('/')>=0?path.slice(0,path.lastIndexOf('/')):'';
  var nm=(prompt('Novo nome da pasta:',atual)||'').replace(/\//g,'-').trim();
  if(!nm || nm===atual) return;
  var novo=pai?pai+'/'+nm:nm, d=S.dados;
  if(d.pastas.some(function(n){ return sob(n,novo); }) ){ msg('Já existe uma pasta com esse nome.',true); return; }
  function mv(n){ return sob(n,path) ? novo+n.slice(path.length) : n; }
  d.pastas=d.pastas.map(mv);
  var m=d.meta=d.meta||{}, c2={}; Object.keys(m.cores||{}).forEach(function(k){ c2[mv(k)]=m.cores[k]; }); m.cores=c2;
  var i2={}; Object.keys(m.icones||{}).forEach(function(k){ i2[mv(k)]=m.icones[k]; }); m.icones=i2;
  var o2={}; Object.keys(S.off).forEach(function(k){ o2[mv(k)]=1; }); S.off=o2;
  var a2={}; Object.keys(S.abertos).forEach(function(k){ a2[mv(k)]=S.abertos[k]; }); S.abertos=a2;
  S.menu='';
  var ed=d.ed||{}, mudouEd=false; Object.keys(ed).forEach(function(k){ if(ed[k].p && sob(ed[k].p,path)){ ed[k].p=mv(ed[k].p); mudouEd=true; } });
  redesenhar();
  gravarMeta().then(function(){ return mudouEd ? salvarEditsTodos() : null; }).then(function(){ msg('Pasta renomeada.'); }).catch(function(e){ msg('Erro ao salvar: '+(e.message||e),true); });
}
function excluirPasta(path){
  var d=S.dados, rem={}, nPts=0, nLns=0;
  d.pastas.forEach(function(n,i){ if(sob(n,path)) rem[i]=1; });
  d.pts.forEach(function(p){ if(rem[p[4]]) nPts++; }); d.lns.forEach(function(l){ if(rem[l[0]]) nLns++; });
  if(!confirm('Excluir a pasta "'+path+'" e tudo dentro dela ('+nPts+' caixas, '+nLns+' cabos)? Não dá para desfazer.')) return;
  var novoIdx={}, pastas=[];
  d.pastas.forEach(function(n,i){ if(!rem[i]){ novoIdx[i]=pastas.length; pastas.push(n); } });
  var pts=d.pts.filter(function(p){ return !rem[p[4]]; }); pts.forEach(function(p){ p[4]=novoIdx[p[4]]; });
  var lns=d.lns.filter(function(l){ return !rem[l[0]]; }); lns.forEach(function(l){ l[0]=novoIdx[l[0]]; });
  var m=d.meta=d.meta||{}, c2={}; Object.keys(m.cores||{}).forEach(function(k){ if(!sob(k,path)) c2[k]=m.cores[k]; }); m.cores=c2;
  var i3={}; Object.keys(m.icones||{}).forEach(function(k){ if(!sob(k,path)) i3[k]=m.icones[k]; }); m.icones=i3;
  Object.keys(S.off).forEach(function(k){ if(sob(k,path)) delete S.off[k]; });
  var ed=d.ed||{}; Object.keys(ed).forEach(function(k){ if(ed[k].p && sob(ed[k].p,path)){ if(ed[k].novo) delete ed[k]; else delete ed[k].p; } });
  d.pastas=pastas; d.pts=pts; d.lns=lns; S.menu='';
  redesenhar(); msg('Excluindo…');
  var tarefa = (nPts||nLns)
    ? salvar(S.prov,{pastas:pastas,pts:pts,lns:lns},(m.arquivo||''),c2,i3).then(function(ms){ d.meta=ms; return salvarEditsTodos(); })
    : gravarMeta();
  tarefa.then(function(){ msg('Pasta excluída.'); }).catch(function(e){ msg('Erro ao excluir: '+(e.message||e),true); });
}
function novoProjeto(){
  var nm=(prompt('Nome do novo projeto:')||'').trim(); if(!nm) return;
  if(nm.indexOf('/')>=0){ msg('Não use "/" no nome.',true); return; }
  window._kmzApi.criarProjeto(nm).then(function(){
    if(S.extra.indexOf(nm)<0) S.extra.push(nm);
    popularProjetos(); $('kz-proj').value=nm; selecionar(nm);
  }).catch(function(e){ msg('Erro ao criar projeto: '+(e.message||e),true); });
}
function xml(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function kmlCor(h){ h=(h||'#888888').replace('#',''); return 'ff'+h.slice(4,6)+h.slice(2,4)+h.slice(0,2); }
function gerarKml(){
  var d=S.dados, raiz={f:{},g:[]};
  S.grupos.forEach(function(g){ var no=raiz; g.nome.split('/').forEach(function(nm){ no.f[nm]=no.f[nm]||{f:{},g:[]}; no=no.f[nm]; }); no.g.push(g); });
  var sty='';
  S.grupos.forEach(function(g){ sty+='<Style id="s'+g.i+'"><IconStyle><color>'+kmlCor(g.cor)+'</color><scale>1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LineStyle><color>'+kmlCor(g.cor)+'</color><width>3</width></LineStyle></Style>'; });
  function conteudo(no){
    var o='';
    no.g.forEach(function(g){
      d.pts.forEach(function(p){ if(p[4]===g.i) o+='<Placemark><name>'+xml(p[1]||p[0])+'</name><description>'+xml((p[5]||'')+(p[6]?'\nReferência: '+p[6]:''))+'</description><styleUrl>#s'+g.i+'</styleUrl><Point><coordinates>'+p[3]+','+p[2]+',0</coordinates></Point></Placemark>'; });
      d.lns.forEach(function(l){ if(l[0]===g.i) o+='<Placemark><name>'+xml(l[1])+'</name><styleUrl>#s'+g.i+'</styleUrl><LineString><tessellate>1</tessellate><coordinates>'+l[2].map(function(c){return c[1]+','+c[0]+',0';}).join(' ')+'</coordinates></LineString></Placemark>'; });
    });
    Object.keys(no.f).forEach(function(k){ o+='<Folder><name>'+xml(k)+'</name>'+conteudo(no.f[k])+'</Folder>'; });
    return o;
  }
  return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'+xml(S.prov)+'</name>'+sty+conteudo(raiz)+'</Document></kml>';
}
function baixar(blob, nome){
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nome; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },2000);
}
function exportar(fmt){
  if(!S.prov || !S.dados || !(S.dados.pts.length||S.dados.lns.length||S.dados.pastas.length)){ msg('Nada para exportar neste projeto.',true); return; }
  var nome=S.prov.replace(/[\\\/:*?"<>|]+/g,' ').trim()||'projeto', kml=gerarKml();
  if(fmt==='kml'){ baixar(new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}), nome+'.kml'); msg('KML exportado.'); return; }
  var z=new JSZip(); z.file('doc.kml',kml);
  z.generateAsync({type:'blob',compression:'DEFLATE'}).then(function(b){ baixar(b, nome+'.kmz'); msg('KMZ exportado.'); });
}
function rotular(){
  S.rotulados.forEach(function(m){ m.unbindTooltip(); }); S.rotulados=[];
  if(!S.map || S.map.getZoom()<16) return;
  var b=S.map.getBounds(), n=0;
  for(var i=0;i<S.marcadores.length && n<250;i++){
    var m=S.marcadores[i]; if(!m._g.on || !b.contains(m.getLatLng())) continue;
    m.bindTooltip(esc(m._p[0]||m._p[1]||''),{permanent:true,direction:'right',offset:[6,0],className:'kz-lbl'}); S.rotulados.push(m); n++;
  }
}
function abrirCard(p){
  S.atual=p; var c=$('kz-card');
  c.innerHTML='<h4>'+esc(p[1]||p[0]||'Sem nome')+'</h4><div class="p">'+esc(S.dados.pastas[p[4]]||'')+' · '+p[2]+', '+p[3]+'</div>'+
    (p[5]?'<pre>'+esc(p[5])+'</pre>':'')+
    (p[6]?'<pre><b>Referência:</b> '+esc(p[6])+'</pre>':'')+
    '<div class="acoes"><button class="kz-btn pri" id="kz-nav">🧭 Navegar</button><button class="kz-btn" id="kz-ed">✏️ Editar</button><button class="kz-btn" id="kz-cp">📋 Copiar coord.</button><button class="kz-btn" id="kz-dl">🗑️ Excluir</button>'+
    (S.cfg.onFotografar && (p[0]||/\d{5}/.test(p[1])) ? '<button class="kz-btn" id="kz-foto">📷 Fotografar esta caixa</button>':'')+
    '<button class="kz-btn" id="kz-fch">Fechar</button></div>';
  c.style.display='block'; $('kz-add').style.display='none';
  $('kz-nav').onclick=function(){ window.open('https://www.google.com/maps/dir/?api=1&destination='+p[2]+','+p[3],'_blank'); };
  $('kz-cp').onclick=function(){ var t=p[2]+', '+p[3]; if(navigator.clipboard) navigator.clipboard.writeText(t); msg('Coordenadas copiadas: '+t); };
  $('kz-ed').onclick=function(){ editarCard(p); };
  $('kz-dl').onclick=function(){
    if(!confirm('Excluir a caixa "'+(p[1]||p[0])+'"? Não dá para desfazer.')) return;
    var k=chave(p), v={del:1};
    window._kmzApi.salvarEdit(S.prov,k,v).then(function(){
      S.dados.ed=S.dados.ed||{}; S.dados.ed[k]=v;
      S.dados.pts=S.dados.pts.filter(function(x){ return x!==p; });
      fecharCard(); redesenhar(); msg('Caixa excluída.');
    }).catch(function(e){ msg('Erro ao excluir: '+(e.message||e),true); });
  };
  if($('kz-foto')) $('kz-foto').onclick=function(){ S.cfg.onFotografar(p[0]||(/\d{5,9}/.exec(p[1])||[''])[0]); };
  $('kz-fch').onclick=fecharCard;
}
function editarCard(p){
  var c=$('kz-card');
  c.innerHTML='<div class="kz-ef"><label>Título</label><input id="kz-et" value="'+esc(p[1])+'">'+
    '<label>Descrição</label><textarea id="kz-edsc" rows="2">'+esc(p[5]||'')+'</textarea>'+
    '<label>Pasta</label><select id="kz-ep">'+S.dados.pastas.map(function(n,i){return '<option value="'+i+'"'+(i===p[4]?' selected':'')+'>'+esc(n)+'</option>';}).join('')+'</select>'+
    icoHtml('ed',p[7]||'',p[8]||'',grupoDe(p[4]))+'<label>Referência (ponto de referência / endereço)</label><textarea id="kz-er" rows="2">'+esc(p[6]||'')+'</textarea></div>'+
    '<div class="acoes"><button class="kz-btn pri" id="kz-sv">💾 Salvar</button><button class="kz-btn" id="kz-cn">Cancelar</button></div>';
  icoLigar('ed','kz-ep');
  $('kz-cn').onclick=function(){ abrirCard(p); };
  $('kz-sv').onclick=function(){
    var v={ n:$('kz-et').value.trim(), d:$('kz-edsc').value.trim(), r:$('kz-er').value.trim(), p:S.dados.pastas[+$('kz-ep').value] }; var ico=icoLer('ed'); v.ic=ico.ic; v.cor=ico.cor;
    if(!v.n){ msg('Informe o título.',true); return; }
    $('kz-sv').disabled=true; $('kz-sv').textContent='Salvando…';
    S.dados.ed=S.dados.ed||{}; S.dados.ed[chave(p)]=v;
    window._kmzApi.salvarEdit(S.prov, chave(p), v).then(function(){
      p[1]=v.n; p[5]=v.d; p[6]=v.r; p[7]=v.ic; p[8]=v.cor; var mudou=true; p[4]=+$('kz-ep').value;
      var m=S.marcadores.filter(function(x){return x._p===p;})[0]; if(m && m.getTooltip()){ m.unbindTooltip(); }
      if(mudou) redesenhar(); else rotular(); abrirCard(p); msg('Caixa atualizada.');
    }).catch(function(e){ msg('Erro ao salvar: '+(e.message||e),true); abrirCard(p); });
  };
}
function fecharCard(){ var c=$('kz-card'); if(c){ c.style.display='none'; c.className=''; } S.atual=null; var a=$('kz-add'); if(a) a.style.display=''; var x=$('kz-cross'); if(x) x.style.display='none'; }
function buscar(){
  var q=semAcento($('kz-busca').value.trim()), box=$('kz-res'); box.innerHTML='';
  if(q.length<2 || !S.dados) return;
  var ach=[]; for(var i=0;i<S.dados.pts.length && ach.length<8;i++){ var p=S.dados.pts[i]; if(semAcento(p[0]+' '+p[1]).indexOf(q)>=0) ach.push(p); }
  if(!ach.length){ box.innerHTML='<div class="kz-res"><div style="cursor:default;color:var(--mu,#8a8a96)">Nada encontrado</div></div>'; return; }
  box.innerHTML='<div class="kz-res">'+ach.map(function(p,k){return '<div data-k="'+k+'">'+esc(p[1]||p[0])+'</div>';}).join('')+'</div>';
  box.onclick=function(e){ var k=e.target.dataset && e.target.dataset.k; if(k==null) return; var p=ach[+k]; S.map.setView([p[2],p[3]],19); abrirCard(p); box.innerHTML=''; };
}

function modo(){
  var root=$('kmz-root'), top=root.querySelector('.kz-top'), side=$('kz-side');
  var cheio=window.matchMedia('(max-width:760px)').matches;
  root.classList.toggle('kz-full',cheio);
  if(cheio){ side.insertBefore(top, side.firstChild); document.body.style.overflow='hidden'; }
  else { root.insertBefore(top, root.firstChild); document.body.style.overflow=''; }
}
function sairTela(){
  var root=$('kmz-root'); root.classList.remove('kz-full'); document.body.style.overflow='';
  $('kz-side').classList.remove('aberto');
  var bs=Array.prototype.slice.call(document.querySelectorAll('.bni,.ni,[data-view]'));
  var alvo=bs.filter(function(b){ return !/kmz/.test((b.dataset.panel||b.dataset.view||'')); })[0]; if(alvo) alvo.click();
}
function fimMira(){
  $('kz-cross').style.display='none'; $('kz-pbar').style.display='none'; $('kz-add').style.display='';
  if(S.movAdd){ S.map.off('move',S.movAdd); S.movAdd=null; }
}
function novaCaixa(){
  if(!S.prov || !S.dados){ msg('Escolha o projeto primeiro.',true); return; }
  fecharCard(); $('kz-side').classList.remove('aberto');
  $('kz-cross').style.display='block'; $('kz-add').style.display='none'; $('kz-pbar').style.display='flex';
  function coord(){ var m=S.map.getCenter(); $('kz-pco').innerHTML='Lat: '+m.lat.toFixed(5)+'<br>Long: '+m.lng.toFixed(5); }
  S.movAdd=coord; S.map.on('move',coord); coord();
  $('kz-pn').onclick=function(){ fimMira(); };
  $('kz-pok').onclick=function(){ var m=S.map.getCenter(); fimMira(); formCaixa(+m.lat.toFixed(6), +m.lng.toFixed(6)); };
  $('kz-pg').onclick=function(){
    if(!navigator.geolocation){ msg('Sem GPS neste aparelho.',true); return; }
    navigator.geolocation.getCurrentPosition(function(g){ S.map.setView([g.coords.latitude,g.coords.longitude],19); },function(){ msg('Não consegui a localização. Ative o GPS.',true); },{enableHighAccuracy:true,timeout:15000});
  };
}
function formCaixa(lat,lng){
  var c=$('kz-card'), pastas=S.dados.pastas.length?S.dados.pastas:['Pasta padrão'];
  c.className='kz-cardfull'; $('kz-add').style.display='none';
  c.innerHTML='<div class="kz-ef"><h4 style="margin:0 0 4px">Nova caixa</h4><div class="p" style="font-size:12px;color:var(--mu,#8a8a96)">Posição: '+lat+', '+lng+'</div>'+
    '<label>Título</label><input id="kz-nt" placeholder="Ex.: 26456 | CTO nova"><label>Pasta (a caixa usa o ícone e a cor da pasta)</label><select id="kz-np">'+pastas.map(function(n,i){return '<option value="'+i+'">'+esc(n)+'</option>';}).join('')+'</select>'+
    '<label>Descrição</label><textarea id="kz-nd" rows="3"></textarea>'+icoHtml('nv','','',grupoDe(0))+'<label>Referência</label><textarea id="kz-nr" rows="2"></textarea></div>'+
    '<div class="acoes" style="margin-top:12px"><button class="kz-btn pri" id="kz-nc">💾 Salvar</button><button class="kz-btn" id="kz-nb">📍 Ajustar posição</button><button class="kz-btn" id="kz-nx">Cancelar</button></div>';
  c.style.display='block';
  icoLigar('nv','kz-np');
  $('kz-nx').onclick=function(){ fecharCard(); };
  $('kz-nb').onclick=function(){ fecharCard(); S.map.setView([lat,lng],Math.max(S.map.getZoom(),18)); novaCaixa(); };
  $('kz-nc').onclick=function(){
    var n=$('kz-nt').value.trim(); if(!n){ msg('Informe o título.',true); return; }
    var pasta=pastas[+$('kz-np').value], pre=Promise.resolve();
    if(!S.dados.pastas.length){ S.dados.pastas.push(pasta); pre=gravarMeta(); }
    var idx=S.dados.pastas.indexOf(pasta);
    var v={ novo:1, n:n, d:$('kz-nd').value.trim(), r:$('kz-nr').value.trim(), p:pasta, lat:lat, lng:lng }; var ico=icoLer('nv'); v.ic=ico.ic; v.cor=ico.cor;
    var key='novo'+Date.now(); $('kz-nc').disabled=true; $('kz-nc').textContent='Salvando…';
    pre.then(function(){ return window._kmzApi.salvarEdit(S.prov,key,v); }).then(function(){
      var pt=['',v.n,v.lat,v.lng,idx,v.d,v.r,v.ic,v.cor]; S.dados.pts.push(pt); S.dados.ed=S.dados.ed||{}; S.dados.ed[key]=v;
      fecharCard(); redesenhar(); abrirCard(pt); msg('Caixa adicionada.');
    }).catch(function(e){ msg('Erro ao salvar: '+(e.message||e),true); $('kz-nc').disabled=false; $('kz-nc').textContent='💾 Salvar'; });
  };
}
window.KmzAba = {
  init:function(cfg){ S.cfg=cfg; },
  abrir:function(){ montar(); if(!S.map) return; modo(); popularProjetos(); setTimeout(function(){ S.map.invalidateSize(); },60); },
  _parse:lerKml, _limpar:limpar, _partir:partir, _montarDados:montarDados, _estado:function(){return S;}
};
})();
