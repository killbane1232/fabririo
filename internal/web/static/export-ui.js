import {exportName} from './export-data.js';

export function downloadFile(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();return url;
}

export function installExport({getSnapshot,toast}){
  const $=id=>document.getElementById(id),dialog=$('export-dialog'),form=$('export-form');
  let worker=null,snapshot=null,downloadURL=null;
  const clearResult=()=>{
    if(downloadURL){const old=downloadURL;setTimeout(()=>URL.revokeObjectURL(old),60000);downloadURL=null;}
    $('export-ready').hidden=true;$('export-preview').removeAttribute('src');$('export-download').removeAttribute('href');
  };
  const ready=(blob,name,format)=>{
    clearResult();downloadURL=downloadFile(blob,name);$('export-download').href=downloadURL;$('export-download').download=name;
    $('export-download').textContent='Скачать '+format.toUpperCase();$('export-ready-label').textContent=`${name} · ${(blob.size/1024/1024).toFixed(2)} МиБ`;
    $('export-preview').hidden=format!=='gif';if(format==='gif')$('export-preview').src=downloadURL;
    $('export-ready').hidden=false;toast(format.toUpperCase()+' готов');
  };
  const busy=value=>{
    $('export-options').disabled=value;$('export-start').disabled=value;$('export-cancel').hidden=!value;
    $('export-progress-wrap').hidden=!value;
  };
  const cancel=()=>{if(!worker)return;worker.terminate();worker=null;busy(false);$('export-message').textContent='Экспорт отменён';};
  const formatChanged=()=>{
    const format=$('export-format').value;
    $('gif-options').hidden=format!=='gif';$('csv-options').hidden=format!=='csv';$('json-note').hidden=format!=='json';
    $('export-error').hidden=true;$('export-start').textContent='Скачать '+format.toUpperCase();
  };
  $('export-format').onchange=formatChanged;
  $('export-cancel').onclick=()=>{cancel();toast('Экспорт отменён');};
  dialog.addEventListener('close',()=>{cancel();clearResult();snapshot=null;});
  $('export-btn').onclick=()=>{
    snapshot=getSnapshot();if(!snapshot)return;
    $('export-context').textContent=snapshot.title+` · ${snapshot.scene.nodes.length} объектов · ${snapshot.scene.edges.length} маршрутов`;
    $('export-message').textContent='';$('export-error').hidden=true;busy(false);formatChanged();dialog.showModal();
  };
  form.onsubmit=event=>{
    event.preventDefault();if(worker||!snapshot)return;
    const format=$('export-format').value,options={scope:$('csv-scope').value,delimiter:$('csv-delimiter').value,
      region:$('gif-region').value,size:$('gif-size').value,duration:Number($('gif-duration').value),fps:Number($('gif-fps').value)};
    const filename=exportName(format==='json'||format==='csv'&&options.scope==='project'?snapshot.project:snapshot.title,format);
    const fail=message=>{worker?.terminate();worker=null;busy(false);$('export-error').textContent=message;$('export-error').hidden=false;};
    try{
      if(format==='json'){ready(new Blob([JSON.stringify(snapshot.factory,null,2)],{type:'application/json'}),filename,format);return;}
      clearResult();busy(true);$('export-error').hidden=true;$('export-progress').value=0;$('export-message').textContent=format==='gif'?'Подготовка анимации…':'Собираем CSV…';
      worker=new Worker(new URL('./export-worker.js',import.meta.url),{type:'module'});
      const active=worker;
      worker.onerror=event=>{if(worker===active)fail(event.message||'Ошибка экспорта. Попробуйте меньший размер.');};
      worker.onmessage=({data})=>{
        if(worker!==active)return;
        if(data.error){fail(data.error);return;}
        if(!data.done){$('export-progress').value=data.progress||0;$('export-message').textContent=data.message;return;}
        worker.terminate();worker=null;busy(false);
        try{ready(new Blob([data.bytes],{type:format==='gif'?'image/gif':'text/csv;charset=utf-8'}),filename,format);}
        catch(error){fail(error.message);}
      };
      // Structured cloning creates an immutable export snapshot. Do not send the
      // entire project to the GIF worker when only one section is being drawn.
      worker.postMessage(format==='csv'?{format,options,scene:snapshot.scene,graph:snapshot.graph}:{format,options,scene:snapshot.scene,
        camera:snapshot.camera,viewport:snapshot.viewport,time:snapshot.time,speed:snapshot.speed,selected:snapshot.selected,trace:snapshot.trace});
    }catch(error){fail(error.message);}
  };
}
