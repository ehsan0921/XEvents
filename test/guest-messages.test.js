import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {broadcastRecipients,broadcastReceipt} from '../src/guest-messages.js';

function fixture(){
  const e={id:'0123456789abcdef',title:'Fictional gathering',owner:1,invitationMode:'legacy',guests:{2:{status:'yes',name:'A'},3:{status:'no',name:'B'},4:{status:'maybe',name:'C'},5:{status:'later',responseRecorded:true,name:'D'},6:{status:'later',name:'E'}},permissions:{guestList:true},media:[]};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return method==='copyMessage' || params.__broadcast ? {message_id:calls.length}:{};},'fictionalBot');
  const cb=(id,action)=>bot.handle({callback_query:{from:{id},data:action}});
  const msg=(id,text,extra={})=>bot.handle({message:{from:{id},chat:{id,type:'private'},message_id:99,text,...extra}});
  return {e,data,calls,bot,cb,msg};
}
test('messaging defaults to accepted and isolates each response group including unanswered',async()=>{
  const f=fixture();
  for(const [group,id] of [['yes',2],['no',3],['maybe',4],['later',5],['unanswered',6]])assert.deepEqual(broadcastRecipients(f.e,[group]),[id]);
  await f.cb(1,`bm:${f.e.id}`);
  assert.deepEqual(f.data.sessions[1].groups,['yes']);
  await f.msg(1,'Example message');
  assert.equal(f.calls.some(c=>c.method==='copyMessage'),false);
  const token=f.data.sessions[1].token;
  await f.cb(1,`bm-send:${f.e.id}:${token}`);
  assert.deepEqual(f.calls.filter(c=>c.method==='copyMessage').map(c=>c.chat_id),[2]);
  const n=f.calls.length;await f.cb(1,`bm-send:${f.e.id}:${token}`);
  assert.equal(f.calls.slice(n).some(c=>c.method==='copyMessage'),false);
  await f.cb(1,`bm-undo:${token}`);
  assert.equal(f.calls.filter(c=>c.method==='deleteMessage').length,2);
  const before=f.calls.length;await f.cb(1,`bm-undo:${token}`);
  assert.equal(f.calls.slice(before).some(c=>c.method==='deleteMessage'),false);
});
test('creator-only controls reject guests and co-hosts; cancelling a draft sends nothing',async()=>{
  const f=fixture();f.e.cohost={id:3};
  for(const id of [2,3]){await f.cb(id,`bm:${f.e.id}`);assert.equal(f.data.sessions[id],undefined);}
  await f.cb(1,`bm:${f.e.id}`);await f.cb(1,`bm-group:${f.e.id}:all:${f.data.sessions[1].token}`);
  assert.deepEqual(new Set(f.data.sessions[1].groups),new Set(['yes','no','maybe','later','unanswered']));
  await f.msg(1,undefined,{photo:[{file_id:'fictional-photo'}]});
  await f.cb(1,`bm-cancel:${f.e.id}:${f.data.sessions[1].token}`);
  assert.equal(f.data.sessions[1],undefined);assert.equal(f.calls.some(c=>c.method==='copyMessage'),false);
});
test('undo is owner-scoped, expires after five minutes, and deletes deliveries racing with undo',async(t)=>{
  const f=fixture();t.mock.timers.enable({apis:['Date'],now:1000000});
  await f.cb(1,`bm:${f.e.id}`);await f.msg(1,'Test');const token=f.data.sessions[1].token;
  await f.cb(1,`bm-send:${f.e.id}:${token}`);
  await f.cb(2,`bm-undo:${token}`);assert.equal(f.data.preferences[1].broadcasts[token].undone,false);
  await f.cb(1,`bm-undo:${token}`);
  await broadcastReceipt(f.bot,1,token,2,12345);
  assert.equal(f.calls.at(-1).method,'deleteMessage');assert.equal(f.calls.at(-1).message_id,12345);
  await f.cb(1,`bm:${f.e.id}`);await f.msg(1,'Another');const next=f.data.sessions[1].token;
  await f.cb(1,`bm-send:${f.e.id}:${next}`);t.mock.timers.tick(300001);
  await f.cb(1,`bm-undo:${next}`);assert.match(f.calls.at(-1).text,/window has ended/);
  assert.equal(f.data.preferences[1].broadcasts[next].undone,false);
});
