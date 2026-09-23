import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TILE_SIZE,TileRouter,rebuildRoute} from '../internal/web/static/routing.js';
import {assembleFactory,restoreAssembly} from '../internal/web/static/assembly.js';
import {factoryMetrics,optimizeRouteLengths,sceneWithGeometry,validateTransport} from '../internal/web/static/optimizer.js';
import {layoutGraph} from '../internal/web/static/graph.js';

const node=(id,x,y)=>({id,label:id,function:'main',kind:'machine',x:(x+.5)*TILE_SIZE,y:(y+.5)*TILE_SIZE});
const edge=(id,from,to,kind='belt')=>({id,from,to,kind});
const positions=scene=>scene.nodes.map(n=>[n.id,n.x,n.y]);
function path(corners){
  const cells=[];
  for(const [x,y] of corners){
    if(!cells.length){cells.push({x,y,layer:0});continue;}
    let p=cells.at(-1);assert.ok(p.x===x||p.y===y);
    while(p.x!==x||p.y!==y){p={x:p.x+Math.sign(x-p.x),y:p.y+Math.sign(y-p.y),layer:0};cells.push(p);}
  }
  return cells;
}
function routed(nodes,edges,paths){
  const routes=new TileRouter(nodes).route(edges).map(e=>paths[e.id]?rebuildRoute(e,path(paths[e.id])):e);
  const scene=sceneWithGeometry({districts:[]},nodes,routes);
  assert.ok(validateTransport(scene),'the starting factory must be valid');
  return assembleFactory(scene,{attemptsPerMerge:0});
}

for(const kind of ['belt','train'])test(`final pass shortens an internal ${kind} route without moving its assembled buildings`,()=>{
  const before=routed([node('a',0,0),node('b',20,0)],[edge('ab','a','b',kind)],
    {ab:[[2,0],[3,0],[3,10],[17,10],[17,0],[18,0]]});
  const snapshot=JSON.stringify(before),result=optimizeRouteLengths(before),after=result.scene;
  assert.equal(result.rerouted,1);assert.ok(validateTransport(after));
  assert.equal(after.edges[0].length,17*TILE_SIZE);
  assert.equal(after.edges[0].bridges.length,0);assert.ok(after.edges[0].cells.every(p=>p.y===0));
  assert.deepEqual(positions(after),positions(before));assert.deepEqual(after.assembly,before.assembly);
  assert.deepEqual(restoreAssembly(after.assembly,after.nodes,after.edges),after.assembly);
  assert.deepEqual(after.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]),before.edges.map(e=>[e.id,e.from,e.to,e.kind,e.index]));
  assert.ok(factoryMetrics(after).area<=factoryMetrics(before).area);
  assert.equal(JSON.stringify(before),snapshot,'shortening must not mutate the fallback scene');
});

test('a later pass uses a shortcut freed by shortening another route',()=>{
  const before=routed([node('a',0,0),node('b',20,0),node('c',10,-15),node('d',10,-5)],
    [edge('ab','a','b','train'),edge('cd','c','d')],{
      ab:[[2,0],[3,0],[3,20],[17,20],[17,0],[18,0]],
      cd:[[10,-13],[10,-12],[6,-12],[6,0],[14,0],[14,-8],[10,-8],[10,-7]],
    });
  const once=optimizeRouteLengths(before,{maxPasses:1}),final=optimizeRouteLengths(before);
  assert.ok(validateTransport(once.scene));assert.ok(validateTransport(final.scene));
  assert.ok(final.passes>1);
  assert.ok(factoryMetrics(final.scene).length<factoryMetrics(once.scene).length,'one sweep leaves an avoidable detour');
  assert.deepEqual(positions(final.scene),positions(before));
  assert.equal(final.scene.edges.find(e=>e.id==='ab').length,17*TILE_SIZE);
  assert.equal(final.scene.edges.find(e=>e.id==='cd').length,7*TILE_SIZE);
});

test('final pass retains necessary detours, stops when stable, and handles empty factories',()=>{
  const nodes=[node('a',0,0),node('b',20,0),node('obstacle',10,0)],edges=[edge('ab','a','b','train')];
  const before=routed(nodes,edges,{}),final=optimizeRouteLengths(before);
  assert.ok(validateTransport(final.scene));assert.deepEqual(positions(final.scene),positions(before));
  assert.ok(final.scene.edges[0].cells.some(p=>p.y!==0),'the route must still avoid the building');
  const stable=optimizeRouteLengths(final.scene);
  assert.equal(stable.rerouted,0);assert.equal(stable.passes,1);
  const empty=optimizeRouteLengths({nodes:[],edges:[],districts:[]});
  assert.equal(empty.rerouted,0);assert.equal(empty.passes,0);assert.equal(empty.scene.edges.length,0);
});

test('automatic construction runs the final pass after assembly and reports complete metrics',()=>{
  const phases=[],scene=layoutGraph({nodes:[node('a',0,0),node('b',0,0)],edges:[edge('ab','a','b')]},[], '',
    {onProgress:message=>phases.push(message)});
  assert.ok(phases.findIndex(s=>s.startsWith('Финальная оптимизация'))>phases.findIndex(s=>s.startsWith('Собираем группы')));
  assert.ok(scene.assembly.merges.length);
  assert.deepEqual(scene.optimization.final.after,factoryMetrics(scene));
  assert.deepEqual(scene.optimization.after,scene.optimization.final.after);
  assert.ok(scene.optimization.final.after.length<=scene.optimization.final.before.length);
  assert.deepEqual(restoreAssembly(scene.assembly,scene.nodes,scene.edges),scene.assembly);
});
