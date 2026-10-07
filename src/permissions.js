export const permissionLabels = { guestList: 'See other guests', uploadMedia: 'Send photos, videos & files', viewMedia: 'See shared media' };
export const asksPhone=e=>e.askPhone === true;
export const asksComments=e=>e.askComments ?? (!e.invitationMode || e.invitationMode==='legacy');
export function permissions(event) {
  return Object.fromEntries(Object.keys(permissionLabels).map(key => [key, event.permissions?.[key] === true]));
}
export function can(event, userId, key) { return event.owner === userId || permissions(event)[key]; }
export const uploadLink = (e, username) => e.allowLinkUploads && permissions(e).uploadMedia && e.uploadToken && !e.cancelled ? `https://t.me/${username}?start=u_${e.uploadToken}` : null;
export const shareUploadLink = (e, username) => !e.cancelled && permissions(e).uploadMedia ? uploadLink(e, username) || `https://t.me/${username}?start=a_${e.id}` : null;
export function guests(event) { return Object.entries(event.guests).filter(([id]) => Number(id) !== event.owner).map(([, guest]) => guest); }
export function confirmed(event, guest) { return guest?.status === 'yes' && (!event.requireApproval || guest.approval === 'approved') && (!paidEvent(event) || guest.payment?.status === 'paid'); }
export function canSeeLocation(event, userId) { return event.owner === userId || (!(event.hideLocation || event.requireApproval || paidEvent(event)) || confirmed(event, event.guests[userId])); }
export function responsesClosed(event, now = Date.now()) { return !!event.responseDeadline && new Date(event.responseDeadline).getTime() <= now; }
const personalInvitation=(event,guest)=>event.invitationMode==='named' ? event.invitees?.[guest?.invitationToken] : null;
const validParticipants=count=>Number.isSafeInteger(count) && count>=1 && count<=10;
export function invitationParticipants(event, guest) {
  const invite=personalInvitation(event,guest);
  return invite?.participantMode!=='ask' && validParticipants(invite?.participants) ? invite.participants : null;
}
export function invitationParticipantMode(event,guest) {
  const invite=personalInvitation(event,guest);
  if(['ask','confirm'].includes(invite?.participantMode))return invite.participantMode;
  return invitationParticipants(event,guest)!==null ? 'preset' : 'default';
}
export function participantCount(event, guest) {
  const preset=invitationParticipants(event,guest);
  if(invitationParticipantMode(event,guest)!=='default')return validParticipants(guest?.participants) ? guest.participants : preset ?? 1;
  return event.askParticipantCount === true && Number.isSafeInteger(guest?.participants) && guest.participants >= 1 && guest.participants <= 10000 ? guest.participants : 1;
}
export function responseCounts(event) {
  const list = guests(event);
  const pending=list.filter(g=>g.status==='yes' && event.requireApproval && g.approval !== 'approved');
  const unpaid=list.filter(g=>g.status==='yes' && paidEvent(event) && (!event.requireApproval || g.approval==='approved') && g.payment?.status !== 'paid');
  return { yes: list.filter(g => confirmed(event, g)).length, participants: list.filter(g => confirmed(event, g)).reduce((sum, g) => sum + participantCount(event, g), 0), pendingParticipants: pending.reduce((sum, g) => sum + participantCount(event, g), 0), pending: pending.length, awaitingPayment:unpaid.length, no: list.filter(g => g.status === 'no').length, maybe: list.filter(g => g.status === 'maybe').length, later: list.filter(g => g.status === 'later').length };
}
import {paidEvent} from './event-payment.js';
