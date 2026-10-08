import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {broadcastRecipients,broadcastReceipt,broadcastHistory,broadcastDeliveryResult,undoBroadcast} from '../src/guest-messages.js';

function fixture(){
  const e={id:'0123456789abcdef',title:'Fictional gathering',owner:1,invitationMode:'legacy',guests:{2:{status:'yes',name:'A'},3:{status:'no',name:'B'},4:{status:'maybe',name:'C'},5:{status:'later',responseRecorded:true,name:'D'},6:{status:'later',name:'E'}},permissions:{guestList:true},media:[]};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return method==='copyMessage' || params.__broadcast ? {message_id:calls.length}:{};},'fictionalBot');
  const cb=(id,action)=>bot.handle({callback_query:{from:{id},data:action}});
  const msg=(id,text,extra={})=>bot.handle({message:{from:{id},chat:{id,type:'private'},message_id:99,text,...extra}});
  return {e,data,calls,bot,cb,msg};
}
test('empty message prompt keeps send and cancel controls available',async()=>{
  const f=fixture();await f.cb(1,`bm:${f.e.id}`);const token=f.data.sessions[1].token;
  await f.cb(1,`bm-send:${f.e.id}:${token}`);
  const prompt=f.calls.at(-1);assert.equal(prompt.text,'Add a message or attachment first.');
  assert.deepEqual(prompt.reply_markup.inline_keyboard[0].map(b=>b.callback_data),[`bm-send:${f.e.id}:${token}`,`bm-cancel:${f.e.id}:${token}`]);
  await f.msg(1,'Example message');await f.cb(1,prompt.reply_markup.inline_keyboard[0][0].callback_data);
  assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,1);
});

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

test('history counts complete deliveries instead of partial messages, preserves old history and records deletion results',async()=>{
  const f=fixture();
  f.data.preferences[1]={broadcasts:{old:{event:f.e.id,count:1,undoUntil:Date.now()-86400000*3,receipts:[]}}};
  await f.cb(1,`bm:${f.e.id}`);await f.msg(1,'Example announcement');const token=f.data.sessions[1].token;
  await f.cb(1,`bm-send:${f.e.id}:${token}`);
  let history=broadcastHistory(f.data,1,f.e.id);assert.equal(history.length,2);
  assert.equal(history[0].preview,'Example announcement');assert.equal(history[0].delivered,1);assert.equal(history[1].delivered,null);
  const record=f.data.preferences[1].broadcasts[token];record.count=3;record.receipts.push({key:'3:900',chatId:3,messageId:900});
  broadcastDeliveryResult(f.data,1,token,4,{ok:false,error_code:403});
  history=broadcastHistory(f.data,1,f.e.id);assert.equal(history[0].delivered,1);assert.equal(history[0].pending,1);assert.equal(history[0].failed,1);
  await undoBroadcast(f.bot,1,token,true);
  broadcastDeliveryResult(f.data,1,token,3,{ok:true},900);
  assert.equal(broadcastHistory(f.data,1,f.e.id)[0].deleted,1);
  assert.equal(broadcastHistory(f.data,2,f.e.id).length,0);
});

test('history deletion works after five-minute undo until Telegram deletion limit',async(t)=>{
  const f=fixture();t.mock.timers.enable({apis:['Date'],now:1000000});
  await f.cb(1,`bm:${f.e.id}`);await f.msg(1,'Example');const token=f.data.sessions[1].token;await f.cb(1,`bm-send:${f.e.id}:${token}`);
  t.mock.timers.tick(3600000);await f.cb(1,`bm-undo:${token}`);
  assert.equal(f.data.preferences[1].broadcasts[token].undone,false);
  assert.equal(broadcastHistory(f.data,1,f.e.id)[0].canDelete,true);
  await undoBroadcast(f.bot,1,token,true);assert.equal(f.data.preferences[1].broadcasts[token].undone,true);
  await f.cb(1,`bm:${f.e.id}`);await f.msg(1,'Another');const next=f.data.sessions[1].token;await f.cb(1,`bm-send:${f.e.id}:${next}`);
  t.mock.timers.tick(48*3600000);await undoBroadcast(f.bot,1,next,true);
  assert.equal(f.data.preferences[1].broadcasts[next].undone,false);
  assert.match(f.calls.at(-1).text,/48 hours/);
});
