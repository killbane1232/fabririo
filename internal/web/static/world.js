import {palette} from './graph.js';
import {factoryStyle,edgeStyles} from './appearance.js';
import {TILE_SIZE} from './routing.js';
import {snapPosition} from './factory-layout.js';
import {drawTrack,drawGroundBelt,drawBridge,drawBeltCargo,drawTrain} from './transport.js';

function rounded(c,x,y,w,h,r=4){c.beginPath();c.roundRect(x,y,w,h,r);}
function rect(c,x,y,w,h,fill,stroke){c.fillStyle=fill;c.fillRect(x,y,w,h);if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.strokeRect(x+.5,y+.5,w-1,h-1);}}
function line(c,points,color,width=1){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function ellipse(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
function poly(c,points,fill,stroke){c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
function gear(c,x,y,r,t,color){c.save();c.translate(x,y);c.rotate(t);c.fillStyle=color;for(let i=0;i<8;i++){c.rotate(Math.PI/4);c.fillRect(-r*.25,-r*1.18,r*.5,r*.55);}ellipse(c,0,0,r,r,color);ellipse(c,0,0,r*.44,r*.44,'#253429');ellipse(c,0,0,r*.16,r*.16,'#68715a');c.restore();}

export function drawBuilding(c,n,t=0,selected=false,hovered=false){
  c.save();c.translate(n.x||0,n.y||0);const color=palette[n.kind]||palette.machine,paint=factoryStyle(n);
  if(n.kind==='trash'){
    const half=TILE_SIZE/2;
    rect(c,-half,-half,TILE_SIZE,TILE_SIZE,paint.dark,paint.color);
    rect(c,-11,-8,22,19,'#616e56','#a7b18a');rect(c,-13,-12,26,5,paint.color,paint.light);rect(c,-5,-15,10,3,'#869273');
    for(const x of [-7,-1,5])rect(c,x,-5,3,12,'#35452f');
    rect(c,-10,11,5,3,'#1c2b1d');rect(c,5,11,5,3,'#1c2b1d');
    if(selected||hovered){c.strokeStyle=selected?'#f2cd7d':'#b1c395';c.lineWidth=2;c.strokeRect(-half,-half,TILE_SIZE,TILE_SIZE);}
    c.restore();return;
  }
  const footprint=n.w||TILE_SIZE*3;
  rect(c,-footprint/2,-footprint/2,footprint,footprint,paint.dark,paint.color);
  for(let i=-footprint/2+TILE_SIZE;i<footprint/2;i+=TILE_SIZE){line(c,[{x:i,y:-footprint/2},{x:i,y:footprint/2}],'#819b5920');line(c,[{x:-footprint/2,y:i},{x:footprint/2,y:i}],'#819b5920');}
  rect(c,-footprint/2,-footprint/2,footprint,5,paint.color);
  ellipse(c,5,26,43,16,'#11190e55');
  if(selected||hovered){c.strokeStyle=selected?'#f2cd7d':'#bacb9666';c.lineWidth=selected?2:1;c.setLineDash([5,4]);rounded(c,-47,-48,94,91,8);c.stroke();c.setLineDash([]);}
  poly(c,[[-36,-18],[25,-18],[38,-6],[38,28],[-24,28],[-36,17]],'#26342a','#566747');
  rect(c,-31,-18,61,40,paint.base,paint.color);rect(c,-31,22,61,6,'#1f2d23');
  for(const x of [-27,24])for(const y of [-14,17]){ellipse(c,x,y,1.7,1.7,'#95a17a');}
  if(n.kind==='rocket'){
    ellipse(c,1,5,25,13,'#17271d');ellipse(c,1,3,20,10,'#606d51');
    const flight=(t*.14+(n.order||0)*.173)%1,lift=flight>.62?(flight-.62)/.38*105:0;
    c.save();c.translate(0,-lift);
    poly(c,[[-7,4],[0,21+Math.sin(t*14)*4],[8,4]],'#e9aa54');poly(c,[[-4,4],[0,13],[4,4]],'#fae39f');
    poly(c,[[-8,-11],[-18,5],[-17,15],[-7,8]],'#aa7250','#d09d73');poly(c,[[7,-11],[17,5],[16,15],[7,8]],'#845a42','#c28c5e');
    rounded(c,-9,-33,18,41,8);c.fillStyle='#cfceb0';c.fill();poly(c,[[-8,-28],[0,-46],[8,-28]],'#db9470','#f0b386');
    rect(c,-8,-13,16,5,'#a66146');ellipse(c,0,-22,4.5,5.5,'#2d5355');ellipse(c,-1,-24,2,2,'#8cb9b2');rect(c,-6,5,12,4,'#5c6650');c.restore();
    rect(c,25,-22,4,35,'#7f8b62');rect(c,22,-23,10,3,'#c7bb79');
  }else if(n.kind==='warehouse'){
    rect(c,-25,-28,48,43,paint.color,paint.light);rect(c,23,-27,9,42,'#4e6d5d');poly(c,[[-31,-27],[-7,-46],[34,-28]],'#789aa0','#acc8c3');
    rect(c,-17,-12,31,27,'#283f36','#aac0a5');for(let y=-9;y<14;y+=5)rect(c,-15,y,27,2,'#55796c');rect(c,-23,-22,43,5,'#a7bbb1');
    for(const [x,y] of [[21,15],[-24,20],[10,22]]){rect(c,x-5,y-9,12,12,'#b29e69','#d5c492');rect(c,x,y-8,2,10,'#766b48');}
  }else if(n.kind==='station'){
    rect(c,-42,10,84,12,'#4d6952','#8a9f74');for(let x=-37;x<40;x+=9)rect(c,x,10,4,3,'#bdba7b');
    rect(c,-25,-25,45,29,paint.color,paint.light);poly(c,[[-30,-27],[-13,-38],[27,-27]],'#77aa93','#a2c5a7');rect(c,-20,-18,15,14,'#243f36');rect(c,-17,-16,9,8,'#accbab');rect(c,1,-16,12,20,'#2c4b3e');
    rect(c,28,-28,3,43,'#7d946b');ellipse(c,29,-31,4,4,Math.sin(t*2)>-.5?'#b8d97c':'#58774d');rect(c,-5,-31,23,9,'#26493c');rect(c,-2,-28,17,2,'#b1d2b4');
  }else if(n.kind==='source'){
    rect(c,-23,-9,46,23,paint.base,paint.color);poly(c,[[-23,-9],[-9,-25],[37,-25],[23,-9]],'#a1ae73','#c5cf9a');poly(c,[[23,-9],[37,-25],[37,0],[23,14]],'#4e6843','#8da46d');
    line(c,[{x:-10,y:-9},{x:5,y:-25}],'#617950',3);rect(c,-8,-8,4,20,'#c3ba7a');rect(c,-20,2,12,4,'#a5ba7f');
  }else if(n.kind==='splitter'){
    poly(c,[[0,-35],[29,-10],[0,18],[-29,-10]],'#ac9d63','#d7ca91');poly(c,[[0,-27],[21,-10],[0,10],[-21,-10]],'#3a4f37');
    line(c,[{x:0,y:6},{x:0,y:-14},{x:-10,y:-14}],'#d8ca85',3);line(c,[{x:0,y:-14},{x:10,y:-14}],'#d8ca85',3);ellipse(c,0,-10,4,4,'#ead294');
  }else if(n.kind==='output'){
    rect(c,-27,-16,54,30,paint.base,paint.color);poly(c,[[-15,-7],[3,-7],[3,-16],[21,-1],[3,14],[3,5],[-15,5]],'#b9cb91');
  }else{
    rect(c,-24,-27,46,40,paint.color,paint.light);rect(c,22,-26,10,39,'#484f36');rect(c,-20,-23,36,30,'#303f2e','#8c9768');
    gear(c,-5,-10,12,t*.7,paint.color);gear(c,10,1,7,-t,'#8d9b68');rect(c,-26,15,56,4,paint.color);
    rect(c,24,-40,6,18,'#6d7b51');rect(c,23,-43,8,4,'#a5ae7b');
    if(n.kind==='memory'){rect(c,-13,-19,25,17,'#8eac77','#cadba5');for(let x=-9;x<12;x+=6)rect(c,x,-15,3,9,'#354f31');}
    for(let i=0;i<3;i++){const phase=(t*.2+i*.32)%1;ellipse(c,27+Math.sin(phase*5+i)*5,-48-phase*22,3+phase*6,2+phase*5,`rgba(157,169,122,${(1-phase)*.13})`);}
  }
  ellipse(c,-28,21,2,2,color);c.restore();
}

export class FactoryWorld{
  constructor(canvas,minimap,onSelect,onHover){
    this.canvas=canvas;this.mini=minimap;this.c=canvas.getContext('2d');this.mc=minimap.getContext('2d');this.select=onSelect;this.hover=onHover;
    this.camera={x:0,y:0,zoom:1};this.scene={nodes:[],edges:[],districts:[],bounds:{x:0,y:0,w:1000,h:500}};this.time=0;this.speed=1;this.playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.selected='';this.hovered='';this.trace=null;this.last=0;this.lastMini=0;this.pointer=null;
    this.resize();new ResizeObserver(()=>this.resize()).observe(canvas);this.installEvents();requestAnimationFrame(t=>this.frame(t));
  }
  resize(){const dpr=Math.min(devicePixelRatio||1,2),r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;this.dpr=dpr;this.canvas.width=r.width*dpr;this.canvas.height=r.height*dpr;if(!this.fitted&&this.scene.nodes.length)this.fit();}
  setScene(scene,{keepCamera=false}={}){this.cancelPointer();this.scene=scene;if(!keepCamera){this.fit();if(this.camera.zoom<.5&&scene.nodes.length){const d=scene.districts[0]||scene.bounds;this.camera.zoom=.5;this.camera.x=this.width/2-(d.x+Math.min(d.w/2,760))*.5;this.camera.y=180+(this.height-260)/2-(d.y+Math.min(d.h/2,480))*.5;this.updateZoom();}}this.drawMini();}
  fit(){const b=this.scene.bounds;const availableH=Math.max(180,this.height-250),availableW=Math.max(200,this.width-60);this.camera.zoom=Math.min(1.15,Math.max(.05,Math.min(availableW/b.w,availableH/b.h)));this.camera.x=this.width/2-(b.x+b.w/2)*this.camera.zoom;this.camera.y=190+availableH/2-(b.y+b.h/2)*this.camera.zoom;this.fitted=true;this.updateZoom();}
  updateZoom(){document.querySelector('#zoom-label').textContent=Math.round(this.camera.zoom*100)+'%';this.onChange?.();}
  zoom(factor,x=this.width/2,y=this.height/2){const z=Math.min(3,Math.max(.035,this.camera.zoom*factor)),ratio=z/this.camera.zoom;this.camera.x=x-(x-this.camera.x)*ratio;this.camera.y=y-(y-this.camera.y)*ratio;this.camera.zoom=z;this.updateZoom();}
  worldPoint(x,y){return {x:(x-this.camera.x)/this.camera.zoom,y:(y-this.camera.y)/this.camera.zoom};}
  nodeAt(x,y){const p=this.worldPoint(x,y);return [...this.scene.nodes].reverse().find(n=>Math.abs(p.x-n.x)<=n.w/2&&Math.abs(p.y-n.y)<=n.h/2);}
  centerNode(id){const n=this.scene.nodes.find(n=>n.id===id);if(!n)return;this.camera.zoom=Math.max(this.camera.zoom,.85);this.camera.x=this.width/2-n.x*this.camera.zoom;this.camera.y=this.height/2-n.y*this.camera.zoom;this.updateZoom();}
  cancelPointer(){const id=this.pointer?.id;this.pointer=null;this.dragPreview=null;this.canvas.classList.remove('dragging');if(id!==undefined&&this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);}
  installEvents(){
    const c=this.canvas;
    c.addEventListener('pointerdown',e=>{if(this.pointer||![0,1].includes(e.button)||this.canInteract?.()===false)return;e.preventDefault();const node=e.button===0&&!e.shiftKey&&this.onMove?this.nodeAt(e.offsetX,e.offsetY):null;this.pointer={id:e.pointerId,x:e.offsetX,y:e.offsetY,startX:e.offsetX,startY:e.offsetY,moved:false,node,panOnly:e.button!==0||e.shiftKey};c.setPointerCapture(e.pointerId);c.classList.add('dragging');});
    c.addEventListener('pointermove',e=>{if(this.pointer){const p=this.pointer;if(p.id!==e.pointerId)return;const dx=e.offsetX-p.x,dy=e.offsetY-p.y;if(Math.hypot(e.offsetX-p.startX,e.offsetY-p.startY)>4)p.moved=true;
      if(p.node){if(p.moved)this.dragPreview={...p.node,x:snapPosition(p.node.x+(e.offsetX-p.startX)/this.camera.zoom),y:snapPosition(p.node.y+(e.offsetY-p.startY)/this.camera.zoom)};}
      else{this.camera.x+=dx;this.camera.y+=dy;}p.x=e.offsetX;p.y=e.offsetY;this.hover(null);}
      else{const n=this.nodeAt(e.offsetX,e.offsetY);this.hovered=n?.id||'';c.style.cursor=n&&this.onMove?'move':n?'pointer':'grab';this.hover(n,e.offsetX,e.offsetY);}});
    c.addEventListener('pointerup',e=>{const p=this.pointer;if(p?.id!==e.pointerId)return;const preview=this.dragPreview;this.cancelPointer();if(p.moved){if(p.node&&preview&&(preview.x!==p.node.x||preview.y!==p.node.y))this.onMove(p.node,preview);else if(!p.node)this.onChange?.();}else if(!p.panOnly)this.select(this.nodeAt(e.offsetX,e.offsetY)||null);});
    c.addEventListener('pointercancel',()=>this.cancelPointer());c.addEventListener('lostpointercapture',()=>this.cancelPointer());c.addEventListener('pointerleave',()=>{this.hover(null);this.hovered='';});
    c.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancelPointer();});
    c.addEventListener('wheel',e=>{e.preventDefault();if(this.pointer)return;this.zoom(Math.exp(-e.deltaY*.0014),e.offsetX,e.offsetY);},{passive:false});
    this.mini.addEventListener('pointerdown',e=>{const rect=this.mini.getBoundingClientRect(),b=this.scene.bounds,pad=10,scale=Math.min((rect.width-pad*2)/b.w,(rect.height-pad*2)/b.h),ox=(rect.width-b.w*scale)/2,oy=(rect.height-b.h*scale)/2;const x=b.x+(e.offsetX-ox)/scale,y=b.y+(e.offsetY-oy)/scale;this.camera.x=this.width/2-x*this.camera.zoom;this.camera.y=this.height/2-y*this.camera.zoom;this.onChange?.();});
  }
  frame(now){const dt=Math.min(.05,(now-(this.last||now))/1000);this.last=now;if(this.playing&&!document.hidden)this.time+=dt*this.speed;if(!document.hidden){this.draw();if(now-this.lastMini>150){this.drawMini();this.lastMini=now;}}requestAnimationFrame(t=>this.frame(t));}
  draw(){drawFactoryFrame(this.c,this);if(this.dragPreview){const c=this.c;c.save();c.setTransform(this.dpr,0,0,this.dpr,0,0);c.translate(this.camera.x,this.camera.y);c.scale(this.camera.zoom,this.camera.zoom);c.globalAlpha=.7;drawBuilding(c,this.dragPreview,this.time,true);c.restore();}}
  drawMini(){const c=this.mc,w=this.mini.width,h=this.mini.height,b=this.scene.bounds,pad=12,scale=Math.min((w-pad*2)/b.w,(h-pad*2)/b.h);c.clearRect(0,0,w,h);c.save();c.translate((w-b.w*scale)/2,(h-b.h*scale)/2);c.scale(scale,scale);c.translate(-b.x,-b.y);for(const d of this.scene.districts)rect(c,d.x,d.y,d.w,d.h,factoryStyle(d.id).dark);for(const e of this.scene.edges)line(c,e.points,edgeStyles(e)[0].color,Math.max(2,1/scale));for(const n of this.scene.nodes)rect(c,n.x-10,n.y-10,20,20,factoryStyle(n).color);c.strokeStyle='#d9ce90';c.lineWidth=1/scale;c.strokeRect(-this.camera.x/this.camera.zoom,-this.camera.y/this.camera.zoom,this.width/this.camera.zoom,this.height/this.camera.zoom);c.restore();}
}

// The live canvas and GIF worker use exactly the same renderer at explicit times.
export function drawFactoryFrame(c,{scene,camera,width,height,time=0,dpr=1,trace=null,selected='',hovered=''}){
    const {x,y,zoom:z}=camera;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);c.fillStyle='#2b3628';c.fillRect(0,0,width,height);
    c.save();c.translate(x,y);c.scale(z,z);
    const left=-x/z,top=-y/z,right=left+width/z,bottom=top+height/z;
    // World-space terrain repeats deterministically without image assets.
    const step=z>.25?TILE_SIZE:TILE_SIZE*4;c.lineWidth=1/z;c.strokeStyle='#71816018';c.beginPath();
    for(let gx=Math.floor(left/step)*step;gx<right;gx+=step){c.moveTo(gx,top);c.lineTo(gx,bottom);}for(let gy=Math.floor(top/step)*step;gy<bottom;gy+=step){c.moveTo(left,gy);c.lineTo(right,gy);}c.stroke();
    const terrainStep=160;for(let gx=Math.floor(left/terrainStep);gx<right/terrainStep;gx++){for(let gy=Math.floor(top/terrainStep);gy<bottom/terrainStep;gy++){const seed=Math.abs(Math.sin(gx*127.1+gy*311.7)*43758.5453)%1;if(seed>.64){const px=gx*terrainStep+seed*60,py=gy*terrainStep+seed*50;ellipse(c,px,py,13+seed*20,6+seed*12,'#52614417');for(let i=0;i<4;i++)rect(c,px+Math.sin(i*4+seed)*20,py+Math.cos(i)*12,3,2,'#83916b22');}}}
    for(const d of scene.districts){if(d.x+d.w<left||d.x>right||d.y+d.h<top||d.y>bottom)continue;const paint=factoryStyle(d.id);rounded(c,d.x,d.y,d.w,d.h,10);c.fillStyle=paint.tint;c.fill();c.strokeStyle=paint.base;c.lineWidth=1;c.setLineDash([6,8]);c.stroke();c.setLineDash([]);c.fillStyle=paint.color;c.font='11px ui-monospace,monospace';c.fillText(d.name,d.x+24,d.y+27);c.fillStyle='#667e59';c.font='8px ui-monospace,monospace';c.fillText(`${d.count} ОБЪЕКТОВ   /   ${d.package}`,d.x+24,d.y+44);}
    const inViewport=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return Math.max(...xs)>left-60&&Math.min(...xs)<right+60&&Math.max(...ys)>top-60&&Math.min(...ys)<bottom+60;};
    const visibleEdges=scene.edges.filter(e=>inViewport(e.points));
    const opacity=e=>{c.globalAlpha=trace&&(!trace.has(e.from)||!trace.has(e.to))?.08:1;};
    for(const e of visibleEdges){opacity(e);if(e.kind==='train')drawTrack(c,e);else drawGroundBelt(c,e,time,z);}
    for(const e of visibleEdges){opacity(e);if(e.kind==='train')drawTrain(c,e,time);else drawBeltCargo(c,e,time,false);}
    for(const e of visibleEdges){opacity(e);for(const bridge of e.bridges)drawBridge(c,bridge,time,z,e);}
    for(const e of visibleEdges){opacity(e);if(e.kind!=='train')drawBeltCargo(c,e,time,true);}
    c.globalAlpha=1;
    for(const n of scene.nodes){if(n.x<left-100||n.x>right+100||n.y<top-100||n.y>bottom+100)continue;c.globalAlpha=trace&&!trace.has(n.id)?.13:1;drawBuilding(c,n,time,selected===n.id,hovered===n.id);if(z>.2){const label=n.label.replace(/forge\.local\//g,'').replace(/\(\*([^)]*)\)\./g,'$1.');const short=label.length>24?label.slice(0,22)+'…':label;c.font='10px ui-monospace,monospace';c.textAlign='center';const width=c.measureText(short).width;rounded(c,n.x-width/2-5,n.y+34,width+10,17,3);c.fillStyle='#1a271cdb';c.fill();c.fillStyle=factoryStyle(n).color;c.fillText(short,n.x,n.y+46);if(n.protocol){c.font='7px ui-monospace,monospace';c.fillStyle='#94a77f';c.fillText(n.protocol.toUpperCase(),n.x,n.y+61);}c.textAlign='left';}}
    c.globalAlpha=1;c.restore();
    const vignette=c.createRadialGradient(width/2,height/2,20,width/2,height/2,Math.max(width,height)*.8);vignette.addColorStop(0,'#0b160a00');vignette.addColorStop(1,'#0b160a55');c.fillStyle=vignette;c.fillRect(0,0,width,height);
}
