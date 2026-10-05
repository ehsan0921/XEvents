import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEventPayment} from '../src/event-payment.js';
import {manualReport,manualConfirm} from '../src/manual-payment.js';
import {confirmed,canSeeLocation} from '../src/permissions.js';
import {publicEvent} from '../src/mini-api.js';

test('manual prices preserve text and external payment URLs require HTTPS without credentials',()=>{
  const input={paymentMethod:'bank',displayPrice:'Members $10 / guests £15',paymentInstructions:'Use your booking name as reference',paymentTerms:'Contact the organiser for refunds'};
  assert.equal(parseEventPayment(input).displayPrice,input.displayPrice);
  for(const paymentUrl of ['javascript:alert(1)','http://example.com','https://user:pass@example.com'])assert.throws(()=>parseEventPayment({...input,paymentMethod:'link',paymentUrl}));
  assert.equal(parseEventPayment({...input,paymentMethod:'link',paymentUrl:'https://example.com/pay'}).paymentUrl,'https://example.com/pay');
  assert.equal(parseEventPayment({paymentMethod:'stars',starPrice:20,starPricing:'group',paymentTerms:'Refund on cancellation'}, {},true).starPrice,20);
});

test('reporting manual payment cannot unlock a ticket; only the organiser can confirm or clear it',async()=>{
  const e={id:'0123456789abcdef',owner:1,title:'Club match',paymentMethod:'bank',displayPrice:'$20 AUD',paymentInstructions:'Private bank details',requireApproval:true,hideLocation:true,location:'Private venue',guests:{2:{name:'Guest',status:'yes',approval:'pending'}}};
  const bot={db:{preferences:{}},send:async()=>{},ticket:async()=>{}};
  await manualReport(bot,2,e);assert.equal(e.guests[2].payment,undefined);
  assert.equal(publicEvent(e,2,'ExampleBot').paymentInstructions,undefined);
  e.guests[2].approval='approved';await manualReport(bot,2,e);
  assert.equal(e.guests[2].payment.status,'reported');assert.equal(confirmed(e,e.guests[2]),false);assert.equal(canSeeLocation(e,2),false);
  await manualConfirm(bot,3,e,2);assert.equal(e.guests[2].payment.status,'reported');
  await manualConfirm(bot,1,e,2);assert.equal(confirmed(e,e.guests[2]),true);assert.equal(canSeeLocation(e,2),true);
  const record=bot.db.preferences[2].manualPayments[e.guests[2].payment.record];assert.equal(record.status,'paid');
  await manualConfirm(bot,1,e,2,true);assert.equal(confirmed(e,e.guests[2]),false);assert.equal(e.guests[2].ticket,undefined);assert.equal(record.status,'voided');
});
