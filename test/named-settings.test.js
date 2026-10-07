import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {invitationSettings,claimInvitation} from '../src/invitations.js';
import {requiresApproval,asksParticipantCount,participantCount,confirmed,canSeeLocation,responseCounts} from '../src/permissions.js';
import {publicEvent} from '../src/mini-api.js';
import {adminOverview} from '../src/admin.js';
import {issueTicket} from '../src/tickets.js';
import {invoice,checkout,successful} from '../src/payments.js';
import {manualInstructions,manualReport,manualConfirm} from '../src/manual-payment.js';

function fixture(guestNames='Alex',fields={}) {
  const e={id:'0123456789abcdef',owner:1,title:'Club evening',when:'24 October 2099, 6pm Sydney',startsAt:'2099-10-24T08:00:00Z',location:'Private venue',description:'Meet the team',guests:{},media:[],questions:[],permissions:{},askPhone:false,askComments:false,requireApproval:true,askParticipantCount:true,...fields,...invitationSettings({invitationMode:'named',guestNames})};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const token=Object.keys(e.invitees)[0];
  const msg=(id,text)=>bot.handle({message:{chat:{id,type:'private'},from:{id,first_name:'Telegram guest'},text}});
  const cb=(id,value)=>bot.handle({callback_query:{id:'q',from:{id,first_name:'Telegram guest'},data:value}});
  return {e,data,calls,bot,token,msg,cb};
}

test('named lists ignore stored general approval and group settings while other modes retain those options',()=>{
  const fields={requireApproval:true,askParticipantCount:true};
  for(const invitationMode of ['legacy','tickets',undefined]){
    assert.equal(requiresApproval({...fields,invitationMode}),true);assert.equal(asksParticipantCount({...fields,invitationMode}),true);
  }
  const f=fixture(),g=claimInvitation(f.e,f.token,2);g.participants=5;
  assert.equal(requiresApproval(f.e),false);assert.equal(asksParticipantCount(f.e),false);assert.equal(participantCount(f.e,g),1);
});

test('legacy approval privacy remains until named acceptance, then confirmation and ticket no longer need approval',()=>{
  const f=fixture(),g=claimInvitation(f.e,f.token,2);g.approval='pending';
  assert.equal(canSeeLocation(f.e,2),false);
  const initial=publicEvent(f.e,2,'ExampleBot');assert.equal(initial.location,null);assert.equal(initial.hideLocation,true);assert.equal(initial.requireApproval,false);assert.equal(initial.askParticipantCount,false);
  g.status='yes';assert.equal(confirmed(f.e,g),true);assert.equal(canSeeLocation(f.e,2),true);
  assert.equal(responseCounts(f.e).yes,1);assert.equal(responseCounts(f.e).pending,0);
  const ticket=issueTicket(f.e,2);assert.ok(ticket.code);assert.equal(ticket.participants,1);
  const accepted=publicEvent(f.e,2,'ExampleBot');assert.equal(accepted.location,'Private venue');assert.equal(accepted.approval,'approved');assert.equal(accepted.ticket.code,ticket.code);
  const owner=publicEvent(f.e,1,'ExampleBot');assert.equal(owner.guestRoster[0].approval,'approved');
  const admin=adminOverview([{kind:'events',id:f.e.id,data:JSON.stringify(f.e)}]).events[0];assert.equal(admin.requireApproval,false);assert.equal(admin.askParticipantCount,false);assert.equal(admin.hideLocation,true);assert.equal(admin.guests[0].approval,'approved');
});

test('a bare named guest accepts immediately as one attendee despite old global group and approval flags',async()=>{
  const f=fixture();await f.msg(2,`/start i_${f.e.id}_${f.token}`);await f.cb(2,`r:${f.e.id}:yes:0`);
  assert.equal(f.data.sessions[2],undefined);assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[2].approval,'approved');assert.equal(f.e.guests[2].participants,1);
  assert.ok(f.e.guests[2].ticket);assert.equal(canSeeLocation(f.e,2),true);
  assert.equal(f.calls.some(c=>c.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data?.startsWith('approve:') || b.callback_data?.startsWith('size:'))),false);
  assert.equal(f.calls.some(c=>/Awaiting organiser approval|How many people/.test(c.text || '')),false);
});

test('named guest options hide general approval and group buttons and stale toggles cannot re-enable them',async()=>{
  const f=fixture(),buttons=f.bot.permissionKeyboard(f.e,`toggle:${f.e.id}`).flat();
  assert.equal(buttons.some(b=>b.callback_data.endsWith(':requireApproval') || b.callback_data.endsWith(':askParticipantCount')),false);
  await f.cb(1,`toggle:${f.e.id}:requireApproval`);await f.cb(1,`toggle:${f.e.id}:askParticipantCount`);
  assert.equal(f.e.requireApproval,false);assert.equal(f.e.askParticipantCount,false);assert.equal(f.e.hideLocation,true);
});

test('named Stars payment proceeds without legacy approval while the private location stays behind payment',async()=>{
  const f=fixture('Alex = 2',{starPrice:10,starPricing:'person',paymentTerms:'Refund on cancellation.'}),g=claimInvitation(f.e,f.token,2);
  Object.assign(g,{status:'yes',approval:'pending'});assert.equal(canSeeLocation(f.e,2),false);assert.equal(responseCounts(f.e).pending,0);assert.equal(responseCounts(f.e).awaitingPayment,1);
  await invoice(f.bot,2,f.e,true);const bill=f.calls.find(c=>c.method==='sendInvoice');assert.ok(bill);assert.equal(bill.prices[0].amount,20);
  assert.equal(checkout(f.bot,{id:'checkout',from:{id:2},currency:'XTR',total_amount:20,invoice_payload:bill.payload}).ok,true);
  await successful(f.bot,{from:{id:2},successful_payment:{currency:'XTR',total_amount:20,invoice_payload:bill.payload,telegram_payment_charge_id:'named-payment'}});
  assert.equal(confirmed(f.e,g),true);assert.equal(canSeeLocation(f.e,2),true);assert.equal(responseCounts(f.e).participants,2);assert.ok(g.ticket);
});

test('named manual payments can be reported and verified without a legacy approval step',async()=>{
  const f=fixture('Alex = 2',{paymentMethod:'bank',displayPrice:'AUD 20',paymentInstructions:'Bank transfer reference',paymentTerms:'Refund on cancellation.'}),g=claimInvitation(f.e,f.token,2);
  Object.assign(g,{status:'yes',approval:'pending'});assert.equal(canSeeLocation(f.e,2),false);
  await manualInstructions(f.bot,2,f.e);assert.ok(f.calls.at(-1).text.includes('Bank transfer reference'));
  await manualReport(f.bot,2,f.e);assert.equal(g.payment.status,'reported');assert.equal(confirmed(f.e,g),false);
  await manualConfirm(f.bot,1,f.e,2);assert.equal(g.payment.status,'paid');assert.equal(confirmed(f.e,g),true);assert.equal(canSeeLocation(f.e,2),true);assert.ok(g.ticket);
});
