import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CSV_COLUMNS,factoryCSV,csvCell,exportView,gifTiming,exportName} from '../internal/web/static/export-data.js';
import {GIFEncoder,GIFPalette} from '../internal/web/static/gif-encoder.js';

function parseCSV(text,delimiter=','){
  const rows=[];let row=[],value='',quoted=false;text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(value);value='';}
    else if(c==='\r'&&text[i+1]==='\n'&&!quoted){row.push(value);rows.push(row);row=[];value='';i++;}
    else value+=c;
  }
  assert.equal(quoted,false);return rows;
}
const graph={nodes:[{id:'a',kind:'machine',label:'значение, "строка"\nвторая',function:'p.Run',type:'int',source:{file:'f1',line:17},detail:'x + y'},{id:'hidden',kind:'source',label:'=1+1'}],edges:[{id:'e',from:'a',to:'hidden',type:'int',kind:'belt'}],files:{f1:'/src/Пример.go'}};
const scene={nodes:[{...graph.nodes[0],x:-16,y:32,w:96,h:96,tileSize:3}],edges:[{...graph.edges[0],to:'a',points:[{x:0,y:0},{x:32,y:64}],cells:[{x:1,y:1,layer:1}],length:320,bridges:[{}],cargoTypes:['int','string'],edgeIDs:['e','e2'],count:2}],bounds:{x:-50,y:-20,w:1200,h:500}};

test('CSV round trips Unicode, quoting, multiline labels, source paths and laid out routes',()=>{
  for(const delimiter of [',',';']){
    const csv=factoryCSV(graph,scene,{delimiter}),rows=parseCSV(csv,delimiter);
    assert.equal(csv.charCodeAt(0),0xfeff);assert.deepEqual(rows[0],CSV_COLUMNS);assert.equal(rows.length,3);
    const record=row=>Object.fromEntries(CSV_COLUMNS.map((key,i)=>[key,row[i]])),n=record(rows[1]),e=record(rows[2]);
    assert.equal(n.label,graph.nodes[0].label);assert.equal(n.source_file,'/src/Пример.go');assert.equal(n.x,'-16');
    assert.equal(e.length_tiles,'10');assert.equal(e.bridge_count,'1');assert.deepEqual(JSON.parse(e.points),scene.edges[0].points);
    assert.deepEqual(JSON.parse(e.cargo_types),['int','string']);assert.deepEqual(JSON.parse(e.original_edges),['e','e2']);
    assert.ok(rows.every(row=>row.length===CSV_COLUMNS.length));
  }
});
test('whole-project CSV retains hidden SSA and avoids inventing route coordinates',()=>{
  const rows=parseCSV(factoryCSV(graph,scene,{scope:'project'}));assert.equal(rows.length,4);
  assert.equal(rows[2][CSV_COLUMNS.indexOf('id')],'hidden');assert.equal(rows[2][CSV_COLUMNS.indexOf('label')],"'=1+1");
  assert.equal(rows[1][CSV_COLUMNS.indexOf('x')],'');assert.equal(rows[3][CSV_COLUMNS.indexOf('length_tiles')],'');
  for(const value of ['=SUM(A1)','+cmd','-cmd','@SUM(A1)','\t=1'])assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(-16),'"-16"');assert.throws(()=>factoryCSV(graph,scene,{scope:'unknown'}));
});
test('GIF camera scales the captured viewport or fits the entire built scene without touching live state',()=>{
  const camera={x:125,y:-75,zoom:1.3},viewport={width:1600,height:900},snapshot=JSON.stringify({scene,camera,viewport});
  const current=exportView(scene,camera,viewport,{size:960});assert.equal(current.width,960);assert.equal(current.height,540);
  assert.deepEqual(current.camera,{x:75,y:-45,zoom:.78});
  const full=exportView(scene,camera,viewport,{size:640,region:'scene'}),b=scene.bounds;
  assert.ok(b.x*full.camera.zoom+full.camera.x>=0);assert.ok((b.x+b.w)*full.camera.zoom+full.camera.x<=full.width);
  assert.ok(b.y*full.camera.zoom+full.camera.y>=0);assert.ok((b.y+b.h)*full.camera.zoom+full.camera.y<=full.height);
  assert.equal(JSON.stringify({scene,camera,viewport}),snapshot);
  assert.equal(exportView(scene,camera,{width:400,height:1200},{size:1280}).height,1280);
  assert.throws(()=>exportView(scene,camera,viewport,{size:100000}));
  assert.throws(()=>exportView(scene,camera,{width:0,height:0}));
});
test('GIF timing uses exact centisecond delays and keeps the requested duration',()=>{
  for(const duration of [3,6,10])for(const fps of [10,20]){const t=gifTiming(duration,fps);assert.equal(t.frames*t.delay/100,duration);assert.equal(t.frames*t.step,duration);}
  assert.throws(()=>gifTiming(100,60));assert.ok(!exportName('../../цех\\имя','csv').includes('/'));
});

test('standard GIF presets have exact dimensions with no viewport cropping or stretching',()=>{
  for(const [size,w,h] of [['720p',1280,720],['1080p',1920,1080],['2k',2560,1440],['4k',3840,2160]]){
    for(const viewport of [{width:800,height:900},{width:1600,height:400}]){
      const camera={x:120,y:-35,zoom:.5},view=exportView(scene,camera,viewport,{size});
      assert.deepEqual([view.width,view.height],[w,h]);
      assert.ok(view.clip.x>=0&&view.clip.y>=0&&view.clip.x+view.clip.w<=w+1e-7&&view.clip.y+view.clip.h<=h+1e-7);
      assert.ok(Math.abs(view.clip.w/view.clip.h-viewport.width/viewport.height)<1e-7);
      const screenCenterWorld={x:(viewport.width/2-camera.x)/camera.zoom,y:(viewport.height/2-camera.y)/camera.zoom};
      assert.ok(Math.abs(screenCenterWorld.x*view.camera.zoom+view.camera.x-w/2)<1e-7);
      assert.ok(Math.abs(screenCenterWorld.y*view.camera.zoom+view.camera.y-h/2)<1e-7);
      const full=exportView(scene,camera,viewport,{size,region:'scene'});assert.equal(full.clip,null);
      assert.ok(scene.bounds.x*full.camera.zoom+full.camera.x>=0);
      assert.ok((scene.bounds.x+scene.bounds.w)*full.camera.zoom+full.camera.x<=w);
    }
  }
});

test('delta GIF preserves still-frame delays, reserves transparency and compresses a moving object in 4K',()=>{
  const palette=new Uint8Array(768),pixels=new Uint8Array(3840*2160),encoder=new GIFEncoder(3840,2160,palette,{delta:true});
  pixels[100]=12;encoder.addFrame(pixels,10);encoder.addFrame(pixels,10);
  pixels[100]=0;pixels[20000]=12;encoder.addFrame(pixels,10);
  const bytes=encoder.finish();assert.ok(bytes.length<30000,'unchanged 4K background was re-encoded');
  assert.equal(bytes[6]+bytes[7]*256,3840);assert.equal(bytes[8]+bytes[9]*256,2160);
  const invalid=new GIFEncoder(1,1,palette,{delta:true});assert.throws(()=>invalid.addFrame(new Uint8Array([255]),10));
  assert.throws(()=>new GIFEncoder(3840,3840,palette));
  const colors=new GIFPalette(),rgba=new Uint8Array(4*256);
  for(let i=0;i<256;i++)rgba.set([i,i,i,255],i*4);colors.sample(rgba);
  assert.ok(colors.build({maxColors:255}).index(rgba).every(i=>i<255));
});
test('palette preserves isolated colors and encoder rejects empty or mismatched frames',()=>{
  const colors=new GIFPalette(),rgba=new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255]);colors.sample(rgba);
  const {palette,index}=colors.build(),indexed=index(rgba);
  assert.equal(new Set(indexed).size,3);for(let i=0;i<3;i++)assert.deepEqual([...palette.slice(indexed[i]*3,indexed[i]*3+3)],[...rgba.slice(i*4,i*4+3)]);
  const encoder=new GIFEncoder(3,1,palette);assert.throws(()=>encoder.finish());assert.throws(()=>encoder.addFrame(indexed.slice(1),10));
  encoder.addFrame(indexed,10);const bytes=encoder.finish();assert.equal(new TextDecoder().decode(bytes.slice(0,6)),'GIF89a');assert.equal(bytes.at(-1),0x3b);assert.throws(()=>encoder.finish());
});
