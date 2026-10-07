import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationSettings,claimInvitation,namedLink} from '../src/invitations.js';
import {publicEvent} from '../src/mini-api.js';
import {Bot} from '../src/bot.js';

function fixture(mode){
  const e={id:'0123456789abcdef',title:'Club dinner',owner:1,location:'Venue',description:'Dinner',questions:[],invitationMode:mode,guests:{},media:[],permissions:{},requireApproval:true};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const msg=(id,text)=>bot.handle({message:{chat:{id,type:'private'},from:{id,first_name:'Telegram name'},text}});
  const cb=(id,text)=>bot.handle({callback_query:{id:'q',from:{id,first_name:'Telegram name'},data:text}});
  return {e,data,calls,bot,msg,cb};
}

test('completed message buttons clear, notifications deliver, and old request versions cannot change newer responses',async()=>{
  const f=fixture('legacy');Object.assign(f.e,{askPhone:false,askComments:false});
  await f.msg(2,`/start e_${f.e.id}`);
  const press=(id,data,message_id)=>f.bot.handle({callback_query:{id:'q',from:{id,first_name:'Alex'},data,message:{chat:{id},message_id}}});
  await press(2,`r:${f.e.id}:yes:0`,10);
  await f.msg(2,'Alex');
  assert.ok(f.calls.some(c=>c.method==='editMessageReplyMarkup' && c.chat_id===2 && c.message_id===10 && c.reply_markup.inline_keyboard.length===0));
  assert.ok(f.calls.some(c=>c.chat_id===1 && c.reply_markup?.inline_keyboard.flat().some(b=>b.callback_data===`approve:${f.e.id}:2:1`)));
  await press(2,`r:${f.e.id}:maybe:1`,11);assert.equal(f.e.guests[2].status,'maybe');
  await press(2,`r:${f.e.id}:yes:2`,12);await f.msg(2,'Alex');assert.equal(f.e.guests[2].responseVersion,3);
  await press(1,`approve:${f.e.id}:2:1`,20);assert.equal(f.e.guests[2].approval,'pending');
  await press(1,`approve:${f.e.id}:2:3`,21);assert.equal(f.e.guests[2].approval,'approved');
  const ticket=f.e.guests[2].ticket;
  assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('organiser approved')));
  assert.ok(f.calls.some(c=>c.method==='editMessageReplyMarkup' && c.chat_id===1 && c.message_id===21));
  await press(2,`r:${f.e.id}:yes:3`,13);assert.equal(f.e.guests[2].ticket,ticket);assert.equal(f.e.guests[2].approval,'approved');
  await press(2,`r:${f.e.id}:no:1`,14);assert.equal(f.e.guests[2].status,'yes');
});

test('group-size buttons show 1–5 then 6–10, reject excess and expose roster only to the organiser',async()=>{
  const f=fixture('named');Object.assign(f.e,{askPhone:false,askComments:false,askParticipantCount:true},invitationSettings({invitationMode:'named',guestNames:'Alex = ?\nSam'},f.e));
  await f.msg(2,`/start i_${f.e.id}_${Object.keys(f.e.invitees)[0]}`);await f.cb(2,`r:${f.e.id}:yes`);
  const sizes=()=>f.calls.at(-1).reply_markup.inline_keyboard[0].map(b=>b.text);
  assert.deepEqual(sizes(),['1','2','3','4','5']);assert.ok(f.calls.at(-1).text.length<70);
  const countToken=f.data.sessions[2].countToken;
  await f.cb(2,`size:${f.e.id}:more:${countToken}`);assert.deepEqual(sizes(),['6','7','8','9','10']);
  await f.cb(2,`size:${f.e.id}:11:${countToken}`);assert.equal(f.data.sessions[2].step,'participants');
  await f.cb(2,`size:${f.e.id}:10:${countToken}`);assert.equal(f.e.guests[2].participants,10);assert.equal(f.data.sessions[2],undefined);
  await f.cb(2,`size:${f.e.id}:2:${countToken}`);assert.equal(f.e.guests[2].participants,10);
  const owner=publicEvent(f.e,1,'ExampleBot');assert.equal(owner.guestRoster.length,2);assert.equal(owner.guestRoster[0].participants,10);assert.equal(owner.guestRoster[1].status,'unopened');
  assert.equal(publicEvent(f.e,2,'ExampleBot').guestRoster,undefined);
  await f.msg(1,`/start manage_${f.e.id}`);assert.ok(f.calls.some(c=>c.chat_id===1 && c.text?.includes('Accepted: 1 responses · 10 people')));
  f.calls.length=0;await f.msg(2,`/start manage_${f.e.id}`);assert.ok(!f.calls.some(c=>c.text?.includes('Sam')));
});
test('personal invitation links preserve organiser names, bind on the first completed RSVP and skip the name prompt',async()=>{
  const f=fixture('named');Object.assign(f.e,{askPhone:true,askComments:true},invitationSettings({invitationMode:'named',guestNames:'Alex Smith\nSam Jones'},f.e));
  const token=Object.keys(f.e.invitees)[0],second=Object.keys(f.e.invitees)[1];
  assert.ok(namedLink(f.e,token,'ExampleBot').split('start=')[1].length<=64);
  await f.msg(2,`/start i_${f.e.id}_${token}`);assert.equal(f.e.guests[2].name,'Alex Smith');
  await f.msg(3,`/start i_${f.e.id}_${token}`);assert.equal(f.e.guests[3].status,'later');assert.equal(f.e.invitees[token].claimedBy,null);
  assert.throws(()=>claimInvitation(f.e,second,2));
  const projected=publicEvent(f.e,2,'ExampleBot');assert.equal(projected.guestName,'Alex Smith');assert.equal(projected.invitees,undefined);
  await f.cb(2,`r:${f.e.id}:yes`);assert.equal(f.data.sessions[2].step,'phone');
  await f.msg(2,'/skip');await f.msg(2,'/skip');assert.equal(f.e.guests[2].name,'Alex Smith');assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[2].approval,'approved');
  assert.equal(f.e.invitees[token].claimedBy,2);assert.equal(f.e.guests[3],undefined);
  await f.msg(3,`/start i_${f.e.id}_${token}`);assert.equal(f.e.guests[3],undefined);
  const before=f.e.invitees;const updated=invitationSettings({guestNames:'Alex Smith\nSam Jones\nNew Guest'},f.e);assert.equal(updated.invitees[token],before[token]);
  assert.throws(()=>invitationSettings({guestNames:'Sam Jones'},f.e));assert.throws(()=>invitationSettings({invitationMode:'tickets'},f.e));
  await f.msg(4,`/start e_${f.e.id}`);assert.equal(f.e.guests[4],undefined);
});
test('ticket mode offers booking only and collects name before approval',async()=>{
  const f=fixture('tickets');await f.msg(2,`/start e_${f.e.id}`);
  const card=f.calls.at(-1),buttons=card.reply_markup.inline_keyboard.flat().map(b=>b.callback_data).filter(Boolean);
  assert.ok(buttons.includes(`book:${f.e.id}`));assert.equal(buttons.some(b=>b.startsWith('r:') || b.startsWith('change:')),false);
  await f.cb(2,`r:${f.e.id}:maybe`);assert.equal(f.data.sessions[2],undefined);
  await f.cb(2,`book:${f.e.id}`);assert.equal(f.data.sessions[2].step,'name');
  await f.msg(2,'Ticket holder');await f.msg(2,'/skip');await f.msg(2,'/skip');
  assert.equal(f.e.guests[2].name,'Ticket holder');assert.equal(f.e.guests[2].approval,'pending');assert.equal(f.e.guests[2].ticket,undefined);
  await f.cb(1,`approve:${f.e.id}:2`);assert.ok(f.e.guests[2].ticket);
});
test('named guest lists validate names, visibility and expiry',()=>{
  for(const guestNames of ['', 'Alex\nAlex','X'.repeat(101)])assert.throws(()=>invitationSettings({invitationMode:'named',guestNames}));
  assert.throws(()=>invitationSettings({invitationMode:'named',guestNames:'Alex',isPublic:true}));
  const f=fixture('named');Object.assign(f.e,invitationSettings({guestNames:'Alex'},f.e));f.e.responseDeadline='2000-01-01';
  assert.throws(()=>claimInvitation(f.e,Object.keys(f.e.invitees)[0],2));
});
test('initial RSVP has only four choices and preserves the expiry in long banner captions',async()=>{
  const f=fixture('named');Object.assign(f.e,invitationSettings({guestNames:'Alex'},f.e));
  Object.assign(f.e,{permissions:{guestList:true,uploadMedia:true,viewMedia:true},startsAt:'2099-10-24T00:00:00Z',timezone:'Australia/Sydney',responseDeadline:'2099-10-20T08:00:00Z',banner:'photo',description:'Details '.repeat(300)});
  const token=Object.keys(f.e.invitees)[0];await f.msg(2,`/start i_${f.e.id}_${token}`);
  const card=f.calls.at(-1),buttons=card.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(b=>b.text),['✅ Accept','❌ Reject','🤔 Maybe','⏳ Respond later']);
  assert.match(card.caption,/Respond by:/);assert.match(card.caption,/2099/);assert.ok(card.caption.length<=1024);
  f.e.guests[2].status='yes';await f.bot.card(2,f.e);
  assert.ok(f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`g:${f.e.id}`));
  f.e.guests[2].status='maybe';await f.bot.card(2,f.e);
  assert.equal(f.calls.at(-1).reply_markup.inline_keyboard.flat().length,4);
});
test('new named invitations save accept, reject and maybe without phone or comment prompts by default',async()=>{
  for(const status of ['yes','no','maybe']){
    const f=fixture('named');Object.assign(f.e,invitationSettings({guestNames:'Alex'},f.e));
    await f.msg(2,`/start i_${f.e.id}_${Object.keys(f.e.invitees)[0]}`);await f.cb(2,`r:${f.e.id}:${status}`);
    assert.equal(f.e.guests[2].status,status);assert.equal(f.e.guests[2].name,'Alex');assert.equal(f.data.sessions[2],undefined);assert.equal(f.e.guests[2].phone,'');assert.equal(f.e.guests[2].comment,'');
  }
});
