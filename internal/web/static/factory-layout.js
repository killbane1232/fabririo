import {TILE_SIZE,TileRouter,nodeTileSize,addTransportJunctions,rebuildRoute} from './routing.js';
import {sceneWithGeometry,validateTransport} from './optimizer.js';
import {projectView} from './explorer.js';
import {restoreAssembly} from './assembly.js';

export const snapPosition = value => (Math.round(value/TILE_SIZE-.5)+.5)*TILE_SIZE;
const coordinate = v => Number.isFinite(v)&&Math.abs(v)<=1000000;
const check = (ok,message) => {if(!ok)throw new Error(message);};

// Routing may change, but manual placement must never move any other building.
export function moveBuilding(scene,id,position){
  check(coordinate(position.x)&&coordinate(position.y),'Положение блока выходит за границы карты.');
  check(scene.nodes.some(n=>n.id===id),'Блок отсутствует на карте.');
  const nodes=scene.nodes.map(n=>({...n,...(n.id===id?{x:snapPosition(position.x),y:snapPosition(position.y)}:{})}));
  new TileRouter(nodes); // Reject overlapping footprints before routing.
  let error;
  const priority=[];
  for(let attempt=0;attempt<12;attempt++){
    try{
      const edges=new TileRouter(nodes).route(scene.edges,priority);
      const next=sceneWithGeometry({...scene,assembly:undefined,assemblyMoved:undefined,optimization:null,manual:true},nodes,edges);
      check(validateTransport(next),'Не удалось проложить маршруты в выбранном положении.');
      return next;
    }catch(e){error=e;if(!e.edge)break;const old=priority.indexOf(e.edge.id);if(old>=0)priority.splice(old,1);priority.unshift(e.edge.id);}
  }
  throw error;
}

// Save only authoritative grid data; rendered geometry is reconstructed on load.
export function saveLayout(view,scene){
  return {view:{...view,layers:{...view.layers}},manual:!!scene.manual,
    ...(scene.assembly?{assembly:structuredClone(scene.assembly)}:{}),
    nodes:scene.nodes.map(({id,x,y})=>({id,x,y})),
    edges:scene.edges.map(({id,cells,ports})=>({id,cells:cells.map(({x,y,layer})=>({x,y,layer})),
      startDir:ports.start.dir,endDir:ports.end.dir}))};
}

export function restoreLayout(graph,record){
  const view=projectView(graph,record.view),expected=view.mode==='catalog'?view:addTransportJunctions(view);
  check(Array.isArray(record.nodes)&&Array.isArray(record.edges),'Повреждена сохранённая раскладка.');
  check(record.nodes.length===expected.nodes.length&&record.edges.length===expected.edges.length,'Раскладка не соответствует графу фабрики.');
  const positions=new Map(record.nodes.map(n=>[n?.id,n]));
  const routes=new Map(record.edges.map(e=>[e?.id,e]));
  check(positions.size===record.nodes.length&&routes.size===record.edges.length,'В раскладке повторяются идентификаторы.');
  const degree=new Map();for(const e of expected.edges){degree.set(e.from,(degree.get(e.from)||0)+1);degree.set(e.to,(degree.get(e.to)||0)+1);}
  const expectedNodes=new Map(expected.nodes.map(n=>[n.id,n]));
  const nodes=record.nodes.map(p=>{
    const n=expectedNodes.get(p.id);check(n,'Блок не соответствует графу фабрики.');
    check(p&&coordinate(p.x)&&coordinate(p.y)&&snapPosition(p.x)===p.x&&snapPosition(p.y)===p.y,'Некорректные координаты блока.');
    return {...n,x:p.x,y:p.y,tileSize:nodeTileSize(n,degree.get(n.id)||0)};
  });
  new TileRouter(nodes);
  const expectedEdges=new Map(expected.edges.map(e=>[e.id,e]));
  const edges=record.edges.map((r,index)=>{
    const e=expectedEdges.get(r.id);check(e,'Маршрут не соответствует графу фабрики.');
    check(r&&Array.isArray(r.cells)&&r.cells.length>=2&&r.cells.length<=100000,'Повреждён маршрут фабрики.');
    check([r.startDir,r.endDir].every(d=>Number.isInteger(d)&&d>=0&&d<4),'Некорректное направление порта.');
    check(r.cells.every(p=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&coordinate(p.x*TILE_SIZE)&&coordinate(p.y*TILE_SIZE)&&(p.layer===0||p.layer===1)),'Некорректные тайлы маршрута.');
    return rebuildRoute({...e,index,ports:{start:{dir:r.startDir},end:{dir:r.endDir}}},r.cells);
  });
  const groups=new Map(),focused=record.view.fn&&nodes.some(n=>n.isPortal);
  if(view.mode!=='catalog')for(const n of nodes){const id=focused?record.view.fn:n.function;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(n.id);}
  const functions=new Map(graph.functions.map(f=>[f.id,f]));
  const districts=[...groups].map(([id,nodeIds])=>({id,name:functions.get(id)?.name||id,package:functions.get(id)?.package||'',count:nodeIds.length,nodeIds}));
  const assembly=restoreAssembly(record.assembly,nodes,edges);
  const scene=sceneWithGeometry({districts,tileSize:TILE_SIZE,manual:!!record.manual,...(assembly?{assembly}:{})},nodes,edges);
  check(validateTransport(scene),'Сохранённая фабрика содержит пересечения или разорванные маршруты.');
  return scene;
}
