import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FactoryWorld} from '../internal/web/static/world.js';

function setup(){
 const handlers={},moves=[],selections=[],classes=new Set(),capture=new Set();let changes=0;
 const canvas={style:{},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},addEventListener:(name,fn)=>handlers[name]=fn,
   setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)};
 const world=Object.assign(Object.create(FactoryWorld.prototype),{canvas,mini:{addEventListener(){}},camera:{x:0,y:0,zoom:2},scene:{nodes:[{id:'a',x:112,y:112,w:96,h:96}]},hover(){},select:n=>selections.push(n),onMove:(n,p)=>moves.push({id:n.id,x:p.x,y:p.y}),onChange:()=>changes++});
 world.installEvents();const event=(name,extra={})=>handlers[name]({button:0,pointerId:1,offsetX:224,offsetY:224,preventDefault(){},...extra});
 return {world,moves,selections,event,classes,capture,changes:()=>changes};
}

test('drag uses world coordinates and grid snapping without changing camera or scene during preview',()=>{
 const t=setup();t.event('pointerdown');t.event('pointermove',{offsetX:352,offsetY:289});
 assert.deepEqual([t.world.dragPreview.x,t.world.dragPreview.y],[176,144]);
 assert.deepEqual(t.world.camera,{x:0,y:0,zoom:2});assert.equal(t.world.scene.nodes[0].x,112);
 t.event('pointerup',{offsetX:352,offsetY:289});assert.deepEqual(t.moves,[{id:'a',x:176,y:144}]);assert.deepEqual(t.selections,[]);assert.equal(t.capture.size,0);
});
test('click selects, Shift and middle button pan even when starting over a building',()=>{
 const t=setup();t.event('pointerdown');t.event('pointerup');assert.equal(t.selections[0].id,'a');assert.equal(t.moves.length,0);
 for(const extra of [{shiftKey:true},{button:1}]){
   const t=setup();t.event('pointerdown',extra);t.event('pointermove',{offsetX:300,offsetY:260});t.event('pointerup');
   assert.deepEqual(t.world.camera,{x:76,y:36,zoom:2});assert.equal(t.moves.length,0);assert.equal(t.selections.length,0);assert.equal(t.changes(),1);
 }
});
test('pointer cancellation, lost capture, Escape and scene change discard drag previews',()=>{
 for(const action of ['pointercancel','lostpointercapture','keydown']){
   const t=setup();t.event('pointerdown');t.event('pointermove',{offsetX:352});t.event(action,{key:'Escape'});t.event('pointerup');
   assert.equal(t.moves.length,0);assert.equal(t.world.dragPreview,null);assert.equal(t.world.pointer,null);assert.equal(t.classes.size,0);
 }
 const t=setup();t.event('pointerdown');t.event('pointermove',{pointerId:2,offsetX:352});assert.equal(t.world.dragPreview,undefined);
 t.world.canInteract=()=>false;t.world.cancelPointer();t.event('pointerdown');assert.equal(t.world.pointer,null);
});
