// Rendering is independent of Go analysis. Every displayed route retains its
// original SSA edge kind, including paths through hidden conversion operations.
import {TILE_SIZE, TileRouter, nodeTileSize, addTransportJunctions} from './routing.js';
import {optimizeFactory,optimizeRouteLengths,factoryMetrics} from './optimizer.js';
import {assembleFactory} from './assembly.js';
import {dependencyPositions} from './dependency-layout.js';
import {cargoTypes,mergeCargoTypes} from './appearance.js';
export {pointOnRoute} from './geometry.js';
export const palette={machine:'#d4b66e',source:'#b7c791',station:'#77c9b7',warehouse:'#8eb4c8',rocket:'#e9a076',trash:'#969f8b',output:'#bccb9e',splitter:'#d4bc7d',memory:'#a4b699'};
export const kindNames={machine:'Сборочный станок',source:'Источник груза',station:'Железнодорожная станция',warehouse:'Склад · запись в БД',rocket:'Ракета · отправка данных',trash:'Утилизация',output:'Выход из цеха',splitter:'Разветвитель',memory:'Рабочая память'};

export function visibleGraph(graph,{compact=true,fn='',query='',layers={}}={}){
  const q=query.trim().toLowerCase();
  const all=new Map(graph.nodes.map(n=>[n.id,n]));
  const allowed=new Set(graph.nodes.filter(n=>(!compact||!n.helper)&&layers[n.kind]!==false).map(n=>n.id));
  const outgoing=new Map();
  for(const e of graph.edges){if(!outgoing.has(e.from))outgoing.set(e.from,[]);outgoing.get(e.from).push(e);}
  const edges=[],seen=new Map();
  for(const id of allowed){
    const queue=(outgoing.get(id)||[]).map(e=>({...e,from:id}));
    const visited=new Set();
    for(let i=0;i<queue.length;i++){
      const e=queue[i],visitKey=e.to+'|'+e.kind+'|'+JSON.stringify(cargoTypes(e));if(e.to===id||visited.has(visitKey))continue;visited.add(visitKey);
      if(allowed.has(e.to)){
        if((e.kind==='train'&&layers.train===false)||(e.kind!=='train'&&layers.belt===false))continue;
        const key=`${id}|${e.to}|${e.kind}`;if(!seen.has(key)){const link={...e,id:key,cargoTypes:cargoTypes(e)};seen.set(key,link);edges.push(link);}else{const link=seen.get(key);link.cargoTypes=mergeCargoTypes([link,e]);}
      }else if(all.get(e.to)?.helper&&compact&&layers[all.get(e.to).kind]!==false){
        for(const next of outgoing.get(e.to)||[])queue.push({...next,from:id,kind:next.kind==='belt'?e.kind:next.kind,label:e.label});
      }
    }
  }
  let selected=new Set([...allowed].filter(id=>!fn||all.get(id).function===fn));
  if(fn){for(const e of edges){if(selected.has(e.from)&&all.get(e.from)?.function===fn)selected.add(e.to);if(selected.has(e.to)&&all.get(e.to)?.function===fn)selected.add(e.from);}}
  if(q){const matches=new Set([...selected].filter(id=>{const n=all.get(id);return [n.label,n.function,n.type,...(n.names||[])].join(' ').toLowerCase().includes(q);}));
    const neighbors=new Set(matches);for(const e of edges){if(matches.has(e.from))neighbors.add(e.to);if(matches.has(e.to))neighbors.add(e.from);}
    selected=new Set([...selected].filter(id=>neighbors.has(id)));
  }
  const result={nodes:graph.nodes.filter(n=>selected.has(n.id)),edges:edges.filter(e=>selected.has(e.from)&&selected.has(e.to))};
  if(fn&&compact){
    // Fold each neighboring workshop into a clickable building. Keep the
    // original data routes and train tracks at the module boundary.
    const portals=new Map(),remap=new Map();
    for(const n of result.nodes){if(n.function===fn)continue;const id='portal:'+n.function;remap.set(n.id,id);if(portals.has(id))continue;
      const peers=graph.nodes.filter(p=>p.function===n.function),priority=['warehouse','rocket','station','machine','output'];
      const trainPeer=peers.find(p=>result.edges.some(e=>e.kind==='train'&&(e.from===p.id||e.to===p.id)));
      const representative=trainPeer||priority.map(kind=>peers.find(p=>p.kind===kind)).find(Boolean)||n;
      const title=graph.functions?.find(f=>f.id===n.function)?.name||n.function.split('.').pop();
      portals.set(id,{...representative,id,kind:trainPeer?'station':representative.kind,function:n.function,label:title+' ↗',helper:false,isPortal:true,order:100000,detail:'Соседний цех. Нажмите, чтобы открыть все операции функции.',names:[]});
    }
    result.nodes=[...result.nodes.filter(n=>n.function===fn),...portals.values()];
    const used=new Map();result.edges=result.edges.map(e=>({...e,from:remap.get(e.from)||e.from,to:remap.get(e.to)||e.to})).filter(e=>{const key=e.from+'|'+e.to+'|'+e.kind;if(e.from===e.to)return false;if(used.has(key)){const link=used.get(key);link.cargoTypes=mergeCargoTypes([link,e]);return false;}used.set(key,e);return true;});
  }
  return result;
}

export function layoutGraph(view,functions,focus='',{optimize=true,onProgress,routingAttempts=5,maxRoutingAttempts=20,gaps=[6,10,16]}={}){
  const dependencies=view.edges;
  view=addTransportJunctions(view);
  if(!view.nodes.length)return {nodes:[],edges:[],districts:[],bounds:{x:0,y:0,w:300,h:200},tileSize:TILE_SIZE};
  onProgress?.('Собираем соседей по зависимостям…');
  let lastError;
  for(const gap of gaps){
    const placed=placeNodes(view,functions,focus,gap,dependencies);
    const priority=[];
    const attempts=gap===gaps.at(-1)?Math.max(routingAttempts,maxRoutingAttempts):routingAttempts;
    for(let attempt=0;attempt<attempts;attempt++){
    try{
      const router=new TileRouter(placed.nodes),edges=router.route(view.edges,priority);
      let minX=0,minY=0,maxX=300,maxY=200;
      for(const d of placed.districts){minX=Math.min(minX,d.x);minY=Math.min(minY,d.y);maxX=Math.max(maxX,d.x+d.w);maxY=Math.max(maxY,d.y+d.h);}
      for(const e of edges)for(const p of e.points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
      const scene={...placed,edges,tileSize:TILE_SIZE,bounds:{x:minX-64,y:minY-64,w:maxX-minX+128,h:maxY-minY+128}};
      if(!optimize)return scene;
      const prepared=optimizeFactory(scene,{onProgress});
      const assembled=assembleFactory(prepared,{onProgress});
      onProgress?.('Финальная оптимизация маршрутов…');
      const final=optimizeRouteLengths(assembled,{onProgress:message=>onProgress?.(`Финальная оптимизация · ${message}`)});
      const after=factoryMetrics(final.scene);
      return {...final.scene,optimization:{...prepared.optimization,after,rerouted:prepared.optimization.rerouted+final.rerouted,
        movedGroups:assembled.assemblyMoved,merged:assembled.assembly.merges.length,
        final:{before:factoryMetrics(assembled),after,rerouted:final.rerouted,passes:final.passes}}};
    }catch(error){lastError=error;if(!error.edge)break;const old=priority.indexOf(error.edge.id);if(old>=0)priority.splice(old,1);priority.unshift(error.edge.id);}
    }
  }
  throw lastError;
}

function placeNodes(view,functions,focus,gap,dependencies){
  const fnMap=new Map(functions.map(f=>[f.id,f]));
  const groups=new Map(),groupOf=new Map();
  const focused=focus&&view.nodes.some(n=>n.isPortal);
  for(const n of view.nodes){
    const id=focused?focus:n.function;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(n);groupOf.set(n.id,id);
  }
  const degree=new Map();
  for(const e of view.edges){degree.set(e.from,(degree.get(e.from)||0)+1);degree.set(e.to,(degree.get(e.to)||0)+1);}
  // Splitters are physical neighbours, but must not erase the original
  // machine's fan-out from the placement graph or demote a busy hub to a leaf.
  const routes=new Map(view.edges.map(e=>[e.id,e]));
  const links=[...view.edges,...dependencies.filter(e=>routes.get(e.id)?.from!==e.from||routes.get(e.id)?.to!==e.to)];
  const maxSize=Math.max(3,...view.nodes.map(n=>nodeTileSize(n,degree.get(n.id)||0))),stride=maxSize+gap;
  const workshops=[...groups].map(([id,nodes])=>{
    const positions=dependencyPositions(nodes,links);
    const width=(Math.max(...[...positions.values()].map(p=>p.x))+1)*stride+6;
    const height=(Math.max(...[...positions.values()].map(p=>p.y))+1)*stride+6;
    return {id,nodes,positions,width,height};
  });
  // Apply the same contact graph between workshops, so inter-function links
  // affect their positions instead of placing districts on an arbitrary shelf.
  const contacts=dependencies.map(e=>({...e,from:groupOf.get(e.from),to:groupOf.get(e.to)}));
  const workshopPositions=dependencyPositions(workshops,contacts);
  const columnWidths=new Map(),rowHeights=new Map();
  for(const d of workshops){const p=workshopPositions.get(d.id);columnWidths.set(p.x,Math.max(columnWidths.get(p.x)||0,d.width));rowHeights.set(p.y,Math.max(rowHeights.get(p.y)||0,d.height));}
  const offsets=sizes=>{const result=new Map();let offset=0;for(let i=0;i<=Math.max(...sizes.keys());i++){result.set(i,offset);offset+=(sizes.get(i)||0)+gap;}return result;};
  const columns=offsets(columnWidths),rows=offsets(rowHeights);
  const positions=new Map(),districts=[];
  for(const workshop of workshops){
    const {id,nodes,width,height}=workshop,slot=workshopPositions.get(id);
    const left=columns.get(slot.x),top=rows.get(slot.y);
    districts.push({id,name:fnMap.get(id)?.name||id,package:fnMap.get(id)?.package||'',x:left*TILE_SIZE,y:top*TILE_SIZE,w:width*TILE_SIZE,h:height*TILE_SIZE,count:nodes.length,nodeIds:nodes.map(n=>n.id)});
    for(const n of nodes){
      const p=workshop.positions.get(n.id),tileSize=nodeTileSize(n,degree.get(n.id)||0);
      const x=left+3+Math.floor(maxSize/2)+p.x*stride,y=top+3+Math.floor(maxSize/2)+p.y*stride;
      positions.set(n.id,{...n,x:(x+.5)*TILE_SIZE,y:(y+.5)*TILE_SIZE,tileSize,w:tileSize*TILE_SIZE,h:tileSize*TILE_SIZE});
    }
  }
  return {nodes:view.nodes.map(n=>positions.get(n.id)),districts};
}

export function traceGraph(graph,id){
  const result=new Set([id]);
  for(const reverse of [false,true]){const queue=[id],visited=new Set([id]),adj=new Map();
    for(const e of graph.edges){const from=reverse?e.to:e.from,to=reverse?e.from:e.to;if(!adj.has(from))adj.set(from,[]);adj.get(from).push(to);}
    for(let i=0;i<queue.length;i++){for(const to of adj.get(queue[i])||[]){if(!visited.has(to)){visited.add(to);result.add(to);queue.push(to);}}}
  }
  return result;
}
