import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {layoutGraph} from '../internal/web/static/graph.js';
import {projectView,layoutCatalog} from '../internal/web/static/explorer.js';
import {validateTransport} from '../internal/web/static/optimizer.js';
import {moveBuilding,saveLayout,restoreLayout,snapPosition} from '../internal/web/static/factory-layout.js';
import {createFactory,parseFactory,viewOptions,viewKey,factoryStore} from '../internal/web/static/factory-state.js';

const graph={version:1,revision:'test',projects:[{module:'пример',path:'/tmp/пример'}],functions:[{id:'run',name:'Run',package:'p'}],
  nodes:['a','b','c'].map((id,order)=>({id,order,function:'run',kind:order<2?'station':'trash',label:id,source:{file:'f1',line:1}})),
  edges:[{id:'ab',from:'a',to:'b',kind:'train'},{id:'bc',from:'b',to:'c',kind:'belt'}],files:{f1:'/tmp/пример/main.go'}};
const options=viewOptions({fn:'run'});
const scene=layoutGraph(projectView(graph,options),graph.functions,'run');

test('moving a building reroutes transport, preserves other positions and never mutates the input',()=>{
  const original=JSON.stringify(scene),node=scene.nodes[0];
  const moved=moveBuilding(scene,node.id,{x:node.x-323,y:node.y+5});
  assert.equal(moved.nodes[0].x,snapPosition(node.x-323));assert.equal(moved.nodes[0].y,node.y);
  for(const n of moved.nodes.slice(1)){const old=scene.nodes.find(x=>x.id===n.id);assert.deepEqual([n.x,n.y],[old.x,old.y]);}
  assert.ok(validateTransport(moved));assert.equal(moved.edges.length,scene.edges.length);
  assert.equal(JSON.stringify(scene),original);assert.equal(moved.manual,true);
  assert.ok(scene.assembly?.merges.length);assert.equal(moved.assembly,undefined,'manual dragging releases automatic groups');
  assert.throws(()=>moveBuilding(scene,node.id,scene.nodes[1]),/один тайл/);
  assert.throws(()=>moveBuilding(scene,node.id,{x:Infinity,y:0}));
  assert.equal(JSON.stringify(scene),original);
});

test('portable JSON retains compound hierarchy and rejects forged memberships or dependencies',()=>{
  const snapshot=createFactory({graph,view:options,layouts:[saveLayout(options,scene)]});
  const parsed=parseFactory(JSON.stringify(snapshot)),restored=restoreLayout(parsed.graph,parsed.layouts[0]);
  assert.deepEqual(restored.assembly,scene.assembly);
  assert.deepEqual(saveLayout(options,restored),snapshot.layouts[0]);
  for(const mutate of [
    a=>a.version=99,a=>a.merges[0].children[0]='block:missing',a=>a.merges[0].children[1]=a.merges[0].children[0],
    a=>a.merges[0].edgeIds=['missing'],a=>a.merges[0].degree++,a=>a.groups[0].nodeIds.push(a.groups[0].nodeIds[0]),
    a=>a.groups[0].edgeIds=[],a=>a.merges[0].translation={group:'missing',x:1,y:0},
    a=>a.merges[0].translation={group:a.merges[0].children[0],x:.5,y:0},a=>a.groups.push(a.groups[0]),
  ]){
    const bad=structuredClone(snapshot.layouts[0]);mutate(bad.assembly);
    assert.throws(()=>restoreLayout(graph,bad),/иерархия/);
  }
  const legacy=structuredClone(snapshot.layouts[0]);delete legacy.assembly;
  assert.ok(validateTransport(restoreLayout(graph,legacy)),'older saved factories remain compatible');
});

test('portable JSON restores manual positions, exact cells, sources and UI state after serialization',()=>{
  const moved=moveBuilding(scene,'a',{x:scene.nodes[0].x-320,y:scene.nodes[0].y});
  const snapshot=createFactory({graph,sources:{f1:'package p // Юникод'},layouts:[saveLayout(options,moved)],view:options,
    camera:{x:-123,y:45,zoom:.75},selected:'a',tracing:true,time:13.5,speed:2,playing:false});
  const restored=parseFactory(JSON.stringify(snapshot)),built=restoreLayout(restored.graph,restored.layouts[0]);
  assert.deepEqual(restored.sources,snapshot.sources);assert.deepEqual(restored.camera,snapshot.camera);
  assert.equal(restored.selected,'a');assert.equal(restored.tracing,true);assert.equal(restored.playing,false);assert.equal(restored.speed,2);assert.equal(restored.time,13.5);
  assert.deepEqual(built.nodes.map(n=>[n.id,n.x,n.y]),moved.nodes.map(n=>[n.id,n.x,n.y]));
  const routes=s=>Object.fromEntries(s.edges.map(e=>[e.id,{cells:e.cells,points:e.points,length:e.length}]));
  assert.deepEqual(routes(built),routes(moved));assert.ok(validateTransport(built));
});

test('legacy graphs get a default view and malformed factories are rejected',()=>{
  const old=parseFactory('\uFEFF'+JSON.stringify(graph));assert.equal(old.view.fn,'run');assert.deepEqual(old.layouts,[]);
  const valid=createFactory({graph,view:options,layouts:[saveLayout(options,scene)]});
  for(const mutate of [s=>s.version=99,s=>s.graph.nodes.push({...s.graph.nodes[0]}),s=>s.graph.edges[0].to='missing',s=>s.camera={x:0,y:0,zoom:0},s=>s.graph.nodes[0].source.line='1',s=>s.view.fn='missing',s=>s.sources={missing:'source'},s=>s.layouts.push(s.layouts[0]),s=>s.view.layers={belt:'no'}]){
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>parseFactory(bad));
  }
  for(const mutate of [r=>r.nodes[0].x=NaN,r=>r.nodes[0].x+=1,r=>r.nodes[0].id='unknown',r=>r.nodes[0]={...r.nodes[1]},r=>r.edges[0].cells[1].x+=10,r=>r.edges[0].startDir=7,r=>r.edges.pop(),r=>r.nodes[0].x=r.nodes[1].x]){
    const bad=structuredClone(valid.layouts[0]);mutate(bad);assert.throws(()=>restoreLayout(graph,bad));
  }
  assert.throws(()=>parseFactory('{broken'));assert.throws(()=>parseFactory(null));
});

test('view keys canonicalize visible layers and separate functions, sections, queries and modes',()=>{
  assert.equal(viewKey({layers:{belt:true,train:false}}),viewKey({layers:{train:false}}));
  assert.equal(viewKey({layers:{train:false,belt:false}}),viewKey({layers:{belt:false,train:false}}));
  const keys=[{}, {fn:'run'}, {fn:'run',part:1}, {fn:'run',part:-1}, {fn:'run',compact:false}, {fn:'run',query:'test'}].map(viewKey);
  assert.equal(new Set(keys).size,keys.length);
});

test('real demo with portals, junctions, trains and disposal round trips all workshops',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/demo-routing.json',import.meta.url)));
  for(const compact of [true,false])for(const fn of fixture.functions){
    const view=viewOptions({fn:fn.id,compact}),projected=projectView(fixture,view);
    const built=layoutGraph(projected,fixture.functions,fn.id),record=saveLayout(view,built),restored=restoreLayout(fixture,JSON.parse(JSON.stringify(record)));
    assert.ok(validateTransport(restored),fn.id);
    assert.deepEqual(restored.nodes.map(n=>[n.id,n.x,n.y]).sort(),built.nodes.map(n=>[n.id,n.x,n.y]).sort());
    assert.deepEqual(restored.edges.map(e=>[e.id,e.cells]).sort(),built.edges.map(e=>[e.id,e.cells]).sort());
    assert.deepEqual(saveLayout(view,restored),record,'route order and animation indexes must survive restoration');
  }
});

test('section catalogs, operation sections, and empty filtered views restore with matching topology',()=>{
  const fn='run',fixture={...graph,nodes:Array.from({length:60},(_,order)=>({id:'n'+order,kind:'machine',function:fn,order,label:'n'+order})),edges:[]};
  fixture.edges=fixture.nodes.slice(1).map((n,i)=>({id:'e'+i,from:fixture.nodes[i].id,to:n.id,kind:'belt'}));
  for(const part of [-1,0,1]){
    const options=viewOptions({fn,part}),view=projectView(fixture,options);
    const built=view.mode==='catalog'?layoutCatalog(view):layoutGraph(view,fixture.functions,fn);
    const restored=restoreLayout(fixture,saveLayout(options,built));
    assert.equal(restored.nodes.length,built.nodes.length);assert.ok(validateTransport(restored));
  }
  const options=viewOptions({query:'nothing-matches-at-all'}),built=layoutGraph(projectView(graph,options),graph.functions);
  assert.equal(restoreLayout(graph,saveLayout(options,built)).nodes.length,0);
});

test('unavailable browser storage rejects explicitly',async()=>{
  await assert.rejects(factoryStore(null).load(),/недоступно/);
});
