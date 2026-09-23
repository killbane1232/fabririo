import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleGraph,layoutGraph,traceGraph,pointOnRoute} from '../internal/web/static/graph.js';

const node=(id,kind='machine',extra={})=>({id,kind,function:'main',label:id,order:Number(id.slice(1))||0,...extra});
const edge=(from,to,kind='belt')=>({id:from+to,from,to,kind,label:'cargo'});
test('compact projection preserves channel tracks through conversions',()=>{
 const graph={nodes:[node('n1'),node('n2','machine',{helper:true}),node('n3','station')],edges:[edge('n1','n2'),edge('n2','n3','train')]};
 const view=visibleGraph(graph);assert.deepEqual(view.nodes.map(n=>n.id),['n1','n3']);assert.equal(view.edges[0].kind,'train');
 assert.equal(visibleGraph(graph,{layers:{train:false}}).edges.length,0);
});
test('hidden sink does not create imaginary bypass belts',()=>{
 const graph={nodes:[node('n1'),node('n2','rocket'),node('n3')],edges:[edge('n1','n2'),edge('n2','n3')]};
 assert.equal(visibleGraph(graph,{layers:{rocket:false}}).edges.length,0);
});
test('tracing follows upstream and downstream without unrelated sibling branches',()=>{
 const graph={edges:[edge('a','b'),edge('b','c'),edge('a','d'),edge('c','e'),edge('e','c')]};
 assert.deepEqual([...traceGraph(graph,'b')].sort(),['a','b','c','e']);
});
test('focus retains connected train endpoint from another function',()=>{
 const graph={nodes:[node('n1','station'),node('n2','station',{function:'producer'}),node('n3','machine',{function:'other'}),node('n4','rocket',{function:'producer'})],edges:[edge('n2','n1','train')]};
 const view=visibleGraph(graph,{fn:'main'});assert.deepEqual(view.nodes.map(n=>n.id),['n1','portal:producer']);assert.equal(view.edges[0].kind,'train');
 assert.equal(view.nodes.find(n=>n.isPortal).kind,'station');
});
test('layout creates finite positions and valid moving cargo including back edges',()=>{
 const graph={nodes:[node('n1'),node('n2'),node('n3','trash')],edges:[edge('n1','n2'),edge('n2','n1'),edge('n2','n3')]};
 const scene=layoutGraph(graph,[{id:'main',name:'Run',package:'demo'}]);
 for(const n of scene.nodes){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));}
 for(const e of scene.edges){for(const d of [-100,0,42,10000]){const p=pointOnRoute(e,d);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}}
});
