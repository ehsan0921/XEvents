import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {cohostLink,cohostEntries,createCohostInvite,isManager} from '../src/cohosts.js';
import {invitationSettings} from '../src/invitations.js';
import {setReminder,sendDueReminders} from '../src/reminders.js';

function fixture(fields={}){
  const e={id:'0123456789abcdef',owner:1,title:'Club evening',location:'Private venue',when:'24 October 2099, 6pm Sydney',description:'A club meetup',guests:{3:{name:'Guest',status:'yes',approval:'pending',participants:1,responseVersion:1,phone:'',comment:''}},media:[],permissions:{},requireApproval:true,...fields};
  e.invitationMode=fields.invitationMode || 'named';
  if(e.invitationMode==='named')Object.assign(e,invitationSettings({guestNames:'Alex = 2'},e));
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot','https://example.test/app');
  const user=id=>({id,first_name:id===2?'Co':'User',last_name:id===2?'Host':String(id),username:id===2?'club_cohost':undefined});
  const msg=(id,text,extra={})=>bot.handle({message:{chat:{id,type:'private'},from:user(id),text,...extra}});
  const cb=(id,value)=>bot.handle({callback_query:{id:'q',from:user(id),data:value,message:{chat:{id},message_id:10}}});
  const create=async(label='Team helpers')=>{await cb(1,`co-create:${e.id}`);await msg(1,label);return e.cohostInvite.token;};
  const claim=(token,id=2)=>msg(id,`/start c_${e.id}_${token}`);
  return {e,data,calls,bot,msg,cb,create,claim};
}
const buttons=call=>call.reply_markup?.inline_keyboard?.flat() || [];

test('owner creates a one-use co-host invite and claim announces the verified name and handle',async()=>{
  const f=fixture(),token=await f.create();assert.ok(cohostLink(f.e,'ExampleBot'));
  await f.claim(token);assert.equal(f.e.cohost.id,2);assert.equal(f.e.cohost.name,'Co Host');assert.equal(f.e.cohost.username,'club_cohost');assert.equal(f.e.cohostInvite,null);
  assert.equal(f.e.guests[2],undefined);assert.ok(f.calls.some(c=>c.chat_id===1 && /Co Host · @club_cohost · ID 2\nis now co-host/.test(c.text || '') && /Link: Team helpers/.test(c.text)));
  const card=f.calls.at(-1);assert.match(card.text,/You’re the co-host/);assert.match(card.text,/Private venue/);
  assert.ok(buttons(card).some(b=>b.callback_data===`h:${f.e.id}`));assert.equal(buttons(card).some(b=>b.callback_data?.startsWith('r:') || b.callback_data?.startsWith('book:') || b.callback_data?.startsWith('delete:')),false);
  await f.msg(4,`/start c_${f.e.id}_${token}`);assert.equal(isManager(f.e,4),false);assert.equal(f.e.cohost.id,2);
  await f.msg(2,'/events');assert.ok(f.calls.some(c=>c.chat_id===2 && buttons(c).some(b=>b.callback_data===`v:${f.e.id}`)));
});

test('co-host can edit details, manage guests, approve requests, and upload media with guest options off',async()=>{
  const f=fixture({invitationMode:'tickets'}),token=await f.create();await f.claim(token);
  await f.cb(2,`edit:${f.e.id}:title`);await f.msg(2,'Updated evening');assert.equal(f.e.title,'Updated evening');
  await f.cb(2,`banner:${f.e.id}`);await f.msg(2,undefined,{photo:[{file_id:'new-banner'}]});assert.equal(f.e.banner,'new-banner');
  await f.cb(2,`a:${f.e.id}`);assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('Guest') && c.text.includes('Awaiting approval')));
  await f.cb(2,`approve:${f.e.id}:3:1`);assert.equal(f.e.guests[3].approval,'approved');assert.ok(f.e.guests[3].ticket);
  await f.cb(2,`u:${f.e.id}`);await f.msg(2,undefined,{photo:[{file_id:'cohost-photo'}]});assert.equal(f.e.media[0].fileId,'cohost-photo');
  await f.msg(2,'/done');assert.equal(f.data.sessions[2],undefined);
});

test('guest response notifications reach all hosts and obsolete approval buttons cannot approve twice',async()=>{
  const f=fixture({invitationMode:'tickets'}),token=await f.create();await f.claim(token);
  await f.claim(await f.create('Second helper'),5);
  await f.msg(4,`/start e_${f.e.id}`);await f.cb(4,`book:${f.e.id}`);await f.msg(4,'Alex');
  for(const uid of [1,2,5])assert.ok(f.calls.some(c=>c.chat_id===uid && c.text?.includes('Alex:') && buttons(c).some(b=>b.callback_data===`approve:${f.e.id}:4:1`)));
  await f.cb(2,`approve:${f.e.id}:4:1`);const ticket=f.e.guests[4].ticket;await f.cb(1,`approve:${f.e.id}:4:1`);assert.equal(f.e.guests[4].ticket,ticket);
});

test('co-host cannot manage other co-hosts, rotate guest links, cancel/delete events or confirm payments',async()=>{
  const f=fixture({paymentMethod:'bank',displayPrice:'$20'}),token=await f.create();await f.claim(token);
  f.e.guests[3].payment={status:'reported'};
  for(const action of ['cohost','co-entry','co-create','co-remove','co-revoke','rotate','x','z','delete','delete-confirm','manual-confirm','manual-clear'])await f.cb(2,`${action}:${f.e.id}:3`);
  assert.equal(f.e.cancelled,undefined);assert.equal(f.data.events[f.e.id],f.e);assert.equal(f.e.guests[3].payment.status,'reported');assert.equal(f.e.cohost.id,2);assert.equal(f.e.cohostInvite,null);
  await f.cb(2,`h:${f.e.id}`);assert.equal(buttons(f.calls.at(-1)).some(b=>/Co-hosts$|Cancel event|Delete event|Replace invite link/.test(b.text)),false);
});

test('revocation immediately invalidates old controls and in-progress edit sessions and permits a new co-host',async()=>{
  const f=fixture(),token=await f.create();await f.claim(token);await f.cb(2,`edit:${f.e.id}:title`);
  await f.cb(1,`co-remove:${f.e.id}:${cohostEntries(f.e)[0].id}`);const revoke=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  assert.ok(new TextEncoder().encode(revoke).length<=64);await f.cb(1,revoke);
  assert.equal(isManager(f.e,2),false);assert.equal(f.data.sessions[2],undefined);assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.includes('revoked')));
  await f.msg(2,'Changed after revoke');await f.cb(2,`approve:${f.e.id}:3:1`);await f.cb(2,`u:${f.e.id}`);
  assert.equal(f.e.title,'Club evening');assert.equal(f.e.guests[3].approval,'pending');assert.equal(f.data.sessions[2],undefined);
  const next=await f.create();await f.msg(4,`/start c_${f.e.id}_${next}`);assert.equal(f.e.cohost.id,4);
  await f.cb(1,revoke);assert.equal(f.e.cohost.id,4);
});

test('a stale cancel-link confirmation cannot revoke the person who claimed it meanwhile',async()=>{
  const f=fixture(),token=await f.create();await f.cb(1,`co-remove:${f.e.id}:${cohostEntries(f.e)[0].id}`);
  const cancel=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  await f.claim(token);await f.cb(1,cancel);assert.equal(f.e.cohost.id,2);
});

test('several labelled links coexist and cancelling one leaves the others usable',async()=>{
  const f=fixture(),first=await f.create('Registration'),second=await f.create('Photography');
  const firstEntry=cohostEntries(f.e).find(entry=>entry.token===first);
  await f.cb(1,`co-remove:${f.e.id}:${firstEntry.id}`);const confirm=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  const third=await f.create('Equipment');await f.cb(1,confirm);
  await f.claim(first);assert.equal(isManager(f.e,2),false);
  await f.claim(second);await f.claim(third,4);assert.equal(isManager(f.e,2),true);assert.equal(isManager(f.e,4),true);
  await f.cb(1,`cohost:${f.e.id}`);const card=f.calls.at(-1);
  assert.match(card.text,/Registration · revoked/);assert.match(card.text,/Photography · active/);assert.match(card.text,/@club_cohost · ID 2/);assert.match(card.text,/No Telegram username · ID 4/);
});

test('revoking one of multiple co-hosts preserves other access and sessions',async()=>{
  const f=fixture(),first=await f.create();await f.claim(first);await f.claim(await f.create('Second'),4);
  await f.cb(2,`edit:${f.e.id}:title`);await f.cb(4,`edit:${f.e.id}:description`);
  await f.cb(1,`co-remove:${f.e.id}:${cohostEntries(f.e)[0].id}`);await f.cb(1,buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data);
  assert.equal(f.data.sessions[2],undefined);assert.equal(f.data.sessions[4].step,'edit');assert.equal(isManager(f.e,4),true);
  await f.msg(4,'Still a co-host');assert.equal(f.e.description,'Still a co-host');
});

test('old untargeted remove and replacement buttons cannot revoke or replace any link',async()=>{
  const f=fixture(),first=await f.create();await f.claim(first);await f.create('Other');const before=JSON.stringify(cohostEntries(f.e));
  for(const value of [`co-remove:${f.e.id}`,`co-new:${f.e.id}:oldtoken`,`co-revoke:${f.e.id}:2:123456`])await f.cb(1,value);
  assert.equal(JSON.stringify(cohostEntries(f.e)),before);
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
  await f.cb(1,`co-remove:${f.e.id}:${cohostEntries(f.e)[0].id}`);const revoke=buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data;
  await f.cb(1,revoke);assert.equal(f.e.cohost,null);
});

test('co-host personal reminders work despite a preserved declined guest RSVP',async()=>{
  const now=Date.parse('2099-10-24T00:00:00Z'),f=fixture({startsAt:'2099-10-24T01:00:00Z'});
  f.e.guests[2]={name:'Co Host',status:'no'};const token=await f.create();await f.claim(token);
  setReminder(f.e,2,15,now);await sendDueReminders(f.data,f.bot,now+46*60000);
  assert.equal(f.e.guests[2].status,'no');assert.ok(f.calls.some(c=>c.chat_id===2 && c.text?.startsWith('🔔 Reminder:')));
});

test('every active co-host receives edits and cancellation once, without duplicate guest notifications',async()=>{
  const f=fixture();await f.claim(await f.create());await f.claim(await f.create('Second'),4);
  f.e.guests[2]={name:'Co Host',status:'yes'};
  await f.cb(1,`edit:${f.e.id}:title`);f.calls.length=0;await f.msg(1,'New title');
  for(const uid of [2,4])assert.equal(f.calls.filter(c=>c.chat_id===uid && c.text?.includes('updated title')).length,1);
  f.calls.length=0;await f.bot.endEvent(1,f.e);
  for(const uid of [2,4])assert.equal(f.calls.filter(c=>c.chat_id===uid && c.text?.includes('has been cancelled')).length,1);
});

test('legacy co-host access survives creation and targeted revocation of another link',async()=>{
  const f=fixture({cohost:{id:2,name:'Existing helper',username:'old_helper',joinedAt:'2026-01-01T00:00:00Z'}});
  assert.equal(isManager(f.e,2),true);const next=await f.create('New shift');
  await f.claim(next,4);assert.equal(isManager(f.e,2),true);assert.equal(isManager(f.e,4),true);
  const entry=cohostEntries(f.e).find(item=>item.cohost?.id===4);
  await f.cb(1,`co-remove:${f.e.id}:${entry.id}`);await f.cb(1,buttons(f.calls.at(-1)).find(b=>b.callback_data?.startsWith('co-revoke:')).callback_data);
  assert.equal(isManager(f.e,2),true);assert.equal(isManager(f.e,4),false);
});

test('Manage offers a paginated named invitation list to every host and blocks guests',async()=>{
  const f=fixture();Object.assign(f.e,invitationSettings({guestNames:Array.from({length:12},(_,i)=>`Guest ${i+1}`).join('\n')},f.e));
  await f.claim(await f.create());
  for(const uid of [1,2]){
    await f.cb(uid,`h:${f.e.id}`);assert.ok(buttons(f.calls.at(-1)).some(b=>b.callback_data===`invite-links:${f.e.id}:0`));
    await f.cb(uid,`invite-links:${f.e.id}:1`);const page=f.calls.at(-1);assert.match(page.text,/Page 2 of 2/);
    assert.ok(buttons(page).some(b=>b.text==='Guest 11'));assert.equal(buttons(page).some(b=>b.text==='Guest 1'),false);
  }
  await f.cb(3,`invite-links:${f.e.id}:0`);assert.match(f.calls.at(-1).text,/Only event hosts|valid invitation/);
  f.bot.appUrl=null;const token=Object.keys(f.e.invitees)[10];
  await f.cb(1,`invite-copy:${f.e.id}:${token}`);assert.match(f.calls.at(-1).text,/Dear Guest 11,/);assert.ok(f.calls.at(-1).text.includes(`start=i_${f.e.id}_${token}`));
  await f.cb(3,`invite-copy:${f.e.id}:${token}`);assert.match(f.calls.at(-1).text,/Only event hosts|valid invitation/);
});

test('co-host list paginates independent entries and all callbacks fit Telegram limits',async()=>{
  const f=fixture();for(let i=0;i<12;i++)createCohostInvite(f.e,1,`Shift ${i+1}`);
  await f.cb(1,`cohost:${f.e.id}:1`);assert.match(f.calls.at(-1).text,/Page 2 of 2/);
  assert.ok(buttons(f.calls.at(-1)).some(b=>b.text.includes('Shift 11')));assert.equal(buttons(f.calls.at(-1)).some(b=>b.text==='🔗 Shift 1'),false);
  const entry=cohostEntries(f.e)[11];await f.cb(1,`co-entry:${f.e.id}:${entry.id}`);await f.cb(1,`co-remove:${f.e.id}:${entry.id}`);
  for(const c of f.calls)for(const b of buttons(c))if(b.callback_data)assert.ok(Buffer.byteLength(b.callback_data)<=64,b.callback_data);
});
