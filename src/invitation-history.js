const types=new Set(['created','opened','responded','changed','edited','revoked','deleted']);
const statuses=new Set(['yes','no','maybe','later']);
const modes=new Set(['default','preset','ask','confirm','fixed']);
const validId=id=>Number.isSafeInteger(id) && id>0;
const validCount=count=>Number.isSafeInteger(count) && count>=1 && count<=10;
const validDate=value=>typeof value==='string' && Number.isFinite(Date.parse(value));

function safeDetails(details) {
  const result={};
  for(const key of ['actorId','userId'])if(validId(details[key]))result[key]=details[key];
  if(!result.actorId && validId(details.actor))result.actorId=details.actor;
  if(['guest','organiser'].includes(details.actorRole))result.actorRole=details.actorRole;
  for(const key of ['status','previousStatus'])if(statuses.has(details[key]))result[key]=details[key];
  for(const key of ['participants','previousParticipants'])if(validCount(details[key]))result[key]=details[key];
  for(const key of ['name','previousName'])if(typeof details[key]==='string')result[key]=details[key].slice(0,100);
  for(const key of ['participantMode','previousParticipantMode'])if(modes.has(details[key]))result[key]=details[key];
  if(typeof details.notify==='boolean')result.notify=details.notify;
  return result;
}

// Audit entries contain no phone numbers, comments, payment details, or invitation
// links. Legacy invitations keep an empty timeline until a real action is recorded.
export function appendInvitationHistory(e,token,type,details={},now=Date.now()) {
  if(!e || !/^[a-f0-9]{32}$/.test(token || '') || !types.has(type))return;
  const at=new Date(now);
  if(!Number.isFinite(at.getTime()))return;
  e.invitationHistory ||= {};
  const history=Array.isArray(e.invitationHistory[token]) ? e.invitationHistory[token] : [];
  e.invitationHistory[token]=history;
  history.push({type,at:at.toISOString(),...safeDetails(details)});
}

export function invitationHistory(e,token) {
  const history=e?.invitationHistory?.[token];
  return Array.isArray(history) ? history.filter(entry=>types.has(entry?.type) && validDate(entry.at)).map(entry=>({type:entry.type,at:entry.at,...safeDetails(entry)})) : [];
}
