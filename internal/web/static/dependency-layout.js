// Layout uses undirected contact between objects: the arrow controls cargo,
// but either end of a dependency must attract the other. Duplicate links add
// weight without inventing additional neighbours; cycles need no special case.
export function dependencyGraph(nodes, edges) {
  const graph = new Map(nodes.map(n => [n.id, new Map()]));
  for (const e of edges) {
    if (e.from === e.to || !graph.has(e.from) || !graph.has(e.to)) continue;
    const weight = Number.isFinite(e.count) && e.count > 0 ? e.count : 1;
    for (const [a,b] of [[e.from,e.to],[e.to,e.from]]) graph.get(a).set(b,(graph.get(a).get(b)||0)+weight);
  }
  return graph;
}

const key = p => `${p.x},${p.y}`;
const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const steps = [{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const weightOf = count => 1+Math.log2(count);

// Seed each connected component at its busiest object, walk its neighbours
// recursively, then relax positions on an exclusive integer lattice. The
// graph, not SSA declaration order, determines proximity. A degree-weighted
// centre pull gives busy objects the inner slots and leaves leaves outside.
export function dependencyPositions(nodes, edges) {
  const graph = dependencyGraph(nodes,edges), positions = new Map();
  const degree = id => graph.get(id).size;
  const strength = new Map([...graph].map(([id,links])=>[id,[...links.values()].reduce((sum,n)=>sum+weightOf(n),0)]));
  const compare = (a,b) => degree(b)-degree(a)||strength.get(b)-strength.get(a)||a.localeCompare(b,undefined,{numeric:true});
  const remaining = new Set([...graph.keys()].sort(compare)), components = [];
  while (remaining.size) {
    const root = remaining.values().next().value, component = [root];
    remaining.delete(root);
    for (let i=0;i<component.length;i++) for (const id of [...graph.get(component[i]).keys()].sort(compare)) {
      if (remaining.delete(id)) component.push(id);
    }
    const placed = new Map([[root,{x:0,y:0}]]), occupied = new Map([['0,0',root]]);
    const pending = new Set(component.slice(1)), frontier = new Map();
    const contact = new Map(component.map(id=>[id,0]));
    const connect = id => {for (const [other,count] of graph.get(id)) contact.set(other,contact.get(other)+weightOf(count));};
    connect(root);
    const addFrontier = p => {
      frontier.delete(key(p));
      for (const step of steps) {
        const next={x:p.x+step.x,y:p.y+step.y};
        if (!occupied.has(key(next))) frontier.set(key(next),next);
      }
    };
    addFrontier(placed.get(root));
    const pull = (id,p) => .08*degree(id)*distance(p,{x:0,y:0});
    const cost = (id,p) => {
      let result=pull(id,p);
      for (const [other,count] of graph.get(id)) {
        const q=placed.get(other);if (!q) continue;
        const separation=distance(p,q);
        result+=weightOf(count)*(separation+(separation>1?1:0));
        // Aligned neighbours can have a straight belt/rail instead of a bend.
        if (p.x!==q.x&&p.y!==q.y) result+=.35*weightOf(count);
      }
      return result;
    };
    while (pending.size) {
      const id=[...pending].sort((a,b)=>contact.get(b)-contact.get(a)||compare(a,b))[0];
      let best,score=Infinity;
      for (const p of frontier.values()) {
        const candidate=cost(id,p);
        if (candidate<score-1e-9) {best=p;score=candidate;}
      }
      placed.set(id,best);occupied.set(key(best),id);addFrontier(best);pending.delete(id);connect(id);
    }
    // A one-slot walk gets stuck behind unrelated buildings. Also try slots
    // next to every dependency, including a direct swap across the component.
    for (let pass=0;pass<6;pass++) {
      let changed=false;
      for (const id of [...component].sort(compare)) {
        if (id===root) continue;
        const current=placed.get(id);let best=current,swap=null,improvement=0;
        const candidates=new Map();
        for (const p of [current,...[...graph.get(id).keys()].map(other=>placed.get(other))])for(const step of steps){
          const next={x:p.x+step.x,y:p.y+step.y};candidates.set(key(next),next);
        }
        for (const next of candidates.values()) {
          const other=occupied.get(key(next));
          if(other===id)continue;
          if (other===root) continue;
          const before=cost(id,current)+(other?cost(other,next):0);
          placed.set(id,next);if (other) placed.set(other,current);
          const after=cost(id,next)+(other?cost(other,current):0);
          placed.set(id,current);if (other) placed.set(other,next);
          if (after-before<improvement-1e-9) {best=next;swap=other;improvement=after-before;}
        }
        if (best===current) continue;
        occupied.delete(key(current));placed.set(id,best);occupied.set(key(best),id);
        if (swap) {placed.set(swap,current);occupied.set(key(current),swap);}
        changed=true;
      }
      if (!changed) break;
    }
    const xs=[...placed.values()].map(p=>p.x),ys=[...placed.values()].map(p=>p.y);
    const minX=Math.min(...xs),minY=Math.min(...ys);
    components.push({placed,minX,minY,width:Math.max(...xs)-minX+1,height:Math.max(...ys)-minY+1});
  }
  // Unrelated components have no attraction. Pack their bounding boxes with
  // a free slot between them instead of inventing links or a long single row.
  const limit=Math.ceil(Math.sqrt(components.reduce((sum,c)=>sum+(c.width+1)*(c.height+1),0)));
  let x=0,y=0,rowHeight=0;
  for (const c of components) {
    if (x&&x+c.width>limit) {x=0;y+=rowHeight+1;rowHeight=0;}
    for (const [id,p] of c.placed) positions.set(id,{x:p.x-c.minX+x,y:p.y-c.minY+y});
    x+=c.width+1;rowHeight=Math.max(rowHeight,c.height);
  }
  return positions;
}
