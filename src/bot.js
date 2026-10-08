import {paymentMethod,paidEvent} from './event-payment.js';
import {invitationMode,claimInvitation,invitationSettings,invitationParticipantMode,oneTimeInvites,invitationAvailable,consumeInvitation,reconcileInvitationClaims} from './invitations.js';
import {isManager,cohostEntries,cohostIds,cohostGuard,cohostLink,createCohostInvite,revokeCohost,claimCohost} from './cohosts.js';
import {invitationLinksCard,invitationCopyCard} from './invitation-links.js';
import {appendInvitationHistory} from './invitation-history.js';
import {startChatCreation,chatCreationMessage,chatCreationCallback} from './chat-creation.js';
import {manualInstructions,manualReport,manualConfirm} from './manual-payment.js';
import { priceText } from './pricing.js';
import { randomBytes } from 'node:crypto';
import { invoice, checkout, successful, orderFor, requestRefund, refundResult } from './payments.js';
import { eventTime } from './time.js';
import { uploadLink, shareUploadLink,asksPhone,asksComments,requiresApproval,asksParticipantCount,hidesLocation } from './permissions.js';
import { upcoming, eventGroup, setReminder, reminderOptions, reminderLabel, applyDefaultReminder } from './reminders.js';
import { permissions, permissionLabels, can, guests, confirmed, canSeeLocation, responsesClosed, responseCounts, participantCount } from './permissions.js';

const labels = { yes: '✅ Accepted', no: '❌ Not coming', maybe: '🤔 Tentative', later: '⏳ Respond later' };
const button = (text, callback_data) => ({ text, callback_data });
const keyboard = (...rows) => ({ inline_keyboard: rows });
const paired = buttons => Array.from({ length: Math.ceil(buttons.length / 2) }, (_, index) => buttons.slice(index * 2, index * 2 + 2));
const name = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Guest';
const clean = (s, max = 1000) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const changeCountLabel = count => `${count} ${count===1?'person':'people'} · Change`;
const hasRecordedResponse = guest => typeof guest?.responseRecorded==='boolean' ? guest.responseRecorded : guest?.responseVersion>0 || ['yes','no','maybe'].includes(guest?.status);
const menu = { new: '🎉 Create event', events: '📅 My events', help: '❓ Help', home: '🏠 Main menu', cancel: '✖️ Cancel input', skip: '⏭ Skip', done: '✅ Finish uploads', name: '👤 Use Telegram name', app: 'App', picker: '🗓 Pick date & time', pending: '⏳ Pending invitations' };
const reply = (...rows) => ({ keyboard: rows.map(row => row.map(text => typeof text === 'string' ? { text } : text)), resize_keyboard: true, is_persistent: true });
// The authenticated App launcher lives in Telegram's built-in chat menu.
const homeKeyboard = () => reply([menu.new, menu.events], [menu.help]);

export class Bot {
  constructor(store, api, username, appUrl) { this.store = store; this.api = api; this.username = username; this.appUrl = appUrl; this.store.data.preferences ||= {}; }
  get db() { return this.store.data; }
  send(id, text, reply_markup, entities) { return this.api('sendMessage', { chat_id: id, text, ...(reply_markup ? { reply_markup } : {}), ...(entities ? { entities } : {}) }); }
  clearButtons(id,message){if(message?.chat?.id!==id || !Number.isSafeInteger(message.message_id) || message.message_id<=0)return Promise.resolve();return this.api('editMessageReplyMarkup',{chat_id:id,message_id:message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});}
  async long(id, text, markup) {
    for (let i = 0; i < text.length; i += 3900) await this.send(id, text.slice(i, i + 3900), i + 3900 >= text.length ? markup : undefined);
  }
  inputKeyboard(s) {
    if (this.appUrl && (s.step === 'when' || (s.step === 'edit' && s.field === 'when'))) return reply([menu.picker], [menu.cancel]);
    if (s.step === 'phone') return reply([{ text: '📱 Share my phone number', request_contact: true }], [menu.skip, menu.cancel]);
    if (s.step === 'name') return reply([menu.name], [menu.cancel]);
    if (s.step === 'upload') return reply([menu.done], [menu.cancel]);
    if (['description', 'inviteMessage', 'comment', 'banner', 'cohostLabel'].includes(s.step)) return reply([menu.skip], [menu.cancel]);
    return reply([menu.cancel]);
  }
  prompt(id, text) { return this.send(id, text, this.inputKeyboard(this.db.sessions[id])); }
  participantPicker(id,e,more=false) {
    const s=this.db.sessions[id];
    if(!s || s.event!==e.id)return this.card(id,e);
    s.countToken ||= randomBytes(4).toString('hex');
    s.baseVersion ??= e.guests[id]?.responseVersion || 0;
    const start=more?6:1;
    return this.send(id,'How many people? Include yourself. Max 10.',keyboard(
      Array.from({length:5},(_,i)=>button(String(start+i),`size:${e.id}:${start+i}:${s.countToken}`)),
      [button(more?'1–5':'More · 6–10',`size:${e.id}:${more?'first':'more'}:${s.countToken}`)],
      [button('Cancel',`v:${e.id}`)]));
  }
  participantConfirmation(id,e,s) {
    s.step='participantConfirm';s.countToken ||= randomBytes(4).toString('hex');
    s.baseVersion ??= e.guests[id]?.responseVersion || 0;
    const count=participantCount(e,s.response);
    return this.send(id,`Confirm ${count} ${count===1?'person':'people'} attending?`,keyboard(
      [button(`Yes, ${count}`,`count-confirm:${e.id}:yes:${s.countToken}`),button(changeCountLabel(count),`count-confirm:${e.id}:change:${s.countToken}`)],
      [button('Cancel',`v:${e.id}`)]));
  }
  countEditable(e,id) {
    const g=e?.guests[id];
    return !!(g && invitationParticipantMode(e,g)!=='fixed' && !isManager(e,id) && !e.cancelled && !responsesClosed(e) && !['reported','paid','processing','refund_pending','refund_failed'].includes(g.payment?.status) && !e.checkIns?.[g.ticket]);
  }
  async chooseParticipants(id,e,s,count) {
    if(!this.countEditable(e,id) || s.baseVersion!==(e.guests[id]?.responseVersion || 0)){this.session(id);return this.card(id,e);}
    if(!Number.isSafeInteger(count) || count<1 || count>10)return this.participantPicker(id,e);
    const explicit=invitationParticipantMode(e,s.response)!=='default';
    s.response.participants=explicit || asksParticipantCount(e) ? count : 1;
    if(s.countOnly){
      if(s.response.participants===participantCount(e,e.guests[id])){this.session(id);return this.card(id,e);}
      if(s.response.status==='yes')return this.saveResponse(id,e,s.response);
      const previous=e.guests[id];
      e.guests[id]={...previous,participants:s.response.participants,responseVersion:(previous.responseVersion || 0)+1};
      appendInvitationHistory(e,previous.invitationToken,hasRecordedResponse(previous)?'changed':'edited',{actorRole:'guest',actorId:id,userId:id,name:previous.name,...(hasRecordedResponse(previous)?{status:previous.status,previousStatus:previous.status}:{}),participants:s.response.participants,previousParticipants:participantCount(e,previous)});
      this.session(id);return this.card(id,e);
    }
    return this.afterIdentity(id,e,s);
  }
  hasPending(id) { return Object.values(this.db.events).some(e => this.allowed(e,id) && !isManager(e,id) && invitationMode(e)!=='tickets' && !e.cancelled && e.guests[id]?.status === 'later'); }
  home(id, text = 'Welcome to XEvents 🎉\nTap Create event or My events below.') { return this.send(id, text, homeKeyboard()); }
  session(id, value) { if (value) this.db.sessions[id] = value; else delete this.db.sessions[id]; }
  link(e) { return `https://t.me/${this.username}?start=e_${e.id}`; }
  miniButton(text, params = '') { return { text, web_app: { url: this.appUrl + params } }; }
  time(e, id) { return eventTime(e, this.db.preferences[id]?.timezone); }
  allowed(e, id) { return e && (isManager(e,id) || !!e.guests[id] && invitationAvailable(e,id)); }
  mediaAllowed(e, id) { return e && (this.allowed(e, id) || (this.db.preferences[id]?.mediaAccess?.[e.id] === e.uploadToken && !!uploadLink(e, this.username))); }
  async mediaCard(id, e) {
    if (!this.mediaAllowed(e, id) || e.cancelled) return this.home(id, 'This media link is unavailable.');
    const rows=[];
    if (can(e,id,'uploadMedia')) rows.push([button('📎 Add media',`media-add:${e.id}`)]);
    if (this.appUrl && can(e,id,'viewMedia')) rows.push([this.miniButton('🗂 Shared media',`?gallery=${e.id}`)]);
    rows.push([button(menu.home,'nav:home')]);
    if (e.banner) return this.api('sendPhoto',{chat_id:id,photo:e.banner,caption:e.title,reply_markup:keyboard(...rows)});
    return this.send(id,e.title,keyboard(...rows));
  }
  permissionKeyboard(e, prefix) {
    const settings = permissions(e);
    return paired([
      ...Object.entries({ guestList: 'Guest list', uploadMedia: 'Upload media', viewMedia: 'View media' }).map(([key, label]) => button(`${settings[key] ? '✅' : '⬜'} ${label}`, `${prefix}:${key}`)),
      ...(invitationMode(e)==='named' ? [] : [button(`${asksParticipantCount(e) ? '✅' : '⬜'} Group size`, `${prefix}:askParticipantCount`)]),
      button(`${asksPhone(e) ? '✅' : '⬜'} Ask phone`,`${prefix}:askPhone`),button(`${asksComments(e) ? '✅' : '⬜'} Ask comments`,`${prefix}:askComments`),
      button(`${e.qrEnabled!==false ? '✅' : '⬜'} QR codes`,`${prefix}:qrEnabled`),
      button(`${oneTimeInvites(e) ? '✅' : '⬜'} One-time links`,`${prefix}:oneTimeInvite`),
      ...(invitationMode(e)==='named' ? [] : [button(`${requiresApproval(e) ? '✅' : '⬜'} Approval`, `${prefix}:requireApproval`)]),
      button(`${hidesLocation(e) || requiresApproval(e) ? '✅' : '⬜'} Private location`, `${prefix}:hideLocation`),
      button(`${e.isPublic ? '🌍 Public' : '🔒 Private'}`, `${prefix}:isPublic`),
      button(`${e.allowLinkUploads ? '✅' : '⬜'} Link uploads`, `${prefix}:allowLinkUploads`)
    ]);
  }
  async creationPermissions(id, s) {
    const buttons = [
      button('Ticket link',`pc:${s.token}:mode-tickets`),button('Named invitations',`pc:${s.token}:mode-named`),
      ...this.permissionKeyboard(s.draft, `pc:${s.token}`).flat(),
      ...(this.appUrl ? [this.miniButton('🗓 Reply deadline', `?mode=deadline&session=${s.token}`)] : []),
      button('🔔 ' + reminderLabel(s.draft.defaultReminder || 0), `pc:${s.token}:defaultReminder`),
      button(s.draft.banner ? '🖼 Replace banner' : '🖼 Add banner', `pb:${s.token}`),
      button('🎉 Create event', `pd:${s.token}`), button('Cancel', 'nav:home')
    ];
    return this.send(id, `Guest options\nTap to enable extras.${invitationMode(s.draft)==='named' ? '\nCounts come from your guest list; no approval is needed.' : ''}\nReminder: ${reminderLabel(s.draft.defaultReminder || 0)}\nReply deadline: ${s.draft.responseDeadline || 'None'}`, keyboard(...paired(buttons)));
  }
  async pendingInvitations(id) {
    const events = Object.values(this.db.events).filter(e => this.allowed(e,id) && !isManager(e,id) && invitationMode(e)!=='tickets' && !e.cancelled && e.guests[id]?.status === 'later');
    await this.home(id, events.length ? '⏳ Invitations you haven’t responded to yet. Tap an event to respond.' : 'You have no unanswered invitations.');
    for (const e of events) await this.send(id, `${e.title}\n${this.time(e, id)}${responsesClosed(e) ? '\nResponses closed — deadline passed' : ''}`, keyboard([button('Open invitation', `v:${e.id}`)]));
  }
  async ticket(id, e) {
    const g = e.guests[id];
    if (!g || !confirmed(e, g) || e.owner === id || e.cancelled) return this.send(id, 'Your invitation details will be available after your response is approved.');
    g.ticket ||= randomBytes(6).toString('hex').toUpperCase();
    return this.long(id, `🎟 ${invitationMode(e)==='tickets' ? 'YOUR TICKET' : 'YOUR INVITATION'}\n\n${e.title}\nGuest: ${g.name}\nPeople: ${participantCount(e, g)}\nTicket: ${g.ticket}\n\n🗓 ${this.time(e, id)}\n${priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing)}\n📍 ${e.location || 'Location to follow'}${e.ticketInfo ? '\n\n' + e.ticketInfo : ''}\n\n✅ Your place is confirmed.`, keyboard(...(this.appUrl && e.qrEnabled!==false?[[this.miniButton('🎟 Ticket QR',`?ticket=${e.id}`)]]:[]),[button('Back to event', `v:${e.id}`)]));
  }
  paymentInfo(id,e){return paymentMethod(e)==='stars'?invoice(this,id,e):manualInstructions(this,id,e);}
  async beginAcceptance(id,e,from){
    if(isManager(e,id) || responsesClosed(e))return this.card(id,e);
    if(['paid','processing','refund_pending','refund_failed'].includes(e.guests[id]?.payment?.status))return this.card(id,e);
    const response={...(e.guests[id] || {name:name(from),phone:''}),answers:[],status:'yes'};
    const personal=invitationMode(e)==='named';
    const countMode=invitationParticipantMode(e,response);
    const step=personal ? countMode==='ask' || (countMode==='default' && asksParticipantCount(e)) ? 'participants' : countMode==='confirm' ? 'participantConfirm' : 'phone' : 'name';
    if(personal)response.participants=participantCount(e,response);
    this.session(id,{event:e.id,step,response});
    if(step==='participantConfirm')return this.participantConfirmation(id,e,this.db.sessions[id]);
    if(personal && step!=='participants')return this.afterIdentity(id,e,this.db.sessions[id]);
    if(step==='participants')return this.participantPicker(id,e);
    return this.prompt(id,personal ? 'Share your phone number, or tap Skip.' : 'Name for your ticket? Type it or use your Telegram name.');
  }
  namedInvitationContent(e,g,id,sharing=false) {
    const visible=sharing ? !(hidesLocation(e) || requiresApproval(e) || paidEvent(e)) : canSeeLocation(e,id);
    const location=visible ? e.location || 'The organiser will share the location.' : paidEvent(e) ? requiresApproval(e) ? 'Location will be available after approval and payment.' : 'Location will be available after confirmed payment.' : requiresApproval(e) ? 'Location will be available after your response is approved.' : 'Location will be available after you accept.';
    const count=participantCount(e,g),mode=invitationParticipantMode(e,g);
    const deadline=e.responseDeadline ? '\n⏰ Respond by: '+eventTime({startsAt:e.responseDeadline,timezone:e.deadlineTimezone || e.timezone || 'UTC'},this.db.preferences[id]?.timezone)+(responsesClosed(e) ? '\nResponses closed — deadline passed.' : '') : '';
    const intro=`Dear ${g.name},\n\nYou are invited to ${e.title} on ${this.time(e,id)}.\n📍 ${location}\n\n`;
    const asks=mode==='ask' || mode==='default' && asksParticipantCount(e),places=`${count} ${count===1?'place':'places'}`;
    const text=`${intro}${asks ? 'Choose how many people will attend when you accept (1–10).' : `The host has reserved ${places} for you.${mode==='fixed'?' This count is fixed.':''}`}\nPlease respond below.${deadline}\n${priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing)}\n\n`;
    return {text,entities:asks ? [] : [{type:'bold',offset:intro.length+'The host has reserved '.length,length:places.length}]};
  }
  namedInvitationText(e,g,id,sharing=false) { return this.namedInvitationContent(e,g,id,sharing).text; }
  personalLinks(id,e,page=0){return invitationLinksCard(this,id,e,page);}
  cohostCard(id,e,page=0){
    if(e.owner!==id)return this.send(id,'Only the owner can manage co-host access.');
    const entries=cohostEntries(e),pages=Math.max(1,Math.ceil(entries.length/10)),requested=Number(page);
    const current=Number.isSafeInteger(requested) && requested>=0 ? Math.min(requested,pages-1):0;
    const visible=entries.slice(current*10,(current+1)*10),rows=paired(visible.map(entry=>button(Array.from(`${entry.status==='active'?'✅':entry.status==='revoked'?'🚫':'🔗'} ${entry.label || entry.cohost?.name || 'Co-host link'}`).slice(0,64).join(''),`co-entry:${e.id}:${entry.id}`)));
    const lines=visible.map(entry=>`${entry.label || 'Co-host link'} · ${entry.status}${entry.cohost ? `\n${entry.cohost.name} · ${entry.cohost.username?'@'+entry.cohost.username:'No Telegram username'} · ID ${entry.cohost.id}`:''}`);
    if(!e.cancelled && !(e.endsAt && Date.parse(e.endsAt)<=Date.now()))rows.push([button('Create co-host link',`co-create:${e.id}`)]);
    const nav=[];
    if(current>0)nav.push(button('← Previous',`cohost:${e.id}:${current-1}`));
    if(current+1<pages)nav.push(button('Next →',`cohost:${e.id}:${current+1}`));
    if(nav.length)rows.push(nav);
    rows.push([button('Back to organiser tools',`h:${e.id}`)]);
    return this.long(id,`Co-hosts · ${e.title}\n${lines.length?lines.join('\n\n'):'No co-host links yet.'}\n\nTap an entry to share or revoke it.${pages>1?'\nPage '+(current+1)+' of '+pages:''}`,keyboard(...rows));
  }
  cohostEntryCard(id,e,entryId){
    if(e.owner!==id)return this.send(id,'Only the owner can manage co-host access.');
    const entry=cohostEntries(e).find(item=>item.id===entryId);
    if(!entry)return this.cohostCard(id,e);
    const url=cohostLink(e,this.username,entry.id),rows=[];
    if(url)rows.push([{text:'Copy link',copy_text:{text:url}},{text:'Share link',url:`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Join me as co-host of ${e.title}. This link works once.`)}`}]);
    if(entry.status!=='revoked')rows.push([button(entry.status==='active'?'Revoke access':'Cancel unused link',`co-remove:${e.id}:${entry.id}`)]);
    rows.push([button('Back to co-hosts',`cohost:${e.id}`)]);
    const identity=entry.cohost ? `\n${entry.cohost.name}\n${entry.cohost.username?'@'+entry.cohost.username:'No Telegram username'} · ID ${entry.cohost.id}`:'';
    return this.send(id,`${entry.label || 'Co-host link'} · ${entry.status}${identity}${url?'\n\n'+url+'\nFirst person to open this link becomes co-host.':''}`,keyboard(...rows));
  }
  async notifyManagers(e,text,markup){
    for(const uid of new Set([e.owner,...cohostIds(e)].filter(Number.isSafeInteger)))await this.send(uid,text,markup).catch(()=>{});
  }
  async saveResponse(id, e, response) {
    if(!this.allowed(e,id) || !invitationAvailable(e,id,response.invitationToken)){this.session(id);return this.home(id,'This invitation has already been used by another guest. Ask the organiser for your own link.');}
    if(e.guests[id]?.payment?.status==='reported')return this.send(id,'The organiser is reviewing your payment. Ask them to resolve or clear the report before changing your response.');
    if (['paid','processing','refund_pending','refund_failed'].includes(e.guests[id]?.payment?.status)) return this.send(id,'Your paid or processing booking cannot be changed. Contact /paysupport to request a refund first.');
    if (responsesClosed(e)) { this.session(id); await this.home(id, 'The response deadline has passed. Your unfinished response was not saved.'); return this.card(id, e); }
    const previous=e.guests[id],hadResponse=hasRecordedResponse(previous);
    if(e.checkIns?.[previous?.ticket]){this.session(id);return this.send(id,'You are already checked in. Contact the organiser to change your invitation.',keyboard([button('Back to event',`v:${e.id}`)]));}
    if(previous?.status===response.status && response.status==='yes' && previous.approval==='approved' && JSON.stringify(previous.answers || [])===JSON.stringify(response.answers || []) && previous.name===response.name && previous.phone===response.phone && previous.comment===response.comment && participantCount(e,previous)===participantCount(e,response)){this.session(id);return this.card(id,e);}
    consumeInvitation(e,id,response,this.db.sessions);
    response.responseVersion=(previous?.responseVersion || 0)+1;
    response.responseRecorded=true;
    if (response.status === 'yes') {
      response.participants = participantCount(e, response);
      response.approval = requiresApproval(e) ? 'pending' : 'approved';
      if (requiresApproval(e) || paidEvent(e)) delete response.ticket; else response.ticket = randomBytes(6).toString('hex').toUpperCase();
    } else { delete response.approval; delete response.ticket; }
    e.guests[id] = response; this.session(id);
    appendInvitationHistory(e,response.invitationToken,hadResponse?'changed':'responded',{actorRole:'guest',actorId:id,userId:id,name:response.name,status:response.status,...(hadResponse?{previousStatus:previous.status,previousParticipants:participantCount(e,previous)}:{}),participants:participantCount(e,response)});
    if (response.status === 'yes') applyDefaultReminder(e, id);
    await this.home(id, invitationMode(e)==='tickets' ? requiresApproval(e) ? 'Your ticket request is saved. The organiser will send your ticket after approval and any required payment.' : paidEvent(e) ? 'Booking saved. Complete payment to receive your ticket.' : 'Your ticket is booked.' : response.status === 'yes' && requiresApproval(e) ? '✅ Your acceptance request is saved. The organiser will send your invitation details and ticket after approving your response.' : paidEvent(e) && response.status === 'yes' ? 'Acceptance saved. Complete payment to confirm your ticket.' : '✅ Response saved.');
    await this.notifyManagers(e, `${e.title}\n${response.name}: ${response.approval === 'pending' ? '⏳ Awaiting approval' : labels[response.status]}${response.status === 'yes' ? '\nPeople: ' + participantCount(e, response) : ''}${response.comment ? '\nComment: ' + response.comment : ''}`, response.approval === 'pending' ? keyboard([button('✅ Approve', `approve:${e.id}:${id}:${response.responseVersion || 0}`), button('❌ Reject', `reject:${e.id}:${id}:${response.responseVersion || 0}`)]) : undefined);
    if (confirmed(e, response) && (requiresApproval(e) || invitationMode(e)==='tickets')) await this.ticket(id, e);
    if (paidEvent(e) && response.status === 'yes' && response.approval === 'approved') await this.paymentInfo(id,e);
    return this.card(id, e);
  }
  async finishCreation(id, s) {
    if(invitationMode(s.draft)==='named'){
      if(s.draft.requireApproval===true)s.draft.hideLocation=true;
      s.draft.requireApproval=false;s.draft.askParticipantCount=false;
    }
    if(invitationMode(s.draft)==='named' && !Object.keys(s.draft.invitees || {}).length){s.step='guestNames';return this.prompt(id,'Guest names, one per line. Alex = ? asks; Alex = 2! confirms; Alex = 2 allows changes; Alex = 2* fixes two places. Max 10.');}
    const e = { ...s.draft, permissions: permissions(s.draft), id: randomBytes(8).toString('hex'), owner: id, guests: {}, media: [], cancelled: false, createdAt: new Date().toISOString() };
    this.db.events[e.id] = e; this.session(id); await this.home(id, invitationMode(e)==='named'?'🎉 Event ready! Open Personal invitations to share guest links.':'🎉 Event ready! Tap Share ticket link to invite people.'); return this.card(id, e);
  }
  async card(id, e, withBanner = true) {
    const owner=e.owner===id,host = isManager(e,id);
    const counted = responseCounts(e);
    let counts = can(e, id, 'guestList') ? [`People coming: ${counted.participants}`, ...(counted.pending ? [`People awaiting approval: ${counted.pendingParticipants}`] : []), ...Object.keys(labels).map(s => `${labels[s]}: ${counted[s]}`), ...(counted.pending ? [`⏳ Awaiting approval: ${counted.pending}`] : []), ...(counted.awaitingPayment ? [`⭐ Awaiting payment: ${counted.awaitingPayment}`] : [])].join('\n') : `Your response: ${e.guests[id]?.status === 'yes' && !confirmed(e, e.guests[id]) ? paidEvent(e) && (!requiresApproval(e) || e.guests[id]?.approval === 'approved') ? 'Awaiting payment' : 'Awaiting organiser approval' : labels[e.guests[id]?.status] || 'Not submitted'}`;
    const mode=invitationMode(e);
    if(mode==='tickets')counts=can(e,id,'guestList') ? `Confirmed tickets: ${counted.yes} · People: ${counted.participants} · Approval requests: ${counted.pending} · Awaiting payment: ${counted.awaitingPayment}` : e.guests[id]?.status==='yes' ? confirmed(e,e.guests[id]) ? 'Your ticket is confirmed.' : 'Your ticket request is saved.' : 'Book a ticket using the button below.';
    const closed = responsesClosed(e);
    const accepted = !host && e.guests[id]?.status === 'yes';
    const rsvpOnly=!host && !accepted && mode!=='tickets';
    const rows = e.cancelled || host || closed ? [] : mode==='tickets' ? accepted ? [] : [[button(requiresApproval(e) ? 'Request ticket' : 'Get ticket',`book:${e.id}`)]] : accepted ? [[button('Change response', `change:${e.id}`)]] : [
      [button('✅ Accept', `r:${e.id}:yes:${e.guests[id]?.responseVersion || 0}`), button('❌ Reject', `r:${e.id}:no:${e.guests[id]?.responseVersion || 0}`)],
      [button('🤔 Maybe', `r:${e.id}:maybe:${e.guests[id]?.responseVersion || 0}`), button('⏳ Respond later', `r:${e.id}:later:${e.guests[id]?.responseVersion || 0}`)]
    ];
    if(mode==='named' && this.countEditable(e,id) && (invitationParticipantMode(e,e.guests[id])==='preset' || accepted && invitationParticipantMode(e,e.guests[id])!=='default'))rows.push([button(changeCountLabel(participantCount(e,e.guests[id])),`group:${e.id}:edit:${e.guests[id]?.responseVersion || 0}`)]);
    const extras = [];
    if (!e.cancelled && (host || accepted)) {
      if (host) extras.push(...(mode==='named' ? [this.appUrl ? this.miniButton('Personal invitations',`?invitations=${e.id}`) : button('Personal invitations',`invite-links:${e.id}`)] : [{ text: mode==='tickets' ? 'Share ticket link' : '📨 Invite people', url: `https://t.me/share/url?url=${encodeURIComponent(this.link(e))}&text=${encodeURIComponent([e.inviteMessage,e.title].filter(Boolean).join('\n\n'))}` }]), button('⚙️ Manage', `h:${e.id}`));
      if(paidEvent(e) && (owner || !host))extras.push({text:owner?'Payments & refunds':'Payment support',url:`https://t.me/${this.username}?start=payments`});
      if (can(e, id, 'guestList')) extras.push(button('👥 Guest list', `g:${e.id}`));
      if (!host && accepted && paidEvent(e) && (!requiresApproval(e) || e.guests[id].approval === 'approved') && e.guests[id].payment?.status !== 'paid') extras.push(button(e.starPrice?'⭐ Pay with Stars':'Payment instructions', `star-terms:${e.id}`));
      if (!host && accepted && (requiresApproval(e) || mode==='tickets')) extras.push(button('🎟 My status', `status:${e.id}`));
      if (can(e, id, 'uploadMedia')) extras.push(button('📎 Add media', `u:${e.id}`));
      if (this.appUrl && can(e, id, 'viewMedia')) extras.push(this.miniButton('🗂 Shared media', `?gallery=${e.id}`));
      if(this.appUrl && host)extras.push(this.miniButton(e.qrEnabled!==false?'Scan tickets':'Check tickets',`?checkin=${e.id}`));
      if(this.appUrl && e.qrEnabled!==false && !host && confirmed(e,e.guests[id]))extras.push(this.miniButton('🎟 Ticket QR',`?ticket=${e.id}`));
      if (upcoming(e)) extras.push(button('🔔 Reminder', `reminder:${e.id}`));
      if (canSeeLocation(e, id) && e.location) extras.push(e.location.length <= 256 ? { text: '📋 Copy address', copy_text: { text: e.location } } : button('📋 Copy address', `address:${e.id}`));
      if (host && shareUploadLink(e,this.username)) extras.push(this.appUrl && e.qrEnabled!==false ? this.miniButton('Upload QR code',`?qr=${e.id}`) : {text:'Share upload link',url:`https://t.me/share/url?url=${encodeURIComponent(shareUploadLink(e,this.username))}`});
    }
    if (owner) extras.push(button('Delete event', `delete:${e.id}`));
    rows.push(...paired(extras));
    if(!rsvpOnly)rows.push([button(menu.events, 'nav:events'), button(menu.home, 'nav:home')]);
    const visibility = can(e, id, 'guestList') ? 'Guest names and RSVP comments can be seen in the guest list.' : 'The organiser has kept the guest list private. Your response and comment are shared with the organiser.';
    const location = canSeeLocation(e, id) ? e.location || 'Location to follow' : paidEvent(e) ? requiresApproval(e) ? 'Shared after approval and confirmed payment' : 'Shared after confirmed payment' : requiresApproval(e) ? 'Shared after organiser approval' : 'Shared after acceptance';
    let text = `🎉 ${e.title}${e.cancelled ? ' — CANCELLED' : ''}\n\n🗓 ${this.time(e, id)}\n📍 ${location}\n\n${priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing)}\n\n${[e.inviteMessage,e.description].filter(Boolean).join('\n\n')}\n\n${host ? (owner ? 'You’re the organiser.\n\n' : 'You’re the co-host.\n\n') : mode==='named' ? 'Personal invitation for '+e.guests[id].name+'\n\n'+(accepted ? '✅ Accepted\n\n' : '') : mode==='tickets' ? (accepted ? '🎟 Ticket '+(confirmed(e,e.guests[id]) ? 'confirmed' : 'requested')+'\n\n' : '') : accepted ? '✅ Accepted\n\n' : ''}${closed ? '⏰ Responses closed — deadline passed.\n\n' : ''}${e.responseDeadline ? 'Response deadline: ' + eventTime({ startsAt: e.responseDeadline, timezone: e.deadlineTimezone || e.timezone || 'UTC' }, this.db.preferences[id]?.timezone) + '\n\n' : ''}${counts}${host && mode!=='named' ? '\n\n'+(mode==='tickets' ? 'Ticket link:' : 'Invite people:')+'\n' + this.link(e) : ''}\n\n${visibility} `;
    let invitationEntities=[];
    if(rsvpOnly){
      const deadline=e.responseDeadline ? '⏰ Respond by: '+eventTime({startsAt:e.responseDeadline,timezone:e.deadlineTimezone || e.timezone || 'UTC'},this.db.preferences[id]?.timezone)+'\n'+(closed ? 'Responses closed — deadline passed.\n' : '') : '';
      const content=mode==='named' ? this.namedInvitationContent(e,e.guests[id],id) : null,prefix=e.cancelled ? '🚫 Event cancelled\n' : '';
      const summary=content ? prefix+content.text : `🎉 ${e.title}${e.cancelled ? ' — CANCELLED' : ''}\n\n🗓 ${this.time(e,id)}\n${deadline}📍 ${location}\n${priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing)}\n\n`;
      if(content)invitationEntities=content.entities.map(entity=>({...entity,offset:entity.offset+prefix.length}));
      const limit=e.banner && withBanner ? Math.max(0,1024-summary.length) : 1500;
      const description=[e.inviteMessage,e.description].filter(Boolean).join('\n\n');text=summary+(description.length>limit ? description.slice(0,Math.max(0,limit-1)).replace(/[\uD800-\uDBFF]$/,'')+'…' : description);
    }
    if (e.banner && withBanner) {
      const captionContent = text.length <= 1024 ? text : text.slice(0, 940).replace(/[\uD800-\uDBFF]$/, '');
      const caption = captionContent + (text.length > 1024 ? '\n\nTap Full details to read more.' : '');
      if (text.length > 1024) rows.unshift([button('Full details', `details:${e.id}`)]);
      const offset = e.location && canSeeLocation(e, id) ? caption.indexOf('📍 ' + e.location) : -1;
      const entities=[...(offset >= 0 && offset + 3 + e.location.length <= captionContent.length ? [{ type: 'code', offset: offset + 3, length: e.location.length }] : []),...invitationEntities.filter(entity=>entity.offset+entity.length<=captionContent.length)];
      return this.api('sendPhoto', { chat_id: id, photo: e.banner, caption, reply_markup: keyboard(...rows), ...(entities.length ? { caption_entities:entities } : {}) });
    }
    for (let i = 0; i < text.length; i += 3900) {
      const chunk = text.slice(i, i + 3900);
      const offset = e.location && canSeeLocation(e, id) ? chunk.indexOf('📍 ' + e.location) : -1;
      const entities=[...(offset >= 0 && offset + 3 + e.location.length <= chunk.length ? [{ type: 'code', offset: offset + 3, length: e.location.length }] : []),...invitationEntities.filter(entity=>entity.offset>=i && entity.offset+entity.length<=i+chunk.length).map(entity=>({...entity,offset:entity.offset-i}))];
      await this.send(id, chunk, i + 3900 >= text.length ? keyboard(...rows) : undefined, entities.length ? entities : undefined);
    }
  }
  async handle(update) {
    if (update.message?.refunded_payment && update.message.chat?.type === 'private') return refundResult(this,update.message.chat.id,update.message.refunded_payment.telegram_payment_charge_id,true);
    if (update.pre_checkout_query) return this.api('answerPreCheckoutQuery',checkout(this,update.pre_checkout_query));
    if (update.message?.successful_payment && update.message.chat?.type === 'private') return successful(this,update.message);
    if (update.callback_query) return this.callback(update.callback_query);
    const m = update.message;
    if (!m || !m.from || m.from.is_bot) return;
    const id = m.from.id;
    if (m.chat.type !== 'private') return this.send(m.chat.id, `Please use me in a private chat: https://t.me/${this.username}`);
    let text = clean(m.text, 3000);
    if(text === '/start payments')text='/paysupport';
    if(text === '/start app')text='/app';
    const manageLink=text.match(/^\/start(?:@\w+)? manage_([a-f0-9]{16})$/);
    if(manageLink){this.session(id);return this.callback({from:m.from,data:`a:${manageLink[1]}`});}
    const paymentLink=text.match(/^\/start pay_([a-f0-9]{16})$/);
    if(paymentLink) {const e=this.db.events[paymentLink[1]];return this.allowed(e,id) ? this.paymentInfo(id,e) : this.home(id,'Open your event invitation before paying.');}
    const current = this.db.sessions[id];
    if(text===menu.new)return startChatCreation(this,id);
    const navigation = { [menu.new]: '/new', [menu.events]: '/events', [menu.help]: '/help', [menu.home]: '/start', [menu.cancel]: '/cancel', [menu.app]: '/app', [menu.picker]: '/picker', [menu.pending]: '/pending' };
    if (['📱 Open app','📱 Open planner','📱 Open XEvents planner'].includes(text)) text = '/app';
    if (navigation[text]) text = navigation[text];
    else if (current && text === menu.name && current.step === 'name') text = '/skip';
    else if (current && text === menu.skip && ['phone', 'description', 'inviteMessage', 'comment', 'banner', 'cohostLabel'].includes(current.step)) text = '/skip';
    else if (current && text === menu.done && current.step === 'upload') text = '/done';
    const command = text.split(/\s/)[0].split('@')[0];
    if (command === '/paysupport' || command === '/terms') {
      await this.send(id,'Paid events can use Stars, bank transfers or external payment links. Event terms are shown before payment. Cancelling a Stars event requests a full refund; organisers handle bank and external-link refunds directly. For payment help, send /paysupport followed by your question. Telegram support cannot handle purchases through this bot.');
      for(const [uid,pref] of Object.entries(this.db.preferences))for(const order of Object.values(pref.starOrders || {}))if(order.owner===id || Number(uid)===id){
        await this.send(id,order.title+' · '+order.amount+' Stars · '+order.status, order.owner===id && ['paid','refund_failed'].includes(order.status)?keyboard([button('Full refund',`sr:${uid}:${order.id}`)]):undefined);
        if(Number(uid)===id && command==='/paysupport')await this.send(order.owner,'Payment support request for '+order.title+' from '+name(m.from)+' (Telegram ID '+id+').\n'+(text.slice(command.length).trim() || 'Please contact this guest about their payment.'));
      }
      for(const [uid,pref] of Object.entries(this.db.preferences))for(const record of Object.values(pref.manualPayments || {}))if(record.owner===id || Number(uid)===id){
        await this.send(id,record.title+' · '+record.price+' · '+record.status);
        if(Number(uid)===id && command==='/paysupport')await this.send(record.owner,'Manual payment support requested for '+record.title+' by '+name(m.from)+'.\n'+text.slice(command.length).trim());
      }
      return;
    }
    if (command === '/pending') { this.session(id); return this.pendingInvitations(id); }
    if (command === '/app' && this.appUrl) {
      await this.api('setChatMenuButton',{chat_id:id,menu_button:{type:'web_app',text:'App',web_app:{url:this.appUrl}}}).catch(()=>{});
      return this.send(id, 'Use the built-in App button beside the message field.', current ? this.inputKeyboard(current) : homeKeyboard());
    }
    if (command === '/picker' && this.appUrl) {
      if (!current || !(current.step === 'when' || (current.step === 'edit' && current.field === 'when'))) return this.home(id, 'Start creating an event or edit an event’s time first.');
      current.token ||= randomBytes(12).toString('hex');
      return this.send(id, 'Choose a date, time, and timezone in the picker.', keyboard([this.miniButton(menu.picker, `?mode=picker&session=${current.token}`)]));
    }
    if (command === '/cancel') { this.session(id); return this.home(id, 'Input cancelled. Choose what you’d like to do next.'); }
    if (command === '/start') {
      if (this.appUrl) await this.api('setChatMenuButton', { chat_id: id, menu_button: { type: 'web_app', text: 'App', web_app: { url: this.appUrl } } });
      this.session(id);
      const uploadMatch = text.match(/^\/start(?:@\w+)? (u_([a-f0-9]{32})|a_([a-f0-9]{16}))$/);
      if (uploadMatch) {
        const e = uploadMatch[2] ? Object.values(this.db.events).find(e => e.uploadToken === uploadMatch[2] && uploadLink(e, this.username)) : this.db.events[uploadMatch[3]];
        if (!e || e.cancelled || (!uploadMatch[2] && (!this.mediaAllowed(e, id) || !can(e, id, 'uploadMedia')))) return this.home(id, 'This upload link is unavailable.');
        if (uploadMatch[2]) { this.db.preferences[id] ||= {}; this.db.preferences[id].mediaAccess ||= {}; this.db.preferences[id].mediaAccess[e.id] = uploadMatch[2]; }
        this.session(id, { step: 'media', event: e.id });
        return this.mediaCard(id,e);
      }
      const bannerMatch = text.match(/^\/start(?:@\w+)? b_([a-f0-9]{16})$/);
      if (bannerMatch) { const event = this.db.events[bannerMatch[1]]; if (isManager(event,id) && !event.cancelled) { this.session(id, { step: 'banner', event: event.id }); return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); } return this.home(id, 'Only event hosts can add a banner.'); }
      const cohost=text.match(/^\/start(?:@\w+)? c_([a-f0-9]{16})_([a-f0-9]{32})$/);
      if(cohost){
        const e=this.db.events[cohost[1]];let identity;
        try{identity=claimCohost(e,cohost[2],m.from);}catch(error){return this.home(id,error.message);}
        await this.home(id,`You are now co-host of ${e.title}. Open My events to manage it.`);
        const entry=cohostEntries(e).find(item=>item.status==='active' && item.cohost?.id===identity.id);
        await this.send(e.owner,`${identity.name} · ${identity.username?'@'+identity.username:'No Telegram username'} · ID ${identity.id}\nis now co-host of ${e.title}.${entry?.label?'\nLink: '+entry.label:''}`,keyboard([button('Manage co-hosts',`cohost:${e.id}`)])).catch(()=>{});
        return this.card(id,e);
      }
      const personal=text.match(/^\/start(?:@\w+)? i_([a-f0-9]{16})_([a-f0-9]{32})$/);
      if(personal){const e=this.db.events[personal[1]];if(isManager(e,id))return this.card(id,e);try{claimInvitation(e,personal[2],id);}catch(error){return this.home(id,error.message);}return this.card(id,e);}
      const match = text.match(/^\/start(?:@\w+)? e_([a-f0-9]{16})$/);
      if (match) {
        const e = this.db.events[match[1]];
        if (!e) return this.send(id, 'This invitation is unavailable. Ask the organiser for a new link.');
        if(invitationMode(e)==='named' && !isManager(e,id) && !e.guests[id])return this.home(id,'Ask the organiser for your personal invitation link.');
        if(!isManager(e,id) && !invitationAvailable(e,id))return this.home(id,'This invitation has already been used by another guest. Ask the organiser for your own link.');
        if (!e.cancelled && !isManager(e,id) && !e.guests[id]) e.guests[id] = { name: name(m.from), status: 'later', comment: '', answers: [], phone: '' };
        return this.card(id, e);
      }
      return this.home(id);
    }
    if (command === '/help') { this.session(id); return this.home(id, 'Tap Create event to plan in chat, or My events to manage invitations.'+(this.appUrl ? '\nUse the built-in App button for the full planner.' : '')+'\nPick a date, time and location, then review and create. More options adds named invitations, a banner, reminders and guest settings.'); }
    if (command === '/events') {
      this.session(id);
      const events = Object.values(this.db.events).filter(e => this.allowed(e, id) && !e.cancelled && (isManager(e,id) || e.guests[id]?.status !== 'no'));
      if (!events.length) return this.home(id, 'No events yet. Tap Create event, or open an invitation.');
      await this.home(id, '📅 Your events — tap Open event below.');
      for (const group of ['Upcoming events', 'Past events', 'Date not set', 'Cancelled events']) {
        const entries = events.filter(e => eventGroup(e) === group).sort((a,b) => group === 'Past events' ? Date.parse(b.startsAt)-Date.parse(a.startsAt) : Date.parse(a.startsAt)-Date.parse(b.startsAt));
        if (!entries.length) continue;
        await this.send(id, group);
        for (const e of entries) await this.send(id, `${e.cancelled ? '🚫' : '🎉'} ${e.title}\n${this.time(e, id)}\n${priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing)}`, keyboard([button('Open event', `v:${e.id}`)], ...(upcoming(e) ? [[button('🔔 Set reminder', `reminder:${e.id}`)]] : [])));
      }
      return;
    }
    if (command === '/new') {
      this.session(id, { step: 'title', draft: {invitationMode:'tickets',askPhone:false,askComments:false,qrEnabled:false} });
      return this.prompt(id, 'Let’s create your event. What is its name? (up to 100 characters)');
    }
    if (text.startsWith('/') && command !== '/skip' && command !== '/done') return this.send(id, 'Choose a menu button, or tap Cancel input to leave this step.', current ? this.inputKeyboard(current) : homeKeyboard());
    const s = this.db.sessions[id];
    if (!s) return this.home(id, 'Choose Create event or My events below.');
    if(s.flow==='chat-create')return chatCreationMessage(this,id,typeof m.text==='string'?m.text.trim():text,s,m);
    if (s.step === 'banner') {
      const target = s.draft || this.db.events[s.event];
      if (!target || (!s.draft && (!isManager(target,id) || target.cancelled))) { this.session(id); return this.home(id, 'This event is unavailable.'); }
      if (text !== '/skip' && !m.photo) return this.prompt(id, 'Send a photo as your banner, or tap Skip.');
      if (m.photo) target.banner = m.photo.at(-1).file_id;
      if (s.draft) { s.step = 'permissions'; return this.creationPermissions(id, s); }
      this.session(id); await this.home(id, m.photo ? '✅ Banner saved.' : 'Banner unchanged.'); return this.card(id, target);
    }
    if (s.draft) return this.create(id, text, s);
    const e = this.db.events[s.event];
    if(s.step==='cohostLabel'){
      if(!e || e.owner!==id || e.cancelled){this.session(id);return this.home(id,'Only the event owner can create co-host links.');}
      if(text!=='/skip' && (!text || text.length>80))return this.prompt(id,'Label up to 80 characters, or tap Skip.');
      let entry;
      try{entry=createCohostInvite(e,id,text==='/skip'?'':text);}catch(error){this.session(id);return this.home(id,error.message);}
      this.session(id);await this.home(id,'Co-host link created.');return this.cohostEntryCard(id,e,entry.id);
    }
    const linkUploader = s.step === 'upload' && e && s.uploadToken && s.uploadToken === e.uploadToken && !!uploadLink(e, this.username);
    if ((!this.allowed(e, id) && !linkUploader) || e.cancelled) { this.session(id); return this.send(id, 'This event is no longer available for changes.'); }
    const g = e.guests[id];
    if (s.response && isManager(e,id)) { this.session(id); return this.card(id, e); }
    if (s.response && responsesClosed(e)) { this.session(id); await this.home(id, 'The response deadline has passed.'); return this.card(id, e); }
    if (s.step === 'upload') {
      if ((!s.uploadToken && !can(e, id, 'uploadMedia')) || (s.uploadToken && !linkUploader)) { this.session(id); return this.home(id, 'The organiser has disabled these uploads.'); }
      if (command === '/done') { this.session(id); await this.home(id, `✅ Uploads finished${s.uploads ? ': ' + s.uploads + ' saved' : ''}.`); if (s.mediaOnly) return this.mediaCard(id,e); if (this.allowed(e, id)) return this.card(id, e); return; }
      const media = m.photo ? { type: 'photo', file: m.photo.at(-1) } : m.video ? { type: 'video', file: m.video } : m.document ? { type: 'document', file: m.document } : null;
      if (!media) return this.prompt(id, 'Send a photo, video, or file. Tap Finish uploads when finished.');
      e.media.push({ id: randomBytes(6).toString('hex'), type: media.type, fileId: media.file.file_id, mimeType:media.file.mime_type || null,thumbnail:media.file.thumbnail?.file_id || media.file.thumb?.file_id || null,size: media.file.file_size || null, filename: media.file.file_name || media.type, caption: clean(m.caption, 700), by: id, name: g?.name || name(m.from), at: new Date().toISOString() });
      s.uploads = (s.uploads || 0) + 1;
      return;
    }
    if (s.step === 'edit') {
      if (!isManager(e,id)) return;
      const limit = s.field === 'title' ? 100 : s.field === 'description' ? 1500 : s.field==='inviteMessage' ? 1000 : 300;
      if (!text || text.length > limit) return this.send(id, `Enter text up to ${limit} characters.`);
      e[s.field] = text;
      if (s.field === 'when') { delete e.startsAt; delete e.timezone; delete e.localDate; delete e.localTime; delete e.endsAt; delete e.durationMinutes; delete e.endMode; delete e.endDate; delete e.endTime; }
      this.session(id); await this.home(id, '✅ Event updated.'); await this.notify(e, `📣 ${e.title}: the organiser updated ${s.field}. Tap My events for the latest details.`); return this.card(id, e);
    }
    if (s.step === 'name') {
      if (isManager(e,id)) { this.session(id); return this.card(id, e); }
      if (!text || text.length > 100) return this.prompt(id, 'Enter a name up to 100 characters, or tap Use Telegram name.');
      s.response.name = command === '/skip' ? name(m.from) : text;
      if (asksParticipantCount(e)) {
        s.step = 'participants';
        return this.participantPicker(id,e);
      }
      s.response.participants = 1;
      return this.afterIdentity(id,e,s);
    }
    if (s.step === 'participants') {
      if (!/^(?:[1-9]|10)$/.test(text)) return this.participantPicker(id,e);
      return this.chooseParticipants(id,e,s,Number(text));
    }
    if(s.step==='participantConfirm')return this.participantConfirmation(id,e,s);
    if (s.step === 'phone') {
      if(!asksPhone(e))return this.afterIdentity(id,e,s);
      if (m.contact && m.contact.user_id !== id) return this.prompt(id, 'Please share your own contact, type your number, or tap Skip.');
      const phone = m.contact?.phone_number || text;
      if (command !== '/skip' && !/^\+?[\d\s().-]{5,30}$/.test(phone)) return this.prompt(id, 'Enter a valid phone number or tap Skip.');
      s.response.phone = command === '/skip' ? '' : phone;
      s.step = 'question'; s.index = 0;
      await this.send(id, 'Phone choice saved. Your number is visible only to the organiser.');
      return this.nextQuestion(id, e, s);
    }
    if (s.step === 'question') {
      return this.nextQuestion(id, e, s);
    }
    if (s.step === 'comment') {
      if (isManager(e,id)) { this.session(id); return this.card(id, e); }
      if (!text || text.length > 1000) return this.prompt(id, 'Enter a comment up to 1,000 characters or tap Skip.');
      if (s.response) {
        s.response.comment = command === '/skip' ? '' : text;
        return this.saveResponse(id, e, s.response);
      } else { this.session(id); return this.send(id, 'Choose an RSVP to update your comment.'); }
    }
  }
  async create(id, text, s) {
    if(s.step==='guestNames'){try{Object.assign(s.draft,invitationSettings({invitationMode:'named',guestNames:text,isPublic:false},s.draft));}catch(error){return this.prompt(id,error.message);}s.step='permissions';return this.creationPermissions(id,s);}
    if (s.step === 'permissions') return this.creationPermissions(id, s);
    const prompts = { title: ['when', 'When is the event? Include date, time, and timezone (for example: 24 October 2026, 6pm Australia/Sydney).'], when: ['location', 'Where is it? Enter an address, meeting point, or online link.'], location: ['description', 'Describe your event, or tap Skip.'], description: ['inviteMessage', 'Invitation message? Type your message, or tap Skip.'] };
    if (!text) return this.send(id, 'Please enter text.');
    if (s.step === 'inviteMessage' || s.step === 'questions') {
      if(text!=='/skip' && text.length>1000)return this.prompt(id,'Use an invitation message up to 1,000 characters.');
      s.draft.inviteMessage = s.step==='inviteMessage' && text!=='/skip' ? text : '';s.draft.questions=[];s.draft.permissions = permissions(s.draft); s.step = 'permissions'; s.token = randomBytes(6).toString('hex');
      await this.send(id, 'Choose Ticket link or Named invitations, then configure guest options below.', reply([menu.cancel]));
      return this.creationPermissions(id, s);
    }
    const limit = s.step === 'title' ? 100 : s.step === 'description' ? 1500 : 300;
    if (text.length > limit || (text === '/skip' && s.step !== 'description')) return this.send(id, `Enter ${s.step} up to ${limit} characters.`);
    s.draft[s.step] = text === '/skip' ? '' : text;
    const [next, prompt] = prompts[s.step]; s.step = next; return this.prompt(id, prompt);
  }
  async afterIdentity(id,e,s){
    if(asksPhone(e)){s.step='phone';return this.prompt(id,'Phone number? Only the organiser sees it. Or tap Skip.');}
    s.response.phone = '';s.step='question';s.index=0;return this.nextQuestion(id,e,s);
  }
  async nextQuestion(id, e, s) {
    if(!asksComments(e))return this.saveResponse(id,e,s.response);
    s.step = 'comment'; return this.prompt(id, `Comment? ${permissions(e).guestList ? 'Visible in the guest list.' : 'Only the organiser sees it.'} Or tap Skip.`);
  }
  async notify(e, text) {
    for (const uid of new Set([...Object.keys(e.guests).map(Number),...cohostIds(e)].filter(Number.isSafeInteger))) if (uid !== e.owner) await this.send(uid, text).catch(() => {});
  }
  async endEvent(id, e, remove = false) {
    if (!e || e.owner !== id) throw new Error('Only the organiser can do that.');
    for (const [uid,pref] of Object.entries(this.db.preferences)) for (const order of Object.values(pref.starOrders || {})) if(order.event===e.id) await requestRefund(this,uid,order);
    const wasCancelled = e.cancelled;
    e.cancelled = true;
    if (remove) delete this.db.events[e.id];
    for (const [uid, session] of Object.entries(this.db.sessions)) if (session.event === e.id) delete this.db.sessions[uid];
    if (!wasCancelled || remove) for (const [uid, guest] of Object.entries(e.guests)) {
      if (Number(uid) !== e.owner && ['yes', 'maybe'].includes(guest.status)) await this.home(Number(uid), `🚫 ${e.title} has been ${remove ? 'deleted' : 'cancelled'} by the organiser. The event will no longer take place.`);
    }
    if(!wasCancelled || remove)for(const uid of cohostIds(e))if(uid!==e.owner && !['yes','maybe'].includes(e.guests[uid]?.status))await this.home(uid,`🚫 ${e.title} has been ${remove ? 'deleted' : 'cancelled'} by the owner.`).catch(()=>{});
    await this.home(id, remove ? 'Event deleted. Accepted and tentative guests were notified.' : 'Event cancelled. Accepted and tentative guests were notified.');
  }
  async callback(q) {
    if((q.data || '').startsWith('cc:'))return chatCreationCallback(this,q);
    const id = q.from.id;
    const [action, eid, arg, version] = (q.data || '').split(':');
    const e = this.db.events[eid];
    if(q.id)await this.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (action === 'sr' || action === 'src') {
      const order=orderFor(this.db,eid,arg);
      if (!order || order.owner !== id || !['paid','refund_failed'].includes(order.status)) return this.send(id,'No refundable payment is available.');
      if(action==='sr')return this.send(id,`Refund all ${order.amount} Stars for ${order.title}?`,keyboard([button('Confirm refund',`src:${eid}:${arg}`),button('Keep payment','nav:home')]));
      await requestRefund(this,eid,order);return this.send(id,'Full refund requested. Telegram confirmation will follow.');
    }
    if (['pc', 'pd', 'pb'].includes(action)) {
      const s = this.db.sessions[id];
      if (!s?.draft || s.step !== 'permissions' || s.token !== eid) return this.send(id, 'These creation buttons have expired. Use the latest buttons or start a new event.');
      if (action === 'pb') { s.step = 'banner'; return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); }
      if(arg==='mode-tickets'){s.draft.invitationMode='tickets';s.draft.oneTimeInvite=false;delete s.draft.invitees;return this.creationPermissions(id,s);}
      if(arg==='mode-named'){if(s.draft.requireApproval===true)s.draft.hideLocation=true;s.draft.invitationMode='named';s.draft.oneTimeInvite=true;s.draft.isPublic=false;s.draft.requireApproval=false;s.draft.askParticipantCount=false;s.step='guestNames';return this.prompt(id,'Guest names, one per line. Alex = ? asks; Alex = 2! confirms; Alex = 2 allows changes; Alex = 2* fixes two places. Max 10.');}
      if (arg === 'defaultReminder') { const index = reminderOptions.indexOf(s.draft.defaultReminder || 0); s.draft.defaultReminder = reminderOptions[(index + 1) % reminderOptions.length]; }
      if (action === 'pd') return this.finishCreation(id, s);
      if (Object.hasOwn(permissionLabels, arg)) s.draft.permissions[arg] = !s.draft.permissions[arg];
      if(arg==='oneTimeInvite')s.draft.oneTimeInvite=!oneTimeInvites(s.draft);
      if (['requireApproval', 'hideLocation', 'askParticipantCount','askPhone','askComments','qrEnabled'].includes(arg) && !(invitationMode(s.draft)==='named' && ['requireApproval','askParticipantCount'].includes(arg))) s.draft[arg] = !s.draft[arg];
      if (arg === 'isPublic') {if(invitationMode(s.draft)==='named')return this.send(id,'Named invitations are private.');s.draft.isPublic = !s.draft.isPublic;}
      if (arg === 'allowLinkUploads') { s.draft.allowLinkUploads = !s.draft.allowLinkUploads; s.draft.uploadToken = s.draft.allowLinkUploads ? randomBytes(16).toString('hex') : null; }
      return this.creationPermissions(id, s);
    }
    if(action==='nav' && eid==='new')return startChatCreation(this,id);
    if (action === 'nav' && ['home', 'events', 'pending'].includes(eid)) return this.handle({ message: { from: q.from, chat: { id, type: 'private' }, text: { home: '/start', events: '/events', pending: '/pending' }[eid] } });
    if (action === 'media-add') {
      if (!this.mediaAllowed(e,id) || e.cancelled || !can(e,id,'uploadMedia')) return this.home(id,'The organiser has disabled these uploads.');
      const token=this.db.preferences[id]?.mediaAccess?.[e.id];
      this.session(id,{step:'upload',event:e.id,mediaOnly:true,uploads:0,uploadToken:token===e.uploadToken ? token : null});
      return this.prompt(id,'Send photos, videos, or files, then tap Finish uploads.');
    }
    if (!this.allowed(e, id)) return this.send(id, 'Open a valid invitation link first.');
    if (action === 'star-terms') return this.paymentInfo(id,e);
    if(action==='manual-report')return manualReport(this,id,e);
    if(action==='manual-confirm' || action==='manual-clear' || action==='manual-clear-confirm'){
      if(e.owner!==id)return this.send(id,'Only the organiser can confirm or clear payments.');
      const uid=Number(arg);
      if(action==='manual-confirm')return manualConfirm(this,id,e,uid);
      if(action==='manual-clear')return this.send(id,'Clear this manual payment confirmation? This does not refund money. Handle any refund through your bank or provider first.',keyboard([button('Clear record',`manual-clear-confirm:${e.id}:${uid}`),button('Keep record',`v:${e.id}`)]));
      return manualConfirm(this,id,e,uid,true);
    }
    if (action === 'star-pay') return invoice(this,id,e,true);
    if(action==='status' && paidEvent(e) && (!requiresApproval(e) || e.guests[id]?.approval==='approved') && !confirmed(e,e.guests[id]))return this.paymentInfo(id,e);
    if (e.cancelled && !['delete', 'delete-confirm','cohost','co-entry','co-remove','co-revoke'].includes(action)) return this.card(id, e);
    const ownerActions=['x','z','rotate','delete','delete-confirm','cohost','co-entry','co-create','co-new','co-remove','co-revoke'];
    if(ownerActions.includes(action) && e.owner!==id)return this.send(id,'Only the event owner can do that.');
    const hostActions = ['h', 'a', 'edit', 'remove', 'permissions', 'toggle', 'approve', 'reject', 'banner','invite-links','invite-copy'];
    if (hostActions.includes(action) && !isManager(e,id)) return this.send(id, 'Only event hosts can do that.');
    if(action==='cohost')return this.cohostCard(id,e,arg);
    if(action==='co-entry')return this.cohostEntryCard(id,e,arg);
    if(action==='co-create'){
      if(e.endsAt && Date.parse(e.endsAt)<=Date.now())return this.send(id,'Co-host invitations are unavailable for finished events.');
      await this.clearButtons(id,q.message);
      this.session(id,{step:'cohostLabel',event:e.id});
      return this.prompt(id,'Label for this co-host link? Or tap Skip.');
    }
    if(action==='co-new'){
      await this.clearButtons(id,q.message);
      return this.cohostCard(id,e);
    }
    if(action==='co-remove'){
      const entry=cohostEntries(e).find(item=>item.id===arg),guard=cohostGuard(e,arg);
      if(!guard)return this.cohostCard(id,e);
      return this.send(id,entry.status==='active' ? `Revoke access for ${entry.cohost.name}${entry.cohost.username?' (@'+entry.cohost.username+')':''}?` : `Cancel ${entry.label || 'this unused co-host link'}?`,keyboard([button('Confirm revoke',`co-revoke:${e.id}:${arg}:${guard}`),button('Keep access',`co-entry:${e.id}:${arg}`)]));
    }
    if(action==='co-revoke'){
      await this.clearButtons(id,q.message);
      if(!version || version!==cohostGuard(e,arg))return this.cohostCard(id,e);
      const prior=revokeCohost(e,id,arg);
      if(prior){if(this.db.sessions[prior.id]?.event===e.id)this.session(prior.id);await this.home(prior.id,`Your co-host access to ${e.title} was revoked by the owner.`).catch(()=>{});}
      return this.cohostCard(id,e);
    }
    const required = { g: 'guestList', u: 'uploadMedia', m: 'viewMedia' }[action];
    if(action==='group'){
      const g=e.guests[id];
      if(invitationMode(e)!=='named' || invitationParticipantMode(e,g)==='default' || !this.countEditable(e,id))return this.card(id,e);
      if(version!==String(g.responseVersion || 0))return this.send(id,'This invitation has changed. Open the event to change your number.',keyboard([button('Open event',`v:${e.id}`)]));
      await this.clearButtons(id,q.message);
      this.session(id,{event:e.id,step:'participants',response:{...g},countOnly:true});
      return this.participantPicker(id,e);
    }
    if(action==='count-confirm'){
      const s=this.db.sessions[id];
      if(s?.event!==eid || s.step!=='participantConfirm' || version!==s.countToken || !this.countEditable(e,id) || s.baseVersion!==(e.guests[id]?.responseVersion || 0))return this.card(id,e);
      if(!['yes','change'].includes(arg))return this.participantConfirmation(id,e,s);
      await this.clearButtons(id,q.message);
      if(arg==='change'){s.step='participants';return this.participantPicker(id,e);}
      return this.chooseParticipants(id,e,s,participantCount(e,s.response));
    }
    if(action==='size') {
      const session=this.db.sessions[id];
      if(session?.event!==eid || session.step!=='participants' || version!==session.countToken || !this.countEditable(e,id))return this.card(id,e);
      await this.clearButtons(id,q.message);
      if(arg==='more' || arg==='first')return this.participantPicker(id,e,arg==='more');
      if(!/^(?:[1-9]|10)$/.test(arg))return this.participantPicker(id,e);
      return this.chooseParticipants(id,e,session,Number(arg));
    }
    if (required && !can(e, id, required)) return this.send(id, 'The organiser has not enabled this option for guests.');
    if (action === 'v') { this.session(id); await this.home(id, 'Use the event buttons below.'); return this.card(id, e); }
    if (action === 'details') return this.card(id, e, false);
    if(action==='invite-links')return this.personalLinks(id,e,arg);
    if(action==='invite-copy')return invitationCopyCard(this,id,e,arg);
    if(action==='book'){await this.clearButtons(id,q.message);if(e.guests[id]?.status==='yes')return this.card(id,e);return invitationMode(e)==='tickets' ? this.beginAcceptance(id,e,q.from) : this.card(id,e);}
    if (action === 'banner') { this.session(id, { step: 'banner', event: eid }); return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); }
    if (action === 'address') { if (!canSeeLocation(e, id)) return this.send(id, 'The address is not available yet.'); if(!e.location)return this.send(id,'Location to follow.'); return this.send(id, e.location, keyboard([button('Back to event', `v:${eid}`)]), [{ type: 'code', offset: 0, length: e.location.length }]); }
    if (action === 'status') { if (isManager(e,id) || (!requiresApproval(e) && invitationMode(e)!=='tickets')) return this.card(id, e); if (confirmed(e, e.guests[id])) return this.ticket(id, e); return this.send(id, e.guests[id]?.status === 'yes' ? '⏳ Awaiting organiser approval. The organiser will send your invitation details after approving your response.' : 'You have not submitted an acceptance request.', keyboard([button('Back to event', `v:${eid}`)])); }
    if (action === 'change') { if (invitationMode(e)==='tickets')return this.card(id,e); if (isManager(e,id) || responsesClosed(e)) return this.card(id, e); this.session(id,{event:eid,step:'responseChoice'}); return this.send(id, 'Choose your new response. Your saved response stays unchanged until you finish.', keyboard([button('✅ Accept', `r:${eid}:yes:${e.guests[id]?.responseVersion || 0}`), button('❌ Decline', `r:${eid}:no:${e.guests[id]?.responseVersion || 0}`)], [button('🤔 Tentative', `r:${eid}:maybe:${e.guests[id]?.responseVersion || 0}`), button('⏳ Later', `r:${eid}:later:${e.guests[id]?.responseVersion || 0}`)], [button('Back to event', `v:${eid}`)])); }
    if (action === 'reminder') { if (!upcoming(e)) return this.send(id, 'Reminders need an upcoming event with an exact date and timezone.'); const minutes = e.reminders?.[id]?.minutes; return this.send(id, `Event reminder${minutes ? ': ' + minutes + ' minutes before' : ': off'}`, keyboard(...reminderOptions.filter(n => n > 0).map(n => [button(reminderLabel(n), `remind:${eid}:${n}`)]), [button('Turn off', `remind:${eid}:0`)], [button('Back to event', `v:${eid}`)])); }
    if (action === 'remind') { try { setReminder(e, id, Number(arg)); return this.send(id, Number(arg) ? '🔔 Reminder saved. You’ll receive a Telegram message before the event.' : 'Reminder turned off.', keyboard([button('Back to event', `v:${eid}`)])); } catch (err) { return this.send(id, err.message); } }
    if (action === 'r' && labels[arg]) {
      if(invitationMode(e)==='tickets')return this.card(id,e);
      if(e.guests[id]?.payment?.status==='reported')return this.send(id,'The organiser is reviewing your payment. Ask them to resolve or clear the report before changing your response.');
      if (['paid','processing','refund_pending','refund_failed'].includes(e.guests[id]?.payment?.status)) return this.send(id,'Contact /paysupport to refund your booking before changing your response.');
      if (isManager(e,id)) { this.session(id); return this.card(id, e); }
      await this.clearButtons(id,q.message);
      if(version!==undefined && version!==String(e.guests[id]?.responseVersion || 0))return this.send(id,'This RSVP message is out of date. Open the event in My events for your current response.',keyboard([button('Open event',`v:${e.id}`)]));
      if (responsesClosed(e)) return this.card(id, e);
      if(arg===e.guests[id]?.status && !(this.db.sessions[id]?.step==='responseChoice' && this.db.sessions[id]?.event===eid) && !(arg==='later' && !hasRecordedResponse(e.guests[id])))return arg==='later' ? this.pendingInvitations(id) : this.card(id,e);
      if (arg === 'later') {
        if(e.checkIns?.[e.guests[id]?.ticket]){this.session(id);return this.send(id,'You are already checked in. Contact the organiser to change your invitation.');}
        const previous=e.guests[id],hadResponse=hasRecordedResponse(previous);
        consumeInvitation(e,id,{...e.guests[id],status:'later'},this.db.sessions);
        e.guests[id] = { ...e.guests[id], status: 'later',responseRecorded:true,responseVersion:(e.guests[id]?.responseVersion || 0)+1 }; delete e.guests[id].approval; delete e.guests[id].ticket; this.session(id);
        appendInvitationHistory(e,previous.invitationToken,hadResponse?'changed':'responded',{actorRole:'guest',actorId:id,userId:id,name:previous.name,status:'later',...(hadResponse?{previousStatus:previous.status}:{}),participants:participantCount(e,e.guests[id])});
        return this.pendingInvitations(id);
      }
      if(arg==='yes' && invitationMode(e)==='named')return this.beginAcceptance(id,e,q.from);
      this.session(id, { event: eid, step: arg === 'yes' ? 'name' : 'comment', response: { ...(e.guests[id] || { name: name(q.from), phone: '', answers: [] }), ...(arg === 'yes' ? { answers: [] } : {}), status: arg } });
      if(arg!=='yes' && !asksComments(e))return this.saveResponse(id,e,this.db.sessions[id].response);
      return this.prompt(id, arg === 'yes' ? `${requiresApproval(e) ? 'The organiser will send invitation details and your ticket after approving your response.\n\n' : ''}What name should the organiser see? Enter a custom name, or tap Use Telegram name.` : `Selected: ${labels[arg]}. Add a comment ${permissions(e).guestList ? 'visible in the guest list' : 'for the organiser only'}, or tap Skip to save your response.`);
    }
    if (action === 'g') {
      let text = `👥 ${e.title}\n`;
      for (const [status, label] of [...Object.entries(labels), ['pending', '⏳ Awaiting approval']]) {
        text += `\n${label}\n`;
        const group = guests(e).filter(g => status === 'yes' ? confirmed(e, g) : status === 'pending' ? g.status === 'yes' && requiresApproval(e) && g.approval === 'pending' : g.status === status);
        text += group.length ? group.map(g => `• ${g.name}${g.status === 'yes' ? ' (' + participantCount(e, g) + ' people)' : ''}${g.comment ? ' — ' + g.comment : ''}`).join('\n') + '\n' : 'Nobody yet\n';
      }
      return this.long(id, text, keyboard([button('Back to event', `v:${eid}`)]));
    }
    if (action === 'c') {
      return this.send(id, isManager(e,id) ? 'You’re an event host — no RSVP needed.' : 'Choose an RSVP to add or update your comment.');
    }
    if (action === 'ticket') return this.ticket(id, e);
    if (action === 'approve' || action === 'reject') {
      const guestId = Number(arg); const guest = e.guests[guestId];
      await this.clearButtons(id,q.message);
      if (!requiresApproval(e) || !Number.isSafeInteger(guestId) || guestId === e.owner || !guest || guest.status !== 'yes' || guest.approval !== 'pending') return this.send(id, 'There is no pending acceptance request for this guest.');
      if(version!==undefined && version!==String(guest.responseVersion || 0))return this.send(id,'This approval request is out of date. Open Guest responses to review the current request.');
      if (action === 'approve') {
        guest.approval = 'approved'; if(!paidEvent(e))guest.ticket = randomBytes(6).toString('hex').toUpperCase();
        await this.send(guestId, `✅ The organiser approved your response for ${e.title}.`);
        if(paidEvent(e))await this.paymentInfo(guestId,e);else await this.ticket(guestId,e);
        await this.card(guestId,e);
      } else {
        guest.approval = 'rejected'; guest.status = 'no'; delete guest.ticket;
        await this.home(guestId, `Your acceptance request for ${e.title} was not approved by the organiser. Contact them if you have questions.`);
      }
      return this.send(id, `${guest.name}: ${action === 'approve' ? paidEvent(e) ? 'approved — payment requested' : 'approved — invitation ticket sent' : 'request rejected'}.`);
    }
    if (action === 'u') { this.session(id, { event: eid, step: 'upload' }); return this.prompt(id, `Send photos, videos, or files for this event. ${permissions(e).viewMedia ? 'Guests can view the shared collection.' : 'The shared collection is private to the organiser.'} Tap Finish uploads when finished.`); }
    if (action === 'm') {
      if (this.appUrl) return this.send(id, 'Open Shared media to view, save, or send files to your Telegram chat.', keyboard([this.miniButton('🗂 Shared media', `?gallery=${eid}`)]));
      const page = Number(arg);
      if (!Number.isSafeInteger(page) || page < 0) return;
      if (page === 0 && this.appUrl && e.media.filter(f => f.type === 'photo').length > 10) await this.send(id, 'There are more than 10 images. The event gallery is an easier way to browse and download them.', keyboard([this.miniButton('🖼 Open event gallery', `?gallery=${eid}`)], [button('Continue in chat', `m:${eid}:1`)]));
      const media = e.media.slice(page * 5, page * 5 + 5);
      if (!media.length) return this.send(id, 'No shared media on this page yet.', keyboard(...(can(e, id, 'uploadMedia') ? [[button('📎 Add media', `u:${eid}`)]] : []), [button('Back to event', `v:${eid}`)]));
      for (const f of media) {
        const method = { photo: 'sendPhoto', video: 'sendVideo', document: 'sendDocument' }[f.type];
        await this.api(method, { chat_id: id, [f.type]: f.fileId, caption: `Shared by ${f.name}${f.caption ? '\n' + f.caption : ''}`, ...(isManager(e,id) ? { reply_markup: keyboard([button('Remove from event', `remove:${eid}:${f.id}`)]) } : {}) });
      }
      const nav = [];
      if (page > 0) nav.push(button('← Previous', `m:${eid}:${page - 1}`));
      if ((page + 1) * 5 < e.media.length) nav.push(button('Next →', `m:${eid}:${page + 1}`));
      return this.send(id, `Media page ${page + 1}`, keyboard(...(nav.length ? [nav] : []), [button('Back to event', `v:${eid}`)]));
    }
    if (action === 'remove') { e.media = e.media.filter(f => f.id !== arg); return this.send(id, 'Removed from the event collection. Previously sent copies remain in Telegram chats.'); }
    if (action === 'h') {
      const rows=[[button('Guest responses', `a:${eid}`), button('Guest options', `permissions:${eid}`)], [button('Edit title', `edit:${eid}:title`), button('Edit time', `edit:${eid}:when`)], [button('Edit location', `edit:${eid}:location`), button('Edit description', `edit:${eid}:description`)], [button('Edit invite message',`edit:${eid}:inviteMessage`),button('🖼 Edit banner', `banner:${eid}`)]];
      if(invitationMode(e)==='named')rows.push([button('Invitation links',`invite-links:${eid}:0`)]);
      if(e.owner===id)rows.push([button('Co-hosts',`cohost:${eid}`),button('Replace invite link', `rotate:${eid}`)],[button('Cancel event', `x:${eid}`), button('Delete event', `delete:${eid}`)]);
      rows.push([button('Back to event',`v:${eid}`)]);
      return this.send(id,(e.owner===id?'Organiser':'Co-host')+' tools\n'+priceText(e,this.db.preferences[id],this.pricing || this.db.preferences._pricing),keyboard(...rows));
    }
    if (action === 'permissions' || action === 'toggle') {
      if(invitationMode(e)==='named'){
        if(e.requireApproval===true)e.hideLocation=true;
        e.requireApproval=false;e.askParticipantCount=false;
        if(['requireApproval','askParticipantCount'].includes(arg))return this.send(id,'Named invitations use per-guest counts and do not need approval.',keyboard([button('Guest options',`permissions:${eid}`)]));
      }
      if(action==='toggle' && arg==='askParticipantCount' && Object.values(e.guests).some(g=>['paid','processing','refund_pending','refund_failed'].includes(g.payment?.status)))return this.send(id,'Refund active payments before changing group attendance settings.');
      e.permissions = permissions(e);
      if (action === 'toggle' && Object.hasOwn(permissionLabels, arg)) e.permissions[arg] = !e.permissions[arg];
      if(action==='toggle' && arg==='oneTimeInvite'){
        try{Object.assign(e,invitationSettings({oneTimeInvite:!oneTimeInvites(e)},e));reconcileInvitationClaims(e,this.db.sessions);}catch(error){return this.send(id,error.message);}
      }
      if (action === 'toggle' && ['requireApproval', 'hideLocation', 'askParticipantCount','askPhone','askComments','qrEnabled'].includes(arg)) e[arg] = arg==='askPhone' ? !asksPhone(e) : arg==='askComments' ? !asksComments(e) : arg==='qrEnabled' ? e.qrEnabled===false : !e[arg];
      if (action === 'toggle' && arg === 'isPublic') {if(invitationMode(e)==='named')return this.send(id,'Named invitations must stay private.');e.isPublic = !e.isPublic;}
      if (action === 'toggle' && arg === 'allowLinkUploads') { e.allowLinkUploads = !e.allowLinkUploads; e.uploadToken = e.allowLinkUploads ? randomBytes(16).toString('hex') : null; }
      return this.send(id, 'Guest options — tap to enable or disable. Changes apply immediately to guests, including old buttons.', keyboard(...this.permissionKeyboard(e, `toggle:${eid}`), ...(this.appUrl ? [[this.miniButton('🗓 Deadline & invitation details', `?event=${eid}`)]] : []), [button('Back to organiser tools', `h:${eid}`)]));
    }
    if (action === 'a') {
      const counts=responseCounts(e),accepted=guests(e).filter(g=>g.status==='yes');
      const rows = guests(e).map(g => `${g.name} — ${g.status === 'yes' && !confirmed(e, g) ? requiresApproval(e) && g.approval==='pending' ? 'Awaiting approval':'Awaiting payment' : labels[g.status]}${g.status==='yes'?' · '+participantCount(e,g)+' people':''}${g.phone?'\nPhone: '+g.phone:''}${(g.answers || []).map(a=>'\n'+a.question+': '+(a.answer || 'Skipped')).join('')}${g.comment?'\n'+g.comment:''}`);
      const unopened=Object.entries(e.invitees || {}).filter(([token])=>!Object.values(e.guests).some(g=>g.invitationToken===token)).map(([,g])=>g.name+' — Not opened');
      await this.long(id, `${e.title}\nAccepted: ${accepted.length} responses · ${accepted.reduce((sum,g)=>sum+participantCount(e,g),0)} people\nConfirmed: ${counts.participants} people · Approval: ${counts.pending} · Payment: ${counts.awaitingPayment}\nMaybe: ${counts.maybe} · Rejected: ${counts.no} · Unanswered: ${counts.later+unopened.length}\n\n${[...rows,...unopened].join('\n\n') || 'No guests yet.'}`, keyboard([button('Back to organiser tools', `h:${eid}`)]));
      if(e.owner===id && ['bank','link'].includes(paymentMethod(e)))for(const [uid,g] of Object.entries(e.guests)){
        if(g.payment?.status==='reported')await this.send(id,g.name+' — payment reported',keyboard([button('Confirm received',`manual-confirm:${e.id}:${uid}`),button('Clear report',`manual-clear:${e.id}:${uid}`)]));
        if(g.payment?.status==='paid')await this.send(id,g.name+' — payment confirmed',keyboard([button('Clear payment record',`manual-clear:${e.id}:${uid}`)]));
      }
      for (const [uid, guest] of Object.entries(e.guests)) if (Number(uid) !== e.owner && guest.status === 'yes' && requiresApproval(e) && guest.approval === 'pending') await this.send(id, `⏳ ${guest.name} — awaiting approval`, keyboard([button('✅ Approve', `approve:${eid}:${uid}:${guest.responseVersion || 0}`), button('❌ Reject', `reject:${eid}:${uid}:${guest.responseVersion || 0}`)]));
      return;
    }
    if (action === 'edit' && ['title', 'when', 'location', 'description','inviteMessage'].includes(arg)) { this.session(id, { event: eid, step: 'edit', field: arg }); return this.prompt(id, `Enter the new ${arg}.`); }
    if (action === 'rotate') {
      if(paidEvent(e))return this.send(id,'Paid event links cannot be rotated while payment records reference them.');
      const newId = randomBytes(8).toString('hex'); delete this.db.events[eid]; e.id = newId; this.db.events[newId] = e;
      for (const s of Object.values(this.db.sessions)) if (s.event === eid) s.event = newId;
      await this.send(id, 'Invite link replaced. The old link no longer works. Existing guests can still open the event with My events.'); return this.card(id, e);
    }
    if (action === 'delete') return this.send(id, 'Permanently delete this event and its saved responses and media references? Accepted and tentative guests will be notified. Previously sent Telegram messages and files remain in their chats.', keyboard([button('Yes, delete event', `delete-confirm:${eid}`), button('Keep event', `v:${eid}`)]));
    if (action === 'delete-confirm') return this.endEvent(id, e, true);
    if (action === 'x') return this.send(id, 'Cancel this event? Accepted and tentative guests will be notified and new responses/uploads will close.', keyboard([button('Yes, cancel event', `z:${eid}`), button('Keep event', `v:${eid}`)]));
    if (action === 'z') { await this.endEvent(id, e); return this.card(id, e); }
  }
}
