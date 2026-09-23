import {drawFactoryFrame} from './world.js';
import {GIFEncoder,GIFPalette} from './gif-encoder.js';
import {factoryCSV,exportView,gifTiming} from './export-data.js';

self.onmessage=({data})=>{
  try{
    if(data.format==='csv'){
      const bytes=new TextEncoder().encode(factoryCSV(data.graph,data.scene,data.options));
      self.postMessage({done:true,bytes},[bytes.buffer]);return;
    }
    if(data.format!=='gif')throw new Error('Неизвестный формат экспорта.');
    if(typeof OffscreenCanvas==='undefined')throw new Error('Для экспорта GIF нужен браузер с OffscreenCanvas. CSV и JSON доступны.');
    const timing=gifTiming(data.options.duration,data.options.fps),view=exportView(data.scene,data.camera,data.viewport,data.options);
    const canvas=new OffscreenCanvas(view.width,view.height),c=canvas.getContext('2d',{willReadFrequently:true});
    const snapshot={scene:data.scene,...view,dpr:1,trace:data.trace?new Set(data.trace):null,selected:data.selected||''};
    const render=time=>{
      c.fillStyle='#17211b';c.fillRect(0,0,view.width,view.height);c.save();
      if(view.clip){const b=view.clip;c.beginPath();c.rect(b.x,b.y,b.w,b.h);c.clip();}
      drawFactoryFrame(c,{...snapshot,time});c.restore();return c.getImageData(0,0,view.width,view.height).data;
    };
    const colors=new GIFPalette(),start=data.time||0,speed=data.speed||1;
    for(let i=0;i<5;i++){colors.sample(render(start+data.options.duration*i/5*speed));self.postMessage({progress:(i+1)/5*.1,message:'Подбираем цвета…'});}
    const {palette,index}=colors.build({maxColors:255}),encoder=new GIFEncoder(view.width,view.height,palette,{delta:true});
    for(let i=0;i<timing.frames;i++){
      encoder.addFrame(index(render(start+i*timing.step*speed)),timing.delay);
      self.postMessage({progress:.1+(i+1)/timing.frames*.9,message:`Кадр ${i+1} из ${timing.frames}`});
    }
    const bytes=encoder.finish();self.postMessage({done:true,bytes},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message||'Не удалось сохранить фабрику.'});}
};
