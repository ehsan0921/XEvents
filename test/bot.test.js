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
    for (const text of ['/new', 'Birthday', '24 October 2026, 6pm Sydney', 'My house', 'Bring a friend', 'Come celebrate with us!']) await msg(1, text);
    const token = store.data.sessions[1].token;
    for (const [key, enabled] of Object.entries(settings)) if (enabled) await cb(1, `pc:${token}:${key}`);
    await cb(1, `pd:${token}`);
    const event=Object.values(store.data.events).at(-1);event.invitationMode='legacy';event.askPhone=true;event.askComments=true;return event;
  }
  return { store, bot, calls, msg, cb, create };
}

test('event settings identify the event and response refresh loads current counts for managers only',async()=>{
  const f=fixture(),e=await f.create();
  await f.cb(1,`h:${e.id}`);
  let card=f.calls.at(-1);
  assert.match(card.text,/^Birthday\nEvent settings\n/);
  assert.ok(card.reply_markup.inline_keyboard.flat().some(b=>b.text==='↻ Refresh' && b.callback_data===`h:${e.id}`));
  await f.cb(1,`a:${e.id}`);
  card=f.calls.at(-1);
  const refresh=card.reply_markup.inline_keyboard.flat().find(b=>b.text==='↻ Refresh');
  assert.equal(refresh.callback_data,`a:${e.id}`);
  assert.match(card.text,/Accepted: 0 responses/);
  e.guests[2]={name:'Example guest',status:'yes',participants:2};
  await f.cb(1,refresh.callback_data);
  assert.match(f.calls.at(-1).text,/Accepted: 1 responses/);
  assert.match(f.calls.at(-1).text,/Example guest/);
  for(const action of ['a','h']){
    await f.cb(3,`${action}:${e.id}`);
    assert.doesNotMatch(f.calls.at(-1).text,/Example guest|Event settings/);
  }
});

test('opening an event sends the event card directly without a placeholder message',async()=>{
  const f=fixture(),e=await f.create();e.banner='fictional-banner';f.calls.length=0;
  await f.cb(1,`v:${e.id}`);
  assert.equal(f.calls.filter(call=>['sendMessage','sendPhoto'].includes(call.method)).length,1);
  assert.equal(f.calls.at(-1).method,'sendPhoto');
  assert.ok(f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`h:${e.id}`));
  assert.equal(f.calls.some(call=>call.text==='Use the event buttons below.'),false);
});

test('guest list keeps refresh while event card hides it and guest list refresh rechecks visibility',async()=>{
  const f=fixture(),e=await f.create();e.guests[2]={name:'Example attendee',status:'yes',participants:1};
  await f.cb(1,`v:${e.id}`);
  assert.ok(!f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text==='↻ Refresh'));
  await f.cb(1,`g:${e.id}`);
  const refresh=f.calls.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.text==='↻ Refresh');
  assert.equal(refresh.callback_data,`g:${e.id}`);
  e.guests[2].name='Updated attendee';await f.cb(1,refresh.callback_data);
  assert.match(f.calls.at(-1).text,/Updated attendee/);
  e.permissions.guestList=false;await f.cb(2,refresh.callback_data);
  assert.doesNotMatch(f.calls.at(-1).text,/Updated attendee/);
  assert.match(f.calls.at(-1).text,/not enabled/);
});

test('guest list counts invitations, attendees and unanswered named links without merging later responses',async()=>{
  const f=fixture(),e=await f.create();
  e.invitationMode='named';e.oneTimeInvite=false;e.requireApproval=true;
  e.invitees={a:{name:'Accepted',participants:2},b:{name:'Rejected'},c:{name:'Tentative'},d:{name:'Later'},f:{name:'Opened'},g:{name:'Unopened'},h:{name:'Pending',participants:3}};
  e.guests={
    1:{name:'Host',status:'yes'},2:{name:'Accepted',status:'yes',approval:'approved',participants:2,invitationToken:'a'},
    3:{name:'Rejected',status:'no',invitationToken:'b'},4:{name:'Tentative',status:'maybe',invitationToken:'c'},
    5:{name:'Later',status:'later',responseRecorded:true,invitationToken:'d'},6:{name:'Opened',status:'later',invitationToken:'f'},
    7:{name:'Pending',status:'yes',approval:'pending',participants:3,invitationToken:'h'},
    8:{name:'Revoked',status:'yes',invitationToken:'removed'}
  };
  await f.cb(1,`g:${e.id}`);let text=f.calls.at(-1).text;
  assert.match(text,/Total invitations: 7\nPeople accepted: 5/);
  assert.match(text,/Accepted \(2\)/);assert.match(text,/Awaiting approval \(0\)/);
  for(const label of ['Rejected','Tentative','Respond later'])assert.ok(text.includes(label+' (1)'));
  assert.match(text,/Not responded \(2\)\n• Opened\n• Unopened/);assert.doesNotMatch(text,/Revoked|• Host/);
  e.guests[6]={...e.guests[6],status:'no',responseRecorded:true};await f.cb(1,`g:${e.id}`);
  text=f.calls.at(-1).text;assert.match(text,/Rejected \(2\)/);assert.match(text,/Not responded \(1\)/);
});

test('guest list keeps pending approvals and payments out of confirmed acceptance counts',async()=>{
  const f=fixture(),e=await f.create();e.requireApproval=true;e.starPrice=10;e.askParticipantCount=true;
  e.guests={2:{name:'Confirmed',status:'yes',approval:'approved',participants:2,payment:{status:'paid'}},3:{name:'Pending',status:'yes'},4:{name:'Unpaid',status:'yes',approval:'approved'}};
  await f.cb(1,`g:${e.id}`);const text=f.calls.at(-1).text;
  assert.match(text,/Total invitations: 3\nPeople accepted: 2/);
  for(const label of ['Accepted','Awaiting approval','Awaiting payment'])assert.ok(text.includes(label+' (1)'));
});

test('event card offers cancellation before optional deletion and keeps records by default',async()=>{
  const f=fixture(),e=await f.create();
  await f.cb(1,`v:${e.id}`);
  let buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b=>b.text==='Cancel event' && b.callback_data===`x:${e.id}`));
  assert.equal(buttons.some(b=>b.text==='Delete event'),false);
  await f.cb(1,`x:${e.id}`);
  assert.equal(e.cancelled,false);
  await f.cb(1,`z:${e.id}`);
  assert.equal(e.cancelled,true);
  assert.equal(f.store.data.events[e.id],e);
  buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b=>b.text==='Delete event' && b.callback_data===`delete:${e.id}`));
  assert.ok(buttons.some(b=>b.text==='Keep records' && b.callback_data===`v:${e.id}`));
  await f.cb(1,`delete:${e.id}`);
  assert.equal(f.store.data.events[e.id],e);
  await f.cb(1,`delete-confirm:${e.id}`);
  assert.equal(f.store.data.events[e.id],undefined);
});

test('refresh timestamps use the viewer timezone and remain visible on long banner cards',async(t)=>{
  const f=fixture(),e=await f.create();
  f.store.data.preferences[1]={timezone:'Australia/Sydney'};
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T00:00:00Z')});
  await f.cb(1,`g:${e.id}`);
  assert.match(f.calls.at(-1).text,/Last updated: 8 Oct 2026, 11:00:00 am AEDT/);
  t.mock.timers.tick(60000);
  await f.cb(1,`g:${e.id}`);
  assert.match(f.calls.at(-1).text,/Last updated: 8 Oct 2026, 11:01:00 am AEDT/);
  e.banner='fictional-banner';e.description='Long description '.repeat(150);
  await f.cb(1,`v:${e.id}`);
  assert.match(f.calls.at(-1).caption,/Last updated: 8 Oct 2026, 11:01:00 am AEDT/);
  assert.ok(f.calls.at(-1).caption.length<=1024);
  f.store.data.preferences[1].timezone='UTC';
  assert.match(f.bot.updatedAt(e,1),/8 Oct 2026, 12:01:00 am UTC/);
});

test('native App menu stays available without duplicate App buttons or stale keyboard launchers',async()=>{
  const f=fixture();f.bot.appUrl='https://example.test/app';
  await f.msg(1,'/start');
  const entries=f.calls.at(-1).reply_markup.keyboard.flat();
  assert.deepEqual(entries.map(item=>item.text),['🎉 Create event','📅 My events','❓ Help']);
  assert.equal(entries.some(item=>item.web_app || item.text==='App'),false);
  assert.ok(f.calls.some(c=>c.method==='setChatMenuButton' && c.menu_button.text==='App' && c.menu_button.web_app.url===f.bot.appUrl));
  for(const text of ['App','📱 Open app','📱 Open planner','/start app']){
    await f.msg(1,text);const response=f.calls.at(-1);
    assert.match(response.text,/built-in App button/);
    assert.equal(response.reply_markup.keyboard.flat().some(item=>item.text==='App' || item.web_app),false);
  }
  const event=await f.create();
  await f.bot.card(1,event);
  const buttons=f.calls.at(-1).reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some(item=>item.text==='App'),false);
  assert.ok(buttons.some(item=>item.text==='🗂 Shared media' && item.web_app.url.endsWith('?gallery='+event.id)));
  assert.ok(buttons.some(item=>item.web_app?.url.endsWith('?checkin='+event.id)));
});

test('legacy App navigation preserves active input controls and help directs users to visible buttons',async()=>{
  const f=fixture();f.bot.appUrl='https://example.test/app';
  await f.msg(1,'🎉 Create event');
  const session=f.store.data.sessions[1];
  await f.msg(1,'/app');
  assert.equal(f.store.data.sessions[1],session);
  assert.deepEqual(f.calls.at(-1).reply_markup.keyboard.flat().map(item=>item.text),['✖️ Cancel input']);
  await f.msg(1,'/help');
  assert.match(f.calls.at(-1).text,/built-in App button/);
  assert.doesNotMatch(f.calls.at(-1).text,/\/(?:new|events|app|skip|done)/);
  assert.equal(f.store.data.sessions[1],undefined);
});

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
  for (const value of ['0','-1','1.5','11','10001','abc','/skip']) {
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

test('create, invite, accept, custom name, private phone, comment, change response', async () => {
  const f = fixture(); const e = await f.create();
  assert.match(f.bot.link(e), /^https:\/\/t.me\/XEvents_bot\?start=e_[a-f0-9]{16}$/);
  await f.msg(2, `/start e_${e.id}`);
  assert.equal(e.guests[2].status, 'later');
  await f.cb(2, `r:${e.id}:yes`);
  await f.msg(2, 'Party guest'); await f.msg(2, '+61412345678');
  assert.equal(f.store.data.sessions[2].step,'comment');
  await f.msg(2, 'Looking forward to it');
  assert.equal(e.guests[2].status, 'yes'); assert.equal(e.guests[2].name, 'Party guest');
  assert.deepEqual(e.guests[2].answers, []);
  assert.equal(e.guests[2].comment,'Looking forward to it');
  assert.equal(f.store.data.sessions[2],undefined);
  f.calls.length = 0; await f.cb(2, `g:${e.id}`);
  const publicText = f.calls.map(c => c.text || '').join('\n');
  assert.match(publicText, /Party guest/); assert.match(publicText, /Looking forward/);
  assert.doesNotMatch(publicText, /61412345678/);
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
  assert.equal(f.calls.at(-1).reply_markup.keyboard[0][0].text, '🎉 Create event');
  assert.equal(f.calls.at(-1).reply_markup.keyboard[0][0].web_app,undefined);
  await f.msg(1, '🎉 Create event');
  await f.msg(1, 'Button party');
  const creationAction = (action, value) => f.cb(1, `cc:${f.store.data.sessions[1].token}:${action}${value === undefined ? '' : ':' + value}`);
  await creationAction('date', '2099-11-25');
  await creationAction('time', '1800');
  await f.msg(1, 'Park');
  await creationAction('options'); await creationAction('permissions');
  await creationAction('toggle', 'uploadMedia'); await creationAction('back');
  await creationAction('review'); await creationAction('create');
  const e = Object.values(f.store.data.events)[0];
  assert.equal(e.description, ''); assert.deepEqual(e.questions, []);
  const invite = f.calls.at(-1).reply_markup.inline_keyboard.flat().find(b => b.url);
  assert.equal(new URL(invite.url).searchParams.get('url'), f.bot.link(e));
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `book:${e.id}`);
  await f.msg(2, '👤 Use Telegram name');
  assert.equal(e.askPhone,false);assert.equal(e.askComments,false);assert.equal(e.guests[2].status,'yes');assert.equal(f.store.data.sessions[2],undefined);
  await f.msg(2, '⏭ Skip'); await f.msg(2, '⏭ Skip');
  assert.equal(e.guests[2].status, 'yes'); assert.equal(e.guests[2].name, 'User 2');
  await f.cb(2, `u:${e.id}`); await f.msg(2, undefined, { document: { file_id: 'test' } });
  await f.msg(2, '✅ Finish uploads'); assert.equal(f.store.data.sessions[2], undefined);
  await f.msg(2, '📅 My events'); assert.match(f.calls.at(-1).text, /Button party/);
  await f.cb(2, 'nav:home'); assert.equal(f.calls.at(-1).reply_markup.keyboard[0][0].text, '🎉 Create event');
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
  assert.equal(e.guests[2].approval, 'approved');
  await f.msg(3, `/start e_${e.id}`); await f.cb(3, `r:${e.id}:yes`);
  for (const text of ['Guest three', '⏭ Skip', '⏭ Skip', '⏭ Skip', '⏭ Skip']) await f.msg(3, text);
  await f.cb(1, `reject:${e.id}:3`); assert.equal(e.guests[3].status, 'no'); assert.equal(e.guests[3].ticket, undefined);
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

test('answering again replaces comments without questions and navigation discards unfinished input', async () => {
  const f = fixture(); const e = await f.create(); await f.msg(2, `/start e_${e.id}`);
  for (const answer of ['Old answer', 'New answer']) {
    if(answer==='New answer')await f.cb(2, `change:${e.id}`);
    await f.cb(2, `r:${e.id}:yes`);
    for (const text of ['👤 Use Telegram name', '⏭ Skip', answer]) await f.msg(2, text);
    assert.equal(f.store.data.sessions[2],undefined);
  }
  assert.deepEqual(e.guests[2].answers, []);assert.equal(e.guests[2].comment,'New answer');
  await f.cb(2, `r:${e.id}:no`); await f.cb(2, `v:${e.id}`);
  assert.equal(f.store.data.sessions[2], undefined); assert.equal(e.guests[2].status, 'yes');
});

test('accepted view uses change response and approval-only status with enabled extras', async () => {
  const f = fixture(); const e = await f.create({ guestList: true, viewMedia: true });
  await f.msg(2, `/start e_${e.id}`); await f.cb(2, `r:${e.id}:yes`);
  for (const text of ['Guest','/skip','/skip']) await f.msg(2,text);
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
  e.guests[2].status='yes';e.guests[2].approval='approved';
  await f.bot.card(2,e); const card=f.calls.at(-1);
  assert.ok(!card.reply_markup.inline_keyboard.flat().some(b=>b.text.includes('Copy address')));
  assert.equal(card.method,'sendPhoto');
  const entity=card.caption_entities[0]; assert.equal(card.caption.slice(entity.offset,entity.offset+entity.length),'My house');
  e.location='A'.repeat(300); await f.bot.card(2,e);
  assert.ok(!f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`address:${e.id}`));
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
  assert.ok(cards[0].caption.length<=1024);assert.equal(cards[0].reply_markup.inline_keyboard.flat().length,4);
  e.guests[2].status='yes';await f.bot.card(2,e);assert.ok(f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data===`details:${e.id}`));
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

test('organiser media sharing has its own copy and QR row with protected chat QR delivery',async()=>{
  const f=fixture(),e=await f.create();e.qrEnabled=true;f.bot.appUrl='https://example.invalid/app';
  await f.bot.card(1,e);let rows=f.calls.at(-1).reply_markup.inline_keyboard;
  const index=rows.findIndex(row=>row.some(b=>b.text==='📋 Copy upload link'));
  assert.ok(rows[index-1].some(b=>b.text==='🗂 Shared media'));
  assert.deepEqual(rows[index].map(b=>b.text),['📋 Copy upload link','▦ Show QR code']);
  assert.equal(rows[index][0].url,undefined);assert.match(rows[index][0].copy_text.text,/^https:\/\/t\.me\//);
  assert.ok(!rows.flat().some(b=>/Copy address|Refresh|Reminder/.test(b.text)));
  await f.cb(1,'upload-qr:'+e.id);assert.equal(f.calls.at(-1).method,'sendPhoto');assert.ok(f.calls.at(-1).__photoUpload);
  await f.cb(2,'upload-qr:'+e.id);assert.equal(f.calls.at(-1).method,'sendMessage');
  e.qrEnabled=false;await f.bot.card(1,e);assert.ok(!f.calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text==='▦ Show QR code'));
  await f.cb(1,'upload-qr:'+e.id);assert.equal(f.calls.at(-1).method,'sendMessage');
});
