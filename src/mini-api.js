import {parseEventPayment,paymentMethod,paidEvent} from './event-payment.js';
import {guestMessageApi} from './guest-message-api.js';
import {issueTicket,verifyTicket} from './tickets.js';
import {profileFields,profilePreference,profilePhotoApi} from './profile.js';
import {readOnlinePricing} from './exchange.js';
import {invitationMode,invitationSettings,oneTimeInvites,invitationAvailable,reconcileInvitationClaims} from './invitations.js';
import {managedInvitations,revokedInvitations,invitationsVersion,addInvitations,removeInvitation,editInvitation,changeInvitationResponse,revokeInvitation,deleteInvitation,hasRecordedResponse} from './invitation-management.js';
import {invitationHistory} from './invitation-history.js';
import {isManager,cohostEntries,cohostLink,cohostVersion,createCohostInvite,revokeCohost} from './cohosts.js';
import { authenticate } from './mini-auth.js';
import { mayUseTestApp, testAccessMessage, TestAccessError, whitelistStatus, applyWhitelistChange } from './test-access.js';
import { parsePricing, currencyCodes, localCurrency } from './pricing.js';
import { mediaApi } from './media-api.js';
import { shareUploadLink,asksPhone,asksComments,requiresApproval,asksParticipantCount,hidesLocation } from './permissions.js';
import { isSuperAdmin, rememberUser, adminOverview, adminAnalytics, adminUserCount } from './admin.js';
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
  const named=(input.invitationMode ?? event.invitationMode)==='named';
  const activePayments=Object.values(event.guests || {}).some(g=>['reported','paid','processing','refund_pending','refund_failed'].includes(g.payment?.status));
  if(!named && activePayments && input.askParticipantCount !== undefined && input.askParticipantCount !== asksParticipantCount(event)) throw new InputError('Refund active payments before changing group attendance settings.');
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
  for (const key of ['requireApproval', 'hideLocation', 'askParticipantCount','askPhone','askComments']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new InputError('Event options must be checked or unchecked.');
    if (input[key] !== undefined || !event.id) result[key] = input[key] === true;
  }
  if(named){
    result.requireApproval=false;result.askParticipantCount=false;
    if(input.hideLocation===undefined && event.requireApproval===true)result.hideLocation=true;
  }
  if (input.ticketInfo !== undefined || !event.id) result.ticketInfo = field(input.ticketInfo ?? '', 'Invitation details', 1000);
  if(input.inviteMessage!==undefined || !event.id)result.inviteMessage=field(input.inviteMessage ?? '', 'Invitation message',1000);
  if(input.qrEnabled!==undefined && typeof input.qrEnabled!=='boolean')throw new InputError('QR codes must be checked or unchecked.');
  if(input.qrEnabled!==undefined || !event.id)result.qrEnabled=input.qrEnabled===true;
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
function cohostSettings(input,event) {
  const values={paymentMethod:paymentMethod(event),starPrice:event.starPrice || 0,starPricing:event.starPricing || 'group',displayPrice:event.displayPrice || '',paymentInstructions:event.paymentInstructions || '',paymentUrl:event.paymentUrl || '',paymentTerms:event.paymentTerms || ''};
  for(const [key,value] of Object.entries(values))if(input[key]!==undefined && input[key]!==value)throw new InputError('Only the event owner can change payment settings.');
  if(input.invitationMode!==undefined && input.invitationMode!==invitationMode(event))throw new InputError('Only the event owner can change the invitation mode.');
}
export function publicEvent(e, id, username) {
  const manager=isManager(e,id),owner=e.owner===id;
  const entries=cohostEntries(e),cohosts=entries.filter(entry=>entry.status==='active' && entry.cohost).map(entry=>entry.cohost);
  return {
    invitationMode:invitationMode(e),guestName:e.owner!==id ? e.guests[id]?.name || null : null,
    askPhone:asksPhone(e),askComments:asksComments(e),
    ...(manager ? {guestRoster:[...Object.entries(e.guests).filter(([uid])=>Number(uid)!==e.owner).map(([uid,g])=>({id:Number(uid),name:g.name,status:g.status,responded:hasRecordedResponse(g,invitationHistory(e,g.invitationToken),Number(uid)),approval:g.status==='yes' ? requiresApproval(e) ? g.approval || 'pending' : 'approved' : null,confirmed:confirmed(e,g),participants:g.status==='yes'?participantCount(e,g):0,paymentStatus:g.payment?.status || null})),...Object.entries(e.invitees || {}).filter(([token])=>!Object.values(e.guests).some(g=>g.invitationToken===token)).map(([,g])=>({id:null,name:g.name,status:'unopened',responded:false,participants:0,confirmed:false}))]} : {}),
    inviteMessage:e.inviteMessage || '',qrEnabled:e.qrEnabled!==false,oneTimeInvite:oneTimeInvites(e),
    ...(manager ? {invitees:managedInvitations(e,username),revokedInvitees:revokedInvitations(e,username),invitationsVersion:invitationsVersion(e),cohosts,cohost:cohosts[0] || null} : {}),
    ...(owner ? {cohostLinks:entries.map(entry=>({id:entry.id,label:entry.label,status:entry.status,createdAt:entry.createdAt,cohost:entry.cohost,url:cohostLink(e,username,entry.id),...(entry.revokedAt ? {revokedAt:entry.revokedAt}:{})})),cohostInviteUrl:cohostLink(e,username),cohostVersion:cohostVersion(e)} : {}),
    id: e.id, title: e.title, when: e.when, location: canSeeLocation(e, id) ? e.location : null, description: e.description,
    startsAt: e.startsAt, timezone: e.timezone, localDate: e.localDate, localTime: e.localTime,
    endsAt: e.endsAt || null, durationMinutes: e.durationMinutes || null, endMode: e.endMode || 'none', endDate: e.endDate || '', endTime: e.endTime || '',
    isOwner: owner, isManager:manager,isCoHost:!owner && manager,cancelled: e.cancelled, inviteUrl: `https://t.me/${username}?start=e_${e.id}`,
    permissions: permissions(e),
    isPublic: e.isPublic === true,
    paymentMethod:paymentMethod(e),displayPrice:e.displayPrice || '',
    ...(manager || (e.guests[id]?.status === 'yes' && (!requiresApproval(e) || e.guests[id]?.approval === 'approved')) ? {paymentInstructions:e.paymentInstructions || '',paymentUrl:e.paymentUrl || ''} : {}),
    starPrice:e.starPrice || 0, starPricing:e.starPricing || 'group', paymentTerms:e.paymentTerms || '', paymentStatus:e.guests[id]?.payment?.status || null,
    defaultReminder: e.defaultReminder || 0,
    mediaCount: can(e, id, 'viewMedia') ? e.media?.length || 0 : null,
    imageCount: can(e, id, 'viewMedia') ? e.media?.filter(f => f.type === 'photo').length || 0 : null,
    ...(manager ? { allowLinkUploads: !!e.allowLinkUploads, uploadLink: shareUploadLink(e, username) } : {}),
    group: eventGroup(e), upcoming: upcoming(e), reminder: e.reminders?.[id]?.minutes || 0, hasBanner: !!e.banner,
    askParticipantCount: asksParticipantCount(e), participants: e.guests[id]?.status === 'yes' ? participantCount(e, e.guests[id]) : null, requireApproval: requiresApproval(e), hideLocation: hidesLocation(e),
    responseDeadline: e.responseDeadline || null, responsesClosed: responsesClosed(e), deadlineDate: e.deadlineDate || '', deadlineTime: e.deadlineTime || '', deadlineTimezone: e.deadlineTimezone || e.timezone || null,
    ...(manager ? { ticketInfo: e.ticketInfo || '' } : {}),
    ticket: e.owner !== id && confirmed(e, e.guests[id]) && !e.cancelled ? { name: e.guests[id].name, info: e.ticketInfo || '', participants:participantCount(e,e.guests[id]),checkedInAt:e.checkIns?.[e.guests[id].ticket]?.at || null } : null,
    counts: can(e, id, 'guestList') ? responseCounts(e) : null,
    approval: e.owner !== id && e.guests[id]?.status === 'yes' ? (!requiresApproval(e) || e.guests[id]?.approval === 'approved') ? 'approved' : 'pending' : null,
    status: e.owner === id ? null : e.guests[id]?.status || null
  };
}

export async function miniApi(request, env) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data, status = 200) => Response.json(data, { status, headers });
  const user = authenticate(request.headers.get('Authorization')?.replace(/^tma /, ''), env.TELEGRAM_BOT_TOKEN);
  if (!user) return respond({ error: 'Open the planner inside Telegram. If it was open for a while, close and reopen it.' }, 401);
  if (!await mayUseTestApp(env, user)) return respond({ error: testAccessMessage }, 403);
  // The identity comes only from verified Telegram data. A database refresh can
  // finish between authorization and a later route read or mutation.
  const invocation = { ...env, snapshotUser: user };
  try {
    const response = await miniApiForUser(request, invocation, user);
    if (!await mayUseTestApp(invocation, user)) {
      if (response.body) await response.body.cancel().catch(() => {});
      return respond({ error: testAccessMessage }, 403);
    }
    return response;
  } catch (error) {
    if (error instanceof TestAccessError || !await mayUseTestApp(invocation, user)) return respond({ error: testAccessMessage }, 403);
    throw error;
  }
}

async function miniApiForUser(request, env, user) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data, status = 200) => Response.json(data, { status, headers });
  const path = new URL(request.url).pathname;
  const profileResponse=await profilePhotoApi(request,env,user);if(profileResponse)return profileResponse;
  const eventMatch=path.match(/^\/api\/events\/([a-f0-9]{16})$/);
  if(eventMatch && request.method==='GET'){
    const row=await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND id=?").bind(eventMatch[1]).first();const e=row && JSON.parse(row.data);
    if(!e || (!isManager(e,user.id) && (!e.guests[user.id] || !invitationAvailable(e,user.id))))return respond({error:'Open a valid invitation first.'},403);
    return respond({event:publicEvent(e,user.id,env.BOT_USERNAME)});
  }
  if (path === '/api/explore' && request.method === 'GET') {
    const preference = await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first();
    let zone;
    try { zone = timezone(new URL(request.url).searchParams.get('timezone') || (preference && JSON.parse(preference.data).timezone) || 'UTC'); }
    catch(error) { return respond({error:error.message},400); }
    const { results } = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND json_extract(data,'$.isPublic')=1 AND COALESCE(json_extract(data,'$.invitationMode'),'legacy')!='named' AND json_extract(data,'$.timezone')=?").bind(zone).all();
    const events = results.map(r => JSON.parse(r.data)).filter(e => !e.cancelled && Date.parse(e.endsAt || e.startsAt) > Date.now()).sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt)).map(e => ({ id: e.id, title: e.title, description: e.description, paymentMethod:paymentMethod(e),displayPrice:e.displayPrice || '', starPrice:e.starPrice || 0, starPricing:e.starPricing || 'group', startsAt: e.startsAt, endsAt: e.endsAt || null, timezone: e.timezone, hasBanner: !!e.banner, inviteUrl: `https://t.me/${env.BOT_USERNAME}?start=e_${e.id}`, responsesClosed: responsesClosed(e) }));
    return respond({ timezone: zone, events });
  }
  const mediaResponse = await mediaApi(request, env, user);
  if (mediaResponse) return mediaResponse;
  if (path.startsWith('/api/admin')) {
    if (!isSuperAdmin(user, env)) return respond({ error: 'Super admin access required.' }, 403);
    if (path === '/api/admin/analytics' && request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      // Validate before querying, and project timestamps only (no guest or media data).
      try {
        const options = { days: query.get('days') ?? '30', zone: query.get('timezone') ?? 'UTC' };
        adminAnalytics([], options);
        const [activity, users] = await env.DB.batch([
          env.DB.prepare("SELECT kind, CASE WHEN kind='users' THEN json_extract(data,'$.firstSeen') ELSE json_extract(data,'$.createdAt') END AS timestamp FROM records WHERE kind IN ('users','events')"),
          env.DB.prepare("SELECT id FROM records WHERE kind IN ('users','preferences','sessions') UNION SELECT json_extract(data,'$.owner') AS id FROM records WHERE kind='events' UNION SELECT guest.key AS id FROM records, json_each(records.data,'$.guests') AS guest WHERE records.kind='events'")
        ]);
        return respond({ ...adminAnalytics(activity.results, options), totalUsers: adminUserCount(users.results) });
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        return respond({ error: error.message }, 400);
      }
    }
    if (path === '/api/admin/whitelist') {
      if (request.method === 'GET') return respond(await whitelistStatus(env));
      if (request.method === 'POST') {
        if (env.APP_ENV !== 'development') return respond({ error: 'The test whitelist is available only in development.' }, 403);
        const raw = await request.text();
        if (raw.length > 14000) return respond({ error: 'Too much text.' }, 413);
        try {
          const input = JSON.parse(raw);
          const status = await mutateState(env, (_data, _bot, settings) => applyWhitelistChange(env, input, settings));
          return respond(status);
        } catch (error) {
          if (error instanceof TestAccessError) throw error;
          return respond({ error: error instanceof InputError || error instanceof BusyError ? error.message : 'Could not save test access settings.' }, error instanceof BusyError ? 503 : 400);
        }
      }
      return respond({ error: 'Not found.' }, 404);
    }
    if(path==='/api/admin/pricing' && request.method==='POST') {
      const raw=await request.text();if(raw.length>12000)return respond({error:'Too much text.'},413);
      try {
        const settings=parsePricing(JSON.parse(raw));
        await mutateState(env,data=>{data.preferences._pricing=settings;});
        return respond({settings});
      }catch(e){if(e instanceof TestAccessError)throw e;return respond({error:e instanceof InputError ? e.message : 'Could not save pricing settings.'},e instanceof BusyError ? 503 : 400);}
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
    if (!event || (!isManager(event,user.id) && !(event.guests[user.id] && invitationAvailable(event,user.id)) && !(request.method === 'GET' && event.isPublic === true && invitationMode(event)!=='named' && !event.cancelled))) return respond({ error: 'Open a valid invitation first.' }, 403);
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
      if (!isManager(event,user.id) || event.cancelled) return respond({ error: 'Only an organiser can change an active event banner.' }, 403);
      if (Number(request.headers.get('Content-Length')) > 6 * 1024 * 1024) return respond({ error: 'Use a photo smaller than 5 MB.' }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 6 * 1024 * 1024) return respond({ error: 'Use a photo smaller than 5 MB.' }, 413);
      const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
      const photo = form.get('photo');
      if (!(photo instanceof File) || !photo.size || photo.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return respond({ error: 'Choose a JPG, PNG, or WebP photo smaller than 5 MB.' }, 400);
      if (!await mayUseTestApp(env, user)) throw new TestAccessError();
      const upload = new FormData(); upload.set('chat_id', String(user.id)); upload.set('photo', photo); upload.set('caption', `Banner for ${event.title}`);
      const result = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: upload, signal: AbortSignal.timeout(20000) })).json();
      const fileId = result.result?.photo?.at(-1)?.file_id;
      if (!result.ok || !fileId) return respond({ error: 'Telegram could not save that photo. Try a different image.' }, 400);
      const value = await mutateState(env, (data) => {
        const current = data.events[event.id];
        if (!isManager(current,user.id) || current.cancelled) throw new InputError('This event is no longer available for changes.');
        current.banner = fileId;
        return { event: publicEvent(current, user.id, env.BOT_USERNAME) };
      });
      return respond(value);
    } catch (error) { if(error instanceof TestAccessError)throw error;console.error('banner_failed', error.name); return respond({ error: error instanceof BusyError ? error.message : 'Could not load or save the banner. Please try again.' }, 503); }
  }
  if (path === '/api/bootstrap' && request.method === 'GET') {
    await rememberUser(env, user);
    const { results } = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND (json_extract(data,'$.owner')=? OR json_extract(data,'$.cohost.id')=? OR EXISTS (SELECT 1 FROM json_each(records.data,'$.cohostLinks') AS link WHERE json_extract(link.value,'$.status')='active' AND json_extract(link.value,'$.cohost.id')=?) OR json_type(data,?) IS NOT NULL)").bind(user.id,user.id,user.id, `$.guests."${user.id}"`).all();
    const preference = await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first();
    const session = await env.DB.prepare("SELECT data FROM records WHERE kind='sessions' AND id=?").bind(String(user.id)).first();
    const s = session ? JSON.parse(session.data) : null;
    const pickerSession = s && (s.step === 'when' || s.step === 'permissions' || (s.step === 'edit' && s.field === 'when')) ? { token: s.token, event: s.event || null, deadlineDate: s.draft?.deadlineDate || '', deadlineTime: s.draft?.deadlineTime || '', timezone: s.draft?.deadlineTimezone || s.draft?.timezone || null } : null;
    const pricing=await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id='_pricing'").first();
    const pref=preference ? JSON.parse(preference.data) : {};
    const branding=await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id='_branding'").first();
    return respond({branding:{hasIcon:!!(branding && JSON.parse(branding.data).botIcon)},pricing:await readOnlinePricing(env,pricing ? JSON.parse(pricing.data) : {}),currencyCodes,localCurrency:localCurrency(pref), user: { id: user.id, firstName: user.first_name || 'Guest', isSuperAdmin: isSuperAdmin(user, env) }, preference: profilePreference(pref), session: pickerSession, events: results.map(r=>JSON.parse(r.data)).filter(e=>isManager(e,user.id) || (e.guests[user.id] && invitationAvailable(e,user.id))).map(e=>publicEvent(e,user.id,env.BOT_USERNAME)) });
  }
  if (request.method !== 'POST') return respond({ error: 'Not found' }, 404);
  const messageMatch=path.match(/^\/api\/events\/([a-f0-9]{16})\/messages\/(start|send|upload|undo|history|delete)$/);
  if(messageMatch)return guestMessageApi(request,env,user,messageMatch[1],messageMatch[2],respond);
  const raw = await request.text();
  if (raw.length > 24000) return respond({ error: 'Too much text.' }, 413);
  let input;
  try { input = JSON.parse(raw); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); }
  catch { return respond({ error: 'Invalid request.' }, 400); }
  try {
    if (path === '/api/preview') return respond(schedule(input));
    const value = await mutateState(env, async (data, bot) => {
      const id = user.id;
      const invitationMatch=path.match(/^\/api\/events\/([a-f0-9]{16})\/invitations\/(add|remove|edit|response|revoke|delete)$/);
      if(invitationMatch){
        const e=data.events[invitationMatch[1]],action=invitationMatch[2];
        const result=action==='add' ? addInvitations(e,id,input) : action==='remove' ? removeInvitation(e,id,input,data.sessions) : action==='edit' ? editInvitation(e,id,input,data.sessions) : action==='response' ? changeInvitationResponse(e,id,input,data.sessions) : action==='revoke' ? revokeInvitation(e,id,input,data.sessions) : deleteInvitation(e,id,input);
        const labels={yes:'Accepted',no:'Declined',maybe:'Maybe',later:'Respond later'};
        for(const uid of result.recipients || []){
          if(action==='response'){
            const count=participantCount(e,e.guests[uid]);
            const attendance=result.status==='yes'?`\n${count} ${count===1?'person':'people'}${paidEvent(e)&&!confirmed(e,e.guests[uid])?' · Payment required to confirm your place.':''}`:'';
            await bot.send(uid,`${e.title}\nThe organiser recorded your response: ${labels[result.status]}.${attendance}`,{inline_keyboard:[[{text:'Open event',callback_data:`v:${e.id}`}]]});
          }else await bot.send(uid,`Your invitation to ${e.title} has been ${action==='remove'?'removed':'revoked'} by the organiser.`);
        }
        const {recipients,...publicResult}=result;
        return {...publicResult,event:publicEvent(e,id,env.BOT_USERNAME)};
      }
      const ticketMatch=path.match(/^\/api\/events\/([a-f0-9]{16})\/(ticket|ticket-check)$/);
      if(ticketMatch){
        const e=data.events[ticketMatch[1]];
        if(ticketMatch[2]==='ticket')return {ticket:issueTicket(e,id)};
        if(input.checkIn!==undefined && typeof input.checkIn!=='boolean')throw new InputError('Invalid check-in request.');
        const ticket=verifyTicket(e,id,input.code,input.checkIn===true);
        if(input.checkIn===true && ticket.valid && !ticket.alreadyCheckedIn){
          const guestId=e.checkIns[ticket.code].userId;
          await bot.send(guestId,`✅ Checked in\n${e.title}\n${ticket.participants} ${ticket.participants===1?'person':'people'}`);
        }
        return {ticket};
      }
      if (path === '/api/preferences') {
        if(input.currency!==undefined && input.currency!=='' && !currencyCodes.includes(input.currency))throw new InputError('Choose a supported display currency.');
        data.preferences[id] = { ...data.preferences[id], timezone: timezone(input.timezone) };
        if(input.currency!==undefined)data.preferences[id].currency=input.currency;
        Object.assign(data.preferences[id],profileFields(input));
        return { preference: profilePreference(data.preferences[id]) };
      }
      if (path === '/api/events') {
        if (!/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw new InputError('Refresh the planner and try again.');
        const existing = Object.values(data.events).find(e => e.owner === id && e.createRequestId === input.requestId);
        if (existing) return { event: publicEvent(existing, id, env.BOT_USERNAME) };
        const title = field(input.title, 'Event name', 100, true);
        const location = field(input.location ?? '', 'Location', 300);
        const description = field(input.description ?? '', 'Description', 1500);
        const questions = [];
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
          if (!isManager(e,id) || e.cancelled) throw new InputError('Only an organiser can change an active event.');
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
      const cohostMatch=path.match(/^\/api\/events\/([a-f0-9]{16})\/cohost\/(invite|revoke)$/);
      if(cohostMatch){
        const e=data.events[cohostMatch[1]];
        if(!e || e.owner!==id)throw new InputError('Only the event owner can manage the co-host.');
        if(input.version!==cohostVersion(e))throw new InputError('Co-host access has changed. Refresh the event and try again.');
        if(cohostMatch[2]==='invite'){
          const entry=createCohostInvite(e,id,input.label);
          await bot.send(id,`Co-host invitation for ${e.title}${entry.label ? ` · ${entry.label}`:''}\n${cohostLink(e,env.BOT_USERNAME,entry.id)}\nShare this private link with your co-host. It can be used once.`);
        }else{
          const entry=cohostEntries(e).find(item=>item.id===input.linkId),previous=revokeCohost(e,id,input.linkId);
          if(previous && !isManager(e,previous.id)){
            if(data.sessions[previous.id]?.event===e.id)bot.session(previous.id);
            await bot.send(previous.id,`Your co-host access to ${e.title} has been removed.`);
          }
          await bot.send(id,`Co-host invitation revoked for ${e.title}${entry.label ? ` · ${entry.label}`:''}. Other co-host access is unchanged.`);
        }
        return {event:publicEvent(e,id,env.BOT_USERNAME)};
      }
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
        if (!isManager(e,id) || e.cancelled) throw new InputError('Only an organiser can change an active event.');
        if(e.owner!==id)cohostSettings(input,e);
        if(input.guestNames!==undefined && input.invitationsVersion!==undefined && input.invitationsVersion!==invitationsVersion(e))throw new InputError('Invitations or responses have changed. Refresh the event before editing the guest list.');
        const inviteSettings=invitationSettings(input,e,Date.now(),id);
        if(input.title!==undefined)e.title=field(input.title,'Event name',100,true);
        if(input.location!==undefined)e.location=field(input.location,'Location',300);
        if(input.description!==undefined)e.description=field(input.description,'Description',1500);
        Object.assign(e, schedule({ endMode: e.endMode || 'none', durationMinutes: e.durationMinutes, endDate: e.endDate, endTime: e.endTime, ...input }));
        Object.assign(e, eventSettings(input, e));
        Object.assign(e,inviteSettings);
        reconcileInvitationClaims(e,data.sessions);
        await bot.notify(e, `📣 ${e.title}: the organiser updated the event details. Tap My events for the latest details.`); await bot.card(id, e);
        return { event: publicEvent(e, id, env.BOT_USERNAME) };
      }
      throw new InputError('Not found');
    });
    return respond(value);
  } catch (e) {
    if (e instanceof TestAccessError) throw e;
    if (e instanceof BusyError) return respond({ error: e.message }, 503);
    // Validation errors are controlled strings; never expose database or fetch errors.
    if (e instanceof InputError) return respond({ error: e.message }, 400);
    console.error(JSON.stringify({ event: 'mini_api_failed', path }));
    return respond({ error: 'Could not save. Please try again.' }, 503);
  }
}
