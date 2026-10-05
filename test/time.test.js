import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authenticate } from '../src/mini-auth.js';
import { schedule, eventTime, timezone } from '../src/time.js';
import { publicEvent } from '../src/mini-api.js';

function signed(user, date = 1000, extra = {}) {
  const params = new URLSearchParams({ auth_date: String(date), user: JSON.stringify(user), query_id: 'test', ...extra });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update('test-token').digest();
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return params.toString();
}

test('Sydney winter/summer offsets, non-hour offsets, and guest timezone conversion', () => {
  const summer = schedule({ date: '2026-10-24', time: '18:00', timezone: 'Australia/Sydney' });
  const winter = schedule({ date: '2026-07-24', time: '18:00', timezone: 'Australia/Sydney' });
  assert.equal(summer.startsAt, '2026-10-24T07:00:00Z'); assert.equal(winter.startsAt, '2026-07-24T08:00:00Z');
  assert.equal(schedule({ date: '2026-10-24', time: '18:00', timezone: 'Asia/Kathmandu' }).startsAt, '2026-10-24T12:15:00Z');
  const shown = eventTime(summer, 'America/New_York');
  assert.match(shown, /America\/New_York/); assert.match(shown, /Organiser time/); assert.match(shown, /Australia\/Sydney/);
  assert.equal(eventTime({ when: 'Tomorrow at six' }, 'UTC'), 'Tomorrow at six');
});

test('invalid dates, missing and repeated DST times, and invalid timezones rejected', () => {
  for (const date of ['2026-10-04', '2026-04-05', '2026-02-30']) assert.throws(() => schedule({ date, time: '02:30', timezone: 'Australia/Sydney' }), /invalid|clock changes/);
  assert.throws(() => timezone('Moon/Base'), /valid timezone/);
  assert.throws(() => schedule({ date: '2026-10-24', time: '25:00', timezone: 'UTC' }), /invalid/);
});

test('Mini App authentication rejects tampering, expiration, future timestamps, duplicate keys, and missing users', () => {
  const data = signed({ id: 123, first_name: 'Tester' });
  assert.equal(authenticate(data, 'test-token', 1001).id, 123);
  assert.equal(authenticate(data.replace('Tester', 'Hacker'), 'test-token', 1001), null);
  assert.equal(authenticate(data, 'wrong-token', 1001), null);
  assert.equal(authenticate(data, 'test-token', 5000), null);
  assert.equal(authenticate(signed({ id: 123 }, 2000), 'test-token', 1000), null);
  assert.equal(authenticate(data + '&auth_date=1000', 'test-token', 1001), null);
  assert.equal(authenticate(signed({ id: '123' }), 'test-token', 1001), null);
});

test('Mini App event responses exclude private guest contact details and answers', () => {
  const e = { id: 'event', owner: 1, permissions: { guestList: true }, guests: { 2: { name: 'Guest', status: 'yes', phone: 'secret phone', answers: ['secret answer'] } }, questions: ['Private question'] };
  const serialized = JSON.stringify(publicEvent(e, 2, 'XEvents_bot'));
  assert.doesNotMatch(serialized, /secret phone|secret answer|Private question/); assert.match(serialized, /"yes":1/);
});

test('Mini App hides private location/ticket details and counts until allowed', () => {
  const e = { id: 'event', owner: 1, location: 'SECRET LOCATION', requireApproval: true, ticketInfo: 'SECRET TICKET INFO', guests: { 2: { name: 'Guest', status: 'yes', approval: 'pending' }, 1: { name: 'Organiser', status: 'yes' } } };
  const pending = publicEvent(e, 2, 'XEvents_bot');
  assert.equal(pending.location, null); assert.equal(pending.ticket, null); assert.equal(pending.counts, null); assert.doesNotMatch(JSON.stringify(pending), /SECRET/);
  e.guests[2].approval = 'approved'; e.guests[2].ticket = 'CODE';
  const approved = publicEvent(e, 2, 'XEvents_bot'); assert.equal(approved.location, 'SECRET LOCATION'); assert.equal(approved.ticket.info, 'SECRET TICKET INFO');
  const host = publicEvent(e, 1, 'XEvents_bot'); assert.equal(host.status, null); assert.equal(host.counts.yes, 1);
  e.requireApproval = false; e.hideLocation = true; e.guests[2].status = 'later';
  assert.equal(publicEvent(e, 2, 'XEvents_bot').location, null);
  e.guests[2].status = 'yes'; assert.equal(publicEvent(e, 2, 'XEvents_bot').location, 'SECRET LOCATION');
});
