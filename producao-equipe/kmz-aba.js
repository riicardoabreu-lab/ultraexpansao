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
  '.kz-fil{margin-left:14px;border-left:2px solid var(--b2,rgba(255,255,255,.13));padding-left:6px}'+
  '#kz-tog{display:none;position:absolute;top:10px;left:56px;z-index:1050}'+
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
function salvar(prov, r, nomeArq){
  var partes=partir('p',r.pts).concat(partir('l',r.lns));
  var meta={ pastas:r.pastas, nPts:r.pts.length, nLns:r.lns.length, partes:partes.map(function(p){return p.id;}), atualizado:Date.now(), arquivo:nomeArq||'' };
  return window._kmzApi.salvar(prov, meta, partes).then(function(){ return meta; });
}
function chave(p){ return 'k'+String(p[2]).replace(/[-.]/g,function(c){return c==='-'?'m':'p';})+'_'+String(p[3]).replace(/[-.]/g,function(c){return c==='-'?'m':'p';}); }
function montarDados(carregado){
  var meta=carregado.meta, pts=[], lns=[];
  carregado.partes.sort(function(a,b){return a.id<b.id?-1:1;}).forEach(function(p){
    if(!/^[pl]\d{3}$/.test(p.id)) return; var d=JSON.parse(p.j); if(p.id.charAt(0)==='p') pts=pts.concat(d); else lns=lns.concat(d);
  });
  var ed={}; Object.keys(carregado.edits||{}).forEach(function(k){ try{ ed[k]=JSON.parse(carregado.edits[k]); }catch(e){} });
  pts.forEach(function(p){ var e=ed[chave(p)]; if(e){ if(e.n) p[1]=e.n; if(e.d!=null) p[5]=e.d; if(e.r!=null) p[6]=e.r; if(e.p){ var ix=(meta.pastas||[]).indexOf(e.p); if(ix>=0) p[4]=ix; } } });
  return { pastas:meta.pastas||[], pts:pts, lns:lns, meta:meta };
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
   '<div class="kz-body"><aside class="kz-side" id="kz-side"><button class="kz-btn" id="kz-addp" style="width:100%;margin-bottom:8px">📁 Adicionar pasta</button><input type="search" id="kz-busca" placeholder="Buscar nº ou nome da caixa"><div id="kz-res"></div><div id="kz-pastas"></div></aside>'+
   '<div class="kz-mapwrap"><button class="kz-btn" id="kz-tog">☰ Pastas</button><div id="kz-map"></div><div id="kz-card"></div></div></div>';
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
  S.map.on('click', function(){ fecharCard(); });
  $('kz-imp').onclick=function(){ if(!S.prov){ msg('Escolha o projeto primeiro.',true); return; } $('kz-file').value=''; $('kz-file').click(); };
  $('kz-file').onchange=function(){ if(this.files[0]) importar(this.files[0]); };
  $('kz-del').onclick=apagar;
  $('kz-novo').onclick=novoProjeto;
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
      limparMapa(); S.off={}; S.dados={pastas:r.pastas,pts:r.pts,lns:r.lns,meta:metaSalva}; desenhar();
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
  for(var i=0;i<np;i++) tot.push({ i:i, nome:d.pastas[i], pts:0, lns:0, cor:((d.meta&&d.meta.cores&&d.meta.cores[d.pastas[i]])||CORES[i%CORES.length]), camada:L.layerGroup(), on:!S.off[d.pastas[i]], linhas:[] });
  S.grupos=tot; var limites=[];
  d.lns.forEach(function(l){
    var g=tot[l[0]]; if(!g) return; g.lns++;
    var pl=L.polyline(l[2],{color:g.cor,weight:3,opacity:.85}).bindTooltip(esc(l[1]||'cabo'),{sticky:true}).addTo(g.camada); g.linhas.push(pl);
  });
  d.pts.forEach(function(p){
    var g=tot[p[4]]; if(!g) return; g.pts++;
    var m=L.circleMarker([p[2],p[3]],{radius:8,color:'#000',weight:1,fillColor:g.cor,fillOpacity:.95,bubblingMouseEvents:false});
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
      '<button class="ch" data-a="'+n.id+'" title="Adicionar subpasta">＋</button>'+
      '<input type="checkbox" data-c="'+n.id+'"'+(on===todos.length&&todos.length?' checked':'')+'></div>';
    if(S.abertos[n.path] && n.filhos.length) h+='<div class="kz-fil">'+n.filhos.map(html).join('')+'</div>';
    return h;
  }
  var lista=[]; (function num(a){ a.forEach(function(n){ n.id=lista.length; lista.push(n); num(n.filhos); }); })(raiz);
  function pintar(){ $('kz-pastas').innerHTML=raiz.map(html).join('') || '<div class="kz-vazio">Sem pastas.</div>'; }
  $('kz-pastas').onclick=function(e){
    var ad=e.target.closest('[data-a]'); if(ad){ addPasta(lista[+ad.dataset.a].path); return; }
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
  return { pastas:d.pastas, nPts:d.pts.length, nLns:d.lns.length, partes:m.partes||[], atualizado:m.atualizado||Date.now(), arquivo:m.arquivo||'', cores:m.cores||{} };
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
  S.marcadores.forEach(function(mk){ if(grupos.indexOf(mk._g)>=0) mk.setStyle({fillColor:cor}); });
  gravarMeta().catch(function(e){ msg('Erro ao salvar cor: '+(e.message||e),true); });
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
    '<div class="acoes"><button class="kz-btn pri" id="kz-nav">🧭 Navegar</button><button class="kz-btn" id="kz-ed">✏️ Editar</button><button class="kz-btn" id="kz-cp">📋 Copiar coord.</button>'+
    (S.cfg.onFotografar && (p[0]||/\d{5}/.test(p[1])) ? '<button class="kz-btn" id="kz-foto">📷 Fotografar esta caixa</button>':'')+
    '<button class="kz-btn" id="kz-fch">Fechar</button></div>';
  c.style.display='block';
  $('kz-nav').onclick=function(){ window.open('https://www.google.com/maps/dir/?api=1&destination='+p[2]+','+p[3],'_blank'); };
  $('kz-cp').onclick=function(){ var t=p[2]+', '+p[3]; if(navigator.clipboard) navigator.clipboard.writeText(t); msg('Coordenadas copiadas: '+t); };
  $('kz-ed').onclick=function(){ editarCard(p); };
  if($('kz-foto')) $('kz-foto').onclick=function(){ S.cfg.onFotografar(p[0]||(/\d{5,9}/.exec(p[1])||[''])[0]); };
  $('kz-fch').onclick=fecharCard;
}
function editarCard(p){
  var c=$('kz-card');
  c.innerHTML='<div class="kz-ef"><label>Título</label><input id="kz-et" value="'+esc(p[1])+'">'+
    '<label>Descrição</label><textarea id="kz-edsc" rows="2">'+esc(p[5]||'')+'</textarea>'+
    '<label>Pasta</label><select id="kz-ep">'+S.dados.pastas.map(function(n,i){return '<option value="'+i+'"'+(i===p[4]?' selected':'')+'>'+esc(n)+'</option>';}).join('')+'</select>'+
    '<label>Referência (ponto de referência / endereço)</label><textarea id="kz-er" rows="2">'+esc(p[6]||'')+'</textarea></div>'+
    '<div class="acoes"><button class="kz-btn pri" id="kz-sv">💾 Salvar</button><button class="kz-btn" id="kz-cn">Cancelar</button></div>';
  $('kz-cn').onclick=function(){ abrirCard(p); };
  $('kz-sv').onclick=function(){
    var v={ n:$('kz-et').value.trim(), d:$('kz-edsc').value.trim(), r:$('kz-er').value.trim(), p:S.dados.pastas[+$('kz-ep').value] };
    if(!v.n){ msg('Informe o título.',true); return; }
    $('kz-sv').disabled=true; $('kz-sv').textContent='Salvando…';
    window._kmzApi.salvarEdit(S.prov, chave(p), v).then(function(){
      p[1]=v.n; p[5]=v.d; p[6]=v.r; var mudou=(+$('kz-ep').value!==p[4]); p[4]=+$('kz-ep').value;
      var m=S.marcadores.filter(function(x){return x._p===p;})[0]; if(m && m.getTooltip()){ m.unbindTooltip(); }
      if(mudou) redesenhar(); else rotular(); abrirCard(p); msg('Caixa atualizada.');
    }).catch(function(e){ msg('Erro ao salvar: '+(e.message||e),true); abrirCard(p); });
  };
}
function fecharCard(){ var c=$('kz-card'); if(c) c.style.display='none'; S.atual=null; }
function buscar(){
  var q=semAcento($('kz-busca').value.trim()), box=$('kz-res'); box.innerHTML='';
  if(q.length<2 || !S.dados) return;
  var ach=[]; for(var i=0;i<S.dados.pts.length && ach.length<8;i++){ var p=S.dados.pts[i]; if(semAcento(p[0]+' '+p[1]).indexOf(q)>=0) ach.push(p); }
  if(!ach.length){ box.innerHTML='<div class="kz-res"><div style="cursor:default;color:var(--mu,#8a8a96)">Nada encontrado</div></div>'; return; }
  box.innerHTML='<div class="kz-res">'+ach.map(function(p,k){return '<div data-k="'+k+'">'+esc(p[1]||p[0])+'</div>';}).join('')+'</div>';
  box.onclick=function(e){ var k=e.target.dataset && e.target.dataset.k; if(k==null) return; var p=ach[+k]; S.map.setView([p[2],p[3]],19); abrirCard(p); box.innerHTML=''; };
}

window.KmzAba = {
  init:function(cfg){ S.cfg=cfg; },
  abrir:function(){ montar(); if(!S.map) return; popularProjetos(); setTimeout(function(){ S.map.invalidateSize(); },60); },
  _parse:lerKml, _limpar:limpar, _partir:partir, _montarDados:montarDados, _estado:function(){return S;}
};
})();
