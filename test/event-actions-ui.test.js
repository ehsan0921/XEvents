import test from 'node:test';
import assert from 'node:assert/strict';
import { setupEventActions } from '../public/event-actions.js';

const fixture = fields => ({ id: '0123456789abcdef', title: 'Club picnic', isOwner: true, ...fields });

function harness({ apiError, refreshError, hold, queueClose = false } = {}) {
  const closeEvents = [];
  class Element {
    constructor() { this.open = false; this.checked = false; this.disabled = false; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
    showModal() { this.open = true; }
    close() { this.open = false; if (queueClose) closeEvents.push(() => this.onclose?.()); else this.onclose?.(); }
    focus() { this.focused = true; }
  }
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const calls = [], notices = [], ended = [];
  let refreshes = 0;
  const controls = setupEventActions({ $, api: async (path, body) => {
    calls.push({ path, body });
    if (hold) await hold;
    if (apiError) throw apiError;
    return { saved: true };
  }, refresh: async () => { refreshes++; if (refreshError) throw refreshError; },
  onEnded: async (event, operation) => ended.push({ event, operation }), notice: message => notices.push(message) });
  return { $, calls, notices, ended, ...controls, refreshes: () => refreshes, setApiError: error => { apiError = error; }, flushClose: () => closeEvents.shift()?.() };
}

test('cancelling keeps the stored event by default and asks in the app', async () => {
  const f = harness(), event = fixture();
  const result = f.cancelEvent(event);
  assert.equal(f.$('event-end-dialog').open, true);
  assert.equal(f.$('event-end-name').textContent, event.title);
  assert.equal(f.$('event-end-delete').checked, false);
  assert.equal(f.$('event-end-delete-option').hidden, false);
  assert.equal(f.$('event-end-back').focused, true);
  assert.deepEqual(f.calls, []);
  await f.$('event-end-confirm').onclick();
  assert.equal(await result, true);
  assert.deepEqual(f.calls, [{ path: 'events/' + event.id + '/cancel', body: { confirm: true } }]);
  assert.equal(f.refreshes(), 1);
  assert.deepEqual(f.ended, [{ event, operation: 'cancel' }]);
  assert.match(f.notices[0], /cancelled/);
  assert.equal(f.$('event-end-dialog').open, false);
});

test('cancel and delete sends only the delete request so notifications happen once', async () => {
  const f = harness(), event = fixture();
  const result = f.cancelEvent(event);
  f.$('event-end-delete').checked = true;
  f.$('event-end-delete').onchange();
  assert.match(f.$('event-end-confirm').textContent, /Cancel & delete/);
  await f.$('event-end-confirm').onclick();
  assert.equal(await result, true);
  assert.deepEqual(f.calls.map(call => call.path), ['events/' + event.id + '/delete']);
  assert.equal(f.ended[0].operation, 'delete');
});

test('direct delete has a separate permanent removal confirmation', async () => {
  const f = harness(), event = fixture({ cancelled: true });
  const result = f.deleteEvent(event);
  assert.equal(f.$('event-end-title').textContent, 'Delete event?');
  assert.equal(f.$('event-end-delete-option').hidden, true);
  assert.match(f.$('event-end-message').textContent, /Permanently remove/);
  await f.$('event-end-confirm').onclick();
  assert.equal(await result, true);
  assert.equal(f.calls[0].path, 'events/' + event.id + '/delete');
});

test('keep event and Escape dismiss without posting', async () => {
  const f = harness();
  let result = f.cancelEvent(fixture());
  f.$('event-end-back').onclick();
  assert.equal(await result, false);
  result = f.deleteEvent(fixture());
  let prevented = false;
  f.$('event-end-dialog').oncancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(await result, false);
  assert.deepEqual(f.calls, []);
});

test('owner-only controls reject co-hosts, guests and already cancelled cancellation', async () => {
  const f = harness();
  for (const event of [null, fixture({ isOwner: false, isManager: true }), fixture({ isOwner: false })]) {
    assert.equal(await f.cancelEvent(event), false);
    assert.equal(await f.deleteEvent(event), false);
  }
  assert.equal(await f.cancelEvent(fixture({ cancelled: true })), false);
  assert.equal(f.$('event-end-dialog').open, false);
  assert.deepEqual(f.calls, []);
});

test('an open confirmation blocks other events and resets delete on the next cancellation', async () => {
  const f = harness();
  const result = f.cancelEvent(fixture());
  f.$('event-end-delete').checked = true;
  assert.equal(await f.deleteEvent(fixture({ id: 'fedcba9876543210' })), false);
  assert.equal(f.$('event-end-name').textContent, 'Club picnic');
  f.$('event-end-back').onclick();
  assert.equal(await result, false);
  const next = f.cancelEvent(fixture({ title: 'Training' }));
  assert.equal(f.$('event-end-delete').checked, false);
  f.$('event-end-back').onclick();
  await next;
});

test('busy confirmation blocks double posts, dismissal and changing action', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const f = harness({ hold });
  const result = f.cancelEvent(fixture());
  const posting = f.$('event-end-confirm').onclick();
  assert.equal(f.$('event-end-confirm').disabled, true);
  assert.equal(f.$('event-end-back').disabled, true);
  assert.equal(f.$('event-end-delete').disabled, true);
  assert.equal(f.$('event-end-dialog').attributes['aria-busy'], 'true');
  await f.$('event-end-confirm').onclick();
  f.$('event-end-back').onclick();
  f.$('event-end-dialog').oncancel({ preventDefault() {} });
  assert.equal(f.$('event-end-dialog').open, true);
  assert.equal(await f.deleteEvent(fixture()), false);
  assert.equal(f.calls.length, 1);
  release();
  await posting;
  assert.equal(await result, true);
});

test('API failure leaves error visible and allows an explicit retry', async () => {
  const f = harness({ apiError: new Error('Request failed. Try again.') });
  const result = f.cancelEvent(fixture());
  await f.$('event-end-confirm').onclick();
  assert.equal(f.$('event-end-dialog').open, true);
  assert.equal(f.$('event-end-status').hidden, false);
  assert.equal(f.$('event-end-status').textContent, 'Request failed. Try again.');
  assert.equal(f.$('event-end-confirm').disabled, false);
  assert.equal(f.refreshes(), 0);
  assert.deepEqual(f.ended, []);
  f.setApiError(null);
  await f.$('event-end-confirm').onclick();
  assert.equal(await result, true);
  assert.equal(f.calls.length, 2);
});

test('a successful action cannot be replayed when refreshing fails', async () => {
  const f = harness({ refreshError: new Error('Connection interrupted.') });
  const result = f.deleteEvent(fixture());
  await f.$('event-end-confirm').onclick();
  assert.equal(await result, true);
  assert.equal(f.ended.length, 1, 'the editing draft is still cleared');
  assert.match(f.notices[0], /Event deleted.*Could not refresh: Connection interrupted/);
  assert.equal(f.$('event-end-dialog').open, false);
  await f.$('event-end-confirm').onclick();
  assert.equal(f.calls.length, 1);
});

test('closing a busy dialog externally keeps the operation locked until it settles', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const f = harness({ hold });
  const result = f.cancelEvent(fixture());
  const posting = f.$('event-end-confirm').onclick();
  f.$('event-end-dialog').close();
  assert.equal(await f.cancelEvent(fixture()), false);
  release();
  await posting;
  assert.equal(await result, true);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.ended.length, 1);
  const next = f.cancelEvent(fixture({ title: 'Another event' }));
  f.$('event-end-back').onclick();
  assert.equal(await next, false);
});

test('failure after an external close is reported without reopening the dialog', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const f = harness({ hold, apiError: new Error('Could not cancel.') });
  const result = f.cancelEvent(fixture());
  const posting = f.$('event-end-confirm').onclick();
  f.$('event-end-dialog').close();
  release();
  await posting;
  assert.equal(await result, false);
  assert.equal(f.$('event-end-dialog').open, false);
  assert.equal(f.notices[0], 'Could not cancel.');
  assert.equal(f.refreshes(), 0);
});

test('a delayed browser close event cannot dismiss a newer confirmation', async () => {
  const f = harness({ queueClose: true });
  const result = f.cancelEvent(fixture());
  f.$('event-end-back').onclick();
  assert.equal(await result, false);
  assert.equal(await f.deleteEvent(fixture({ title: 'Another event' })), false);
  f.flushClose();
  const next = f.deleteEvent(fixture({ title: 'Another event' }));
  assert.equal(f.$('event-end-dialog').open, true);
  assert.equal(f.$('event-end-name').textContent, 'Another event');
  f.$('event-end-back').onclick();
  assert.equal(await next, false);
  f.flushClose();
});

test('a request settling before its external close event stays locked until that event', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const f = harness({ hold, queueClose: true });
  const result = f.cancelEvent(fixture());
  const posting = f.$('event-end-confirm').onclick();
  f.$('event-end-dialog').close();
  release();
  await posting;
  assert.equal(await result, true);
  assert.equal(await f.deleteEvent(fixture()), false);
  f.flushClose();
  const next = f.deleteEvent(fixture());
  assert.equal(f.$('event-end-dialog').open, true);
  f.$('event-end-back').onclick();
  assert.equal(await next, false);
  f.flushClose();
});
