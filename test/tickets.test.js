import test from 'node:test';
import assert from 'node:assert/strict';
import {issueTicket,ensureTicket,verifyTicket} from '../src/tickets.js';
import {publicEvent} from '../src/mini-api.js';
import {adminOverview} from '../src/admin.js';

const now=Date.parse('2030-10-24T08:00:20Z');
function fixture(){return {id:'0123456789abcdef',owner:1,title:'Club match',askParticipantCount:true,requireApproval:true,guests:{2:{name:'Alex',status:'yes',approval:'approved',participants:4}},media:[]};}
const qr=(e,id=2)=>`XE1:${e.id}:${e.guests[id].ticket}`;

test('opening a confirmed ticket requests a private six-digit code while QR and audit identity stay stable',()=>{
  const e=fixture();const stable=ensureTicket(e,2);
  assert.match(stable,/^[A-F0-9]{12}$/);assert.equal(e.guests[2].ticketCode,undefined);
  const ticket=issueTicket(e,2,now),state=structuredClone(e.guests[2].ticketCode);
  assert.match(ticket.code,/^\d{6}$/);assert.match(ticket.image,/^data:image\/gif;base64,/);
  assert.equal(ticket.serverTime,'2030-10-24T08:00:20.000Z');assert.equal(ticket.codeExpiresAt,'2030-10-24T08:01:00.000Z');
  assert.equal(issueTicket(e,2,now+1000).code,ticket.code);assert.deepEqual(e.guests[2].ticketCode,state);
  assert.equal(ticket.participants,4);assert.equal(e.guests[2].ticket,stable);assert.match(state.secret,/^[a-f0-9]{64}$/);
  assert.throws(()=>issueTicket(e,3,now));assert.throws(()=>issueTicket(e,1,now));assert.throws(()=>verifyTicket(e,2,ticket.code,false,now));
  const checked=verifyTicket(e,1,qr(e),false,now);assert.equal(checked.valid,true);assert.equal(checked.name,'Alex');assert.equal(checked.checkedInAt,null);assert.equal(e.checkIns,undefined);
  assert.equal(verifyTicket(e,1,`XE1:ffffffffffffffff:${stable}`,false,now).valid,false);
  assert.equal(verifyTicket(e,1,'not-a-ticket',false,now).valid,false);
});

test('six-digit codes expire at the exact server minute and refresh only on an explicit ticket request',()=>{
  const e=fixture();e.guests[2].ticket='ABCDEF123456';e.guests[2].ticketCode={ticket:e.guests[2].ticket,secret:'1'.repeat(64),issuedMinute:null};
  const ticket=issueTicket(e,2,now),expiry=Date.parse(ticket.codeExpiresAt),secret=e.guests[2].ticketCode.secret;
  assert.equal(verifyTicket(e,1,ticket.code,false,expiry-1).valid,true);
  assert.equal(verifyTicket(e,1,ticket.code,false,expiry).valid,false);assert.equal(verifyTicket(e,1,ticket.code,false,expiry+59000).valid,false);
  assert.equal(e.guests[2].ticketCode.issuedMinute,Math.floor(now/60000));
  const refreshed=issueTicket(e,2,expiry);
  assert.match(refreshed.code,/^\d{6}$/);assert.notEqual(refreshed.code,ticket.code);
  assert.equal(refreshed.codeExpiresAt,'2030-10-24T08:02:00.000Z');assert.equal(e.guests[2].ticketCode.secret,secret);
  assert.equal(verifyTicket(e,1,refreshed.code,false,expiry).valid,true);assert.equal(verifyTicket(e,1,ticket.code,false,expiry).valid,false);
});

test('code verification follows current approval, payment and revocation state',()=>{
  const e=fixture(),ticket=issueTicket(e,2,now);
  assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,true);
  e.guests[2].approval='pending';assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,false);assert.throws(()=>issueTicket(e,2,now));
  e.guests[2].approval='approved';e.starPrice=100;e.paymentMethod='stars';assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,false);
  e.guests[2].payment={status:'paid'};assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,true);
  e.guests[2].payment.status='refund_pending';assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,false);
  e.guests[2].payment.status='paid';delete e.guests[2];assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,false);
});

test('check-in stays idempotent across rotating codes and uses the unchanged internal ticket key',()=>{
  const e=fixture(),ticket=issueTicket(e,2,now),stable=e.guests[2].ticket;
  const first=verifyTicket(e,1,ticket.code,true,now);assert.equal(first.alreadyCheckedIn,false);assert.ok(first.checkedInAt);
  const second=verifyTicket(e,1,ticket.code,true,now+1000);assert.equal(second.alreadyCheckedIn,true);assert.equal(second.checkedInAt,first.checkedInAt);assert.equal(Object.keys(e.checkIns).length,1);
  assert.equal(e.checkIns[stable].userId,2);assert.equal(e.checkIns[ticket.code],undefined);
  const refreshed=issueTicket(e,2,Date.parse(ticket.codeExpiresAt));assert.equal(refreshed.checkedInAt,first.checkedInAt);
  const next=verifyTicket(e,1,refreshed.code,true,Date.parse(ticket.codeExpiresAt));assert.equal(next.alreadyCheckedIn,true);assert.equal(next.checkedInAt,first.checkedInAt);assert.equal(Object.keys(e.checkIns).length,1);
  e.cancelled=true;assert.equal(verifyTicket(e,1,refreshed.code,true,now).valid,false);
  e.cancelled=false;e.endsAt=new Date(now).toISOString();assert.equal(verifyTicket(e,1,refreshed.code,true,now).valid,false);
  delete e.endsAt;e.guests[2].status='no';assert.equal(verifyTicket(e,1,refreshed.code,false,now).valid,false);
});

test('existing QR and old manual ticket codes remain valid and honor QR disabling',()=>{
  const e=fixture();e.guests[2].ticket='ABCDEF123456';e.qrEnabled=false;
  assert.equal(verifyTicket(e,1,'abcdef123456',false,now).valid,true);assert.equal(e.guests[2].ticketCode,undefined);
  const ticket=issueTicket(e,2,now);assert.equal(ticket.image,null);assert.match(ticket.code,/^\d{6}$/);
  assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,true);assert.equal(verifyTicket(e,1,qr(e),false,now).valid,false);
  assert.match(verifyTicket(e,1,qr(e),false,now).reason,/QR codes are disabled/);
  e.qrEnabled=true;const enabled=issueTicket(e,2,now);assert.equal(enabled.code,ticket.code);assert.match(enabled.image,/^data:image\/gif;base64,/);
  assert.equal(verifyTicket(e,1,qr(e),false,now).valid,true);
});

test('replacing a stable ticket invalidates its old rotating state without modifying historical check-ins',()=>{
  const e=fixture(),old=issueTicket(e,2,now),oldStable=e.guests[2].ticket,oldSecret=e.guests[2].ticketCode.secret;
  verifyTicket(e,1,old.code,true,now);e.guests[2].ticket='ABCDEF123456';
  assert.equal(verifyTicket(e,1,old.code,false,now).valid,false);assert.equal(verifyTicket(e,1,oldStable,false,now).valid,false);
  assert.ok(e.checkIns[oldStable]);
  const replacement=issueTicket(e,2,now);assert.notEqual(e.guests[2].ticketCode.secret,oldSecret);
  assert.equal(e.guests[2].ticketCode.ticket,'ABCDEF123456');assert.equal(replacement.checkedInAt,null);
  assert.equal(verifyTicket(e,1,replacement.code,false,now).valid,true);
});

test('ambiguous current codes fail closed and an explicit request resolves collision without changing ticket identity',()=>{
  const e=fixture(),minute=Math.floor(now/60000);
  e.guests[2].ticket='00000000011C';
  e.guests[2].ticketCode={ticket:e.guests[2].ticket,secret:'1'.repeat(64),issuedMinute:minute};
  const ticket=issueTicket(e,2,now),stable=e.guests[2].ticket;
  e.guests[3]={...structuredClone(e.guests[2]),name:'Sam',ticket:'0000000002D5',ticketCode:{ticket:'0000000002D5',secret:'1'.repeat(64),issuedMinute:minute}};
  assert.equal(ticket.code,'263365');
  const collision=verifyTicket(e,1,ticket.code,true,now);assert.equal(collision.valid,false);assert.match(collision.reason,/several tickets/);assert.equal(e.checkIns,undefined);
  assert.equal(verifyTicket(e,1,stable,false,now).valid,true);
  const replacement=issueTicket(e,2,now);assert.notEqual(replacement.code,ticket.code);assert.equal(e.guests[2].ticket,stable);
  assert.equal(verifyTicket(e,1,replacement.code,false,now).name,'Alex');assert.equal(verifyTicket(e,1,ticket.code,false,now).name,'Sam');
});

test('ambiguous stable audit identities and another guest check-in never admit the wrong holder',()=>{
  const e=fixture(),ticket=issueTicket(e,2,now),stable=e.guests[2].ticket;
  e.guests[3]={...structuredClone(e.guests[2]),name:'Sam',ticketCode:undefined};
  assert.equal(verifyTicket(e,1,ticket.code,true,now).valid,false);assert.equal(e.checkIns,undefined);
  delete e.guests[3];e.checkIns={[stable]:{userId:3,participants:1,at:'2030-10-24T07:00:00Z'}};
  const prior=structuredClone(e.checkIns);
  assert.equal(verifyTicket(e,1,ticket.code,true,now).valid,false);assert.deepEqual(e.checkIns,prior);
});

test('incorrect six-digit attempts are limited per organiser and event minute; successful entries do not consume guesses',()=>{
  const e=fixture(),ticket=issueTicket(e,2,now);e.cohost={id:3,name:'Co-host'};
  const incorrect=ticket.code==='000000'?'000001':'000000';
  for(let i=0;i<12;i++)assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,true);
  assert.equal(e.ticketCheckAttempts,undefined);
  for(let i=0;i<10;i++)assert.equal(verifyTicket(e,1,incorrect,false,now).valid,false);
  assert.match(verifyTicket(e,1,ticket.code,false,now).reason,/Too many incorrect/);
  assert.equal(verifyTicket(e,3,ticket.code,false,now).valid,true);assert.equal(verifyTicket(e,1,qr(e),false,now).valid,true);
  const next=Date.parse(ticket.codeExpiresAt),refreshed=issueTicket(e,2,next);
  assert.equal(verifyTicket(e,1,refreshed.code,false,next).valid,true);
  assert.throws(()=>verifyTicket(e,4,incorrect,false,next));assert.equal(e.ticketCheckAttempts[4],undefined);
});

test('ticket bootstrap and administration projections never disclose private rotating-code state',()=>{
  const e=fixture();issueTicket(e,2,now);const state=e.guests[2].ticketCode;
  const own=publicEvent(e,2,'ExampleBot'),manager=publicEvent(e,1,'ExampleBot');
  assert.equal(own.ticket.code,undefined);assert.equal(own.ticket.name,'Alex');assert.equal(own.ticket.participants,4);
  for(const projection of [own,manager,adminOverview([{kind:'events',id:e.id,data:JSON.stringify(e)}])]){
    assert.doesNotMatch(JSON.stringify(projection),/ticketCode|issuedMinute|ticketCheckAttempts/);assert.equal(JSON.stringify(projection).includes(state.secret),false);
  }
});

test('minute calculations remain safe after 2038',()=>{
  const e=fixture(),future=Date.parse('2099-12-31T23:59:45Z'),ticket=issueTicket(e,2,future);
  assert.equal(ticket.codeExpiresAt,'2100-01-01T00:00:00.000Z');assert.equal(verifyTicket(e,1,ticket.code,false,future).valid,true);
  assert.equal(verifyTicket(e,1,ticket.code,false,Date.parse(ticket.codeExpiresAt)).valid,false);
});

test('finished events cannot issue apparently live check-in codes',()=>{
  const e=fixture();e.endsAt=new Date(now).toISOString();
  assert.throws(()=>issueTicket(e,2,now),/Event has finished/);assert.equal(e.guests[2].ticketCode,undefined);
  assert.ok(ensureTicket(e,2));
});

test('confirmed guests without issued tickets do not break another guest code request or verification',()=>{
  const e=fixture();e.guests[3]={name:'Sam',status:'yes',approval:'approved'};e.guests[4]={name:'Taylor',status:'yes',approval:'approved',ticket:undefined};
  const ticket=issueTicket(e,2,now);assert.match(ticket.code,/^\d{6}$/);assert.equal(verifyTicket(e,1,ticket.code,false,now).valid,true);
  assert.equal(e.guests[3].ticket,undefined);assert.equal(e.guests[3].ticketCode,undefined);assert.equal(e.guests[4].ticketCode,undefined);
});
