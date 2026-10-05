import { Bot } from './bot.js';
import {readOnlinePricing} from './exchange.js';

export class BusyError extends Error {}

export async function mutateState(env, action, updateId) {
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare('INSERT INTO lease (id, owner, expires) VALUES (1, ?, unixepoch()+60) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires=excluded.expires WHERE lease.expires < unixepoch() RETURNING owner').bind(owner).first();
  if (!lock) throw new BusyError('Please try again in a moment.');
  try {
    if (updateId !== undefined && await env.DB.prepare('SELECT id FROM processed WHERE id=?').bind(updateId).first()) return;
    const { results } = await env.DB.prepare("SELECT kind,id,data FROM records WHERE kind IN ('events','sessions','preferences')").all();
    const data = { events: {}, sessions: {}, preferences: {} };
    for (const row of results) data[row.kind][row.id] = JSON.parse(row.data);
    const before = new Map(results.map(r => [`${r.kind}:${r.id}`, r.data]));
    const messages = [];
    const bot = new Bot({ data }, async (method, params) => { messages.push({ method, params }); return {}; }, env.BOT_USERNAME, env.APP_URL);
    bot.pricing=await readOnlinePricing(env,data.preferences._pricing);
    const value = await action(data, bot);
    const batch = [env.DB.prepare('INSERT INTO commits(owner) VALUES (?)').bind(owner)];
    for (const kind of ['events', 'sessions', 'preferences']) {
      for (const [id, record] of Object.entries(data[kind])) {
        const serialized = JSON.stringify(record);
        if (before.get(`${kind}:${id}`) !== serialized) batch.push(env.DB.prepare('INSERT INTO records(kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').bind(kind, id, serialized));
        before.delete(`${kind}:${id}`);
      }
    }
    for (const key of before.keys()) {
      const [kind, id] = key.split(':');
      batch.push(env.DB.prepare('DELETE FROM records WHERE kind=? AND id=?').bind(kind, id));
    }
    const prefix = updateId === undefined ? crypto.randomUUID() : String(updateId);
    for (const [index, msg] of messages.entries()) batch.push(env.DB.prepare('INSERT INTO outbox(id,method,params) VALUES (?,?,?)').bind(`${prefix}:${String(index).padStart(5, '0')}`, msg.method, JSON.stringify(msg.params)));
    if (updateId !== undefined) batch.push(env.DB.prepare('INSERT INTO processed(id,at) VALUES (?,unixepoch())').bind(updateId));
    batch.push(env.DB.prepare('DELETE FROM commits WHERE owner=?').bind(owner));
    await env.DB.batch(batch);
    return value;
  } finally { await env.DB.prepare('DELETE FROM lease WHERE owner=?').bind(owner).run(); }
}
