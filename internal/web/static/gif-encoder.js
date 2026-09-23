// GIF89a container + 8-bit LZW. Format reference:
// https://www.w3.org/Graphics/GIF/spec-gif89a.txt
// Frames are encoded incrementally; raw animation frames are never retained.
class Bytes {
  constructor(){this.parts=[];this.block=new Uint8Array(65536);this.used=0;this.length=0;}
  byte(value){if(this.used===this.block.length){this.parts.push(this.block);this.block=new Uint8Array(65536);this.used=0;}this.block[this.used++]=value;this.length++;}
  word(value){this.byte(value);this.byte(value>>8);}
  write(bytes){for(const byte of bytes)this.byte(byte);}
  text(text){for(const char of text)this.byte(char.charCodeAt(0));}
  finish(){const out=new Uint8Array(this.length);let offset=0;for(const part of this.parts){out.set(part,offset);offset+=part.length;}out.set(this.block.subarray(0,this.used),offset);return out;}
}

export function lzwEncode(pixels){
  if(!pixels.length)throw new Error('Пустой кадр GIF.');
  const out=new Bytes();let bits=9,next=258,buffer=0,bufferBits=0,dict=new Map();
  const emit=code=>{
    buffer|=code<<bufferBits;bufferBits+=bits;
    while(bufferBits>=8){out.byte(buffer&255);buffer>>>=8;bufferBits-=8;}
    // Encoder is one dictionary entry ahead of decoder: increase the width
    // after emitting the code that lets the decoder reach this boundary.
    if(next===(1<<bits)&&bits<12)bits++;
  };
  emit(256);let prefix=pixels[0];
  for(let i=1;i<pixels.length;i++){
    const symbol=pixels[i],key=prefix*256+symbol,found=dict.get(key);
    if(found!==undefined){prefix=found;continue;}
    emit(prefix);
    if(next<4096)dict.set(key,next++);
    else{emit(256);dict=new Map();bits=9;next=258;}
    prefix=symbol;
  }
  emit(prefix);emit(257);if(bufferBits)out.byte(buffer&255);
  return out.finish();
}

export class GIFEncoder {
  constructor(width,height,palette,{delta=false}={}){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>3840||height>3840||width*height>3840*2160||palette.length!==768)throw new Error('Некорректный размер или палитра GIF.');
    this.width=width;this.height=height;this.frames=0;this.closed=false;this.out=new Bytes();this.delta=delta;this.previous=null;
    const w=this.out;w.text('GIF89a');w.word(width);w.word(height);w.write([0xf7,0,0]);w.write(palette);
    w.write([0x21,0xff,11]);w.text('NETSCAPE2.0');w.write([3,1,0,0,0]);
  }
  addFrame(pixels,delay){
    if(this.closed||pixels.length!==this.width*this.height||!Number.isInteger(delay)||delay<1||delay>65535)throw new Error('Некорректный кадр GIF.');
    if(this.frames>=200)throw new Error('Слишком много кадров GIF.');
    if(this.delta&&pixels.includes(255))throw new Error('Индекс 255 зарезервирован для прозрачности GIF.');
    const frame=this.delta&&this.previous?deltaFrame(pixels,this.previous,this.width,this.height):{pixels,x:0,y:0,width:this.width,height:this.height,transparent:false};
    const compressed=lzwEncode(frame.pixels),w=this.out;
    if(w.length+compressed.length+Math.ceil(compressed.length/255)+20>64*1024*1024)throw new Error('GIF превышает 64 МиБ. Уменьшите размер или длительность.');
    // Disposal 1 retains the previous frame; unchanged pixels are transparent.
    w.write([0x21,0xf9,4,frame.transparent?5:4]);w.word(delay);w.write([frame.transparent?255:0,0]);
    w.byte(0x2c);w.word(frame.x);w.word(frame.y);w.word(frame.width);w.word(frame.height);w.write([0,8]);
    for(let offset=0;offset<compressed.length;offset+=255){const part=compressed.subarray(offset,offset+255);w.byte(part.length);w.write(part);}
    w.byte(0);this.frames++;if(this.delta)this.previous=pixels.slice();
  }
  finish(){if(this.closed||!this.frames)throw new Error('Нет кадров для GIF.');this.closed=true;this.out.byte(0x3b);return this.out.finish();}
}

function deltaFrame(pixels,previous,width,height){
  let left=width,top=height,right=-1,bottom=-1;
  for(let i=0;i<pixels.length;i++)if(pixels[i]!==previous[i]){
    const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  // Even an unchanged frame must retain its delay (e.g. a stopped train).
  if(right<0)return {pixels:new Uint8Array([255]),x:0,y:0,width:1,height:1,transparent:true};
  const w=right-left+1,h=bottom-top+1,patch=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(top+y)*width+left+x;patch[y*w+x]=pixels[i]===previous[i]?255:pixels[i];
  }
  return {pixels:patch,x:left,y:top,width:w,height:h,transparent:true};
}

const bin=(r,g,b)=>((r>>3)<<10)|((g>>3)<<5)|(b>>3);

// A global palette sampled across the animation keeps type colors stable.
export class GIFPalette {
  constructor(){this.counts=new Uint32Array(32768);this.red=new Float64Array(32768);this.green=new Float64Array(32768);this.blue=new Float64Array(32768);}
  sample(rgba){
    for(let i=0;i<rgba.length;i+=4){const key=bin(rgba[i],rgba[i+1],rgba[i+2]);this.counts[key]++;this.red[key]+=rgba[i];this.green[key]+=rgba[i+1];this.blue[key]+=rgba[i+2];}
  }
  build({maxColors=256}={}){
    if(!Number.isInteger(maxColors)||maxColors<2||maxColors>256)throw new Error('Некорректный размер палитры GIF.');
    const colors=[];
    for(let i=0;i<32768;i++)if(this.counts[i]){const n=this.counts[i];colors.push({rgb:[this.red[i]/n,this.green[i]/n,this.blue[i]/n],weight:Math.sqrt(n)});}
    if(!colors.length)throw new Error('Нет цветов для GIF.');
    const box=items=>{
      const ranges=[0,1,2].map(channel=>{let min=255,max=0;for(const c of items){min=Math.min(min,c.rgb[channel]);max=Math.max(max,c.rgb[channel]);}return max-min;});
      const axis=ranges.indexOf(Math.max(...ranges)),weight=items.reduce((n,c)=>n+c.weight,0);
      return {items,axis,weight,score:items.length>1?ranges[axis]*Math.sqrt(weight):0};
    };
    const boxes=[box(colors)];
    while(boxes.length<maxColors){
      let best=0;for(let i=1;i<boxes.length;i++)if(boxes[i].score>boxes[best].score)best=i;
      const current=boxes[best];if(!current.score)break;
      current.items.sort((a,b)=>a.rgb[current.axis]-b.rgb[current.axis]);let weight=0,cut=0;
      do{weight+=current.items[cut++].weight;}while(weight<current.weight/2&&cut<current.items.length-1);
      boxes.splice(best,1,box(current.items.slice(0,cut)),box(current.items.slice(cut)));
    }
    const palette=new Uint8Array(768);
    boxes.forEach((b,i)=>{for(let channel=0;channel<3;channel++)palette[i*3+channel]=Math.round(b.items.reduce((sum,c)=>sum+c.rgb[channel]*c.weight,0)/b.weight);});
    const lookup=new Uint8Array(32768);
    for(let key=0;key<32768;key++){
      const r=(key>>10)*8+4,g=((key>>5)&31)*8+4,b=(key&31)*8+4;let best=0,distance=Infinity;
      for(let i=0;i<boxes.length;i++){const d=(r-palette[i*3])**2+(g-palette[i*3+1])**2+(b-palette[i*3+2])**2;if(d<distance){distance=d;best=i;}}
      lookup[key]=best;
    }
    return {palette,index:rgba=>{const out=new Uint8Array(rgba.length/4);for(let i=0;i<out.length;i++)out[i]=lookup[bin(rgba[i*4],rgba[i*4+1],rgba[i*4+2])];return out;}};
  }
}
