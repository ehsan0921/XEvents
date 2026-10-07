import test from 'node:test';
import assert from 'node:assert/strict';
import {addInvitations,removeInvitation,invitationsVersion,managedInvitations} from '../src/invitation-management.js';
import {invitationSettings,claimInvitation,invitationAvailable} from '../src/invitations.js';
import {publicEvent} from '../src/mini-api.js';
import {Bot} from '../src/bot.js';
import {responseCounts} from '../src/permissions.js';
import {issueTicket,verifyTicket} from '../src/tickets.js';
import {checkout,requestRefund,refundResult} from '../src/payments.js';

const requestId='11111111-1111-4111-8111-111111111111';
function fixture(names='Alex = 2\nSam = ?\nTaylor = 3!'){
  const e={id:'0123456789abcdef',owner:1,title:'Club dinner',location:'Private venue',invitationMode:'named',guests:{},media:[],permissions:{},startsAt:'2099-11-25T07:00:00Z',endsAt:'2099-11-25T10:00:00Z'};
  Object.assign(e,invitationSettings({guestNames:names},e));
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const token=Object.keys(e.invitees)[0];
  const add=(guestNames,fields={})=>addInvitations(e,1,{guestNames,requestId,version:invitationsVersion(e),...fields});
  const remove=(fields={},actor=1)=>removeInvitation(e,actor,{token,notify:false,confirm:true,version:invitationsVersion(e),...fields},data.sessions);
  return {e,data,calls,bot,token,add,remove};
}

test('manager projection exposes all responses and truthful mixed summaries without leaking them to guests',()=>{
  const f=fixture();f.e.oneTimeInvite=false;
  for(const [uid,status,participants] of [[2,'yes',4],[3,'no',2],[4,'maybe',2],[5,'later',2]]){
    const guest=claimInvitation(f.e,f.token,uid);Object.assign(guest,{status,participants,comment:'Guest comment',approval:'approved'});
  }
  f.e.guests[2].payment={status:'paid'};
  const card=publicEvent(f.e,1,'ExampleBot'),invite=card.invitees[0];
  assert.equal(invite.token,f.token);assert.equal(invite.status,'mixed');assert.equal(invite.responses.length,4);
  assert.deepEqual(invite.responseCounts,{yes:1,no:1,maybe:1,later:1});assert.equal(invite.responses[0].participants,4);
  assert.equal(invite.responses[0].comment,'Guest comment');assert.equal(invite.responses[0].confirmed,true);
  assert.equal(invite.canNotify,true);assert.equal(invite.hasPayments,true);
  assert.equal(card.invitees[1].status,null);assert.equal(card.invitees[1].canNotify,false);
  assert.equal(publicEvent(f.e,2,'ExampleBot').invitees,undefined);assert.equal(publicEvent(f.e,2,'ExampleBot').invitationsVersion,undefined);
  assert.equal(publicEvent(f.e,1,'ExampleBot').removedInvitations,undefined);
});

test('adding guests keeps prior tokens, attendee syntax, completed responses and reminders unchanged',()=>{
  const f=fixture(),prior=structuredClone(f.e.invitees);
  Object.assign(claimInvitation(f.e,f.token,2),{status:'yes',participants:2});f.e.invitees[f.token].respondedBy=2;
  f.e.reminders={2:{minutes:120}};const guest=structuredClone(f.e.guests[2]);
  assert.deepEqual(f.add('Jordan = ?\nCasey = 4!\nMorgan = 5'),{added:3});
  for(const token of Object.keys(prior))assert.deepEqual(f.e.invitees[token],token===f.token?{...prior[token],respondedBy:2}:prior[token]);
  assert.deepEqual(f.e.guests[2],guest);assert.deepEqual(f.e.reminders,{2:{minutes:120}});
  const byName=Object.fromEntries(Object.values(f.e.invitees).map(invite=>[invite.name,invite]));
  assert.equal(byName.Jordan.participantMode,'ask');assert.equal(byName.Casey.participantMode,'confirm');assert.equal(byName.Casey.participants,4);assert.equal(byName.Morgan.participants,5);
});

test('add rejects duplicates and total guest limits atomically',()=>{
  const f=fixture(),before=structuredClone(f.e);
  for(const input of ['Alex','New\nNew','New = 11','New = 0','X'.repeat(101),''])assert.throws(()=>f.add(input));
  assert.deepEqual(f.e,before);
  assert.throws(()=>f.add(Array.from({length:98},(_,i)=>'Guest '+i).join('\n')));assert.deepEqual(f.e,before);
});

test('add retries are idempotent and request IDs cannot be reused with other names or another manager',()=>{
  const f=fixture(),version=invitationsVersion(f.e);f.add('Jordan');
  assert.deepEqual(f.add('Jordan',{version}),{added:0,alreadyAdded:true});
  assert.throws(()=>f.add('Casey',{version}));
  f.e.cohost={id:6,name:'Co-host'};
  assert.throws(()=>addInvitations(f.e,6,{guestNames:'Jordan',requestId,version}));
  assert.equal(Object.keys(f.e.invitees).length,4);
});

test('versions change with RSVP, count, payment, check-in and invitation changes',()=>{
  const f=fixture();let version=invitationsVersion(f.e);
  for(const mutate of [()=>claimInvitation(f.e,f.token,2),()=>f.e.guests[2].status='yes',()=>f.e.guests[2].participants=3,()=>f.e.guests[2].payment={status:'paid'},()=>f.e.checkIns={ABC:{userId:2}},()=>f.e.invitees[f.token].name='New name']){
    mutate();assert.notEqual(invitationsVersion(f.e),version);version=invitationsVersion(f.e);
  }
  assert.throws(()=>f.add('New',{version:'0000000000000000'}));assert.throws(()=>f.remove({version:'0000000000000000'}));
});

test('remove revokes reusable links and every associated response, ticket, reminder and partial session',async()=>{
  const f=fixture();f.e.oneTimeInvite=false;
  for(const uid of [2,3]){Object.assign(claimInvitation(f.e,f.token,uid),{status:'yes',participants:2,approval:'approved'});issueTicket(f.e,uid);}
  const codes=Object.values(f.e.guests).map(guest=>guest.ticket);
  f.e.reminders={2:{minutes:120},3:{minutes:180},8:{minutes:60}};
  f.data.sessions={2:{event:f.e.id,step:'phone'},3:{event:f.e.id,step:'upload'},4:{event:f.e.id,step:'comment',response:{invitationToken:f.token}},8:{event:'another',step:'edit'}};
  const result=f.remove();assert.deepEqual(result,{removed:true,alreadyRemoved:false,notifyCount:0,recipients:[]});
  assert.equal(f.e.invitees[f.token],undefined);assert.equal(f.e.guests[2],undefined);assert.equal(f.e.guests[3],undefined);
  assert.deepEqual(f.e.reminders,{8:{minutes:60}});assert.deepEqual(f.data.sessions,{8:{event:'another',step:'edit'}});
  for(const code of codes)assert.equal(verifyTicket(f.e,1,code).valid,false);
  assert.equal(invitationAvailable(f.e,2,f.token),false);assert.equal(f.bot.allowed(f.e,2),false);assert.equal(f.bot.mediaAllowed(f.e,2),false);
  assert.throws(()=>claimInvitation(f.e,f.token,2));assert.deepEqual(responseCounts(f.e),{yes:0,participants:0,pendingParticipants:0,pending:0,awaitingPayment:0,no:0,maybe:0,later:0});
  await f.bot.handle({callback_query:{id:'q',from:{id:2},data:`r:${f.e.id}:yes`}});
  assert.equal(f.e.guests[2],undefined);assert.match(f.calls.at(-1).text,/valid invitation/);
});

test('notify removal targets each guest once and retry cannot notify again or alter another invitation',()=>{
  const f=fixture();f.e.oneTimeInvite=false;claimInvitation(f.e,f.token,2);claimInvitation(f.e,f.token,3);
  const otherToken=Object.keys(f.e.invitees)[1];claimInvitation(f.e,otherToken,4);
  const version=invitationsVersion(f.e),result=f.remove({notify:true,version});
  assert.deepEqual(result.recipients,[2,3]);assert.equal(result.notifyCount,2);assert.ok(f.e.guests[4]);assert.ok(f.e.invitees[otherToken]);
  assert.deepEqual(f.remove({notify:true,version}),{removed:true,alreadyRemoved:true,notifyCount:0,recipients:[]});
  assert.equal(managedInvitations(f.e,'ExampleBot').length,2);
});

test('silent or unopened removal never queues recipients and new same-name invitation has a fresh token',()=>{
  const f=fixture();assert.equal(f.remove({notify:true}).notifyCount,0);
  f.add('Alex = 2');const replacement=Object.entries(f.e.invitees).find(([,invite])=>invite.name==='Alex')[0];
  assert.notEqual(replacement,f.token);assert.equal(invitationAvailable(f.e,2,f.token),false);assert.equal(invitationAvailable(f.e,2,replacement),true);
});

test('owner and active co-host can manage invitations but guests, revoked co-hosts and inactive events cannot',()=>{
  const f=fixture();f.e.cohost={id:6,name:'Co-host'};
  assert.throws(()=>removeInvitation(f.e,2,{token:f.token,confirm:true,notify:false,version:invitationsVersion(f.e)}));
  assert.equal(f.remove({},6).removed,true);
  for(const changes of [{cancelled:true},{endsAt:'2000-01-01'},{invitationMode:'tickets'}]){
    const locked=fixture();Object.assign(locked.e,changes);assert.throws(()=>locked.add('Jordan'));assert.throws(()=>locked.remove());
  }
  const revoked=fixture();revoked.e.cohost={id:6,name:'Old co-host'};revoked.e.cohostLinks=[];
  assert.throws(()=>revoked.remove({},6));
  assert.throws(()=>addInvitations(undefined,1,{guestNames:'Alex'}));
});

test('remove validates explicit confirmation, notification choice, token and version before any mutation',()=>{
  for(const fields of [{confirm:false},{confirm:'true'},{notify:undefined},{notify:'false'},{token:'invalid'},{token:'f'.repeat(32)},{version:undefined}]){
    const f=fixture(),before=structuredClone(f.e);assert.throws(()=>f.remove(fields));assert.deepEqual(f.e,before);
  }
});

test('removing a personal invitation preserves independent co-host access and never deletes the owner record',()=>{
  const f=fixture();f.e.cohost={id:6,name:'Co-host'};claimInvitation(f.e,f.token,6);
  f.e.guests[1]={name:'Owner',invitationToken:f.token,status:'yes'};f.data.sessions[1]={event:f.e.id,step:'edit'};
  f.remove();assert.ok(f.e.guests[1]);assert.ok(f.data.sessions[1]);assert.equal(f.e.guests[6],undefined);assert.equal(f.bot.allowed(f.e,6),true);
});

test('removing all invitations leaves an existing named event editable and creation still needs a guest',()=>{
  const f=fixture('Alex');f.remove();assert.deepEqual(invitationSettings({guestNames:''},f.e).invitees,{});
  assert.throws(()=>invitationSettings({invitationMode:'named',guestNames:''}));
  f.add('Jordan');assert.equal(Object.values(f.e.invitees)[0].name,'Jordan');
});

test('a response deadline does not prevent organisers from removing or adding invitations',()=>{
  const f=fixture();f.e.responseDeadline='2000-01-01T00:00:00Z';f.remove();assert.equal(f.add('Jordan').added,1);
});

test('removed paid responses keep financial ledgers and owner refund controls usable without automatically refunding',async()=>{
  const f=fixture();Object.assign(claimInvitation(f.e,f.token,2),{status:'yes',approval:'approved',payment:{order:'order',status:'paid'},ticket:'ABCDEF123456'});
  const order={id:'order',event:f.e.id,owner:1,title:f.e.title,amount:20,status:'paid',charge:'fictional-charge'};
  const manual={event:f.e.id,owner:1,title:f.e.title,price:'AUD 20',status:'paid'};
  f.data.preferences[2]={starOrders:{order},manualPayments:{manual}};
  f.remove();assert.equal(f.calls.length,0);assert.equal(f.data.preferences[2].starOrders.order,order);assert.equal(f.data.preferences[2].manualPayments.manual,manual);
  assert.equal(f.e.removedInvitations[f.token].responses[2].payment.status,'paid');assert.equal(verifyTicket(f.e,1,'ABCDEF123456').valid,false);
  await f.bot.handle({message:{chat:{id:1,type:'private'},from:{id:1,first_name:'Owner'},text:'/paysupport'}});
  assert.ok(f.calls.some(call=>call.reply_markup?.inline_keyboard.flat().some(button=>button.callback_data==='sr:2:order')));
  await requestRefund(f.bot,2,order);assert.equal(order.status,'refund_pending');assert.ok(f.calls.some(call=>call.method==='refundStarPayment'));
  await refundResult(f.bot,2,'fictional-charge',true);assert.equal(order.status,'refunded');assert.equal(f.e.guests[2],undefined);
});

test('removed unpaid invoice can no longer pass checkout',()=>{
  const f=fixture();Object.assign(f.e,{starPrice:10,starPricing:'group',paymentTerms:'Terms'});
  Object.assign(claimInvitation(f.e,f.token,2),{status:'yes',approval:'approved',participants:2,payment:{order:'order',status:'pending'}});
  f.data.preferences[2]={starOrders:{order:{id:'order',event:f.e.id,owner:1,unitPrice:10,pricing:'group',terms:'Terms',amount:10,participants:2,status:'pending'}}};
  f.remove();assert.equal(checkout(f.bot,{id:'checkout',from:{id:2},currency:'XTR',total_amount:10,invoice_payload:'order'}).ok,false);
});
