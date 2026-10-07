import {createHash} from 'node:crypto';
import {InputError} from './time.js';
import {isManager} from './cohosts.js';
import {invitationMode,invitationSettings,namedLink} from './invitations.js';
import {confirmed,participantCount} from './permissions.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
const validToken=token=>typeof token==='string' && /^[a-f0-9]{32}$/.test(token);
const validRequest=id=>typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const linkedGuests=(e,token)=>Object.entries(e.guests || {}).filter(([uid,g])=>Number(uid)!==e.owner && g.invitationToken===token);
const guestLine=g=>`${g.name}${g.participantMode==='ask' ? ' = ?' : g.participants ? ` = ${g.participants}${g.participantMode==='confirm'?'!':''}`:''}`;

// Includes responses and payment/check-in changes so a stale removal cannot silently
// remove a different response from the one the organiser reviewed.
export const invitationsVersion=e=>digest([e?.invitees || {},e?.guests || {},e?.checkIns || {}]);

export function managedInvitations(e,username) {
  return Object.entries(e.invitees || {}).map(([token,g])=>{
    const responses=linkedGuests(e,token).map(([uid,guest])=>({id:Number(uid),name:guest.name,status:guest.status,participants:guest.status==='yes'?participantCount(e,guest):0,comment:guest.comment || '',confirmed:confirmed(e,guest),paymentStatus:guest.payment?.status || null}));
    const statuses=[...new Set(responses.map(response=>response.status))];
    const responseCounts=Object.fromEntries(['yes','no','maybe','later'].map(status=>[status,responses.filter(response=>response.status===status).length]));
    return {token,name:g.name,participants:g.participants || null,participantMode:g.participantMode || null,claimed:!!g.respondedBy || responses.some(response=>['yes','no','maybe'].includes(response.status)),status:statuses.length>1?'mixed':statuses[0] || null,url:namedLink(e,token,username),responses,responseCounts,canNotify:responses.length>0,hasPayments:responses.some(response=>['reported','paid','processing','refund_pending','refund_failed'].includes(response.paymentStatus))};
  });
}

function managerOnly(e,actor,now) {
  if(!isManager(e,actor))throw new InputError('Only an organiser can manage invitations.');
  if(invitationMode(e)!=='named')throw new InputError('Personal invitations are available for guest-list events.');
  if(e.cancelled || Date.parse(e.endsAt || e.startsAt)<=now)throw new InputError('Invitations cannot be changed for cancelled or finished events.');
}
function currentVersion(e,version) {
  if(version!==invitationsVersion(e))throw new InputError('Invitations or responses have changed. Refresh the list and try again.');
}

export function addInvitations(e,actor,input,now=Date.now()) {
  managerOnly(e,actor,now);
  if(!validRequest(input.requestId))throw new InputError('Refresh the invitation list and try again.');
  if(typeof input.guestNames!=='string' || !input.guestNames.trim() || input.guestNames.length>10000)throw new InputError('Enter guest names, one per line, up to 10,000 characters.');
  const guestNames=input.guestNames.trim();
  const prior=e.invitationAddRequests?.[input.requestId];
  if(prior){
    if(prior.actor!==actor || prior.guestNames!==guestNames)throw new InputError('This request has already been used. Refresh and try again.');
    return {added:0,alreadyAdded:true};
  }
  currentVersion(e,input.version);
  const before=Object.keys(e.invitees || {}).length;
  const all=[...Object.values(e.invitees || {}).map(guestLine),guestNames].join('\n');
  const next=invitationSettings({guestNames:all},e);
  const added=Object.keys(next.invitees).length-before;
  Object.assign(e,next);
  e.invitationAddRequests ||= {};
  e.invitationAddRequests[input.requestId]={actor,guestNames,at:new Date(now).toISOString()};
  return {added};
}

export function removeInvitation(e,actor,input,sessions={},now=Date.now()) {
  managerOnly(e,actor,now);
  if(input.confirm!==true)throw new InputError('Confirm removing this invitation first.');
  if(typeof input.notify!=='boolean')throw new InputError('Choose Notify guest or Remove silently.');
  if(!validToken(input.token))throw new InputError('Choose an invitation to remove.');
  if(e.removedInvitations?.[input.token])return {removed:true,alreadyRemoved:true,notifyCount:0,recipients:[]};
  currentVersion(e,input.version);
  const invite=e.invitees?.[input.token];
  if(!invite)throw new InputError('This invitation is no longer available. Refresh the list.');
  const responses=linkedGuests(e,input.token),recipients=responses.map(([uid])=>Number(uid));
  e.removedInvitations ||= {};
  // Private audit record only. Financial ledgers stay in preferences and remain
  // accessible through payment support; removing access never sends a refund.
  e.removedInvitations[input.token]={invite:{...invite},responses:Object.fromEntries(responses),removedBy:actor,removedAt:new Date(now).toISOString(),notify:input.notify};
  delete e.invitees[input.token];
  for(const [uid] of responses){
    delete e.guests[uid];
    if(e.reminders)delete e.reminders[uid];
  }
  for(const [uid,session] of Object.entries(sessions))if(Number(uid)!==e.owner && session.event===e.id && (recipients.includes(Number(uid)) || session.response?.invitationToken===input.token))delete sessions[uid];
  return {removed:true,alreadyRemoved:false,notifyCount:input.notify?recipients.length:0,recipients:input.notify?recipients:[]};
}
