import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cargoStyle,cargoTypes,factoryStyle,drawCargoShape} from '../internal/web/static/appearance.js';
import {visibleGraph} from '../internal/web/static/graph.js';
import {sectionView,packageOverview} from '../internal/web/static/explorer.js';
import {addTransportJunctions} from '../internal/web/static/routing.js';
import {drawGroundBelt,drawBridge,drawBeltCargo,drawTrain,beltArrowMarkers,drawBeltArrows} from '../internal/web/static/transport.js';
import {measurePath} from '../internal/web/static/geometry.js';

const node=(id,extra={})=>({id,label:id,kind:'machine',function:'main',package:'p',order:0,...extra});
const edge=(id,from,to,type,extra={})=>({id,from,to,type,kind:'belt',...extra});

test('Go families have distinct silhouettes and colors, with stable alias identities',()=>{
  const types=['bool','int','float64','string','[]byte','[8]byte','map[string]int','*Item','chan Item','func(int)','interface{}','error'];
  assert.equal(new Set(types.map(t=>cargoStyle(t).shape)).size,types.length);
  assert.equal(new Set(types.map(t=>cargoStyle(t).color)).size,types.length);
  assert.deepEqual(cargoStyle('[]byte'),cargoStyle('[]uint8'));
  assert.deepEqual(cargoStyle('any'),cargoStyle('interface {}'));
  assert.deepEqual(cargoStyle('untyped int'),cargoStyle('int'));
  assert.notEqual(cargoStyle('domain.Message').color,cargoStyle('domain.User').color);
  assert.notEqual(cargoStyle('int32').color,cargoStyle('int64').color);
});

test('method colors follow the callee across callers; directories use the owning workshop',()=>{
  const a=node('a',{method:'(*p.Store).Save'}),b=node('b',{method:a.method,function:'other'});
  assert.equal(factoryStyle(a).color,factoryStyle(b).color);
  assert.notEqual(factoryStyle(a).color,factoryStyle({...a,method:'(*p.Store).Load'}).color);
  assert.notEqual(factoryStyle(a).color,factoryStyle({...a,method:'(*p.Cache).Save'}).color);
  for(const flag of ['isPortal','isSection','isSectionHub','isJunction'])assert.equal(factoryStyle({...a,[flag]:true}).color,factoryStyle('main').color);
  assert.notEqual(factoryStyle({isPackage:true,package:'a'}).color,factoryStyle({isPackage:true,package:'b'}).color);
});

test('compact routes retain different payloads even when helper branches converge',()=>{
  const graph={nodes:[node('a'),node('h',{helper:true}),node('b')],edges:[edge('a1','a','h','string'),edge('a2','a','h','int'),edge('hb','h','b','bool')]};
  // The final conversion really transports bool, not its earlier input type.
  assert.deepEqual(cargoTypes(visibleGraph(graph).edges[0]),['bool']);
  graph.edges=[edge('ab1','a','b','string'),edge('ab2','a','b','int')];
  assert.deepEqual(cargoTypes(visibleGraph(graph).edges[0]),['int','string']);
  graph.nodes.push(node('c',{function:'other'}),node('d',{function:'other'}));
  graph.edges=[edge('ac','a','c','int'),edge('ad','a','d','string')];
  assert.deepEqual(cargoTypes(visibleGraph(graph,{fn:'main'}).edges[0]),['int','string']);
});

test('section and package aggregation preserve every transported type without mutating the source',()=>{
  const nodes=Array.from({length:55},(_,i)=>node('n'+i,{order:i}));
  const edges=[edge('a','n0','n25','int'),edge('b','n0','n26','string')];
  const graph={nodes,edges},snapshot=JSON.stringify(graph);
  assert.deepEqual(cargoTypes(sectionView(graph,'main').edges[0]),['int','string']);
  nodes[25].package=nodes[26].package='q';
  const overview=packageOverview({nodes,edges,functions:[{package:'p'},{package:'q'}]});
  assert.deepEqual(cargoTypes(overview.edges[0]),['int','string']);
  nodes[25].package=nodes[26].package='p';assert.equal(JSON.stringify(graph),snapshot);
});

test('busy merger belts inherit branch payloads, never the receiving machine result type',()=>{
  const nodes=[node('target',{type:'error'}),...Array.from({length:7},(_,i)=>node('n'+i))];
  const types=['string','int','[]byte','bool','float64','*Item','chan int'];
  const edges=types.map((type,i)=>edge('e'+i,'n'+i,'target',type));
  const view={nodes,edges},snapshot=JSON.stringify(view),result=addTransportJunctions(view);
  const root=result.edges.find(e=>e.to==='target');
  assert.deepEqual(cargoTypes(root),['*Item','[]uint8','bool','chan int','float64','int','string']);
  for(const link of result.edges.filter(e=>e.id.startsWith('link:'))){
    const incoming=result.edges.filter(e=>e.to===link.from);
    assert.deepEqual(cargoTypes(link),[...new Set(incoming.flatMap(cargoTypes))].sort());
  }
  assert.equal(JSON.stringify(view),snapshot);
});

// Capture real rendering calls: an elevated/disposed item must not be recolored
// by the bridge/disposal theme, and train wagons must use the same type artwork.
function context(){
  const calls=[],stack=[],c={calls,fillStyle:'',strokeStyle:'',lineWidth:1,
    save(){stack.push([this.fillStyle,this.strokeStyle]);},restore(){[this.fillStyle,this.strokeStyle]=stack.pop();},
    fill(){calls.push(['fill',this.fillStyle]);},stroke(){calls.push(['stroke',this.strokeStyle]);},
    fillRect(...args){calls.push(['fillRect',this.fillStyle,...args]);}};
  for(const op of ['beginPath','closePath','moveTo','lineTo','rect','roundRect','ellipse','translate','scale','rotate','setLineDash'])c[op]=(...args)=>calls.push([op,...args]);
  return c;
}
test('ground, bridge, disposal cargo and wagon all render with the actual payload color and shape',()=>{
  const points=[{x:0,y:0},{x:420,y:0}],bridge={points,basePoints:points,startDistance:0,endDistance:420};
  for(const type of ['string','bool','float64','[]byte','map[string]int','*Item','error']){
    const route={type,index:0,points,...measurePath(points),groundRuns:[points],bridges:[]};
    const style=cargoStyle(type),glyph=context();drawCargoShape(glyph,style);
    for(const render of [c=>drawGroundBelt(c,route,1,1),c=>drawBridge(c,bridge,1,1,route)]){
      const c=context();render(c);assert.ok(c.calls.some(x=>x[0]==='stroke'&&x[1]===style.color));
    }
    for(const render of [c=>drawBeltCargo(c,route,1,false),c=>drawBeltCargo(c,{...route,kind:'disposal',bridges:[bridge]},1,true),c=>drawTrain(c,route,2)]){
      const c=context();render(c);assert.ok(c.calls.some(x=>x[0]==='fill'&&x[1]===style.color),type);
      const geometry=calls=>calls.filter(x=>['rect','roundRect','ellipse','moveTo','lineTo'].includes(x[0]));
      const expected=geometry(glyph.calls);
      assert.ok(JSON.stringify(geometry(c.calls)).includes(JSON.stringify(expected).slice(1,-1)),type+' silhouette missing');
    }
  }
});

test('belt arrows repeat from source to target through all four directions and raised ramps',()=>{
  const points=[{x:0,y:0},{x:240,y:0},{x:240,y:240},{x:0,y:240},{x:0,y:20}];
  const arrows=beltArrowMarkers(points,1);assert.ok(arrows.length>20);
  for(const p of arrows){
    if(p.y===0)assert.equal(p.angle,0);
    else if(p.x===240)assert.equal(p.angle,Math.PI/2);
    else if(p.y===240)assert.equal(p.angle,Math.PI);
    else assert.equal(p.angle,-Math.PI/2);
  }
  const reversed=beltArrowMarkers([{x:240,y:0},{x:0,y:0}],1);assert.ok(reversed.every(p=>Math.abs(p.angle)===Math.PI));
  const ramp=[{x:0,y:0},{x:32,y:-14},{x:96,y:-14},{x:128,y:0}];
  const elevated=beltArrowMarkers(ramp,1);assert.ok(elevated.some(p=>p.y===-14));assert.ok(elevated.some(p=>p.angle<0));assert.ok(elevated.some(p=>p.angle>0));
  assert.equal(beltArrowMarkers([{x:0,y:0},{x:10,y:0}],.1).length,1);
  assert.deepEqual(beltArrowMarkers([{x:0,y:0},{x:0,y:0}],1),[]);
});

test('static arrow geometry is drawn on both ground and bridge regardless of animation time',()=>{
  const points=[{x:0,y:0},{x:300,y:0}],route={type:'bool',groundRuns:[points]},bridge={points,basePoints:points};
  for(const zoom of [.2,.5,1,2]){
    const expected=context();drawBeltArrows(expected,points,zoom);
    const path=c=>c.calls.filter(x=>['moveTo','lineTo'].includes(x[0]));
    for(const render of [(c,t)=>drawGroundBelt(c,route,t,zoom),(c,t)=>drawBridge(c,bridge,t,zoom,route)]){
      const first=context(),later=context();render(first,0);render(later,35);
      assert.deepEqual(path(first),path(later),'arrow moves with animation');
      assert.ok(JSON.stringify(path(first)).includes(JSON.stringify(path(expected)).slice(1,-1)),'missing static arrows');
      assert.ok(first.calls.some(x=>x[0]==='stroke'&&x[1]==='#f3efd6'),'missing contrast marking');
    }
  }
});
