import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot } from '../src/bot.js';
import { Store } from '../src/store.js';
import { sendDueReminders, setReminder, eventGroup, applyDefaultReminder } from '../src/reminders.js';
import { responseCounts, participantCount } from '../src/permissions.js';
import { invoice, checkout, successful, refundResult } from '../src/payments.js';
import { confirmed, canSeeLocation } from '../src/permissions.js';

function fixture() {
  const store = { data: { events: {}, sessions: {}, offset: 0 } };
  const calls = [];
  const bot = new Bot(store, async (method, params) => { calls.push({ method, ...params }); return {}; }, 'XEvents_bot');
  const msg = (id, text, extra = {}) => bot.handle({ message: { chat: { id, type: 'private' }, from: { id, first_name: `User ${id}` }, text, ...extra } });
  const cb = (id, data) => bot.handle({ callback_query: { id: 'query', from: { id, first_name: `User ${id}` }, data } });
  async function create(settings = { guestList: true, uploadMedia: true, viewMedia: true }) {
    for (const text of ['/new', 'Birthday', '24 October 2026, 6pm Sydney', 'My house', 'Bring a friend', 'Dietary needs?\nWhat will you bring?']) await msg(1, text);
    const token = store.data.sessions[1].token;
    for (const [key, enabled] of Object.entries(settings)) if (enabled) await cb(1, `pc:${token}:${key}`);
    await cb(1, `pd:${token}`);
    const event=Object.values(store.data.events).at(-1);event.invitationMode='legacy';return event;
  }
  return { store, bot, calls, msg, cb, create };
}

test('Stars admission requires approval, binds payer and amount, confirms only after payment and supports refunds', async () => {
  const f=fixture(), e=await f.create({requireApproval:true,askParticipantCount:true});
  Object.assign(e,{starPrice:25,starPricing:'person',paymentTerms:'Online workshop. Full refund on cancellation.'});
  e.guests[2]={name:'Buyer',status:'yes',approval:'pending',participants:3};
  await invoice(f.bot,2,e,true);
  assert.equal(f.calls.some(c=>c.method==='sendInvoice'),false);
  await f.cb(1,`approve:${e.id}:2`);
  assert.equal(e.guests[2].approval,'approved'); assert.equal(confirmed(e,e.guests[2]),false);
  assert.equal(canSeeLocation(e,2),false); assert.equal(e.guests[2].ticket,undefined);
  await f.cb(2,`star-pay:${e.id}`);
  const bill=f.calls.find(c=>c.method==='sendInvoice');assert.equal(bill.currency,'XTR');assert.equal(bill.prices[0].amount,75);
  const q={id:'checkout',from:{id:2},currency:'XTR',total_amount:75,invoice_payload:bill.payload};
  assert.equal(checkout(f.bot,{...q,from:{id:3}}).ok,false);
  assert.equal(checkout(f.bot,{...q,total_amount:25}).ok,false);
  assert.equal(checkout(f.bot,{...q,currency:'USD'}).ok,false);
  assert.equal(checkout(f.bot,q).ok,true);assert.equal(checkout(f.bot,q).ok,true);
  assert.equal(checkout(f.bot,{...q,id:'duplicate-checkout'}).ok,false);
  assert.equal(confirmed(e,e.guests[2]),false);
  const paid={from:{id:2},successful_payment:{currency:'XTR',total_amount:75,invoice_payload:bill.payload,telegram_payment_charge_id:'test-charge'}};
  await successful(f.bot,paid);assert.equal(confirmed(e,e.guests[2]),true);assert.equal(canSeeLocation(e,2),true);
  assert.ok(e.guests[2].ticket);assert.equal(responseCounts(e).participants,3);
  const count=f.calls.length;await successful(f.bot,paid);assert.equal(f.calls.length,count);
  await f.cb(2,`r:${e.id}:no`);assert.equal(e.guests[2].status,'yes');
  await f.cb(3,`src:2:${bill.payload}`);assert.equal(e.guests[2].payment.status,'paid');
  await f.cb(1,`src:2:${bill.payload}`);assert.equal(e.guests[2].payment.status,'refund_pending');
  assert.ok(f.calls.some(c=>c.method==='refundStarPayment' && c.telegram_payment_charge_id==='test-charge'));
  await refundResult(f.bot,2,'test-charge',false);assert.equal(e.guests[2].payment.status,'refund_failed');
  await f.cb(1,`src:2:${bill.payload}`);await refundResult(f.bot,2,'test-charge',true);
  assert.equal(e.guests[2].status,'no');assert.equal(e.guests[2].payment.status,'refunded');assert.equal(e.guests[2].ticket,undefined);
});

test('Stars refunds survive event deletion and late payment never unlocks a changed event', async()=>{
  const f=fixture(),e=await f.create({});Object.assign(e,{starPrice:10,starPricing:'group',paymentTerms:'Digital admission'});
  e.guests[2]={status:'yes',approval:'approved',name:'Buyer'};
  await invoice(f.bot,2,e,true);const bill=f.calls.find(c=>c.method==='sendInvoice');
  e.cancelled=true;
  assert.equal(checkout(f.bot,{id:'q',from:{id:2},currency:'XTR',total_amount:10,invoice_payload:bill.payload}).ok,false);
  delete f.store.data.events[e.id];
  await successful(f.bot,{from:{id:2},successful_payment:{currency:'XTR',total_amount:10,invoice_payload:bill.payload,telegram_payment_charge_id:'late-charge'}});
  const order=f.store.data.preferences[2].starOrders[bill.payload];assert.equal(order.status,'refund_pending');
  await refundResult(f.bot,2,'late-charge',true);assert.equal(order.status,'refunded');
});

test('optional group size validates whole numbers and separates people from responses and approval', async () => {
  const f = fixture(); const e = await f.create({askParticipantCount:true, requireApproval:true});
  assert.equal(e.askParticipantCount,true);
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `r:${e.id}:yes`); await f.msg(2,'Group organiser');
  assert.equal(f.store.data.sessions[2].step,'participants');
  for (const value of ['0','-1','1.5','10001','abc','/skip']) {
    await f.msg(2,value);
    assert.equal(f.store.data.sessions[2].step,'participants');
    assert.equal(e.guests[2].status,'later');
  }
  await f.msg(2,'3'); await f.msg(2,'/skip'); await f.msg(2,'/skip'); await f.msg(2,'/skip'); await f.msg(2,'/skip');
  assert.equal(e.guests[2].participants,3);
  assert.equal(responseCounts(e).participants,0);
  assert.equal(responseCounts(e).pendingParticipants,3);
  await f.cb(1,`approve:${e.id}:2`);
  assert.equal(responseCounts(e).yes,1);
  assert.equal(responseCounts(e).participants,3);
  assert.equal(responseCounts(e).pendingParticipants,0);
  await f.cb(2,`r:${e.id}:no`); await f.msg(2,'/skip');
  assert.equal(responseCounts(e).participants,0);
  await f.cb(1,`toggle:${e.id}:askParticipantCount`);
  assert.equal(e.askParticipantCount,false);
  await f.cb(2,`r:${e.id}:yes`); await f.msg(2,'Solo guest');
  assert.equal(f.store.data.sessions[2].step,'phone');
  assert.equal(f.store.data.sessions[2].response.participants,1);
  assert.equal(participantCount({}, {participants:9}),1);
  assert.equal(participantCount({askParticipantCount:true}, {}),1);
});

test('create, invite, accept, custom name, private phone/questions, comment, change response', async () => {
  const f = fixture(); const e = await f.create();
  assert.match(f.bot.link(e), /^https:\/\/t.me\/XEvents_bot\?start=e_[a-f0-9]{16}$/);
  await f.msg(2, `/start e_${e.id}`);
  assert.equal(e.guests[2].status, 'later');
  await f.cb(2, `r:${e.id}:yes`);
  await f.msg(2, 'Party guest'); await f.msg(2, '+61412345678');
  await f.msg(2, 'Vegetarian'); await f.msg(2, 'Cake'); await f.msg(2, 'Looking forward to it');
  assert.equal(e.guests[2].status, 'yes'); assert.equal(e.guests[2].name, 'Party guest');
  assert.equal(e.guests[2].answers[1].answer, 'Cake');
  f.calls.length = 0; await f.cb(2, `g:${e.id}`);
  const publicText = f.calls.map(c => c.text || '').join('\n');
  assert.match(publicText, /Party guest/); assert.match(publicText, /Looking forward/);
  assert.doesNotMatch(publicText, /61412345678|Vegetarian|Cake/);
  f.calls.length = 0; await f.cb(2, `a:${e.id}`);
  assert.doesNotMatch(f.calls.map(c => c.text || '').join(''), /61412345678/);
  await f.cb(1, `a:${e.id}`); assert.match(f.calls.at(-1).text, /61412345678/);
  await f.cb(2, `r:${e.id}:no`); await f.msg(2, 'Cannot make it');
  assert.equal(e.guests[2].status, 'no');
  for (const status of ['maybe', 'later']) {
    await f.cb(2, `r:${e.id}:${status}`); await f.msg(2, '/skip');
    assert.equal(e.guests[2].status, status);
  }
});

test('media membership, retrieval, organiser removal, and cancellation', async () => {
  const f = fixture(); const e = await f.create();
  await f.cb(99, `u:${e.id}`); assert.equal(f.store.data.sessions[99], undefined);
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `u:${e.id}`);
  await f.msg(2, undefined, { photo: [{ file_id: 'small' }, { file_id: 'large' }], caption: 'Our group' });
  await f.msg(2, undefined, { video: { file_id: 'video' } });
  await f.msg(2, undefined, { document: { file_id: 'file', file_name: 'plan.pdf' } });
  assert.equal(e.media.length, 3); await f.msg(2, '/done');
  await f.cb(2, `m:${e.id}:0`); assert.ok(f.calls.some(c => c.method === 'sendPhoto' && c.photo === 'large'));
  const mediaId = e.media[0].id; await f.cb(2, `remove:${e.id}:${mediaId}`); assert.equal(e.media.length, 3);
  await f.cb(1, `remove:${e.id}:${mediaId}`); assert.equal(e.media.length, 2);
  await f.cb(2, `z:${e.id}`); assert.equal(e.cancelled, false);
  await f.cb(1, `z:${e.id}`); assert.equal(e.cancelled, true);
  await f.cb(2, `r:${e.id}:yes`); assert.equal(f.store.data.sessions[2], undefined);
});

test('foreign contacts rejected, abandoned RSVP does not change saved response, link rotation', async () => {
  const f = fixture(); const e = await f.create();
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `r:${e.id}:yes`); await f.msg(2, '/skip');
  await f.msg(2, undefined, { contact: { user_id: 3, phone_number: '12345678' } });
  assert.equal(f.store.data.sessions[2].step, 'phone');
  await f.msg(2, '/cancel'); assert.equal(e.guests[2].status, 'later');
  const old = e.id; await f.cb(1, `rotate:${old}`);
  assert.equal(f.store.data.events[old], undefined); assert.notEqual(e.id, old);
  await f.msg(3, `/start e_${old}`); assert.equal(e.guests[3], undefined);
  await f.cb(2, `v:${e.id}`); assert.match(f.calls.at(-1).text, /Birthday/);
});

test('event data, conversations, and polling offset survive a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xevents-'));
  try {
    const store = await new Store(dir).load();
    store.data.events.example = { title: 'Saved event' }; store.data.sessions[2] = { step: 'phone' }; store.data.offset = 42;
    await store.save();
    const loaded = await new Store(dir).load(); assert.deepEqual(loaded.data, store.data);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('button menus complete event creation and ticket booking without typed commands', async () => {
  const f = fixture();
  await f.msg(1, '/start');
  assert.equal(f.calls.at(-1).reply_markup.keyboard[0][0].text, '📱 Open app');
  await f.msg(1, '🎉 Create event');
  for (const text of ['Button party', 'Saturday, Sydney', 'Park', '⏭ Skip', '⏭ Skip']) await f.msg(1, text);
  const token = f.store.data.sessions[1].token;
  await f.cb(1, `pc:${token}:uploadMedia`); await f.cb(1, `pd:${token}`);
  const e = Object.values(f.store.data.events)[0];
  assert.equal(e.description, ''); assert.deepEqual(e.questions, []);
  const invite = f.calls.at(-1).reply_markup.inline_keyboard.flat().find(b => b.url);
  assert.equal(new URL(invite.url).searchParams.get('url'), f.bot.link(e));
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `book:${e.id}`);
  await f.msg(2, '👤 Use Telegram name');
  assert.ok(f.calls.at(-1).reply_markup.keyboard.flat().some(b => b.request_contact));
  await f.msg(2, '⏭ Skip'); await f.msg(2, '⏭ Skip');
  assert.equal(e.guests[2].status, 'yes'); assert.equal(e.guests[2].name, 'User 2');
  await f.cb(2, `u:${e.id}`); await f.msg(2, undefined, { document: { file_id: 'test' } });
  await f.msg(2, '✅ Finish uploads'); assert.equal(f.store.data.sessions[2], undefined);
  await f.msg(2, '📅 My events'); assert.match(f.calls.at(-1).text, /Button party/);
  await f.cb(2, 'nav:home'); assert.equal(f.calls.at(-1).reply_markup.keyboard[0][0].text, '📱 Open app');
  await f.msg(2, '🎉 Create event'); await f.msg(2, '✖️ Cancel input');
  assert.equal(f.store.data.sessions[2], undefined); assert.equal(Object.keys(f.store.data.events).length, 1);
});

test('organiser does not RSVP and guest extras are opt-in with backend enforcement', async () => {
  const f = fixture(); const e = await f.create({});
  await f.cb(1, `v:${e.id}`);
  assert.ok(!f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b => b.callback_data?.startsWith('r:')));
  await f.cb(1, `r:${e.id}:yes`); assert.equal(e.guests[1], undefined); assert.equal(f.store.data.sessions[1], undefined);
  await f.msg(2, `/start e_${e.id}`);
  const actions = f.calls.at(-1).reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  assert.deepEqual(actions.filter(x => x?.startsWith('r:')).length, 4);
  for (const prefix of ['g:', 'u:', 'm:', 'c:']) assert.ok(!actions.some(x => x?.startsWith(prefix)));
  for (const action of ['g', 'u', 'm']) {
    await f.cb(2, `${action}:${e.id}`); assert.match(f.calls.at(-1).text, /not enabled/);
  }
  await f.cb(2, `toggle:${e.id}:guestList`); assert.equal(e.permissions.guestList, false);
  await f.cb(1, `toggle:${e.id}:uploadMedia`); await f.cb(2, `u:${e.id}`);
  assert.equal(f.store.data.sessions[2].step, 'upload');
  await f.cb(1, `toggle:${e.id}:uploadMedia`);
  await f.msg(2, undefined, { document: { file_id: 'blocked' } }); assert.equal(e.media.length, 0);
  await f.cb(1, `g:${e.id}`); assert.match(f.calls.at(-1).text, /Guest|User 2/);
});

test('Later immediately lists pending invitations and responded events leave that list', async () => {
  const f = fixture(); const first = await f.create({}); const second = await f.create({});
  await f.msg(2, `/start e_${first.id}`); await f.msg(2, `/start e_${second.id}`);
  await f.cb(2, `r:${first.id}:later`);
  assert.equal(f.store.data.sessions[2], undefined);
  const listed = f.calls.slice(-2).map(c => c.reply_markup?.inline_keyboard?.flat()[0]?.callback_data);
  assert.deepEqual(listed.sort(), [`v:${first.id}`, `v:${second.id}`].sort());
  await f.cb(2, `r:${first.id}:no`); await f.msg(2, '⏭ Skip');
  f.calls.length = 0; await f.msg(2, '⏳ Pending invitations');
  assert.equal(f.calls.filter(c => c.reply_markup?.inline_keyboard).length, 1);
  assert.equal(f.calls.at(-1).reply_markup.inline_keyboard[0][0].callback_data, `v:${second.id}`);
});

test('approval gates location/tickets and only the organiser can approve or reject', async () => {
  const f = fixture(); const e = await f.create({ requireApproval: true }); e.ticketInfo = 'Private entry instructions';
  await f.msg(2, `/start e_${e.id}`); assert.doesNotMatch(f.calls.at(-1).text, /My house|Private entry instructions/);
  await f.cb(2, `r:${e.id}:yes`);
  for (const text of ['👤 Use Telegram name', '⏭ Skip', '⏭ Skip', '⏭ Skip', '⏭ Skip']) await f.msg(2, text);
  assert.equal(e.guests[2].approval, 'pending'); assert.equal(e.guests[2].ticket, undefined);
  assert.ok(f.calls.some(c => /organiser will send/.test(c.text || '')));
  assert.doesNotMatch(f.calls.at(-1).text, /My house|Private entry instructions/);
  await f.cb(2, `approve:${e.id}:2`); assert.equal(e.guests[2].approval, 'pending');
  await f.cb(2, `ticket:${e.id}`); assert.doesNotMatch(f.calls.at(-1).text, /My house|Private entry instructions/);
  await f.cb(1, `approve:${e.id}:2`); assert.equal(e.guests[2].approval, 'approved'); assert.ok(e.guests[2].ticket);
  const ticket = f.calls.find(c => c.chat_id === 2 && c.text?.includes('YOUR INVITATION'));
  assert.match(ticket.text, /My house/); assert.match(ticket.text, /Private entry instructions/);
  await f.cb(2, `r:${e.id}:yes`);
  for (const text of ['👤 Use Telegram name', '⏭ Skip', '⏭ Skip', '⏭ Skip', '⏭ Skip']) await f.msg(2, text);
  await f.cb(1, `reject:${e.id}:2`); assert.equal(e.guests[2].status, 'no'); assert.equal(e.guests[2].ticket, undefined);
});

test('deadline blocks old RSVP buttons and unfinished responses but permits approval', async () => {
  const f = fixture(); const e = await f.create({ requireApproval: true });
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `r:${e.id}:yes`); await f.msg(2, 'Guest');
  e.responseDeadline = '2020-01-01T00:00:00Z';
  await f.msg(2, '⏭ Skip'); assert.equal(f.store.data.sessions[2], undefined); assert.equal(e.guests[2].status, 'later');
  await f.cb(2, `r:${e.id}:yes`); assert.equal(e.guests[2].status, 'later');
  assert.ok(!f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b => b.callback_data?.startsWith('r:')));
  e.guests[2] = { name: 'Guest', status: 'yes', approval: 'pending', answers: [] };
  await f.cb(1, `approve:${e.id}:2`); assert.equal(e.guests[2].approval, 'approved');
});

test('answering again replaces old answers and navigation discards unfinished input', async () => {
  const f = fixture(); const e = await f.create(); await f.msg(2, `/start e_${e.id}`);
  for (const answer of ['Old answer', 'New answer']) {
    await f.cb(2, `r:${e.id}:yes`);
    for (const text of ['👤 Use Telegram name', '⏭ Skip', answer, '⏭ Skip', '⏭ Skip']) await f.msg(2, text);
  }
  assert.equal(e.guests[2].answers.length, 2); assert.equal(e.guests[2].answers[0].answer, 'New answer');
  await f.cb(2, `r:${e.id}:no`); await f.cb(2, `v:${e.id}`);
  assert.equal(f.store.data.sessions[2], undefined); assert.equal(e.guests[2].status, 'yes');
});

test('accepted view uses change response and approval-only status with enabled extras', async () => {
  const f = fixture(); const e = await f.create({ guestList: true, viewMedia: true });
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `r:${e.id}:yes`);
  for (const text of ['Guest','/skip','/skip','/skip','/skip']) await f.msg(2,text);
  let buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  assert.match(f.calls.at(-1).text,/✅ Accepted/);
  assert.ok(buttons.some(b=>b.callback_data===`change:${e.id}`));
  assert.ok(!buttons.some(b=>b.callback_data?.startsWith('r:') || b.callback_data?.startsWith('status:') || b.callback_data?.startsWith('ticket:') || b.callback_data?.startsWith('u:')));
  assert.ok(buttons.some(b=>b.callback_data===`g:${e.id}`));
  await f.cb(2,`change:${e.id}`); assert.equal(f.calls.at(-1).reply_markup.inline_keyboard.flat().filter(b=>b.callback_data.startsWith('r:')).length,4);
  assert.equal(e.guests[2].status,'yes');
  e.requireApproval=true; e.hideLocation=true; e.guests[2].approval='pending';
  await f.bot.card(2,e); buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b=>b.callback_data===`status:${e.id}`));
  assert.ok(!buttons.some(b=>b.copy_text));
  await f.cb(2,`status:${e.id}`); assert.match(f.calls.at(-1).text,/Awaiting organiser approval/);
  await f.cb(2,`address:${e.id}`); assert.doesNotMatch(f.calls.at(-1).text,/My house/);
});

test('banners persist from creation, are owner-controlled, and addresses are copyable', async () => {
  const f=fixture();
  for(const text of ['/new','Banner party','Saturday','My house','/skip','/skip']) await f.msg(1,text);
  const token=f.store.data.sessions[1].token;
  await f.cb(1,`pb:${token}`); await f.msg(1,undefined,{photo:[{file_id:'banner-small'},{file_id:'banner-large'}]});
  await f.cb(1,`pd:${token}`); const e=Object.values(f.store.data.events)[0];
  assert.equal(e.banner,'banner-large'); assert.ok(f.calls.some(c=>c.method==='sendPhoto' && c.photo==='banner-large'));
  await f.msg(2,`/start e_${e.id}`); await f.cb(2,`banner:${e.id}`); assert.equal(f.store.data.sessions[2],undefined);
  await f.bot.card(2,e); const card=f.calls.at(-1);
  assert.equal(card.reply_markup.inline_keyboard.flat().find(b=>b.copy_text).copy_text.text,'My house');
  assert.equal(card.method,'sendPhoto');
  const entity=card.caption_entities[0]; assert.equal(card.caption.slice(entity.offset,entity.offset+entity.length),'My house');
  e.location='A'.repeat(300); await f.bot.card(2,e);
  assert.ok(f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`address:${e.id}`));
  await f.cb(2,`address:${e.id}`); assert.equal(f.calls.at(-1).entities[0].length,300);
});

test('reminders are personal, sent once, rescheduled, and suppressed for cancelled/declined events', async () => {
  const f=fixture(); const e=await f.create({}); e.startsAt='2099-10-24T07:00:00Z'; e.timezone='Australia/Sydney';
  await f.msg(2,`/start e_${e.id}`); await f.cb(2,`remind:${e.id}:60`);
  assert.equal(e.reminders[2].minutes,60); assert.equal(e.reminders[1],undefined);
  await f.cb(99,`remind:${e.id}:60`); assert.equal(e.reminders[99],undefined);
  const start=Date.parse(e.startsAt); f.calls.length=0;
  await sendDueReminders(f.store.data,f.bot,start-3600001); assert.equal(f.calls.length,0);
  await sendDueReminders(f.store.data,f.bot,start-3600000); assert.equal(f.calls.length,1);
  assert.doesNotMatch(f.calls[0].text,/My house/);
  await sendDueReminders(f.store.data,f.bot,start-1000); assert.equal(f.calls.length,1);
  e.startsAt='2099-10-25T07:00:00Z'; await sendDueReminders(f.store.data,f.bot,Date.parse(e.startsAt)-1000); assert.equal(f.calls.length,2);
  e.reminders[2].sentFor=null; e.cancelled=true; await sendDueReminders(f.store.data,f.bot,Date.parse(e.startsAt)-1000); assert.equal(f.calls.length,2);
  e.cancelled=false; e.guests[2].status='no'; await sendDueReminders(f.store.data,f.bot,Date.parse(e.startsAt)-1000); assert.equal(f.calls.length,2);
  assert.throws(()=>setReminder(e,2,60,Date.parse(e.startsAt)-1000),/already passed/);
  assert.equal(eventGroup(e,start),'Upcoming events'); assert.equal(eventGroup(e,Date.parse(e.startsAt)+1),'Past events');
  setReminder(e,2,0); assert.equal(e.reminders[2],undefined);
});

test('creator cancel/delete notify only accepted and tentative guests and delete clears conversations',async()=>{
  const f=fixture(); const e=await f.create({});
  for(const [id,status] of [[2,'yes'],[3,'maybe'],[4,'no'],[5,'later']]) e.guests[id]={name:'Guest',status};
  f.store.data.sessions[2]={event:e.id,step:'upload'};
  f.calls.length=0; await f.cb(2,`delete-confirm:${e.id}`); assert.ok(f.store.data.events[e.id]);
  f.calls.length=0; await f.cb(1,`z:${e.id}`);
  assert.equal(e.cancelled,true); assert.equal(f.store.data.sessions[2],undefined);
  assert.deepEqual(f.calls.filter(c=>c.chat_id!==1 && c.text?.includes('cancelled by')).map(c=>c.chat_id),[2,3]);
  f.calls.length=0; await f.cb(1,`delete-confirm:${e.id}`);
  assert.equal(f.store.data.events[e.id],undefined);
  assert.deepEqual(f.calls.filter(c=>c.chat_id!==1 && c.text?.includes('deleted by')).map(c=>c.chat_id),[2,3]);
});
test('accepted guests receive organiser defaults with 2/3/4-hour options and personal overrides',async()=>{
  const f=fixture(); const e=await f.create({}); e.startsAt='2099-10-24T07:00:00Z'; e.defaultReminder=180; e.questions=[];
  await f.msg(2,`/start e_${e.id}`); await f.cb(2,`r:${e.id}:yes`);
  for(const text of ['Guest','/skip','/skip']) await f.msg(2,text);
  assert.equal(e.reminders[2].minutes,180); assert.equal(e.reminders[2].source,'default');
  await f.cb(2,`remind:${e.id}:240`); e.defaultReminder=120; applyDefaultReminder(e,2); assert.equal(e.reminders[2].minutes,240);
  await f.cb(2,`remind:${e.id}:0`); applyDefaultReminder(e,2); assert.equal(e.reminders[2],undefined);
  applyDefaultReminder(e,3); assert.equal(e.reminders[3].minutes,120);
  await f.cb(2,`reminder:${e.id}`); const buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  for(const n of [120,180,240]) assert.ok(buttons.some(b=>b.callback_data===`remind:${e.id}:${n}`));
});

test('invites and multi-file uploads avoid extra replies; upload links never add guests',async()=>{
  const f=fixture(); const e=await f.create({uploadMedia:true,allowLinkUploads:true});
  f.calls.length=0;await f.msg(2,`/start e_${e.id}`);
  assert.ok(!f.calls.some(c=>c.text==='Use the invitation buttons below.'));
  await f.cb(2,`u:${e.id}`);f.calls.length=0;
  for(let i=0;i<3;i++)await f.msg(2,undefined,{photo:[{file_id:'photo'+i}],media_group_id:'album'});
  assert.equal(e.media.length,3);assert.equal(f.calls.length,0);
  await f.msg(2,'/done');assert.ok(f.calls.some(c=>c.text?.includes('3 saved')));
  await f.msg(99,`/start u_${e.uploadToken}`); assert.equal(e.guests[99],undefined);
  await f.cb(99,`media-add:${e.id}`);
  f.calls.length=0;await f.msg(99,undefined,{document:{file_id:'document',file_name:'plan.pdf'}});
  assert.equal(e.media.length,4);assert.equal(f.calls.length,0);assert.equal(e.guests[99],undefined);
  e.allowLinkUploads=false;await f.msg(99,undefined,{photo:[{file_id:'blocked'}]});assert.equal(e.media.length,4);
});

test('long banner invitations remain one bounded photo caption with full details available',async()=>{
  const f=fixture();const e=await f.create({});e.banner='banner';e.description='Long description '.repeat(90);
  f.calls.length=0;await f.msg(2,`/start e_${e.id}`);
  const cards=f.calls.filter(c=>c.method==='sendPhoto' || c.method==='sendMessage');assert.equal(cards.length,1);
  assert.ok(cards[0].caption.length<=1024);assert.ok(cards[0].reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`details:${e.id}`));
  await f.cb(2,`details:${e.id}`);assert.match(f.calls.at(-1).text,/Long description/);
});

test('media links show only banner/title and media actions without RSVP and revoke outsider access',async()=>{
  const f=fixture();f.bot.appUrl='https://test/app';const e=await f.create({uploadMedia:true,viewMedia:true,allowLinkUploads:true});e.banner='banner';e.location='PRIVATE ADDRESS';
  f.calls.length=0;await f.msg(99,`/start u_${e.uploadToken}`);
  let card=f.calls.at(-1);assert.equal(card.caption,e.title);assert.equal(card.method,'sendPhoto');assert.equal(e.guests[99],undefined);
  const buttons=card.reply_markup.inline_keyboard.flat();assert.equal(buttons.length,3);
  assert.ok(buttons.some(b=>b.callback_data===`media-add:${e.id}`));
  assert.ok(buttons.some(b=>b.text==='🗂 Shared media' && b.web_app));
  assert.ok(!buttons.some(b=>b.callback_data?.startsWith('r:')));
  assert.equal(f.bot.mediaAllowed(e,99),true);await f.cb(99,`media-add:${e.id}`);await f.msg(99,undefined,{photo:[{file_id:'one'}]});await f.msg(99,'/done');
  assert.equal(f.calls.at(-1).caption,e.title);assert.doesNotMatch(f.calls.at(-1).caption,/PRIVATE/);
  await f.cb(1,`toggle:${e.id}:allowLinkUploads`);assert.equal(f.bot.mediaAllowed(e,99),false);
});
