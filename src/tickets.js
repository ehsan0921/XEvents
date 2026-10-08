import qrcode from 'qrcode-generator';
import {createHmac,randomBytes} from 'node:crypto';
import {confirmed,participantCount} from './permissions.js';
import {InputError} from './time.js';
import {isManager} from './cohosts.js';

const minuteAt=now=>Math.floor(now/60000);
const secretValid=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const activeCodeState=(g,minute)=>!!g.ticketCode && typeof g.ticket==='string' && g.ticketCode.ticket===g.ticket && secretValid(g.ticketCode.secret) && g.ticketCode.issuedMinute===minute;

function minuteCode(e,g,secret,minute) {
  const step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(minute));
  const digest=createHmac('sha256',Buffer.from(secret,'hex')).update(`XEvents:check-in:${e.id}:${g.ticket}:`).update(step).digest();
  const offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}

// Creating an accepted booking ensures its stable QR/audit identity only. A
// rotating check-in code is issued separately, when its owner opens the ticket.
export function ensureTicket(e,id) {
  const g=e?.guests[id];
  if(!e || e.owner===id || e.cancelled || !confirmed(e,g))throw new InputError('Your ticket is not confirmed.');
  g.ticket ||= randomBytes(6).toString('hex').toUpperCase();
  return g.ticket;
}

export function issueTicket(e,id,now=Date.now()) {
  ensureTicket(e,id);
  if(e.endsAt && Date.parse(e.endsAt)<=now)throw new InputError('Event has finished. Check-in is closed.');
  const g=e.guests[id],minute=minuteAt(now);
  let state=g.ticketCode;
  if(!state || state.ticket!==g.ticket || !secretValid(state.secret))state={ticket:g.ticket,secret:randomBytes(32).toString('hex')};
  let code;
  for(let attempt=0;attempt<5;attempt++){
    code=minuteCode(e,g,state.secret,minute);
    const collision=Object.entries(e.guests).some(([uid,guest])=>Number(uid)!==id && Number(uid)!==e.owner && confirmed(e,guest) && activeCodeState(guest,minute) && minuteCode(e,guest,guest.ticketCode.secret,minute)===code);
    if(!collision)break;
    if(attempt===4)throw new InputError('A unique check-in code is not available. Try again in a moment.');
    state={ticket:g.ticket,secret:randomBytes(32).toString('hex')};
  }
  g.ticketCode={...state,issuedMinute:minute};
  let image=null;
  if(e.qrEnabled!==false){
    const payload=`XE1:${e.id}:${g.ticket}`;
    const qr=qrcode(0,'M');qr.addData(payload);qr.make();image=qr.createDataURL(6,24);
  }
  return {title:e.title,name:g.name,code,codeExpiresAt:new Date((minute+1)*60000).toISOString(),serverTime:new Date(now).toISOString(),participants:participantCount(e,g),image,checkedInAt:e.checkIns?.[g.ticket]?.at || null};
}

function failedAttempt(e,actor,minute) {
  e.ticketCheckAttempts ||= {};
  const prior=e.ticketCheckAttempts[actor];
  e.ticketCheckAttempts[actor]={minute,failed:prior?.minute===minute ? (prior.failed || 0)+1:1};
}

export function verifyTicket(e,actor,input,checkIn=false,now=Date.now()) {
  if(!isManager(e,actor))throw new InputError('Only an organiser can check tickets.');
  if(typeof input!=='string' || input.length>100)return {valid:false,reason:'Invalid ticket code.'};
  const value=input.trim().toUpperCase();
  const scanned=value.match(/^XE1:([A-F0-9]{16}):([A-F0-9]{12})$/);
  if(scanned && e.qrEnabled===false)return {valid:false,reason:'QR codes are disabled for this event. Enter the ticket code instead.'};
  if(scanned && scanned[1]!==e.id.toUpperCase())return {valid:false,reason:'This ticket belongs to another event.'};
  const supplied=scanned ? scanned[2]:value;
  const short=!scanned && /^\d{6}$/.test(supplied);
  if(!short && !/^[A-F0-9]{12}$/.test(supplied))return {valid:false,reason:'Enter a six-digit code or scan the ticket QR.'};
  if(e.cancelled)return {valid:false,reason:'Event cancelled.'};
  if(e.endsAt && Date.parse(e.endsAt)<=now)return {valid:false,reason:'Event has finished.'};
  const minute=minuteAt(now),attempts=e.ticketCheckAttempts?.[actor];
  if(short && attempts?.minute===minute && attempts.failed>=10)return {valid:false,reason:'Too many incorrect codes. Try next minute or scan the ticket QR.'};
  const matches=Object.entries(e.guests).filter(([uid,g])=>Number(uid)!==e.owner && confirmed(e,g) && (short ? activeCodeState(g,minute) && minuteCode(e,g,g.ticketCode.secret,minute)===supplied : g.ticket===supplied));
  if(matches.length!==1){
    if(short)failedAttempt(e,actor,minute);
    return {valid:false,reason:matches.length>1?'This code matches several tickets. Use the ticket QR, or request a new code next minute.':short?'Code expired or incorrect. Ask the guest to open their current ticket code.':'Ticket is not valid or no longer confirmed.'};
  }
  const [uid,g]=matches[0],code=g.ticket,prior=e.checkIns?.[code];
  if(Object.entries(e.guests).some(([otherId,other])=>otherId!==uid && Number(otherId)!==e.owner && other.ticket===code) || prior?.userId!==undefined && prior.userId!==Number(uid))return {valid:false,reason:'This ticket needs organiser review before check-in.'};
  if(checkIn && !prior){e.checkIns ||= {};e.checkIns[code]={userId:Number(uid),at:new Date(now).toISOString(),participants:participantCount(e,g)};}
  return {valid:true,code,name:g.name,participants:participantCount(e,g),alreadyCheckedIn:!!prior,checkedInAt:e.checkIns?.[code]?.at || null};
}
