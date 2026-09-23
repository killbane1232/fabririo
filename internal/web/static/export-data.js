import {cargoTypes,cargoStyle,factoryStyle} from './appearance.js';
import {TILE_SIZE} from './routing.js';

export const CSV_COLUMNS=['record','id','kind','label','function','method','package','type','cargo_types','from','to','x','y','width','height','tile_size','length_tiles','bridge_count','points','cells','source_file','source_line','protocol','names','color','cargo_colors','cargo_shapes','original_edges','connection_count','detail'];

export function csvCell(value){
  if(value===undefined||value===null)return '';
  // Keep code labels literal when the CSV is opened in a spreadsheet. Numeric
  // coordinates remain numbers, including negative world coordinates.
  let text=typeof value==='object'?JSON.stringify(value):String(value);
  if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/u.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}

export function factoryCSV(graph,scene,{scope='scene',delimiter=','}={}){
  if(!['scene','project'].includes(scope))throw new Error('Неизвестная область CSV.');
  if(![',',';'].includes(delimiter))throw new Error('Неизвестный разделитель CSV.');
  const data=scope==='project'?graph:scene;
  const lines=['\uFEFF'+CSV_COLUMNS.join(delimiter)];
  const row=record=>lines.push(CSV_COLUMNS.map(key=>csvCell(record[key])).join(delimiter));
  for(const n of data.nodes){
    row({record:'node',id:n.id,kind:n.kind,label:n.label,function:n.function,method:n.method,package:n.package,type:n.type,
      x:n.x,y:n.y,width:n.w,height:n.h,tile_size:n.tileSize,source_file:graph.files?.[n.source?.file]||'',source_line:n.source?.line,
      protocol:n.protocol,names:n.names,color:factoryStyle(n).color,detail:n.detail});
  }
  for(const e of data.edges){
    const types=cargoTypes(e),styles=types.map(cargoStyle);
    row({record:'edge',id:e.id,kind:e.kind,label:e.label,type:e.type,cargo_types:types,from:e.from,to:e.to,
      length_tiles:Number.isFinite(e.length)?e.length/TILE_SIZE:undefined,bridge_count:e.bridges?.length,
      points:e.points,cells:e.cells,cargo_colors:styles.map(s=>s.color),cargo_shapes:styles.map(s=>s.shape),
      original_edges:e.edgeIDs||[e.id],connection_count:e.count||1});
  }
  return lines.join('\r\n')+'\r\n';
}

export const GIF_RESOLUTIONS=Object.freeze({
  '720p':Object.freeze({width:1280,height:720}),
  '1080p':Object.freeze({width:1920,height:1080}),
  '2k':Object.freeze({width:2560,height:1440}),
  '4k':Object.freeze({width:3840,height:2160}),
});

// The snapshot is independent of later zoom, resize, selection and animation.
export function exportView(scene,camera,viewport,{region='viewport',size='720p'}={}){
  if(!['viewport','scene'].includes(region))throw new Error('Неизвестная область GIF.');
  const preset=Object.hasOwn(GIF_RESOLUTIONS,size)?GIF_RESOLUTIONS[size]:null;
  const legacy=Number(size);
  if(!preset&&![640,960,1280].includes(legacy))throw new Error('Неподдерживаемый размер GIF.');
  if(!(viewport.width>0&&viewport.height>0))throw new Error('Карта ещё не готова.');
  const scale=preset?Math.min(preset.width/viewport.width,preset.height/viewport.height):legacy/Math.max(viewport.width,viewport.height);
  const width=preset?.width||Math.max(1,Math.round(viewport.width*scale)),height=preset?.height||Math.max(1,Math.round(viewport.height*scale));
  const content={x:(width-viewport.width*scale)/2,y:(height-viewport.height*scale)/2,w:viewport.width*scale,h:viewport.height*scale};
  let target={x:content.x+camera.x*scale,y:content.y+camera.y*scale,zoom:camera.zoom*scale};
  if(region==='scene'){
    const b=scene.bounds,pad=Math.min(24,width/8,height/8),zoom=Math.min((width-2*pad)/b.w,(height-2*pad)/b.h);
    target={x:width/2-(b.x+b.w/2)*zoom,y:height/2-(b.y+b.h/2)*zoom,zoom};
  }
  return {width,height,camera:target,clip:preset&&region==='viewport'?content:null};
}

export function gifTiming(duration=6,fps=10){
  if(![3,6,10].includes(duration)||![10,20].includes(fps))throw new Error('Неподдерживаемые параметры анимации.');
  return {frames:duration*fps,delay:100/fps,step:1/fps};
}

export function exportName(title,extension){
  const name=String(title||'factory').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,90)||'factory';
  return `fabririo-${name}.${extension}`;
}
