import {installExport} from './export-ui.js';
import {createFactory,factoryStore,viewOptions,viewKey,MAX_FACTORY_BYTES} from './factory-state.js';
import {saveLayout} from './factory-layout.js';
import {traceGraph,palette,kindNames} from './graph.js';
import {projectView,LARGE_GRAPH_NODES} from './explorer.js';
import {FactoryWorld,drawBuilding} from './world.js';
import {factoryStyle,cargoStyle,cargoTypes,drawCargoShape} from './appearance.js';

const $=id=>document.getElementById(id);
const plural=(n,forms)=>forms[n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={layouts:new Map(),detached:false,graph:null,fn:'',pkg:'',part:0,compact:true,query:'',layers:{},selected:null,tracing:false,sources:new Map(),sourceVersion:0,loading:false};
let scene={nodes:[],edges:[]},toastTimer,cancelLayout,layoutVersion=0,routing=false,layoutError=false,routingPhase='',sceneView=null,saveTimer,saveVersion=0;
const storage=factoryStore();
const world=new FactoryWorld($('factory'),$('minimap'),selectNode,(node,x,y)=>{
  $('tooltip').hidden=!node;if(!node)return;
  $('tooltip').textContent=`${node.label}\n${kindNames[node.kind]}${node.type?' · '+node.type:''}`;
  $('tooltip').style.left=Math.max(8,Math.min(x+15,world.width-285))+'px';$('tooltip').style.top=Math.max(8,Math.min(y+15,world.height-80))+'px';
});

world.onMove=moveNode;
world.canInteract=()=>!state.loading&&!routing&&!layoutError;
world.onChange=()=>scheduleSave();
function snapshot(){
  return createFactory({graph:state.graph,sources:Object.fromEntries([...state.sources].map(([id,data])=>[id,data.content])),
    layouts:[...state.layouts.values()],view:sceneView,camera:{...world.camera},selected:world.selected,tracing:state.tracing,
    time:world.time,speed:world.speed,playing:world.playing});
}
function scheduleSave(){if(!state.graph||state.loading||routing||layoutError)return;clearTimeout(saveTimer);$('save-status').textContent='Сохраняем…';saveTimer=setTimeout(persist,250);}
async function persist(){
  clearTimeout(saveTimer);if(!state.graph||state.loading||routing||layoutError||!sceneView)return false;
  const version=++saveVersion;$('save-status').textContent='Сохраняем…';
  try{await storage.save(snapshot());if(version===saveVersion)$('save-status').textContent='Сохранено в браузере';return true;}
  catch(error){if(version===saveVersion){$('save-status').textContent='Не сохранено';toast('Автосохранение недоступно. Сохраните JSON через «Экспорт». '+error.message);}return false;}
}
function runLayout(payload,version){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./layout-worker.js',import.meta.url),{type:'module'});
    const finish=()=>{worker.terminate();if(version===layoutVersion)cancelLayout=null;};
    cancelLayout=()=>{finish();resolve(null);};
    worker.onmessage=({data})=>{if(data.phase){if(version===layoutVersion){routingPhase=data.message;updateLoading();}return;}finish();data.error?reject(new Error(data.error)):resolve(data);};
    worker.onerror=event=>{finish();reject(new Error(event.message||'Ошибка построения маршрутов.'));};
    try{worker.postMessage(payload);}catch(error){finish();reject(error);}
  });
}
async function moveNode(node,position){
  if(state.loading||routing||layoutError)return;
  const version=++layoutVersion;cancelLayout?.();routing=true;routingPhase='';updateLoading();
  try{
    const result=await runLayout({action:'move',scene,id:node.id,position},version);
    if(!result||version!==layoutVersion)return;
    await rebuild({prepared:result.scene,keepCamera:true});
    if(await persist())toast('Положение блока сохранено');
  }catch(error){if(version===layoutVersion){toast('Блок не перемещён. '+error.message);}}
  finally{if(version===layoutVersion){routing=false;routingPhase='';updateLoading();}}
}
async function importFactory(factory){
  if(state.loading||routing)throw new Error('Дождитесь завершения построения фабрики.');
  clearTimeout(searchTimer);loading(true);cancelLayout?.();const version=++layoutVersion;world.cancelPointer();
  try{
    const result=await runLayout({action:'import',factory},version);
    if(!result||version!==layoutVersion)return;
    await setGraph(result.factory.graph,{factory:result.factory,prepared:result.scene,detached:true});
    loading(false);if(await persist())toast('Фабрика импортирована и сохранена');else toast('Фабрика импортирована; автосохранение недоступно');
  }finally{routingPhase='';loading(false);scheduleSave();}
}

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function api(path,options){const response=await fetch(path,options);const body=await response.json();if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);return body;}
function loading(value){state.loading=value;document.querySelector('.sidebar').inert=value;world.cancelPointer();updateLoading();}
function updateLoading(){const busy=state.loading||routing;$('loading').hidden=!busy;$('export-btn').disabled=busy||layoutError||!state.graph;for(const id of ['analyze-btn','demo-btn','open-btn','import-btn'])$(id).disabled=state.loading;$('import-btn').disabled=busy;$('reflow-btn').disabled=busy||layoutError||!scene.edges.length;$('status-text').textContent=routing?(routingPhase?'Оптимизируем фабрику…':'Прокладываем маршруты…'):state.loading?'Строим граф потоков…':layoutError?'Маршруты не построены':state.graph?'Фабрика готова':'Не удалось загрузить фабрику';document.querySelector('#loading strong').textContent=routingPhase?'Оптимизируем фабрику':'Прокладываем конвейеры';document.querySelector('#loading span').textContent=routingPhase||(routing?'Размещаем ленты, мосты и железную дорогу…':'Загрузка типов и построение SSA…');}
async function setGraph(graph,{factory=null,prepared=null,sources={},detached=false}={}){
  clearTimeout(searchTimer);state.layouts=new Map((factory?.layouts||[]).map(r=>[viewKey(r.view),r]));state.detached=detached;
  state.graph=graph;state.sources=new Map(Object.entries(factory?.sources||sources).map(([id,content])=>[id,{path:graph.files[id],content}]));state.sourceVersion++;state.fn='';state.pkg='';state.part=0;state.query='';state.selected=null;state.tracing=false;$('search').value='';
  $('project-title').textContent=graph.projects.length===1?graph.projects[0].module:`${graph.projects.length} связанных проекта`;
  $('function-count').textContent=graph.functions.length;
  $('warnings').replaceChildren(...graph.warnings.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));
  // Start in the orchestrating function; the overview remains one click away.
  const main=graph.functions.find(f=>f.name==='Run')||graph.functions.find(f=>f.name==='main');
  if(main&&graph.nodes.length<=LARGE_GRAPH_NODES)state.fn=main.id;
  if(factory){Object.assign(state,factory.view);state.selected=factory.selected?{id:factory.selected}:null;state.tracing=factory.tracing;world.speed=factory.speed;world.playing=factory.playing;world.time=factory.time;}
  $('search').value=state.query;document.querySelectorAll('[data-layer]').forEach(input=>input.checked=state.layers[input.dataset.layer]!==false);
  updatePlay();$('speed-btn').textContent=world.speed+'×';
  return await rebuild({prepared,camera:factory?.camera});
}
function functionList(){
  const graph=state.graph,q=state.query.toLowerCase(),container=$('functions');container.replaceChildren();
  if(innerWidth<=600&&!q)return;
  const modules=new Map();
  const countMap=new Map();for(const n of graph.nodes)countMap.set(n.function,(countMap.get(n.function)||0)+1);
  for(const fn of graph.functions){if(state.pkg&&fn.package!==state.pkg)continue;const matches=!q||fn.id.toLowerCase().includes(q)||graph.nodes.some(n=>n.function===fn.id&&[n.label,n.type,...(n.names||[])].join(' ').toLowerCase().includes(q));if(!matches)continue;if(!modules.has(fn.package))modules.set(fn.package,[]);modules.get(fn.package).push(fn);}
  for(const [module,funcs]of modules){const title=document.createElement('div');title.className='module-title';title.textContent=module;container.append(title);for(const fn of funcs){const button=document.createElement('button');button.className='function-btn'+(state.fn===fn.id?' active':'');button.title=fn.id;button.innerHTML=`<span class="fn-icon" style="color:${factoryStyle(fn.id).color}">ƒ</span><span class="fn-name">${escapeHTML(fn.name)}</span><span class="count">${countMap.get(fn.id)||0}</span>`;button.onclick=()=>{state.fn=fn.id;state.part=0;state.query='';$('search').value='';state.selected=null;state.tracing=false;rebuild();};container.append(button);}}
}
async function rebuild({prepared=null,keepCamera=false,camera=null,force=false}={}){
  if(!state.graph)return;functionList();
  const view=projectView(state.graph,{compact:state.compact,fn:state.fn,pkg:state.pkg,part:state.part,query:state.query,layers:state.layers});
  state.part=view.catalogType==='sections'?-1:view.sectionIndex||0;
  const version=++layoutVersion;cancelLayout?.();routing=true;layoutError=false;routingPhase='';updateLoading();
  try{
    const record=force?null:state.layouts.get(viewKey(state));
    const result=prepared?{scene:prepared}:await runLayout(record?{record,graph:state.graph}:{view,functions:state.graph.functions,focus:state.fn},version);
    if(!result||version!==layoutVersion)return false;
    scene=result.scene;world.trace=null;world.setScene(scene,{keepCamera});if(camera){world.camera={...camera};world.updateZoom();world.drawMini();}renderCargoLegend();
    sceneView=viewOptions(state);state.layouts.set(viewKey(sceneView),saveLayout(sceneView,scene));
  }catch(error){if(version===layoutVersion){if(!force){layoutError=true;$('empty').textContent=error.message+' Выберите отдельный цех или сократите набор слоёв.';$('empty').hidden=false;}toast(force?'Не удалось перестроить. Предыдущая раскладка сохранена. '+error.message:error.message);}return false;}
  finally{if(version===layoutVersion){routing=false;routingPhase='';updateLoading();}}
  $('all-btn').classList.toggle('active',!state.fn&&!state.pkg);$('compact-btn').classList.toggle('selected',state.compact);$('detail-btn').classList.toggle('selected',!state.compact);
  $('compact-btn').disabled=$('detail-btn').disabled=view.mode!=='operations';
  const fn=state.graph.functions.find(f=>f.id===state.fn);
  $('world-eyebrow').textContent=fn?fn.package.toUpperCase():'GO → FACTORY';$('view-title').textContent=state.query?`Поиск: ${state.query}`:fn?fn.name+' · производственная линия':'Вся фабрика';
  if(view.mode==='packages')$('view-title').textContent='Пакеты проекта';
  if(view.mode==='catalog'&&!state.query)$('view-title').textContent=view.catalogType==='sections'?(fn?.name||'Функция')+' · участки':view.title+' · функции';
  const bridges=scene.edges.reduce((sum,e)=>sum+e.bridges.length,0);
  $('view-subtitle').textContent=`${scene.nodes.length} ${plural(scene.nodes.length,['объект','объекта','объектов'])} · ${scene.edges.length} ${plural(scene.edges.length,['маршрут','маршрута','маршрутов'])} · ${bridges} ${plural(bridges,['мост','моста','мостов'])}`;
  if(view.mode==='packages')$('view-subtitle').textContent=`${view.nodes.length} пакетов · ${state.graph.functions.length} функций · ${state.graph.nodes.length} объектов SSA`;
  if(view.mode==='catalog')$('view-subtitle').textContent=view.catalogType==='sections'?`${view.nodes.length} участков · ${view.operationCount} операций`:`${view.nodes.length} функций · каталог цехов`;
  $('explorer-note').textContent=view.mode==='packages'?'Откройте пакет или выберите функцию слева.':view.mode==='catalog'?'Выберите цех или участок, чтобы построить конвейеры.':view.sectionCount?`${view.operationCount} операций в ${view.sectionCount} участках. Связи с другими участками показаны переходами ↗.`:'';
  $('explorer-note').hidden=!$('explorer-note').textContent;
  $('section-controls').hidden=!view.sectionCount;
  $('section-label').textContent=`Участок ${state.part+1} / ${view.sectionCount||1}`;
  $('section-prev').disabled=!state.part;$('section-next').disabled=state.part+1>=view.sectionCount;
  const optimization=scene.optimization,summary=$('optimization-status');summary.hidden=!scene.manual&&(!optimization&&!scene.assembly||!view.nodes.length);
  if(scene.manual){summary.textContent='Ручная раскладка · положение блоков сохраняется';summary.title='Перетаскивайте блоки. Ленты и рельсы перестраиваются после отпускания.';}
  else if(scene.assembly&&!optimization){summary.textContent=`Сборка по связям · объединений: ${scene.assembly.merges.length}`;summary.title='Сохранённая сборка связанных блоков. Мышью можно перемещать отдельный блок.';}
  if(optimization){
    const {before,after}=optimization,reduction=(a,b)=>a?Math.max(0,Math.round((a-b)/a*100)):0;
    const area=reduction(before.area,after.area),length=reduction(before.length,after.length);
    summary.textContent=area||length?`После оптимизации: площадь −${area}% · пути −${length}%`
      :after.area<before.area||after.length<before.length-1e-7?'После оптимизации: сокращение менее 1%'
      :after.bridges<before.bridges?`После оптимизации: мостов ${after.bridges} вместо ${before.bridges}`
      :'Оптимизация завершена · более компактный вариант не найден';
    summary.title=`Площадь: ${before.area} → ${after.area} тайл.²; длина путей: ${Math.round(before.length)} → ${Math.round(after.length)} тайл.; мосты: ${before.bridges} → ${after.bridges}; сближено блоков: ${optimization.moved||0}; объединений: ${optimization.merged||0}; перенесено групп: ${optimization.movedGroups||0}`;
    if(optimization.final)summary.title+=`; финальное сокращение путей: ${Math.round(optimization.final.before.length)} → ${Math.round(optimization.final.after.length)} тайл.`;
  }
  $('empty').textContent='Нет объектов для текущего фильтра.';
  $('empty').hidden=!!view.nodes.length;
  const count=kind=>state.graph.nodes.filter(n=>n.kind===kind).length;
  const trains=state.graph.edges.filter(e=>e.kind==='train').length;
  $('stats').innerHTML=`<span><b>${state.graph.projects.length}</b> ${plural(state.graph.projects.length,['модуль','модуля','модулей'])}</span><span><b>${count('warehouse')}</b> ${plural(count('warehouse'),['склад','склада','складов'])}</span><span><b>${count('rocket')}</b> ${plural(count('rocket'),['ракета','ракеты','ракет'])}</span><span><b>${trains}</b> ${plural(trains,['ж/д путь','ж/д пути','ж/д путей'])}</span>`;
  if(state.selected)state.selected=scene.nodes.find(n=>n.id===state.selected.id)||null;
  world.selected=state.selected?.id||'';if(state.tracing&&state.selected)world.trace=traceGraph(scene,state.selected.id);renderInspection();
  scheduleSave();return true;
}
function selectNode(node){if(node?.isPackage){state.pkg=node.package;state.fn='';state.part=0;state.query='';$('search').value='';state.selected=null;state.tracing=false;rebuild();return;}if(node?.isSectionHub){state.part=-1;state.selected=null;state.tracing=false;rebuild();return;}if(node?.isSection){state.part=node.sectionIndex;state.selected=null;state.tracing=false;rebuild();return;}if(node?.isPortal){state.pkg=state.graph.functions.find(f=>f.id===node.function)?.package||'';state.fn=node.function;state.part=0;state.selected=null;state.tracing=false;rebuild();return;}state.selected=node;state.tracing=false;world.selected=node?.id||'';world.trace=null;renderInspection();if(node&&innerWidth<=900){$('inspector').style.display='block';$('inspector').style.position='absolute';$('inspector').style.right='12px';$('inspector').style.top='135px';$('inspector').style.bottom='100px';$('inspector').style.width='270px';$('inspector').style.zIndex='5';}else if(!node&&innerWidth<=900){$('inspector').removeAttribute('style');}}
function preview(node){const canvas=$('object-preview');if(!canvas)return;const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,340,270);c.scale(2,2);drawBuilding(c,{...node,x:82,y:80,order:0},1);}
function renderCargoLegend(){
  const types=[...new Set(scene.edges.flatMap(cargoTypes))].sort(),list=$('cargo-types');
  $('cargo-legend').hidden=!types.length;$('cargo-count').textContent=types.length;
  list.replaceChildren(...types.map(type=>{
    const style=cargoStyle(type),row=document.createElement('div'),icon=document.createElement('canvas'),label=document.createElement('span');
    row.className='cargo-type';row.title=style.label;icon.width=40;icon.height=40;icon.setAttribute('aria-hidden','true');
    const c=icon.getContext('2d');c.scale(2,2);drawCargoShape(c,style,10,10,13,13);
    label.textContent=style.label;label.style.color=style.color;row.append(icon,label);return row;
  }));
}
function renderInspection(){
  scheduleSave();
  const pane=$('inspection'),node=state.selected;
  if(!node){
    pane.innerHTML=`<div class="inspect-preview"><span class="preview-badge">FACTORY CONTROL</span><canvas id="object-preview" width="340" height="270"></canvas></div><div class="inspect-kind">Фабрика вашего кода</div><h3 class="inspect-title">От значения до отправки</h3><p class="inspect-description">Выберите станок на карте, чтобы увидеть исходный код и проследить путь его груза.</p><div class="quick-stats"><div class="quick-stat"><strong>${state.graph.functions.length}</strong><span>производственных линий</span></div><div class="quick-stat"><strong>${state.graph.edges.length}</strong><span>связей между значениями</span></div></div><div class="source-label">ОБЪЕКТЫ НА КАРТЕ <span>${scene.nodes.length}</span></div><div class="object-list" id="object-list"></div><p class="inspector-note">Движение иллюстрирует связи в коде. Частота грузов и поездов не означает реальную нагрузку.</p>`;
    preview({kind:'machine',function:state.fn});const list=$('object-list');for(const n of scene.nodes.slice(0,200)){const button=document.createElement('button');button.title=n.label;button.innerHTML=`<span style="color:${factoryStyle(n).color}">◇</span>${escapeHTML(n.label)}`;button.onclick=()=>{world.centerNode(n.id);selectNode(n);};list.append(button);}return;
  }
  const fn=state.graph.functions.find(f=>f.id===node.function),file=state.graph.files[node.source.file]||'',incoming=scene.edges.filter(e=>e.to===node.id),outgoing=scene.edges.filter(e=>e.from===node.id);
  pane.innerHTML=`<div class="inspect-preview"><span class="preview-badge">${escapeHTML(node.isJunction?'ТРАНСПОРТНЫЙ УЗЕЛ':node.protocol?node.protocol.toUpperCase():'SSA OBJECT')}</span><canvas id="object-preview" width="340" height="270"></canvas></div><div class="inspect-kind" style="color:${palette[node.kind]}">${escapeHTML(kindNames[node.kind])}</div><h3 class="inspect-title">${escapeHTML(node.label)}</h3><p class="inspect-description">${escapeHTML(node.reason||description(node.kind))}</p><div class="data-rows"><div class="data-row"><span>Цех</span><code>${escapeHTML(fn?.name||node.function)}</code></div><div class="data-row"><span>Цвет блока</span><code style="color:${factoryStyle(node).color}">${escapeHTML(node.method||fn?.name||node.function)}</code></div><div class="data-row"><span>Тип груза</span><code>${escapeHTML(node.type||'операция')}</code></div><div class="data-row"><span>Размер</span><code>${node.tileSize} × ${node.tileSize} тайл.</code></div><div class="data-row"><span>Вход / выход</span><code>${incoming.length} / ${outgoing.length}</code></div><div class="data-row"><span>Источник</span><code>${escapeHTML(file.split('/').pop())}:${node.source.line}</code></div></div><div class="source-label">GO · ИСХОДНЫЙ КОД <button id="source-btn" title="Открыть исходный файл">↗</button></div><pre class="source-preview" id="source-preview">Загружаем исходник…</pre><button class="trace-btn${state.tracing?' active':''}" id="trace-btn">${state.tracing?'✕ Сбросить подсветку':'⤳ Проследить груз'}</button><div class="source-label">ОПЕРАЦИЯ SSA</div><pre class="source-preview" style="padding:10px;white-space:pre-wrap">${escapeHTML(node.detail)}</pre><button class="quiet" id="clear-selection" style="margin-top:16px;width:100%">Снять выделение</button>`;
  preview(node);
  $('clear-selection').onclick=()=>selectNode(null);
  $('trace-btn').onclick=()=>{state.tracing=!state.tracing;world.trace=state.tracing?traceGraph(scene,node.id):null;renderInspection();};
  $('source-btn').onclick=()=>openSource(node);
  const version=state.sourceVersion;source(node.source.file).then(data=>{if(state.selected?.id!==node.id||version!==state.sourceVersion)return;const first=Math.max(1,node.source.line-2),last=node.source.line+3;$('source-preview').innerHTML=codeLines(data.content,node.source.line,first,last);}).catch(error=>{if(state.selected?.id===node.id)$('source-preview').textContent=error.message;});
}
function description(kind){return {source:'Значение появляется на входе и отправляется к операциям, которые его используют.',machine:'Станок преобразует входящие значения. Конвейеры показывают зависимости между операциями.',station:'Поезда перевозят значения между отправителями и получателями Go-канала.',warehouse:'Операция записи отправляет данные на постоянное хранение.',rocket:'Вызов API отправляет данные за границы процесса.',trash:'Значение больше не используется в этой части статической модели.',splitter:'Здесь поток зависит от условия или объединяет значения из нескольких ветвей.',output:'Значения возвращаются вызывающей функции.',memory:'Чтение или изменение рабочей памяти программы.'}[kind]||'';}
async function source(id){if(!id)throw new Error('У синтетической операции нет исходного файла.');if(!state.sources.has(id)){if(state.detached)throw new Error('Исходник не включён в этот JSON-снимок.');const version=state.sourceVersion;const data=await api('/api/source?id='+encodeURIComponent(id)+'&revision='+encodeURIComponent(state.graph.revision));if(version!==state.sourceVersion)throw new Error('Фабрика обновлена; выберите объект ещё раз.');state.sources.set(id,data);}return state.sources.get(id);}
function codeLines(content,active,first=1,last=Infinity){return content.split('\n').map((line,i)=>({line,num:i+1})).filter(l=>l.num>=first&&l.num<=last).map(l=>`<span class="code-line${l.num===active?' active':''}"><span class="line-number">${l.num}</span>${escapeHTML(l.line)||' '}</span>`).join('');}
async function openSource(node){try{const data=await source(node.source.file);$('source-path').textContent=data.path;$('full-source').innerHTML=codeLines(data.content,node.source.line);$('source-dialog').showModal();requestAnimationFrame(()=>$('full-source').querySelector('.active')?.scrollIntoView({block:'center'}));}catch(error){toast(error.message);}}
async function analyze(payload){loading(true);try{const graph=await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const bundle=await api('/api/snapshot?revision='+encodeURIComponent(graph.revision));const ready=await setGraph(bundle.graph,{sources:bundle.sources});$('project-dialog').close();if(ready)toast('Фабрика построена · '+graph.nodes.length+' объектов');}finally{loading(false);scheduleSave();}}

$('open-btn').onclick=()=>{$('project-error').hidden=true;$('project-dialog').showModal();};
$('import-btn').onclick=()=>$('import-file').click();
$('import-file').onchange=async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;if(state.loading||routing){toast('Дождитесь завершения построения фабрики.');return;}try{if(file.size>MAX_FACTORY_BYTES)throw new Error('JSON-файл больше 64 МиБ.');loading(true);const json=await file.text();loading(false);await importFactory(json);}catch(error){toast('Импорт не выполнен: '+error.message);}finally{loading(false);scheduleSave();}};
$('help-btn').onclick=()=>$('help-dialog').showModal();
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('project-form').onsubmit=async event=>{event.preventDefault();$('project-error').hidden=true;try{await analyze({roots:$('roots').value.split('\n').map(s=>s.trim()).filter(Boolean),tags:$('tags').value.trim()});}catch(error){$('project-error').textContent=error.message;$('project-error').hidden=false;}};
$('reflow-btn').onclick=async()=>{if(state.loading||routing||layoutError)return;if(await rebuild({force:true}))toast('Объекты размещены по связям');};
$('demo-btn').onclick=()=>analyze({demo:true}).catch(error=>toast(error.message));
$('all-btn').onclick=()=>{state.fn='';state.pkg='';state.part=0;state.query='';$('search').value='';selectNode(null);rebuild();};
$('section-all').onclick=()=>{state.part=-1;state.selected=null;rebuild();};
$('section-prev').onclick=()=>{state.part--;state.selected=null;rebuild();};$('section-next').onclick=()=>{state.part++;state.selected=null;rebuild();};
$('compact-btn').onclick=()=>{state.compact=true;rebuild();};$('detail-btn').onclick=()=>{state.compact=false;rebuild();};
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('search').value;rebuild();},180);};
document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{state.layers[input.dataset.layer]=input.checked;rebuild();});
function updatePlay(){$('play-btn').textContent=world.playing?'Ⅱ':'▶';$('play-btn').setAttribute('aria-label',world.playing?'Приостановить анимацию':'Продолжить анимацию');}
$('play-btn').onclick=()=>{world.playing=!world.playing;updatePlay();scheduleSave();};updatePlay();
$('speed-btn').onclick=()=>{const speeds=[.25,.5,1,2,4];world.speed=speeds[(speeds.indexOf(world.speed)+1)%speeds.length];$('speed-btn').textContent=world.speed+'×';scheduleSave();};
$('zoom-in').onclick=()=>world.zoom(1.25);$('zoom-out').onclick=()=>world.zoom(.8);$('fit-btn').onclick=()=>world.fit();
installExport({toast,getSnapshot:()=>{
  if(state.loading||routing||layoutError)return null;
  return {factory:structuredClone(snapshot()),graph:state.graph,scene,title:$('view-title').textContent+(state.fn?' · участок '+(state.part+1):''),project:$('project-title').textContent,
    camera:{...world.camera},viewport:{width:world.width,height:world.height},time:world.time,speed:world.speed,selected:world.selected,trace:world.trace?[...world.trace]:null};
}});
document.addEventListener('keydown',event=>{if(state.loading)return;if(['INPUT','TEXTAREA'].includes(event.target.tagName)||document.querySelector('dialog[open]'))return;if(event.code==='Space'){event.preventDefault();$('play-btn').click();}else if(event.key.toLowerCase()==='f'){world.fit();}else if(event.key==='/'){event.preventDefault();$('search').focus();}else if(event.key==='Escape'){world.cancelPointer();selectNode(null);}else if(event.key==='+'||event.key==='='){world.zoom(1.2);}else if(event.key==='-'){world.zoom(.8);}});
window.addEventListener('resize',()=>{if(state.graph)functionList();});
window.addEventListener('pagehide',()=>persist());
document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
try{
  loading(true);let restored=false;
  try{const saved=await storage.load();if(saved){const result=await runLayout({action:'import',factory:saved},++layoutVersion);if(result){await setGraph(result.factory.graph,{factory:result.factory,prepared:result.scene,detached:true});restored=true;}}}
  catch(error){toast('Не удалось восстановить автосохранение: '+error.message);}
  if(!restored){const bundle=await api('/api/snapshot');await setGraph(bundle.graph,{sources:bundle.sources});}
}catch(error){$('status-text').textContent='Ошибка загрузки';$('empty').textContent=error.message;$('empty').hidden=false;toast(error.message);}finally{loading(false);scheduleSave();}
