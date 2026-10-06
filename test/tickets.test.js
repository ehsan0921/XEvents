import test from 'node:test';
import assert from 'node:assert/strict';
import {issueTicket,verifyTicket} from '../src/tickets.js';

function fixture(){return {id:'0123456789abcdef',owner:1,title:'Club match',askParticipantCount:true,requireApproval:true,guests:{2:{name:'Alex',status:'yes',approval:'approved',participants:4}},media:[]};}
test('QR tickets are private, stable and verify against current approval/payment state',()=>{
  const e=fixture(),ticket=issueTicket(e,2);
  assert.match(ticket.code,/^[A-F0-9]{12}$/);assert.match(ticket.image,/^data:image\/gif;base64,/);
  assert.equal(issueTicket(e,2).code,ticket.code);assert.equal(ticket.participants,4);
  assert.throws(()=>issueTicket(e,3));assert.throws(()=>issueTicket(e,1));assert.throws(()=>verifyTicket(e,2,ticket.code));
  const checked=verifyTicket(e,1,`XE1:${e.id}:${ticket.code}`);assert.equal(checked.valid,true);assert.equal(checked.name,'Alex');assert.equal(checked.checkedInAt,null);assert.equal(e.checkIns,undefined);
  assert.equal(verifyTicket(e,1,'XE1:ffffffffffffffff:'+ticket.code).valid,false);
  assert.equal(verifyTicket(e,1,'not-a-ticket').valid,false);
  e.guests[2].approval='pending';assert.equal(verifyTicket(e,1,ticket.code).valid,false);assert.throws(()=>issueTicket(e,2));
  e.guests[2].approval='approved';e.starPrice=100;e.paymentMethod='stars';assert.equal(verifyTicket(e,1,ticket.code).valid,false);
  e.guests[2].payment={status:'paid'};assert.equal(verifyTicket(e,1,ticket.code).valid,true);
  e.guests[2].payment.status='refund_pending';assert.equal(verifyTicket(e,1,ticket.code).valid,false);
});
test('check-in is idempotent and old, cancelled, finished or declined tickets fail',()=>{
  const e=fixture(),ticket=issueTicket(e,2),now=Date.parse('2030-10-24T08:00:00Z');
  const first=verifyTicket(e,1,ticket.code.toLowerCase(),true,now);assert.equal(first.alreadyCheckedIn,false);assert.ok(first.checkedInAt);
  const second=verifyTicket(e,1,ticket.code,true,now+1000);assert.equal(second.alreadyCheckedIn,true);assert.equal(second.checkedInAt,first.checkedInAt);assert.equal(Object.keys(e.checkIns).length,1);
  e.cancelled=true;assert.equal(verifyTicket(e,1,ticket.code,true,now).valid,false);
  e.cancelled=false;e.endsAt=new Date(now).toISOString();assert.equal(verifyTicket(e,1,ticket.code,true,now).valid,false);
  delete e.endsAt;e.guests[2].status='no';assert.equal(verifyTicket(e,1,ticket.code).valid,false);
  e.guests[2].status='yes';e.guests[2].ticket='A'.repeat(12);assert.equal(verifyTicket(e,1,ticket.code).valid,false);
  assert.equal(verifyTicket(e,1,e.guests[2].ticket).alreadyCheckedIn,false);
});
