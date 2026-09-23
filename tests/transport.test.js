import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {layoutGraph,visibleGraph,traceGraph} from '../internal/web/static/graph.js';
import {TILE_SIZE,TileRouter,addTransportJunctions} from '../internal/web/static/routing.js';
import {pointOnRoute,measurePath,roundRailCorners} from '../internal/web/static/geometry.js';
import {trainOnRoute,TRAIN_SPACING} from '../internal/web/static/trains.js';
import {FactoryWorld,drawBuilding} from '../internal/web/static/world.js';
import {optimizeFactory,validateTransport} from '../internal/web/static/optimizer.js';

const key=p=>`${p.x},${p.y}`;
const node=(id,x,y,kind='machine')=>({id,label:id,function:'main',order:0,kind,x:(x+.5)*TILE_SIZE,y:(y+.5)*TILE_SIZE});
const edge=(id,from,to,kind='belt')=>({id,from,to,kind});

function validate(scene){
  const ground=new Map(),upper=new Map(),envelopes=new Set(),buildings=new Set();
  for(const n of scene.nodes){
    assert.equal(n.w,n.tileSize*TILE_SIZE);assert.equal(n.h,n.w);
    if(n.kind==='trash')assert.equal(n.tileSize,1);
    for(let x=n.footprint.minX;x<=n.footprint.maxX;x++)for(let y=n.footprint.minY;y<=n.footprint.maxY;y++){
      const k=key({x,y});assert.ok(!buildings.has(k));buildings.add(k);
    }
  }
  for(const e of scene.edges){
    const visited=new Set();
    for(let i=0;i<e.cells.length;i++){
      const cell=e.cells[i],k=key(cell);assert.ok(!visited.has(k),'route crosses itself');visited.add(k);
      assert.ok(!buildings.has(k),'transport enters building footprint');
      if(i)assert.equal(Math.abs(cell.x-e.cells[i-1].x)+Math.abs(cell.y-e.cells[i-1].y),1,'disconnected track/belt');
      const layer=cell.layer?upper:ground;assert.ok(!layer.has(k),`shared layer ${cell.layer} at ${k}`);layer.set(k,{e,i,cell});
      if(e.kind==='train')assert.equal(cell.layer,0,'railway leaves ground');
    }
    assert.ok(e.length>0);assert.equal(e.distances.length,e.points.length);
    for(const b of e.bridges){
      assert.ok(b.crossed.length,'bridge must cross actual transport');
      for(const k of b.envelope){assert.ok(!envelopes.has(k),'bridges intersect or touch');envelopes.add(k);}
      assert.ok(b.startDistance<b.endDistance);
      assert.equal(pointOnRoute(e,(b.startDistance+b.endDistance)/2).bridge,true);
    }
  }
  for(const [k,above] of upper){
    const below=ground.get(k);if(!below)continue;
    assert.ok(!below.cell.ramp,'bridge crosses another ramp');
    const a=above.e.cells[above.i-1],b=above.e.cells[above.i+1];
    const c=below.e.cells[below.i-1],d=below.e.cells[below.i+1];
    assert.ok(c&&d,'bridge crosses a port');
    assert.ok((a.x===b.x&&c.y===d.y)||(a.y===b.y&&c.x===d.x),'crossing is not perpendicular');
  }
}

for(const kind of ['belt','train'])test(`${kind} uses a straight route in all directions, including overlapping port approaches`,()=>{
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])for(const separation of [5,6,7,9,12,20]){
    const nodes=[node('a',0,0),node('b',dx*separation,dy*separation)];
    const scene={nodes,edges:new TileRouter(nodes).route([edge('ab','a','b',kind)])};
    validate(scene);assert.ok(validateTransport(scene));
    const route=scene.edges[0];
    assert.equal(route.cells.length,separation-3,'straight path must attain the grid-distance lower bound');
    assert.equal(route.bridges.length,0);
    for(const p of route.cells)assert.equal(dx?p.y:p.x,0);
    for(const p of route.points)assert.equal(dx?p.y:p.x,TILE_SIZE/2,'rendered geometry must remain straight');
    assert.equal(route.length,(separation-3)*TILE_SIZE);
  }
});

test('straight-route shortcut still avoids buildings and other reserved approaches',()=>{
  for(const kind of ['belt','train']){
    const nodes=[node('left',-12,0),node('right',12,0),node('blocker',0,0)];
    const scene={nodes,edges:new TileRouter(nodes).route([edge('around','left','right',kind)])};
    validate(scene);assert.ok(validateTransport(scene));
    assert.ok(scene.edges[0].cells.some(p=>p.y!==0),'a building requires a real detour');
  }
  const nodes=[node('a',0,0),node('b',9,0),node('c',0,9),node('d',9,9)];
  const scene={nodes,edges:new TileRouter(nodes).route([edge('ab','a','b'),edge('cd','c','d'),edge('ac','a','c'),edge('bd','b','d')] )};
  validate(scene);assert.ok(validateTransport(scene));
});

test('intersecting belts use exclusive bridges, including over a railway',()=>{
  const nodes=[],edges=[];
  for(let i=0;i<3;i++){
    nodes.push(node(`left${i}`,-30,i*6-6),node(`right${i}`,30,i*6-6));
    edges.push(edge(`a${i}`,`left${i}`,`right${i}`,i===1?'train':'belt'));
    nodes.push(node(`top${i}`,i*12-12,-24),node(`bottom${i}`,i*12-12,24));
    edges.push(edge(`b${i}`,`top${i}`,`bottom${i}`));
  }
  const scene={nodes,edges:new TileRouter(nodes).route(edges)};
  validate(scene);
  assert.ok(scene.edges.some(e=>e.bridges.length));
  const railCells=new Set(scene.edges.find(e=>e.kind==='train').cells.map(key));
  assert.ok(scene.edges.some(e=>e.bridges.some(b=>b.crossed.some(k=>railCells.has(k)))),'belts bridge over rails');
});

test('busy disposers stay one tile and merger trees preserve every source',()=>{
  const nodes=[node('trash',0,0,'trash')],edges=[];
  for(let i=0;i<8;i++){nodes.push({...node(`input${i}`,0,0),order:i});edges.push(edge(`feed${i}`,`input${i}`,'trash'));}
  const transformed=addTransportJunctions({nodes,edges});
  for(let i=0;i<8;i++)assert.ok(traceGraph(transformed,`input${i}`).has('trash'));
  assert.equal(transformed.edges.filter(e=>e.to==='trash').length,1);
  const scene=layoutGraph({nodes,edges},[]);validate(scene);
  const bin=scene.nodes.find(n=>n.id==='trash');
  const hit=x=>FactoryWorld.prototype.nodeAt.call({scene,camera:{},worldPoint:(x,y)=>({x,y})},x,bin.y);
  assert.equal(hit(bin.x+15)?.id,bin.id);assert.notEqual(hit(bin.x+17)?.id,bin.id);
  const boxes=[];const context={save(){},restore(){},translate(){},fillRect(x,y,w,h){boxes.push({x,y,w,h});},strokeRect(){}};
  drawBuilding(context,bin);
  for(const r of boxes){assert.ok(r.x>=-16&&r.y>=-16&&r.x+r.w<=16&&r.y+r.h<=16,'disposer artwork exceeds one tile');}
});

// Snapshot of the bundled two-module demo, stripped of source paths and code.
const demo=JSON.parse(readFileSync(new URL('./fixtures/demo-routing.json',import.meta.url)));
for(const compact of [true,false])test(`demo routes every operation without crossings (compact=${compact})`,()=>{
  for(const fn of ['',...demo.functions.map(f=>f.id)]){
    const view=visibleGraph(demo,{compact,fn});
    const before=layoutGraph(view,demo.functions,fn,{optimize:false});
    const snapshot=JSON.stringify(before);
    const scene=optimizeFactory(before);validate(scene);
    assert.equal(JSON.stringify(before),snapshot,'optimization mutates the fallback factory');
    const topology=s=>s.edges.map(({id,from,to,kind})=>({id,from,to,kind}));
    assert.deepEqual(topology(scene),topology(before));
    assert.deepEqual(scene.nodes.map(n=>[n.id,n.kind,n.tileSize]),before.nodes.map(n=>[n.id,n.kind,n.tileSize]));
    const area=s=>{
      const xs=s.nodes.flatMap(n=>[n.footprint.minX,n.footprint.maxX]),ys=s.nodes.flatMap(n=>[n.footprint.minY,n.footprint.maxY]);
      for(const e of s.edges)for(const p of e.cells){xs.push(p.x);ys.push(p.y);}
      return (Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1);
    };
    const length=s=>s.edges.reduce((total,e)=>total+measurePath(e.points).length,0);
    assert.ok(area(scene)<=area(before),'optimization expands occupied land');
    assert.ok(length(scene)<=length(before)+1e-7,'optimization lengthens routes');
    assert.equal(scene.optimization.after.area,area(scene));
    assert.ok(Math.abs(scene.optimization.after.length*TILE_SIZE-length(scene))<1e-6);
    if(!fn)assert.ok(area(scene)<area(before)*.85,'full factory must be substantially smaller');
    if(compact&&fn.endsWith('.Run'))assert.ok(length(scene)<length(before)*.95,'Run detours must get shorter');
    for(const e of view.edges)assert.ok(scene.edges.some(r=>r.id===e.id),`missing edge ${e.id}`);
  }
});

test('optimization preserves a valid factory when no candidate improves it',()=>{
  const base=layoutGraph({nodes:[node('only',0,0,'trash')],edges:[]},[], '',{optimize:false});
  const optimized=optimizeFactory(base);validate(optimized);
  assert.deepEqual(optimized.nodes,base.nodes);assert.deepEqual(optimized.edges,base.edges);
  assert.deepEqual(optimized.optimization.before,optimized.optimization.after);
  const empty=optimizeFactory({nodes:[],edges:[],districts:[]});
  assert.equal(empty.optimization.after.area,0);assert.equal(empty.optimization.after.length,0);
});

test('routing is deterministic and preserves reverse dependencies',()=>{
  const graph={nodes:[node('a',0,0),node('b',0,0),node('bin',0,0,'trash')],edges:[edge('ab','a','b'),edge('ba','b','a'),edge('discard','b','bin')]};
  const first=layoutGraph(graph,[]);validate(first);assert.deepEqual(layoutGraph(graph,[]),first);
});

test('dense cyclic graphs keep every route and bridge separated',()=>{
  for(let seed=1;seed<=4;seed++){
    let random=seed;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
    const nodes=Array.from({length:20},(_,i)=>({...node(`n${i}`,0,0,i%5===4?'trash':'machine'),order:i}));
    const edges=[],used=new Set();
    while(edges.length<30){const a=Math.floor(next()*20),b=Math.floor(next()*20),id=`e${a}-${b}`;if(a===b||used.has(id))continue;used.add(id);edges.push(edge(id,`n${a}`,`n${b}`));}
    const scene=layoutGraph({nodes,edges},[]);validate(scene);
    for(const e of edges)assert.ok(scene.edges.some(r=>r.id===e.id));
  }
});

test('a whole train follows the rails continuously through turns and both terminal stops',()=>{
  const points=roundRailCorners([{x:0,y:0},{x:200,y:0},{x:200,y:220},{x:500,y:220}]);
  const track={points,...measurePath(points),index:0};
  const first=trainOnRoute(track,0);assert.equal(first.cars.length,4);
  let previous=first,forward=false,reverse=false,stopped=false;
  const dt=.025;
  for(let time=dt;time<first.period*2;time+=dt){
    const train=trainOnRoute(track,time);forward ||= train.direction===1&&!train.stopped;reverse ||= train.direction===-1&&!train.stopped;stopped ||= train.stopped;
    for(let i=0;i<train.cars.length;i++){
      const car=train.cars[i];assert.equal(car.locomotive,i===0);
      assert.ok(car.distance>=16&&car.distance<=track.length-16);
      if(i)assert.ok(Math.abs(train.cars[i-1].distance-car.distance-TRAIN_SPACING)<1e-9);
      assert.ok(Math.abs(car.distance-previous.cars[i].distance)<=43*dt+1e-8,'wagon teleports at terminal');
      for(const [bogie,offset] of [[car.front,7],[car.back,-7]]){
        const p=pointOnRoute(track,car.distance+offset,{wrap:false});assert.equal(bogie.x,p.x);assert.equal(bogie.y,p.y);
      }
    }
    previous=train;
  }
  assert.ok(forward&&reverse&&stopped);
  assert.deepEqual(pointOnRoute(track,track.length+100,{wrap:false}).x,track.points.at(-1).x);
});
