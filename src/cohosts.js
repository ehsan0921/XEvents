import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {InputError} from './time.js';

const validId=id=>Number.isSafeInteger(id) && id>0;
const validToken=token=>typeof token==='string' && /^[a-f0-9]{32}$/.test(token);
const validEntryId=id=>typeof id==='string' && /^[a-f0-9]{16}$/.test(id);
const validUsername=username=>typeof username==='string' && /^[A-Za-z0-9_]{1,32}$/.test(username);
const activeEvent=e=>!!e && !e.cancelled && !(e.endsAt && Date.parse(e.endsAt)<=Date.now());
const digest=(value,length)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,length);
const identity=value=>validId(value?.id) ? {id:value.id,name:typeof value.name==='string' ? value.name:'Co-host',username:typeof value.username==='string' ? value.username:'',joinedAt:typeof value.joinedAt==='string' ? value.joinedAt:''}:null;

// Reading old records never changes them. Once the list exists it is authoritative,
// so stale compatibility fields cannot restore revoked access.
export function cohostEntries(e) {
  let entries;
  if(Array.isArray(e?.cohostLinks))entries=e.cohostLinks;
  else {
    entries=[];
    const prior=identity(e?.cohost);
    if(prior)entries.push({id:digest(['legacy-cohost',e.id,prior.id,prior.joinedAt],16),token:null,label:'Existing co-host',createdAt:prior.joinedAt || e.createdAt || '',status:'active',cohost:prior});
    if(validToken(e?.cohostInvite?.token))entries.push({id:digest(['legacy-invite',e.id,e.cohostInvite.token],16),token:e.cohostInvite.token,label:'Existing invitation',createdAt:e.cohostInvite.createdAt || '',status:'pending',cohost:null});
  }
  const seen=new Set();
  return Object.freeze(entries.filter(entry=>{
    if(!validEntryId(entry?.id) || seen.has(entry.id) || !['pending','active','revoked'].includes(entry.status))return false;
    seen.add(entry.id);return true;
  }).map(entry=>{
    const cohost=identity(entry.cohost);
    return Object.freeze({id:entry.id,token:validToken(entry.token) ? entry.token:null,label:typeof entry.label==='string' ? entry.label:'',createdAt:typeof entry.createdAt==='string' ? entry.createdAt:'',status:entry.status,cohost:cohost && Object.freeze(cohost),...(typeof entry.revokedAt==='string' ? {revokedAt:entry.revokedAt}:{})});
  }));
}
export const cohostIds=e=>[...new Set(cohostEntries(e).filter(entry=>entry.status==='active' && entry.cohost).map(entry=>entry.cohost.id))];
export const isManager=(e,id)=>validId(id) && !!e && (e.owner===id || cohostIds(e).includes(id));
export const cohostVersion=e=>digest([e?.id || '',cohostEntries(e)],16);
export function cohostGuard(e,entryId) {
  const entry=cohostEntries(e).find(item=>item.id===entryId && item.status!=='revoked');
  return entry ? digest([e.id,entry],12):null;
}

function saveEntries(e,entries) {
  e.cohostLinks=entries;
  // Compatibility aliases remain useful to older readers; permissions use the list.
  e.cohost=entries.find(entry=>entry.status==='active' && entry.cohost)?.cohost || null;
  const pending=entries.findLast(entry=>entry.status==='pending' && validToken(entry.token));
  e.cohostInvite=pending ? {token:pending.token,createdAt:pending.createdAt}:null;
}
const mutableEntries=e=>cohostEntries(e).map(entry=>({...entry,cohost:entry.cohost && {...entry.cohost}}));

function ownerOnly(e,actor) {
  if(!e || !validId(actor) || e.owner!==actor)throw new InputError('Only the event owner can manage co-host access.');
}

export function cohostLink(e,username,linkId) {
  if(!activeEvent(e) || !validEntryId(e.id) || !validUsername(username))return null;
  const entries=cohostEntries(e),entry=linkId===undefined ? entries.findLast(item=>item.status==='pending' && validToken(item.token)):entries.find(item=>item.id===linkId);
  if(entry?.status!=='pending' || !validToken(entry.token))return null;
  return `https://t.me/${username}?start=c_${e.id}_${entry.token}`;
}

export function createCohostInvite(e,actor,label='') {
  ownerOnly(e,actor);
  if(!activeEvent(e))throw new InputError('Co-host invitations are unavailable for cancelled or finished events.');
  if(typeof label!=='string' || label.trim().length>80)throw new InputError('Co-host invitation label must be at most 80 characters.');
  const entries=mutableEntries(e),entry={id:randomBytes(8).toString('hex'),token:randomBytes(16).toString('hex'),label:label.trim().replace(/\s+/g,' '),createdAt:new Date().toISOString(),status:'pending',cohost:null};
  entries.push(entry);saveEntries(e,entries);
  return entry;
}

export function revokeCohost(e,actor,linkId) {
  ownerOnly(e,actor);
  if(!validEntryId(linkId))throw new InputError('Choose a co-host invitation to revoke.');
  const entries=mutableEntries(e),entry=entries.find(item=>item.id===linkId);
  if(!entry || entry.status==='revoked')throw new InputError('This co-host invitation is no longer available.');
  const prior=entry.status==='active' ? entry.cohost:null;
  entry.status='revoked';entry.revokedAt=new Date().toISOString();saveEntries(e,entries);
  return prior;
}

export function claimCohost(e,token,user) {
  const unavailable=()=>new InputError('This co-host invitation is unavailable or has already been used.');
  if(!activeEvent(e) || !validToken(token))throw unavailable();
  const entries=mutableEntries(e),entry=entries.find(item=>item.status==='pending' && validToken(item.token) && timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(item.token,'hex')));
  if(!entry)throw unavailable();
  if(!validId(user?.id) || user.is_bot || user.id===e.owner)throw unavailable();
  if(entries.some(item=>item.status==='active' && item.cohost?.id===user.id))throw new InputError('You are already a co-host of this event. This invitation is still available for someone else.');
  if(typeof user.first_name!=='string' || !user.first_name.trim() || (user.last_name!==undefined && typeof user.last_name!=='string') || (user.username!==undefined && !validUsername(user.username)))throw new InputError('Your Telegram profile could not be verified. Reopen the invitation in Telegram.');
  const name=[user.first_name,user.last_name].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(name.length>160)throw new InputError('Your Telegram profile name is too long.');
  entry.status='active';entry.cohost={id:user.id,name,username:user.username || '',joinedAt:new Date().toISOString()};saveEntries(e,entries);
  return entry.cohost;
}
