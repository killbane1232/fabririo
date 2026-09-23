import {visibleGraph} from './graph.js';
import {cargoTypes,mergeCargoTypes} from './appearance.js';
import {TILE_SIZE,TileRouter} from './routing.js';

export const LARGE_GRAPH_NODES=1200;
export const SECTION_SIZE=24;

export function packageOverview(graph,layers={}){
  const groups=new Map(),byID=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const f of graph.functions){if(!groups.has(f.package))groups.set(f.package,[]);groups.get(f.package).push(f);}
  const nodes=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([pkg,functions],order)=>({
    id:'package:'+pkg,kind:'machine',label:pkg.split('/').slice(-2).join('/'),function:'Пакеты проекта',package:pkg,
    order,isPackage:true,source:functions[0].source,names:[],type:`${functions.length} функций`,
    detail:`Пакет ${pkg}. Откройте его, чтобы выбрать производственную линию.`,
  }));
  const links=new Map();
  for(const e of graph.edges){
    const from=byID.get(e.from)?.package,to=byID.get(e.to)?.package;
    if(!from||!to||from===to||!groups.has(from)||!groups.has(to))continue;
    const kind=e.kind==='train'?'train':'call';if(layers[kind==='train'?'train':'belt']===false)continue;
    const id=`package:${from}|${to}|${kind}`;
    if(!links.has(id))links.set(id,{id,from:'package:'+from,to:'package:'+to,kind,count:0,cargoTypes:cargoTypes(e)});
    links.get(id).count++;links.get(id).cargoTypes=mergeCargoTypes([links.get(id),e]);
  }
  const edges=[...links.values()].map(e=>({...e,label:`${e.count} связей между пакетами`}));
  return {nodes,edges,mode:'packages'};
}

function functionCatalog(graph,{pkg='',query=''}){
  const q=query.trim().toLowerCase(),matches=new Set();
  if(q)for(const n of graph.nodes){if([n.label,n.type,...(n.names||[])].join(' ').toLowerCase().includes(q))matches.add(n.function);}
  const functions=graph.functions.filter(f=>(!pkg||f.package===pkg)&&(!q||[f.name,f.id].join(' ').toLowerCase().includes(q)||matches.has(f.id)));
  const nodes=functions.map((f,order)=>({id:'function:'+f.id,kind:'machine',function:f.id,package:f.package,label:f.name,source:f.source,order,isPortal:true,names:[],type:'Функция Go'}));
  return {nodes,edges:[],mode:'catalog',title:pkg?pkg.split('/').slice(-2).join('/'):'Результаты поиска'};
}

// A section contains every selected operation and all of its incoming/outgoing
// edges. Endpoints in another section become portals instead of disappearing.
export function sectionView(view,fn,part=0){
  const own=view.nodes.filter(n=>n.function===fn&&!n.isPortal).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id,undefined,{numeric:true}));
  const total=Math.ceil(own.length/SECTION_SIZE);
  if(own.length<=48)return {...view,mode:'operations',sectionCount:0,sectionIndex:0};
  if(part<0){
    const nodes=Array.from({length:total},(_,i)=>({...own[i*SECTION_SIZE],id:'section:'+fn+':'+i,kind:'machine',label:`Участок ${i+1}`,order:i,isSection:true,sectionIndex:i}));
    return {nodes,edges:[],mode:'catalog',catalogType:'sections',operationCount:own.length,title:'Участки функции'};
  }
  part=Math.max(0,Math.min(total-1,part));
  const membership=new Map(own.map((n,i)=>[n.id,Math.floor(i/SECTION_SIZE)]));
  const selected=new Set(own.slice(part*SECTION_SIZE,(part+1)*SECTION_SIZE).map(n=>n.id));
  const byID=new Map(view.nodes.map(n=>[n.id,n])),nodes=own.filter(n=>selected.has(n.id)),portals=new Map(),edges=[];
  const endpoint=(id,kind,inbound)=>{
    if(selected.has(id))return id;
    const node=byID.get(id),section=membership.get(id),hub=section!==undefined&&total>5;
    const key=section===undefined?'portal:'+node.function:hub?'section-hub:'+fn+':'+inbound:'section:'+fn+':'+section;
    if(!portals.has(key))portals.set(key,{...node,id:key,kind:kind==='train'?'station':node.kind,
      label:section===undefined?node.label:hub?(inbound?'Входы других участков ↗':'Другие участки ↗'):`Участок ${section+1} ↗`,isPortal:section===undefined,isSection:section!==undefined&&!hub,isSectionHub:hub,
      sectionIndex:section,order:100000+(section||0),helper:false});
    if(kind==='train')portals.get(key).kind='station';
    return key;
  };
  const links=new Map();
  for(const e of view.edges){
    if(!selected.has(e.from)&&!selected.has(e.to))continue;
    const from=endpoint(e.from,e.kind,true),to=endpoint(e.to,e.kind,false),key=`${from}|${to}|${e.kind}`;
    if(!links.has(key)){const link={...e,from,to,edgeIDs:[],count:0};links.set(key,link);edges.push(link);}
    links.get(key).edgeIDs.push(e.id);links.get(key).count++;links.get(key).cargoTypes=mergeCargoTypes([links.get(key),e]);
  }
  return {nodes:[...nodes,...portals.values()],edges,mode:'operations',sectionIndex:part,sectionCount:total,operationCount:own.length};
}

export function projectView(graph,options={}){
  if(graph.nodes.length>LARGE_GRAPH_NODES&&!options.fn){
    return options.pkg||options.query?functionCatalog(graph,options):packageOverview(graph,options.layers);
  }
  const view=visibleGraph(graph,options);
  return options.fn?sectionView(view,options.fn,options.part):{...view,mode:'operations'};
}

// A catalog is a navigable directory of workshops, not a partial data-flow graph.
export function layoutCatalog(view){
  const columns=Math.max(1,Math.ceil(Math.sqrt(view.nodes.length))),stride=7;
  const nodes=view.nodes.map((n,i)=>({...n,x:(3+i%columns*stride+.5)*TILE_SIZE,y:(4+Math.floor(i/columns)*stride+.5)*TILE_SIZE,tileSize:3}));
  new TileRouter(nodes);
  return {nodes,edges:[],districts:[],tileSize:TILE_SIZE,bounds:{x:0,y:0,w:(columns*stride+1)*TILE_SIZE,h:(Math.ceil(nodes.length/columns)*stride+3)*TILE_SIZE},mode:view.mode};
}
