import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGuestMessages} from '../public/guest-messages.js';

function harness(){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.checked=false;this.value='';this.files=[];}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(){this.children=[];}
    querySelectorAll(selector){return this.children.flatMap(n=>[n,...n.children]).filter(n=>n.tag==='input' && (selector!=='input:checked' || n.checked));}
    showModal(){this.open=true;}close(){this.open=false;}
  }
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);},calls=[];
  let fail=false;
  const open=setupGuestMessages({$,document:{createElement:tag=>new Node(tag)},initData:'fictional',notice(){},api:async(path,input)=>{
    calls.push({path,input});if(fail)throw Error('Fictional retry error');
    return path.endsWith('/start')?{token:'test-draft',counts:{yes:2,no:1,maybe:0,later:1,unanswered:3}}:{token:'test-draft',count:2,undoUntil:Date.now()+300000};
  }});
  return {$,calls,open,setFailure(value){fail=value;}};
}
test('Mini App message groups default to accepted, support all and submit selected groups once',async()=>{
  const f=harness();await f.open({id:'example',title:'Fictional event'});
  assert.equal(f.$('guest-message-dialog').open,true);
  assert.deepEqual(f.$('guest-message-groups').querySelectorAll('input:checked').map(b=>b.value),['yes']);
  f.$('guest-message-all').checked=true;f.$('guest-message-all').onchange();
  assert.equal(f.$('guest-message-groups').querySelectorAll('input:checked').length,5);
  f.$('guest-message-text').value='Hello guests';
  await f.$('guest-message-form').onsubmit({preventDefault(){}});
  assert.equal(f.calls.at(-1).input.text,'Hello guests');assert.equal(f.calls.at(-1).input.groups.length,5);
  const n=f.calls.length;await f.$('guest-message-form').onsubmit({preventDefault(){}});assert.equal(f.calls.length,n);
  assert.equal(f.$('guest-message-undo').hidden,false);
  await f.$('guest-message-undo').onclick();assert.equal(f.calls.at(-1).path,'events/example/messages/undo');
  f.$('guest-message-close').onclick();assert.equal(f.$('guest-message-dialog').open,false);
});
test('Mini App displays send failures and keeps composer usable for retry',async()=>{
  const f=harness();await f.open({id:'example',title:'Fictional event'});f.setFailure(true);
  await f.$('guest-message-form').onsubmit({preventDefault(){}});
  assert.equal(f.$('guest-message-send').disabled,false);
  assert.match(f.$('guest-message-status').textContent,/retry error/);
  assert.equal(f.$('guest-message-compose').hidden,false);
});
