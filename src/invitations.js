import {randomBytes} from 'node:crypto';
import {InputError} from './time.js';
import {responsesClosed,invitationParticipants} from './permissions.js';
export {invitationParticipants,invitationParticipantMode} from './permissions.js';

export const invitationMode=e=>e.invitationMode || 'legacy';
export const oneTimeInvites=e=>e.oneTimeInvite ?? invitationMode(e)==='named';
const finalResponse=g=>['yes','no','maybe'].includes(g?.status);
function invitationHolder(e,token) {
  if(invitationMode(e)!=='named')return e.inviteClaimedBy || null;
  const invite=e.invitees?.[token];
  // Older invitations were bound on opening. Only a completed RSVP consumes them now.
  return invite?.respondedBy || (finalResponse(e.guests?.[invite?.claimedBy]) ? invite.claimedBy : null);
}
export function invitationAvailable(e,id,token=e?.guests?.[id]?.invitationToken) {
  if(!e)return false;
  if(invitationMode(e)==='named' && !e.invitees?.[token])return false;
  if(!oneTimeInvites(e))return true;
  const holder=invitationHolder(e,token);
  return !holder || holder===id;
}
function singleUseSettings(input,e,mode,invitees) {
  if(input.oneTimeInvite!==undefined && typeof input.oneTimeInvite!=='boolean')throw new InputError('One-time invitation links must be checked or unchecked.');
  const enabled=input.oneTimeInvite ?? (mode===invitationMode(e) ? oneTimeInvites(e) : mode==='named');
  const result={oneTimeInvite:enabled};
  if(!enabled || oneTimeInvites(e) && mode===invitationMode(e))return result;
  const responses=Object.entries(e.guests || {}).filter(([uid,g])=>Number(uid)!==e.owner && finalResponse(g));
  if(mode==='named'){
    const next={...invitees};
    for(const [token,invite] of Object.entries(next)){
      const matches=responses.filter(([,g])=>g.invitationToken===token);
      if(matches.length>1)throw new InputError('This invitation already has responses from several guests. Keep reusable links or create a new invitation.');
      next[token]={...invite,claimedBy:matches.length ? Number(matches[0][0]) : null,respondedBy:matches.length ? Number(matches[0][0]) : null};
    }
    result.invitees=next;
  } else {
    if(responses.length>1)throw new InputError('This event link already has responses from several guests. Keep it reusable or create a new event.');
    result.inviteClaimedBy=responses.length ? Number(responses[0][0]) : null;
  }
  return result;
}
export function consumeInvitation(e,id,response,sessions={}) {
  if(!invitationAvailable(e,id,response.invitationToken))throw new InputError('This invitation has already been used by another guest. Ask the organiser for your own link.');
  if(!oneTimeInvites(e))return;
  const named=invitationMode(e)==='named';
  // Preserve consumed links from before respondedBy existed, even when changing to Later.
  if(named && invitationHolder(e,response.invitationToken)===id)e.invitees[response.invitationToken].respondedBy=id;
  if(!finalResponse(response))return;
  if(named)Object.assign(e.invitees[response.invitationToken],{claimedBy:id,respondedBy:id});
  else e.inviteClaimedBy=id;
  // People who only opened the forwarded link must not retain an RSVP or media session.
  for(const [uid,g] of Object.entries(e.guests || {}))if(Number(uid)!==id && g.status==='later' && (!named || g.invitationToken===response.invitationToken)){
    delete e.guests[uid];
    if(e.reminders)delete e.reminders[uid];
    if(sessions[uid]?.event===e.id)delete sessions[uid];
  }
}
export function reconcileInvitationClaims(e,sessions={}) {
  if(oneTimeInvites(e))for(const [uid,guest] of Object.entries(e.guests || {}))if(Number(uid)!==e.owner && finalResponse(guest) && (invitationMode(e)!=='named' || e.invitees?.[guest.invitationToken]))consumeInvitation(e,Number(uid),guest,sessions);
}
export const namedLink=(e,token,username)=>`https://t.me/${username}?start=i_${e.id}_${token}`;
export function invitationSettings(input,e={}) {
  const mode=input.invitationMode ?? invitationMode(e);
  if(!['tickets','named','legacy'].includes(mode))throw new InputError('Choose ticket booking or named invitations.');
  if(e.id && mode!==invitationMode(e) && (Object.keys(e.guests || {}).length || Object.keys(e.invitees || {}).length))throw new InputError('Create a new event to change the invitation mode after links or responses exist.');
  if(mode==='named' && (input.isPublic ?? e.isPublic))throw new InputError('Named invitations must be private. Each guest gets their own link.');
  const result={invitationMode:mode};
  if(mode!=='named')return {...result,...singleUseSettings(input,e,mode)};
  if(input.guestNames===undefined)return {...result,invitees:e.invitees || {},...singleUseSettings(input,e,mode,e.invitees || {})};
  if(typeof input.guestNames!=='string' || input.guestNames.length>10000)throw new InputError('Enter guest names, one per line, up to 10,000 characters.');
  const entries=input.guestNames.split('\n').map(n=>n.trim()).filter(Boolean).map(line=>{
    if(!line.includes('='))return {name:line};
    const match=line.match(/^([^=]*?)\s*=\s*(?:(\?)|(\d+)\s*(!)?)\s*$/),participants=Number(match?.[3]);
    if(!match || !match[1].trim() || (!match[2] && (!Number.isSafeInteger(participants) || participants<1 || participants>10)))throw new InputError('Use Name = 1–10, Name = ?, or Name = 2! to set attendee choices.');
    const name=match[1].trim();
    if(match[2])return {name,participantMode:'ask'};
    return {name,participants,...(match[4] ? {participantMode:'confirm'} : {})};
  });
  const names=entries.map(g=>g.name);
  const emptyExisting=!!e.id && invitationMode(e)==='named' && !Object.keys(e.invitees || {}).length;
  if(!names.length && !emptyExisting || names.length>100 || names.some(n=>n.length>100) || new Set(names).size!==names.length)throw new InputError('Use 1–100 unique guest names, up to 100 characters each. Add a label to distinguish guests with the same name.');
  const previous=Object.entries(e.invitees || {}),invitees={};
  const opened=token=>Object.values(e.guests || {}).some(g=>g.invitationToken===token);
  for(const [token,g] of previous)if(!names.includes(g.name) && (g.claimedBy || opened(token)))throw new InputError('A claimed invitation cannot be removed from the guest list.');
  for(const entry of entries){
    const existing=previous.find(([,g])=>g.name===entry.name),token=existing?.[0] || randomBytes(16).toString('hex');
    const unchanged=existing && existing[1].participants===entry.participants && existing[1].participantMode===entry.participantMode;
    if(existing && (existing[1].claimedBy || opened(existing[0])) && !unchanged)throw new InputError('The attendee count or selection mode of a claimed invitation cannot be changed.');
    if(unchanged)invitees[token]=existing[1];
    else {
      invitees[token]={...(existing?.[1] || {claimedBy:null}),name:entry.name};
      if(entry.participants===undefined)delete invitees[token].participants;
      else invitees[token].participants=entry.participants;
      if(entry.participantMode===undefined)delete invitees[token].participantMode;
      else invitees[token].participantMode=entry.participantMode;
    }
  }
  return {...result,invitees,...singleUseSettings(input,e,mode,invitees)};
}
export function claimInvitation(e,token,id) {
  const invite=e?.invitees?.[token];
  if(!e || invitationMode(e)!=='named' || !invite || e.cancelled || e.owner===id || !invitationAvailable(e,id,token))throw new InputError('This invitation is unavailable or has already been used by another guest.');
  if(e.guests[id]?.invitationToken && e.guests[id].invitationToken!==token)throw new InputError('You already have a personal invitation for this event.');
  if(!e.guests[id] && responsesClosed(e))throw new InputError('The response deadline has passed.');
  if(e.guests[id] && !e.guests[id].invitationToken)throw new InputError('You already have a booking for this event.');
  e.guests[id] ||= {name:invite.name,invitationToken:token,status:'later',phone:'',answers:[],comment:''};
  e.guests[id].name=invite.name;
  const participants=invitationParticipants(e,e.guests[id]);
  const selected=e.guests[id].participants;
  if(participants!==null && (!Number.isSafeInteger(selected) || selected<1 || selected>10))e.guests[id].participants=participants;
  return e.guests[id];
}
