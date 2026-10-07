import { InputError } from './time.js';
import {confirmed} from './permissions.js';
import {isManager} from './cohosts.js';
export const reminderOptions = [0, 15, 60, 120, 180, 240, 1440];
export const reminderLabel = minutes => !minutes ? 'Off' : minutes === 15 ? '15 minutes before' : minutes === 1440 ? '1 day before' : `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`;
export function upcoming(e, now = Date.now()) { return !e.cancelled && Number.isFinite(Date.parse(e.startsAt)) && Date.parse(e.startsAt) > now; }
export function eventGroup(e, now = Date.now()) { return e.cancelled ? 'Cancelled events' : !Number.isFinite(Date.parse(e.startsAt)) ? 'Date not set' : Date.parse(e.endsAt || e.startsAt) > now ? 'Upcoming events' : 'Past events'; }
export function setReminder(e, id, minutes, now = Date.now()) {
  if (!reminderOptions.includes(minutes)) throw new InputError('Choose a reminder option.');
  e.reminders ||= {};
  e.reminderOverrides ||= {};
  if (!minutes) { e.reminderOverrides[id] = true; delete e.reminders[id]; return; }
  if (!upcoming(e, now) || Date.parse(e.startsAt) - minutes * 60000 <= now) throw new InputError('That reminder time has already passed. Choose a shorter reminder.');
  e.reminderOverrides[id] = true;
  e.reminders[id] = { minutes, sentFor: null };
}
export function applyDefaultReminder(e, id, now = Date.now()) {
  if (e.reminderOverrides?.[id] || !e.defaultReminder || !upcoming(e, now)) return;
  e.reminders ||= {};
  if (e.reminders[id] && (e.reminders[id].source !== 'default' || e.reminders[id].minutes === e.defaultReminder)) return;
  if (Date.parse(e.startsAt) - e.defaultReminder * 60000 > now) e.reminders[id] = { minutes: e.defaultReminder, sentFor: null, source: 'default' };
}
export async function sendDueReminders(data, bot, now = Date.now()) {
  for (const e of Object.values(data.events)) {
    if (!upcoming(e, now)) continue;
    for (const [uid, reminder] of Object.entries(e.reminders || {})) {
      const id = Number(uid);
      if (!bot.allowed(e, id) || (!isManager(e,id) && e.guests[id]?.status === 'no') || (reminder.source === 'default' && !confirmed(e,e.guests[id])) || reminder.sentFor === e.startsAt || now < Date.parse(e.startsAt) - reminder.minutes * 60000) continue;
      reminder.sentFor = e.startsAt;
      await bot.send(id, `🔔 Reminder: ${e.title}\n${bot.time(e, id)}\nOpen My events for the latest invitation details.`, { inline_keyboard: [[{ text: 'Open event', callback_data: `v:${e.id}` }]] });
    }
  }
}
