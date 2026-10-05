import { randomBytes } from 'node:crypto';
import { eventTime } from './time.js';
import { uploadLink, shareUploadLink } from './permissions.js';
import { upcoming, eventGroup, setReminder, reminderOptions, reminderLabel, applyDefaultReminder } from './reminders.js';
import { permissions, permissionLabels, can, guests, confirmed, canSeeLocation, responsesClosed, responseCounts, participantCount } from './permissions.js';

const labels = { yes: '✅ Accepted', no: '❌ Not coming', maybe: '🤔 Tentative', later: '⏳ Respond later' };
const button = (text, callback_data) => ({ text, callback_data });
const keyboard = (...rows) => ({ inline_keyboard: rows });
const paired = buttons => Array.from({ length: Math.ceil(buttons.length / 2) }, (_, index) => buttons.slice(index * 2, index * 2 + 2));
const name = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Guest';
const clean = (s, max = 1000) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const menu = { new: '🎉 Create event', events: '📅 My events', help: '❓ Help', home: '🏠 Main menu', cancel: '✖️ Cancel input', skip: '⏭ Skip', done: '✅ Finish uploads', name: '👤 Use Telegram name', app: '📱 Open planner', picker: '🗓 Pick date & time', pending: '⏳ Pending invitations' };
const reply = (...rows) => ({ keyboard: rows.map(row => row.map(text => typeof text === 'string' ? { text } : text)), resize_keyboard: true, is_persistent: true });
const homeKeyboard = appUrl => reply([appUrl ? { text: '📱 Open app', web_app: { url: appUrl } } : '📱 Open app', menu.events]);

export class Bot {
  constructor(store, api, username, appUrl) { this.store = store; this.api = api; this.username = username; this.appUrl = appUrl; this.store.data.preferences ||= {}; }
  get db() { return this.store.data; }
  send(id, text, reply_markup, entities) { return this.api('sendMessage', { chat_id: id, text, ...(reply_markup ? { reply_markup } : {}), ...(entities ? { entities } : {}) }); }
  async long(id, text, markup) {
    for (let i = 0; i < text.length; i += 3900) await this.send(id, text.slice(i, i + 3900), i + 3900 >= text.length ? markup : undefined);
  }
  inputKeyboard(s) {
    if (this.appUrl && (s.step === 'when' || (s.step === 'edit' && s.field === 'when'))) return reply([menu.picker], [menu.cancel]);
    if (s.step === 'phone') return reply([{ text: '📱 Share my phone number', request_contact: true }], [menu.skip, menu.cancel]);
    if (s.step === 'name') return reply([menu.name], [menu.cancel]);
    if (s.step === 'upload') return reply([menu.done], [menu.cancel]);
    if (['description', 'questions', 'question', 'comment', 'banner'].includes(s.step)) return reply([menu.skip], [menu.cancel]);
    return reply([menu.cancel]);
  }
  prompt(id, text) { return this.send(id, text, this.inputKeyboard(this.db.sessions[id])); }
  hasPending(id) { return Object.values(this.db.events).some(e => e.owner !== id && !e.cancelled && e.guests[id]?.status === 'later'); }
  home(id, text = 'Welcome to XEvents 🎉\nOpen the app to create events, or tap My events to see your invitations.') { return this.send(id, text, homeKeyboard(this.appUrl)); }
  session(id, value) { if (value) this.db.sessions[id] = value; else delete this.db.sessions[id]; }
  link(e) { return `https://t.me/${this.username}?start=e_${e.id}`; }
  miniButton(text, params = '') { return { text, web_app: { url: this.appUrl + params } }; }
  time(e, id) { return eventTime(e, this.db.preferences[id]?.timezone); }
  allowed(e, id) { return e && (e.owner === id || !!e.guests[id]); }
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
      button(`${e.askParticipantCount ? '✅' : '⬜'} Group size`, `${prefix}:askParticipantCount`),
      button(`${e.requireApproval ? '✅' : '⬜'} Approval`, `${prefix}:requireApproval`),
      button(`${e.hideLocation || e.requireApproval ? '✅' : '⬜'} Private location`, `${prefix}:hideLocation`),
      button(`${e.isPublic ? '🌍 Public' : '🔒 Private'}`, `${prefix}:isPublic`),
      button(`${e.allowLinkUploads ? '✅' : '⬜'} Link uploads`, `${prefix}:allowLinkUploads`)
    ]);
  }
  async creationPermissions(id, s) {
    const buttons = [
      ...this.permissionKeyboard(s.draft, `pc:${s.token}`).flat(),
      ...(this.appUrl ? [this.miniButton('🗓 Reply deadline', `?mode=deadline&session=${s.token}`)] : []),
      button('🔔 ' + reminderLabel(s.draft.defaultReminder || 0), `pc:${s.token}:defaultReminder`),
      button(s.draft.banner ? '🖼 Replace banner' : '🖼 Add banner', `pb:${s.token}`),
      button('🎉 Create event', `pd:${s.token}`), button('Cancel', 'nav:home')
    ];
    return this.send(id, `Guest options\nTap to enable extras. Approval holds invitation details until you approve. Private location reveals the address after acceptance or approval. Link uploads let anyone with the upload link contribute. Public events appear in Explore.\n\nDefault reminder: ${reminderLabel(s.draft.defaultReminder || 0)}\nResponse deadline: ${s.draft.responseDeadline || 'No deadline'}`, keyboard(...paired(buttons)));
  }
  async pendingInvitations(id) {
    const events = Object.values(this.db.events).filter(e => e.owner !== id && !e.cancelled && e.guests[id]?.status === 'later');
    await this.home(id, events.length ? '⏳ Invitations you haven’t responded to yet. Tap an event to respond.' : 'You have no unanswered invitations.');
    for (const e of events) await this.send(id, `${e.title}\n${this.time(e, id)}${responsesClosed(e) ? '\nResponses closed — deadline passed' : ''}`, keyboard([button('Open invitation', `v:${e.id}`)]));
  }
  async ticket(id, e) {
    const g = e.guests[id];
    if (!g || !confirmed(e, g) || e.owner === id || e.cancelled) return this.send(id, 'Your invitation details will be available after your response is approved.');
    g.ticket ||= randomBytes(6).toString('hex').toUpperCase();
    return this.long(id, `🎟 YOUR INVITATION\n\n${e.title}\nGuest: ${g.name}\nPeople: ${participantCount(e, g)}\nTicket: ${g.ticket}\n\n🗓 ${this.time(e, id)}\n📍 ${e.location}${e.ticketInfo ? '\n\n' + e.ticketInfo : ''}\n\n✅ Your place is confirmed.`, keyboard([button('Back to event', `v:${e.id}`)]));
  }
  async saveResponse(id, e, response) {
    if (responsesClosed(e)) { this.session(id); await this.home(id, 'The response deadline has passed. Your unfinished response was not saved.'); return this.card(id, e); }
    if (response.status === 'yes') {
      response.participants = participantCount(e, response);
      response.approval = e.requireApproval ? 'pending' : 'approved';
      if (e.requireApproval) delete response.ticket; else response.ticket = randomBytes(6).toString('hex').toUpperCase();
    } else { delete response.approval; delete response.ticket; }
    e.guests[id] = response; this.session(id);
    if (response.status === 'yes') applyDefaultReminder(e, id);
    await this.home(id, response.status === 'yes' && e.requireApproval ? '✅ Your acceptance request is saved. The organiser will send your invitation details and ticket after approving your response.' : '✅ Response saved.');
    await this.send(e.owner, `${e.title}\n${response.name}: ${response.approval === 'pending' ? '⏳ Awaiting approval' : labels[response.status]}${response.status === 'yes' ? '\nPeople: ' + participantCount(e, response) : ''}${response.comment ? '\nComment: ' + response.comment : ''}`, response.approval === 'pending' ? keyboard([button('✅ Approve', `approve:${e.id}:${id}`), button('❌ Reject', `reject:${e.id}:${id}`)]) : undefined).catch(() => {});
    if (confirmed(e, response) && e.requireApproval) await this.ticket(id, e);
    return this.card(id, e);
  }
  async finishCreation(id, s) {
    const e = { ...s.draft, permissions: permissions(s.draft), id: randomBytes(8).toString('hex'), owner: id, guests: {}, media: [], cancelled: false, createdAt: new Date().toISOString() };
    this.db.events[e.id] = e; this.session(id); await this.home(id, '🎉 Your event is ready! Tap Invite people below to share it.'); return this.card(id, e);
  }
  async card(id, e, withBanner = true) {
    const host = e.owner === id;
    const counted = responseCounts(e);
    const counts = can(e, id, 'guestList') ? [`People coming: ${counted.participants}`, ...(counted.pending ? [`People awaiting approval: ${counted.pendingParticipants}`] : []), ...Object.keys(labels).map(s => `${labels[s]}: ${counted[s]}`), ...(counted.pending ? [`⏳ Awaiting approval: ${counted.pending}`] : [])].join('\n') : `Your response: ${e.guests[id]?.status === 'yes' && !confirmed(e, e.guests[id]) ? 'Awaiting organiser approval' : labels[e.guests[id]?.status] || 'Not submitted'}`;
    const closed = responsesClosed(e);
    const accepted = !host && e.guests[id]?.status === 'yes';
    const rows = e.cancelled || host || closed ? [] : accepted ? [[button('Change response', `change:${e.id}`)]] : [
      [button('✅ Accept', `r:${e.id}:yes`), button('❌ Decline', `r:${e.id}:no`)],
      [button('🤔 Tentative', `r:${e.id}:maybe`), button('⏳ Later', `r:${e.id}:later`)]
    ];
    if (!e.cancelled) {
      if (can(e, id, 'guestList')) rows.push([button('👥 Guest list', `g:${e.id}`)]);
      const media = [];
      if (can(e, id, 'uploadMedia')) media.push(button('📎 Add media', `u:${e.id}`));
      if (media.length) rows.push(media);
      if (this.appUrl && can(e, id, 'viewMedia')) rows.push([this.miniButton('🗂 Shared media', `?gallery=${e.id}`)]);
      if (this.appUrl && host && shareUploadLink(e, this.username)) rows.push([this.miniButton('Upload link & QR code', `?qr=${e.id}`)]);
      if (host) rows.push([button('⚙️ Manage', `h:${e.id}`)]);
      if (!host && accepted && e.requireApproval) rows.push([button('🎟 My status', `status:${e.id}`)]);
      if (upcoming(e)) rows.push([button('🔔 Event reminder', `reminder:${e.id}`)]);
      if (canSeeLocation(e, id) && e.location) rows.push([e.location.length <= 256 ? { text: '📋 Copy address', copy_text: { text: e.location } } : button('📋 Copy address', `address:${e.id}`)]);
    }
    if (this.appUrl && host) rows.push([this.miniButton('📱 View in planner', `?event=${e.id}`)]);
    if (!e.cancelled && host) rows.push([{ text: '📨 Invite people', url: `https://t.me/share/url?url=${encodeURIComponent(this.link(e))}&text=${encodeURIComponent(`You're invited to ${e.title}!`)}` }]);
    if (host) rows.push([button('Delete event', `delete:${e.id}`)]);
    rows.push([button(menu.events, 'nav:events'), button(menu.home, 'nav:home')]);
    const visibility = can(e, id, 'guestList') ? 'Guest names and RSVP comments can be seen in the guest list.' : 'The organiser has kept the guest list private. Your response and comment are shared with the organiser.';
    const location = canSeeLocation(e, id) ? e.location : e.requireApproval ? 'Shared after organiser approval' : 'Shared after acceptance';
    const text = `🎉 ${e.title}${e.cancelled ? ' — CANCELLED' : ''}\n\n🗓 ${this.time(e, id)}\n📍 ${location}\n\n${e.description}\n\n${host ? 'You’re the organiser — no RSVP needed.\n\n' : accepted ? '✅ Accepted\n\n' : ''}${closed ? '⏰ Responses closed — deadline passed.\n\n' : ''}${e.responseDeadline ? 'Response deadline: ' + eventTime({ startsAt: e.responseDeadline, timezone: e.deadlineTimezone || e.timezone || 'UTC' }, this.db.preferences[id]?.timezone) + '\n\n' : ''}${counts}${host ? '\n\nInvite people:\n' + this.link(e) : ''}\n\n${visibility} Phone numbers and question answers are shared only with the organiser.`;
    if (e.banner && withBanner) {
      const caption = text.length <= 1024 ? text : text.slice(0, 940).replace(/[\uD800-\uDBFF]$/, '') + '\n\nTap Full details to read more.';
      if (text.length > 1024) rows.unshift([button('Full details', `details:${e.id}`)]);
      const offset = canSeeLocation(e, id) ? caption.indexOf('📍 ' + e.location) : -1;
      return this.api('sendPhoto', { chat_id: id, photo: e.banner, caption, reply_markup: keyboard(...rows), ...(offset >= 0 && offset + 3 + e.location.length <= caption.length ? { caption_entities: [{ type: 'code', offset: offset + 3, length: e.location.length }] } : {}) });
    }
    for (let i = 0; i < text.length; i += 3900) {
      const chunk = text.slice(i, i + 3900);
      const offset = canSeeLocation(e, id) ? chunk.indexOf('📍 ' + e.location) : -1;
      await this.send(id, chunk, i + 3900 >= text.length ? keyboard(...rows) : undefined, offset >= 0 && offset + 3 + e.location.length <= chunk.length ? [{ type: 'code', offset: offset + 3, length: e.location.length }] : undefined);
    }
  }
  async handle(update) {
    if (update.callback_query) return this.callback(update.callback_query);
    const m = update.message;
    if (!m || !m.from || m.from.is_bot) return;
    const id = m.from.id;
    if (m.chat.type !== 'private') return this.send(m.chat.id, `Please use me in a private chat: https://t.me/${this.username}`);
    let text = clean(m.text, 3000);
    const current = this.db.sessions[id];
    const navigation = { [menu.new]: '/new', [menu.events]: '/events', [menu.help]: '/help', [menu.home]: '/start', [menu.cancel]: '/cancel', [menu.app]: '/app', [menu.picker]: '/picker', [menu.pending]: '/pending' };
    if (text === '📱 Open app') text = '/app';
    if (navigation[text]) text = navigation[text];
    else if (current && text === menu.name && current.step === 'name') text = '/skip';
    else if (current && text === menu.skip && ['phone', 'description', 'questions', 'question', 'comment', 'banner'].includes(current.step)) text = '/skip';
    else if (current && text === menu.done && current.step === 'upload') text = '/done';
    const command = text.split(/\s/)[0].split('@')[0];
    if (command === '/pending') { this.session(id); return this.pendingInvitations(id); }
    if (command === '/app' && this.appUrl) return this.send(id, 'Open your planner to create events, pick dates and times, and set your local timezone.', keyboard([this.miniButton('📱 Open XEvents planner')]));
    if (command === '/picker' && this.appUrl) {
      if (!current || !(current.step === 'when' || (current.step === 'edit' && current.field === 'when'))) return this.home(id, 'Start creating an event or edit an event’s time first.');
      current.token ||= randomBytes(12).toString('hex');
      return this.send(id, 'Choose a date, time, and timezone in the picker.', keyboard([this.miniButton(menu.picker, `?mode=picker&session=${current.token}`)]));
    }
    if (command === '/cancel') { this.session(id); return this.home(id, 'Input cancelled. Choose what you’d like to do next.'); }
    if (command === '/start') {
      if (this.appUrl) await this.api('setChatMenuButton', { chat_id: id, menu_button: { type: 'web_app', text: 'Planner', web_app: { url: this.appUrl } } });
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
      if (bannerMatch) { const event = this.db.events[bannerMatch[1]]; if (event?.owner === id && !event.cancelled) { this.session(id, { step: 'banner', event: event.id }); return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); } return this.home(id, 'Only the organiser can add a banner.'); }
      const match = text.match(/^\/start(?:@\w+)? e_([a-f0-9]{16})$/);
      if (match) {
        const e = this.db.events[match[1]];
        if (!e) return this.send(id, 'This invitation is unavailable. Ask the organiser for a new link.');
        if (!e.cancelled && e.owner !== id && !e.guests[id]) e.guests[id] = { name: name(m.from), status: 'later', comment: '', answers: [], phone: '' };
        return this.card(id, e);
      }
      return this.home(id);
    }
    if (command === '/help') { this.session(id); return this.home(id, 'Create an event in the planner or chat, choose guest options, and share its invitation. Organisers don’t RSVP.\n\nGuests get Accept, Decline, Tentative, and Later. Later opens unanswered invitations; find them again under Pending invitations. Accepting guests choose a name, optionally share their own phone number, and answer organiser questions.\n\nGuest lists, uploads, and shared media are available only if the organiser enables them. Comments stay private to the organiser unless the guest list is enabled.\n\nA response deadline closes RSVP changes. If approval is required, the organiser gets Approve/Reject buttons and approved guests receive their location and invitation ticket. Location can also be restricted to accepted guests without approval.\n\nUse Manage for organiser tools and guest options, Planner for dates, deadlines, and invitation instructions, or Cancel input to leave a step.'); }
    if (command === '/events') {
      this.session(id);
      const events = Object.values(this.db.events).filter(e => this.allowed(e, id) && !e.cancelled && (e.owner === id || e.guests[id]?.status !== 'no'));
      if (!events.length) return this.home(id, 'No events yet. Tap Open app to create an event, or open an invitation.');
      await this.home(id, '📅 Your events — tap Open event below.');
      for (const group of ['Upcoming events', 'Past events', 'Date not set', 'Cancelled events']) {
        const entries = events.filter(e => eventGroup(e) === group).sort((a,b) => group === 'Past events' ? Date.parse(b.startsAt)-Date.parse(a.startsAt) : Date.parse(a.startsAt)-Date.parse(b.startsAt));
        if (!entries.length) continue;
        await this.send(id, group);
        for (const e of entries) await this.send(id, `${e.cancelled ? '🚫' : '🎉'} ${e.title}\n${this.time(e, id)}`, keyboard([button('Open event', `v:${e.id}`)], ...(upcoming(e) ? [[button('🔔 Set reminder', `reminder:${e.id}`)]] : [])));
      }
      return;
    }
    if (command === '/new') {
      this.session(id, { step: 'title', draft: {} });
      return this.prompt(id, 'Let’s create your event. What is its name? (up to 100 characters)');
    }
    if (text.startsWith('/') && command !== '/skip' && command !== '/done') return this.send(id, 'Choose a menu button, or tap Cancel input to leave this step.', current ? this.inputKeyboard(current) : homeKeyboard(this.appUrl));
    const s = this.db.sessions[id];
    if (!s) return this.home(id, 'Choose Open app or My events below.');
    if (s.step === 'banner') {
      const target = s.draft || this.db.events[s.event];
      if (!target || (!s.draft && (target.owner !== id || target.cancelled))) { this.session(id); return this.home(id, 'This event is unavailable.'); }
      if (text !== '/skip' && !m.photo) return this.prompt(id, 'Send a photo as your banner, or tap Skip.');
      if (m.photo) target.banner = m.photo.at(-1).file_id;
      if (s.draft) { s.step = 'permissions'; return this.creationPermissions(id, s); }
      this.session(id); await this.home(id, m.photo ? '✅ Banner saved.' : 'Banner unchanged.'); return this.card(id, target);
    }
    if (s.draft) return this.create(id, text, s);
    const e = this.db.events[s.event];
    const linkUploader = s.step === 'upload' && e && s.uploadToken && s.uploadToken === e.uploadToken && !!uploadLink(e, this.username);
    if ((!this.allowed(e, id) && !linkUploader) || e.cancelled) { this.session(id); return this.send(id, 'This event is no longer available for changes.'); }
    const g = e.guests[id];
    if (s.response && e.owner === id) { this.session(id); return this.card(id, e); }
    if (s.response && responsesClosed(e)) { this.session(id); await this.home(id, 'The response deadline has passed.'); return this.card(id, e); }
    if (s.step === 'upload') {
      if ((!s.uploadToken && !can(e, id, 'uploadMedia')) || (s.uploadToken && !linkUploader)) { this.session(id); return this.home(id, 'The organiser has disabled these uploads.'); }
      if (command === '/done') { this.session(id); await this.home(id, `✅ Uploads finished${s.uploads ? ': ' + s.uploads + ' saved' : ''}.`); if (s.mediaOnly) return this.mediaCard(id,e); if (this.allowed(e, id)) return this.card(id, e); return; }
      const media = m.photo ? { type: 'photo', file: m.photo.at(-1) } : m.video ? { type: 'video', file: m.video } : m.document ? { type: 'document', file: m.document } : null;
      if (!media) return this.prompt(id, 'Send a photo, video, or file. Tap Finish uploads when finished.');
      e.media.push({ id: randomBytes(6).toString('hex'), type: media.type, fileId: media.file.file_id, size: media.file.file_size || null, filename: media.file.file_name || media.type, caption: clean(m.caption, 700), by: id, name: g?.name || name(m.from), at: new Date().toISOString() });
      s.uploads = (s.uploads || 0) + 1;
      return;
    }
    if (s.step === 'edit') {
      if (e.owner !== id) return;
      const limit = s.field === 'title' ? 100 : s.field === 'description' ? 1500 : 300;
      if (!text || text.length > limit) return this.send(id, `Enter text up to ${limit} characters.`);
      e[s.field] = text;
      if (s.field === 'when') { delete e.startsAt; delete e.timezone; delete e.localDate; delete e.localTime; delete e.endsAt; delete e.durationMinutes; delete e.endMode; delete e.endDate; delete e.endTime; }
      this.session(id); await this.home(id, '✅ Event updated.'); await this.notify(e, `📣 ${e.title}: the organiser updated ${s.field}. Tap My events for the latest details.`); return this.card(id, e);
    }
    if (s.step === 'name') {
      if (e.owner === id) { this.session(id); return this.card(id, e); }
      if (!text || text.length > 100) return this.prompt(id, 'Enter a name up to 100 characters, or tap Use Telegram name.');
      s.response.name = command === '/skip' ? name(m.from) : text;
      if (e.askParticipantCount === true) {
        s.step = 'participants';
        return this.prompt(id, 'How many people are attending with this response, including you? Enter a whole number from 1 to 10,000.');
      }
      s.response.participants = 1;
      s.step = 'phone';
      return this.prompt(id, 'Optionally share your phone number with the organiser only. Tap Share my phone number, type a number, or tap Skip.');
    }
    if (s.step === 'participants') {
      if (!/^[1-9]\d{0,4}$/.test(text) || Number(text) > 10000) return this.prompt(id, 'Enter a whole number from 1 to 10,000, including yourself.');
      s.response.participants = e.askParticipantCount === true ? Number(text) : 1;
      s.step = 'phone';
      return this.prompt(id, 'Optionally share your phone number with the organiser only. Tap Share my phone number, type a number, or tap Skip.');
    }
    if (s.step === 'phone') {
      if (m.contact && m.contact.user_id !== id) return this.prompt(id, 'Please share your own contact, type your number, or tap Skip.');
      const phone = m.contact?.phone_number || text;
      if (command !== '/skip' && !/^\+?[\d\s().-]{5,30}$/.test(phone)) return this.prompt(id, 'Enter a valid phone number or tap Skip.');
      s.response.phone = command === '/skip' ? '' : phone;
      s.step = 'question'; s.index = 0;
      await this.send(id, 'Phone choice saved. Your number is visible only to the organiser.');
      return this.nextQuestion(id, e, s);
    }
    if (s.step === 'question') {
      if (!text || text.length > 1000) return this.prompt(id, 'Enter an answer up to 1,000 characters or tap Skip.');
      s.response.answers.push({ question: e.questions[s.index], answer: command === '/skip' ? '' : text }); s.index++;
      return this.nextQuestion(id, e, s);
    }
    if (s.step === 'comment') {
      if (e.owner === id) { this.session(id); return this.card(id, e); }
      if (!text || text.length > 1000) return this.prompt(id, 'Enter a comment up to 1,000 characters or tap Skip.');
      if (s.response) {
        s.response.comment = command === '/skip' ? '' : text;
        return this.saveResponse(id, e, s.response);
      } else { this.session(id); return this.send(id, 'Choose an RSVP to update your comment.'); }
    }
  }
  async create(id, text, s) {
    if (s.step === 'permissions') return this.creationPermissions(id, s);
    const prompts = { title: ['when', 'When is the event? Include date, time, and timezone (for example: 24 October 2026, 6pm Australia/Sydney).'], when: ['location', 'Where is it? Enter an address, meeting point, or online link.'], location: ['description', 'Describe your event, or tap Skip.'], description: ['questions', 'Add custom questions, one per line (up to 10), or tap Skip. Answers are private to the organiser.'] };
    if (!text) return this.send(id, 'Please enter text.');
    if (s.step === 'questions') {
      const questions = text === '/skip' ? [] : text.split('\n').map(x => x.trim()).filter(Boolean);
      if (questions.length > 10 || questions.some(q => q.length > 200)) return this.send(id, 'Use up to 10 questions, each at most 200 characters.');
      s.draft.questions = questions; s.draft.permissions = permissions(s.draft); s.step = 'permissions'; s.token = randomBytes(6).toString('hex');
      await this.send(id, 'Choose guest options using the buttons below.', reply([menu.cancel]));
      return this.creationPermissions(id, s);
    }
    const limit = s.step === 'title' ? 100 : s.step === 'description' ? 1500 : 300;
    if (text.length > limit || (text === '/skip' && s.step !== 'description')) return this.send(id, `Enter ${s.step} up to ${limit} characters.`);
    s.draft[s.step] = text === '/skip' ? '' : text;
    const [next, prompt] = prompts[s.step]; s.step = next; return this.prompt(id, prompt);
  }
  async nextQuestion(id, e, s) {
    if (s.index < e.questions.length) return this.prompt(id, `Question ${s.index + 1}/${e.questions.length}\n${e.questions[s.index]}\n\nEnter your answer, or tap Skip.`);
    s.step = 'comment'; return this.prompt(id, `Add an RSVP comment ${permissions(e).guestList ? 'visible in the guest list' : 'for the organiser only'}, or tap Skip to save without a comment.`);
  }
  async notify(e, text) {
    for (const uid of Object.keys(e.guests)) if (Number(uid) !== e.owner) await this.send(Number(uid), text).catch(() => {});
  }
  async endEvent(id, e, remove = false) {
    if (!e || e.owner !== id) throw new Error('Only the organiser can do that.');
    const wasCancelled = e.cancelled;
    e.cancelled = true;
    if (remove) delete this.db.events[e.id];
    for (const [uid, session] of Object.entries(this.db.sessions)) if (session.event === e.id) delete this.db.sessions[uid];
    if (!wasCancelled || remove) for (const [uid, guest] of Object.entries(e.guests)) {
      if (Number(uid) !== e.owner && ['yes', 'maybe'].includes(guest.status)) await this.home(Number(uid), `🚫 ${e.title} has been ${remove ? 'deleted' : 'cancelled'} by the organiser. The event will no longer take place.`);
    }
    await this.home(id, remove ? 'Event deleted. Accepted and tentative guests were notified.' : 'Event cancelled. Accepted and tentative guests were notified.');
  }
  async callback(q) {
    const id = q.from.id;
    const [action, eid, arg] = (q.data || '').split(':');
    const e = this.db.events[eid];
    await this.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (['pc', 'pd', 'pb'].includes(action)) {
      const s = this.db.sessions[id];
      if (!s?.draft || s.step !== 'permissions' || s.token !== eid) return this.send(id, 'These creation buttons have expired. Use the latest buttons or start a new event.');
      if (action === 'pb') { s.step = 'banner'; return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); }
      if (arg === 'defaultReminder') { const index = reminderOptions.indexOf(s.draft.defaultReminder || 0); s.draft.defaultReminder = reminderOptions[(index + 1) % reminderOptions.length]; }
      if (action === 'pd') return this.finishCreation(id, s);
      if (Object.hasOwn(permissionLabels, arg)) s.draft.permissions[arg] = !s.draft.permissions[arg];
      if (['requireApproval', 'hideLocation', 'askParticipantCount'].includes(arg)) s.draft[arg] = !s.draft[arg];
      if (arg === 'isPublic') s.draft.isPublic = !s.draft.isPublic;
      if (arg === 'allowLinkUploads') { s.draft.allowLinkUploads = !s.draft.allowLinkUploads; s.draft.uploadToken = s.draft.allowLinkUploads ? randomBytes(16).toString('hex') : null; }
      return this.creationPermissions(id, s);
    }
    if (action === 'nav' && ['home', 'events', 'new', 'pending'].includes(eid)) return this.handle({ message: { from: q.from, chat: { id, type: 'private' }, text: { home: '/start', events: '/events', new: '/new', pending: '/pending' }[eid] } });
    if (action === 'media-add') {
      if (!this.mediaAllowed(e,id) || e.cancelled || !can(e,id,'uploadMedia')) return this.home(id,'The organiser has disabled these uploads.');
      const token=this.db.preferences[id]?.mediaAccess?.[e.id];
      this.session(id,{step:'upload',event:e.id,mediaOnly:true,uploads:0,uploadToken:token===e.uploadToken ? token : null});
      return this.prompt(id,'Send photos, videos, or files, then tap Finish uploads.');
    }
    if (!this.allowed(e, id)) return this.send(id, 'Open a valid invitation link first.');
    if (e.cancelled && !['delete', 'delete-confirm'].includes(action)) return this.card(id, e);
    const hostActions = ['h', 'a', 'x', 'z', 'edit', 'rotate', 'remove', 'permissions', 'toggle', 'approve', 'reject', 'banner', 'delete', 'delete-confirm'];
    if (hostActions.includes(action) && e.owner !== id) return this.send(id, 'Only the organiser can do that.');
    const required = { g: 'guestList', u: 'uploadMedia', m: 'viewMedia' }[action];
    if (required && !can(e, id, required)) return this.send(id, 'The organiser has not enabled this option for guests.');
    if (action === 'v') { this.session(id); await this.home(id, 'Use the event buttons below.'); return this.card(id, e); }
    if (action === 'details') return this.card(id, e, false);
    if (action === 'banner') { this.session(id, { step: 'banner', event: eid }); return this.prompt(id, 'Send a photo for your event banner, or tap Skip.'); }
    if (action === 'address') { if (!canSeeLocation(e, id)) return this.send(id, 'The address is not available yet.'); return this.send(id, e.location, keyboard([button('Back to event', `v:${eid}`)]), [{ type: 'code', offset: 0, length: e.location.length }]); }
    if (action === 'status') { if (e.owner === id || !e.requireApproval) return this.card(id, e); if (confirmed(e, e.guests[id])) return this.ticket(id, e); return this.send(id, e.guests[id]?.status === 'yes' ? '⏳ Awaiting organiser approval. The organiser will send your invitation details after approving your response.' : 'You have not submitted an acceptance request.', keyboard([button('Back to event', `v:${eid}`)])); }
    if (action === 'change') { if (e.owner === id || responsesClosed(e)) return this.card(id, e); return this.send(id, 'Choose your new response. Your saved response stays unchanged until you finish.', keyboard([button('✅ Accept', `r:${eid}:yes`), button('❌ Decline', `r:${eid}:no`)], [button('🤔 Tentative', `r:${eid}:maybe`), button('⏳ Later', `r:${eid}:later`)], [button('Back to event', `v:${eid}`)])); }
    if (action === 'reminder') { if (!upcoming(e)) return this.send(id, 'Reminders need an upcoming event with an exact date and timezone.'); const minutes = e.reminders?.[id]?.minutes; return this.send(id, `Event reminder${minutes ? ': ' + minutes + ' minutes before' : ': off'}`, keyboard(...reminderOptions.filter(n => n > 0).map(n => [button(reminderLabel(n), `remind:${eid}:${n}`)]), [button('Turn off', `remind:${eid}:0`)], [button('Back to event', `v:${eid}`)])); }
    if (action === 'remind') { try { setReminder(e, id, Number(arg)); return this.send(id, Number(arg) ? '🔔 Reminder saved. You’ll receive a Telegram message before the event.' : 'Reminder turned off.', keyboard([button('Back to event', `v:${eid}`)])); } catch (err) { return this.send(id, err.message); } }
    if (action === 'r' && labels[arg]) {
      if (e.owner === id) { this.session(id); return this.card(id, e); }
      if (responsesClosed(e)) return this.card(id, e);
      if (arg === 'later') {
        e.guests[id] = { ...e.guests[id], status: 'later' }; delete e.guests[id].approval; delete e.guests[id].ticket; this.session(id);
        return this.pendingInvitations(id);
      }
      this.session(id, { event: eid, step: arg === 'yes' ? 'name' : 'comment', response: { ...(e.guests[id] || { name: name(q.from), phone: '', answers: [] }), ...(arg === 'yes' ? { answers: [] } : {}), status: arg } });
      return this.prompt(id, arg === 'yes' ? `${e.requireApproval ? 'The organiser will send invitation details and your ticket after approving your response.\n\n' : ''}What name should the organiser see? Enter a custom name, or tap Use Telegram name.` : `Selected: ${labels[arg]}. Add a comment ${permissions(e).guestList ? 'visible in the guest list' : 'for the organiser only'}, or tap Skip to save your response.`);
    }
    if (action === 'g') {
      let text = `👥 ${e.title}\n`;
      for (const [status, label] of [...Object.entries(labels), ['pending', '⏳ Awaiting approval']]) {
        text += `\n${label}\n`;
        const group = guests(e).filter(g => status === 'yes' ? confirmed(e, g) : status === 'pending' ? g.status === 'yes' && !confirmed(e, g) : g.status === status);
        text += group.length ? group.map(g => `• ${g.name}${g.status === 'yes' ? ' (' + participantCount(e, g) + ' people)' : ''}${g.comment ? ' — ' + g.comment : ''}`).join('\n') + '\n' : 'Nobody yet\n';
      }
      return this.long(id, text, keyboard([button('Back to event', `v:${eid}`)]));
    }
    if (action === 'c') {
      return this.send(id, e.owner === id ? 'You’re the organiser — no RSVP needed.' : 'Choose an RSVP to add or update your comment.');
    }
    if (action === 'ticket') return this.ticket(id, e);
    if (action === 'approve' || action === 'reject') {
      const guestId = Number(arg); const guest = e.guests[guestId];
      if (!Number.isSafeInteger(guestId) || guestId === e.owner || !guest || guest.status !== 'yes' || confirmed(e, guest)) return this.send(id, 'There is no pending acceptance request for this guest.');
      if (action === 'approve') {
        guest.approval = 'approved'; guest.ticket = randomBytes(6).toString('hex').toUpperCase();
        await this.send(guestId, `✅ The organiser approved your response for ${e.title}.`); await this.ticket(guestId, e);
      } else {
        guest.approval = 'rejected'; guest.status = 'no'; delete guest.ticket;
        await this.home(guestId, `Your acceptance request for ${e.title} was not approved by the organiser. Contact them if you have questions.`);
      }
      return this.send(id, `${guest.name}: ${action === 'approve' ? 'approved — invitation ticket sent' : 'request rejected'}.`);
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
        await this.api(method, { chat_id: id, [f.type]: f.fileId, caption: `Shared by ${f.name}${f.caption ? '\n' + f.caption : ''}`, ...(e.owner === id ? { reply_markup: keyboard([button('Remove from event', `remove:${eid}:${f.id}`)]) } : {}) });
      }
      const nav = [];
      if (page > 0) nav.push(button('← Previous', `m:${eid}:${page - 1}`));
      if ((page + 1) * 5 < e.media.length) nav.push(button('Next →', `m:${eid}:${page + 1}`));
      return this.send(id, `Media page ${page + 1}`, keyboard(...(nav.length ? [nav] : []), [button('Back to event', `v:${eid}`)]));
    }
    if (action === 'remove') { e.media = e.media.filter(f => f.id !== arg); return this.send(id, 'Removed from the event collection. Previously sent copies remain in Telegram chats.'); }
    if (action === 'h') return this.send(id, 'Organiser tools', keyboard([button('Private guest responses', `a:${eid}`)], [button('Guest options', `permissions:${eid}`)], [button('Edit title', `edit:${eid}:title`), button('Edit time', `edit:${eid}:when`)], [button('Edit location', `edit:${eid}:location`), button('Edit description', `edit:${eid}:description`)], [button('🖼 Add / replace banner', `banner:${eid}`)], [button('Replace invite link', `rotate:${eid}`)], [button('Cancel event', `x:${eid}`), button('Delete event', `delete:${eid}`)], [button('Back to event', `v:${eid}`)]));
    if (action === 'permissions' || action === 'toggle') {
      e.permissions = permissions(e);
      if (action === 'toggle' && Object.hasOwn(permissionLabels, arg)) e.permissions[arg] = !e.permissions[arg];
      if (action === 'toggle' && ['requireApproval', 'hideLocation', 'askParticipantCount'].includes(arg)) e[arg] = !e[arg];
      if (action === 'toggle' && arg === 'isPublic') e.isPublic = !e.isPublic;
      if (action === 'toggle' && arg === 'allowLinkUploads') { e.allowLinkUploads = !e.allowLinkUploads; e.uploadToken = e.allowLinkUploads ? randomBytes(16).toString('hex') : null; }
      return this.send(id, 'Guest options — tap to enable or disable. Changes apply immediately to guests, including old buttons.', keyboard(...this.permissionKeyboard(e, `toggle:${eid}`), ...(this.appUrl ? [[this.miniButton('🗓 Deadline & invitation details', `?event=${eid}`)]] : []), [button('Back to organiser tools', `h:${eid}`)]));
    }
    if (action === 'a') {
      const rows = guests(e).map(g => `${g.name} — ${g.status === 'yes' && !confirmed(e, g) ? '⏳ Awaiting approval' : labels[g.status]}\nPeople: ${g.status === 'yes' ? participantCount(e, g) : 'Not attending'}\nPhone: ${g.phone || 'Not shared'}\n${(g.answers || []).map(a => `${a.question}: ${a.answer || 'Skipped'}`).join('\n')}\nComment: ${g.comment || 'None'}`);
      await this.long(id, `Private organiser responses — ${e.title}\n\n${rows.join('\n\n') || 'No guests yet.'}`, keyboard([button('Back to organiser tools', `h:${eid}`)]));
      for (const [uid, guest] of Object.entries(e.guests)) if (Number(uid) !== e.owner && guest.status === 'yes' && !confirmed(e, guest)) await this.send(id, `⏳ ${guest.name} — awaiting approval`, keyboard([button('✅ Approve', `approve:${eid}:${uid}`), button('❌ Reject', `reject:${eid}:${uid}`)]));
      return;
    }
    if (action === 'edit' && ['title', 'when', 'location', 'description'].includes(arg)) { this.session(id, { event: eid, step: 'edit', field: arg }); return this.prompt(id, `Enter the new ${arg}.`); }
    if (action === 'rotate') {
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
