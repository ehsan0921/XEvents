import test from 'node:test';
import assert from 'node:assert/strict';
import { dateChoices, draftSchedule, parseChatDate, parseChatTime, scheduleDateCard, scheduleTimeCard, validTimezone } from '../src/chat-schedule.js';

const now = Date.parse('2026-10-07T12:30:00Z');

test('date buttons use the selected timezone across midnight and week pages', () => {
  const sydney = dateChoices('Australia/Sydney', 0, now);
  const honolulu = dateChoices('Pacific/Honolulu', 0, now);
  assert.equal(sydney.length, 7);
  assert.equal(sydney[0].date, '2026-10-07');
  assert.match(sydney[0].label, /^Today/);
  assert.match(sydney[1].label, /^Tomorrow/);
  assert.equal(dateChoices('Pacific/Auckland', 0, now)[0].date, '2026-10-08');
  assert.equal(honolulu[0].date, '2026-10-07');
  assert.equal(dateChoices('Australia/Sydney', 1, now)[0].date, '2026-10-14');
  assert.equal(dateChoices('Australia/Sydney', 2, now)[6].date, '2026-10-27');
  assert.throws(() => dateChoices('UTC', -1, now), /valid date page/);
  assert.throws(() => dateChoices('UTC', 0.5, now), /valid date page/);
  assert.throws(() => dateChoices('UTC', 52, now), /valid date page/);
});

test('calendar paging advances local days across DST instead of elapsed 24-hour steps', () => {
  const choices = dateChoices('Australia/Sydney', 0, Date.parse('2026-10-03T13:30:00Z'));
  assert.deepEqual(choices.map(item => item.date), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(dateChoices('UTC', 0, Date.parse('2028-02-27T23:30:00Z')).slice(0, 4).map(item => item.date), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
});

test('chat dates validate the calendar and make day-first parsing explicit', () => {
  assert.equal(parseChatDate(' 2026-12-05 ', 'UTC', now), '2026-12-05');
  assert.equal(parseChatDate('05/12/2026', 'UTC', now), '2026-12-05');
  assert.equal(parseChatDate('5/12/2026', 'UTC', now), '2026-12-05');
  assert.equal(parseChatDate('Today', 'Pacific/Auckland', now), '2026-10-08');
  assert.equal(parseChatDate('tomorrow', 'Pacific/Auckland', now), '2026-10-09');
  assert.equal(parseChatDate('29/2/2028', 'UTC', now), '2028-02-29');
  for (const input of ['2026-02-30', '29/2/2026', '32/1/2027', '2026-2-03', 'tomorrow evening', '2101-01-01', '2019-12-31', '', null]) {
    assert.throws(() => parseChatDate(input, 'UTC', now), /valid|Use|year/);
  }
});

test('chat times handle noon, midnight, explicit am/pm and strict minutes', () => {
  const examples = { '18:00': '18:00', '6:05': '06:05', '6pm': '18:00', '6:30pm': '18:30', '6:30 PM': '18:30', '12am': '00:00', '12pm': '12:00', '11:59 p.m.': '23:59', '00:00': '00:00' };
  for (const [input, expected] of Object.entries(examples)) assert.equal(parseChatTime(input), expected);
  for (const input of ['6', '24:00', '23:60', '13pm', '0am', '6:3pm', 'noon', '-1:00', '', null]) {
    assert.throws(() => parseChatTime(input), /Use a time/);
  }
});

test('timezone input is canonicalized and fixed offsets or invalid zones are rejected', () => {
  assert.equal(validTimezone(' Australia/Sydney '), 'Australia/Sydney');
  assert.equal(validTimezone('UTC'), 'UTC');
  for (const input of ['Moon/Base', '+11:00', '-05:00', '', null]) assert.throws(() => validTimezone(input), /valid timezone/);
});

test('new chat schedules are exact future instants and preserve optional event finish data', () => {
  const start = draftSchedule({ date: '2026-10-08', time: '18:00', timezone: 'Australia/Sydney', endMode: 'duration', durationMinutes: 120 }, now);
  assert.equal(start.startsAt, '2026-10-08T07:00:00Z');
  assert.equal(start.endsAt, '2026-10-08T09:00:00Z');
  assert.equal(start.localDate, '2026-10-08');
  assert.equal(start.localTime, '18:00');
  const finish = draftSchedule({ date: '2026-10-08', time: '18:00', timezone: 'Australia/Sydney', endMode: 'finish', endDate: '2026-10-08', endTime: '21:00' }, now);
  assert.equal(finish.endsAt, '2026-10-08T10:00:00Z');
  assert.throws(() => draftSchedule({ date: '2026-10-07', time: '12:30', timezone: 'UTC' }, now), /future/);
  assert.throws(() => draftSchedule({ date: '2026-10-07', time: '12:29', timezone: 'UTC' }, now), /future/);
  assert.equal(draftSchedule({ date: '2026-10-07', time: '12:31', timezone: 'UTC' }, now).startsAt, '2026-10-07T12:31:00Z');
});

test('DST gaps and repeated times cannot silently shift a chat-created event', () => {
  const before = Date.parse('2026-01-01T00:00:00Z');
  for (const date of ['2026-10-04', '2026-04-05']) {
    assert.throws(() => draftSchedule({ date, time: '02:30', timezone: 'Australia/Sydney' }, before), /clock changes/);
  }
  assert.equal(draftSchedule({ date: '2026-10-04', time: '03:30', timezone: 'Australia/Sydney' }, before).startsAt, '2026-10-03T16:30:00Z');
  assert.throws(() => draftSchedule({ date: '2026-10-08', time: '18:00', timezone: 'UTC' }, NaN), /current time/);
});

test('date cards use native callbacks, bounded week navigation and short phone-friendly rows', () => {
  const session = { timezone: 'Australia/Sydney', token: 'f'.repeat(32) };
  const first = scheduleDateCard(session, now);
  const buttons = first.reply_markup.inline_keyboard.flat();
  assert.match(first.text, /Australia\/Sydney/);
  assert.match(first.text, /YYYY-MM-DD/);
  assert.equal(buttons.filter(item => item.callback_data.includes(':date:')).length, 7);
  assert.ok(buttons.some(item => item.callback_data === `cc:${session.token}:date:2026-10-07`));
  assert.ok(buttons.some(item => item.callback_data.endsWith(':days:1')));
  assert.ok(!buttons.some(item => item.callback_data.endsWith(':days:-1')));
  assert.ok(first.reply_markup.inline_keyboard.every(row => row.length <= 2));
  const lastButtons = scheduleDateCard({ ...session, datePage: 51 }, now).reply_markup.inline_keyboard.flat();
  assert.ok(lastButtons.some(item => item.callback_data.endsWith(':days:50')));
  assert.ok(!lastButtons.some(item => item.callback_data.endsWith(':days:52')));
  for (const item of [...buttons, ...lastButtons]) {
    assert.ok(Buffer.byteLength(item.callback_data) <= 64);
    assert.equal(item.web_app, undefined);
    assert.equal(item.url, undefined);
  }
});

test('time card offers one-tap times and text fallback without a colon in the time payload', () => {
  const card = scheduleTimeCard({ timezone: 'Australia/Sydney', date: '2026-12-05', token: 'example-token' });
  const buttons = card.reply_markup.inline_keyboard.flat();
  assert.match(card.text, /5 Dec 2026.*Australia\/Sydney/);
  assert.ok(buttons.some(item => item.text === '6pm' && item.callback_data === 'cc:example-token:time:1800'));
  assert.ok(buttons.some(item => item.callback_data === 'cc:example-token:custom-time'));
  assert.ok(card.reply_markup.inline_keyboard.slice(0, 2).every(row => row.length === 3));
  assert.ok(buttons.every(item => Buffer.byteLength(item.callback_data) <= 64 && !item.web_app));
  assert.throws(() => scheduleTimeCard({ timezone: 'UTC', date: '2026-02-30', token: 'example-token' }), /valid calendar/);
  assert.throws(() => scheduleDateCard({ timezone: 'UTC', token: 'a:forged' }, now), /expired/);
});
