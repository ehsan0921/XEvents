import {createHash} from 'node:crypto';
import {InputError} from './time.js';
import {isManager} from './cohosts.js';
import {invitationMode,invitationSettings,namedLink,consumeInvitation,invitationAvailable} from './invitations.js';
import {confirmed,participantCount,requiresApproval} from './permissions.js';
import {paidEvent} from './event-payment.js';
import {applyDefaultReminder} from './reminders.js';
import {issueTicket} from './tickets.js';
import {appendInvitationHistory,invitationHistory} from './invitation-history.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
const validToken=token=>typeof token==='string' && /^[a-f0-9]{32}$/.test(token);
const validRequest=id=>typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const validCount=count=>Number.isSafeInteger(count) && count>=1 && count<=10;
const protectedPayment=g=>['reported','paid','processing','refund_pending','refund_failed'].includes(g.payment?.status);
const linkedGuests=(e,token)=>Object.entries(e.guests || {}).filter(([uid,g])=>Number(uid)!==e.owner && g.invitationToken===token);
const guestLine=g=>`${g.name}${g.participantMode==='ask' ? ' = ?' : g.participants ? ` = ${g.participants}${g.participantMode==='confirm'?'!':g.participantMode==='fixed'?'*':''}`:''}`;
export const hasRecordedResponse=(guest,history,id)=>typeof guest.responseRecorded==='boolean' ? guest.responseRecorded : !!guest.responseVersion || ['yes','no','maybe'].includes(guest.status) || history.some(entry=>['responded','changed'].includes(entry.type) && entry.userId===id);

// Includes responses and payment/check-in changes so a stale removal cannot silently
// remove a different response from the one the organiser reviewed.
export const invitationsVersion=e=>digest([e?.invitees || {},e?.guests || {},e?.checkIns || {},e?.removedInvitations || {},e?.invitationHistory || {},e?.oneTimeInvite,e?.cancelled,e?.endsAt,e?.responseDeadline,e?.paymentMethod,e?.starPrice,e?.starPricing]);

function invitationDto(e,token,g,username,entries,revoked=false) {
  const history=invitationHistory(e,token);
  const responses=entries.map(([uid,guest])=>{
    const id=Number(uid);
    const latest=history.filter(entry=>['responded','changed'].includes(entry.type) && entry.userId===id).reduce((last,entry)=>!last || Date.parse(entry.at)>=Date.parse(last.at)?entry:last,null);
    const responded=hasRecordedResponse(guest,history,id);
    return {id,name:guest.name,status:guest.status,responded,respondedAt:responded?latest?.at || null:null,participants:guest.status==='yes'?participantCount(e,guest):0,selectedParticipants:participantCount(e,guest),comment:guest.comment || '',confirmed:!revoked && confirmed(e,guest),paymentStatus:guest.payment?.status || null};
  });
  const statuses=[...new Set(responses.map(response=>response.status))];
  const responseCounts=Object.fromEntries(['yes','no','maybe','later'].map(status=>[status,responses.filter(response=>response.status===status).length]));
  return {token,name:g.name,participants:g.participants || null,participantMode:g.participantMode || null,claimed:!!g.respondedBy || responses.some(response=>['yes','no','maybe'].includes(response.status)),status:revoked?'revoked':statuses.length>1?'mixed':statuses[0] || null,url:revoked?null:namedLink(e,token,username),responses,responseCounts,canNotify:!revoked && responses.length>0,canChangeResponse:!revoked && responses.length>0,hasPayments:entries.some(([,guest])=>protectedPayment(guest)),history,historyIncomplete:!history.some(entry=>entry.type==='created'),...(revoked?{revoked:true,revokedAt:e.removedInvitations[token].revokedAt}:{})};
}

export function managedInvitations(e,username) {
  return Object.entries(e.invitees || {}).map(([token,g])=>invitationDto(e,token,g,username,linkedGuests(e,token)));
}

export function revokedInvitations(e,username) {
  return Object.entries(e.removedInvitations || {}).filter(([,archive])=>archive.revokedAt && !archive.deletedAt && archive.invite).map(([token,archive])=>{
    // Fixed-count rules are stored in the archived invitation, not the now absent
    // live link, so use that rule only to project the historical response summary.
    const snapshot={...e,invitees:{[token]:archive.invite}};
    return invitationDto(snapshot,token,archive.invite,username,Object.entries(archive.responses || {}),true);
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
  const next=invitationSettings({guestNames:all},e,now,actor);
  const added=Object.keys(next.invitees).length-before;
  const newTokens=Object.keys(next.invitees).filter(token=>!e.invitees?.[token]);
  Object.assign(e,next);
  for(const token of newTokens){
    e.invitees[token].createdAt ||= new Date(now).toISOString();
    if(!invitationHistory(e,token).some(entry=>entry.type==='created'))appendInvitationHistory(e,token,'created',{actorId:actor,actorRole:'organiser',name:e.invitees[token].name},now);
  }
  e.invitationAddRequests ||= {};
  e.invitationAddRequests[input.requestId]={actor,guestNames,at:new Date(now).toISOString()};
  return {added};
}

function mutationRequest(e,actor,input,action) {
  if(!validRequest(input.requestId))throw new InputError('Refresh the invitation list and try again.');
  const {version,requestId,...fields}=input;
  const fingerprint=digest([action,Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)))]);
  const prior=e.invitationManagementRequests?.[requestId];
  if(prior){
    if(prior.actor!==actor || prior.fingerprint!==fingerprint)throw new InputError('This request has already been used. Refresh and try again.');
    return {fingerprint,retry:{...prior.result,alreadyApplied:true,recipients:[],notifyCount:0}};
  }
  currentVersion(e,version);
  return {fingerprint};
}
function completeMutation(e,actor,input,fingerprint,result,now) {
  e.invitationManagementRequests ||= {};
  const {recipients,...saved}=result;
  e.invitationManagementRequests[input.requestId]={actor,fingerprint,result:saved,at:new Date(now).toISOString()};
  return result;
}
function activeInvite(e,token) {
  if(!validToken(token))throw new InputError('Choose an invitation to manage.');
  const invite=e.invitees?.[token];
  if(!invite)throw new InputError('This invitation is no longer available. Refresh the list.');
  return invite;
}
function clearInvitationSessions(e,token,recipients,sessions) {
  for(const [uid,session] of Object.entries(sessions))if(Number(uid)!==e.owner && session.event===e.id && (recipients.includes(Number(uid)) || session.response?.invitationToken===token))delete sessions[uid];
}

export function editInvitation(e,actor,input,sessions={},now=Date.now()) {
  managerOnly(e,actor,now);
  const request=mutationRequest(e,actor,input,'edit');if(request.retry)return request.retry;
  const invite=activeInvite(e,input.token);
  if(typeof input.name!=='string' || !input.name.trim() || input.name.trim().length>100 || /[\n\r=]/.test(input.name))throw new InputError('Use a guest name of 1–100 characters, without line breaks or =.');
  const name=input.name.trim(),mode=input.participantMode;
  if(Object.entries(e.invitees).some(([token,g])=>token!==input.token && g.name===name))throw new InputError('That guest name is already used. Add a label to distinguish them.');
  if(!['default','preset','ask','confirm','fixed'].includes(mode))throw new InputError('Choose how the guest sets their attendee count.');
  const participants=input.participants;
  if(['default','ask'].includes(mode) ? participants!==null : !validCount(participants))throw new InputError('Choose 1–10 people, or no preset for Ask guest and One person.');
  const previousMode=invite.participantMode || (invite.participants?'preset':'default');
  const attendanceChanged=previousMode!==mode || (invite.participants || null)!==participants;
  const responses=linkedGuests(e,input.token);
  if(attendanceChanged && responses.some(([,g])=>protectedPayment(g) || e.checkIns?.[g.ticket]))throw new InputError('Refund active payments or resolve check-in before changing attendee settings. You can still edit the guest name.');
  const previousName=invite.name,previousParticipants=invite.participants;
  invite.name=name;
  if(participants===null)delete invite.participants;else invite.participants=participants;
  if(['ask','confirm','fixed'].includes(mode))invite.participantMode=mode;else delete invite.participantMode;
  for(const [uid,g] of responses){
    g.name=name;
    if(attendanceChanged){
      g.participants=participants ?? (mode==='ask' && validCount(g.participants)?g.participants:1);
      // An organiser editing an unopened RSVP's attendee settings does not turn
      // the automatic Later placeholder into a response from that guest.
      if(hasRecordedResponse(g,invitationHistory(e,input.token),Number(uid)))g.responseVersion=(g.responseVersion || 0)+1;
    }
  }
  if(attendanceChanged || previousName!==name){
    clearInvitationSessions(e,input.token,responses.map(([uid])=>Number(uid)),sessions);
    appendInvitationHistory(e,input.token,'edited',{actorId:actor,actorRole:'organiser',name,previousName,participants,previousParticipants,participantMode:mode,previousParticipantMode:previousMode},now);
  }
  return completeMutation(e,actor,input,request.fingerprint,{edited:true,recipients:[]},now);
}

export function changeInvitationResponse(e,actor,input,sessions={},now=Date.now()) {
  managerOnly(e,actor,now);
  const request=mutationRequest(e,actor,input,'response');if(request.retry)return request.retry;
  const invite=activeInvite(e,input.token);
  if(typeof input.notify!=='boolean')throw new InputError('Choose whether to notify the guest.');
  if(!['yes','no','maybe','later'].includes(input.status))throw new InputError('Choose Accept, Decline, Maybe, or Respond later.');
  const responses=linkedGuests(e,input.token);
  if(!responses.length)throw new InputError('The guest must open their invitation before you can record a response.');
  if(!Number.isSafeInteger(input.userId) || input.userId<=0)throw new InputError('Choose the guest response to change.');
  const entry=responses.find(([uid])=>Number(uid)===input.userId);
  if(!entry)throw new InputError('That guest response is no longer available. Refresh the list.');
  const [uid,guest]=entry;
  if(!invitationAvailable(e,input.userId,input.token))throw new InputError('This invitation belongs to another guest.');
  if(input.participants!==undefined && !validCount(input.participants))throw new InputError('Choose 1–10 people.');
  if(invite.participantMode==='fixed' && input.participants!==undefined && input.participants!==invite.participants)throw new InputError('This invitation has a fixed attendee count. Edit the invitation settings first.');
  if(!invite.participants && !invite.participantMode && input.participants!==undefined && input.participants!==1)throw new InputError('This invitation is for one person. Edit its attendee settings first.');
  const previousStatus=guest.status,previousParticipants=participantCount(e,guest);
  const response={...guest,status:input.status};
  if(input.participants!==undefined)response.participants=input.participants;
  const participants=participantCount(e,response);
  const recorded=hasRecordedResponse(guest,invitationHistory(e,input.token),input.userId);
  const changed=previousStatus!==input.status || input.status==='yes' && participants!==previousParticipants || input.status==='later' && !recorded;
  if(changed && protectedPayment(guest))throw new InputError('Resolve or refund the active payment before changing this response.');
  if(changed && e.checkIns?.[guest.ticket])throw new InputError('This guest is already checked in. Their response cannot be changed.');
  if(!changed)return completeMutation(e,actor,input,request.fingerprint,{changed:false,notifyCount:0,recipients:[]},now);
  consumeInvitation(e,input.userId,response,sessions);
  response.responseVersion=(guest.responseVersion || 0)+1;
  response.responseRecorded=true;
  if(response.status==='yes'){
    response.participants=participants;
    response.approval=requiresApproval(e)?'pending':'approved';
    if(paidEvent(e) || requiresApproval(e))delete response.ticket;
  }else{
    delete response.approval;delete response.ticket;
    if(e.reminders)delete e.reminders[uid];
  }
  e.guests[uid]=response;
  if(sessions[uid]?.event===e.id)delete sessions[uid];
  if(confirmed(e,response)){issueTicket(e,input.userId);applyDefaultReminder(e,input.userId,now);}
  appendInvitationHistory(e,input.token,recorded?'changed':'responded',{actorId:actor,actorRole:'organiser',userId:input.userId,name:response.name,status:response.status,previousStatus,participants:response.status==='yes'?participants:undefined,previousParticipants:previousStatus==='yes'?previousParticipants:undefined,notify:input.notify},now);
  return completeMutation(e,actor,input,request.fingerprint,{changed:true,status:response.status,notifyCount:input.notify?1:0,recipients:input.notify?[input.userId]:[]},now);
}

export function revokeInvitation(e,actor,input,sessions={},now=Date.now()) {
  managerOnly(e,actor,now);
  const request=mutationRequest(e,actor,input,'revoke');if(request.retry)return request.retry;
  if(input.confirm!==true)throw new InputError('Confirm revoking this invitation first.');
  if(typeof input.notify!=='boolean')throw new InputError('Choose whether to notify the guest.');
  const invite=activeInvite(e,input.token);
  const responses=linkedGuests(e,input.token),recipients=responses.map(([uid])=>Number(uid));
  const at=new Date(now).toISOString();
  e.removedInvitations ||= {};
  e.removedInvitations[input.token]={invite:structuredClone(invite),responses:structuredClone(Object.fromEntries(responses)),removedBy:actor,removedAt:at,revokedBy:actor,revokedAt:at,notify:input.notify};
  delete e.invitees[input.token];
  for(const [uid] of responses){delete e.guests[uid];if(e.reminders)delete e.reminders[uid];}
  clearInvitationSessions(e,input.token,recipients,sessions);
  appendInvitationHistory(e,input.token,'revoked',{actorId:actor,actorRole:'organiser',name:invite.name,notify:input.notify},now);
  return completeMutation(e,actor,input,request.fingerprint,{revoked:true,notifyCount:input.notify?recipients.length:0,recipients:input.notify?recipients:[]},now);
}

export function deleteInvitation(e,actor,input,now=Date.now()) {
  managerOnly(e,actor,now);
  const request=mutationRequest(e,actor,input,'delete');if(request.retry)return request.retry;
  if(input.confirm!==true)throw new InputError('Confirm deleting this revoked invitation first.');
  if(!validToken(input.token))throw new InputError('Choose an invitation to delete.');
  const archive=e.removedInvitations?.[input.token];
  if(e.invitees?.[input.token] || !archive?.revokedAt || archive.deletedAt)throw new InputError('Revoke the invitation before deleting it from this list.');
  archive.deletedAt=new Date(now).toISOString();archive.deletedBy=actor;
  appendInvitationHistory(e,input.token,'deleted',{actorId:actor,actorRole:'organiser',name:archive.invite.name},now);
  return completeMutation(e,actor,input,request.fingerprint,{deleted:true,recipients:[]},now);
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
