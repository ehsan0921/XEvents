import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDueReminders} from '../src/reminders.js';

test('default reminders wait for approval and payment and send once after confirmation',async()=>{
  const now=Date.parse('2030-10-24T06:00:00Z'),sent=[];
  const e={id:'event',title:'Club event',startsAt:new Date(now+60000).toISOString(),requireApproval:true,starPrice:100,paymentMethod:'stars',guests:{2:{status:'yes',approval:'pending',payment:{status:'unpaid'}}},reminders:{2:{minutes:120,source:'default'}}};
  const bot={allowed:()=>true,time:()=>'',send:async id=>sent.push(id)};
  const data={events:{event:e}};
  await sendDueReminders(data,bot,now);assert.deepEqual(sent,[]);
  e.guests[2].approval='approved';await sendDueReminders(data,bot,now);assert.deepEqual(sent,[]);
  e.guests[2].payment.status='paid';await sendDueReminders(data,bot,now);assert.deepEqual(sent,[2]);
  await sendDueReminders(data,bot,now);assert.deepEqual(sent,[2]);
});
