import test from 'node:test';
import assert from 'node:assert/strict';
import {addInvitations,removeInvitation,invitationsVersion,managedInvitations,revokedInvitations,editInvitation,changeInvitationResponse,revokeInvitation,deleteInvitation} from '../src/invitation-management.js';
import {appendInvitationHistory,invitationHistory} from '../src/invitation-history.js';
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

test('adding guests preserves fixed invitation counts and links for existing and new guests',()=>{
  const f=fixture('Alex = 2*\nSam = 3'),prior=structuredClone(f.e.invitees);
  Object.assign(claimInvitation(f.e,f.token,2),{status:'yes',participants:9});
  assert.deepEqual(f.add('Jordan = 4*'),{added:1});
  for(const token of Object.keys(prior))assert.deepEqual(f.e.invitees[token],prior[token]);
  const invites=managedInvitations(f.e,'ExampleBot'),alex=invites.find(g=>g.name==='Alex'),jordan=invites.find(g=>g.name==='Jordan');
  assert.equal(alex.participantMode,'fixed');assert.equal(alex.participants,2);assert.equal(alex.responses[0].participants,2);
  assert.equal(jordan.participantMode,'fixed');assert.equal(jordan.participants,4);
  const saved=JSON.parse(JSON.stringify(f.e));
  assert.equal(saved.invitees[f.token].participantMode,'fixed');assert.equal(saved.invitees[f.token].participants,2);
  assert.deepEqual(f.add('Jordan = 4*'),{added:0,alreadyAdded:true});
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

const mutationInput=(f,fields={})=>({token:f.token,version:invitationsVersion(f.e),requestId,...fields});
const editInput=(f,fields={})=>mutationInput(f,{name:'Alex Smith',participants:3,participantMode:'preset',...fields});
const responseInput=(f,fields={})=>mutationInput(f,{userId:2,status:'yes',participants:2,notify:false,...fields});
const revokeInput=(f,fields={})=>mutationInput(f,{confirm:true,notify:false,...fields});

test('editing keeps the invitation token and history, updates linked guests, and clears partial responses',()=>{
  const f=fixture();f.e.oneTimeInvite=false;
  const guest=claimInvitation(f.e,f.token,2);Object.assign(guest,{status:'yes',participants:2,approval:'approved'});
  issueTicket(f.e,2);const ticket=guest.ticket;claimInvitation(f.e,f.token,3);
  f.data.sessions={2:{event:f.e.id,step:'comment',response:{...guest}},3:{event:f.e.id,step:'phone'},8:{event:'other',step:'upload'}};
  const before=invitationHistory(f.e,f.token).length;
  const input=editInput(f),result=editInvitation(f.e,1,input,f.data.sessions,Date.parse('2090-01-01T00:00:00Z'));
  assert.equal(result.edited,true);assert.equal(f.e.invitees[f.token].name,'Alex Smith');
  assert.equal(f.e.guests[2].name,'Alex Smith');assert.equal(f.e.guests[3].name,'Alex Smith');
  assert.equal(f.e.guests[2].participants,3);assert.equal(f.e.guests[2].ticket,ticket);
  assert.deepEqual(f.data.sessions,{8:{event:'other',step:'upload'}});
  assert.equal(invitationHistory(f.e,f.token).length,before+1);
  assert.deepEqual(invitationHistory(f.e,f.token).at(-1),{type:'edited',at:'2090-01-01T00:00:00.000Z',actorId:1,actorRole:'organiser',name:'Alex Smith',previousName:'Alex',participants:3,previousParticipants:2,participantMode:'preset',previousParticipantMode:'preset'});
  assert.equal(editInvitation(f.e,1,input,f.data.sessions).alreadyApplied,true);
  assert.equal(invitationHistory(f.e,f.token).length,before+1);
  assert.throws(()=>editInvitation(f.e,1,{...input,name:'Different name'},f.data.sessions));
});

test('invite edit rejects malformed and duplicate names, invalid settings, and stale lists without changes',()=>{
  for(const fields of [{name:''},{name:'A\nB'},{name:'A = 2'},{name:'Sam'},{participants:11},{participantMode:'invalid'},{participantMode:'ask',participants:2},{participantMode:'default',participants:1},{version:'stale'},{requestId:undefined}]){
    const f=fixture(),before=structuredClone(f.e);
    assert.throws(()=>editInvitation(f.e,1,editInput(f,fields),f.data.sessions));assert.deepEqual(f.e,before);
  }
  for(const mode of ['default','ask','confirm','fixed']){
    const f=fixture();editInvitation(f.e,1,editInput(f,{participantMode:mode,participants:['default','ask'].includes(mode)?null:4}));
    assert.equal(f.e.invitees[f.token].participantMode,['default'].includes(mode)?undefined:mode);
  }
});

test('active payment and checked-in attendees can be renamed but their attendance settings stay protected',()=>{
  for(const status of ['reported','paid','processing','refund_pending','refund_failed','checked-in']){
    const f=fixture(),guest=claimInvitation(f.e,f.token,2);
    Object.assign(guest,{status:'yes',participants:2,approval:'approved',ticket:'ABCDEF123456'});
    if(status==='checked-in')f.e.checkIns={ABCDEF123456:{userId:2,at:'2090-01-01T00:00:00Z',participants:2}};
    else guest.payment={status,order:'private-order'};
    const before=structuredClone(f.e);
    assert.throws(()=>editInvitation(f.e,1,editInput(f),f.data.sessions),/payment|check-in/);assert.deepEqual(f.e,before);
    editInvitation(f.e,1,editInput(f,{participants:2}),f.data.sessions);
    assert.equal(f.e.guests[2].name,'Alex Smith');assert.equal(f.e.guests[2].ticket,'ABCDEF123456');assert.deepEqual(f.e.guests[2].payment,before.guests[2].payment);assert.deepEqual(f.e.checkIns,before.checkIns);
  }
});

test('organiser RSVP requires an opened real guest and explicitly selects one reusable response',()=>{
  const f=fixture(),before=structuredClone(f.e);
  assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f)),/open their invitation/);assert.deepEqual(f.e,before);
  f.e.oneTimeInvite=false;claimInvitation(f.e,f.token,2);claimInvitation(f.e,f.token,3);
  for(const userId of [undefined,null,'2',4])assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f,{userId})));
  f.data.sessions={2:{event:f.e.id,step:'phone'},3:{event:f.e.id,step:'phone'}};
  changeInvitationResponse(f.e,1,responseInput(f),f.data.sessions);
  assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[3].status,'later');assert.equal(f.data.sessions[2],undefined);assert.ok(f.data.sessions[3]);
  assert.equal(invitationHistory(f.e,f.token).at(-1).actorRole,'organiser');assert.equal(invitationHistory(f.e,f.token).at(-1).userId,2);
});

test('organiser RSVP consumes the single-use link for its actual guest, keeps deadlines, and sends no retry notification',()=>{
  const f=fixture();claimInvitation(f.e,f.token,2);claimInvitation(f.e,f.token,3);
  f.e.responseDeadline='2000-01-01T00:00:00Z';f.e.defaultReminder=120;
  const input=responseInput(f,{notify:true});
  assert.deepEqual(changeInvitationResponse(f.e,1,input,f.data.sessions),{changed:true,status:'yes',notifyCount:1,recipients:[2]});
  assert.equal(f.e.invitees[f.token].respondedBy,2);assert.equal(f.e.guests[3],undefined);assert.equal(f.e.responseDeadline,'2000-01-01T00:00:00Z');
  assert.equal(invitationAvailable(f.e,3,f.token),false);assert.equal(verifyTicket(f.e,1,f.e.guests[2].ticket).valid,true);assert.equal(f.e.reminders[2].minutes,120);
  assert.equal(f.e.guests[2].ticketCode,undefined,'organiser acceptance does not issue a rotating code before the guest requests it');
  const history=structuredClone(f.e.invitationHistory);
  assert.deepEqual(changeInvitationResponse(f.e,1,input,f.data.sessions),{changed:true,status:'yes',notifyCount:0,alreadyApplied:true,recipients:[]});assert.deepEqual(f.e.invitationHistory,history);
  const reordered=Object.fromEntries(Object.entries(input).reverse());assert.equal(changeInvitationResponse(f.e,1,reordered,f.data.sessions).alreadyApplied,true);
  assert.throws(()=>changeInvitationResponse(f.e,1,{...input,status:'no'},f.data.sessions));
});

test('organiser RSVP rejects invalid counts, fixed count changes and protected attendance atomically',()=>{
  for(const fields of [{status:'invalid'},{notify:undefined},{notify:'false'},{participants:0},{participants:11},{participants:'2'},{version:'stale'},{requestId:undefined}]){
    const f=fixture();claimInvitation(f.e,f.token,2);const before=structuredClone(f.e);
    assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f,fields),f.data.sessions));assert.deepEqual(f.e,before);
  }
  for(const names of ['Alex = 2*','Alex']){
    const f=fixture(names);claimInvitation(f.e,f.token,2);
    assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f,{participants:3})),/fixed attendee|one person/);
  }
  for(const status of ['reported','paid','processing','refund_pending','refund_failed','checked-in']){
    const f=fixture(),guest=claimInvitation(f.e,f.token,2);Object.assign(guest,{status:'yes',approval:'approved',ticket:'ABCDEF123456'});
    if(status==='checked-in')f.e.checkIns={ABCDEF123456:{userId:2,at:'2090-01-01'}};else guest.payment={status};
    const before=structuredClone(f.e);
    assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f,{status:'no'})));assert.deepEqual(f.e,before);
    assert.throws(()=>changeInvitationResponse(f.e,1,responseInput(f,{participants:3})));assert.deepEqual(f.e,before);
  }
});

test('leaving acceptance revokes ticket and reminders while later remains linked to the same holder',()=>{
  for(const status of ['no','maybe','later']){
    const f=fixture(),guest=claimInvitation(f.e,f.token,2);Object.assign(guest,{status:'yes',approval:'approved'});issueTicket(f.e,2);
    f.e.invitees[f.token].respondedBy=2;f.e.reminders={2:{minutes:120}};const ticket=guest.ticket;
    changeInvitationResponse(f.e,1,responseInput(f,{status}));
    assert.equal(f.e.guests[2].status,status);assert.equal(f.e.guests[2].ticket,undefined);assert.equal(f.e.reminders[2],undefined);assert.equal(verifyTicket(f.e,1,ticket).valid,false);assert.equal(f.e.invitees[f.token].respondedBy,2);
  }
});

test('organiser acceptance preserves payment requirements and never creates an unpaid ticket',()=>{
  const f=fixture();Object.assign(f.e,{paymentMethod:'stars',starPrice:10,starPricing:'person'});claimInvitation(f.e,f.token,2);
  changeInvitationResponse(f.e,1,responseInput(f));
  assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[2].approval,'approved');assert.equal(f.e.guests[2].ticket,undefined);assert.equal(f.e.guests[2].payment,undefined);assert.equal(responseCounts(f.e).awaitingPayment,1);
});

test('organiser records explicit Respond later once instead of treating an opened placeholder as an RSVP',()=>{
  const f=fixture();claimInvitation(f.e,f.token,2);
  const input=responseInput(f,{status:'later',notify:true});
  assert.equal(changeInvitationResponse(f.e,1,input).changed,true);
  assert.equal(invitationHistory(f.e,f.token).at(-1).type,'responded');
  assert.equal(invitationHistory(f.e,f.token).at(-1).status,'later');
  const before=structuredClone(f.e.invitationHistory);
  assert.equal(changeInvitationResponse(f.e,1,input).alreadyApplied,true);
  const next=responseInput(f,{status:'later',notify:true,requestId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(changeInvitationResponse(f.e,1,next).changed,false);assert.deepEqual(f.e.invitationHistory,before);
});

test('revocation retains a manager-only timeline and archived RSVP, invalidates access, and deletion retains audit records',()=>{
  const f=fixture(),guest=claimInvitation(f.e,f.token,2);Object.assign(guest,{status:'yes',participants:2,approval:'approved',ticket:'ABCDEF123456',phone:'private phone',comment:'private comment',payment:{status:'paid',order:'private-order'}});
  f.e.checkIns={ABCDEF123456:{userId:2,at:'2090-01-01T00:00:00Z',participants:2}};f.e.reminders={2:{minutes:120}};
  f.data.preferences[2]={starOrders:{'private-order':{status:'paid',charge:'private-charge'}}};
  f.data.sessions[2]={event:f.e.id,step:'upload'};const input=revokeInput(f,{notify:true});
  assert.deepEqual(revokeInvitation(f.e,1,input,f.data.sessions,Date.parse('2090-01-01T01:00:00Z')),{revoked:true,notifyCount:1,recipients:[2]});
  assert.equal(f.e.guests[2],undefined);assert.equal(f.e.invitees[f.token],undefined);assert.equal(f.e.reminders[2],undefined);assert.equal(f.data.sessions[2],undefined);
  assert.ok(f.e.checkIns.ABCDEF123456);assert.equal(f.data.preferences[2].starOrders['private-order'].charge,'private-charge');assert.equal(verifyTicket(f.e,1,'ABCDEF123456').valid,false);
  const dto=publicEvent(f.e,1,'ExampleBot'),revoked=dto.revokedInvitees[0];
  assert.equal(revoked.token,f.token);assert.equal(revoked.url,null);assert.equal(revoked.revoked,true);assert.equal(revoked.responses[0].participants,2);assert.equal(revoked.responses[0].confirmed,false);assert.equal(revoked.history.at(-1).type,'revoked');
  assert.doesNotMatch(JSON.stringify(dto),/private phone|private-order|private-charge|ABCDEF123456/);assert.equal(publicEvent(f.e,9,'ExampleBot').revokedInvitees,undefined);
  assert.equal(revokeInvitation(f.e,1,input,f.data.sessions).alreadyApplied,true);
  const deletion=mutationInput(f,{confirm:true,requestId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(deleteInvitation(f.e,1,deletion).deleted,true);assert.deepEqual(revokedInvitations(f.e,'ExampleBot'),[]);assert.equal(f.e.removedInvitations[f.token].responses[2].payment.order,'private-order');assert.equal(invitationHistory(f.e,f.token).at(-1).type,'deleted');
  assert.equal(deleteInvitation(f.e,1,deletion).alreadyApplied,true);
});

test('revoke and delete require manager permission, current versions, and explicit confirmations',()=>{
  for(const operation of [editInvitation,changeInvitationResponse,revokeInvitation,deleteInvitation]){
    const f=fixture();claimInvitation(f.e,f.token,2);
    assert.throws(()=>operation(f.e,2,mutationInput(f),f.data.sessions),/Only an organiser/);
  }
  const f=fixture(),before=structuredClone(f.e);
  assert.throws(()=>deleteInvitation(f.e,1,mutationInput(f,{confirm:true})),/Revoke/);assert.deepEqual(f.e,before);
  for(const fields of [{confirm:false},{notify:undefined},{requestId:undefined},{version:'stale'}]){
    assert.throws(()=>revokeInvitation(f.e,1,revokeInput(f,fields),f.data.sessions));assert.deepEqual(f.e,before);
  }
  f.e.cohost={id:6,name:'Assistant host'};revokeInvitation(f.e,6,revokeInput(f),f.data.sessions);
  assert.equal(revokedInvitations(f.e,'ExampleBot').length,1);
});

test('history sanitizes manager DTOs without inventing timestamps or leaking arbitrary stored fields',()=>{
  const f=fixture();delete f.e.invitationHistory;
  assert.deepEqual(managedInvitations(f.e,'ExampleBot')[0].history,[]);assert.equal(managedInvitations(f.e,'ExampleBot')[0].historyIncomplete,true);
  appendInvitationHistory(f.e,undefined,'responded',{phone:'private'},0);assert.equal(f.e.invitationHistory,undefined);
  appendInvitationHistory(f.e,f.token,'opened',{userId:2,name:'Alex',phone:'private',payment:{charge:'private'}},Date.parse('2090-01-01T00:00:00Z'));
  f.e.invitationHistory[f.token].push({type:'responded',at:'2090-01-01T01:00:00Z',status:'yes',phone:'private',ticket:'private',actorId:1,actorRole:'organiser',userId:2});
  const dto=managedInvitations(f.e,'ExampleBot')[0];assert.equal(dto.history.length,2);assert.doesNotMatch(JSON.stringify(dto.history),/private|phone|ticket|charge/);
  const version=invitationsVersion(f.e);appendInvitationHistory(f.e,f.token,'edited',{name:'Alex'},Date.parse('2090-01-01T02:00:00Z'));assert.notEqual(invitationsVersion(f.e),version);
});

test('manager response DTO distinguishes opened placeholders, explicit Later responses, and unknown legacy response times',()=>{
  const f=fixture();f.e.oneTimeInvite=false;
  claimInvitation(f.e,f.token,2);claimInvitation(f.e,f.token,3);claimInvitation(f.e,f.token,4);claimInvitation(f.e,f.token,5);
  Object.assign(f.e.guests[3],{status:'yes',responseVersion:0});
  Object.assign(f.e.guests[4],{status:'later',responseVersion:1});
  for(const uid of [3,4,5])delete f.e.guests[uid].responseRecorded;
  const older='2090-01-01T01:00:00Z',latest='2090-01-01T03:00:00Z';
  appendInvitationHistory(f.e,f.token,'responded',{userId:5,status:'yes'},Date.parse(older));
  appendInvitationHistory(f.e,f.token,'changed',{userId:5,status:'later'},Date.parse(latest));
  appendInvitationHistory(f.e,f.token,'changed',{userId:5,status:'maybe'},Date.parse('2090-01-01T02:00:00Z'));
  appendInvitationHistory(f.e,f.token,'changed',{userId:3,status:'no'},Date.parse('2090-01-01T04:00:00Z'));
  const byId=Object.fromEntries(managedInvitations(f.e,'ExampleBot')[0].responses.map(response=>[response.id,response]));
  assert.equal(byId[2].responded,false);assert.equal(byId[2].respondedAt,null);
  assert.equal(byId[3].responded,true);assert.equal(byId[3].respondedAt,'2090-01-01T04:00:00.000Z');
  assert.equal(byId[4].responded,true);assert.equal(byId[4].respondedAt,null);
  assert.equal(byId[5].responded,true);assert.equal(byId[5].respondedAt,'2090-01-01T03:00:00.000Z');
  delete f.e.invitationHistory;
  const legacy=managedInvitations(f.e,'ExampleBot')[0].responses.find(response=>response.id===3);
  assert.equal(legacy.responded,true);assert.equal(legacy.respondedAt,null);
  assert.equal(publicEvent(f.e,2,'ExampleBot').invitees,undefined);
});

test('editing a placeholder attendee count keeps it awaiting its first actual response',()=>{
  const f=fixture();claimInvitation(f.e,f.token,2);
  editInvitation(f.e,1,editInput(f));
  const response=managedInvitations(f.e,'ExampleBot')[0].responses[0];
  assert.equal(response.responded,false);assert.equal(response.respondedAt,null);assert.equal(f.e.guests[2].responseVersion,undefined);
  changeInvitationResponse(f.e,1,responseInput(f,{status:'later',requestId:'22222222-2222-4222-8222-222222222222'}));
  assert.equal(managedInvitations(f.e,'ExampleBot')[0].responses[0].responded,true);
});

test('count-only response versions do not replace an explicit unanswered marker',()=>{
  const f=fixture();claimInvitation(f.e,f.token,2);
  Object.assign(f.e.guests[2],{responseRecorded:false,responseVersion:3,participants:4});
  appendInvitationHistory(f.e,f.token,'edited',{actorRole:'guest',actorId:2,userId:2,participants:4,previousParticipants:2},Date.parse('2090-01-01T00:00:00Z'));
  let response=managedInvitations(f.e,'ExampleBot')[0].responses[0];
  assert.equal(response.responded,false);assert.equal(response.respondedAt,null);
  editInvitation(f.e,1,editInput(f));
  assert.equal(f.e.guests[2].responseVersion,3);assert.equal(managedInvitations(f.e,'ExampleBot')[0].responses[0].responded,false);
  changeInvitationResponse(f.e,1,responseInput(f,{status:'later',requestId:'22222222-2222-4222-8222-222222222222'}),{},Date.parse('2090-01-01T01:00:00Z'));
  response=managedInvitations(f.e,'ExampleBot')[0].responses[0];
  assert.equal(f.e.guests[2].responseRecorded,true);assert.equal(f.e.guests[2].responseVersion,4);
  assert.equal(response.responded,true);assert.equal(response.respondedAt,'2090-01-01T01:00:00.000Z');assert.equal(invitationHistory(f.e,f.token).at(-1).type,'responded');
});

test('manager guest roster distinguishes awaiting replies from explicit Later and legacy responses',()=>{
  const f=fixture();f.e.oneTimeInvite=false;
  for(const uid of [2,3,4,5,6,7,8])claimInvitation(f.e,f.token,uid);
  Object.assign(f.e.guests[3],{responseRecorded:false,responseVersion:4,participants:3,phone:'private phone',comment:'private comment'});
  Object.assign(f.e.guests[4],{responseRecorded:true,responseVersion:1});
  for(const uid of [5,6,7])delete f.e.guests[uid].responseRecorded;
  f.e.guests[5].status='yes';f.e.guests[6].responseVersion=1;
  appendInvitationHistory(f.e,f.token,'responded',{userId:7,status:'later'},Date.parse('2090-01-01T01:00:00Z'));
  Object.assign(f.e.guests[8],{responseRecorded:false,responseVersion:10,status:'yes'});
  f.e.guests[1]={name:'Owner',status:'yes'};
  const roster=publicEvent(f.e,1,'ExampleBot').guestRoster;
  const byId=Object.fromEntries(roster.filter(g=>g.id!==null).map(g=>[g.id,g]));
  assert.equal(byId[1],undefined);assert.equal(byId[2].responded,false);assert.equal(byId[3].responded,false);
  for(const uid of [4,5,6,7])assert.equal(byId[uid].responded,true);
  assert.equal(byId[8].responded,false);
  for(const guest of roster.filter(g=>g.id===null)){assert.equal(guest.status,'unopened');assert.equal(guest.responded,false);}
  assert.doesNotMatch(JSON.stringify(roster),/private phone|private comment|invitationToken|responseRecorded|responseVersion/);
  assert.equal(publicEvent(f.e,2,'ExampleBot').guestRoster,undefined);
  f.e.invitationMode='legacy';f.e.guests[9]={name:'Legacy guest',status:'maybe'};
  assert.equal(publicEvent(f.e,1,'ExampleBot').guestRoster.find(g=>g.id===9).responded,true);
});
