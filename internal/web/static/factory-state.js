export const FACTORY_FORMAT='fabririo-factory';
export const MAX_FACTORY_BYTES=64*1024*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const text=(v,fallback='')=>{check(v===undefined||typeof v==='string','Ожидалась строка в JSON фабрики.');return v??fallback;};
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const kinds=['machine','source','station','warehouse','rocket','trash','output','splitter','memory'];
const layers=[...kinds,'belt','train'];

function location(value){
  if(value===undefined)return {file:'',line:0};
  check(object(value)&&Number.isInteger(value.line)&&value.line>=0,'Некорректная ссылка на исходник.');
  return {file:text(value.file),line:value.line};
}
function unique(items,label){const ids=new Set();for(const item of items){check(item.id&&!ids.has(item.id),'Повторяющийся или пустой ID: '+label);ids.add(item.id);}return ids;}

export function validateGraph(input){
  check(object(input)&&input.version===1,'Неподдерживаемая версия графа фабрики.');
  for(const key of ['projects','functions','nodes','edges'])check(Array.isArray(input[key]),'В JSON отсутствует список '+key+'.');
  const projects=input.projects.map(p=>{check(object(p),'Некорректный проект.');return {path:text(p.path),module:text(p.module)};});
  const functions=input.functions.map(f=>{check(object(f),'Некорректная функция.');return {id:text(f.id),name:text(f.name),package:text(f.package),project:text(f.project),source:location(f.source)};});
  const functionIDs=unique(functions,'функция');
  const nodes=input.nodes.map(n=>{
    check(object(n)&&kinds.includes(n.kind)&&functionIDs.has(n.function),'Некорректный блок или его функция.');
    check(n.names==null||Array.isArray(n.names)&&n.names.every(v=>typeof v==='string'),'Некорректные имена переменных.');
    check(n.order===undefined||Number.isFinite(n.order),'Некорректный порядок блоков.');
    check(n.block===undefined||Number.isInteger(n.block),'Некорректный номер SSA-блока.');
    const result={kind:n.kind,source:location(n.source),names:n.names||[],order:n.order??0,block:n.block??0,helper:n.helper===true};
    for(const key of ['id','label','detail','function','method','package','type','protocol','reason'])result[key]=text(n[key]);
    return result;
  });
  const nodeIDs=unique(nodes,'блок');
  const edges=input.edges.map(e=>{
    check(object(e)&&nodeIDs.has(e.from)&&nodeIDs.has(e.to),'Связь ссылается на отсутствующий блок.');
    const result={};for(const key of ['id','from','to','kind','label','type'])result[key]=text(e[key]);return result;
  });unique(edges,'связь');
  check(input.warnings==null||Array.isArray(input.warnings)&&input.warnings.every(v=>typeof v==='string'),'Некорректные предупреждения.');
  check(input.files==null||object(input.files),'Некорректный список исходников.');
  const files=Object.fromEntries(Object.entries(input.files||{}).map(([id,path])=>[id,text(path)]));
  return {version:1,revision:text(input.revision),mode:text(input.mode,'static-ssa'),projects,functions,nodes,edges,warnings:input.warnings||[],files};
}

export function viewOptions(value={}){
  check(object(value),'Некорректные настройки вида.');
  const part=value.part??0;check(Number.isInteger(part)&&part>=-1,'Некорректный участок.');
  check(value.compact===undefined||typeof value.compact==='boolean','Некорректный режим SSA.');
  check(value.layers===undefined||object(value.layers),'Некорректные слои.');
  const selectedLayers={};for(const key of layers){if(value.layers?.[key]===undefined)continue;check(typeof value.layers[key]==='boolean','Некорректный слой.');if(!value.layers[key])selectedLayers[key]=false;}
  return {fn:text(value.fn),pkg:text(value.pkg),part,compact:value.compact??true,query:text(value.query),layers:selectedLayers};
}
export const viewKey = value => JSON.stringify(viewOptions(value));
export function defaultView(graph){const main=graph.functions.find(f=>f.name==='Run')||graph.functions.find(f=>f.name==='main');return viewOptions({fn:graph.nodes.length<=1200?main?.id||'':''});}

export function createFactory({graph,sources={},layouts=[],view,camera=null,selected='',tracing=false,time=0,speed=1,playing=true}){
  return {format:FACTORY_FORMAT,version:1,graph,sources,layouts,view:viewOptions(view),camera,selected,tracing,time,speed,playing};
}

// Called before replacing the live factory. A legacy CLI/plain graph is accepted.
export function parseFactory(value){
  let data=typeof value==='string'?JSON.parse(value.replace(/^\uFEFF/,'')):value;
  check(object(data),'JSON не содержит фабрику.');
  const legacy=data.format===undefined;
  if(!legacy)check(data.format===FACTORY_FORMAT&&data.version===1,'Неподдерживаемый формат или версия снимка фабрики.');
  const graph=validateGraph(legacy?data:data.graph);
  if(legacy)data={view:defaultView(graph)};
  const view=viewOptions(data.view),records=data.layouts??[];
  check(Array.isArray(records),'Некорректный список раскладок.');
  const checkView=v=>{check(!v.fn||graph.functions.some(f=>f.id===v.fn),'В снимке выбран отсутствующий цех.');check(!v.pkg||graph.functions.some(f=>f.package===v.pkg),'В снимке выбран отсутствующий пакет.');};
  checkView(view);
  const used=new Set(),layouts=records.map(r=>{
    check(object(r),'Некорректная раскладка.');const options=viewOptions(r.view);checkView(options);
    const key=viewKey(options);check(!used.has(key),'Повторяющаяся раскладка.');used.add(key);
    return {view:options,nodes:r.nodes,edges:r.edges,manual:r.manual===true,...(r.assembly===undefined?{}:{assembly:r.assembly})};
  });
  const camera=data.camera??null;
  check(camera===null||object(camera)&&finite(camera.x,-1e9,1e9)&&finite(camera.y,-1e9,1e9)&&finite(camera.zoom,.035,3),'Некорректная камера.');
  check(data.sources===undefined||object(data.sources),'Некорректные исходники.');
  const sources=Object.fromEntries(Object.entries(data.sources||{}).map(([id,content])=>{check(Object.hasOwn(graph.files,id),'Неизвестный исходный файл.');return [id,text(content)];}));
  const speed=data.speed??1,time=data.time??0;
  check([.25,.5,1,2,4].includes(speed)&&finite(time,0,1e12),'Некорректные параметры анимации.');
  for(const key of ['playing','tracing'])check(data[key]===undefined||typeof data[key]==='boolean','Некорректные настройки анимации или выделения.');
  return createFactory({graph,sources,layouts,view,camera,selected:text(data.selected),tracing:data.tracing??false,time,speed,playing:data.playing??true});
}

// IndexedDB avoids localStorage's small quota and keeps each save atomic.
export function factoryStore(indexedDB=globalThis.indexedDB){
  let database;
  const open=()=>database??=new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('Хранилище браузера недоступно.'));return;}
    const request=indexedDB.open('fabririo-factories',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('state');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Хранилище занято другой вкладкой.'));
  });
  const run=async(mode,value)=>{const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction('state',mode),store=tx.objectStore('state');
    const request=mode==='readonly'?store.get('current'):store.put(value,'current');
    tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error||new Error('Не удалось сохранить фабрику.'));tx.onerror=()=>reject(tx.error);
  });};
  return {load:()=>run('readonly'),save:value=>run('readwrite',value)};
}
