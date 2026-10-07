import {isManager} from './cohosts.js';
import {invitationMode,namedLink} from './invitations.js';
import {InputError} from './time.js';

const pageSize=10;
const validToken=token=>typeof token==='string' && /^[a-f0-9]{32}$/.test(token);
const keyboard=rows=>({inline_keyboard:rows});
const paired=buttons=>Array.from({length:Math.ceil(buttons.length/2)},(_,i)=>buttons.slice(i*2,i*2+2));

function requireHost(event,id){
  if(!isManager(event,id))throw new InputError('Only event hosts can see personal invitation links.');
  if(invitationMode(event)!=='named')throw new InputError('This event uses a shared invitation link, not a named guest list.');
}

function guestAppUrl(bot,event,token){
  if(!bot.appUrl)return null;
  try{
    const url=new URL(bot.appUrl);
    if(url.protocol!=='https:')return null;
    url.searchParams.set('invitations',event.id);
    url.searchParams.set('guest',token);
    return url.href;
  }catch{return null;}
}

export function buildInvitationCopy(bot,id,event,token){
  requireHost(event,id);
  const invite=validToken(token) && event.invitees?.[token];
  if(!invite)throw new InputError('This personal invitation is no longer available. Open the invitation list again.');
  const message=(bot.namedInvitationText(event,{...invite,invitationToken:token},id,true)+(event.inviteMessage || '')).trim();
  const url=namedLink(event,token,bot.username),text=message+'\n\n'+url;
  const appUrl=guestAppUrl(bot,event,token);
  const button=Array.from(text).length<=256 ? {text:invite.name,copy_text:{text}} : appUrl ? {text:invite.name,web_app:{url:appUrl}} : {text:invite.name,callback_data:`invite-copy:${event.id}:${token}`};
  return {message,text,url,button};
}

export function buildInvitationLinksCard(bot,id,event,page=0){
  requireHost(event,id);
  const invitees=Object.entries(event.invitees || {}).filter(([token])=>validToken(token));
  const pages=Math.max(1,Math.ceil(invitees.length/pageSize)),requested=Number(page);
  const current=Number.isSafeInteger(requested) && requested>=0 ? Math.min(requested,pages-1) : 0;
  const rows=paired(invitees.slice(current*pageSize,(current+1)*pageSize).map(([token])=>buildInvitationCopy(bot,id,event,token).button));
  const nav=[];
  if(current>0)nav.push({text:'← Previous',callback_data:`invite-links:${event.id}:${current-1}`});
  if(current+1<pages)nav.push({text:'Next →',callback_data:`invite-links:${event.id}:${current+1}`});
  if(nav.length)rows.push(nav);
  rows.push([{text:'Back to organiser tools',callback_data:`h:${event.id}`}]);
  const text=`Invitation links · ${event.title}\n${invitees.length ? 'Tap a name. Short invitations copy immediately; longer ones open copy options.\nPage '+(current+1)+' of '+pages : 'No named invitations yet.'}`;
  return {text,reply_markup:keyboard(rows)};
}

export async function invitationLinksCard(bot,id,event,page=0){
  let card;
  try{card=buildInvitationLinksCard(bot,id,event,page);}
  catch(error){if(error instanceof InputError)return bot.send(id,error.message);throw error;}
  return bot.send(id,card.text,card.reply_markup);
}

export async function invitationCopyCard(bot,id,event,token){
  let copy;
  try{copy=buildInvitationCopy(bot,id,event,token);}
  catch(error){if(error instanceof InputError)return bot.send(id,error.message);throw error;}
  const rows=[];
  if(copy.button.copy_text)rows.push([{...copy.button,text:'Copy invitation'}]);
  else if(copy.button.web_app)rows.push([{...copy.button,text:'Copy full invitation in App'}]);
  rows.push([{text:'Share invitation',url:`https://t.me/share/url?url=${encodeURIComponent(copy.url)}&text=${encodeURIComponent(copy.message)}`}]);
  const index=Object.keys(event.invitees || {}).filter(validToken).indexOf(token);
  rows.push([{text:'Back to invitation links',callback_data:`invite-links:${event.id}:${Math.floor(index/pageSize)}`}]);
  const markup=keyboard(rows);
  // Preserve the entire message, including custom text, without splitting a surrogate pair.
  for(let start=0;start<copy.text.length;){
    let end=Math.min(start+3900,copy.text.length);
    if(end<copy.text.length && /[\uD800-\uDBFF]/.test(copy.text[end-1]) && /[\uDC00-\uDFFF]/.test(copy.text[end]))end--;
    await bot.send(id,copy.text.slice(start,end),end===copy.text.length ? markup : undefined);
    start=end;
  }
}
