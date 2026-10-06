import qrcode from 'qrcode-generator';
import {randomBytes} from 'node:crypto';
import {confirmed,participantCount} from './permissions.js';
import {InputError} from './time.js';

export function issueTicket(e,id) {
  const g=e?.guests[id];
  if(!e || e.owner===id || e.cancelled || !confirmed(e,g))throw new InputError('Your ticket is not confirmed.');
  g.ticket ||= randomBytes(6).toString('hex').toUpperCase();
  const payload=`XE1:${e.id}:${g.ticket}`;
  const qr=qrcode(0,'M');qr.addData(payload);qr.make();
  return {title:e.title,name:g.name,code:g.ticket,participants:participantCount(e,g),image:qr.createDataURL(6,24),checkedInAt:e.checkIns?.[g.ticket]?.at || null};
}
export function verifyTicket(e,actor,input,checkIn=false,now=Date.now()) {
  if(!e || e.owner!==actor)throw new InputError('Only the organiser can check tickets.');
  if(typeof input!=='string' || input.length>100)return {valid:false,reason:'Invalid ticket code.'};
  const value=input.trim().toUpperCase();
  const scanned=value.match(/^XE1:([A-F0-9]{16}):([A-F0-9]{12})$/);
  if(scanned && scanned[1]!==e.id.toUpperCase())return {valid:false,reason:'This ticket belongs to another event.'};
  const code=scanned ? scanned[2]:value;
  if(!/^[A-F0-9]{12}$/.test(code))return {valid:false,reason:'Invalid ticket code.'};
  if(e.cancelled)return {valid:false,reason:'Event cancelled.'};
  if(e.endsAt && Date.parse(e.endsAt)<=now)return {valid:false,reason:'Event has finished.'};
  const entry=Object.entries(e.guests).find(([uid,g])=>Number(uid)!==e.owner && g.ticket===code);
  if(!entry || !confirmed(e,entry[1]))return {valid:false,reason:'Ticket is not valid or no longer confirmed.'};
  const [uid,g]=entry,prior=e.checkIns?.[code];
  if(checkIn && !prior){e.checkIns ||= {};e.checkIns[code]={userId:Number(uid),at:new Date(now).toISOString(),participants:participantCount(e,g)};}
  return {valid:true,code,name:g.name,participants:participantCount(e,g),alreadyCheckedIn:!!prior,checkedInAt:e.checkIns?.[code]?.at || null};
}
