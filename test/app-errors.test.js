import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('startup errors wait for the page, stay visible and can be copied without exposing addresses',async()=>{
  const listeners={},nodes={},domListeners={};let copied='';
  const window={addEventListener:(name,fn)=>listeners[name]=fn};
  const document={getElementById:id=>nodes[id],addEventListener:(name,fn)=>domListeners[name]=fn};
  vm.runInNewContext(readFileSync(new URL('../public/errors.js',import.meta.url),'utf8'),{window,document,navigator:{clipboard:{writeText:async text=>{copied=text;}}}});
  listeners.error({message:'Failed at https://private.example/app.js:12'});
  for(const id of ['app-error','app-error-message','app-error-dismiss','app-error-copy'])nodes[id]={hidden:true,textContent:''};
  domListeners.DOMContentLoaded();
  assert.equal(nodes['app-error'].hidden,false);assert.match(nodes['app-error-message'].textContent,/App error/);assert.doesNotMatch(nodes['app-error-message'].textContent,/private\.example/);
  await nodes['app-error-copy'].onclick();assert.equal(copied,nodes['app-error-message'].textContent);
  nodes['app-error-dismiss'].onclick();assert.equal(nodes['app-error'].hidden,true);
  listeners.unhandledrejection({reason:new Error('HTTP 503: Please retry · Reference abc')});
  assert.equal(nodes['app-error'].hidden,false);assert.match(nodes['app-error-message'].textContent,/Reference abc/);
  listeners.error({target:{tagName:'SCRIPT'}});assert.match(nodes['app-error-message'].textContent,/script could not load/);
});
