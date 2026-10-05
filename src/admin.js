import { eventGroup } from './reminders.js';
import { permissions, responseCounts, participantCount } from './permissions.js';

export const isSuperAdmin = (user, env = {}) => {
  const configured = String(env.SUPER_ADMIN_ID || '');
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
      return { id: Number(uid), name: g.name || '', status: g.status, participants: g.status === 'yes' ? participantCount(e, g) : null, approval: g.approval || null, phone: g.phone || '', comment: g.comment || '', answers: g.answers || [] };
    });
    return { id: e.id, owner: e.owner, title: e.title, when: e.when, startsAt: e.startsAt || null, endsAt: e.endsAt || null, durationMinutes: e.durationMinutes || null, timezone: e.timezone || null, location: e.location, description: e.description, createdAt: e.createdAt, group: eventGroup(e), cancelled: !!e.cancelled, responseDeadline: e.responseDeadline || null, askParticipantCount: e.askParticipantCount === true, requireApproval: !!e.requireApproval, hideLocation: !!e.hideLocation, permissions: permissions(e), ticketInfo: e.ticketInfo || '', questions: e.questions || [], counts: responseCounts(e), mediaCount: e.media?.length || 0, hasBanner: !!e.banner, guests };
  }).sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { events, users: [...users.values()].sort((a,b) => (b.lastSeen || '').localeCompare(a.lastSeen || '') || a.id-b.id) };
}
