import { setupGallery } from './gallery.js';
import { setupEventActions } from './event-actions.js';
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const picker = query.get('mode') === 'picker';
const deadlinePicker = query.get('mode') === 'deadline';
const compactPicker = picker || deadlinePicker;
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let state = { events: [], preference: {} }, activeEvent = null, createdEvent = null, previewSequence = 0;
let requestId = crypto.randomUUID();
let formReady=false;
function isManager(event){return event?.isManager===true || event?.isOwner===true;}
function oneTimeInviteEnabled(event){return event?.oneTimeInvite ?? (event?.invitationMode==='named');}
function priceLabel(e){if(['bank','link'].includes(e.paymentMethod))return 'Paid · '+e.displayPrice;return e.starPrice ? '⭐ '+e.starPrice+' Stars '+(e.starPricing==='person'?'per person':'per group') : 'Free';}
function priceEstimate(e){const currency=state.preference.currency || state.localCurrency;const rate=state.pricing?.rates?.[currency];return e.starPrice && rate ? '≈ '+new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code'}).format(e.starPrice*rate)+' · estimated organiser reward; guest purchase cost varies' : '';}
function priceTag(e){return element('span',priceLabel(e),'tag');}
function updatePricePreview(){
  const value=Number($('stars-price').value);
  const method=$('stars-enabled').checked ? $('payment-method').value : 'free';
  const cohostEditing=!!activeEvent && !activeEvent.isOwner && isManager(activeEvent),readOnly=compactPicker || cohostEditing;
  $('payment-owner-note').hidden=!cohostEditing;
  for(const id of ['stars-enabled','payment-method','stars-pricing'])$(id).disabled=readOnly;
  $('payment-terms').required=method!=='free' && !readOnly;
  $('payment-terms').disabled=method==='free' || readOnly;
  $('stars-price').disabled=method!=='stars' || readOnly;
  for (const [id, active] of [['display-price',['bank','link'].includes(method)],['payment-url',method==='link'],['payment-instructions',method==='bank']]) {
    const input=$(id); if(input) { input.required=active && !readOnly; input.disabled=!(id==='payment-instructions' ? ['bank','link'].includes(method) : active) || readOnly; }
  }
  $('payment-terms').setCustomValidity($('payment-terms').required && !$('payment-terms').value.trim() ? 'Enter payment and refund terms for this paid event.' : '');
  $('manual-price-fields').hidden=method==='stars' || method==='free';$('stars-price-fields').hidden=method!=='stars';$('payment-link-fields').hidden=method!=='link';
  const e={paymentMethod:method,displayPrice:$('display-price').value || 'Set a price',starPrice:method==='stars' && Number.isFinite(value) && value>0?value:0,starPricing:$('stars-pricing').value};
  $('event-price-tag').textContent=priceLabel(e);
  const currency=state.preference.currency || state.localCurrency,rate=state.pricing?.rates?.[currency];
  $('event-price-estimate').textContent=e.starPrice && rate ? '≈ '+new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code'}).format(e.starPrice*rate)+' '+(e.starPricing==='person'?'per person':'per group') : currency ? currency+' online rate temporarily unavailable' : 'Select a display currency';
  $('stars-rate-note').textContent=rate ? 'Automatic online estimate of organiser rewards. Guest Stars purchase prices vary.'+(state.pricing?.dates?.[currency] ? ' Exchange-rate date: '+state.pricing.dates[currency]+'.' : '') : currency ? 'Online currency rates are temporarily unavailable. Stars payments still work; try Refresh later.' : 'Choose your display currency in Timezone settings.';
}
let listFilter = 'all';
let adminData = null, adminMode = 'events';
let adminWhitelist = null, whitelistBusy = false;
let bannerPreviewUrl,bannerLoadGeneration=0;
let profilePhotoUrl,profilePhotoGeneration=0;
let botIconUrl,botIconGeneration=0;
const bannerUrls = new Map();
const initData = tg?.initData || '';
document.querySelector('[data-tab="pending"]').hidden = true;
let zones = [...new Set(['UTC', deviceZone, ...(Intl.supportedValuesOf?.('timeZone') || ['Australia/Sydney', 'Europe/London', 'America/New_York', 'Asia/Tehran'])])].sort();
function telegramStartup(method,...args){
  try{return tg?.[method]?.(...args);}
  catch(error){window.reportAppError?.(error,'Telegram '+method);}
}
telegramStartup('ready');telegramStartup('expand');
function theme() { document.body.classList.toggle('dark', tg?.colorScheme === 'dark'); }
theme(); telegramStartup('onEvent','themeChanged',theme);
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
  let response;
  try { response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'tma ' + initData, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { $('connection-status').textContent='Connection interrupted. Tap Refresh to reconnect.'; const error=new Error('Could not connect. Check your internet connection and tap Refresh.');window.reportAppError?.(error,'Connection');throw error; }
  let data;
  try { data = await response.json(); } catch { const error=new Error('The server returned an unreadable response. Please try again.');window.reportAppError?.(error,'HTTP '+response.status);throw error; }
  if (!response.ok) { if(response.status===401)$('connection-status').textContent='Telegram session expired or unavailable. Close this app and reopen it from the bot.';const error=new Error(`HTTP ${response.status}: ${data.error || 'Could not save. Please try again.'}${data.reference ? ' · Reference '+data.reference : ''}`);window.reportAppError?.(error);throw error; }
  return data;
}
function go(tab) {
  const target = tab === 'pending' ? 'events' : tab;
  if (tab === 'events' || tab === 'pending') { listFilter = tab === 'pending' ? 'pending' : 'all'; renderEvents(); }
  if (tab === 'admin' && !state.user?.isSuperAdmin) return;
  for (const name of ['home','events', 'create', 'settings', 'admin', 'gallery', 'explore']) $(name + '-view').hidden = name !== target;
  if(tab==='home'){renderHome();loadHomeSuggestions();}
  if (tab === 'explore') loadExplore();
  if (tab === 'admin') loadAdmin();
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === (tab==='admin'?'settings':tab==='pending'?'events':tab)) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
function dateInZone(instant, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function format(e, zone = selectedZone()) {
  if (!e.startsAt) return e.when + '\nTimezone not set — shown as entered by the organiser.';
  let text = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(e.startsAt)) + ` (${zone})`;
  if (e.endsAt) {
    const sameDay = dateInZone(e.startsAt, zone) === dateInZone(e.endsAt, zone);
    const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' });
    const offsetAt = instant => offset.formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName').value;
    const offsetChanges = offsetAt(e.startsAt) !== offsetAt(e.endsAt);
    text += '\nFinishes: ' + new Intl.DateTimeFormat('en-AU', { timeZone: zone, ...(!sameDay ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit', ...(offsetChanges ? { timeZoneName: 'short' } : {}) }).format(new Date(e.endsAt));
  }
  return text;
}
function openTelegram(url) { if (tg?.initData) tg.openTelegramLink(url); else window.open(url, '_blank', 'noopener'); }
function invitationGuestLine(guest){return guest.name+(guest.participantMode==='ask' ? ' = ?' : guest.participants ? ' = '+guest.participants+(guest.participantMode==='confirm' ? '!' : guest.participantMode==='fixed' ? '*' : '') : '');}
function guestNamesIn(text){return text.split('\n').map(line=>line.split('=')[0].trim()).filter(Boolean);}
function validateGuestAddition(name,names){
  if(names.length>=100)throw Error('The guest list already has 100 invitations.');
  if(names.some(value=>value.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('That name is already in the list. Add a label to distinguish guests.');
}
const guestEditorVersions=new Map();
function setupGuestEditor(prefix,addGuest,isCurrent=()=>true){
  const name=$(prefix+'-name'),count=$(prefix+'-count'),mode=$(prefix+'-mode'),button=$(prefix+'-add'),status=$(prefix+'-status');
  const version=Symbol(prefix);guestEditorVersions.set(prefix,version);const current=()=>guestEditorVersions.get(prefix)===version && isCurrent();
  let blocked=false,pending=false;name.value='';mode.value='one';status.textContent='';count.replaceChildren();
  for(let value=1;value<=10;value++){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);count.append(option);}count.value='1';
  const update=()=>{const needsCount=['editable','confirm','fixed'].includes(mode.value);$(prefix+'-count-field').hidden=!needsCount;count.disabled=blocked || pending || !needsCount;name.disabled=mode.disabled=button.disabled=blocked || pending;};
  mode.onchange=update;
  button.onclick=async()=>{
    if(blocked || pending || !current())return;
    const guestName=name.value.trim(),participants=Number(count.value),setting=mode.value;
    if(!guestName || guestName.length>100 || /[=\r\n]/.test(guestName)){status.textContent='Enter a name of up to 100 characters, without = or line breaks.';name.focus();return;}
    if(!['one','ask','editable','confirm','fixed'].includes(setting) || !Number.isInteger(participants) || participants<1 || participants>10){status.textContent='Choose a count from 1 to 10.';return;}
    const line=guestName+(setting==='one'?'':setting==='ask'?' = ?':' = '+participants+(setting==='confirm'?'!':setting==='fixed'?'*':''));
    pending=true;status.textContent='';update();
    try{const added=await addGuest({name:guestName,line});if(added && current()){name.value='';mode.value='one';count.value='1';status.textContent=guestName+' added.';name.focus();}}
    catch(error){if(current())status.textContent=error.message;}
    finally{pending=false;if(current())update();}
  };
  update();return {setDisabled(value){blocked=value;update();}};
}
function inviteText(e,guest){
  const when=e.startsAt ? format(e,e.timezone || selectedZone()) : e.when;
  const paid=e.starPrice>0 || ['bank','link','stars'].includes(e.paymentMethod);
  const privateLocation=e.hideLocation || e.requireApproval || e.locationAfterApproval || paid;
  const location=e.location && !privateLocation ? `At ${e.location}.` : paid ? e.requireApproval ? 'Location will be available after organiser approval and confirmed payment.' : 'Location will be available after confirmed payment.' : e.requireApproval ? 'Location will be available after organiser approval.' : 'Location will be available after your response.';
  const askCount=guest && (guest.participantMode==='ask' || (!guest.participants && e.askParticipantCount));
  const participants=guest?.participants || 1;
  const deadline=e.responseDeadline ? 'Please respond by '+format({startsAt:e.responseDeadline},e.timezone || selectedZone())+'.' : '';
  return [guest ? `Dear ${guest.name},` : '',`You are invited to ${e.title}${when ? ' on '+when : ''}.`,location,priceLabel(e),guest ? askCount ? 'Please choose how many people will attend.' : `Host has reserved ${participants} ${participants===1?'place':'places'} for you.${guest.participantMode==='fixed' ? ' This count is fixed.' : ''}` : '',deadline,e.inviteMessage,'Please respond below.'].filter(Boolean).join('\n\n');
}
function share(e) { if(e.invitationMode==='named' && isManager(e))return openNamedLinks(e);openTelegram(`https://t.me/share/url?url=${encodeURIComponent(e.inviteUrl)}&text=${encodeURIComponent(inviteText(e))}`); }
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function action(text, fn, className = 'secondary') { const b = element('button', text, className); b.type = 'button'; b.onclick = async () => { if(b.disabled)return; b.disabled=true; try { await fn(); } catch(error) { notice(error.message); } finally { b.disabled=false; } }; return b; }
async function openGuestList(id) {
  const {event:e}=await api(`events/${id}`);
  if(!isManager(e))return;
  const roster=e.guestRoster || [],accepted=roster.filter(g=>g.status==='yes');
  $('guest-list-title').textContent=e.title+' · Guest list';
  $('guest-list-summary').textContent=`Accepted: ${accepted.length} responses · ${accepted.reduce((sum,g)=>sum+g.participants,0)} people. Confirmed: ${roster.filter(g=>g.confirmed).reduce((sum,g)=>sum+g.participants,0)} people.`;
  const filters=$('guest-list-filters');filters.replaceChildren();
  const named=e.invitationMode==='named',readOnly=e.cancelled || e.group==='Past events';
  const invitationFor=guest=>guest.id!=null ? e.invitees?.find(invite=>invite.responses?.some(response=>response.id===guest.id)) : e.invitees?.find(invite=>invite.name===guest.name);
  const showInvitations=async(guest,options={})=>{$('guest-list-dialog').close();await openNamedLinks(e,guest?.token,options);};
  $('guest-list-add').hidden=!named;$('guest-list-add').disabled=readOnly;$('guest-list-add').onclick=()=>showInvitations(null,{add:true});
  $('guest-list-invitations').hidden=!named;$('guest-list-invitations').onclick=()=>showInvitations();
  const render=filter=>{
    const rows=$('guest-list-rows');rows.replaceChildren();
    const visible=roster.filter(g=>filter==='all' || (filter==='unanswered' ? ['later','unopened'].includes(g.status) : filter==='pending' ? g.status==='yes' && !g.confirmed : g.status===filter));
    for(const g of visible){
      const row=element('article','','admin-guest');row.append(element('p',`${g.name} · ${g.status==='yes' ? g.confirmed?'Confirmed':g.approval==='pending'?'Awaiting approval':'Awaiting payment' : {no:'Rejected',maybe:'Maybe',later:'Respond later',unopened:'Not opened'}[g.status] || g.status}${g.participants?' · '+g.participants+' people':''}`));
      const invite=named && invitationFor(g);
      if(invite){const controls=element('div','','event-actions guest-inline-actions');controls.append(action('✉️ Invitation',()=>showInvitations(invite)));const revoke=action('🚫 Revoke invitation',()=>showInvitations(invite,{revoke:true}),'text-button');revoke.disabled=readOnly;controls.append(revoke);row.append(controls);}rows.append(row);
    }
    if(!visible.length)rows.append(element('p','No guests in this list.','muted'));
    for(const b of filters.children)b.setAttribute('aria-pressed',String(b.dataset.filter===filter));
  };
  for(const [filter,label] of [['all','All'],['yes','Accepted'],['pending','Pending'],['maybe','Maybe'],['no','Rejected'],['unanswered','Unanswered']]){const b=action(label,()=>render(filter));b.dataset.filter=filter;filters.append(b);}
  $('guest-list-manage').onclick=()=>openTelegram(e.inviteUrl.split('?')[0]+'?start=manage_'+e.id);
  $('guest-list-close').onclick=()=>$('guest-list-dialog').close();render('all');$('guest-list-dialog').showModal();
}
async function openTicket(id) {
  const {ticket}=await api(`events/${id}/ticket`,{});
  $('ticket-title').textContent=ticket.title;
  $('ticket-name').textContent=`${ticket.name} · ${ticket.participants} ${ticket.participants===1?'person':'people'}`;
  $('ticket-image').hidden=!ticket.image;if(ticket.image)$('ticket-image').src=ticket.image;else $('ticket-image').removeAttribute('src');$('ticket-code').textContent=ticket.code;
  $('ticket-message').textContent=ticket.checkedInAt?'Already checked in.':ticket.image?'Show this QR code at the event.':'Show this ticket code at the event.';
  $('ticket-copy').onclick=async()=>{try{await navigator.clipboard.writeText(ticket.code);$('ticket-message').textContent='Ticket code copied.';}catch{$('ticket-message').textContent='Select the code to copy it.';}};
  $('ticket-close').onclick=()=>$('ticket-dialog').close();$('ticket-dialog').showModal();
}
let checkinGeneration=0;
async function openCheckin(id) {
  const {event}=await api(`events/${id}`);if(!isManager(event))return;
  const generation=++checkinGeneration;let busy=false,verifiedCode=null;
  const input=$('checkin-code'),result=$('checkin-result'),confirm=$('checkin-confirm');
  input.disabled=false;$('checkin-check').disabled=false;$('checkin-scan').disabled=false;
  $('checkin-scan').hidden=event.qrEnabled===false;
  $('checkin-event').textContent=event.title;input.value='';result.textContent='';confirm.hidden=true;
  input.oninput=()=>{verifiedCode=null;confirm.hidden=true;result.textContent='';};
  const check=async(mark=false)=>{
    if(busy)return;busy=true;
    const code=input.value.trim();confirm.hidden=true;$('checkin-check').disabled=true;$('checkin-scan').disabled=true;input.disabled=true;
    try{
      const {ticket}=await api(`events/${id}/ticket-check`,{code,checkIn:mark});
      if(generation!==checkinGeneration || !$('checkin-dialog').open)return;
      result.textContent=ticket.valid ? `${ticket.alreadyCheckedIn?'⚠ Already checked in':mark?'✓ Checked in':'✓ Valid ticket'}\n${ticket.name} · ${ticket.participants} ${ticket.participants===1?'person':'people'}${ticket.checkedInAt?'\n'+format({startsAt:ticket.checkedInAt}):''}` : '✕ '+ticket.reason;
      verifiedCode=ticket.valid && !ticket.checkedInAt ? code:null;confirm.hidden=!verifiedCode;
      result.className=ticket.valid ? '' : 'error';
    }catch(error){if(generation===checkinGeneration)result.textContent=error.message;}
    finally{busy=false;if(generation===checkinGeneration){$('checkin-check').disabled=false;$('checkin-scan').disabled=false;input.disabled=false;}}
  };
  $('checkin-check').onclick=()=>check();confirm.onclick=()=>{if(verifiedCode && input.value.trim()===verifiedCode)return check(true);};
  $('checkin-scan').onclick=()=>{
    if(!tg?.showScanQrPopup || (tg.isVersionAtLeast && !tg.isVersionAtLeast('6.4'))){result.textContent='QR scanning is unavailable here. Enter the ticket code instead.';return;}
    try{tg.showScanQrPopup({text:'Scan the guest’s ticket QR.'},text=>{input.value=text;void check();return true;});}catch{result.textContent='Could not open the scanner. Enter the ticket code instead.';}
  };
  $('checkin-close').onclick=()=>$('checkin-dialog').close();
  $('checkin-dialog').onclose=()=>{checkinGeneration++;try{tg?.closeScanQrPopup?.();}catch{}};
  $('checkin-dialog').showModal();
}
const {openGallery,showQr}=setupGallery({$,api,element,action,go,notice,openTelegram,initData});
const {cancelEvent,deleteEvent}=setupEventActions({$,api,refresh,notice,onEnded:event=>{
  state.events=state.events.filter(item=>item.id!==event.id);
  if(activeEvent?.id===event.id){activeEvent=null;formReady=false;$('event-form').hidden=true;$('success').hidden=true;}
  if(createdEvent?.id===event.id)createdEvent=null;
  go('events');
}});
function confirmAction(message, operation) {
  const dialog = $('confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  const labels={delete:['Delete event?','Delete event','Keep event'],cancel:['Cancel event?','Cancel event','Keep event'],'cohost-revoke':['Revoke co-host access?','Revoke access','Keep access'],'cohost-cancel-link':['Cancel co-host invite?','Cancel invite link','Keep link'],'cohost-rotate':['Replace co-host invite?','Create new link','Keep current link'],'whitelist-enable':['Restrict dev access?','Turn on whitelist','Keep current access'],'whitelist-first':['Restrict dev access?','Add user and restrict','Back'],'whitelist-disable':['Open dev access?','Turn off whitelist','Keep restricted'],'whitelist-last':['Remove the last user?','Remove user','Keep user'],'whitelist-repair':['Repair access setting?','Repair and turn on','Back']}[operation] || ['Confirm action','Confirm','Back'];
  $('confirm-title').textContent = labels[0];
  $('confirm-message').textContent = message;
  $('confirm-proceed').textContent = labels[1];$('confirm-back').textContent=labels[2];
  return new Promise(resolve => {
    const finish = accepted => { dialog.close(); resolve(accepted); };
    $('confirm-back').onclick = () => finish(false);
    $('confirm-proceed').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal(); $('confirm-back').focus();
  });
}
let cohostEventId=null,cohostGeneration=0,cohostBusy=false,cohostControls=[];
function setCoHostBusy(busy){
  cohostBusy=busy;
  for(const control of [$('cohost-generate'),$('cohost-label'),...cohostControls])control.disabled=busy;
}
function renderCoHost(event){
  const entries=event.cohostLinks || [];
  $('cohost-event-title').textContent=event.title;
  $('cohost-summary').textContent=entries.length ? ['active','pending','revoked'].map(status=>entries.filter(entry=>entry.status===status).length+' '+status).join(' · ') : 'No co-hosts yet. Add a one-use invitation for someone you trust.';
  const list=$('cohost-list');list.replaceChildren();cohostControls=[];
  for(const entry of entries){
    const label=entry.label || 'Untitled invitation',person=entry.cohost;
    const row=element('article','','panel cohost-entry');row.dataset.linkId=entry.id;
    const heading=element('div','','cohost-entry-heading');heading.append(element('h3',label),element('span',{pending:'Pending',active:'Active',revoked:'Revoked'}[entry.status] || entry.status,'tag'));row.append(heading);
    if(person)row.append(element('p',(person.name || 'Telegram user')+' · '+(person.username ? '@'+person.username.replace(/^@/,'') : 'No Telegram username')+' · ID '+person.id,'cohost-identity'));
    else row.append(element('p',entry.status==='revoked' ? 'This invitation is no longer usable.' : 'The first eligible Telegram account to open this link becomes a co-host.','small muted'));
    const actions=element('div','','event-actions');
    if(entry.status==='pending' && entry.url){
      row.append(element('p',entry.url,'invite-link'));
      const copy=action('Copy link',async()=>{try{await navigator.clipboard.writeText(entry.url);$('cohost-status').textContent='Co-host invite link copied.';}catch{$('cohost-status').textContent='Select and copy the link shown for '+label+'.';}});
      const share=action('Share privately',()=>openTelegram(`https://t.me/share/url?url=${encodeURIComponent(entry.url)}&text=${encodeURIComponent('Join me as co-host for '+event.title+'. This link is for you only.')}`));
      actions.append(copy,share);cohostControls.push(copy,share);
    }
    if(entry.status!=='revoked'){
      const revoke=action(entry.status==='active'?'Revoke access':'Cancel invite',()=>changeCoHost(event,'revoke',entry));revoke.setAttribute('aria-label',(entry.status==='active'?'Revoke access for ':'Cancel invite for ')+label);actions.append(revoke);cohostControls.push(revoke);
    }
    row.append(actions);list.append(row);
  }
  $('cohost-generate').onclick=()=>changeCoHost(event,'invite');
  setCoHostBusy(cohostBusy);
}
async function changeCoHost(event,operation,entry){
  if(!event.isOwner || cohostBusy)return;
  const generation=cohostGeneration,label=$('cohost-label').value.trim();
  if(operation==='invite' && label.length>80){$('cohost-status').textContent='Use a label of at most 80 characters.';return;}
  if(operation==='revoke'){
    if(!entry || entry.status==='revoked')return;
    const name=entry.label || 'Untitled invitation';
    const message=entry.status==='active' ? 'Remove '+(entry.cohost?.name || 'this co-host')+' ('+name+') from “'+event.title+'”? They will immediately lose management access. Other co-hosts and invitations stay active.' : 'Cancel the unused co-host invite “'+name+'” for “'+event.title+'”? That link will stop working. Other co-hosts and invitations stay active.';
    if(!await confirmAction(message,entry.status==='active'?'cohost-revoke':'cohost-cancel-link'))return;
  }
  if(generation!==cohostGeneration || cohostEventId!==event.id)return;
  setCoHostBusy(true);
  $('cohost-status').textContent='Saving…';
  try{
    const {event:updated}=await api(`events/${event.id}/cohost/${operation}`,{version:event.cohostVersion,...(operation==='invite'?{label}:{linkId:entry.id})});
    const index=state.events.findIndex(item=>item.id===updated.id);if(index>=0)state.events[index]=updated;
    renderEvents();renderHome();
    if(generation===cohostGeneration && cohostEventId===event.id && $('cohost-dialog').open){renderCoHost(updated);if(operation==='invite')$('cohost-label').value='';$('cohost-status').textContent=operation==='invite' ? 'One-use co-host invite created.' : entry.status==='active' ? 'Co-host access revoked.' : 'Invite link cancelled.';}
  }catch(error){
    if(generation===cohostGeneration && cohostEventId===event.id && $('cohost-dialog').open){
      try{const {event:latest}=await api(`events/${event.id}`);if(latest.isOwner && generation===cohostGeneration && cohostEventId===event.id){renderCoHost(latest);const index=state.events.findIndex(item=>item.id===latest.id);if(index>=0)state.events[index]=latest;}}catch{}
      if(generation===cohostGeneration)$('cohost-status').textContent=error.message+' Review the current co-host list before trying again.';
    }
  }
  finally{setCoHostBusy(false);}
}
async function openCoHost(id){
  const generation=++cohostGeneration,{event}=await api(`events/${id}`);if(generation!==cohostGeneration)return;
  if(!event.isOwner)throw Error('Only the event owner can manage co-hosts.');
  cohostEventId=id;renderCoHost(event);$('cohost-settings').open=false;$('cohost-label').value='';$('cohost-status').textContent='';$('cohost-dialog').showModal();
}
$('cohost-close').onclick=()=>$('cohost-dialog').close();
$('cohost-dialog').onclose=()=>{cohostGeneration++;cohostEventId=null;};
function openEventInApp(id){
  go('events');
  const card=document.getElementById('event-card-'+id);
  card?.scrollIntoView?.({block:'start',behavior:'smooth'});card?.focus?.({preventScroll:true});
}
function renderHome(){
  const now=Date.now(),events=state.events.filter(e=>!e.cancelled && (isManager(e) || ['yes','maybe'].includes(e.status)) && e.startsAt);
  for(const [id,active] of [['home-ongoing',true],['home-upcoming',false]]){
    const list=$(id);list.replaceChildren();
    const entries=events.filter(e=>active ? Date.parse(e.startsAt)<=now && (e.endsAt ? Date.parse(e.endsAt)>now : dateInZone(e.startsAt,selectedZone())===dateInZone(now,selectedZone())) : Date.parse(e.startsAt)>now).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
    if(!entries.length)list.append(element('p',active?'No ongoing events.':'No upcoming events yet.','muted'));
    for(const e of entries){const label=e.isCoHost?'Co-hosting':e.isOwner?'You’re hosting':e.status==='maybe'?'Maybe':e.approval==='pending'?'Awaiting approval':(e.starPrice || ['bank','link'].includes(e.paymentMethod)) && e.paymentStatus!=='paid'?'Awaiting payment':'You’re attending';const card=element('article','','event-card');card.append(priceTag(e),element('h3',e.title),element('p',format(e)),element('p',label,'small muted'));
      if(active && !e.endsAt)card.append(element('p','Started today · finish time not set.','small muted'));
      const actions=element('div','','event-actions home-event-actions');
      actions.append(action('📅 View event',()=>openEventInApp(e.id),'primary'),action('💬 Open in chat',()=>openTelegram(e.inviteUrl)));
      if(isManager(e)){
        actions.append(action('✏️ Edit event',()=>editEvent(e.id)),action('👥 Guest list',()=>openGuestList(e.id)));
        if(e.invitationMode==='named')actions.append(action('✉️ Invitations',()=>openNamedLinks(e)));
      }
      if(isManager(e) || e.status==='yes' && e.permissions?.viewMedia)actions.append(action('🗂 Shared media',()=>openGallery(e.id)));
      if(!isManager(e) && e.ticket)actions.append(action('🎟 My ticket',()=>openTicket(e.id)));
      card.append(actions);list.append(card);}
  }
}
let homeSequence=0;
async function loadHomeSuggestions(){
  const sequence=++homeSequence,list=$('home-suggestions');list.replaceChildren(element('p','Finding future plans…','muted'));
  try{
    const data=await api('explore?timezone='+encodeURIComponent(selectedZone()));if(sequence!==homeSequence)return;
    list.replaceChildren();const joined=new Set(state.events.map(e=>e.id));
    const suggested=data.events.filter(e=>Date.parse(e.startsAt)>Date.now() && !e.responsesClosed && !joined.has(e.id)).slice(0,3);
    for(const e of suggested){const card=element('article','','event-card');card.append(element('span','PUBLIC EVENT','tag'),priceTag(e),element('h3',e.title),element('p',format(e)),action('💬 View in Telegram',()=>openTelegram(e.inviteUrl),'primary'));list.append(card);}
    if(!suggested.length){list.append(element('p','No new public events in your timezone yet. Try planning one:','muted'));for(const title of ['A weekend walk','A sports meetup','Dinner with friends'])list.append(action(title,()=>{setupForm();$('title').value=title;}));}
  }catch(error){if(sequence===homeSequence){list.replaceChildren(element('p',error.message,'small muted'));list.append(action('Try again',loadHomeSuggestions));}}
}
$('home-refresh').onclick=async()=>{try{await refresh();await loadHomeSuggestions();}catch(error){notice(error.message);}};
function renderEvents() {
  $('zone-note').textContent = `Your local time · ${selectedZone().replaceAll('_', ' ')}`;
  const list = $('event-list'); list.replaceChildren();
  $('events-heading').textContent = listFilter === 'pending' ? 'Pending invitations' : 'Your events';
  const events = [...state.events].filter(e => !e.cancelled && (isManager(e) || e.status !== 'no') && (listFilter !== 'pending' || (!isManager(e) && e.invitationMode!=='tickets' && e.status === 'later'))).sort((a, b) => (a.startsAt || '').localeCompare(b.startsAt || ''));
  if (!events.length) { const empty = element('div', '', 'empty'); empty.append(element('strong', listFilter === 'pending' ? 'You’re all caught up.' : 'A calendar full of possibilities.'), element('span', listFilter === 'pending' ? 'No unanswered invitations.' : 'Create your first event, or open an invitation in the bot to join one.')); list.append(empty); }
  let lastGroup;
  events.sort((a,b) => ['Upcoming events','Past events','Date not set','Cancelled events'].indexOf(a.group) - ['Upcoming events','Past events','Date not set','Cancelled events'].indexOf(b.group) || (a.group === 'Past events' ? (b.startsAt || '').localeCompare(a.startsAt || '') : (a.startsAt || '').localeCompare(b.startsAt || '')));
  for (const e of events) {
    if (listFilter === 'all' && e.group !== lastGroup) { list.append(element('h2', e.group, 'event-group')); lastGroup = e.group; }
    const card = element('article', '', 'event-card');card.id='event-card-'+e.id;card.tabIndex=-1;
    if (e.hasBanner) {
      const img = document.createElement('img'); img.className = 'event-banner'; img.alt = `Banner for ${e.title}`; card.append(img);
      fetch(`/api/events/${e.id}/banner`, { headers: { Authorization: 'tma ' + initData } }).then(r => { if (!r.ok) throw new Error(); return r.blob(); }).then(blob => { if (!img.isConnected) return; const old = bannerUrls.get(e.id); if (old) URL.revokeObjectURL(old); const url = URL.createObjectURL(blob); bannerUrls.set(e.id,url); img.src=url; }).catch(() => img.remove());
    }
    const meta = element('div', '', 'event-meta'); meta.append(element('span', e.cancelled ? 'CANCELLED' : e.isCoHost ? 'CO-HOSTING' : e.isOwner ? 'YOU’RE HOSTING' : 'INVITED', e.cancelled ? 'tag cancelled' : 'tag'));
    meta.append(priceTag(e),element('span',e.invitationMode==='tickets' ? 'TICKETS' : e.invitationMode==='named' ? 'NAMED INVITATIONS' : 'RSVP','tag'));
    if (e.status) meta.append(element('span', e.invitationMode==='tickets' ? e.status==='yes' ? e.ticket ? 'Ticket confirmed' : 'Ticket requested' : 'Not booked' : { yes: 'Accepted', no: 'Not coming', maybe: 'Tentative', later: 'Respond later' }[e.status], 'tag'));
    card.append(meta, element('h3', e.title), element('p', '🗓 ' + format(e)), element('p', '📍 ' + (typeof e.location==='string' ? e.location || 'Location to follow' : e.requireApproval ? 'Shared after organiser approval' : 'Shared after acceptance'), 'muted'));
    if (e.responsesClosed) card.append(element('p', '⏰ Responses closed — deadline passed.', 'error'));
    else if (e.responseDeadline) card.append(element('p', 'Respond by: ' + format({ startsAt: e.responseDeadline }), 'small muted'));
    if (e.approval === 'pending') card.append(element('p', 'The organiser will send your invitation details and ticket after approving your response.', 'muted'));
    if(e.invitationMode==='named' && e.guestName)card.append(element('p','Personal invitation for '+e.guestName,'small muted'));
    if(priceEstimate(e))card.append(element('p',priceEstimate(e),'small muted'));
    if (e.starPrice) card.append(element('p', '⭐ ' + e.starPrice + ' Stars ' + (e.starPricing === 'person' ? 'per person' : 'per group') + (e.paymentStatus ? ' · ' + e.paymentStatus.replaceAll('_',' ') : ''), 'small muted'));
    if (e.participants) card.append(element('p', 'Your group: ' + e.participants + (e.participants === 1 ? ' person' : ' people'), 'small muted'));
    if (e.ticket) card.append(element('p', `🎟 ${e.ticket.name}${e.ticket.code ? ' · ' + e.ticket.code : ''}${e.ticket.info ? '\n' + e.ticket.info : ''}`, 'time-preview'));
    if (e.startsAt && selectedZone() !== e.timezone) card.append(element('p', 'Organiser time: ' + format({ startsAt: e.startsAt }, e.timezone), 'small muted'));
    if (e.counts) card.append(element('div', e.invitationMode==='tickets' ? `${e.counts.yes} confirmed bookings · ${e.counts.participants} people · ${e.counts.pending} approval requests · ${e.counts.awaitingPayment} awaiting payment` : `${e.counts.participants} people coming (${e.counts.yes} responses) · ${e.counts.pendingParticipants || 0} people awaiting approval · ${e.counts.awaitingPayment || 0} awaiting payment · ${e.counts.maybe} tentative · ${e.counts.no} declined · ${e.counts.later} later`, 'counts'));
    else card.append(element('div', 'Guest list is private to the organiser.', 'counts'));
    const actions = element('div', '', 'event-actions'); actions.append(action('💬 Open in chat', () => openTelegram(e.inviteUrl), 'primary'));
    if (isManager(e) && !e.cancelled) actions.append(action('✏️ Edit event', () => editEvent(e.id)));
    if(isManager(e))actions.append(action('👥 Guest list',()=>openGuestList(e.id)));
    if(isManager(e) && !e.cancelled)actions.append(action(e.qrEnabled!==false?'📷 Scan tickets':'🎟 Check tickets',()=>openCheckin(e.id)));
    if(e.ticket && e.qrEnabled!==false)actions.append(action('🔳 Ticket QR',()=>openTicket(e.id)));
    if((e.starPrice || ['bank','link'].includes(e.paymentMethod)) && !isManager(e) && e.status==='yes' && e.approval==='approved' && e.paymentStatus!=='paid')actions.append(action(e.starPrice?'⭐ Pay with Stars':'💳 Payment instructions',()=>openTelegram(e.inviteUrl.split('?')[0]+'?start=pay_'+e.id)));
    if(e.invitationMode==='named' && isManager(e))actions.append(action('✉️ Guest invitations',()=>openNamedLinks(e)));else actions.append(action('📋 Copy link', async () => { try { await navigator.clipboard.writeText(e.inviteUrl); notice('✓ Event link copied.'); } catch { notice('Could not copy the link. Use Share invite under the three-dot menu.'); } }));
    const more = document.createElement('details'); more.className = 'event-more';
    const moreToggle = element('summary','⋯'); moreToggle.setAttribute('aria-label',`More options for ${e.title}`);
    const extraActions = element('div','','event-more-panel'); more.append(moreToggle,extraActions);
    if(isManager(e) && !e.cancelled)extraActions.append(action('✏️ Edit event',()=>editEvent(e.id)));
    extraActions.append(action('📤 Share invite', () => share(e)));
    if(e.isOwner && !e.cancelled)extraActions.append(action('🤝 Co-hosts',()=>openCoHost(e.id)));
    if(e.starPrice || ['bank','link'].includes(e.paymentMethod))extraActions.append(action(e.isOwner?'💳 Payments & refunds':'💬 Payment support',()=>openTelegram(e.inviteUrl.split('?')[0]+'?start=payments')));
    if (isManager(e) || (e.status==='yes' && e.permissions.viewMedia)) {
      actions.append(action('🗂 Shared media', () => openGallery(e.id)));
    }
    if (isManager(e) && e.uploadLink) extraActions.append(e.qrEnabled!==false ? action('📎 Upload link & QR', () => showQr(e.id)) : action('📤 Share upload link',()=>openTelegram(`https://t.me/share/url?url=${encodeURIComponent(e.uploadLink)}`)));
    if(e.isOwner && !e.cancelled)extraActions.append(action('🛑 Cancel event',()=>cancelEvent(e),'danger-button'));
    if (e.location) extraActions.append(action('📍 Copy address', async () => { try { await navigator.clipboard.writeText(e.location); notice('✓ Address copied.'); } catch { notice('Select and copy the address shown on the event.'); } }));
    if (e.upcoming && (isManager(e) || e.status==='yes')) {
      const label = element('label', '🔔 Event reminder'); const select = document.createElement('select'); select.setAttribute('aria-label', `Reminder for ${e.title}`);
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
async function editEvent(id){
  try{const result=await api(`events/${id}`);setupForm(result.event);}catch(error){notice(error.message);}
}
function selectedInvitationMode(){
  const type=$('invitation-mode').value;
  return type==='public' ? activeEvent?.invitationMode==='legacy' ? 'legacy' : 'tickets' : type;
}
function updateInvitationMode(resetOneTime=false){
  const mode=selectedInvitationMode(),named=mode==='named',isPublic=$('invitation-mode').value==='public';
  $('guest-names-panel').hidden=!named;$('guest-names').required=named && !compactPicker && (!activeEvent || activeEvent.invitees?.length>0);
  if(resetOneTime && !activeEvent)$('one-time-invite').checked=named;
  for(const id of ['require-approval-option','ask-participant-count-option'])$(id).hidden=named;
  if(named){
    if($('require-approval').checked)$('hide-location').checked=true;
    $('require-approval').checked=false;$('ask-participant-count').checked=false;
  }
  for(const id of ['require-approval','ask-participant-count'])$(id).disabled=named;
  $('hide-location').disabled=!named && $('require-approval').checked;
  $('hide-location-note').textContent=named ? 'The location appears only after a guest accepts.' : 'When approval is required, only approved guests see the location.';
  $('one-time-invite-note').textContent=$('one-time-invite').checked ? named || mode==='legacy' ? 'After Accept, Decline or Maybe, only that guest can reuse the link. Respond later does not lock it. The same guest can still change their RSVP.' : 'After a ticket request, only that guest can reuse the event link.' : named ? 'More than one guest can use each link. Each guest can change their own RSVP.' : 'Anyone with the event link can request a ticket.';
  $('invitation-mode-note').textContent=named ? 'Private guest list. Each guest gets personal Accept, Decline, Tentative and Later choices without entering their name.' : mode==='legacy' ? (isPublic ? 'Listed in Explore for people using the event’s timezone. ' : 'Private link. ')+'This existing event keeps its original RSVP links and responses.' : isPublic ? 'Listed in Explore for people using the event’s timezone. Guests enter their name to book a ticket or request organiser approval.' : 'Private link. Guests enter their name to book a ticket or request organiser approval. No RSVP choices.';
}
$('invitation-mode').onchange=()=>updateInvitationMode(true);
$('one-time-invite').onchange=()=>updateInvitationMode();
let invitationLinksGeneration=0;
$('invitation-links-close').onclick=()=>$('invitation-links-dialog').close();
$('invitation-links-dialog').onclose=()=>{invitationLinksGeneration++;};
async function openNamedLinks(event,selectedGuest,options={}){
  const generation=++invitationLinksGeneration;
  try{
    let {event:e}=await api(`events/${event.id}`);
    if(generation!==invitationLinksGeneration)return;
    if(!isManager(e)){$('invitation-links-list').replaceChildren();if($('invitation-links-dialog').open)$('invitation-links-dialog').close();throw Error('Only event managers can see invitation links.');}
    const search=$('invitation-links-search'),filter=$('invitation-links-filter'),status=$('invitation-links-status');
    search.value='';search.hidden=false;filter.value='all';status.textContent='';
    $('invitation-add').open=options.add===true;$('invitation-add-names').value='';$('invitation-single').open=options.add===true;$('invitation-bulk').open=false;
    let busy=false,mutationButtons=[],mutationInputs=[],addRequest,singleRequest,focusSelected=true,singleEditor,panelState=null;
    const mutationRequests=new Map();
    const current=()=>generation===invitationLinksGeneration;
    const readOnly=()=>e.cancelled || e.group==='Past events';
    const responses=guest=>Array.isArray(guest.responses) ? guest.responses : ['yes','no','maybe','later'].includes(guest.status) ? [{name:guest.name,status:guest.status,participants:guest.participants || 1}] : [];
    const matches=(guest,value)=>value==='all' || (value==='revoked' ? guest.revoked===true : !guest.revoked && (value==='unanswered' ? !responses(guest).length || responses(guest).some(g=>g.status==='later') : responses(guest).some(g=>g.status===value && (value!=='later' || g.responded!==false))));
    const setBusy=value=>{busy=value;$('invitation-add-submit').disabled=value || readOnly();$('invitation-add-names').disabled=value || readOnly();singleEditor?.setDisabled(value || readOnly());for(const b of [...mutationButtons,...mutationInputs])b.disabled=value || readOnly() || b.dataset.unavailable==='true';};
    const updateEvent=value=>{e=value;const index=state.events.findIndex(item=>item.id===e.id);if(index>=0)state.events[index]=e;renderEvents();renderHome();};
    const refreshList=async()=>{const result=await api(`events/${e.id}`);if(!current())return;if(!isManager(result.event)){$('invitation-links-list').replaceChildren();$('invitation-links-dialog').close();notice('Your event management access has changed.');return;}updateEvent(result.event);render();};
    const mutationRequest=(operation,payload)=>{const key=operation+':'+payload.token,value=JSON.stringify(payload),previous=mutationRequests.get(key);if(previous?.value===value)return {...payload,requestId:previous.id};const id=crypto.randomUUID();mutationRequests.set(key,{value,id});return {...payload,requestId:id};};
    const mutate=async(operation,payload,guestName='Guest',source='bulk')=>{
      if(busy || !current())return;
      setBusy(true);status.textContent='Saving…';
      try{
        const result=await api(`events/${e.id}/invitations/${operation}`,{...payload,version:e.invitationsVersion});
        if(!current())return;
        updateEvent(result.event);panelState=null;
        if(operation==='add'){if(source==='bulk'){$('invitation-add-names').value='';$('invitation-add').open=false;addRequest=null;}else singleRequest=null;}
        render();
        const done={edit:'Invitation updated.',response:'Response updated.',revoke:'Invitation revoked. Its link and ticket are disabled.',delete:'Invitation deleted.'};
        status.textContent=operation==='add' ? 'Guests added. Their links are ready to share.' : (done[operation] || 'Invitation updated.')+(payload.notify ? result.notifyCount ? ' Guest notified.' : ' No Telegram notification was sent.' : ['response','revoke'].includes(operation) ? ' Guest not notified.' : '');
        return true;
      }catch(error){
        if(!current())return;
        const message=error.message;
        try{await refreshList();if(current())status.textContent=message+' List refreshed; review and try again.';}
        catch{if(current())status.textContent=message;}
        return false;
      }finally{if(current())setBusy(false);}
    };
    const render=()=>{
      if(!current())return;
      $('invitation-links-note').textContent=oneTimeInviteEnabled(e) ? 'Send each link only to its named guest. Accept, Decline or Maybe locks it to that guest; Respond later does not. The same guest can change their RSVP.' : 'These links can be used by more than one guest. Each response is shown below.';
      const list=$('invitation-links-list');list.replaceChildren();mutationButtons=[];mutationInputs=[];
      const guests=[...(e.invitees || []),...(e.revokedInvitees || []).map(guest=>({...guest,revoked:true}))],selected=selectedGuest && guests.find(guest=>guest.token===selectedGuest || (()=>{try{return new URL(guest.url).searchParams.get('start')==='i_'+e.id+'_'+selectedGuest;}catch{return false;}})());
      if(selected){guests.splice(guests.indexOf(selected),1);guests.unshift(selected);}
      else if(selectedGuest)status.textContent='That invitation is unavailable. Choose a guest below.';
      const activeGuests=guests.filter(guest=>!guest.revoked),replies=activeGuests.flatMap(responses),finalReplies=replies.filter(g=>['yes','no','maybe'].includes(g.status)),revokedCount=guests.length-activeGuests.length;
      $('invitation-links-summary').textContent=`${activeGuests.length} invitations · ${finalReplies.length} responses · ${replies.filter(g=>g.status==='yes').reduce((sum,g)=>sum+(g.participants || 1),0)} people accepted${revokedCount?' · '+revokedCount+' revoked':''}`;
      const selection=filter.value || 'all';filter.replaceChildren();
      for(const [value,label] of [['all','All'],['yes','Accepted'],['no','Declined'],['maybe','Maybe'],['later','Later'],['unanswered','Unanswered'],['revoked','Revoked']]){const option=document.createElement('option');option.value=value;option.textContent=label+' ('+guests.filter(guest=>matches(guest,value)).length+')';filter.append(option);}filter.value=selection;
      const rows=[];let selectedButton,panelFocus;
      for(const guest of guests){
      const count=guest.participants || 1,askCount=guest.participantMode==='ask' || (!guest.participants && e.askParticipantCount),countLabel=askCount ? 'Guest chooses attendee count' : count+' '+(count===1?'attendee':'attendees'),countRule=!askCount && guest.participants ? guest.participantMode==='confirm' ? ' · Confirm count on acceptance' : guest.participantMode==='fixed' ? ' · Fixed count' : ' · Guest can change count' : '';
      const replyList=responses(guest),responseStates=[...new Set(replyList.map(reply=>reply.responded===false?'unanswered':reply.status))],responseLabel=guest.revoked ? 'Revoked' : responseStates.length>1 ? 'Mixed responses' : {yes:'Accepted',no:'Declined',maybe:'Maybe',later:'Respond later',unanswered:'Awaiting response'}[responseStates[0]] || 'Not opened';
      const linkLabel=guest.revoked ? 'Link disabled' : oneTimeInviteEnabled(e) ? guest.claimed ? 'Locked to one guest' : 'One-time link' : 'Reusable link';
      const text=inviteText(e,guest)+'\n\n'+guest.url,row=element('article','','panel invitation-entry'+(guest===selected?' invitation-selected':'')+(guest.revoked?' invitation-revoked':''));row.dataset.token=guest.token || '';
      const preview=element('details','','invitation-preview'),fullText=document.createElement('textarea'),linkText=document.createElement('input');fullText.value=text;fullText.readOnly=true;fullText.rows=9;fullText.setAttribute('aria-label','Full invitation for '+guest.name);linkText.value=guest.url;linkText.readOnly=true;linkText.setAttribute('aria-label','Personal link for '+guest.name);preview.append(element('summary','Preview invitation'),fullText,linkText);
      const copyInvite=async()=>{try{await navigator.clipboard.writeText(text);if(generation===invitationLinksGeneration)$('invitation-links-status').textContent='Invitation copied for '+guest.name+'.';}catch{if(generation!==invitationLinksGeneration)return;preview.open=true;fullText.focus();fullText.select();$('invitation-links-status').textContent='Could not copy. Select and copy the full invitation shown for '+guest.name+'.';}};
      const copyLink=async()=>{try{await navigator.clipboard.writeText(guest.url);if(generation===invitationLinksGeneration)$('invitation-links-status').textContent='Link copied for '+guest.name+'.';}catch{if(generation!==invitationLinksGeneration)return;preview.open=true;linkText.focus();linkText.select();$('invitation-links-status').textContent='Could not copy. Select and copy the personal link shown for '+guest.name+'.';}};
      const copy=action(guest.name,copyInvite,'primary invitation-copy');copy.setAttribute('aria-label',guest.revoked ? guest.name+' · invitation revoked' : 'Copy invitation for '+guest.name);copy.disabled=guest.revoked===true;
      const actions=element('div','','event-actions invitation-actions');const copyInviteButton=action('Copy invite',copyInvite),copyLinkButton=action('Copy link',copyLink);copyInviteButton.disabled=copyLinkButton.disabled=guest.revoked===true;if(!guest.revoked)actions.append(copyInviteButton,copyLinkButton);
      const invitationState=element('p','','small muted');invitationState.append(element(askCount?'span':'strong',countLabel),element('span',countRule+' · '+linkLabel));
      const currentStatus=element('div','','invitation-current-status'),statusBadge=element('strong',responseLabel+(replyList.length>1?' · '+replyList.length+' guests':''),'invitation-status');statusBadge.dataset.status=guest.revoked?'revoked':responseStates.length>1?'mixed':responseStates[0] || 'unopened';statusBadge.setAttribute('aria-label','Current response: '+statusBadge.textContent);currentStatus.append(element('span','Current response','small muted'),statusBadge);
      const responseDates=[...(guest.history || []).filter(entry=>['responded','changed'].includes(entry.type)).map(entry=>entry.at),...replyList.map(reply=>reply.respondedAt)].filter(value=>typeof value==='string' && Number.isFinite(new Date(value).getTime())).sort((a,b)=>new Date(a)-new Date(b));
      if(responseDates.length){const instant=new Date(responseDates.at(-1)),time=element('time','Last response: '+new Intl.DateTimeFormat(undefined,{timeZone:selectedZone(),dateStyle:'medium',timeStyle:'short'}).format(instant),'small muted invitation-last-response');time.setAttribute('datetime',instant.toISOString());currentStatus.append(time);}row.append(copy,currentStatus,invitationState);
      if(replyList.length){
        const replyDetails=element('details','','invitation-responses');replyDetails.open=replyList.length===1;
        replyDetails.append(element('summary',replyList.length>1 ? 'View '+replyList.length+' responses' : 'Response details'));
        for(const g of replyList){const label=g.responded===false?'Awaiting response':{yes:'Accepted',no:'Declined',maybe:'Maybe',later:'Respond later'}[g.status] || g.status,line=element('p',`${g.name || guest.name}: ${label}${g.status==='yes'?' · '+(g.participants || 1)+' '+((g.participants || 1)===1?'person':'people'):''}${g.status==='yes' && g.paymentStatus && g.paymentStatus!=='paid'?' · Awaiting payment':''}${g.comment?'\n'+g.comment:''}`,'small invitation-response');if(typeof g.respondedAt==='string' && Number.isFinite(new Date(g.respondedAt).getTime())){const instant=new Date(g.respondedAt),time=element('time','Last response: '+new Intl.DateTimeFormat(undefined,{timeZone:selectedZone(),dateStyle:'medium',timeStyle:'short'}).format(instant),'small muted');time.setAttribute('datetime',instant.toISOString());line.append(time);}replyDetails.append(line);}
        row.append(replyDetails);
      }
      const more=element('details','','event-more invitation-more'),toggle=element('summary','⋯');toggle.setAttribute('aria-label','More options for '+guest.name);const menu=element('div','','event-more-panel');more.append(toggle,menu);
      const panel=element('section','','invitation-management');panel.hidden=true;panel.setAttribute('aria-label','Manage invitation for '+guest.name);
      const showPanel=kind=>{if(busy)return;panelState={token:guest.token,kind,focus:true};render();};
      const menuAction=(label,kind,unavailable=false,danger=false)=>{const button=action(label,()=>showPanel(kind),danger?'secondary invitation-danger':'secondary');button.dataset.unavailable=String(unavailable);mutationButtons.push(button);menu.append(button);return button;};
      const editableReplies=replyList.filter(reply=>Number.isSafeInteger(reply.id) && reply.id>0);
      if(!guest.revoked){menu.append(action('📤 Share invite',()=>{more.open=false;openTelegram(`https://t.me/share/url?url=${encodeURIComponent(guest.url)}&text=${encodeURIComponent(inviteText(e,guest))}`);}));menuAction('✏️ Edit invite','edit');menuAction('↻ Change response','response',!editableReplies.length);if(!editableReplies.length)menu.append(element('p','The guest must open their invitation first.','small muted invitation-menu-note'));menuAction('🚫 Revoke invite','revoke',false,true);}
      else menuAction('🗑 Delete invite','delete',false,true);
      menu.append(action('🕘 See history',()=>showPanel('history')));
      if(guest===selected && options.revoke && focusSelected && !guest.revoked)panelState={token:guest.token,kind:'revoke',focus:true};
      if(panelState && panelState.token===guest.token && (guest.revoked && !['history','delete'].includes(panelState.kind) || panelState.kind==='response' && !editableReplies.length))panelState=null;
      if(panelState && panelState.token===guest.token){
        const kind=panelState.kind,draft=panelState.draft ||= {};panel.hidden=false;panel.dataset.kind=kind;
        const close=action('Back',()=>{panelState=null;render();});
        const title={edit:'Edit invite',response:'Change response',revoke:'Revoke invitation?',delete:'Delete invitation?',history:'Invitation history'}[kind] || 'Invitation',heading=element('h3',title);heading.tabIndex=-1;panel.append(heading);
        const field=(label,type,key,value)=>{const input=document.createElement(type==='select'?'select':'input');if(type!=='select')input.type=type;input.dataset.field=key;input.value=draft[key] ?? value;const wrapper=element('label',label);wrapper.append(input);panel.append(wrapper);mutationInputs.push(input);return {input,wrapper};};
        const selectValues=(input,values,initial)=>{for(const [value,label] of values){const option=element('option',label);option.value=String(value);input.append(option);}input.value=String(initial);};
        const checkbox=(label,key,description='',unavailable=false)=>{const input=document.createElement('input');input.type='checkbox';input.dataset.field=key;input.checked=draft[key]===true;input.dataset.unavailable=String(unavailable);const wrapper=element('label','','check-option'),caption=element('span',label);if(description)caption.append(element('span',description,'check-note'));wrapper.append(input,caption);panel.append(wrapper);mutationInputs.push(input);input.onchange=()=>{draft[key]=input.checked;};return input;};
        const footer=element('div','','event-actions invitation-panel-actions');
        if(kind==='edit'){
          const {input:name}=field('Guest name','text','name',guest.name);name.maxLength=100;name.autocomplete='off';name.oninput=()=>{draft.name=name.value;};
          const modeValue=guest.participantMode==='ask'?'ask':['confirm','fixed'].includes(guest.participantMode)?guest.participantMode:guest.participants?'editable':'one';
          const {input:mode}=field('Attendee setting','select','mode',modeValue);selectValues(mode,[['one','One person'],['editable','Set a count · guest can change'],['ask','Ask guest how many'],['confirm','Ask guest to confirm count'],['fixed','Fixed count · no changes']],draft.mode ?? modeValue);
          const {input:count,wrapper:countField}=field('Number of people','select','count',guest.participants || 1);selectValues(count,Array.from({length:10},(_,i)=>[i+1,String(i+1)]),draft.count ?? guest.participants ?? 1);
          const update=()=>{draft.mode=mode.value;draft.count=count.value;countField.hidden=!['editable','confirm','fixed'].includes(mode.value);};mode.onchange=count.onchange=update;update();
          if(guest.hasPayments)panel.append(element('p','Paid tickets may prevent attendee changes. Manage refunds in Payments.','small muted'));
          const save=action('Save invite',async()=>{const value=name.value.trim();if(!value || value.length>100 || /[=\r\n]/.test(value)){status.textContent='Enter a name of up to 100 characters, without = or line breaks.';name.focus();return;}if((e.invitees || []).some(invite=>invite.token!==guest.token && invite.name.toLocaleLowerCase()===value.toLocaleLowerCase())){status.textContent='That name is already in the list.';name.focus();return;}const participantMode={one:'default',editable:'preset',ask:'ask',confirm:'confirm',fixed:'fixed'}[mode.value],participants=['one','ask'].includes(mode.value)?null:Number(count.value);if(!participantMode || participants!==null && (!Number.isInteger(participants) || participants<1 || participants>10)){status.textContent='Choose a count from 1 to 10.';return;}draft.name=name.value;await mutate('edit',mutationRequest('edit',{token:guest.token,name:value,participants,participantMode}),guest.name);},'primary');mutationButtons.push(save);footer.append(save,close);panelFocus=name;
        }else if(kind==='response'){
          const initial=editableReplies.length===1?editableReplies[0].id:'';
          const {input:person}=field('Guest response','select','userId',initial);selectValues(person,[['','Choose a guest'],...editableReplies.map(reply=>[reply.id,reply.name || guest.name])],draft.userId ?? initial);
          const responseValue=draft.status || editableReplies.find(reply=>String(reply.id)===person.value)?.status || 'yes';
          const {input:answer}=field('Response','select','status',responseValue);selectValues(answer,[['yes','Accepted'],['no','Declined'],['maybe','Maybe'],['later','Respond later']],responseValue);
          const selectedReply=editableReplies.find(reply=>String(reply.id)===person.value),responseCount=draft.count || selectedReply?.selectedParticipants || selectedReply?.participants || guest.participants || 1;
          const {input:count,wrapper:countField}=field('Number of people','select','count',responseCount);selectValues(count,Array.from({length:10},(_,i)=>[i+1,String(i+1)]),responseCount);count.dataset.unavailable=String(guest.participantMode==='fixed' || !guest.participants && !guest.participantMode);
          const update=()=>{draft.userId=person.value;draft.status=answer.value;draft.count=count.value;countField.hidden=answer.value!=='yes';};
          person.onchange=()=>{const reply=editableReplies.find(item=>String(item.id)===person.value);answer.value=reply?.status || 'yes';count.value=String(reply?.selectedParticipants || reply?.participants || guest.participants || 1);update();};answer.onchange=count.onchange=update;update();
          if(guest.participantMode==='fixed')panel.append(element('p','The invitation’s attendee count is fixed.','small muted'));else if(!guest.participants && !guest.participantMode)panel.append(element('p','This invitation is for one person. Edit its attendee setting to change that.','small muted'));
          if(guest.hasPayments)panel.append(element('p','Payment or check-in records may prevent this response change. Manage refunds in Payments.','small muted'));
          const notify=checkbox('Notify guest','notify','Send the updated response to their Telegram chat.',guest.canNotify===false);
          const save=action('Save response',async()=>{const reply=editableReplies.find(item=>String(item.id)===person.value),participants=Number(count.value);if(!reply){status.textContent='Choose the guest whose response you want to change.';person.focus();return;}if(answer.value==='yes' && (!Number.isInteger(participants) || participants<1 || participants>10)){status.textContent='Choose a count from 1 to 10.';return;}await mutate('response',mutationRequest('response',{token:guest.token,userId:reply.id,status:answer.value,...(answer.value==='yes'?{participants}:{}),notify:notify.checked && guest.canNotify!==false}),guest.name);},'primary');mutationButtons.push(save);footer.append(save,close);panelFocus=person;
        }else if(kind==='revoke'){
          panel.append(element('p',`Revoke ${guest.name}’s invitation? Its link and ticket will stop working.${replyList.length>1?' This affects every response using this link.':''} You can still see its history in Revoked invitations.`,'small'));
          const notify=checkbox('Notify guest','notify',guest.canNotify===false?'No Telegram account is available to notify yet.':'Send a revocation message in Telegram.',guest.canNotify===false),remove=checkbox('Delete after revoking','deleteAfter','Remove it from the invitation list. Audit records are retained. You’ll confirm next.');
          if(guest.hasPayments)panel.append(element('p','Payment records remain. Handle refunds separately in Payments.','small muted'));
          const revoke=action('Revoke invite',async()=>{const deleteAfter=remove.checked,done=await mutate('revoke',mutationRequest('revoke',{token:guest.token,notify:notify.checked && guest.canNotify!==false,confirm:true}),guest.name);if(done && deleteAfter && current()){panelState={token:guest.token,kind:'delete',focus:true};filter.value='revoked';render();status.textContent='Invitation revoked. Confirm deletion below.';}},'danger-button');mutationButtons.push(revoke);footer.append(revoke,close);panelFocus=close;
        }else if(kind==='delete'){
          panel.append(element('p',`Delete ${guest.name}’s revoked invitation from this list? This cannot be undone here. Its link stays disabled; audit records are retained.`,'small'));
          const remove=action('Delete permanently',()=>mutate('delete',mutationRequest('delete',{token:guest.token,confirm:true}),guest.name),'danger-button');mutationButtons.push(remove);footer.append(remove,close);panelFocus=close;
        }else if(kind==='history'){
          const history=Array.isArray(guest.history)?guest.history:[],labels={created:'Invite created',opened:'Invitation opened',responded:'Response received',changed:'Response changed',edited:'Invite edited',revoked:'Invitation revoked',deleted:'Invitation deleted'},statuses={yes:'Accepted',no:'Declined',maybe:'Maybe',later:'Respond later'},modes={default:'One person',preset:'Guest can change count',ask:'Guest chooses count',confirm:'Guest confirms count',fixed:'Fixed count'};
          panel.append(element('p','Times shown in '+selectedZone()+'.','small muted'));
          if(!history.some(entry=>entry.type==='created'))panel.append(element('p',history.length?'Earlier activity may not be recorded. History tracking starts with this update.':'No recorded history yet. Earlier activity isn’t available.','small muted'));
          const timeline=element('ol','','invitation-history');
          for(const entry of history){const item=element('li'),title=labels[entry.type] || 'Invitation updated',details=[];if(entry.name)details.push(entry.previousName && entry.previousName!==entry.name?entry.previousName+' → '+entry.name:entry.name);if(entry.status)details.push(entry.previousStatus && entry.previousStatus!==entry.status?(statuses[entry.previousStatus] || entry.previousStatus)+' → '+(statuses[entry.status] || entry.status):statuses[entry.status] || entry.status);if(entry.participants)details.push((entry.previousParticipants && entry.previousParticipants!==entry.participants?entry.previousParticipants+' → ':'')+entry.participants+' '+(entry.participants===1?'person':'people'));if(entry.participantMode)details.push(entry.previousParticipantMode && entry.previousParticipantMode!==entry.participantMode?(modes[entry.previousParticipantMode] || 'Previous attendee setting')+' → '+(modes[entry.participantMode] || 'Attendee setting updated'):modes[entry.participantMode] || 'Attendee setting updated');if(entry.actorRole==='organiser')details.push('By organiser');if(entry.notify===true)details.push('Notification requested');else if(entry.notify===false)details.push('Guest not notified');item.append(element('strong',title));if(details.length)item.append(element('p',details.join(' · '),'small'));const instant=new Date(typeof entry.at==='string'?entry.at:NaN),time=element('time',Number.isFinite(instant.getTime())?new Intl.DateTimeFormat(undefined,{timeZone:selectedZone(),dateStyle:'medium',timeStyle:'short'}).format(instant):'Date unavailable','small muted');if(Number.isFinite(instant.getTime()))time.setAttribute('datetime',instant.toISOString());item.append(time);timeline.append(item);}panel.append(timeline);footer.append(close);panelFocus=heading;
        }
        panel.append(footer);if(!panelState.focus)panelFocus=null;panelState.focus=false;
      }
      row.append(more,actions,...(guest.revoked?[]:[preview]),panel);list.append(row);rows.push({row,guest,name:[guest.name,...replyList.map(g=>g.name || '')].join(' ').toLocaleLowerCase()});if(guest===selected)selectedButton=copy;
      }
      const applyFilter=()=>{const term=search.value.trim().toLocaleLowerCase();for(const item of rows)item.row.hidden=!item.name.includes(term) || !matches(item.guest,filter.value);$('invitation-links-empty').hidden=rows.some(item=>!item.row.hidden);};
      search.oninput=applyFilter;filter.onchange=applyFilter;applyFilter();setBusy(busy);
      if(panelFocus){panelFocus.focus();panelFocus.scrollIntoView?.({block:'nearest'});}else if(focusSelected && selectedButton && !rows.find(item=>item.guest===selected)?.row.hidden){selectedButton.focus();selectedButton.scrollIntoView?.({block:'nearest'});}focusSelected=false;
    };
    singleEditor=setupGuestEditor('invitation-single',async guest=>{
      validateGuestAddition(guest.name,(e.invitees || []).map(invite=>invite.name));
      if(!singleRequest || singleRequest.guestNames!==guest.line)singleRequest={guestNames:guest.line,requestId:crypto.randomUUID()};
      const added=await mutate('add',singleRequest,guest.name,'single');if(added===false)throw Error(status.textContent);return added;
    },current);
    $('invitation-add-form').onsubmit=async ev=>{ev.preventDefault();const guestNames=$('invitation-add-names').value.trim();if(!guestNames){status.textContent='Enter at least one guest name.';return;}if(!addRequest || addRequest.guestNames!==guestNames)addRequest={guestNames,requestId:crypto.randomUUID()};await mutate('add',addRequest);};
    $('invitation-links-refresh').onclick=async()=>{if(busy)return;try{await refreshList();if(current())status.textContent='Responses refreshed.';}catch(error){if(current())status.textContent=error.message;}};
    render();if(!$('invitation-links-dialog').open)$('invitation-links-dialog').showModal();if(options.add)$('invitation-single-name').focus();
  }catch(error){notice(error.message);}
}
async function loadBannerPreview(id,generation){
  try{
    const response=await fetch(`/api/events/${id}/banner`,{headers:{Authorization:'tma '+initData}});
    if(!response.ok)throw Error('Could not load the saved event banner. Your existing banner is still saved.');
    const blob=await response.blob();if(generation!==bannerLoadGeneration)return;
    bannerPreviewUrl=URL.createObjectURL(blob);$('banner-preview').src=bannerPreviewUrl;$('banner-preview').hidden=false;
  }catch(error){if(generation===bannerLoadGeneration)window.reportAppError?.(error,'Banner preview');}
}
function setupForm(event = null) {
  formReady=true;
  activeEvent = event; createdEvent = null; requestId = crypto.randomUUID();
  $('event-form').reset(); $('event-form').hidden = false; $('success').hidden = true; $('form-error').hidden = true;
  for(const id of ['extra-details','timing-options','stars-panel','guest-permissions','media-options'])$(id).open=false;
  $('extra-details').hidden=compactPicker;$('timing-options').hidden=deadlinePicker;$('media-options').hidden=compactPicker;
  $('stars-panel').hidden = compactPicker;
  $('stars-enabled').checked = !!(event ? event.starPrice || ['bank','link'].includes(event.paymentMethod) : state.user?.isSuperAdmin && state.pricing?.defaultStarPrice);
  $('payment-method').value=event?.paymentMethod && event.paymentMethod!=='free'?event.paymentMethod:event?.starPrice || state.user?.isSuperAdmin && state.pricing?.defaultStarPrice?'stars':'bank';
  $('display-price').value=event?.displayPrice || '';$('payment-instructions').value=event?.paymentInstructions || '';$('payment-url').value=event?.paymentUrl || ''; $('stars-fields').hidden = !$('stars-enabled').checked;
  $('stars-price').value = event?.starPrice || state.pricing?.defaultStarPrice || 100; $('stars-pricing').value = event?.starPricing || state.pricing?.defaultStarPricing || 'person';
  $('payment-terms').value = event?.paymentTerms || '';
  updatePricePreview();
  $('ending-panel').hidden = deadlinePicker;
  $('end-mode').value = event?.endMode || 'none';
  $('duration-hours').value = event?.durationMinutes ? Math.floor(event.durationMinutes / 60) : 2;
  $('duration-minutes').value = event?.durationMinutes ? event.durationMinutes % 60 : 0;
  $('finish-date').value = event?.endDate || event?.localDate || dateInZone(Date.now(), selectedZone()); $('finish-time').value = event?.endTime || '20:00';
  updateEnding();
  const scheduleOnly = compactPicker;
  $('title').value=event?.title || '';$('location').value=event?.location || '';$('description').value=event?.description || '';$('invite-message').value=event?.inviteMessage || '';
  $('invitation-mode-panel').hidden=compactPicker;$('legacy-invitation-mode').hidden=event?.invitationMode!=='legacy';$('invitation-mode').value=event?.invitationMode!=='named' && event?.isPublic ? 'public' : event?.invitationMode || 'tickets';$('guest-names').value=(event?.invitees || []).map(invitationGuestLine).join('\n');
  const lockedMode=event && !event.isOwner ? event.invitationMode : null;
  for(const [id,mode] of [['tickets-invitation-mode','tickets'],['named-invitation-mode','named'],['public-invitation-mode',event?.invitationMode==='legacy'?'legacy':'tickets'],['legacy-invitation-mode','legacy']])$(id).disabled=!!lockedMode && lockedMode!==mode;
  $('guest-single').open=false;
  setupGuestEditor('guest-single',guest=>{
    const list=$('guest-names'),names=guestNamesIn(list.value);validateGuestAddition(guest.name,names);
    const next=list.value+(list.value && !list.value.endsWith('\n')?'\n':'')+guest.line;
    if(next.length>10000)throw Error('The guest list can be at most 10,000 characters.');
    list.value=next;return true;
  });
  $('one-time-invite').checked=event ? oneTimeInviteEnabled(event) : $('invitation-mode').value==='named';
  $('event-details').hidden = scheduleOnly; $('optional-details').hidden = scheduleOnly;
  $('banner-panel').hidden = compactPicker; $('banner-preview').hidden = true;
  const bannerGeneration=++bannerLoadGeneration;if(bannerPreviewUrl){URL.revokeObjectURL(bannerPreviewUrl);bannerPreviewUrl=null;}
  if(event?.hasBanner && !compactPicker)loadBannerPreview(event.id,bannerGeneration);
  $('guest-permissions').hidden = compactPicker;
  $('default-reminder-panel').hidden = compactPicker; $('default-reminder').value = event?.defaultReminder || 0;
  $('response-deadline').hidden = compactPicker;
  $('clear-draft-deadline').hidden = !deadlinePicker;
  $('ask-participant-count').checked = event?.askParticipantCount === true;
  $('ask-phone').checked=event?.askPhone===true;$('ask-comments').checked=event?.askComments===true;
  $('qr-enabled').checked=event ? event.qrEnabled!==false : false;
  $('require-approval').checked = event?.requireApproval === true;
  $('hide-location').checked = event?.hideLocation === true || event?.requireApproval === true;
  $('hide-location').disabled = $('require-approval').checked;
  updateInvitationMode();
  $('ticket-info').value = event?.ticketInfo || '';
  $('deadline-enabled').checked = !!event?.responseDeadline;
  $('deadline-date').value = event?.deadlineDate || '';
  $('deadline-time').value = event?.deadlineTime || '';
  updateDeadline();
  $('allow-guest-list').checked = event?.permissions?.guestList === true;
  $('allow-link-uploads').checked = event?.allowLinkUploads === true;
  $('allow-upload-media').checked = event?.permissions?.uploadMedia === true;
  $('allow-view-media').checked = event?.permissions?.viewMedia === true;
  $('title').required = !scheduleOnly; $('location').required = false;
  $('form-title').textContent = deadlinePicker ? 'When do replies close?' : picker ? 'Pick your moment.' : event ? 'A change of plans.' : 'Make a plan.';
  $('form-description').textContent = deadlinePicker ? 'Set the last date and time guests can respond, then continue creating the event in chat.' : picker ? 'Choose a date and time, then continue in the chat.' : event ? `Update the details, banner and guest options for ${event.title}.` : 'Pick a date. Share an invite. Let the good times follow.';
  $('save-event').textContent = deadlinePicker ? 'Set response deadline' : picker ? 'Use this time & continue' : event ? 'Save event settings' : 'Create event & get invite';
  $('cancel-edit').hidden = !event;
  $('edit-event-actions').hidden=!event?.isOwner || compactPicker;
  $('edit-cancel-event').disabled=!!event?.cancelled;
  $('save-event').disabled=!!event?.cancelled;
  const zone = deadlinePicker ? state.session?.timezone || selectedZone() : event?.timezone || selectedZone(); options('event-zone', zone);
  const tomorrow = new Date(dateInZone(Date.now(), zone) + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  $('date').value = (deadlinePicker ? state.session?.deadlineDate : event?.localDate) || tomorrow.toISOString().slice(0, 10); $('time').value = (deadlinePicker ? state.session?.deadlineTime : event?.localTime) || '18:00';
  if (!event?.endDate) $('finish-date').value = $('date').value;
  if(picker)$('timing-options').open=true;
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
  $('connection-status').textContent=`Connected as ${data.user.firstName}${data.user.id ? ' · Telegram ID '+data.user.id : ''}${data.user.isSuperAdmin ? ' · Super admin' : ''}`;
  const hasPending = data.events.some(e => e.invitationMode!=='tickets' && !isManager(e) && !e.cancelled && e.status === 'later');
  document.querySelector('[data-tab="pending"]').hidden = !hasPending;
  if (!hasPending && listFilter === 'pending') go('events');
  $('admin-tab').hidden = !data.user.isSuperAdmin;
  const profileName=state.preference.profileName || data.user.firstName;
  $('header-name').textContent=profileName;
  $('header-initial').textContent=profileName.slice(0,1).toUpperCase();
  loadProfilePhoto();loadBotIcon();
  $('greeting').textContent = `LET’S MAKE PLANS, ${(state.preference.profileName || data.user.firstName).toUpperCase()}`;
  const currencySelect=$('display-currency');currencySelect.replaceChildren(element('option','Automatic from timezone'));currencySelect.firstChild.value='';for(const code of state.currencyCodes || []){const option=element('option',code);option.value=code;currencySelect.append(option);}currencySelect.value=state.preference.currency || '';
  options('local-zone', selectedZone()); $('device-zone').textContent = `Detected on this device: ${deviceZone}`;
  $('profile-name').value=state.preference.profileName || state.user?.firstName || '';
  $('profile-phone').value=state.preference.profilePhone || '';
  $('profile-photo-remove').hidden=!state.preference.hasPhoto;
  renderEvents();renderHome(); return data;
}
let exploreSequence=0;
async function loadExplore() {
  const sequence=++exploreSequence,zone=selectedZone();
  $('explore-refresh').disabled=true; $('explore-error').hidden=true;
  $('explore-zone').textContent='Public events in '+zone.replaceAll('_',' ');
  const list=$('explore-list');list.replaceChildren(element('p','Finding public events…','muted'));
  try {
    const result=await api('explore?timezone='+encodeURIComponent(zone));if(sequence!==exploreSequence)return;list.replaceChildren();
    if(!result.events.length) list.append(element('div','No public upcoming events in your timezone yet.','empty'));
    for(const event of result.events) {
      const card=element('article','','event-card');
      if(event.hasBanner) { const img=document.createElement('img');img.className='event-banner';img.alt='Banner for '+event.title;card.append(img);fetch(`/api/events/${event.id}/banner`,{headers:{Authorization:'tma '+initData}}).then(r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(!img.isConnected)return;const url=URL.createObjectURL(blob);img.src=url;img.onload=()=>URL.revokeObjectURL(url);}).catch(()=>img.remove()); }
      card.append(element('span','PUBLIC','tag'),priceTag(event),element('h3',event.title),element('p','🗓 '+format(event)),element('p',event.description));
      if(priceEstimate(event))card.append(element('p',priceEstimate(event),'small muted'));
      if(event.responsesClosed)card.append(element('p','Responses are closed.','small muted'));
      card.dataset.searchText=(event.title+' '+(event.description || '')).toLowerCase();
      card.append(action('Open invitation in Telegram',()=>openTelegram(event.inviteUrl),'primary'));list.append(card);
    }
    filterExplore();
  } catch(error) {if(sequence===exploreSequence){list.replaceChildren();$('explore-error').textContent=error.message;$('explore-error').hidden=false;}}
  finally {if(sequence===exploreSequence)$('explore-refresh').disabled=false;}
}
$('explore-refresh').onclick=loadExplore;
function filterExplore(){const text=$('explore-search').value.trim().toLowerCase();let count=0;for(const card of $('explore-list').children)if(card.dataset.searchText!==undefined){card.hidden=!card.dataset.searchText.includes(text);if(!card.hidden)count++;}$('explore-zone').textContent='Public events in '+selectedZone().replaceAll('_',' ')+(text ? ' · '+count+' matches':'');}
$('explore-search').oninput=filterExplore;
async function loadAdmin() {
  $('admin-refresh').disabled = true; $('admin-error').hidden = true;
  const results=await Promise.allSettled([api('admin/overview'),loadAdminWhitelist()]);
  try {
    if(results[0].status==='rejected')throw results[0].reason;
    adminData=results[0].value;
    $('owner-default-price').value=adminData.pricing?.defaultStarPrice || 0; $('owner-default-unit').value=adminData.pricing?.defaultStarPricing || 'person';
    renderAdmin();
    if(results[1].status==='rejected')throw new Error('Dev access: '+results[1].reason.message);
  }
  catch (error) { $('admin-error').textContent=error.message; $('admin-error').hidden=false;if(results[0].status==='rejected')$('admin-list').replaceChildren(); }
  finally { $('admin-refresh').disabled=false; }
}
function setWhitelistBusy(busy) {
  whitelistBusy=busy;
  $('admin-whitelist').setAttribute('aria-busy',String(busy));
  for(const control of $('admin-whitelist').querySelectorAll('input,button'))control.disabled=busy;
  $('whitelist-enabled').disabled=busy || !!adminWhitelist?.snapshotProtected;
}
function renderAdminWhitelist() {
  const data=adminWhitelist,section=$('admin-whitelist');
  section.hidden=!state.user?.isSuperAdmin || data?.supported!==true;
  if(section.hidden)return;
  const ids=Array.isArray(data.ids)?data.ids:[];
  $('whitelist-enabled').checked=!!data.enabled || !!data.snapshotProtected;
  $('whitelist-toggle-note').textContent=data.snapshotProtected ? 'Copied production data stays restricted to listed testers and the super admin.' : 'Off allows everyone. On allows listed users; an empty list also allows everyone.';
  $('whitelist-summary').textContent=data.snapshotProtected ? '🔒 Dev access · protected snapshot' : data.restricted ? '🔒 Dev access · restricted' : '🔒 Dev access · open';
  $('whitelist-access').textContent=data.invalid ? (data.restricted ? 'The saved access settings need attention. Access is restricted for safety; repair the setting and update the user IDs below.' : 'Anyone can access the dev bot and Mini App. The saved whitelist needs attention; repair the access setting before using it.') : data.snapshotProtected ? (ids.length ? 'Only the listed users and the super admin can use this development snapshot.' : 'This development snapshot is available to the super admin only. Add user IDs to invite testers.') : data.restricted ? 'Only the listed users and the super admin can access the dev bot and Mini App.' : data.enabled ? 'The list is empty, so anyone can access the dev bot and Mini App. Add a user ID to restrict access.' : 'Whitelist is off. Anyone can access the dev bot and Mini App.';
  $('whitelist-snapshot-note').hidden=!data.snapshotProtected;
  $('whitelist-repair-options').hidden=!data.invalid;
  $('whitelist-repair-note').hidden=!data.invalid;
  $('whitelist-empty').hidden=ids.length>0;
  $('whitelist-empty').textContent=data.invalid ? 'No valid user IDs are shown. Repair the access setting, then add a valid user ID.' : data.snapshotProtected ? 'No testers added yet.' : 'No user IDs added yet. An empty whitelist leaves access open.';
  const list=$('whitelist-users');list.replaceChildren();
  for(const id of ids){
    const row=element('li','','whitelist-user'),label=element('code',String(id));
    const remove=action('✕ Remove',()=>changeAdminWhitelist({action:'remove',ids:String(id)}));
    remove.className='secondary';remove.setAttribute('aria-label','Remove Telegram user ID '+String(id));
    row.append(label,remove);list.append(row);
  }
  setWhitelistBusy(whitelistBusy);
}
async function loadAdminWhitelist() {
  if(!state.user?.isSuperAdmin){adminWhitelist=null;$('admin-whitelist').hidden=true;return;}
  setWhitelistBusy(true);
  try { adminWhitelist=await api('admin/whitelist');renderAdminWhitelist(); }
  finally { setWhitelistBusy(false); }
}
async function changeAdminWhitelist(body,repair=false) {
  if(whitelistBusy || !adminWhitelist?.supported || !state.user?.isSuperAdmin)return;
  const data=adminWhitelist;
  setWhitelistBusy(true);$('whitelist-status').textContent='';
  try {
    let warning='',operation='';
    if(repair){
      warning='Repair turns on a valid whitelist access setting. When valid user IDs are saved, only listed users and the super admin can enter. If the user list still needs attention after repair, add a valid user ID below. Your super admin access is always kept.'+(data.snapshotProtected ? ' Copied production data stays protected.' : ' An empty valid list leaves access open.');operation='whitelist-repair';
    }else if(body.action==='set-enabled'){
      warning=body.enabled ? 'When the whitelist is on and has user IDs, other users cannot access the dev bot or Mini App. Only listed users and the super admin can enter. An empty list leaves access open. Your super admin access is always kept.' : 'Turning off the whitelist allows everyone to access the dev bot and Mini App. Saved user IDs will stay in the list.';
      operation=body.enabled?'whitelist-enable':'whitelist-disable';
    }else if(body.action==='remove' && data.ids?.length===1 && data.enabled && !data.snapshotProtected){
      warning='Removing the last user ID leaves the whitelist empty. Anyone will be able to access the dev bot and Mini App.';operation='whitelist-last';
    }else if(body.action==='add' && !data.ids?.length && data.enabled && !data.snapshotProtected){
      warning='Adding the first user ID will restrict access. Other users cannot access the dev bot or Mini App. Only listed users and the super admin can enter.';operation='whitelist-first';
    }
    if(warning && !await confirmAction(warning,operation))return;
    adminWhitelist=await api('admin/whitelist',body);renderAdminWhitelist();
    if(body.action==='add')$('whitelist-user-id').value='';
    $('whitelist-status').textContent=repair ? (adminWhitelist.invalid ? 'Access setting repaired. Add a valid user ID to repair the saved list.' : 'Access setting repaired and whitelist turned on.') : body.action==='set-enabled' ? (body.enabled?'Whitelist turned on.':'Whitelist turned off.') : body.action==='add' ? 'User added to the whitelist.' : 'User removed from the whitelist.';
  }catch(error){$('whitelist-status').textContent=error.message;}
  finally {renderAdminWhitelist();setWhitelistBusy(false);}
}
$('whitelist-enabled').onchange=event=>{
  const enabled=event.target.checked;event.target.checked=!!adminWhitelist?.enabled;
  changeAdminWhitelist({action:'set-enabled',enabled});
};
$('whitelist-repair').onclick=()=>changeAdminWhitelist({action:'set-enabled',enabled:true},true);
$('whitelist-add-form').onsubmit=event=>{
  event.preventDefault();const input=$('whitelist-user-id'),id=input.value.trim();
  if(!/^[1-9]\d{0,15}$/.test(id)){$('whitelist-status').textContent='Enter a valid numeric Telegram user ID.';input.focus();return;}
  changeAdminWhitelist({action:'add',ids:id});
};
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
    const result=await api('admin/pricing',{defaultStarPrice:Number($('owner-default-price').value),defaultStarPricing:$('owner-default-unit').value});
    await refresh();adminData.pricing=state.pricing;renderEvents();$('owner-pricing-status').textContent='Saved. New events use this default; current event prices are unchanged.';
  }catch(error){$('owner-pricing-status').textContent=error.message;}finally{$('save-owner-pricing').disabled=false;}
};
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { notice(''); b.dataset.tab === 'create' && (!formReady || $('event-form').hidden) ? setupForm() : go(b.dataset.tab); };
$('home-brand').onclick=event=>{event.preventDefault();go('home');};
$('hero-create').onclick = () => setupForm();
$('banner').onchange = () => { ++bannerLoadGeneration; if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl); const file=$('banner').files[0]; $('banner-preview').hidden=!file; if (file) { bannerPreviewUrl=URL.createObjectURL(file); $('banner-preview').src=bannerPreviewUrl; } };
$('cancel-edit').onclick = () => {formReady=false;go('events');};
$('edit-cancel-event').onclick=()=>activeEvent && cancelEvent(activeEvent);
$('edit-delete-event').onclick=()=>activeEvent && deleteEvent(activeEvent);
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
$('payment-terms').oninput = () => updatePricePreview();
$('payment-method').onchange=updatePricePreview;$('display-price').oninput=updatePricePreview;
$('stars-price').oninput=updatePricePreview; $('stars-pricing').onchange=updatePricePreview;
$('require-approval').onchange = () => { if ($('require-approval').checked) $('hide-location').checked = true; $('hide-location').disabled = $('require-approval').checked; };
$('clear-draft-deadline').onclick = async () => { try { await api('draft-deadline', { clear: true, sessionToken: query.get('session') }); notice('✓ Response deadline removed. Continue creating your event in chat.'); tg?.close(); } catch (e) { notice(e.message); } };
$('timezone-form').onsubmit = async event => {
  event.preventDefault(); $('save-zone').disabled = true;
  try { const result = await api('preferences', { profileName:$('profile-name').value,profilePhone:$('profile-phone').value,timezone: $('local-zone').value,currency:$('display-currency').value }); state.preference = result.preference; await refresh(); notice('✓ Profile saved.'); tg?.HapticFeedback?.notificationOccurred('success'); }
  catch (e) { notice(e.message); } finally { $('save-zone').disabled = false; }
};
function revealFieldOptions(field){for(let node=field?.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;}
$('event-form').addEventListener('invalid',event=>revealFieldOptions(event.target),true);
function revealFormError(message){
  const groups=[[/payment|price|stars|refund|terms|bank|currency/i,'stars-panel'],[/deadline|responses close/i,'guest-permissions'],[/duration|finish|end time/i,'timing-options'],[/banner|photo|image|description|invitation message/i,'extra-details'],[/media|upload|QR/i,'media-options'],[/approval|participant|attendee|group|phone|comment|visibility|public|private|permission/i,'guest-permissions']];
  for(const [pattern,id] of groups)if(pattern.test(message))$(id).open=true;
}
$('event-form').onsubmit = async event => {
  event.preventDefault(); $('save-event').disabled = true; $('form-error').hidden = true;
  const mode=selectedInvitationMode(),named=mode==='named';
  const payload = { oneTimeInvite:$('one-time-invite').checked,inviteMessage:$('invite-message').value,qrEnabled:$('qr-enabled').checked,askPhone:document.getElementById('ask-phone').checked,askComments:document.getElementById('ask-comments').checked,invitationMode:mode,guestNames:named ? $('guest-names').value : undefined,paymentMethod:$('stars-enabled').checked ? $('payment-method').value : 'free',displayPrice:$('display-price').value,paymentInstructions:$('payment-instructions').value,paymentUrl:$('payment-url').value,starPrice:$('stars-enabled').checked && $('payment-method').value==='stars' ? Number($('stars-price').value) : 0,starPricing:$('stars-pricing').value,paymentTerms:$('payment-terms').value, askParticipantCount: !named && $('ask-participant-count').checked, isPublic: $('invitation-mode').value === 'public', allowLinkUploads: $('allow-link-uploads').checked, ...endingInput(), defaultReminder: Number($('default-reminder').value), date: $('date').value, time: $('time').value, timezone: $('event-zone').value, permissions: { guestList: $('allow-guest-list').checked, uploadMedia: $('allow-upload-media').checked, viewMedia: $('allow-view-media').checked }, requireApproval: !named && $('require-approval').checked, hideLocation: $('hide-location').checked, ticketInfo: $('ticket-info').value, deadlineDate: $('deadline-enabled').checked ? $('deadline-date').value : '', deadlineTime: $('deadline-enabled').checked ? $('deadline-time').value : '' };
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
      const result = await api(path, { ...payload, title: $('title').value, location: $('location').value, description: $('description').value, requestId, ...(activeEvent?.invitationMode==='named' ? {invitationsVersion:activeEvent.invitationsVersion} : {}) });
      createdEvent = result.event; await refresh();
      if (banner) {
        const form = new FormData(); form.set('photo', banner);
        const response = await fetch(`/api/events/${createdEvent.id}/banner`, { method: 'POST', headers: { Authorization: 'tma ' + initData }, body: form });
        const saved = await response.json();
        if (!response.ok) throw new Error('Event saved. ' + saved.error + ' Your event won’t be duplicated if you retry.');
        createdEvent = saved.event; await refresh();
      }
      $('event-form').hidden = true; $('success').hidden = false; $('share-event').hidden = false; $('another-event').hidden = false;
      $('success-title').textContent = activeEvent ? 'Your event is updated.' : 'Your event is ready.'; $('success-time').textContent = format(createdEvent)+' · '+priceLabel(createdEvent)+(priceEstimate(createdEvent)?' · '+priceEstimate(createdEvent):'');
      $('open-chat').textContent = 'Open event in chat'; $('open-chat').onclick = () => openTelegram(createdEvent.inviteUrl);
    }
    tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) { revealFormError(e.message);$('form-error').textContent = e.message; $('form-error').hidden = false; tg?.HapticFeedback?.notificationOccurred('error'); }
  finally { $('save-event').disabled = false; }
};
$('share-event').onclick = () => createdEvent && share(createdEvent);
async function loadProfilePhoto(){
  const generation=++profilePhotoGeneration,img=$('profile-photo-preview'),avatar=$('header-avatar');img.hidden=true;avatar.hidden=true;$('header-initial').hidden=false;
  if(profilePhotoUrl){URL.revokeObjectURL(profilePhotoUrl);profilePhotoUrl=null;}
  if(!state.preference.hasPhoto)return;
  try{const r=await fetch('/api/profile/photo',{headers:{Authorization:'tma '+initData}});if(!r.ok)throw Error('Could not load your profile photo.');const blob=await r.blob();if(generation!==profilePhotoGeneration)return;profilePhotoUrl=URL.createObjectURL(blob);img.src=avatar.src=profilePhotoUrl;img.hidden=avatar.hidden=false;$('header-initial').hidden=true;}catch(error){if(generation===profilePhotoGeneration)notice(error.message);}
}
$('header-profile').onclick=()=>go('settings');
async function loadBotIcon(){
  const generation=++botIconGeneration;
  try{
    const r=await fetch('/api/branding/icon',{headers:{Authorization:'tma '+initData}});
    if(!r.ok){if(r.status!==404)throw Error('Could not load the bot icon.');return;}
    const blob=await r.blob();if(generation!==botIconGeneration)return;
    if(botIconUrl)URL.revokeObjectURL(botIconUrl);botIconUrl=URL.createObjectURL(blob);
    for(const id of ['home-bot-icon','bot-icon-preview']){$(id).src=botIconUrl;$(id).hidden=false;}
    $('bot-icon-fallback').hidden=true;
  }catch(error){if(generation===botIconGeneration)notice(error.message);}
}
$('bot-icon-form').onsubmit=async event=>{
  event.preventDefault();$('bot-icon-save').disabled=true;
  try{const file=$('bot-icon-file').files[0];if(!file || file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPG, PNG or WebP under 5 MB.');const body=new FormData();body.set('photo',file);const r=await fetch('/api/branding/icon',{method:'POST',headers:{Authorization:'tma '+initData},body});const result=await r.json();if(!r.ok)throw Error(result.error || 'Could not save icon.');await loadBotIcon();$('bot-icon-file').value='';$('bot-icon-status').textContent='Bot icon saved.';}catch(error){$('bot-icon-status').textContent=error.message;}finally{$('bot-icon-save').disabled=false;}
};
$('bot-icon-reset').onclick=async()=>{
  $('bot-icon-reset').disabled=true;
  try{const r=await fetch('/api/branding/icon',{method:'DELETE',headers:{Authorization:'tma '+initData}});if(!r.ok)throw Error('Could not reset icon.');for(const id of ['home-bot-icon','bot-icon-preview'])$(id).hidden=true;$('bot-icon-fallback').hidden=false;await loadBotIcon();$('bot-icon-status').textContent='Using the Telegram bot photo.';}catch(error){$('bot-icon-status').textContent=error.message;}finally{$('bot-icon-reset').disabled=false;}
};
$('profile-photo-form').onsubmit=async event=>{
  event.preventDefault();const button=$('profile-photo-save');button.disabled=true;
  try{const file=$('profile-photo').files[0];if(!file || file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPG, PNG or WebP under 5 MB.');const form=new FormData();form.set('photo',file);const r=await fetch('/api/profile/photo',{method:'POST',headers:{Authorization:'tma '+initData},body:form});const data=await r.json();if(!r.ok)throw Error(data.error || 'Could not save photo.');state.preference.hasPhoto=true;$('profile-photo-remove').hidden=false;await loadProfilePhoto();$('profile-photo').value='';$('profile-photo-status').textContent='✓ Profile photo saved.';}catch(error){$('profile-photo-status').textContent=error.message;}finally{button.disabled=false;}
};
$('profile-photo-remove').onclick=async()=>{const button=$('profile-photo-remove');button.disabled=true;try{const r=await fetch('/api/profile/photo',{method:'DELETE',headers:{Authorization:'tma '+initData}});if(!r.ok)throw Error('Could not remove photo.');state.preference.hasPhoto=false;button.hidden=true;await loadProfilePhoto();$('profile-photo-status').textContent='Photo removed.';}catch(error){$('profile-photo-status').textContent=error.message;}finally{button.disabled=false;}};
$('another-event').onclick = () => go('events');
if (!initData) {
  notice('This launch did not include your Telegram login. Reopen using App in the bot menu or the App button in a message.');
  const empty=element('div','Your events are private. Use the authenticated App button to load them.','empty');
  const botLink=$('telegram-bot-link')?.getAttribute('href') || '';
  if(/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}$/.test(botLink))empty.append(action('App',()=>{const url=botLink+'?start=app';if(tg?.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank','noopener');}));
  $('event-list').replaceChildren(empty);
  $('home-view').hidden=true;$('events-view').hidden=false;
  $('save-event').disabled = true; $('save-zone').disabled = true; $('refresh').disabled = true;
  options('local-zone', deviceZone); options('event-zone', deviceZone); $('device-zone').textContent = `Detected on this device: ${deviceZone}`;
} else {
  try {
    const data = await refresh();
    if (!state.preference.timezone) { const saved = await api('preferences', { timezone: deviceZone }); state.preference = saved.preference; await refresh(); }
    if (compactPicker) { setupForm(state.events.find(e => e.id === data.session?.event) || null); document.querySelector('.bottom-nav').hidden = true; if (data.session?.token !== query.get('session')) { notice('This picker has expired. Open a new picker from the current chat step.'); $('save-event').disabled = true; } }
    else if(query.get('invitations'))await openNamedLinks({id:query.get('invitations')},query.get('guest'));
    else if (query.get('gallery')) await openGallery(query.get('gallery'));
    else if (query.get('qr')) await showQr(query.get('qr'));
    else if(query.get('ticket'))await openTicket(query.get('ticket'));
    else if(query.get('checkin'))await openCheckin(query.get('checkin'));
    else if (query.get('event')) { const event = state.events.find(e => e.id === query.get('event')); if (isManager(event) && !event.cancelled) await editEvent(event.id); }
    else go('home');
  } catch (e) { window.reportAppError?.(e,'Loading planner');notice(e.message); $('event-list').replaceChildren(element('div', 'Could not load your events. Tap Refresh to try again.', 'empty')); }
}
