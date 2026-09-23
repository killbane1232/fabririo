import {layoutGraph} from './graph.js';
import {layoutCatalog} from './explorer.js';
import {projectView} from './explorer.js';
import {moveBuilding,restoreLayout} from './factory-layout.js';
import {parseFactory,viewKey} from './factory-state.js';

function build(view,functions,focus){
  return view.mode==='catalog'?layoutCatalog(view):layoutGraph(view,functions,focus,{
    onProgress:message=>self.postMessage({phase:'optimization',message}),
  });
}

self.onmessage = ({data}) => {
  try {
    if(data.action==='move'){self.postMessage({scene:moveBuilding(data.scene,data.id,data.position)});return;}
    if(data.action==='import'){
      const factory=parseFactory(data.factory);let scene;
      for(const record of factory.layouts){const restored=restoreLayout(factory.graph,record);if(viewKey(record.view)===viewKey(factory.view))scene=restored;}
      scene??=build(projectView(factory.graph,factory.view),factory.graph.functions,factory.view.fn);
      self.postMessage({factory,scene});return;
    }
    self.postMessage({scene:data.record?restoreLayout(data.graph,data.record):build(data.view,data.functions,data.focus)});
  }
  catch (error) { self.postMessage({error: error.message}); }
};
