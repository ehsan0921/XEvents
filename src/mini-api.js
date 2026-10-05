import {parseEventPayment,paymentMethod} from './event-payment.js';
import {readOnlinePricing} from './exchange.js';
import {invitationMode,invitationSettings,namedLink} from './invitations.js';
import { authenticate } from './mini-auth.js';
import { parsePricing, currencyCodes, localCurrency } from './pricing.js';
import { mediaApi } from './media-api.js';
import { shareUploadLink } from './permissions.js';
import { isSuperAdmin, rememberUser, adminOverview } from './admin.js';
import { schedule, timezone, InputError } from './time.js';
import { mutateState, BusyError } from './worker-store.js';
import { randomBytes } from 'node:crypto';
import { upcoming, eventGroup, setReminder, reminderOptions } from './reminders.js';
import { permissions, permissionLabels, can, confirmed, canSeeLocation, responsesClosed, responseCounts, participantCount } from './permissions.js';

function field(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new InputError(`${label} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  return value.trim();
}
function parsePermissions(value) {
  if (value === undefined) return permissions({});
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(permissionLabels, k)) || Object.values(value).some(v => typeof v !== 'boolean')) throw new InputError('Guest options must be checked or unchecked.');
  return permissions({ permissions: value });
}
function eventSettings(input, event = {}) {
  const result = {};
  const activePayments=Object.values(event.guests || {}).some(g=>['reported','paid','processing','refund_pending','refund_failed'].includes(g.payment?.status));
  if(activePayments && input.askParticipantCount !== undefined && input.askParticipantCount !== (event.askParticipantCount===true)) throw new InputError('Refund active payments before changing group attendance settings.');
  if(activePayments && input.paymentTerms !== undefined && (typeof input.paymentTerms !== 'string' || input.paymentTerms.trim() !== event.paymentTerms)) throw new InputError('Refund active payments before changing payment terms.');
  if(input.paymentMethod!==undefined || input.starPrice!==undefined || !event.id){
    const next=parseEventPayment(input,event,true);
    if(activePayments && ['paymentMethod','starPrice','starPricing','displayPrice','paymentInstructions','paymentUrl','paymentTerms'].some(key=>(next[key] || '')!==(event[key] || (key==='paymentMethod'?paymentMethod(event):''))))throw new InputError('Clear or refund active payments before changing payment settings.');
    Object.assign(result,next);
  }
  if (input.isPublic !== undefined || !event.id) {
    if (input.isPublic !== undefined && typeof input.isPublic !== 'boolean') throw new InputError('Choose public or private visibility.');
    result.isPublic = input.isPublic === true;
  }
  if (input.defaultReminder !== undefined || !event.id) {
    if (!reminderOptions.includes(input.defaultReminder ?? 0)) throw new InputError('Choose a default reminder option.');
    result.defaultReminder = input.defaultReminder ?? 0;
  }
  if (input.allowLinkUploads !== undefined || !event.id) {
    if (input.allowLinkUploads !== undefined && typeof input.allowLinkUploads !== 'boolean') throw new InputError('Uploads by link must be checked or unchecked.');
    result.allowLinkUploads = input.allowLinkUploads === true;
    result.uploadToken = result.allowLinkUploads ? event.uploadToken || randomBytes(16).toString('hex') : null;
  }
  if (input.permissions !== undefined || !event.id) result.permissions = parsePermissions(input.permissions);
  for (const key of ['requireApproval', 'hideLocation', 'askParticipantCount']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new InputError('Event options must be checked or unchecked.');
    if (input[key] !== undefined || !event.id) result[key] = input[key] === true;
  }
  if (input.ticketInfo !== undefined || !event.id) result.ticketInfo = field(input.ticketInfo ?? '', 'Invitation details', 1000);
  if (input.deadlineDate !== undefined || input.deadlineTime !== undefined) {
    if (!input.deadlineDate && !input.deadlineTime) Object.assign(result, { responseDeadline: null, deadlineDate: '', deadlineTime: '', deadlineTimezone: '' });
    else {
      const deadline = schedule({ date: input.deadlineDate, time: input.deadlineTime, timezone: input.timezone || event.timezone });
      if (event.startsAt && Date.parse(deadline.startsAt) > Date.parse(event.startsAt)) throw new InputError('The response deadline must be at or before the event starts.');
      Object.assign(result, { responseDeadline: deadline.startsAt, deadlineDate: input.deadlineDate, deadlineTime: input.deadlineTime, deadlineTimezone: deadline.timezone });
    }
  }
  const deadline = result.responseDeadline === undefined ? event.responseDeadline : result.responseDeadline;
  if (event.startsAt && deadline && Date.parse(deadline) > Date.parse(event.startsAt)) throw new InputError('The response deadline must be at or before the event starts.');
  return result;
}
export function publicEvent(e, id, username) {
  return {
    invitationMode:invitationMode(e),guestName:e.owner!==id ? e.guests[id]?.name || null : null,
    ...(e.owner===id ? {questions:e.questions || [],invitees:Object.entries(e.invitees || {}).map(([token,g])=>({name:g.name,claimed:!!g.claimedBy,status:g.claimedBy ? e.guests[g.claimedBy]?.status : null,url:namedLink(e,token,username)}))} : {}),
    id: e.id, title: e.title, when: e.when, location: canSeeLocation(e, id) ? e.location : null, description: e.description,
    startsAt: e.startsAt, timezone: e.timezone, localDate: e.localDate, localTime: e.localTime,
    endsAt: e.endsAt || null, durationMinutes: e.durationMinutes || null, endMode: e.endMode || 'none', endDate: e.endDate || '', endTime: e.endTime || '',
    isOwner: e.owner === id, cancelled: e.cancelled, inviteUrl: `https://t.me/${username}?start=e_${e.id}`,
    permissions: permissions(e),
    isPublic: e.isPublic === true,
    paymentMethod:paymentMethod(e),displayPrice:e.displayPrice || '',
    ...(e.owner === id || (e.guests[id]?.status === 'yes' && (!e.requireApproval || e.guests[id]?.approval === 'approved')) ? {paymentInstructions:e.paymentInstructions || '',paymentUrl:e.paymentUrl || ''} : {}),
    starPrice:e.starPrice || 0, starPricing:e.starPricing || 'group', paymentTerms:e.paymentTerms || '', paymentStatus:e.guests[id]?.payment?.status || null,
    defaultReminder: e.defaultReminder || 0,
    mediaCount: can(e, id, 'viewMedia') ? e.media?.length || 0 : null,
    imageCount: can(e, id, 'viewMedia') ? e.media?.filter(f => f.type === 'photo').length || 0 : null,
    ...(e.owner === id ? { allowLinkUploads: !!e.allowLinkUploads, uploadLink: shareUploadLink(e, username) } : {}),
    group: eventGroup(e), upcoming: upcoming(e), reminder: e.reminders?.[id]?.minutes || 0, hasBanner: !!e.banner,
    askParticipantCount: e.askParticipantCount === true, participants: e.guests[id]?.status === 'yes' ? participantCount(e, e.guests[id]) : null, requireApproval: e.requireApproval === true, hideLocation: e.hideLocation === true,
    responseDeadline: e.responseDeadline || null, responsesClosed: responsesClosed(e), deadlineDate: e.deadlineDate || '', deadlineTime: e.deadlineTime || '', deadlineTimezone: e.deadlineTimezone || e.timezone || null,
    ...(e.owner === id ? { ticketInfo: e.ticketInfo || '' } : {}),
    ticket: e.owner !== id && confirmed(e, e.guests[id]) && !e.cancelled ? { code: e.guests[id].ticket || '', name: e.guests[id].name, info: e.ticketInfo || '' } : null,
    counts: can(e, id, 'guestList') ? responseCounts(e) : null,
    approval: e.owner !== id && e.guests[id]?.status === 'yes' ? (!e.requireApproval || e.guests[id]?.approval === 'approved') ? 'approved' : 'pending' : null,
    status: e.owner === id ? null : e.guests[id]?.status || null
  };
}

export async function miniApi(request, env) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data, status = 200) => Response.json(data, { status, headers });
  const user = authenticate(request.headers.get('Authorization')?.replace(/^tma /, ''), env.TELEGRAM_BOT_TOKEN);
  if (!user) return respond({ error: 'Open the planner inside Telegram. If it was open for a while, close and reopen it.' }, 401);
  const path = new URL(request.url).pathname;
  const eventMatch=path.match(/^\/api\/events\/([a-f0-9]{16})$/);
  if(eventMatch && request.method==='GET'){
    const row=await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND id=?").bind(eventMatch[1]).first();const e=row && JSON.parse(row.data);
    if(!e || (e.owner!==user.id && !e.guests[user.id]))return respond({error:'Open a valid invitation first.'},403);
    return respond({event:publicEvent(e,user.id,env.BOT_USERNAME)});
  }
  if (path === '/api/explore' && request.method === 'GET') {
    const preference = await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first();
    let zone;
    try { zone = timezone(new URL(request.url).searchParams.get('timezone') || (preference && JSON.parse(preference.data).timezone) || 'UTC'); }
    catch(error) { return respond({error:error.message},400); }
    const { results } = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND json_extract(data,'$.isPublic')=1 AND json_extract(data,'$.timezone')=?").bind(zone).all();
    const events = results.map(r => JSON.parse(r.data)).filter(e => !e.cancelled && Date.parse(e.endsAt || e.startsAt) > Date.now()).sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt)).map(e => ({ id: e.id, title: e.title, description: e.description, paymentMethod:paymentMethod(e),displayPrice:e.displayPrice || '', starPrice:e.starPrice || 0, starPricing:e.starPricing || 'group', startsAt: e.startsAt, endsAt: e.endsAt || null, timezone: e.timezone, hasBanner: !!e.banner, inviteUrl: `https://t.me/${env.BOT_USERNAME}?start=e_${e.id}`, responsesClosed: responsesClosed(e) }));
    return respond({ timezone: zone, events });
  }
  const mediaResponse = await mediaApi(request, env, user);
  if (mediaResponse) return mediaResponse;
  if (path.startsWith('/api/admin')) {
    if (!isSuperAdmin(user, env)) return respond({ error: 'Super admin access required.' }, 403);
    if(path==='/api/admin/pricing' && request.method==='POST') {
      const raw=await request.text();if(raw.length>12000)return respond({error:'Too much text.'},413);
      try {
        const settings=parsePricing(JSON.parse(raw));
        await mutateState(env,data=>{data.preferences._pricing=settings;});
        return respond({settings});
      }catch(e){return respond({error:e instanceof InputError ? e.message : 'Could not save pricing settings.'},e instanceof BusyError ? 503 : 400);}
    }
    if (path !== '/api/admin/overview' || request.method !== 'GET') return respond({ error: 'Not found.' }, 404);
    await rememberUser(env, user);
    const { results } = await env.DB.prepare("SELECT kind,id,data FROM records WHERE kind IN ('events','users','preferences','sessions')").all();
    const pricing=results.find(r=>r.kind==='preferences' && r.id==='_pricing');
    return respond({...adminOverview(results),pricing:await readOnlinePricing(env,pricing ? JSON.parse(pricing.data) : {})});
  }
  const bannerMatch = path.match(/^\/api\/events\/([a-f0-9]{16})\/banner$/);
  if (bannerMatch && ['GET', 'POST'].includes(request.method)) {
    const row = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND id=?").bind(bannerMatch[1]).first();
    const event = row && JSON.parse(row.data);
    if (!event || (event.owner !== user.id && !event.guests[user.id] && !(request.method === 'GET' && event.isPublic === true && !event.cancelled))) return respond({ error: 'Open a valid invitation first.' }, 403);
    try {
      if (request.method === 'GET') {
        if (!event.banner) return respond({ error: 'No banner.' }, 404);
        const lookup = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: event.banner }), signal: AbortSignal.timeout(10000) });
        const file = await lookup.json();
        if (!file.ok || !file.result?.file_path) throw new Error();
        const photo = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.result.file_path}`, { signal: AbortSignal.timeout(10000) });
        if (!photo.ok) throw new Error();
        return new Response(photo.body, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
      }
      if (event.owner !== user.id || event.cancelled) return respond({ error: 'Only the organiser can change an active event banner.' }, 403);
      if (Number(request.headers.get('Content-Length')) > 6 * 1024 * 1024) return respond({ error: 'Use a photo smaller than 5 MB.' }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 6 * 1024 * 1024) return respond({ error: 'Use a photo smaller than 5 MB.' }, 413);
      const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
      const photo = form.get('photo');
      if (!(photo instanceof File) || !photo.size || photo.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return respond({ error: 'Choose a JPG, PNG, or WebP photo smaller than 5 MB.' }, 400);
      const upload = new FormData(); upload.set('chat_id', String(user.id)); upload.set('photo', photo); upload.set('caption', `Banner for ${event.title}`);
      const result = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: upload, signal: AbortSignal.timeout(20000) })).json();
      const fileId = result.result?.photo?.at(-1)?.file_id;
      if (!result.ok || !fileId) return respond({ error: 'Telegram could not save that photo. Try a different image.' }, 400);
      const value = await mutateState(env, (data) => {
        const current = data.events[event.id];
        if (!current || current.owner !== user.id || current.cancelled) throw new InputError('This event is no longer available for changes.');
        current.banner = fileId;
        return { event: publicEvent(current, user.id, env.BOT_USERNAME) };
      });
      return respond(value);
    } catch (error) { console.error('banner_failed', error.name); return respond({ error: error instanceof BusyError ? error.message : 'Could not load or save the banner. Please try again.' }, 503); }
  }
  if (path === '/api/bootstrap' && request.method === 'GET') {
    await rememberUser(env, user);
    const { results } = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND (json_extract(data,'$.owner')=? OR json_type(data,?) IS NOT NULL)").bind(user.id, `$.guests."${user.id}"`).all();
    const preference = await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first();
    const session = await env.DB.prepare("SELECT data FROM records WHERE kind='sessions' AND id=?").bind(String(user.id)).first();
    const s = session ? JSON.parse(session.data) : null;
    const pickerSession = s && (s.step === 'when' || s.step === 'permissions' || (s.step === 'edit' && s.field === 'when')) ? { token: s.token, event: s.event || null, deadlineDate: s.draft?.deadlineDate || '', deadlineTime: s.draft?.deadlineTime || '', timezone: s.draft?.deadlineTimezone || s.draft?.timezone || null } : null;
    const pricing=await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id='_pricing'").first();
    const pref=preference ? JSON.parse(preference.data) : {};
    return respond({pricing:await readOnlinePricing(env,pricing ? JSON.parse(pricing.data) : {}),currencyCodes,localCurrency:localCurrency(pref), user: { id: user.id, firstName: user.first_name || 'Guest', isSuperAdmin: isSuperAdmin(user, env) }, preference: {timezone:pref.timezone,currency:pref.currency || ''}, session: pickerSession, events: results.map(r => publicEvent(JSON.parse(r.data), user.id, env.BOT_USERNAME)) });
  }
  if (request.method !== 'POST') return respond({ error: 'Not found' }, 404);
  const raw = await request.text();
  if (raw.length > 24000) return respond({ error: 'Too much text.' }, 413);
  let input;
  try { input = JSON.parse(raw); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); }
  catch { return respond({ error: 'Invalid request.' }, 400); }
  try {
    if (path === '/api/preview') return respond(schedule(input));
    const value = await mutateState(env, async (data, bot) => {
      const id = user.id;
      if (path === '/api/preferences') {
        if(input.currency!==undefined && input.currency!=='' && !currencyCodes.includes(input.currency))throw new InputError('Choose a supported display currency.');
        data.preferences[id] = { ...data.preferences[id], timezone: timezone(input.timezone) };
        if(input.currency!==undefined)data.preferences[id].currency=input.currency;
        return { preference: { timezone: data.preferences[id].timezone,currency:data.preferences[id].currency || '' } };
      }
      if (path === '/api/events') {
        if (!/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw new InputError('Refresh the planner and try again.');
        const existing = Object.values(data.events).find(e => e.owner === id && e.createRequestId === input.requestId);
        if (existing) return { event: publicEvent(existing, id, env.BOT_USERNAME) };
        const title = field(input.title, 'Event name', 100, true);
        const location = field(input.location, 'Location', 300, true);
        const description = field(input.description ?? '', 'Description', 1500);
        const questions = field(input.questions ?? '', 'Questions', 2200).split('\n').map(q => q.trim()).filter(Boolean);
        if (questions.length > 10 || questions.some(q => q.length > 200)) throw new InputError('Use up to 10 questions, each at most 200 characters.');
        const e = { ...schedule(input), id: randomBytes(8).toString('hex'), title, location, description, questions, permissions: parsePermissions(input.permissions), owner: id, guests: {}, media: [], cancelled: false, createdAt: new Date().toISOString(), createRequestId: input.requestId };
        Object.assign(e, eventSettings(input, { ...e, id: undefined }));
        Object.assign(e,invitationSettings(input,{...e,id:undefined,invitationMode:input.invitationMode || 'tickets'}));
        data.events[e.id] = e;
        await bot.home(id, '🎉 Your event is ready! Created in your planner.'); await bot.card(id, e);
        return { event: publicEvent(e, id, env.BOT_USERNAME) };
      }
      if (path === '/api/picker') {
        const s = data.sessions[id];
        if (!s || !s.token || s.token !== input.sessionToken || !(s.step === 'when' || (s.step === 'edit' && s.field === 'when'))) throw new InputError('This picker has expired. Open a new picker from the current chat step.');
        const date = schedule(input);
        if (s.draft && s.step === 'when') {
          Object.assign(s.draft, date); s.step = 'location'; delete s.token;
          await bot.prompt(id, '📅 Time saved. Where is the event? Enter an address, meeting point, or online link.');
        } else {
          const e = data.events[s.event];
          if (!e || e.owner !== id || e.cancelled) throw new InputError('Only the organiser can change an active event.');
          Object.assign(e, schedule({ endMode: e.endMode || 'none', durationMinutes: e.durationMinutes, endDate: e.endDate, endTime: e.endTime, ...input })); bot.session(id);
          await bot.notify(e, `📣 ${e.title}: the organiser updated the date and time. Tap My events for the latest details.`);
          await bot.home(id, '✅ Event time updated.'); await bot.card(id, e);
        }
        return { saved: true };
      }
      if (path === '/api/draft-deadline') {
        const s = data.sessions[id];
        if (!s?.draft || s.step !== 'permissions' || s.token !== input.sessionToken) throw new InputError('This deadline picker has expired. Open a new one from the current creation step.');
        const settings = input.clear === true ? { responseDeadline: null, deadlineDate: '', deadlineTime: '', deadlineTimezone: '' } : eventSettings({ deadlineDate: input.date, deadlineTime: input.time, timezone: input.timezone }, { ...s.draft, id: 'draft' });
        Object.assign(s.draft, settings);
        await bot.creationPermissions(id, s);
        return { saved: true };
      }
      const match = path.match(/^\/api\/events\/([a-f0-9]{16})\/schedule$/);
      const endMatch = path.match(/^\/api\/events\/([a-f0-9]{16})\/(cancel|delete)$/);
      if (endMatch) {
        const e = data.events[endMatch[1]];
        if (!e || e.owner !== id) throw new InputError('Only the organiser can cancel or delete this event.');
        if (input.confirm !== true) throw new InputError('Confirm this action first.');
        await bot.endEvent(id, e, endMatch[2] === 'delete');
        return { saved: true };
      }
      const reminderMatch = path.match(/^\/api\/events\/([a-f0-9]{16})\/reminder$/);
      if (reminderMatch) {
        const e = data.events[reminderMatch[1]];
        if (!bot.allowed(e, id) || e.cancelled) throw new InputError('Open an active invitation first.');
        setReminder(e, id, input.minutes);
        return { event: publicEvent(e, id, env.BOT_USERNAME) };
      }
      if (match) {
        const e = data.events[match[1]];
        if (!e || e.owner !== id || e.cancelled) throw new InputError('Only the organiser can change an active event.');
        const inviteSettings=invitationSettings(input,e);
        if(input.title!==undefined)e.title=field(input.title,'Event name',100,true);
        if(input.location!==undefined)e.location=field(input.location,'Location',300,true);
        if(input.description!==undefined)e.description=field(input.description,'Description',1500);
        if(input.questions!==undefined){const questions=field(input.questions,'Questions',2200).split('\n').map(q=>q.trim()).filter(Boolean);if(questions.length>10 || questions.some(q=>q.length>200))throw new InputError('Use up to 10 questions, each at most 200 characters.');e.questions=questions;}
        Object.assign(e, schedule({ endMode: e.endMode || 'none', durationMinutes: e.durationMinutes, endDate: e.endDate, endTime: e.endTime, ...input }));
        Object.assign(e, eventSettings(input, e));
        Object.assign(e,inviteSettings);
        await bot.notify(e, `📣 ${e.title}: the organiser updated the event details. Tap My events for the latest details.`); await bot.card(id, e);
        return { event: publicEvent(e, id, env.BOT_USERNAME) };
      }
      throw new InputError('Not found');
    });
    return respond(value);
  } catch (e) {
    if (e instanceof BusyError) return respond({ error: e.message }, 503);
    // Validation errors are controlled strings; never expose database or fetch errors.
    if (e instanceof InputError) return respond({ error: e.message }, 400);
    console.error(JSON.stringify({ event: 'mini_api_failed', path }));
    return respond({ error: 'Could not save. Please try again.' }, 503);
  }
}
