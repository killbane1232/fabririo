import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectView,packageOverview,layoutCatalog,SECTION_SIZE} from '../internal/web/static/explorer.js';
import {visibleGraph,layoutGraph} from '../internal/web/static/graph.js';

function graph(size=1300){
  const functions=Array.from({length:4},(_,i)=>({id:`p${i%2}.Function${i}`,name:`Function${i}`,package:`p${i%2}`,source:{file:'f1',line:i+1}}));
  const nodes=Array.from({length:size},(_,i)=>({id:`n${i}`,kind:'machine',function:functions[i%4].id,package:functions[i%4].package,order:i,label:`value${i}`,source:{file:'f1',line:i+1}}));
  const edges=nodes.slice(1).map((n,i)=>({id:`e${i}`,from:nodes[i].id,to:n.id,kind:i%11===0?'train':'belt'}));
  return {functions,nodes,edges};
}

test('large project overview accounts for all cross-package connections',()=>{
  const g=graph(),snapshot=JSON.stringify(g),view=projectView(g,{fn:''});
  assert.equal(view.mode,'packages');assert.equal(view.nodes.length,2);
  assert.ok(view.nodes.every(n=>n.isPackage));
  assert.equal(view.edges.reduce((sum,e)=>sum+e.count,0),g.edges.length);
  assert.ok(packageOverview(g,{train:false}).edges.every(e=>e.kind!=='train'));
  assert.equal(JSON.stringify(g),snapshot,'overview changed the full graph');
});

test('package catalog and search expose every matching function',()=>{
  const g=graph(),view=projectView(g,{pkg:'p0'});
  assert.equal(view.mode,'catalog');assert.equal(view.nodes.length,2);
  assert.ok(view.nodes.every(n=>n.isPortal&&n.package==='p0'));
  const scene=layoutCatalog(view);assert.equal(scene.nodes.length,view.nodes.length);
  assert.ok(scene.nodes.every(n=>Number.isFinite(n.x)&&n.w===96));
  assert.equal(projectView(g,{query:'Function3'}).nodes[0].function,'p1.Function3');
});

test('sections expose every operation and every incident edge with explicit portals',()=>{
  const g=graph(210),fn=g.functions[0].id;
  for(const n of g.nodes){n.function=fn;n.package='p0';}
  // A common value fans out to remote sections; the portal retains all edges.
  for(let i=2;i<g.nodes.length;i++)g.edges.push({id:`fan${i}`,from:'n0',to:`n${i}`,kind:'belt'});
  const full=visibleGraph(g,{fn}),first=projectView(g,{fn}),coveredNodes=new Set(),coveredEdges=new Set();
  assert.equal(first.sectionCount,Math.ceil(g.nodes.length/SECTION_SIZE));
  assert.ok(first.nodes.some(n=>n.isSectionHub));
  for(let part=0;part<first.sectionCount;part++){
    const view=projectView(g,{fn,part});
    assert.equal(view.sectionIndex,part);
    const local=view.nodes.filter(n=>!n.isPortal&&!n.isSection&&!n.isSectionHub);
    assert.ok(local.length<=SECTION_SIZE);
    for(const n of local)coveredNodes.add(n.id);
    for(const e of view.edges){assert.equal(e.count,e.edgeIDs.length);for(const id of e.edgeIDs)coveredEdges.add(id);}
  }
  assert.deepEqual([...coveredNodes].sort(),g.nodes.map(n=>n.id).sort());
  assert.deepEqual([...coveredEdges].sort(),full.edges.map(e=>e.id).sort());
  const catalog=projectView(g,{fn,part:-1});assert.equal(catalog.catalogType,'sections');
  assert.equal(catalog.nodes.length,first.sectionCount);assert.ok(catalog.nodes.every(n=>n.isSection));
  assert.equal(projectView(g,{fn,part:999}).sectionIndex,first.sectionCount-1);
});

test('small projects retain their detailed whole-factory view',()=>{
  const g=graph(16),view=projectView(g,{fn:''});
  assert.equal(view.mode,'operations');assert.deepEqual(view.nodes,g.nodes);
});

// Real failing project shapes, with code, literals and source locations removed.
const cases=JSON.parse(readFileSync(new URL('./fixtures/huginn-sections.json',import.meta.url)));
for(const fixture of cases)test(`large-project routing regression: ${fixture.name}`,()=>{
  const scene=layoutGraph(fixture.view,[],fixture.focus),ground=new Set(),upper=new Set(),bridges=new Set();
  for(const e of fixture.view.edges)assert.ok(scene.edges.some(route=>route.id===e.id));
  for(const e of scene.edges){
    for(let i=0;i<e.cells.length;i++){
      const p=e.cells[i],set=p.layer?upper:ground,key=`${p.x},${p.y}`;
      assert.ok(!set.has(key),'transport overlaps on the same level');set.add(key);
      if(i)assert.equal(Math.abs(p.x-e.cells[i-1].x)+Math.abs(p.y-e.cells[i-1].y),1);
    }
    for(const b of e.bridges)for(const key of b.envelope){assert.ok(!bridges.has(key),'bridges intersect');bridges.add(key);}
  }
});
