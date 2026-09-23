// One stable identity drives cargo, belts, bridges, wagons and the legend.
// These mappings do not depend on route order, filtering or the layout worker.
export function normalizeType(type='') {
  return String(type).trim().replace(/\s+/g,' ').replace(/^untyped /,'')
    .replace(/\bbyte\b/g,'uint8').replace(/\brune\b/g,'int32').replace(/^any$/,'interface{}').replace(/interface\s*\{\s*\}/g,'interface{}');
}

export function cargoTypes(edge) {
  return [...new Set((edge.cargoTypes?.length ? edge.cargoTypes : [edge.type || '']).map(normalizeType))].sort();
}

// A physical merger may carry several types. Never substitute the receiving
// machine's result type for the payload on its incoming belts.
export function mergeCargoTypes(edges) {
  return [...new Set(edges.flatMap(cargoTypes))].sort();
}

function hash(text) {
  let result=2166136261;
  for(const char of text)result=Math.imul(result^char.codePointAt(0),16777619);
  return result>>>0;
}
function tones(hue,saturation=65,lightness=65) {
  return {color:`hsl(${hue} ${saturation}% ${lightness}%)`,light:`hsl(${hue} ${saturation}% 84%)`,
    dark:`hsl(${hue} 32% 22%)`,base:`hsl(${hue} 28% 30%)`,tint:`hsl(${hue} 48% 55% / .12)`};
}
const known={
  bool:['diamond',145],string:['capsule',47],int:['square',208],uint:['square',188],
  int8:['square',216],int16:['square',227],int32:['square',240],int64:['square',258],
  uint8:['square',172],uint16:['square',182],uint32:['square',195],uint64:['square',273],
  uintptr:['arrow',283],float32:['circle',22],float64:['circle',8],complex64:['pair',310],complex128:['pair',328],
  error:['cross',355],
};
const typeStyles=new Map(),methodStyles=new Map(),routeStyles=new WeakMap();

export function cargoStyle(type='') {
  type=normalizeType(type);
  if(typeStyles.has(type))return typeStyles.get(type);
  let shape,hue;
  if(known[type])[shape,hue]=known[type];
  else {
    shape=!type?'hexagon':type.startsWith('*')?'arrow':type.startsWith('[]')?'stack':/^\[\d+\]/.test(type)?'grid'
      :type.startsWith('map[')?'map':/^(<-chan|chan\b)/.test(type)?'channel':type.startsWith('func(')?'triangle'
      :type.startsWith('interface')?'ring':type.startsWith('(')?'pair':type.startsWith('struct{')||type.startsWith('struct {')?'hexagon'
      :['hexagon','pentagon','octagon','shield'][hash(type)%4];
    hue=(hash(type)%36000)/100;
  }
  const variant=hash(type),knownType=Object.hasOwn(known,type);
  const style=Object.freeze({type,label:type||'Без типа / управление',shape,
    ...tones(hue,!type?10:knownType?65:60+(variant>>>12)%13,!type?62:knownType?65:62+(variant>>>20)%9)});
  typeStyles.set(type,style);return style;
}

export function edgeStyles(edge) {
  if(!routeStyles.has(edge))routeStyles.set(edge,cargoTypes(edge).map(cargoStyle));
  return routeStyles.get(edge);
}

export function factoryKey(node) {
  if(node.isPackage)return node.package||node.id;
  if(node.isPortal||node.isSection||node.isSectionHub||node.isJunction)return node.function||node.id;
  return node.method||node.function||node.kind||'factory';
}
export function factoryStyle(node) {
  const key=typeof node==='string'?node:factoryKey(node);
  const variant=hash(key);
  if(!methodStyles.has(key))methodStyles.set(key,Object.freeze({key,...tones((variant%36000)/100,55+(variant>>>12)%14,61+(variant>>>20)%9)}));
  return methodStyles.get(key);
}

// Reuse the exact silhouette for a conveyor item, wagon body and legend icon.
// Width/height can stretch it into a wagon without changing the rail footprint.
export function drawCargoShape(c,style,x=0,y=0,width=11,height=11) {
  c.save();c.translate(x,y);c.scale(width/2,height/2);c.beginPath();
  const polygon=points=>{points.forEach(([px,py],i)=>i?c.lineTo(px,py):c.moveTo(px,py));c.closePath();};
  switch(style.shape){
    case 'circle':case 'ring':c.ellipse(0,0,1,1,0,0,Math.PI*2);break;
    case 'capsule':c.roundRect(-1,-.65,2,1.3,.6);break;
    case 'diamond':polygon([[0,-1],[1,0],[0,1],[-1,0]]);break;
    case 'triangle':polygon([[0,-1],[1,.9],[-1,.9]]);break;
    case 'arrow':polygon([[-1,-.55],[.15,-.55],[.15,-1],[1,0],[.15,1],[.15,.55],[-1,.55]]);break;
    case 'cross':polygon([[-.4,-1],[.4,-1],[.4,-.4],[1,-.4],[1,.4],[.4,.4],[.4,1],[-.4,1],[-.4,.4],[-1,.4],[-1,-.4],[-.4,-.4]]);break;
    case 'stack':polygon([[-1,-.7],[.4,-.7],[.4,-1],[1,-1],[1,.7],[-.4,.7],[-.4,1],[-1,1]]);break;
    case 'map':polygon([[-1,-.6],[0,-.95],[1,-.6],[1,.6],[0,.95],[-1,.6]]);break;
    case 'channel':polygon([[-1,-1],[1,-1],[1,-.4],[.55,-.4],[.55,.4],[1,.4],[1,1],[-1,1],[-1,.4],[-.55,.4],[-.55,-.4],[-1,-.4]]);break;
    case 'pair':c.ellipse(-.4,0,.6,.9,0,0,Math.PI*2);c.ellipse(.4,0,.6,.9,0,0,Math.PI*2);break;
    case 'shield':polygon([[-1,-1],[1,-1],[.8,.4],[0,1],[-.8,.4]]);break;
    case 'hexagon':case 'pentagon':case 'octagon':{
      const sides={hexagon:6,pentagon:5,octagon:8}[style.shape];
      polygon(Array.from({length:sides},(_,i)=>[Math.cos(i*2*Math.PI/sides-Math.PI/2),Math.sin(i*2*Math.PI/sides-Math.PI/2)]));break;
    }
    default:c.rect(-.9,-.9,1.8,1.8);
  }
  c.fillStyle=style.color;c.fill();c.strokeStyle=style.dark;c.lineWidth=2/Math.min(width,height);c.stroke();
  c.fillStyle=style.light;
  if(style.shape==='ring'){c.beginPath();c.ellipse(0,0,.46,.46,0,0,Math.PI*2);c.fillStyle=style.dark;c.fill();}
  else if(style.shape==='grid'){for(const dx of [-.45,.25])for(const dy of [-.45,.25])c.fillRect(dx,dy,.25,.25);}
  else if(style.shape==='map'||style.shape==='stack'){c.fillRect(-.55,-.35,1.1,.16);c.fillRect(-.55,.15,1.1,.16);}
  else c.fillRect(-.28,-.42,.38,.2);
  c.restore();
}
