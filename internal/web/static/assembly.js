import {TILE_SIZE} from './routing.js';
import {factoryMetrics,translateAssembly} from './optimizer.js';

const compare=(a,b)=>a.localeCompare(b,undefined,{numeric:true});
const steps=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const straight=edge=>!edge.bridges.length&&(edge.cells.every(p=>p.x===edge.cells[0].x)||edge.cells.every(p=>p.y===edge.cells[0].y));
const crossing=(edges,a,b)=>edges.filter(e=>(a.has(e.from)&&b.has(e.to))||(b.has(e.from)&&a.has(e.to)));
const internal=(edges,ids)=>edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>e.id);

function contacts(groups,edges){
  const owner=new Map(),adj=new Map([...groups.keys()].map(id=>[id,new Map()]));
  for(const g of groups.values())for(const id of g.nodeIds)owner.set(id,g.id);
  for(const edge of edges){
    const a=owner.get(edge.from),b=owner.get(edge.to);if(a===b)continue;
    for(const [from,to] of [[a,b],[b,a]]){
      const links=adj.get(from);if(!links.has(to))links.set(to,[]);links.get(to).push(edge);
    }
  }
  return adj;
}

function shifts(scene,moving,links){
  const nodes=new Map(scene.nodes.map(n=>[n.id,n])),ids=new Set(moving.nodeIds),seen=new Set(),result=[];
  for(const edge of links){
    const node=nodes.get(ids.has(edge.from)?edge.from:edge.to),neighbor=nodes.get(ids.has(edge.from)?edge.to:edge.from);
    for(const gap of [2,3,4,6,8,12])for(const d of steps){
      const separation=(node.tileSize+neighbor.tileSize)/2+gap;
      const delta={x:neighbor.tile.x+d.x*separation-node.tile.x,y:neighbor.tile.y+d.y*separation-node.tile.y};
      const key=`${delta.x},${delta.y}`;if(seen.has(key)||(!delta.x&&!delta.y))continue;seen.add(key);
      const members=scene.nodes.filter(n=>ids.has(n.id));
      if(members.some(n=>scene.nodes.some(other=>!ids.has(other.id)&&!(
        n.footprint.maxX+delta.x<other.footprint.minX||n.footprint.minX+delta.x>other.footprint.maxX||
        n.footprint.maxY+delta.y<other.footprint.minY||n.footprint.minY+delta.y>other.footprint.maxY))))continue;
      const distance=links.reduce((sum,e)=>{
        const a=nodes.get(e.from),b=nodes.get(e.to);
        return sum+Math.abs(a.tile.x+(ids.has(a.id)?delta.x:0)-b.tile.x-(ids.has(b.id)?delta.x:0))+
          Math.abs(a.tile.y+(ids.has(a.id)?delta.y:0)-b.tile.y-(ids.has(b.id)?delta.y:0));
      },0);
      result.push({moving: moving.id,nodeIds:moving.nodeIds,delta,distance});
    }
  }
  return result;
}

// Recompute external degree after EVERY contraction. A group contains actual
// buildings and their routes, and subsequent translations treat it as one body.
// Multiple parallel routes count separately: two opposing belts are two links,
// not a one-link leaf that could be served by a single port.
export function assembleFactory(initial,{onProgress=()=>{},attemptsPerMerge=24}={}){
  if(!initial.nodes.length)return initial;
  let scene=initial,moved=0;
  const groups=new Map(initial.nodes.map(n=>[`block:${n.id}`,{id:`block:${n.id}`,nodeIds:[n.id]}])),merges=[];
  while(true){
    const adj=contacts(groups,scene.edges),degree=id=>[...adj.get(id).values()].reduce((sum,es)=>sum+es.length,0);
    const available=[...groups.values()].filter(g=>degree(g.id)>0).sort((a,b)=>degree(a.id)-degree(b.id)||a.nodeIds.length-b.nodeIds.length||compare(a.id,b.id));
    if(!available.length)break;
    const selected=available[0],rank=degree(selected.id);
    const neighborIDs=[...adj.get(selected.id)].sort((a,b)=>b[1].length-a[1].length||degree(b[0])-degree(a[0])||compare(a[0],b[0]));
    const neighbor=groups.get(neighborIDs[0][0]),links=adj.get(selected.id).get(neighbor.id),linkIDs=new Set(links.map(e=>e.id));
    onProgress(`Собираем группы · внешних связей: ${rank} · ${merges.length+1} / ${initial.nodes.length-1}`);
    const before=factoryMetrics(scene),oldLength=links.reduce((sum,e)=>sum+e.length,0);
    let best=scene,bestLength=oldLength,translation=null;
    // Leaves first; when a leaf is already a large assembly, either complete
    // body can move. Never move only its boundary node away from its children.
    const candidates=[...shifts(scene,selected,links),...shifts(scene,neighbor,links)]
      .sort((a,b)=>a.distance-b.distance||a.nodeIds.length-b.nodeIds.length||compare(a.moving,b.moving)||a.delta.x-b.delta.x||a.delta.y-b.delta.y);
    for(const candidate of candidates.slice(0,attemptsPerMerge)){
      if(rank===1&&bestLength<=2*TILE_SIZE&&links.every(e=>straight(best.edges.find(r=>r.id===e.id))))break;
      try{
        const next=translateAssembly(scene,candidate.nodeIds,candidate.delta,{maxExpanded:3000});
        const joined=next.edges.filter(e=>linkIDs.has(e.id)),length=joined.reduce((sum,e)=>sum+e.length,0),metrics=factoryMetrics(next);
        if(rank===1&&!joined.every(straight))continue;
        const straightened=rank===1&&!best.edges.filter(e=>linkIDs.has(e.id)).every(straight);
        if(length>bestLength+1e-7||(!straightened&&length>=bestLength-1e-7)||metrics.length>before.length+1e-7||metrics.area>before.area||metrics.bridges>before.bridges)continue;
        best=next;bestLength=length;translation={group:candidate.moving,...candidate.delta};
      }catch{/* The existing complete assembly remains valid if a port is blocked. */}
    }
    scene=best;if(translation)moved++;
    const id=`group:${merges.length}`,nodeIds=[...selected.nodeIds,...neighbor.nodeIds].sort(compare);
    merges.push({id,children:[selected.id,neighbor.id],degree:rank,edgeIds:[...linkIDs].sort(compare),translation,
      straight:scene.edges.filter(e=>linkIDs.has(e.id)).every(straight)});
    groups.delete(selected.id);groups.delete(neighbor.id);groups.set(id,{id,nodeIds});
  }
  const assembly={version:1,merges,groups:[...groups.values()].map(g=>({...g,edgeIds:internal(scene.edges,new Set(g.nodeIds))}))};
  return {...scene,assembly,assemblyMoved:moved};
}

// Verify saved hierarchy against real edges, not merely supplied group labels.
export function restoreAssembly(value,nodes,edges){
  if(value==null)return undefined;
  const check=ok=>{if(!ok)throw new Error('Повреждена иерархия групп фабрики.');};
  check(value.version===1&&Array.isArray(value.merges)&&Array.isArray(value.groups)&&value.merges.length<nodes.length);
  const active=new Map(nodes.map(n=>[`block:${n.id}`,new Set([n.id])])),merges=[];
  for(const [index,m] of value.merges.entries()){
    check(m&&m.id===`group:${index}`&&Array.isArray(m.children)&&m.children.length===2&&m.children[0]!==m.children[1]);
    const [a,b]=m.children.map(id=>active.get(id));check(a&&b);
    const joined=crossing(edges,a,b),rank=edges.filter(e=>a.has(e.from)!==a.has(e.to)).length;
    check(joined.length>0&&m.degree===rank&&Array.isArray(m.edgeIds)&&JSON.stringify([...m.edgeIds].sort(compare))===JSON.stringify(joined.map(e=>e.id).sort(compare)));
    check(typeof m.straight==='boolean'&&(!m.straight||joined.every(straight)));
    check(m.translation===null||m.translation&&m.children.includes(m.translation.group)&&Number.isInteger(m.translation.x)&&Number.isInteger(m.translation.y));
    active.delete(m.children[0]);active.delete(m.children[1]);active.set(m.id,new Set([...a,...b]));
    merges.push({id:m.id,children:[...m.children],degree:m.degree,edgeIds:[...m.edgeIds],translation:m.translation?{...m.translation}:null,straight:m.straight});
  }
  check(value.groups.length===active.size);
  const seen=new Set(),owner=new Map(),groups=value.groups.map(g=>{
    const members=active.get(g?.id);check(members&&!seen.has(g.id)&&Array.isArray(g.nodeIds)&&Array.isArray(g.edgeIds));seen.add(g.id);
    check(JSON.stringify([...g.nodeIds].sort(compare))===JSON.stringify([...members].sort(compare)));
    check(JSON.stringify([...g.edgeIds].sort(compare))===JSON.stringify(internal(edges,members).sort(compare)));
    for(const id of members)owner.set(id,g.id);
    return {id:g.id,nodeIds:[...g.nodeIds],edgeIds:[...g.edgeIds]};
  });
  check(edges.every(e=>owner.get(e.from)===owner.get(e.to)));
  return {version:1,merges,groups};
}
