import {randomBytes} from 'node:crypto';
import {InputError} from './time.js';
import {responsesClosed,invitationParticipants} from './permissions.js';
export {invitationParticipants,invitationParticipantMode} from './permissions.js';

export const invitationMode=e=>e.invitationMode || 'legacy';
export const namedLink=(e,token,username)=>`https://t.me/${username}?start=i_${e.id}_${token}`;
export function invitationSettings(input,e={}) {
  const mode=input.invitationMode ?? invitationMode(e);
  if(!['tickets','named','legacy'].includes(mode))throw new InputError('Choose ticket booking or named invitations.');
  if(e.id && mode!==invitationMode(e) && (Object.keys(e.guests || {}).length || Object.keys(e.invitees || {}).length))throw new InputError('Create a new event to change the invitation mode after links or responses exist.');
  if(mode==='named' && (input.isPublic ?? e.isPublic))throw new InputError('Named invitations must be private. Each guest gets their own link.');
  const result={invitationMode:mode};
  if(mode!=='named')return result;
  if(input.guestNames===undefined)return {...result,invitees:e.invitees || {}};
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
  if(!names.length || names.length>100 || names.some(n=>n.length>100) || new Set(names).size!==names.length)throw new InputError('Use 1–100 unique guest names, up to 100 characters each. Add a label to distinguish guests with the same name.');
  const previous=Object.entries(e.invitees || {}),invitees={};
  for(const [token,g] of previous)if(!names.includes(g.name) && g.claimedBy)throw new InputError('A claimed invitation cannot be removed from the guest list.');
  for(const entry of entries){
    const existing=previous.find(([,g])=>g.name===entry.name),token=existing?.[0] || randomBytes(16).toString('hex');
    const unchanged=existing && existing[1].participants===entry.participants && existing[1].participantMode===entry.participantMode;
    if(existing?.[1].claimedBy && !unchanged)throw new InputError('The attendee count or selection mode of a claimed invitation cannot be changed.');
    if(unchanged)invitees[token]=existing[1];
    else {
      invitees[token]={...(existing?.[1] || {claimedBy:null}),name:entry.name};
      if(entry.participants===undefined)delete invitees[token].participants;
      else invitees[token].participants=entry.participants;
      if(entry.participantMode===undefined)delete invitees[token].participantMode;
      else invitees[token].participantMode=entry.participantMode;
    }
  }
  return {...result,invitees};
}
export function claimInvitation(e,token,id) {
  const invite=e?.invitees?.[token];
  if(!e || invitationMode(e)!=='named' || !invite || e.cancelled || e.owner===id || (invite.claimedBy && invite.claimedBy!==id))throw new InputError('This personal invitation is unavailable or already linked to another Telegram account.');
  if(e.guests[id]?.invitationToken && e.guests[id].invitationToken!==token)throw new InputError('You already have a personal invitation for this event.');
  if(!invite.claimedBy && responsesClosed(e))throw new InputError('The response deadline has passed.');
  if(e.guests[id] && !e.guests[id].invitationToken)throw new InputError('You already have a booking for this event.');
  invite.claimedBy=id;
  e.guests[id] ||= {name:invite.name,invitationToken:token,status:'later',phone:'',answers:[],comment:''};
  e.guests[id].name=invite.name;
  const participants=invitationParticipants(e,e.guests[id]);
  const selected=e.guests[id].participants;
  if(participants!==null && (!Number.isSafeInteger(selected) || selected<1 || selected>10))e.guests[id].participants=participants;
  return e.guests[id];
}
