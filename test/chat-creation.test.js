import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { schedule, timezone } from '../src/time.js';
import { sendDueReminders } from '../src/reminders.js';
import { permissions, invitationParticipantMode, participantCount } from '../src/permissions.js';
import { paymentMethod } from '../src/event-payment.js';

function fixture(appUrl) {
  const store = { data: { events: {}, sessions: {}, preferences: {}, users: {}, offset: 0 } };
  const calls = [];
  let messageId = 0;
  const bot = new Bot(store, async (method, params) => {
    const call = { method, ...params };
    if (['sendMessage', 'sendPhoto'].includes(method)) call.message_id = ++messageId;
    calls.push(call);
    return { message_id: call.message_id };
  }, 'ExampleEventsBot', appUrl);
  const user = id => ({ id, first_name: `User ${id}` });
  const msg = (text, id = 1, extra = {}) => bot.handle({ message: {
    chat: { id, type: 'private' }, from: user(id), message_id: ++messageId, text, ...extra
  } });
  const cb = (data, id = 1, message = card(id) || latest(id)) => bot.handle({ callback_query: {
    id: String(++messageId), from: user(id), data,
    message: { chat: { id, type: 'private' }, message_id: message?.message_id || messageId }
  } });
  function latest(id = 1) {
    return calls.findLast(call => call.chat_id === id && ['sendMessage', 'sendPhoto'].includes(call.method));
  }
  function card(id = 1) {
    return calls.findLast(call => call.chat_id === id && ['sendMessage', 'sendPhoto'].includes(call.method) && call.reply_markup?.inline_keyboard?.length);
  }
  function buttons(id = 1) {
    return card(id)?.reply_markup.inline_keyboard.flat() || [];
  }
  async function tap(action, value, id = 1) {
    const button = buttons(id).find(item => {
      const parts = item.callback_data?.split(':');
      return parts?.[0] === 'cc' && parts[2] === action && (value === undefined || parts[3] === String(value));
    });
    assert.ok(button, `Missing ${action}${value === undefined ? '' : ':' + value} button in ${JSON.stringify(buttons(id))}`);
    await cb(button.callback_data, id);
    return button.callback_data;
  }
  async function tapLabel(pattern, id = 1) {
    const button = buttons(id).find(item => pattern.test(item.text));
    assert.ok(button, `Missing ${pattern} button in ${JSON.stringify(buttons(id))}`);
    assert.ok(button.callback_data, `Expected a native Telegram callback for ${button.text}`);
    await cb(button.callback_data, id);
    return button.callback_data;
  }
  async function title(text = 'Community meetup', id = 1) {
    await msg('🎉 Create event', id);
    await msg(text, id);
  }
  async function customDate(date, id = 1) {
    await tapLabel(/(?:type|custom|enter|other).*date/i, id);
    await msg(date, id);
  }
  async function toReview({ title: text = 'Community meetup', date = '2099-11-25', time = '1800', location = 'Community park', id = 1 } = {}) {
    await title(text, id);
    await customDate(date, id);
    await tap('time', time, id);
    await msg(location, id);
    return store.data.sessions[id];
  }
  return { store, bot, calls, msg, cb, latest, buttons, tap, tapLabel, title, customDate, toReview };
}

test('Create event is discoverable in the native home keyboard with or without App', async () => {
  for (const appUrl of [undefined, 'https://example.test/app']) {
    const f = fixture(appUrl);
    await f.msg('/start');
    const entries = f.latest().reply_markup.keyboard.flat();
    const create = entries.find(item => item.text === '🎉 Create event');
    assert.ok(create);
    assert.equal(create.web_app, undefined);
    await f.msg(create.text);
    assert.equal(f.store.data.sessions[1].flow, 'chat-create');
    assert.match(f.latest().text, /name|title/i);
  }
});

test('native date and time buttons create a free private event with minimal guest defaults', async () => {
  const f = fixture();
  f.store.data.preferences[1] = { timezone: 'Australia/Sydney' };
  await f.title('Button-only meetup');
  assert.match(f.latest().text, /Australia\/Sydney/);
  const dateButton = f.buttons().find(item => /Tomorrow/i.test(item.text) && /:date:/.test(item.callback_data));
  assert.ok(dateButton);
  const date = dateButton.callback_data.split(':')[3];
  const dateMessageId = f.latest().message_id;
  await f.cb(dateButton.callback_data);
  assert.ok(f.calls.some(call => call.method === 'editMessageReplyMarkup' && call.message_id === dateMessageId && call.reply_markup.inline_keyboard.length === 0));
  await f.tap('time', '1800');
  await f.msg('Community park');
  assert.equal(Object.keys(f.store.data.events).length, 0);
  assert.match(f.latest().text, /Button-only meetup/);
  assert.match(f.latest().text, /Community park/);
  const createCallback = await f.tapLabel(/Create event/i);
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.owner, 1);
  assert.equal(event.title, 'Button-only meetup');
  assert.equal(event.location, 'Community park');
  assert.equal(event.startsAt, schedule({ date, time: '18:00', timezone: 'Australia/Sydney' }).startsAt);
  assert.equal(event.timezone, 'Australia/Sydney');
  assert.equal(event.invitationMode, 'tickets');
  assert.equal(event.isPublic, false);
  assert.equal(event.askPhone, false);
  assert.equal(event.askComments, false);
  assert.equal(event.qrEnabled, false);
  assert.equal(event.requireApproval, false);
  assert.deepEqual(permissions(event), { guestList: false, uploadMedia: false, viewMedia: false });
  assert.equal(paymentMethod(event), 'free');
  assert.deepEqual(event.guests, {});
  assert.equal(f.store.data.sessions[1], undefined);
  assert.ok(!f.calls.some(call => call.reply_markup?.inline_keyboard?.flat().some(button => button.web_app)));
  await f.cb(createCallback);
  assert.equal(Object.keys(f.store.data.events).length, 1, 'a duplicate Create tap must not duplicate the event');
});

test('timezone can be selected and exact time validation rejects missing and repeated DST clocks', async () => {
  for (const date of ['2099-10-04', '2099-04-05']) {
    const f = fixture();
    f.store.data.preferences[1] = { timezone: 'Australia/Sydney' };
    await f.title('Clock-change meetup');
    await f.customDate(date);
    await f.tapLabel(/(?:type|custom|enter|other).*time/i);
    await f.msg('02:30');
    assert.equal(Object.keys(f.store.data.events).length, 0);
    assert.equal(f.store.data.sessions[1].draft.startsAt, undefined);
    assert.match(f.calls.filter(call => call.chat_id === 1).map(call => call.text || '').join('\n'), /clock changes|missing or repeated/i);
    await f.msg('03:30');
    await f.msg('Hall');
    await f.tapLabel(/Create event/i);
    const [event] = Object.values(f.store.data.events);
    assert.equal(event.startsAt, schedule({ date, time: '03:30', timezone: 'Australia/Sydney' }).startsAt);
  }
});

test('a custom timezone works without App and a location can be added later', async () => {
  const f = fixture();
  await f.title('Nepal walking club');
  await f.tapLabel(/timezone/i);
  await f.tapLabel(/custom|other|type/i);
  await f.msg('Asia/Kathmandu');
  assert.match(f.latest().text, /Asia\/Kat(?:h)?mandu/);
  await f.customDate('2099-11-25');
  await f.tap('time', '1800');
  await f.tapLabel(/later|skip|not.*set|to be confirmed/i);
  await f.tapLabel(/Create event/i);
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.timezone, timezone('Asia/Kathmandu'));
  assert.equal(event.startsAt, '2099-11-25T12:15:00Z');
  assert.equal(event.location, '');
  await f.msg(`/start e_${event.id}`, 2);
  assert.match(f.latest(2).text, /Location to follow/);
  assert.ok(!f.buttons(2).some(button => button.copy_text));
  await f.cb(`book:${event.id}`, 2);
  await f.msg('👤 Use Telegram name', 2);
  await f.cb(`ticket:${event.id}`, 2);
  assert.match(f.latest(2).text, /YOUR TICKET[\s\S]*Location to follow/);
  await f.cb(`address:${event.id}`, 2);
  assert.equal(f.latest(2).text, 'Location to follow.');
  assert.equal(f.latest(2).entities, undefined);
  assert.ok(f.calls.every(call => [...(call.entities || []), ...(call.caption_entities || [])].every(entity => entity.length > 0)));
});

test('optional named invitations preserve counts, message, banner and simple RSVP defaults', async () => {
  const f = fixture();
  await f.toReview();
  await f.tap('options');
  await f.tap('mode');
  await f.tap('named');
  await f.msg('Alex = ?\nSam = 2!\nTaylor = 2');
  await f.tap('invite-message');
  await f.msg('Join us for a relaxed community afternoon.');
  await f.tap('banner');
  await f.msg(undefined, 1, { photo: [{ file_id: 'small-banner' }, { file_id: 'large-banner' }] });
  await f.tap('review');
  assert.match(f.latest().text, /3 personal invitations/);
  await f.tap('create');
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.invitationMode, 'named');
  assert.equal(event.isPublic, false);
  assert.equal(event.oneTimeInvite, true);
  assert.equal(event.requireApproval, false);
  assert.equal(event.askParticipantCount, false);
  assert.equal(event.askPhone, false);
  assert.equal(event.askComments, false);
  assert.equal(event.qrEnabled, false);
  assert.equal(event.inviteMessage, 'Join us for a relaxed community afternoon.');
  assert.equal(event.banner, 'large-banner');
  const entries = Object.entries(event.invitees);
  assert.deepEqual(entries.map(([token, entry]) => {
    const guest = { invitationToken: token };
    return [entry.name, invitationParticipantMode(event, guest), participantCount(event, guest)];
  }), [
    ['Alex', 'ask', 1], ['Sam', 'confirm', 2], ['Taylor', 'preset', 2]
  ]);
  const samToken = Object.entries(event.invitees).find(([, entry]) => entry.name === 'Sam')[0];
  await f.msg(`/start i_${event.id}_${samToken}`, 2);
  const card = f.latest(2);
  assert.equal(card.method, 'sendPhoto');
  assert.equal(card.reply_markup.inline_keyboard.flat().filter(button => button.callback_data?.startsWith('r:')).length, 4);
  await f.cb(`r:${event.id}:yes`, 2);
  assert.match(f.latest(2).text, /Confirm 2 people/);
  assert.ok(!f.calls.some(call => call.chat_id === 2 && /phone number\?|Comment\?/.test(call.text || '')));
});

test('optional native reminders and duration produce exact schedules and reminders on booking', async () => {
  const f = fixture();
  f.store.data.preferences[1] = { timezone: 'Australia/Sydney' };
  await f.toReview();
  await f.tap('options');
  await f.tap('reminders');
  await f.tap('reminder', '180');
  await f.tap('duration');
  await f.tap('duration-set', '120');
  await f.tap('permissions');
  await f.tap('toggle', 'guestList');
  await f.tap('back');
  await f.tap('review');
  await f.tap('create');
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.startsAt, '2099-11-25T07:00:00Z');
  assert.equal(event.endsAt, '2099-11-25T09:00:00Z');
  assert.equal(event.durationMinutes, 120);
  assert.equal(event.defaultReminder, 180);
  assert.equal(event.permissions.guestList, true);
  await f.msg(`/start e_${event.id}`, 2);
  await f.cb(`book:${event.id}`, 2);
  await f.msg('👤 Use Telegram name', 2);
  assert.equal(event.guests[2].status, 'yes');
  assert.equal(event.reminders[2].minutes, 180);
  const start = Date.parse(event.startsAt);
  f.calls.length = 0;
  await sendDueReminders(f.store.data, f.bot, start - 180 * 60000 - 1);
  assert.equal(f.calls.length, 0);
  await sendDueReminders(f.store.data, f.bot, start - 180 * 60000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].chat_id, 2);
  assert.match(f.calls[0].text, /Community meetup/);
  await sendDueReminders(f.store.data, f.bot, start - 1000);
  assert.equal(f.calls.length, 1);
});

test('switching a public approval event to named invitations keeps it private and skips approval', async () => {
  const f = fixture();
  await f.toReview({ location: 'Private clubhouse' });
  await f.tap('options');
  await f.tap('permissions');
  await f.tap('toggle', 'isPublic');
  await f.tap('toggle', 'requireApproval');
  await f.tap('back');
  await f.tap('mode');
  await f.tap('named');
  await f.msg('Alex = 2');
  const draft = f.store.data.sessions[1].draft;
  assert.equal(draft.isPublic, false);
  assert.equal(draft.requireApproval, false);
  assert.equal(draft.hideLocation, true);
  await f.tap('review');
  await f.tap('create');
  const [event] = Object.values(f.store.data.events);
  const token = Object.keys(event.invitees)[0];
  await f.msg(`/start i_${event.id}_${token}`, 2);
  assert.doesNotMatch(f.latest(2).text, /Private clubhouse/);
  await f.cb(`r:${event.id}:yes`, 2);
  assert.equal(event.guests[2].status, 'yes');
  assert.equal(event.guests[2].participants, 2);
  assert.equal(f.store.data.sessions[2], undefined);
  assert.match(f.latest(2).text, /Private clubhouse/);
  assert.doesNotMatch(f.latest(2).text, /Awaiting.*approval/i);
});

test('response deadlines can be set in native chat and must remain before the event', async () => {
  const f = fixture();
  f.store.data.preferences[1] = { timezone: 'Australia/Sydney' };
  await f.toReview();
  await f.tap('options');
  await f.tap('deadline');
  await f.tap('deadline-set');
  await f.customDate('2099-11-26');
  await f.tap('time', '1800');
  assert.equal(f.store.data.sessions[1].draft.responseDeadline, undefined);
  assert.match(f.latest().text, /before the event starts/);
  await f.tap('back');
  await f.customDate('2099-11-24');
  await f.tap('time', '1200');
  await f.tap('review');
  assert.match(f.latest().text, /Respond by/);
  await f.tap('create');
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.responseDeadline, '2099-11-24T01:00:00Z');
  assert.equal(event.deadlineTimezone, 'Australia/Sydney');
});

test('cancelled, obsolete and foreign creation buttons cannot alter a draft or publish an event', async () => {
  const f = fixture();
  await f.title('First owner');
  const oldDate = f.buttons().find(item => /:date:/.test(item.callback_data)).callback_data;
  await f.title('Other owner', 2);
  const otherBefore = structuredClone(f.store.data.sessions[2]);
  await f.cb(oldDate, 2);
  assert.deepEqual(f.store.data.sessions[2], otherBefore);
  assert.equal(Object.keys(f.store.data.events).length, 0);
  await f.msg('✖️ Cancel input');
  assert.equal(f.store.data.sessions[1], undefined);
  await f.cb(oldDate);
  assert.equal(f.store.data.sessions[1], undefined);
  assert.equal(Object.keys(f.store.data.events).length, 0);
  await f.title('Replacement');
  const before = structuredClone(f.store.data.sessions[1]);
  await f.cb(oldDate);
  assert.deepEqual(f.store.data.sessions[1], before);
});

test('malformed pages retain working buttons and Back allows any valid custom clock time', async () => {
  const f = fixture();
  await f.title('Precise start');
  const before = structuredClone(f.store.data.sessions[1]);
  await f.cb(`cc:${before.token}:days:NaN`);
  assert.deepEqual(f.store.data.sessions[1], before);
  assert.match(f.latest().text, /date page/);
  await f.tap('days', '1');
  assert.notEqual(f.store.data.sessions[1].token, before.token);
  await f.customDate('2099-11-25');
  await f.tap('back');
  assert.equal(f.store.data.sessions[1].step, 'chat-date');
  await f.customDate('2099-11-26');
  await f.tap('custom-time');
  await f.msg('1:37pm');
  await f.msg('Precise venue');
  await f.tap('create');
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.localDate, '2099-11-26');
  assert.equal(event.localTime, '13:37');
  assert.equal(event.startsAt, '2099-11-26T13:37:00Z');
});

test('typed /new retains the existing conversational creation flow', async () => {
  const f = fixture();
  for (const text of ['/new', 'Legacy chat meetup', 'Saturday 6pm Sydney', 'Old hall', '/skip', '/skip']) await f.msg(text);
  const session = f.store.data.sessions[1];
  assert.equal(session.step, 'permissions');
  assert.equal(session.flow, undefined);
  await f.cb(`pd:${session.token}`);
  const [event] = Object.values(f.store.data.events);
  assert.equal(event.title, 'Legacy chat meetup');
  assert.equal(event.when, 'Saturday 6pm Sydney');
  assert.equal(event.location, 'Old hall');
});
