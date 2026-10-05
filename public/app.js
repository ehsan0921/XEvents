import { setupGallery } from './gallery.js';
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const picker = query.get('mode') === 'picker';
const deadlinePicker = query.get('mode') === 'deadline';
const compactPicker = picker || deadlinePicker;
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let state = { events: [], preference: {} }, activeEvent = null, createdEvent = null, previewSequence = 0;
let requestId = crypto.randomUUID();
function priceLabel(e){return e.starPrice ? '⭐ '+e.starPrice+' Stars '+(e.starPricing==='person'?'per person':'per group') : 'Free';}
function priceEstimate(e){const currency=state.preference.currency || state.localCurrency;const rate=state.pricing?.rates?.[currency];return e.starPrice && rate ? '≈ '+new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code'}).format(e.starPrice*rate)+' · owner-set estimate; actual Stars cost varies' : '';}
function priceTag(e){return element('span',priceLabel(e),'tag');}
function updatePricePreview(){
  const value=Number($('stars-price').value);
  const e={starPrice:$('stars-enabled').checked && Number.isFinite(value) && value>0?value:0,starPricing:$('stars-pricing').value};
  $('event-price-tag').textContent=priceLabel(e);
  const currency=state.preference.currency || state.localCurrency,rate=state.pricing?.rates?.[currency];
  $('event-price-estimate').textContent=e.starPrice && rate ? '≈ '+new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code'}).format(e.starPrice*rate)+' '+(e.starPricing==='person'?'per person':'per group') : currency ? currency+' estimate unavailable' : 'Select a display currency';
  $('stars-rate-note').textContent=rate ? 'Reference: 1 Star ≈ '+new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:6}).format(rate)+'. Owner-set estimate; actual Telegram purchase prices vary.' : currency ? 'Add a '+currency+' reference rate under Admin → Owner fee settings to see the local equivalent.' : 'Choose your price display currency in Timezone settings to see a local equivalent.';
}
let listFilter = 'all';
let adminData = null, adminMode = 'events';
let bannerPreviewUrl;
const bannerUrls = new Map();
const initData = tg?.initData || '';
document.querySelector('[data-tab="pending"]').hidden = true;
let zones = [...new Set(['UTC', deviceZone, ...(Intl.supportedValuesOf?.('timeZone') || ['Australia/Sydney', 'Europe/London', 'America/New_York', 'Asia/Tehran'])])].sort();
tg?.ready(); tg?.expand();
function theme() { document.body.classList.toggle('dark', tg?.colorScheme === 'dark'); }
theme(); tg?.onEvent('themeChanged', theme);
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function selectedZone() { return state.preference.timezone || deviceZone; }
function options(id, zone, filter = '') {
  if (zone && !zones.includes(zone)) zones = [...zones, zone].sort();
  const select = $(id); select.replaceChildren();
  for (const value of zones.filter(z => z === zone || z.toLowerCase().replaceAll('_', ' ').includes(filter.toLowerCase().trim().replaceAll('_', ' ')))) {
    const option = document.createElement('option'); option.value = value; option.textContent = value.replaceAll('_', ' ').replaceAll('/', ' / '); select.append(option);
  }
  select.value = zone;
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'tma ' + initData, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Could not connect. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Could not save. Please try again.');
  return data;
}
function go(tab) {
  const target = tab === 'pending' ? 'events' : tab;
  if (tab === 'events' || tab === 'pending') { listFilter = tab === 'pending' ? 'pending' : 'all'; renderEvents(); }
  if (tab === 'admin' && !state.user?.isSuperAdmin) return;
  for (const name of ['events', 'create', 'settings', 'admin', 'gallery', 'explore']) $(name + '-view').hidden = name !== target;
  if (tab === 'explore') loadExplore();
  if (tab === 'admin') loadAdmin();
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
function dateInZone(instant, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function format(e, zone = selectedZone()) {
  if (!e.startsAt) return e.when + '\nTimezone not set — shown as entered by the organiser.';
  return new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(e.startsAt)) + ` (${zone})` + (e.endsAt ? '\nFinishes: ' + format({ startsAt: e.endsAt }, zone) : '');
}
function openTelegram(url) { if (tg?.initData) tg.openTelegramLink(url); else window.open(url, '_blank', 'noopener'); }
function share(e) { openTelegram(`https://t.me/share/url?url=${encodeURIComponent(e.inviteUrl)}&text=${encodeURIComponent(`You're invited to ${e.title}!`)}`); }
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function action(text, fn, className = 'secondary') { const b = element('button', text, className); b.type = 'button'; b.onclick = fn; return b; }
const {openGallery,showQr}=setupGallery({$,api,element,action,go,notice,openTelegram,initData});
function confirmAction(message, operation) {
  const dialog = $('confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  $('confirm-title').textContent = operation === 'delete' ? 'Delete event?' : 'Cancel event?';
  $('confirm-message').textContent = message;
  $('confirm-proceed').textContent = operation === 'delete' ? 'Delete event' : 'Cancel event';
  return new Promise(resolve => {
    const finish = accepted => { dialog.close(); resolve(accepted); };
    $('confirm-back').onclick = () => finish(false);
    $('confirm-proceed').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal(); $('confirm-back').focus();
  });
}
function renderEvents() {
  $('zone-note').textContent = `Your local time · ${selectedZone().replaceAll('_', ' ')}`;
  const list = $('event-list'); list.replaceChildren();
  document.querySelector('.section-heading h2').textContent = listFilter === 'pending' ? 'Pending invitations' : 'Your events';
  const events = [...state.events].filter(e => !e.cancelled && (e.isOwner || e.status !== 'no') && (listFilter !== 'pending' || (!e.isOwner && e.status === 'later'))).sort((a, b) => (a.startsAt || '').localeCompare(b.startsAt || ''));
  if (!events.length) { const empty = element('div', '', 'empty'); empty.append(element('strong', listFilter === 'pending' ? 'You’re all caught up.' : 'A calendar full of possibilities.'), element('span', listFilter === 'pending' ? 'No unanswered invitations.' : 'Create your first event, or open an invitation in the bot to join one.')); list.append(empty); }
  let lastGroup;
  events.sort((a,b) => ['Upcoming events','Past events','Date not set','Cancelled events'].indexOf(a.group) - ['Upcoming events','Past events','Date not set','Cancelled events'].indexOf(b.group) || (a.group === 'Past events' ? (b.startsAt || '').localeCompare(a.startsAt || '') : (a.startsAt || '').localeCompare(b.startsAt || '')));
  for (const e of events) {
    if (listFilter === 'all' && e.group !== lastGroup) { list.append(element('h2', e.group, 'event-group')); lastGroup = e.group; }
    const card = element('article', '', 'event-card');
    if (e.hasBanner) {
      const img = document.createElement('img'); img.className = 'event-banner'; img.alt = `Banner for ${e.title}`; card.append(img);
      fetch(`/api/events/${e.id}/banner`, { headers: { Authorization: 'tma ' + initData } }).then(r => { if (!r.ok) throw new Error(); return r.blob(); }).then(blob => { if (!img.isConnected) return; const old = bannerUrls.get(e.id); if (old) URL.revokeObjectURL(old); const url = URL.createObjectURL(blob); bannerUrls.set(e.id,url); img.src=url; }).catch(() => img.remove());
    }
    const meta = element('div', '', 'event-meta'); meta.append(element('span', e.cancelled ? 'CANCELLED' : e.isOwner ? 'YOU’RE HOSTING' : 'INVITED', e.cancelled ? 'tag cancelled' : 'tag'));
    meta.append(priceTag(e));
    if (e.status) meta.append(element('span', { yes: 'Accepted', no: 'Not coming', maybe: 'Tentative', later: 'Respond later' }[e.status], 'tag'));
    card.append(meta, element('h3', e.title), element('p', '🗓 ' + format(e)), element('p', '📍 ' + (e.location || (e.requireApproval ? 'Shared after organiser approval' : 'Shared after acceptance')), 'muted'));
    if (e.responsesClosed) card.append(element('p', '⏰ Responses closed — deadline passed.', 'error'));
    else if (e.responseDeadline) card.append(element('p', 'Respond by: ' + format({ startsAt: e.responseDeadline }), 'small muted'));
    if (e.approval === 'pending') card.append(element('p', 'The organiser will send your invitation details and ticket after approving your response.', 'muted'));
    if(priceEstimate(e))card.append(element('p',priceEstimate(e),'small muted'));
    if (e.starPrice) card.append(element('p', '⭐ ' + e.starPrice + ' Stars ' + (e.starPricing === 'person' ? 'per person' : 'per group') + (e.paymentStatus ? ' · ' + e.paymentStatus.replaceAll('_',' ') : ''), 'small muted'));
    if (e.participants) card.append(element('p', 'Your group: ' + e.participants + (e.participants === 1 ? ' person' : ' people'), 'small muted'));
    if (e.ticket) card.append(element('p', `🎟 ${e.ticket.name}${e.ticket.code ? ' · ' + e.ticket.code : ''}${e.ticket.info ? '\n' + e.ticket.info : ''}`, 'time-preview'));
    if (e.startsAt && selectedZone() !== e.timezone) card.append(element('p', 'Organiser time: ' + format(e, e.timezone), 'small muted'));
    if (e.counts) card.append(element('div', `${e.counts.participants} people coming (${e.counts.yes} responses) · ${e.counts.pendingParticipants || 0} people awaiting approval · ${e.counts.awaitingPayment || 0} awaiting payment · ${e.counts.maybe} tentative · ${e.counts.no} declined · ${e.counts.later} later`, 'counts'));
    else card.append(element('div', 'Guest list is private to the organiser.', 'counts'));
    const actions = element('div', '', 'event-actions'); actions.append(action('Open event in chat ↗', () => openTelegram(e.inviteUrl), 'primary'));
    if (e.isOwner && !e.cancelled) actions.append(action('Edit event', () => setupForm(e)));
    if(e.starPrice && !e.isOwner && e.status==='yes' && e.approval==='approved' && e.paymentStatus!=='paid')actions.append(action('⭐ Pay with Stars',()=>openTelegram(e.inviteUrl.replace('?start=e_','?start=pay_'))));
    actions.append(action('Copy link', async () => { try { await navigator.clipboard.writeText(e.inviteUrl); notice('✓ Event link copied.'); } catch { notice('Could not copy the link. Use Share invite under the three-dot menu.'); } }));
    const more = document.createElement('details'); more.className = 'event-more';
    const moreToggle = element('summary','⋯'); moreToggle.setAttribute('aria-label',`More options for ${e.title}`);
    const extraActions = element('div','','event-more-panel'); more.append(moreToggle,extraActions);
    extraActions.append(action('Share invite', () => share(e)));
    if(e.starPrice)extraActions.append(action(e.isOwner?'Payments & refunds':'Payment support',()=>openTelegram(e.inviteUrl.split('?')[0]+'?start=payments')));
    if (e.isOwner || e.permissions.viewMedia) {
      actions.append(action('🗂 Shared media', () => openGallery(e.id)));
    }
    if (e.isOwner && e.uploadLink) extraActions.append(action('Upload link & QR code', () => showQr(e.id)));
    if (e.isOwner && !e.cancelled) {
      for (const operation of ['cancel','delete']) extraActions.append(action(operation === 'cancel' ? 'Cancel event' : 'Delete event', async () => {
        const text = operation === 'delete' ? `Permanently delete “${e.title}”, including saved responses and media references? Accepted and tentative guests will be notified. Previously sent Telegram copies remain.` : `Cancel “${e.title}”? Accepted and tentative guests will be notified.`;
        if (!await confirmAction(text, operation)) return;
        try { await api(`events/${e.id}/${operation}`,{confirm:true}); await refresh(); notice(operation === 'delete' ? 'Event deleted. Accepted and tentative guests notified.' : 'Event cancelled. Accepted and tentative guests notified.'); }
        catch(error) { notice(error.message); }
      }));
    }
    if (e.location) extraActions.append(action('Copy address', async () => { try { await navigator.clipboard.writeText(e.location); notice('✓ Address copied.'); } catch { notice('Select and copy the address shown on the event.'); } }));
    if (e.upcoming) {
      const label = element('label', 'Event reminder'); const select = document.createElement('select'); select.setAttribute('aria-label', `Reminder for ${e.title}`);
      for (const [minutes,text] of [[0,'Off'],[15,'15 minutes before'],[60,'1 hour before'],[120,'2 hours before'],[180,'3 hours before'],[240,'4 hours before'],[1440,'1 day before']]) { const option = element('option',text); option.value=minutes; option.disabled=minutes > 0 && Date.parse(e.startsAt)-minutes*60000 <= Date.now(); select.append(option); }
      select.value=e.reminder || 0;
      select.onchange=async () => { select.disabled=true; try { const result=await api(`events/${e.id}/reminder`,{minutes:Number(select.value)}); Object.assign(e,result.event); notice(e.reminder ? '🔔 Reminder saved. We’ll message you in Telegram.' : 'Reminder turned off.'); } catch(err) { select.value=e.reminder || 0; notice(err.message); } finally { select.disabled=false; } };
      label.append(select); extraActions.append(label);
    }
    card.append(actions,more); list.append(card);
  }
}
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.event-more[open]')) if (!menu.contains(event.target) || event.target.closest('button')) menu.open=false; });
document.addEventListener('keydown', event => { if (event.key==='Escape') for (const menu of document.querySelectorAll('.event-more[open]')) { menu.open=false; menu.querySelector('summary').focus(); } });
function setupForm(event = null) {
  activeEvent = event; createdEvent = null; requestId = crypto.randomUUID();
  $('event-form').reset(); $('event-form').hidden = false; $('success').hidden = true; $('form-error').hidden = true;
  $('stars-panel').hidden = compactPicker || !state.user?.isSuperAdmin;
  $('stars-enabled').checked = !!(event ? event.starPrice : state.user?.isSuperAdmin && state.pricing?.defaultStarPrice); $('stars-fields').hidden = !$('stars-enabled').checked;
  $('stars-price').value = event?.starPrice || state.pricing?.defaultStarPrice || 100; $('stars-pricing').value = event?.starPricing || state.pricing?.defaultStarPricing || 'person';
  updatePricePreview();
  $('payment-terms').value = event?.paymentTerms || '';
  $('visibility-panel').hidden = compactPicker; $('event-visibility').value = event?.isPublic ? 'public' : 'private';
  $('ending-panel').hidden = deadlinePicker;
  $('end-mode').value = event?.endMode || 'none';
  $('duration-hours').value = event?.durationMinutes ? Math.floor(event.durationMinutes / 60) : 2;
  $('duration-minutes').value = event?.durationMinutes ? event.durationMinutes % 60 : 0;
  $('finish-date').value = event?.endDate || event?.localDate || dateInZone(Date.now(), selectedZone()); $('finish-time').value = event?.endTime || '20:00';
  updateEnding();
  const scheduleOnly = compactPicker || !!event;
  $('event-details').hidden = scheduleOnly; $('optional-details').hidden = scheduleOnly;
  $('banner-panel').hidden = compactPicker; $('banner-preview').hidden = true;
  $('guest-permissions').hidden = compactPicker;
  $('default-reminder-panel').hidden = compactPicker; $('default-reminder').value = event?.defaultReminder || 0;
  $('response-deadline').hidden = compactPicker;
  $('clear-draft-deadline').hidden = !deadlinePicker;
  $('ask-participant-count').checked = event?.askParticipantCount === true;
  $('require-approval').checked = event?.requireApproval === true;
  $('hide-location').checked = event?.hideLocation === true || event?.requireApproval === true;
  $('hide-location').disabled = $('require-approval').checked;
  $('ticket-info').value = event?.ticketInfo || '';
  $('deadline-enabled').checked = !!event?.responseDeadline;
  $('deadline-date').value = event?.deadlineDate || '';
  $('deadline-time').value = event?.deadlineTime || '';
  updateDeadline();
  $('allow-guest-list').checked = event?.permissions?.guestList === true;
  $('allow-link-uploads').checked = event?.allowLinkUploads === true;
  $('allow-upload-media').checked = event?.permissions?.uploadMedia === true;
  $('allow-view-media').checked = event?.permissions?.viewMedia === true;
  $('title').required = !scheduleOnly; $('location').required = !scheduleOnly;
  $('form-title').textContent = deadlinePicker ? 'When do replies close?' : picker ? 'Pick your moment.' : event ? 'A change of plans.' : 'Make a plan.';
  $('form-description').textContent = deadlinePicker ? 'Set the last date and time guests can respond, then continue creating the event in chat.' : picker ? 'Choose a date and time, then continue in the chat.' : event ? `Update the time and guest options for ${event.title}.` : 'Pick a date. Share an invite. Let the good times follow.';
  $('save-event').textContent = deadlinePicker ? 'Set response deadline' : picker ? 'Use this time & continue' : event ? 'Save event settings' : 'Create event & get invite';
  $('cancel-edit').hidden = !event;
  const zone = deadlinePicker ? state.session?.timezone || selectedZone() : event?.timezone || selectedZone(); options('event-zone', zone);
  const tomorrow = new Date(dateInZone(Date.now(), zone) + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  $('date').value = (deadlinePicker ? state.session?.deadlineDate : event?.localDate) || tomorrow.toISOString().slice(0, 10); $('time').value = (deadlinePicker ? state.session?.deadlineTime : event?.localTime) || '18:00';
  if (!event?.endDate) $('finish-date').value = $('date').value;
  go('create'); preview();
}
let timer;
async function preview() {
  const seq = ++previewSequence;
  if (!initData) { $('time-preview').textContent = 'Open inside Telegram to preview and save your event time.'; return; }
  try {
    const result = await api('preview', { ...endingInput(), date: $('date').value, time: $('time').value, timezone: $('event-zone').value });
    if (seq !== previewSequence) return;
    $('time-preview').textContent = '🗓 ' + format(result, $('event-zone').value); $('time-preview').classList.remove('error');
  } catch (e) {
    if (seq !== previewSequence) return;
    $('time-preview').textContent = e.message; $('time-preview').classList.add('error');
  }
}
async function refresh() {
  const data = await api('bootstrap'); state = data;
  const hasPending = data.events.some(e => !e.isOwner && !e.cancelled && e.status === 'later');
  document.querySelector('[data-tab="pending"]').hidden = !hasPending;
  if (!hasPending && listFilter === 'pending') go('events');
  $('admin-tab').hidden = !data.user.isSuperAdmin;
  document.querySelector('.bottom-nav').classList.toggle('with-admin', data.user.isSuperAdmin);
  $('greeting').textContent = `LET’S MAKE PLANS, ${data.user.firstName.toUpperCase()}`;
  const currencySelect=$('display-currency');currencySelect.replaceChildren(element('option','Automatic from timezone'));currencySelect.firstChild.value='';for(const code of state.currencyCodes || []){const option=element('option',code);option.value=code;currencySelect.append(option);}currencySelect.value=state.preference.currency || '';
  options('local-zone', selectedZone()); $('device-zone').textContent = `Detected on this device: ${deviceZone}`;
  renderEvents(); return data;
}
async function loadExplore() {
  $('explore-refresh').disabled=true; $('explore-error').hidden=true;
  $('explore-zone').textContent='Public events in '+selectedZone().replaceAll('_',' ');
  const list=$('explore-list');list.replaceChildren(element('p','Finding public events…','muted'));
  try {
    const result=await api('explore?timezone='+encodeURIComponent(selectedZone()));list.replaceChildren();
    if(!result.events.length) list.append(element('div','No public upcoming events in your timezone yet.','empty'));
    for(const event of result.events) {
      const card=element('article','','event-card');
      if(event.hasBanner) { const img=document.createElement('img');img.className='event-banner';img.alt='Banner for '+event.title;card.append(img);fetch(`/api/events/${event.id}/banner`,{headers:{Authorization:'tma '+initData}}).then(r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(!img.isConnected)return;const url=URL.createObjectURL(blob);img.src=url;img.onload=()=>URL.revokeObjectURL(url);}).catch(()=>img.remove()); }
      card.append(element('span','PUBLIC','tag'),priceTag(event),element('h3',event.title),element('p','🗓 '+format(event)),element('p',event.description));
      if(priceEstimate(event))card.append(element('p',priceEstimate(event),'small muted'));
      if(event.responsesClosed)card.append(element('p','Responses are closed.','small muted'));
      card.append(action('Open invitation in Telegram',()=>openTelegram(event.inviteUrl),'primary'));list.append(card);
    }
  } catch(error) {list.replaceChildren();$('explore-error').textContent=error.message;$('explore-error').hidden=false;}
  finally {$('explore-refresh').disabled=false;}
}
$('explore-refresh').onclick=loadExplore;
async function loadAdmin() {
  $('admin-refresh').disabled = true; $('admin-error').hidden = true;
  try { adminData = await api('admin/overview');
  $('owner-default-price').value=adminData.pricing?.defaultStarPrice || 0; $('owner-default-unit').value=adminData.pricing?.defaultStarPricing || 'person';
  $('owner-currency-rates').value=Object.entries(adminData.pricing?.rates || {}).map(([code,rate])=>code+' = '+rate).join('\n');
renderAdmin(); }
  catch (error) { $('admin-error').textContent=error.message; $('admin-error').hidden=false; $('admin-list').replaceChildren(); }
  finally { $('admin-refresh').disabled=false; }
}
function renderAdmin() {
  if (!adminData) return;
  $('admin-summary').textContent=`${adminData.events.length} events · ${adminData.users.length} users · ${adminData.events.filter(e=>e.group==='Upcoming events').length} upcoming`;
  $('admin-events').className=adminMode==='events' ? 'primary' : 'secondary'; $('admin-users').className=adminMode==='users' ? 'primary' : 'secondary';
  const list=$('admin-list'); list.replaceChildren(); const search=$('admin-search').value.trim().toLowerCase();
  const userName=u=>[u.firstName,u.lastName].filter(Boolean).join(' ') || u.names?.[0] || `User ${u.id}`;
  const eventNames=ids=>ids.map(id=>adminData.events.find(e=>e.id===id)?.title || id).join(', ') || 'None';
  const entries=(adminMode==='events' ? adminData.events : adminData.users).filter(item=>JSON.stringify(item).toLowerCase().includes(search));
  if (!entries.length) list.append(element('div','No results.','empty'));
  for (const item of entries) {
    const card=element('article','','event-card');
    if (adminMode==='users') {
      card.append(element('h3',userName(item)),element('p',`Telegram ID: ${item.id}${item.username ? '\n@'+item.username : ''}`),element('p',`Timezone: ${item.timezone || 'Not set'}\nFirst seen: ${item.firstSeen ? new Date(item.firstSeen).toLocaleString() : 'Legacy user'}\nLast seen: ${item.lastSeen ? new Date(item.lastSeen).toLocaleString() : 'Unknown'}`,'small muted'),element('p','Hosting: '+eventNames(item.organised)),element('p','Invited: '+eventNames(item.invited)));
      if (item.names.length) card.append(element('p','Guest names: '+item.names.join(', '),'small muted'));
    } else {
      const owner=adminData.users.find(u=>u.id===item.owner);
      card.append(element('span',item.group,'tag'),priceTag(item),element('h3',item.title),element('p','🗓 '+format(item)),element('p',`Organiser: ${owner ? userName(owner) : item.owner} · ${item.owner}`),element('p','📍 '+item.location),element('p',item.description),element('p',`${item.guests.length} guests · ${item.counts.yes} accepted · ${item.counts.pending} pending approval · ${item.mediaCount} media items`,'counts'));
      if(priceEstimate(item))card.append(element('p',priceEstimate(item),'small muted'));
      const details=document.createElement('details'); details.append(element('summary','Event settings & guest responses'));
      details.append(element('p',`Event ID: ${item.id}\nApproval required: ${item.requireApproval ? 'Yes' : 'No'}\nLocation restricted: ${item.hideLocation || item.requireApproval ? 'Yes' : 'No'}\nGuest list: ${item.permissions.guestList ? 'On' : 'Off'} · Uploads: ${item.permissions.uploadMedia ? 'On' : 'Off'} · Shared media: ${item.permissions.viewMedia ? 'On' : 'Off'}\nResponse deadline: ${item.responseDeadline ? format({startsAt:item.responseDeadline}) : 'None'}\nBanner: ${item.hasBanner ? 'Yes' : 'No'}`,'small muted'));
      if (item.ticketInfo) details.append(element('p','Invitation details: '+item.ticketInfo));
      for (const guest of item.guests) details.append(element('div',`${guest.name} · ${guest.id}\nResponse: ${{yes:'Accepted',no:'Declined',maybe:'Tentative',later:'Later'}[guest.status] || guest.status}${guest.approval ? ' · '+guest.approval : ''}\nPeople: ${guest.participants ?? 'Not attending'}\nPhone: ${guest.phone || 'Not shared'}\nComment: ${guest.comment || 'None'}${guest.answers.map(a=>'\n'+a.question+': '+(a.answer || 'Skipped')).join('')}`,'admin-guest'));
      if (!item.guests.length) details.append(element('p','No guests yet.','muted'));
      card.append(details);
    }
    list.append(card);
  }
}
$('admin-search').oninput=renderAdmin;
$('admin-events').onclick=()=>{adminMode='events';renderAdmin();};
$('admin-users').onclick=()=>{adminMode='users';renderAdmin();};
$('admin-refresh').onclick=loadAdmin;
$('owner-pricing-form').onsubmit=async event=>{
  event.preventDefault();$('save-owner-pricing').disabled=true;
  try{
    const rates={};
    for(const line of $('owner-currency-rates').value.split('\n').map(l=>l.trim()).filter(Boolean)){
      const match=line.match(/^([A-Za-z]{3})\s*=\s*(\d+(?:\.\d+)?)$/);
      if(!match)throw Error('Use one currency code = rate per line.');
      const code=match[1].toUpperCase();if(Object.hasOwn(rates,code))throw Error('Each currency can appear only once.');rates[code]=Number(match[2]);
    }
    const result=await api('admin/pricing',{defaultStarPrice:Number($('owner-default-price').value),defaultStarPricing:$('owner-default-unit').value,rates});
    adminData.pricing=result.settings;state.pricing=result.settings;renderEvents();$('owner-pricing-status').textContent='Saved. New events use this default; current event prices are unchanged.';
  }catch(error){$('owner-pricing-status').textContent=error.message;}finally{$('save-owner-pricing').disabled=false;}
};
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { notice(''); b.dataset.tab === 'create' ? setupForm() : go(b.dataset.tab); };
$('hero-create').onclick = () => setupForm();
$('banner').onchange = () => { if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl); const file=$('banner').files[0]; $('banner-preview').hidden=!file; if (file) { bannerPreviewUrl=URL.createObjectURL(file); $('banner-preview').src=bannerPreviewUrl; } };
$('cancel-edit').onclick = () => go('events');
$('refresh').onclick = async () => { $('refresh').disabled = true; try { await refresh(); notice(''); } catch (e) { notice(e.message); } finally { $('refresh').disabled = false; } };
for (const id of ['date', 'time', 'event-zone']) $(id).addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(preview, 180); });
for (const [search, select] of [['event-zone-search', 'event-zone'], ['local-zone-search', 'local-zone']]) $(search).oninput = () => options(select, $(select).value, $(search).value);
$('detect-zone').onclick = () => { $('local-zone-search').value = ''; options('local-zone', deviceZone); };
function updateDeadline() { for (const id of ['deadline-date', 'deadline-time']) { $(id).disabled = !$('deadline-enabled').checked; $(id).required = $('deadline-enabled').checked; } }
function endingInput() { return deadlinePicker ? {} : { endMode: $('end-mode').value, durationMinutes: Number($('duration-hours').value)*60 + Number($('duration-minutes').value), endDate: $('finish-date').value, endTime: $('finish-time').value }; }
function updateEnding() {
  const mode = $('end-mode').value;
  $('duration-fields').hidden = mode !== 'duration'; $('finish-fields').hidden = mode !== 'finish';
  for (const [id, active] of [['duration-hours',mode==='duration'],['duration-minutes',mode==='duration'],['finish-date',mode==='finish'],['finish-time',mode==='finish']]) { $(id).disabled = !active; $(id).required = active; }
}
$('end-mode').onchange=()=>{updateEnding();preview();};
for (const id of ['duration-hours','duration-minutes','finish-date','finish-time']) $(id).onchange=preview;
$('deadline-enabled').onchange = updateDeadline;
$('allow-link-uploads').onchange=()=>{if($('allow-link-uploads').checked)$('allow-upload-media').checked=true;};
$('allow-upload-media').onchange=()=>{if(!$('allow-upload-media').checked)$('allow-link-uploads').checked=false;};
$('stars-enabled').onchange = () => { $('stars-fields').hidden = !$('stars-enabled').checked; updatePricePreview(); };
$('stars-price').oninput=updatePricePreview; $('stars-pricing').onchange=updatePricePreview;
$('require-approval').onchange = () => { if ($('require-approval').checked) $('hide-location').checked = true; $('hide-location').disabled = $('require-approval').checked; };
$('clear-draft-deadline').onclick = async () => { try { await api('draft-deadline', { clear: true, sessionToken: query.get('session') }); notice('✓ Response deadline removed. Continue creating your event in chat.'); tg?.close(); } catch (e) { notice(e.message); } };
$('timezone-form').onsubmit = async event => {
  event.preventDefault(); $('save-zone').disabled = true;
  try { const result = await api('preferences', { timezone: $('local-zone').value,currency:$('display-currency').value }); state.preference = result.preference; await refresh(); notice('✓ Your timezone is saved. Event times now show in your local time.'); tg?.HapticFeedback?.notificationOccurred('success'); }
  catch (e) { notice(e.message); } finally { $('save-zone').disabled = false; }
};
$('event-form').onsubmit = async event => {
  event.preventDefault(); $('save-event').disabled = true; $('form-error').hidden = true;
  const payload = { ...(state.user.isSuperAdmin ? {starPrice:$('stars-enabled').checked ? Number($('stars-price').value) : 0, starPricing:$('stars-pricing').value, paymentTerms:$('payment-terms').value} : {}), askParticipantCount: $('ask-participant-count').checked, isPublic: $('event-visibility').value === 'public', allowLinkUploads: $('allow-link-uploads').checked, ...endingInput(), defaultReminder: Number($('default-reminder').value), date: $('date').value, time: $('time').value, timezone: $('event-zone').value, permissions: { guestList: $('allow-guest-list').checked, uploadMedia: $('allow-upload-media').checked, viewMedia: $('allow-view-media').checked }, requireApproval: $('require-approval').checked, hideLocation: $('hide-location').checked, ticketInfo: $('ticket-info').value, deadlineDate: $('deadline-enabled').checked ? $('deadline-date').value : '', deadlineTime: $('deadline-enabled').checked ? $('deadline-time').value : '' };
  try {
    const banner = $('banner').files[0];
    if (!compactPicker && banner && (banner.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(banner.type))) throw new Error('Choose a JPG, PNG, or WebP banner smaller than 5 MB.');
    if (compactPicker) {
      await api(deadlinePicker ? 'draft-deadline' : 'picker', { ...payload, sessionToken: query.get('session') });
      $('event-form').hidden = true; notice('✓ Time saved. Continue with the next step in your bot chat.');
      $('success').hidden = false; $('success-title').textContent = 'Your time is saved.'; $('success-time').textContent = 'Go back to the chat to continue.'; $('share-event').hidden = true; $('another-event').hidden = true;
      $('open-chat').textContent = 'Continue in Telegram'; $('open-chat').onclick = () => tg?.close();
    } else {
      const path = activeEvent ? `events/${activeEvent.id}/schedule` : 'events';
      const result = await api(path, { ...payload, title: $('title').value, location: $('location').value, description: $('description').value, questions: $('questions').value, requestId });
      createdEvent = result.event; await refresh();
      if (banner) {
        const form = new FormData(); form.set('photo', banner);
        const response = await fetch(`/api/events/${createdEvent.id}/banner`, { method: 'POST', headers: { Authorization: 'tma ' + initData }, body: form });
        const saved = await response.json();
        if (!response.ok) throw new Error('Event saved. ' + saved.error + ' Your event won’t be duplicated if you retry.');
        createdEvent = saved.event; await refresh();
      }
      $('event-form').hidden = true; $('success').hidden = false; $('share-event').hidden = false; $('another-event').hidden = false;
      $('success-title').textContent = activeEvent ? 'The new time is set.' : 'Your event is ready.'; $('success-time').textContent = format(createdEvent)+' · '+priceLabel(createdEvent)+(priceEstimate(createdEvent)?' · '+priceEstimate(createdEvent):'');
      $('open-chat').textContent = 'Open event in chat'; $('open-chat').onclick = () => openTelegram(createdEvent.inviteUrl);
    }
    tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) { $('form-error').textContent = e.message; $('form-error').hidden = false; tg?.HapticFeedback?.notificationOccurred('error'); }
  finally { $('save-event').disabled = false; }
};
$('share-event').onclick = () => createdEvent && share(createdEvent);
$('another-event').onclick = () => go('events');
if (!initData) {
  notice('This is the XEvents Telegram planner. Open @XEvents_bot and tap Open planner to create events and save your timezone.');
  $('event-list').replaceChildren(element('div', 'Your events are private. Open this planner inside Telegram to see them.', 'empty'));
  $('save-event').disabled = true; $('save-zone').disabled = true; $('refresh').disabled = true;
  options('local-zone', deviceZone); options('event-zone', deviceZone); $('device-zone').textContent = `Detected on this device: ${deviceZone}`;
} else {
  try {
    const data = await refresh();
    if (!state.preference.timezone) { const saved = await api('preferences', { timezone: deviceZone }); state.preference = saved.preference; options('local-zone', selectedZone()); renderEvents(); }
    if (compactPicker) { setupForm(state.events.find(e => e.id === data.session?.event) || null); document.querySelector('.bottom-nav').hidden = true; if (data.session?.token !== query.get('session')) { notice('This picker has expired. Open a new picker from the current chat step.'); $('save-event').disabled = true; } }
    else if (query.get('gallery')) await openGallery(query.get('gallery'));
    else if (query.get('qr')) await showQr(query.get('qr'));
    else if (query.get('event')) { const event = state.events.find(e => e.id === query.get('event')); if (event?.isOwner && !event.cancelled) setupForm(event); }
  } catch (e) { notice(e.message); $('event-list').replaceChildren(element('div', 'Could not load your events. Tap Refresh to try again.', 'empty')); }
}
