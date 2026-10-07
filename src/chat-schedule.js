import { Temporal } from '@js-temporal/polyfill';
import { InputError, schedule, timezone } from './time.js';

/** Return a canonical IANA timezone, or a short error suitable for chat. */
export function validTimezone(value) {
  return timezone(typeof value === 'string' ? value.trim() : value);
}

function instant(now) {
  if (!Number.isSafeInteger(now)) throw new InputError('The current time is invalid.');
  try { return Temporal.Instant.fromEpochMilliseconds(now); }
  catch { throw new InputError('The current time is invalid.'); }
}

function today(zone, now) {
  return instant(now).toZonedDateTimeISO(validTimezone(zone)).toPlainDate();
}

function checkedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('Use YYYY-MM-DD or DD/MM/YYYY for the date.');
  let date;
  try { date = Temporal.PlainDate.from(value, { overflow: 'reject' }); }
  catch { throw new InputError('Choose a valid calendar date.'); }
  if (date.year < 2020 || date.year > 2100) throw new InputError('Choose a year between 2020 and 2100.');
  return date.toString();
}

/** Seven local calendar dates, starting with today and advancing a week per page. */
export function dateChoices(zone, page = 0, now = Date.now()) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 51) throw new InputError('Choose a valid date page.');
  const localToday = today(zone, now);
  return Array.from({ length: 7 }, (_, index) => {
    const offset = page * 7 + index;
    const date = localToday.add({ days: offset });
    const label = date.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return { date: date.toString(), label: (offset === 0 ? 'Today · ' : offset === 1 ? 'Tomorrow · ' : '') + label };
  });
}

/** Chat dates are deliberately day-first; ambiguous numeric US formats are not inferred. */
export function parseChatDate(input, zone, now = Date.now()) {
  const localToday = today(zone, now);
  if (typeof input !== 'string') throw new InputError('Use YYYY-MM-DD or DD/MM/YYYY for the date.');
  const value = input.trim();
  if (/^today$/i.test(value)) return checkedDate(localToday.toString());
  if (/^tomorrow$/i.test(value)) return checkedDate(localToday.add({ days: 1 }).toString());
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dayFirst) return checkedDate(`${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`);
  return checkedDate(value);
}

/** Accept 24-hour times, or an explicit am/pm time, and return HH:mm. */
export function parseChatTime(input) {
  if (typeof input !== 'string') throw new InputError('Use a time like 18:00 or 6:30pm.');
  const value = input.trim();
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock && Number(clock[1]) <= 23) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
  const twelve = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(value);
  if (twelve && Number(twelve[1]) >= 1 && Number(twelve[1]) <= 12) {
    const hour = Number(twelve[1]) % 12 + (twelve[3].toLowerCase() === 'p' ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${twelve[2] || '00'}`;
  }
  throw new InputError('Use a time like 18:00 or 6:30pm.');
}

/** Use the same DST and duration rules as App, with a future start required for creation. */
export function draftSchedule(input, now = Date.now()) {
  const result = schedule({ ...input, timezone: validTimezone(input.timezone) });
  if (Temporal.Instant.compare(Temporal.Instant.from(result.startsAt), instant(now)) <= 0) {
    throw new InputError('Choose a future date and time.');
  }
  return result;
}

function callback(token, action, value) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(token)) throw new InputError('This draft has expired. Start again.');
  return `cc:${token}:${action}${value === undefined ? '' : ':' + value}`;
}

const button = (text, callback_data) => ({ text, callback_data });
const rows = (buttons, width = 2) => Array.from({ length: Math.ceil(buttons.length / width) }, (_, index) => buttons.slice(index * width, (index + 1) * width));

/** A native Telegram calendar with no dependency on a Web App launcher. */
export function scheduleDateCard(session, now = Date.now()) {
  const zone = validTimezone(session.timezone);
  const page = session.datePage ?? 0;
  const choices = dateChoices(zone, page, now);
  const cb = (action, value) => callback(session.token, action, value);
  const navigation = [
    ...(page > 0 ? [button('‹ Previous week', cb('days', page - 1))] : []),
    ...(page < 51 ? [button('Next week ›', cb('days', page + 1))] : [])
  ];
  return {
    text: `Choose a date\nTimezone: ${zone}\nTap a day, or type YYYY-MM-DD (DD/MM/YYYY also works).`,
    reply_markup: { inline_keyboard: [
      ...rows(choices.map(choice => button(choice.label, cb('date', choice.date)))),
      ...(navigation.length ? [navigation] : []),
      [button('Type another date', cb('custom-date')), button('Change timezone', cb('zone'))],
      [button('Back', cb('back')), button('Cancel', cb('cancel'))]
    ] }
  };
}

/** A short list of common times, with explicit text input for any other time. */
export function scheduleTimeCard(session) {
  const zone = validTimezone(session.timezone);
  const date = Temporal.PlainDate.from(checkedDate(session.date));
  const readable = date.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const cb = (action, value) => callback(session.token, action, value);
  const choices = [['9am', '0900'], ['12pm', '1200'], ['3pm', '1500'], ['6pm', '1800'], ['7pm', '1900'], ['8pm', '2000']];
  return {
    text: `Choose a time\n${readable} · ${zone}\nTap a time, or type 18:00 / 6:30pm.`,
    reply_markup: { inline_keyboard: [
      ...rows(choices.map(([label, value]) => button(label, cb('time', value))), 3),
      [button('Type another time', cb('custom-time'))],
      [button('Back', cb('back')), button('Cancel', cb('cancel'))]
    ] }
  };
}
