import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dependencyGraph,dependencyPositions} from '../internal/web/static/dependency-layout.js';
import {layoutGraph} from '../internal/web/static/graph.js';
import {validateTransport,optimizeFactory,sceneWithGeometry} from '../internal/web/static/optimizer.js';
import {TileRouter,rebuildRoute,TILE_SIZE} from '../internal/web/static/routing.js';

const nodes = ids => ids.map((id,order)=>({id,order,label:id,function:'main',kind:'machine'}));
const edges = pairs => pairs.map(([from,to],i)=>({id:`e${i}`,from,to,kind:'belt'}));
const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

test('contact graph counts unique neighbours in both directions and retains repeated link weights',()=>{
  const graph=dependencyGraph(nodes(['a','b','c','alone']),[
    ...edges([['a','b'],['b','a'],['b','c'],['a','a'],['missing','a']]),
    {from:'a',to:'b',count:7},
  ]);
  assert.deepEqual([...graph.get('a')],[['b',9]]);
  assert.deepEqual([...graph.get('b')],[['a',9],['c',1]]);
  assert.equal(graph.get('alone').size,0);
});

test('a busy hub is central and each direct neighbour can have a straight route',()=>{
  const ns=nodes(['west','east','south','north','hub']),es=edges(ns.slice(0,4).map(n=>['hub',n.id]));
  const p=dependencyPositions(ns,es),hub=p.get('hub');
  for(const n of ns.slice(0,4))assert.equal(distance(hub,p.get(n.id)),1);
  assert.equal(hub.x,1);assert.equal(hub.y,1);
  const scene=layoutGraph({nodes:ns,edges:es},[]);
  assert.ok(validateTransport(scene));
  for(const e of scene.edges){
    assert.equal(e.bridges.length,0);
    assert.ok(e.cells.every(p=>p.x===e.cells[0].x)||e.cells.every(p=>p.y===e.cells[0].y));
  }
});

test('recursive neighbours form local branches independently of SSA order and input enumeration',()=>{
  const ns=nodes(['a','b','c','d','e','f','g']),es=edges([['a','b'],['b','c'],['c','d'],['c','e'],['e','f'],['f','g']]);
  const snapshot=JSON.stringify({ns,es}),p=dependencyPositions(ns,es);
  for(const e of es)assert.equal(distance(p.get(e.from),p.get(e.to)),1);
  const reordered=dependencyPositions([...ns].reverse().map(n=>({...n,order:1000-n.order})),[...es].reverse());
  assert.deepEqual([...p].sort(),[...reordered].sort());
  assert.equal(JSON.stringify({ns,es}),snapshot);
});

test('cycles and disconnected components have unique finite slots and do not invent dependencies',()=>{
  const ns=nodes(Array.from({length:30},(_,i)=>`n${i}`)),es=edges([['n0','n1'],['n1','n2'],['n2','n0'],['n3','n4']]);
  const p=dependencyPositions(ns,es);
  assert.equal(p.size,ns.length);
  assert.equal(new Set([...p.values()].map(p=>`${p.x},${p.y}`)).size,ns.length);
  for(const point of p.values())assert.ok(Number.isInteger(point.x)&&Number.isInteger(point.y));
  assert.ok(Math.max(...[...p.values()].map(p=>p.x))<15,'disconnected objects should not form one long row');
  assert.deepEqual(dependencyPositions([],[]),new Map());
});

test('workshops also follow dependencies rather than source or function order',()=>{
  const ns=nodes(['hub','a','b','c','d']).map(n=>({...n,function:n.id}));
  const es=edges(ns.slice(1).map(n=>['hub',n.id]));
  const scene=layoutGraph({nodes:ns,edges:es},[], '',{optimize:false});
  const hub=scene.nodes.find(n=>n.id==='hub');
  assert.ok(validateTransport(scene));
  assert.ok(scene.nodes.some(n=>n.x<hub.x)&&scene.nodes.some(n=>n.x>hub.x));
  assert.ok(scene.nodes.some(n=>n.y<hub.y)&&scene.nodes.some(n=>n.y>hub.y));
});

test('inserting splitter trees does not push a busy original machine to the periphery',()=>{
  const ns=nodes(['hub',...Array.from({length:8},(_,i)=>`leaf${i}`)]),es=edges(ns.slice(1).map(n=>['hub',n.id]));
  const scene=layoutGraph({nodes:ns,edges:es},[], '',{optimize:false});
  assert.ok(validateTransport(scene));
  assert.ok(scene.nodes.some(n=>n.isJunction));
  const originals=scene.nodes.filter(n=>!n.isJunction),hub=originals.find(n=>n.id==='hub');
  const total=p=>originals.reduce((sum,n)=>sum+distance(p,n),0);
  assert.ok(total(hub)<originals.reduce((sum,n)=>sum+total(n),0)/originals.length,'busy original stays closer to its dependencies than the average peripheral object');
});

test('a remote leaf moves beside its dependency instead of retaining a map-wide straight segment',()=>{
  // The reported Run layout: a splitter-to-portal belt crosses the workshop
  // even though a free neighbouring slot is available beside the splitter.
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/run-neighbor-layout.json',import.meta.url)));
  const before=sceneWithGeometry({districts:fixture.districts},fixture.nodes,
    fixture.edges.map(e=>rebuildRoute(e,e.cells.map(([x,y,layer])=>({x,y,layer})))));
  assert.ok(validateTransport(before));
  const snapshot=JSON.stringify(before),after=optimizeFactory(before,{maxReroutes:0});
  assert.equal(JSON.stringify(before),snapshot,'relocation mutates its fallback');
  assert.ok(validateTransport(after));assert.ok(after.optimization.moved>0);
  for(const id of ['n14|n25|call','n15|n24|belt']){
    const old=before.edges.find(e=>e.id===id),route=after.edges.find(e=>e.id===id);
    assert.ok(old.length/TILE_SIZE>30);
    assert.equal(route.cells.length,2,'linked endpoints should occupy neighbouring building slots');
    assert.equal(route.bridges.length,0);
  }
  assert.ok(after.optimization.after.length<after.optimization.before.length*.7);
  assert.ok(after.optimization.after.area<=after.optimization.before.area);
  assert.deepEqual(after.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]),before.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]));
});

test('automatic neighbour relocation reroutes both the incoming and outgoing dependency',()=>{
  const ns=nodes(['a','middle','c']).map((n,i)=>({...n,x:([0,30,0][i]+.5)*32,y:([0,0,12][i]+.5)*32}));
  const es=edges([['a','middle'],['middle','c']]);
  const before=sceneWithGeometry({districts:[]},ns,new TileRouter(ns).route(es));
  const after=optimizeFactory(before,{maxReroutes:0});
  assert.ok(validateTransport(after));assert.equal(after.edges.length,2);
  assert.ok(after.optimization.after.length<after.optimization.before.length/2);
  for(const e of after.edges)assert.ok(e.cells.length>=2);
});
