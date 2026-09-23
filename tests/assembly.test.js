import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleFactory,restoreAssembly} from '../internal/web/static/assembly.js';
import {TILE_SIZE,TileRouter} from '../internal/web/static/routing.js';
import {factoryMetrics,optimizeFactory,sceneWithGeometry,translateAssembly,validateTransport} from '../internal/web/static/optimizer.js';
import {layoutGraph} from '../internal/web/static/graph.js';

const node=(id,x,y)=>({id,label:id,function:'main',order:0,kind:'machine',x:(x+.5)*TILE_SIZE,y:(y+.5)*TILE_SIZE});
const edge=(id,from,to,kind='belt')=>({id,from,to,kind});
const makeScene=(nodes,edges)=>sceneWithGeometry({districts:[]},nodes,new TileRouter(nodes).route(edges));
const chain=()=>makeScene([node('a',0,0),node('b',25,0),node('c',25,25),node('d',50,25)],
  [edge('ab','a','b'),edge('bc','b','c','train'),edge('cd','c','d')]);
const geometry=scene=>({nodes:scene.nodes.map(n=>[n.id,n.x,n.y]),edges:scene.edges.map(e=>[e.id,e.cells,e.ports])});

test('leaves contract into bodies with straight routes, then whole bodies join the next dependency',()=>{
  const before=chain(),snapshot=JSON.stringify(before),after=assembleFactory(before);
  assert.ok(validateTransport(after));assert.equal(JSON.stringify(before),snapshot);
  assert.equal(after.assembly.groups.length,1);
  assert.deepEqual(after.assembly.groups[0].nodeIds,['a','b','c','d']);
  assert.deepEqual(after.assembly.groups[0].edgeIds,before.edges.map(e=>e.id));
  assert.deepEqual(after.assembly.merges.map(m=>m.degree),[1,1,1],'recount after each contraction, rather than sort the original nodes once');
  assert.ok(after.assembly.merges.some(m=>m.translation?.group.startsWith('group:')),'a previously assembled body actually moves');
  assert.ok(after.assembly.merges.every(m=>m.straight));
  for(const route of after.edges){
    assert.equal(route.cells.length,2);assert.equal(route.bridges.length,0);
    assert.equal(route.length,2*TILE_SIZE,'belts and rails both use the minimum straight connection');
  }
  assert.ok(factoryMetrics(after).length<factoryMetrics(before).length);
  assert.deepEqual(after.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]),before.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]));
  assert.deepEqual(geometry(assembleFactory(chain())),geometry(after),'assembly is deterministic');
});

test('translation preserves every internal cell and both buildings while reconnecting external edges atomically',()=>{
  const before=chain(),snapshot=JSON.stringify(before),delta={x:-10,y:-10};
  const after=translateAssembly(before,['a','b'],delta);
  assert.ok(validateTransport(after));assert.equal(JSON.stringify(before),snapshot);
  for(const n of after.nodes){
    const old=before.nodes.find(p=>p.id===n.id),moving=['a','b'].includes(n.id);
    assert.deepEqual([n.x,n.y],[old.x+(moving?delta.x*TILE_SIZE:0),old.y+(moving?delta.y*TILE_SIZE:0)]);
  }
  const ab=before.edges.find(e=>e.id==='ab'),moved=after.edges.find(e=>e.id==='ab');
  assert.deepEqual(moved.cells,ab.cells.map(p=>({...p,x:p.x+delta.x,y:p.y+delta.y})));
  assert.equal(moved.length,ab.length);
  for(const field of ['cells','points','length','distances'])
    assert.deepEqual(after.edges.find(e=>e.id==='cd')[field],before.edges.find(e=>e.id==='cd')[field]);
  assert.notDeepEqual(after.edges.find(e=>e.id==='bc').cells,before.edges.find(e=>e.id==='bc').cells);
  assert.throws(()=>translateAssembly(before,['a','b'],{x:25,y:25}),/один тайл/);
  assert.throws(()=>translateAssembly(before,['a','b'],{x:.5,y:0}),/целым/);
  assert.equal(JSON.stringify(before),snapshot,'failed translations must leave the last complete factory intact');
});

test('one-link groups finish before cycles with two links and a three-link core; disconnected groups remain separate',()=>{
  const ids=['p','q','r','t0','t1','t2','k0','k1','k2','k3','alone'];
  const pairs=[['p','q'],['q','r'],['t0','t1'],['t1','t2'],['t2','t0']];
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)pairs.push([`k${i}`,`k${j}`]);
  const before=layoutGraph({nodes:ids.map(id=>node(id,0,0)),edges:pairs.map(([a,b],i)=>edge(`e${i}`,a,b))},[], '',{optimize:false});
  const after=assembleFactory(before);
  assert.ok(validateTransport(after));
  assert.deepEqual(after.assembly.merges.map(m=>m.degree),[1,1,2,2,3,3,3]);
  assert.equal(after.assembly.groups.length,4);
  assert.deepEqual(after.assembly.groups.map(g=>g.nodeIds.length).sort((a,b)=>a-b),[1,3,3,4]);
  assert.deepEqual(after.edges.map(e=>e.id),before.edges.map(e=>e.id));
  assert.deepEqual(restoreAssembly(after.assembly,after.nodes,after.edges),after.assembly);
});

test('parallel opposite links count separately, and a self-loop remains inside its own group',()=>{
  const before=makeScene([node('a',0,0),node('b',20,0)],
    [edge('ab','a','b'),edge('ba','b','a'),edge('self','a','a')]);
  const after=assembleFactory(before);
  assert.ok(validateTransport(after));
  assert.equal(after.assembly.merges[0].degree,2);
  assert.deepEqual(after.assembly.merges[0].edgeIds,['ab','ba']);
  assert.deepEqual(after.assembly.groups[0].edgeIds,['ab','ba','self']);
  assert.deepEqual(restoreAssembly(after.assembly,after.nodes,after.edges),after.assembly);
});

test('later optimization preserves compound geometry, including the routes already built inside it',()=>{
  const before=assembleFactory(chain()),after=optimizeFactory(before);
  assert.ok(validateTransport(after));
  const dx=after.nodes[0].tile.x-before.nodes[0].tile.x,dy=after.nodes[0].tile.y-before.nodes[0].tile.y;
  for(let i=0;i<before.nodes.length;i++){
    assert.equal(after.nodes[i].tile.x-before.nodes[i].tile.x,dx);
    assert.equal(after.nodes[i].tile.y-before.nodes[i].tile.y,dy);
  }
  for(let i=0;i<before.edges.length;i++)assert.deepEqual(after.edges[i].cells,
    before.edges[i].cells.map(p=>({...p,x:p.x+dx,y:p.y+dy})));
  assert.deepEqual(after.assembly,before.assembly);
});

test('blocked placement keeps valid routes and still completes the contraction hierarchy',()=>{
  const before=chain(),snapshot=JSON.stringify(before),after=assembleFactory(before,{attemptsPerMerge:0});
  assert.ok(validateTransport(after));assert.equal(JSON.stringify(before),snapshot);
  assert.deepEqual(geometry(after),geometry(before));
  assert.equal(after.assembly.groups.length,1);assert.equal(after.assembly.merges.length,3);
  assert.equal(after.assemblyMoved,0);
});

test('empty and unconnected factories need no imaginary routes or merges',()=>{
  const empty={nodes:[],edges:[],districts:[]};assert.deepEqual(assembleFactory(empty),empty);
  const after=assembleFactory(makeScene([node('a',0,0),node('b',20,0)],[]));
  assert.equal(after.assembly.groups.length,2);assert.deepEqual(after.assembly.merges,[]);
  assert.deepEqual(after.edges,[]);assert.deepEqual(restoreAssembly(after.assembly,after.nodes,after.edges),after.assembly);
});
