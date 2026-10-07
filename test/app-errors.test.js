import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function errorsHarness({ready=true,clipboardWorks=true}={}) {
  const listeners={},nodes={},domListeners={};let copied='';
  const window={addEventListener:(name,fn)=>listeners[name]=fn};
  const document={getElementById:id=>nodes[id],addEventListener:(name,fn)=>domListeners[name]=fn};
  const mount=()=>{for(const id of ['app-error','app-error-message','app-error-dismiss','app-error-copy'])nodes[id]={hidden:true,textContent:''};};
  if(ready)mount();
  vm.runInNewContext(readFileSync(new URL('../public/errors.js',import.meta.url),'utf8'),{window,document,navigator:{clipboard:{writeText:async text=>{if(!clipboardWorks)throw new Error('Unavailable');copied=text;}}}});
  return {window,listeners,nodes,domListeners,mount,get copied(){return copied;},get text(){return nodes['app-error-message'].textContent;}};
}

test('startup errors wait for the page, stay visible and can be copied without exposing addresses',async()=>{
  const harness=errorsHarness({ready:false}),{listeners,nodes,domListeners}=harness;
  listeners.error({message:'Failed at https://private.example/app.js:12'});
  harness.mount();
  domListeners.DOMContentLoaded();
  assert.equal(nodes['app-error'].hidden,false);assert.match(nodes['app-error-message'].textContent,/App error/);assert.doesNotMatch(nodes['app-error-message'].textContent,/private\.example/);
  await nodes['app-error-copy'].onclick();assert.equal(harness.copied,nodes['app-error-message'].textContent);
  nodes['app-error-dismiss'].onclick();assert.equal(nodes['app-error'].hidden,true);
  listeners.unhandledrejection({reason:new Error('HTTP 503: Please retry · Reference abc')});
  assert.equal(nodes['app-error'].hidden,false);assert.match(nodes['app-error-message'].textContent,/Reference abc/);
  listeners.error({target:{tagName:'SCRIPT'}});assert.match(nodes['app-error-message'].textContent,/script could not load/);
});

test('runtime errors retain the underlying message and only a public asset name with line and column',()=>{
  const harness=errorsHarness();
  const error=new Error('Native bridge unavailable');
  error.stack='Error: Native bridge unavailable\n at https://private.example/secret-path/telegram-web-app.js?token=fixture-secret#initData=fixture-session:137:7';
  harness.listeners.error({message:'Script error.',error,filename:'https://private.example/secret-path/telegram-web-app.js?token=fixture-secret#initData=fixture-session',lineno:137,colno:7});
  assert.equal(harness.text,'App error: Native bridge unavailable\nSource: telegram-web-app.js:137:7');
  assert.equal(harness.nodes['app-error'].hidden,false);
  assert.doesNotMatch(harness.text,/private\.example|secret-path|fixture-secret|fixture-session| at /);
});

test('masked cross-origin errors remain visible with an actionable explanation',async()=>{
  const harness=errorsHarness();
  harness.listeners.error({message:'Script error.',filename:'',lineno:0,colno:0,error:null});
  assert.match(harness.text,/Telegram or browser script failed/);
  assert.match(harness.text,/browser hid the details/);
  assert.match(harness.text,/Close and reopen/);
  assert.match(harness.text,/copy this message/);
  assert.equal(harness.nodes['app-error'].hidden,false);
  await harness.nodes['app-error-copy'].onclick();
  assert.equal(harness.copied,harness.text);
});

test('failed SDK and unknown script resources reveal no addresses or private filenames',()=>{
  const harness=errorsHarness();
  harness.listeners.error({target:{tagName:'SCRIPT',src:'https://telegram.org/js/telegram-web-app.js?token=fixture-secret#initData=fixture-session'}});
  assert.match(harness.text,/required script could not load \(telegram-web-app\.js\)/);
  assert.doesNotMatch(harness.text,/telegram\.org|fixture-secret|fixture-session/);
  harness.listeners.error({target:{tagName:'SCRIPT',src:'https://private.example/private-event-identifier.js?token=fixture-secret'}});
  assert.match(harness.text,/required script could not load \(script\)/);
  assert.doesNotMatch(harness.text,/private|fixture-secret/);
});

test('runtime locations hide private paths and invalid positions without losing the error',()=>{
  const harness=errorsHarness();
  harness.listeners.error({message:'Unexpected value',filename:'https://private.example/private-event-identifier.js?hash=fixture-hash',lineno:-1,colno:Infinity});
  assert.equal(harness.text,'App error: Unexpected value\nSource: script');
  harness.listeners.error({message:'Unexpected value',filename:'/app.js?hash=fixture-hash',lineno:32,colno:0});
  assert.equal(harness.text,'App error: Unexpected value\nSource: app.js:32');
});

test('reported and rejected objects use useful messages while retaining credential redaction',()=>{
  const harness=errorsHarness();
  const token='1234567890:'+'A'.repeat(35);
  harness.listeners.unhandledrejection({reason:{message:`Load failed at https://private.example/app?secret=x ${token} Authorization: Bearer fixture-auth initData=fixture-session hash: "fixture-hash" "token":"fixture-token"`}});
  assert.match(harness.text,/App error: Load failed/);
  assert.match(harness.text,/\[hidden address\]/);
  assert.match(harness.text,/\[hidden credential\]/);
  assert.doesNotMatch(harness.text,/private\.example|1234567890|fixture-|\[object Object\]/);
  harness.listeners.unhandledrejection({reason:{error:'HTTP 503: Try again · Reference fictional-reference'}});
  assert.match(harness.text,/HTTP 503.*Reference fictional-reference/);
  harness.listeners.unhandledrejection({reason:{details:{private:'not-for-output'}}});
  assert.match(harness.text,/unexpected app error occurred/);
  assert.doesNotMatch(harness.text,/\[object Object\]|not-for-output/);
  harness.window.reportAppError(new Error('Regular app error'),'Loading planner');
  assert.equal(harness.text,'Loading planner: Regular app error');
});

test('clipboard failure keeps the diagnostic visible and selectable',async()=>{
  const harness=errorsHarness({clipboardWorks:false});
  harness.listeners.error({message:'Example failure'});
  await harness.nodes['app-error-copy'].onclick();
  assert.equal(harness.nodes['app-error-copy'].textContent,'Select the message to copy');
  assert.equal(harness.nodes['app-error'].hidden,false);
  assert.equal(harness.text,'App error: Example failure');
});
