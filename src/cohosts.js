import {randomBytes,timingSafeEqual} from 'node:crypto';
import {InputError} from './time.js';

const validId=id=>Number.isSafeInteger(id) && id>0;
const validToken=token=>typeof token==='string' && /^[a-f0-9]{32}$/.test(token);
const validUsername=username=>typeof username==='string' && /^[A-Za-z0-9_]{1,32}$/.test(username);
const activeEvent=e=>!!e && !e.cancelled && !(e.endsAt && Date.parse(e.endsAt)<=Date.now());

export const isManager=(e,id)=>validId(id) && !!e && (e.owner===id || e.cohost?.id===id);
export const cohostVersion=e=>e?.cohost ? `${e.cohost.id}:${e.cohost.joinedAt}` : e?.cohostInvite?.token || 'none';

function ownerOnly(e,actor) {
  if(!e || !validId(actor) || e.owner!==actor)throw new InputError('Only the event owner can manage co-host access.');
}

export function cohostLink(e,username) {
  if(!activeEvent(e) || e.cohost || !/^[a-f0-9]{16}$/.test(e.id || '') || !validToken(e.cohostInvite?.token) || !validUsername(username))return null;
  return `https://t.me/${username}?start=c_${e.id}_${e.cohostInvite.token}`;
}

export function createCohostInvite(e,actor) {
  ownerOnly(e,actor);
  if(!activeEvent(e))throw new InputError('Co-host invitations are unavailable for cancelled or finished events.');
  if(e.cohost)throw new InputError('Revoke the current co-host before inviting someone else.');
  e.cohostInvite={token:randomBytes(16).toString('hex'),createdAt:new Date().toISOString()};
  return e.cohostInvite;
}

export function revokeCohost(e,actor) {
  ownerOnly(e,actor);
  const prior=e.cohost || null;
  e.cohost=null;e.cohostInvite=null;
  return prior;
}

export function claimCohost(e,token,user) {
  const unavailable=()=>new InputError('This co-host invitation is unavailable or has already been used.');
  if(!activeEvent(e) || e.cohost || !validToken(token) || !validToken(e.cohostInvite?.token) || !timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(e.cohostInvite.token,'hex')))throw unavailable();
  if(!validId(user?.id) || user.is_bot || user.id===e.owner)throw unavailable();
  if(typeof user.first_name!=='string' || !user.first_name.trim() || (user.last_name!==undefined && typeof user.last_name!=='string') || (user.username!==undefined && !validUsername(user.username)))throw new InputError('Your Telegram profile could not be verified. Reopen the invitation in Telegram.');
  const name=[user.first_name,user.last_name].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(name.length>160)throw new InputError('Your Telegram profile name is too long.');
  e.cohost={id:user.id,name,username:user.username || '',joinedAt:new Date().toISOString()};
  e.cohostInvite=null;
  return e.cohost;
}
