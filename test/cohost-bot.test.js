import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {cohostLink,isManager} from '../src/cohosts.js';
import {invitationSettings} from '../src/invitations.js';
import {setReminder,sendDueReminders} from '../src/reminders.js';

function fixture(fields={}){
  const e={id:'0123456789abcdef',owner:1,title:'Club evening',location:'Private venue',when:'24 October 2099, 6pm Sydney',description:'A club meetup',guests:{3:{name:'Guest',status:'yes',approval:'pending',participants:1,responseVersion:1,phone:'',comment:''}},media:[],permissions:{},requireApproval:true,...fields};
  e.invitationMode='named';Object.assign(e,invitationSettings({guestNames:'Alex = 2'},e));
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot','https://example.test/app');
  const user=id=>({id,first_name:id===2?'Co':'User',last_name:id===2?'Host':String(id),username:id===2?'club_cohost':undefined});
  const msg=(id,text,extra={})=>bot.handle({message:{chat:{id,type:'private'},from:user(id),text,...extra}});
  const cb=(id,value)=>bot.handle({callback_query:{id:'q',from:user(id),data:value,message:{chat:{id},message_id:10}}});
  const create=async()=>{await cb(1,`co-create:${e.id}`);return e.cohostInvite.token;};
  const claim=token=>msg(2,`/start c_${e.id}_${token}`);
  return {e,data,calls,bot,msg,cb,create,claim};
}
const buttons=call=>call.reply_markup?.inline_keyboard?.flat() || [];

test('owner creates a one-use co-host invite and claim announces the verified name and handle',async()=>{
  const f=fixture(),token=await f.create();assert.ok(cohostLink(f.e,'ExampleBot'));
  await f.claim(token);assert.equal(f.e.cohost.id,2);assert.equal(f.e.cohost.name,'Co Host');assert.equal(f.e.cohost.username,'club_cohost');assert.equal(f.e.cohostInvite,null);
  assert.equal(f.e.guests[2],undefined);assert.ok(f.calls.some(c=>c.chat_id===1 && /Co Host · @club_cohost is now co-host/.test(c.text || '')));
  const card=f.calls.at(-1);assert.match(card.text,/You’re the co-host/);assert.match(card.text,/Private venue/);
  assert.ok(buttons(card).some(b=>b.callback_data===`h:${f.e.id}`));assert.equal(buttons(card).some(b=>b.callback_data?.startsWith('r:') || b.callback_data?.startsWith('book:') || b.callback_data?.startsWith('delete:')),false);
  await f.msg(4,`/start c_${f.e.id}_${token}`);assert.equal(isManager(f.e,4),false);assert.equal(f.e.cohost.id,2);
  await f.msg(2,'/events');assert.ok(f.calls.some(c=>c.chat_id===2 && buttons(c).some(b=>b.callback_data===`v:${f.e.id}`)));
});

test('co-host can edit details, manage guests, approve requests, and upload media with guest options off',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);
  await f.cb(2,`edit:${f.e.id}:title`);await f.msg(2,'Updated evening');assert.equal(f.e.title,'Updated evening');
  await f.cb(2,`banner:${f.e.id}`);await f.msg(2,undefined,{photo:[{file_id:'new-banner'}]});assert.equal(f.e.banner,'new-banner');
  await f.cb(2,`a:${f.e.id}`);assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('Guest') && c.text.includes('Awaiting approval')));
  await f.cb(2,`approve:${f.e.id}:3:1`);assert.equal(f.e.guests[3].approval,'approved');assert.ok(f.e.guests[3].ticket);
  await f.cb(2,`u:${f.e.id}`);await f.msg(2,undefined,{photo:[{file_id:'cohost-photo'}]});assert.equal(f.e.media[0].fileId,'cohost-photo');
  await f.msg(2,'/done');await f.bot.personalLinks(2,f.e);assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('Dear Alex,')));
});

test('guest response notifications reach both hosts and obsolete approval buttons cannot approve twice',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);const personal=Object.keys(f.e.invitees)[0];
  await f.msg(4,`/start i_${f.e.id}_${personal}`);await f.cb(4,`r:${f.e.id}:yes:0`);
  for(const uid of [1,2])assert.ok(f.calls.some(c=>c.chat_id===uid && c.text?.includes('Alex:') && buttons(c).some(b=>b.callback_data===`approve:${f.e.id}:4:1`)));
  await f.cb(2,`approve:${f.e.id}:4:1`);const ticket=f.e.guests[4].ticket;await f.cb(1,`approve:${f.e.id}:4:1`);assert.equal(f.e.guests[4].ticket,ticket);
});

test('co-host cannot manage other co-hosts, rotate guest links, cancel/delete events or confirm payments',async()=>{
  const f=fixture({paymentMethod:'bank',displayPrice:'$20'}),token=await f.create();await f.claim(token);
  f.e.guests[3].payment={status:'reported'};
  for(const action of ['cohost','co-create','co-remove','co-revoke','rotate','x','z','delete','delete-confirm','manual-confirm','manual-clear'])await f.cb(2,`${action}:${f.e.id}:3`);
  assert.equal(f.e.cancelled,undefined);assert.equal(f.data.events[f.e.id],f.e);assert.equal(f.e.guests[3].payment.status,'reported');assert.equal(f.e.cohost.id,2);assert.equal(f.e.cohostInvite,null);
  await f.cb(2,`h:${f.e.id}`);assert.equal(buttons(f.calls.at(-1)).some(b=>/Co-host$|Cancel event|Delete event|Replace invite link/.test(b.text)),false);
});

test('revocation immediately invalidates old controls and in-progress edit sessions and permits a new co-host',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);await f.cb(2,`edit:${f.e.id}:title`);
  await f.cb(1,`co-remove:${f.e.id}`);const revoke=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  assert.ok(new TextEncoder().encode(revoke).length<=64);await f.cb(1,revoke);
  assert.equal(isManager(f.e,2),false);assert.equal(f.data.sessions[2],undefined);assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('revoked')));
  await f.msg(2,'Changed after revoke');await f.cb(2,`approve:${f.e.id}:3:1`);await f.cb(2,`u:${f.e.id}`);
  assert.equal(f.e.title,'Club evening');assert.equal(f.e.guests[3].approval,'pending');assert.equal(f.data.sessions[2],undefined);
  const next=await f.create();await f.msg(4,`/start c_${f.e.id}_${next}`);assert.equal(f.e.cohost.id,4);
  await f.cb(1,revoke);assert.equal(f.e.cohost.id,4);
});

test('a stale cancel-link confirmation cannot revoke the person who claimed it meanwhile',async()=>{
  const f=fixture(),token=await f.create();await f.cb(1,`co-remove:${f.e.id}`);
  const cancel=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  await f.claim(token);await f.cb(1,cancel);assert.equal(f.e.cohost.id,2);
});

test('replacing or cancelling an unused co-host invite invalidates old links',async()=>{
  const f=fixture(),token=await f.create();await f.cb(1,`co-create:${f.e.id}`);
  const replace=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-new:')).callback_data;await f.cb(1,replace);assert.notEqual(f.e.cohostInvite.token,token);
  await f.claim(token);assert.equal(f.e.cohost,undefined);
  const replacement=f.e.cohostInvite.token;await f.cb(1,`co-remove:${f.e.id}`);await f.cb(1,buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data);
  await f.claim(replacement);assert.equal(f.e.cohost,null);assert.equal(f.e.cohostInvite,null);
});

test('active co-hosts do not consume personal guest invitations or acquire new RSVP records',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);const personal=Object.keys(f.e.invitees)[0];
  await f.msg(2,`/start i_${f.e.id}_${personal}`);await f.msg(2,`/start e_${f.e.id}`);await f.cb(2,`r:${f.e.id}:yes`);
  assert.equal(f.e.invitees[personal].claimedBy,null);assert.equal(f.e.guests[2],undefined);assert.equal(f.data.sessions[2],undefined);
});

test('named guest lists stay private for both owner and co-host management controls',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);
  for(const actor of [1,2]){await f.cb(actor,`toggle:${f.e.id}:isPublic`);assert.notEqual(f.e.isPublic,true);assert.match(f.calls.at(-1).text,/must stay private/);}
});

test('owner can revoke a co-host after event cancellation through existing chat controls',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);f.e.cancelled=true;
  await f.cb(1,`cohost:${f.e.id}`);assert.match(f.calls.at(-1).text,/Co Host · @club_cohost/);
  await f.cb(1,`co-remove:${f.e.id}`);const revoke=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  await f.cb(1,revoke);assert.equal(f.e.cohost,null);
});

test('co-host personal reminders work despite a preserved declined guest RSVP',async()=>{
  const now=Date.parse('2099-10-24T00:00:00Z'),f=fixture({startsAt:'2099-10-24T01:00:00Z'});
  f.e.guests[2]={name:'Co Host',status:'no'};const token=await f.create();await f.claim(token);
  setReminder(f.e,2,15,now);await sendDueReminders(f.data,f.bot,now+46*60000);
  assert.equal(f.e.guests[2].status,'no');assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.startsWith('🔔 Reminder:')));
});
