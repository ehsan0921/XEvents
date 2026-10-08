import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGuestMessages} from '../public/guest-messages.js';

function harness(){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.checked=false;this.value='';this.files=[];}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(){this.children=[];}
    querySelectorAll(selector){return this.children.flatMap(n=>[n,...n.children]).filter(n=>n.tag==='input' && (selector!=='input:checked' || n.checked));}
    setAttribute(){}remove(){this.removed=true;}
    showModal(){this.open=true;}close(){this.open=false;}
  }
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);},calls=[];
  let fail=false,messages=[];
  const open=setupGuestMessages({$,document:{createElement:tag=>new Node(tag)},initData:'fictional',notice(){},schedule(){return 1;},cancel(){},api:async(path,input)=>{
    calls.push({path,input});if(fail)throw Error('Fictional retry error');
    if(path.endsWith('/history'))return {messages};
    if(path.endsWith('/send'))messages=[{token:'test-draft',createdAt:Date.now(),preview:input.text,attachments:[],count:2,delivered:1,pending:1,failed:0,canDelete:true}];
    if(path.endsWith('/delete'))messages=messages.map(m=>({...m,undone:true,canDelete:false,deletePending:1}));
    return path.endsWith('/start')?{token:'test-draft',counts:{yes:2,no:1,maybe:0,later:1,unanswered:3}}:{token:'test-draft',count:2,undoUntil:Date.now()+300000};
  }});
  return {$,calls,open,setFailure(value){fail=value;},all(node){return [node,...node.children.flatMap(n=>this.all(n))];}};
}
test('Mini App message groups default to accepted, support all and submit selected groups once',async()=>{
  const f=harness();await f.open({id:'example',title:'Fictional event'});
  assert.equal(f.$('guest-message-dialog').open,true);
  assert.equal(f.$('guest-message-form').hidden,true);await f.$('guest-message-new').onclick();
  assert.deepEqual(f.$('guest-message-groups').querySelectorAll('input:checked').map(b=>b.value),['yes']);
  f.$('guest-message-all').checked=true;f.$('guest-message-all').onchange();
  assert.equal(f.$('guest-message-groups').querySelectorAll('input:checked').length,5);
  f.$('guest-message-text').value='Hello guests';
  await f.$('guest-message-form').onsubmit({preventDefault(){}});
  const send=f.calls.find(c=>c.path.endsWith('/send'));assert.equal(send.input.text,'Hello guests');assert.equal(send.input.groups.length,5);
  const n=f.calls.length;await f.$('guest-message-form').onsubmit({preventDefault(){}});assert.equal(f.calls.length,n);
  const history=f.all(f.$('guest-message-history'));
  assert.ok(history.some(node=>node.textContent==='Hello guests'));
  assert.ok(history.some(node=>node.textContent==='Delivered: 1/2 · Pending: 1 · Failed: 0'));
  await history.find(node=>node.textContent==='🗑 Delete from guest chats').onclick();
  await f.all(f.$('guest-message-history')).find(node=>node.textContent==='Confirm delete').onclick();
  assert.ok(f.calls.some(c=>c.path==='events/example/messages/delete'));
  f.$('guest-message-close').onclick();assert.equal(f.$('guest-message-dialog').open,false);
});
test('Mini App displays send failures and keeps composer usable for retry',async()=>{
  const f=harness();await f.open({id:'example',title:'Fictional event'});await f.$('guest-message-new').onclick();f.setFailure(true);
  await f.$('guest-message-form').onsubmit({preventDefault(){}});
  assert.equal(f.$('guest-message-send').disabled,false);
  assert.match(f.$('guest-message-status').textContent,/retry error/);
  assert.equal(f.$('guest-message-compose').hidden,false);
});
