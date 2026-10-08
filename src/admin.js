import { eventGroup } from './reminders.js';
import { Temporal } from '@js-temporal/polyfill';
import { timezone, InputError } from './time.js';
import { permissions, responseCounts, participantCount,requiresApproval,asksParticipantCount,hidesLocation } from './permissions.js';

export const isSuperAdmin = (user, env = {}) => {
  const configured = String(env.SUPER_ADMIN_ID || '').trim();
  if (!/^[1-9]\d*$/.test(configured)) return false;
  const id = Number(configured);
  return Number.isSafeInteger(id) && Number.isSafeInteger(user?.id) && user.id === id;
};

export async function rememberUser(env, user) {
  if (!Number.isSafeInteger(user?.id) || user.is_bot) return;
  const now = new Date().toISOString();
  const profile = { id: user.id, firstName: user.first_name || '', lastName: user.last_name || '', username: user.username || '', firstSeen: now, lastSeen: now };
  await env.DB.prepare("INSERT INTO records(kind,id,data) VALUES ('users',?,?) ON CONFLICT(kind,id) DO UPDATE SET data=json_set(excluded.data,'$.firstSeen',coalesce(json_extract(records.data,'$.firstSeen'),json_extract(excluded.data,'$.firstSeen')))").bind(String(user.id), JSON.stringify(profile)).run();
}

// Match the admin directory, including users from before first-seen tracking.
export function adminUserCount(rows) {
  return new Set(rows.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0)).size;
}

// Read-only counts: never infer a registration date from a guest's RSVP or last visit.
export function adminAnalytics(rows, { days = '30', zone = 'UTC', now = Date.now() } = {}) {
  days = Number(days);
  if (![7, 30, 90].includes(days)) throw new InputError('Choose 7, 30 or 90 days.');
  zone = timezone(zone);
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate();
  const start = today.subtract({ days: days - 1 });
  const daily = Array.from({ length: days }, (_, i) => ({ date: start.add({ days: i }).toString(), users: 0, events: 0 }));
  const buckets = new Map(daily.map(day => [day.date, day]));
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const undated = { users: 0, events: 0 };
  for (const row of rows) {
    const key = row.kind === 'users' ? 'users' : row.kind === 'events' ? 'events' : null;
    if (!key) continue;
    const stamp = typeof row.timestamp === 'string' && row.timestamp.trim() ? Date.parse(row.timestamp) : NaN;
    if (!Number.isFinite(stamp)) { undated[key]++; continue; }
    if (stamp > now) continue;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(stamp)).map(p => [p.type, p.value]));
    const bucket = buckets.get(`${parts.year}-${parts.month}-${parts.day}`);
    if (bucket) bucket[key]++;
  }
  return { timezone: zone, days, daily, totals: daily.reduce((sum, day) => ({ users: sum.users + day.users, events: sum.events + day.events }), { users: 0, events: 0 }), undated };
}

export function adminOverview(rows) {
  const users = new Map();
  const ensure = uid => { const id = Number(uid); if (!Number.isSafeInteger(id) || id <= 0) return null; if (!users.has(id)) users.set(id, { id, firstName: '', lastName: '', username: '', timezone: '', firstSeen: null, lastSeen: null, names: [], organised: [], invited: [] }); return users.get(id); };
  for (const row of rows) {
    if (row.kind === 'users') Object.assign(ensure(row.id), JSON.parse(row.data));
    if (row.kind === 'preferences') { const u = ensure(row.id); if (u) u.timezone = JSON.parse(row.data).timezone || ''; }
    if (row.kind === 'sessions') ensure(row.id);
  }
  const events = rows.filter(r => r.kind === 'events').map(row => {
    const e = JSON.parse(row.data);
    ensure(e.owner)?.organised.push(e.id);
    const guests = Object.entries(e.guests || {}).filter(([id]) => Number(id) !== e.owner).map(([uid,g]) => {
      const u = ensure(uid); if (u) { u.invited.push(e.id); if (g.name && !u.names.includes(g.name)) u.names.push(g.name); }
      return { id: Number(uid), name: g.name || '', status: g.status, participants: g.status === 'yes' ? participantCount(e, g) : null, paymentStatus:g.payment?.status || null, paymentAmount:g.payment?.amount || null, approval: g.status==='yes' ? requiresApproval(e) ? g.approval || 'pending' : 'approved' : null, phone: g.phone || '', comment: g.comment || '', answers: g.answers || [] };
    });
    return { id: e.id, owner: e.owner, title: e.title, paymentMethod:e.paymentMethod || (e.starPrice?'stars':'free'),displayPrice:e.displayPrice || '',starPrice:e.starPrice || 0,starPricing:e.starPricing || 'group', when: e.when, startsAt: e.startsAt || null, endsAt: e.endsAt || null, durationMinutes: e.durationMinutes || null, timezone: e.timezone || null, location: e.location, description: e.description, createdAt: e.createdAt, group: eventGroup(e), cancelled: !!e.cancelled, responseDeadline: e.responseDeadline || null, askParticipantCount: asksParticipantCount(e), requireApproval: requiresApproval(e), hideLocation: hidesLocation(e), permissions: permissions(e), ticketInfo: e.ticketInfo || '', questions: e.questions || [], counts: responseCounts(e), mediaCount: e.media?.length || 0, hasBanner: !!e.banner, guests };
  }).sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { events, users: [...users.values()].sort((a,b) => (b.lastSeen || '').localeCompare(a.lastSeen || '') || a.id-b.id) };
}
