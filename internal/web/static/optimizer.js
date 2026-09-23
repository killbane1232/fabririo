import {TILE_SIZE, TileRouter, rebuildRoute} from './routing.js';

const key = p => `${p.x},${p.y}`;
const steps = [{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const adjacent = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1;

function axisAt(edge, i) {
  const p=edge.cells[i], start=steps[edge.ports.start.dir], end=steps[edge.ports.end.dir];
  const a=edge.cells[i-1] || {x:p.x-start.x,y:p.y-start.y};
  const b=edge.cells[i+1] || {x:p.x-end.x,y:p.y-end.y};
  return a.x===b.x ? 'v' : a.y===b.y ? 'h' : 'turn';
}

export function factoryMetrics(scene) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,length=0,bridges=0;
  const include=(x,y)=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
  for(const n of scene.nodes){include(n.footprint.minX,n.footprint.minY);include(n.footprint.maxX,n.footprint.maxY);}
  for(const e of scene.edges){length+=e.length/TILE_SIZE;bridges+=e.bridges.length;for(const p of e.cells)include(p.x,p.y);}
  const width=scene.nodes.length?maxX-minX+1:0,height=scene.nodes.length?maxY-minY+1:0;
  return {width,height,area:width*height,length,bridges};
}

// Every candidate is checked as a complete factory, including crossings with
// unchanged routes. A local improvement is never allowed to break a neighbour.
export function validateTransport(scene) {
  const buildings=new Set(),ground=new Map(),upper=new Map(),clearance=new Set();
  const nodes=new Map(scene.nodes.map(n=>[n.id,n]));
  for(const n of scene.nodes){
    if(n.kind==='trash'&&n.tileSize!==1)return false;
    for(let x=n.footprint.minX;x<=n.footprint.maxX;x++)for(let y=n.footprint.minY;y<=n.footprint.maxY;y++){
      const k=key({x,y});if(buildings.has(k))return false;buildings.add(k);
    }
  }
  for(const e of scene.edges){
    if(e.cells.length<2)return false;
    for(const [id,p,port] of [[e.from,e.cells[0],e.ports.start],[e.to,e.cells.at(-1),e.ports.end]]){
      const n=nodes.get(id);if(!n)return false;
      const d=steps[port.dir],inside={x:p.x-d.x,y:p.y-d.y},f=n.footprint;
      if(inside.x<f.minX||inside.x>f.maxX||inside.y<f.minY||inside.y>f.maxY||p.layer)return false;
    }
    const visited=new Set();
    for(let i=0;i<e.cells.length;i++){
      const p=e.cells[i],k=key(p),map=p.layer?upper:ground;
      if(!Number.isInteger(p.x)||!Number.isInteger(p.y)||buildings.has(k)||visited.has(k)||map.has(k)||(i&&!adjacent(p,e.cells[i-1])))return false;
      if(p.layer!==0&&p.layer!==1 || e.kind==='train'&&p.layer)return false;
      visited.add(k);map.set(k,{edge:e.id,axis:axisAt(e,i),ramp:!!p.ramp});
    }
    // Keep a straight approach to the station/machine boundary.
    for(const [p,q,port] of [[e.cells[0],e.cells[1],e.ports.start],[e.cells.at(-1),e.cells.at(-2),e.ports.end]]){
      const d=steps[port.dir];if(q.x!==p.x+d.x||q.y!==p.y+d.y||q.layer)return false;
    }
    for(const bridge of e.bridges){
      const a=e.cells[bridge.first],b=e.cells[bridge.last];
      if(!a||!b||a.layer||b.layer||bridge.last-bridge.first<2||bridge.last-bridge.first>16)return false;
      if(a.x!==b.x&&a.y!==b.y)return false;
      for(let i=bridge.first+1;i<bridge.last;i++){
        const p=e.cells[i];if(!p.layer || (a.x===b.x?p.x!==a.x:p.y!==a.y))return false;
      }
      for(const k of bridge.envelope){if(clearance.has(k)||buildings.has(k))return false;clearance.add(k);}
    }
  }
  for(const [k,above] of upper){
    const below=ground.get(k);if(below&&(below.ramp||above.axis==='turn'||below.axis==='turn'||above.axis===below.axis))return false;
  }
  for(const e of scene.edges)for(const b of e.bridges){
    b.crossed=e.cells.slice(b.first+1,b.last).map(key).filter(k=>ground.has(k));
    if(!b.crossed.length)return false;
  }
  return true;
}

export function sceneWithGeometry(scene,nodes,edges) {
  if(!nodes.length)return {...scene,nodes,edges,bounds:{x:0,y:0,w:300,h:200}};
  // Recompute footprints without changing tile sizes or assigning new ports.
  new TileRouter(nodes);
  const nodeMap=new Map(nodes.map(n=>[n.id,n]));
  const districts=scene.districts.map(d=>{
    const members=(d.nodeIds||nodes.filter(n=>scene.districts.length===1||n.function===d.id).map(n=>n.id)).map(id=>nodeMap.get(id));
    if(!members.length)return {...d};
    const minX=Math.min(...members.map(n=>n.footprint.minX))-1,maxX=Math.max(...members.map(n=>n.footprint.maxX))+2;
    const minY=Math.min(...members.map(n=>n.footprint.minY))-3,maxY=Math.max(...members.map(n=>n.footprint.maxY))+2;
    return {...d,x:minX*TILE_SIZE,y:minY*TILE_SIZE,w:(maxX-minX)*TILE_SIZE,h:(maxY-minY)*TILE_SIZE};
  });
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const include=(x,y)=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
  for(const n of nodes){include(n.x-n.w/2,n.y-n.h/2);include(n.x+n.w/2,n.y+n.h/2);}
  for(const d of districts){include(d.x,d.y);include(d.x+d.w,d.y+d.h);}
  for(const e of edges)for(const p of e.points)include(p.x,p.y);
  return {...scene,nodes,edges,districts,bounds:{x:minX-64,y:minY-64,w:maxX-minX+128,h:maxY-minY+128}};
}

function better(candidate,current) {
  const a=factoryMetrics(candidate),b=factoryMetrics(current);
  return a.area<=b.area && a.length<=b.length+1e-7 && a.bridges<=b.bridges && (a.area<b.area||a.length<b.length-1e-7||a.bridges<b.bridges);
}

function compactAxis(scene,axis) {
  const blocked=new Set(),other=axis==='x'?'y':'x',suffix=axis.toUpperCase();
  let min=Infinity,max=-Infinity;
  const protect=v=>{blocked.add(v);min=Math.min(min,v);max=Math.max(max,v);};
  for(const n of scene.nodes)for(let v=n.footprint['min'+suffix];v<=n.footprint['max'+suffix];v++)protect(v);
  // A contraction creates a rigid object, not merely a label. Empty stripes
  // inside it cannot be removed without changing its established geometry.
  for(const group of scene.assembly?.groups||[]){
    const ids=new Set(group.nodeIds),members=scene.nodes.filter(n=>ids.has(n.id));
    if(!members.length)continue;
    const routes=new Set(group.edgeIds),cells=scene.edges.filter(e=>routes.has(e.id)).flatMap(e=>e.cells.map(p=>p[axis]));
    const first=Math.min(...members.map(n=>n.footprint['min'+suffix]),...cells),last=Math.max(...members.map(n=>n.footprint['max'+suffix]),...cells);
    for(let v=first;v<=last;v++)protect(v);
  }
  for(const e of scene.edges){
    for(let i=0;i<e.cells.length;i++){
      const p=e.cells[i],a=e.cells[i-1],b=e.cells[i+1];min=Math.min(min,p[axis]);max=Math.max(max,p[axis]);
      if(i<2||i>=e.cells.length-2||a[other]!==b[other]||p.ramp)protect(p[axis]);
    }
    // Preserve ramp dimensions and a complete tile of clearance on every side.
    for(const bridge of e.bridges)for(const p of [e.cells[bridge.first],e.cells[bridge.last]])for(let d=-1;d<=1;d++)protect(p[axis]+d);
  }
  // Retain room above each workshop for its name, even when all empty rows go.
  if(axis==='y')for(const d of scene.districts){
    const ids=new Set(d.nodeIds||scene.nodes.filter(n=>scene.districts.length===1||n.function===d.id).map(n=>n.id));
    const top=Math.min(...scene.nodes.filter(n=>ids.has(n.id)).map(n=>n.footprint.minY));
    for(let offset=1;offset<=3;offset++)protect(top-offset);
  }
  const removed=new Set(),shift=new Map();let count=0;
  for(let v=min;v<=max;v++){if(!blocked.has(v)){removed.add(v);count++;}shift.set(v,v-count);}
  if(!count)return scene;
  const move=p=>({...p,[axis]:shift.get(p[axis])??p[axis]});
  const nodes=scene.nodes.map(n=>{const p=move(n.tile);return {...n,x:(p.x+.5)*TILE_SIZE,y:(p.y+.5)*TILE_SIZE};});
  const edges=scene.edges.map(e=>rebuildRoute(e,e.cells.filter(p=>!removed.has(p[axis])).map(move)));
  const candidate=sceneWithGeometry(scene,nodes,edges);
  return validateTransport(candidate)&&better(candidate,scene)?candidate:scene;
}

function routerWithout(scene,excluded,nodes=scene.nodes) {
  const omitted=excluded instanceof Set?excluded:new Set([excluded]);
  const router=new TileRouter(nodes.map(n=>({...n})));
  for(const e of scene.edges){
    if(omitted.has(e.id))continue;
    const ports={};
    for(const side of ['start','end']){
      const p=e.ports[side],d=steps[p.dir],lead={x:p.x+d.x,y:p.y+d.y};ports[side]={...p,lead};
      for(const cell of [p,lead])router.reserved.set(key(cell),e.id);
    }
    router.ports.set(e.id,ports);
    for(let i=0;i<e.cells.length;i++){
      const p=e.cells[i],value={edge:e.id,kind:e.kind,axis:axisAt(e,i),ramp:!!p.ramp};
      (p.layer?router.overhead:router.ground).set(key(p),value);
    }
    for(const b of e.bridges)for(const k of b.envelope)router.bridgeClearance.add(k);
  }
  // A fixed-port reroute uses its original endpoints. Moving buildings, in
  // contrast, reassign all their incident ports around the unchanged routes.
  if(!(excluded instanceof Set)){
    const e=scene.edges.find(e=>e.id===excluded),ports={};
    for(const side of ['start','end']){
      const p=e.ports[side],d=steps[p.dir],lead={x:p.x+d.x,y:p.y+d.y};ports[side]={...p,lead};
      for(const cell of [p,lead])router.reserved.set(key(cell),e.id);
    }
    router.ports.set(e.id,ports);
  }
  return router;
}

function lowerUnusedBridges(edges) {
  const ground=new Set(edges.flatMap(e=>e.cells.filter(p=>!p.layer).map(key)));
  return edges.map(e=>{
    const cells=e.cells.map(p=>({...p}));
    for(const b of e.bridges){
      if(cells.slice(b.first+1,b.last).some(p=>ground.has(key(p))))continue;
      for(let i=b.first+1;i<b.last;i++)cells[i].layer=0;
    }
    return rebuildRoute(e,cells);
  });
}

// Translation is atomic: move every member and every internal route by the
// same grid vector, then reconnect only the assembly's external dependencies.
// No member is allowed to drift relative to another during a later merge.
export function translateAssembly(scene,nodeIDs,delta,{maxExpanded=5000}={}) {
  const members=new Set(nodeIDs);
  if(!Number.isInteger(delta.x)||!Number.isInteger(delta.y))throw new Error('Смещение группы должно быть целым числом тайлов.');
  const nodes=scene.nodes.map(n=>({...n,...(members.has(n.id)?{x:n.x+delta.x*TILE_SIZE,y:n.y+delta.y*TILE_SIZE}:{})}));
  const external=scene.edges.filter(e=>members.has(e.from)!==members.has(e.to));
  const edges=scene.edges.map(e=>members.has(e.from)&&members.has(e.to)?rebuildRoute(e,e.cells.map(p=>({...p,x:p.x+delta.x,y:p.y+delta.y}))):e);
  const router=routerWithout({...scene,edges},new Set(external.map(e=>e.id)),nodes);
  for(const k of router.buildings.keys())if(router.ground.has(k)||router.overhead.has(k)||router.bridgeClearance.has(k))throw new Error('Группа перекрывает другой маршрут.');
  const links=[...external].sort((a,b)=>(b.kind==='train')-(a.kind==='train')||a.id.localeCompare(b.id));
  router.assignPorts(links);
  const replacements=new Map();
  for(const edge of links){
    const chain=router.search(edge,12,{maxExpanded,weight:1});
    if(!chain)throw new Error('Не удалось подключить группу.');
    replacements.set(edge.id,router.commit(edge,chain,edge.index));
  }
  const candidate=sceneWithGeometry(scene,nodes,edges.map(e=>replacements.get(e.id)||rebuildRoute(e,e.cells)));
  if(!validateTransport(candidate))throw new Error('Перемещение группы создаёт пересечение.');
  return candidate;
}

// Move a building directly beside an actual dependency, then reroute ONLY its
// incident links. Unrelated routes stay fixed and remain obstacles. Accept a
// move only after the whole factory is valid and its actual metrics improve.
function neighborCandidates(scene) {
  const nodes=new Map(scene.nodes.map(n=>[n.id,n])),incident=new Map(scene.nodes.map(n=>[n.id,[]]));
  const transport=new Map(),occupy=(k,id)=>{if(!transport.has(k))transport.set(k,new Set());transport.get(k).add(id);};
  for(const e of scene.edges){incident.get(e.from).push(e);if(e.from!==e.to)incident.get(e.to).push(e);}
  for(const e of scene.edges){for(const p of e.cells)occupy(key(p),e.id);for(const b of e.bridges)for(const k of b.envelope)occupy(k,e.id);}
  const candidates=[];
  for(const node of scene.nodes){
    if(scene.assembly?.groups.some(g=>g.nodeIds.includes(node.id)&&g.nodeIds.length>1))continue;
    const links=incident.get(node.id);if(!links.length||links.length>4)continue;
    const excluded=new Set(links.map(e=>e.id));
    const neighbors=[...new Set(links.map(e=>e.from===node.id?e.to:e.from))].filter(id=>id!==node.id).map(id=>nodes.get(id));
    const district=scene.districts.find(d=>d.nodeIds?.includes(node.id));
    const length=links.reduce((sum,e)=>sum+e.length/TILE_SIZE,0),seen=new Set();
    for(const neighbor of neighbors)for(const gap of [2,3,4,6])for(const d of steps){
      const separation=(node.tileSize+neighbor.tileSize)/2+gap;
      const tile={x:neighbor.tile.x+d.x*separation,y:neighbor.tile.y+d.y*separation};
      const k=key(tile);if(seen.has(k)||(tile.x===node.tile.x&&tile.y===node.tile.y))continue;seen.add(k);
      const half=(node.tileSize-1)/2,f={minX:tile.x-half,maxX:tile.x+half,minY:tile.y-half,maxY:tile.y+half};
      // Keep distinct workshops separate; a focused view (including portals)
      // is one district, so all its directly linked blocks may be neighbours.
      if(district&&(f.minX*TILE_SIZE<district.x||f.minY*TILE_SIZE<district.y+2*TILE_SIZE||
          (f.maxX+1)*TILE_SIZE>district.x+district.w||(f.maxY+1)*TILE_SIZE>district.y+district.h))continue;
      if(scene.nodes.some(n=>n.id!==node.id&&!(f.maxX<n.footprint.minX||f.minX>n.footprint.maxX||f.maxY<n.footprint.minY||f.minY>n.footprint.maxY)))continue;
      let blocked=false;
      for(let x=f.minX;x<=f.maxX;x++)for(let y=f.minY;y<=f.maxY;y++){
        for(const id of transport.get(key({x,y}))||[])if(!excluded.has(id))blocked=true;
      }
      if(blocked)continue;
      const distance=links.reduce((sum,e)=>{
        const other=nodes.get(e.from===node.id?e.to:e.from);
        return sum+Math.abs(tile.x-other.tile.x)+Math.abs(tile.y-other.tile.y)-(node.tileSize+other.tileSize)/2;
      },0);
      // Include routed detours, not just centre distance: moving a leaf around
      // a blocked port can turn a map-wide loop into a short straight belt.
      const gain=length-distance;if(gain<=2)continue;
      candidates.push({id:node.id,tile,links,gain});
    }
  }
  return candidates.sort((a,b)=>b.gain/b.links.length-a.gain/a.links.length||b.gain-a.gain||a.id.localeCompare(b.id)||a.tile.x-b.tile.x||a.tile.y-b.tile.y);
}

function bringNeighborsCloser(initial,maxAttempts,onProgress){
  let scene=initial,moved=0;
  const movedIDs=new Set();
  let choices=maxAttempts?neighborCandidates(scene):[];
  for(let attempt=0;attempt<maxAttempts;attempt++){
    let choice;
    while(choices.length){const c=choices.shift();if(!movedIDs.has(c.id)){choice=c;break;}}
    if(!choice)break;
    onProgress(`Сближаем связанные блоки · ${attempt+1} / ${maxAttempts}`);
    try{
      const nodes=scene.nodes.map(n=>({...n,...(n.id===choice.id?{x:(choice.tile.x+.5)*TILE_SIZE,y:(choice.tile.y+.5)*TILE_SIZE}:{})}));
      const excluded=new Set(choice.links.map(e=>e.id)),router=routerWithout(scene,excluded,nodes);
      for(const k of router.buildings.keys())if(router.ground.has(k)||router.overhead.has(k)||router.bridgeClearance.has(k))throw new Error('Здание перекрывает действующий маршрут.');
      const links=[...choice.links].sort((a,b)=>(b.kind==='train')-(a.kind==='train')||a.id.localeCompare(b.id));
      router.assignPorts(links);
      const replacements=new Map();
      for(const e of links){
        const chain=router.search(e,12,{maxExpanded:5000,weight:1});
        if(!chain)throw new Error('Нет свободного подхода.');
        replacements.set(e.id,router.commit(e,chain,e.index));
      }
      const edges=lowerUnusedBridges(scene.edges.map(e=>replacements.get(e.id)||e));
      const candidate=sceneWithGeometry(scene,nodes,edges);
      if(validateTransport(candidate)&&better(candidate,scene)){
        scene=candidate;moved++;movedIDs.add(choice.id);choices=neighborCandidates(scene);
      }
    }catch{/* Keep the last valid scene if any incident route cannot follow. */}
  }
  return {scene,moved};
}

// Once assembly is finished, its internal routes may be shortened as well.
// Buildings and ports stay fixed; changing one route can free a shortcut for
// another, so revisit remaining detours until stable (with a bounded pass count).
export function optimizeRouteLengths(initial,{maxReroutes=initial.edges.length,maxPasses=3,protectGroups=false,onProgress=()=>{}}={}) {
  let scene=initial,rerouted=0,passes=0;
  const detour=e=>e.cells.length-1-Math.abs(e.cells[0].x-e.cells.at(-1).x)-Math.abs(e.cells[0].y-e.cells.at(-1).y);
  const fixed=new Set(protectGroups?(scene.assembly?.groups||[]).flatMap(g=>g.edgeIds):[]);
  for(let pass=0;pass<maxPasses;pass++){
    const candidates=scene.edges.filter(e=>!fixed.has(e.id)&&detour(e)>0)
      .sort((a,b)=>detour(b)-detour(a)||b.length-a.length||a.id.localeCompare(b.id)).slice(0,maxReroutes);
    if(!candidates.length)break;
    const previous=rerouted;passes++;
    for(let index=0;index<candidates.length;index++){
      const edge=scene.edges.find(e=>e.id===candidates[index].id);
      onProgress(`Сокращаем обходы · проход ${pass+1} / ${maxPasses} · ${index+1} / ${candidates.length}`);
      try{
        const router=routerWithout(scene,edge.id);
        const chain=router.search(edge,12,{maxExpanded:12000,weight:1});if(!chain)continue;
        const replacement=router.commit(edge,chain,edge.index);
        if(replacement.length>edge.length+1e-7)continue;
        const edges=lowerUnusedBridges(scene.edges.map(e=>e.id===edge.id?replacement:e));
        const candidate=sceneWithGeometry(scene,scene.nodes.map(n=>({...n})),edges);
        if(validateTransport(candidate)&&better(candidate,scene)){scene=candidate;rerouted++;}
      }catch{/* Keep the last complete, valid factory when a shortcut is blocked. */}
    }
    if(rerouted===previous)break;
  }
  return {scene,rerouted,passes};
}

export function optimizeFactory(initial,{maxReroutes=12,maxNeighborAttempts=48,onProgress=()=>{}}={}) {
  if(!initial.nodes.length)return {...initial,optimization:{before:factoryMetrics(initial),after:factoryMetrics(initial),rerouted:0}};
  let scene=initial;
  const before=factoryMetrics(initial);
  onProgress('Сжимаем свободные промежутки…');
  for(const axis of ['x','y'])scene=compactAxis(scene,axis);
  const neighbors=bringNeighborsCloser(scene,maxNeighborAttempts,onProgress);scene=neighbors.scene;
  const routes=optimizeRouteLengths(scene,{maxReroutes,maxPasses:1,protectGroups:true,onProgress});scene=routes.scene;
  onProgress('Уплотняем фабрику после сокращения маршрутов…');
  for(const axis of ['x','y'])scene=compactAxis(scene,axis);
  return {...scene,optimization:{before,after:factoryMetrics(scene),rerouted:routes.rerouted,moved:neighbors.moved}};
}
