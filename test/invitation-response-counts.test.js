import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {invitationSettings} from '../src/invitations.js';
import {participantCount,canSeeLocation} from '../src/permissions.js';
import {invoice,checkout,successful} from '../src/payments.js';
import {verifyTicket} from '../src/tickets.js';

function fixture(guestNames='Alex = 2',fields={}) {
  const e={id:'0123456789abcdef',owner:1,title:'Club dinner',when:'24 October 2099, 6pm Sydney',location:'Private club house',guests:{},permissions:{},media:[],askPhone:false,askComments:false,...fields,...invitationSettings({invitationMode:'named',guestNames})};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const msg=text=>bot.handle({message:{chat:{id:2,type:'private'},from:{id:2,first_name:'Telegram name'},text}});
  const cb=(action,actor=2)=>bot.handle({callback_query:{id:'q',from:{id:actor,first_name:'Telegram name'},data:action,message:{chat:{id:actor},message_id:10}}});
  const open=()=>msg(`/start i_${e.id}_${Object.keys(e.invitees)[0]}`);
  const accept=()=>cb(`r:${e.id}:yes:${e.guests[2]?.responseVersion || 0}`);
  const group=()=>cb(`group:${e.id}:edit:${e.guests[2]?.responseVersion || 0}`);
  const size=n=>cb(`size:${e.id}:${n}:${data.sessions[2]?.countToken}`);
  const confirm=action=>cb(`count-confirm:${e.id}:${action}:${data.sessions[2]?.countToken}`);
  return {e,data,calls,bot,msg,cb,open,accept,group,size,confirm};
}
const buttons=call=>call.reply_markup?.inline_keyboard?.flat() || [];

test('default attendee count appears on the invite and accepts without asking',async()=>{
  const f=fixture();await f.open();
  const invitation=f.calls.at(-1);
  assert.match(invitation.text,/Dear Alex,/);assert.match(invitation.text,/invited to Club dinner on/);assert.match(invitation.text,/reserved 2 places/);
  assert.match(invitation.text,/Private club house/);assert.ok(buttons(invitation).some(b=>b.text==='2 people · Change'));
  const bold=invitation.entities.find(entity=>entity.type==='bold');assert.equal(invitation.text.slice(bold.offset,bold.offset+bold.length),'2 places');
  await f.accept();assert.equal(f.e.guests[2].status,'yes');assert.equal(participantCount(f.e,f.e.guests[2]),2);assert.equal(f.data.sessions[2],undefined);
  assert.equal(f.calls.some(c=>/Confirm 2|How many people/.test(c.text || '')),false);
});

test('changing the default before acceptance preserves an unanswered invite and reopens with the chosen count',async()=>{
  const f=fixture();await f.open();await f.group();
  await f.size(3);assert.equal(f.e.guests[2].status,'later');assert.equal(f.e.guests[2].participants,3);
  assert.equal(f.calls.some(c=>c.chat_id===1 && c.text?.includes('People:')),false);
  await f.open();assert.match(f.calls.at(-1).text,/reserved 3 places/);assert.ok(buttons(f.calls.at(-1)).some(b=>b.text==='3 people · Change'));await f.accept();assert.equal(f.e.guests[2].participants,3);
  assert.ok(buttons(f.calls.at(-1)).some(b=>b.text==='3 people · Change'));
});

test('question mark explicitly asks for 1–10 even when the event group option is off',async()=>{
  const f=fixture('Alex = ?', {askParticipantCount:false});await f.open();await f.accept();
  assert.equal(f.data.sessions[2].step,'participants');assert.equal(f.e.guests[2].status,'later');
  assert.deepEqual(buttons(f.calls.at(-1)).slice(0,5).map(b=>b.text),['1','2','3','4','5']);
  await f.size(11);assert.equal(f.e.guests[2].status,'later');await f.msg('0');assert.equal(f.data.sessions[2].step,'participants');
  await f.size(10);assert.equal(f.e.guests[2].participants,10);assert.equal(f.e.guests[2].status,'yes');
});

test('exclamation mark requires confirmation and allows choosing another count',async()=>{
  for(const change of [false,true]){
    const f=fixture('Alex = 2!');await f.open();await f.accept();
    assert.equal(f.data.sessions[2].step,'participantConfirm');assert.equal(f.e.guests[2].status,'later');assert.match(f.calls.at(-1).text,/Confirm 2 people/);
    assert.ok(buttons(f.calls.at(-1)).some(b=>b.text==='2 people · Change'));
    if(change){await f.confirm('change');assert.equal(f.data.sessions[2].step,'participants');await f.size(4);}
    else await f.confirm('yes');
    assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[2].participants,change?4:2);assert.equal(f.data.sessions[2],undefined);
  }
});

test('cancelling a confirmation or count choice leaves the saved response unchanged',async()=>{
  const f=fixture('Alex = 2!');await f.open();await f.accept();const token=f.data.sessions[2].countToken;
  await f.cb(`v:${f.e.id}`);await f.cb(`count-confirm:${f.e.id}:yes:${token}`);assert.equal(f.e.guests[2].status,'later');
  await f.accept();await f.confirm('change');await f.cb(`v:${f.e.id}`);assert.equal(f.e.guests[2].participants,2);assert.equal(f.e.guests[2].status,'later');
});

test('stale count controls do not affect a new picker session or a newer response',async()=>{
  const f=fixture();await f.open();await f.group();const old=f.data.sessions[2].countToken;
  await f.cb(`v:${f.e.id}`);await f.group();assert.notEqual(f.data.sessions[2].countToken,old);
  await f.cb(`size:${f.e.id}:5:${old}`);assert.equal(f.e.guests[2].participants,2);
  await f.size(3);await f.cb(`group:${f.e.id}:edit:0`);assert.equal(f.data.sessions[2],undefined);assert.equal(f.e.guests[2].participants,3);
});

test('changing a named group count updates its confirmed ticket without approval and invalidates the old ticket',async()=>{
  const f=fixture('Alex = 2',{requireApproval:true});await f.open();await f.accept();
  await f.cb(`approve:${f.e.id}:2:1`,1);const oldTicket=f.e.guests[2].ticket;
  assert.ok(oldTicket);await f.group();await f.size(4);
  assert.equal(f.e.guests[2].approval,'approved');assert.ok(f.e.guests[2].ticket);assert.notEqual(f.e.guests[2].ticket,oldTicket);assert.equal(canSeeLocation(f.e,2),true);
  assert.equal(verifyTicket(f.e,1,oldTicket).valid,false);
  await f.cb(`approve:${f.e.id}:2:1`,1);assert.equal(f.e.guests[2].approval,'approved');
  await f.cb(`approve:${f.e.id}:2:2`,1);assert.equal(f.e.guests[2].approval,'approved');assert.equal(f.e.guests[2].participants,4);
});

test('paid, processing, reported, checked-in and expired invitations cannot change group size',async()=>{
  for(const lock of ['reported','paid','processing','refund_pending','refund_failed','checkin','deadline']){
    const f=fixture();await f.open();await f.accept();const g=f.e.guests[2],ticket=g.ticket;
    if(lock==='checkin')verifyTicket(f.e,1,ticket,true);
    else if(lock==='deadline')f.e.responseDeadline='2000-01-01T00:00:00Z';
    else g.payment={status:lock};
    await f.group();await f.cb(`size:${f.e.id}:8:forged`);
    assert.equal(g.participants,2,lock);assert.equal(g.ticket,ticket,lock);assert.equal(f.data.sessions[2],undefined,lock);
    assert.equal(buttons(f.calls.at(-1)).some(b=>b.callback_data?.startsWith('group:')),false,lock);
  }
});

test('fixed personal counts accept directly and reject forged changes before and after RSVP',async()=>{
  const f=fixture('Alex = 2*');await f.open();
  assert.match(f.calls.at(-1).text,/reserved 2 places for you\. This count is fixed\./);
  assert.equal(buttons(f.calls.at(-1)).some(b=>b.callback_data?.startsWith('group:')),false);
  await f.group();assert.equal(f.data.sessions[2],undefined);assert.equal(f.e.guests[2].participants,2);
  await f.accept();assert.equal(f.e.guests[2].status,'yes');assert.equal(f.data.sessions[2],undefined);
  assert.equal(f.calls.some(call=>/How many people|Confirm 2/.test(call.text || '')),false);
  const ticket=f.e.guests[2].ticket,version=f.e.guests[2].responseVersion;
  assert.equal(buttons(f.calls.at(-1)).some(b=>b.callback_data?.startsWith('group:')),false);
  await f.group();assert.equal(f.data.sessions[2],undefined);
  f.data.sessions[2]={event:f.e.id,step:'participants',response:{...f.e.guests[2]},countOnly:true,countToken:'forged',baseVersion:version};
  await f.size(9);assert.equal(f.e.guests[2].participants,2);assert.equal(f.e.guests[2].ticket,ticket);
  f.data.sessions[2]={event:f.e.id,step:'participantConfirm',response:{...f.e.guests[2]},countToken:'forged',baseVersion:version};
  await f.confirm('change');assert.equal(f.e.guests[2].participants,2);assert.equal(f.e.guests[2].responseVersion,version);
  assert.equal(f.e.guests[2].ticket,ticket);
});

test('count buttons use singular for one person',async()=>{
  const f=fixture('Alex = 1');await f.open();assert.ok(buttons(f.calls.at(-1)).some(b=>b.text==='1 person · Change'));
});

test('banner invitation bolds the count while keeping its address copyable with Unicode names',async()=>{
  const f=fixture('🎉 Alex = 2*',{banner:'fake-banner',title:'🏏 Club dinner',description:'Come along!'});await f.open();
  const call=f.calls.at(-1);assert.equal(call.method,'sendPhoto');
  const bold=call.caption_entities.find(entity=>entity.type==='bold'),address=call.caption_entities.find(entity=>entity.type==='code');
  assert.equal(call.caption.slice(bold.offset,bold.offset+bold.length),'2 places');
  assert.equal(call.caption.slice(address.offset,address.offset+address.length),'Private club house');
  assert.equal(call.parse_mode,undefined);
});

test('truncated banner captions never include out-of-range count entities',async()=>{
  const f=fixture('Alex = 2*',{banner:'fake-banner',description:'x'.repeat(1100),responseDeadline:'2099-10-23T00:00:00Z'});await f.open();
  const initial=f.bot.namedInvitationContent(f.e,f.e.guests[2],2).entities[0].offset;
  f.e.title+='x'.repeat(950-initial);await f.bot.card(2,f.e);
  const call=f.calls.at(-1);assert.equal(call.method,'sendPhoto');assert.equal(call.caption_entities?.some(entity=>entity.type==='bold') || false,false);
  assert.match(call.caption,/Tap Full details/);assert.ok((call.caption_entities || []).every(entity=>entity.offset+entity.length<=940));
});

test('unpaid Stars invoices expire when group size changes and late payment is refunded',async()=>{
  const f=fixture('Alex = 2',{starPrice:10,starPricing:'person',paymentTerms:'Refund on cancellation.'});await f.open();await f.accept();
  await invoice(f.bot,2,f.e,true);const bill=f.calls.find(c=>c.method==='sendInvoice');assert.equal(bill.prices[0].amount,20);
  await f.group();await f.size(3);
  assert.equal(checkout(f.bot,{id:'checkout',from:{id:2},currency:'XTR',total_amount:20,invoice_payload:bill.payload}).ok,false);
  await invoice(f.bot,2,f.e,true);assert.equal(f.calls.filter(c=>c.method==='sendInvoice').at(-1).prices[0].amount,30);
  await successful(f.bot,{from:{id:2},successful_payment:{currency:'XTR',total_amount:20,invoice_payload:bill.payload,telegram_payment_charge_id:'old-count-charge'}});
  assert.ok(f.calls.some(c=>c.method==='refundStarPayment' && c.telegram_payment_charge_id==='old-count-charge'));assert.equal(f.e.guests[2].participants,3);
});

test('private locations stay hidden in named invitation messages and owner share links',async()=>{
  for(const fields of [{hideLocation:true},{requireApproval:true},{starPrice:10,starPricing:'person'}]){
    const f=fixture('Alex = 2',fields);await f.open();
    assert.doesNotMatch(f.calls.at(-1).text,/Private club house/);assert.match(f.calls.at(-1).text,/Location will be available/);
    await f.bot.personalLinks(1,f.e);
    const guest=buttons(f.calls.at(-1)).find(b=>b.text==='Alex'),token=Object.keys(f.e.invitees)[0];
    assert.equal(guest.callback_data,`invite-copy:${f.e.id}:${token}`);
    await f.cb(guest.callback_data,1);
    assert.doesNotMatch(f.calls.at(-1).text,/Private club house/);
    const share=buttons(f.calls.at(-1)).find(b=>b.url);
    assert.doesNotMatch(new URL(share.url).searchParams.get('text'),/Private club house/);
  }
});
