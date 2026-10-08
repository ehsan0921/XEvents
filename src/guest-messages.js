import { randomBytes } from 'node:crypto';
import { invitationAvailable } from './invitations.js';
import { hasRecordedResponse } from './invitation-management.js';
import { invitationHistory } from './invitation-history.js';

const groups = { yes: 'Accepted', no: 'Rejected', maybe: 'Maybe', later: 'Respond later', unanswered: 'Unanswered' };
const markup = rows => ({ inline_keyboard: rows });
const button = (text, callback_data) => ({ text, callback_data });
export function broadcastRecord(data, owner, token) { return data.preferences[owner]?.broadcasts?.[token]; }
export function broadcastRecipients(e, selected) {
  return Object.entries(e.guests).filter(([id,g]) => Number.isSafeInteger(Number(id)) && Number(id)>0 && Number(id)!==e.owner && invitationAvailable(e,Number(id)) && selected.includes(hasRecordedResponse(g,invitationHistory(e,g.invitationToken),Number(id)) ? g.status : 'unanswered')).map(([id])=>Number(id));
}
export async function broadcastReceipt(bot, owner, token, chatId, messageId) {
  const record=broadcastRecord(bot.db,owner,token);
  if(!record || !Number.isSafeInteger(messageId))return;
  const key=chatId+':'+messageId;
  if(record.receipts.some(r=>r.key===key))return;
  record.receipts.push({key,chatId,messageId});
  if(record.undone)await bot.api('deleteMessage',{chat_id:chatId,message_id:messageId});
}
export async function undoBroadcast(bot,id,token) {
  const record=broadcastRecord(bot.db,id,token);
  if(!record)return bot.send(id,'This message is unavailable.');
  if(record.undone)return bot.send(id,'Undo already requested.');
  if(Date.now()>record.undoUntil)return bot.send(id,'The five-minute undo window has ended.');
  record.undone=true;
  for(const r of record.receipts)await bot.api('deleteMessage',{chat_id:r.chatId,message_id:r.messageId});
  return bot.send(id,'Undo requested. Queued messages are stopped; delivered messages are being deleted.');
}
export function startBroadcast(bot,id,e,quiet=false) {
  bot.session(id,{step:'broadcast',event:e.id,token:randomBytes(6).toString('hex'),groups:['yes'],items:[]});
  if(!quiet)return broadcastMenu(bot,id,e);
}
export function broadcastMenu(bot,id,e) {
  const s=bot.db.sessions[id],counts=Object.fromEntries(Object.keys(groups).map(key=>[key,broadcastRecipients(e,[key]).length]));
  const options=Object.entries(groups).map(([key,label])=>button(`${s.groups.includes(key)?'☑':'☐'} ${label} (${counts[key]})`,`bm-group:${e.id}:${key}:${s.token}`));
  return bot.send(id,`${e.title}\nMessage guests · ${broadcastRecipients(e,s.groups).length} recipients\nChoose groups, then send text, photos, videos or files here.\n${s.items.length} items added. Tap Done to send.`,markup([
    [button(`${s.groups.length===Object.keys(groups).length?'☑':'☐'} All` ,`bm-group:${e.id}:all:${s.token}`)],
    ...Array.from({length:Math.ceil(options.length/2)},(_,i)=>options.slice(i*2,i*2+2)),
    [button('✅ Done · Send',`bm-send:${e.id}:${s.token}`),button('✖ Cancel',`bm-cancel:${e.id}:${s.token}`)]
  ]));
}
export function toggleBroadcast(bot,id,e,key) {
  const s=bot.db.sessions[id];
  if(key==='all')s.groups=s.groups.length===Object.keys(groups).length?[]:Object.keys(groups);
  else if(Object.hasOwn(groups,key))s.groups=s.groups.includes(key)?s.groups.filter(k=>k!==key):[...s.groups,key];
  return broadcastMenu(bot,id,e);
}
export function collectBroadcast(bot,id,e,m) {
  const s=bot.db.sessions[id];
  if(!(m.text || m.photo || m.video || m.document || m.audio || m.voice || m.animation) || !Number.isSafeInteger(m.message_id))return bot.send(id,'Send text, a photo, video or file.');
  if(s.items.includes(m.message_id))return;
  if(s.items.length>=20)return bot.send(id,'Maximum 20 items. Tap Done to send.');
  s.items.push(m.message_id);
  // Albums arrive as separate updates; avoid a reply for every attachment.
}
export async function sendBroadcast(bot,id,e) {
  const s=bot.db.sessions[id],recipients=broadcastRecipients(e,s.groups);
  if(!recipients.length)return bot.send(id,'No reachable guests selected. Choose another group.');
  if(!s.items.length && !s.text)return bot.send(id,'Add a message or attachment first.');
  const pref=bot.db.preferences[id] ||= {},records=pref.broadcasts ||= {};
  for(const [key,r] of Object.entries(records))if(r.undoUntil<Date.now()-86400000)delete records[key];
  const token=s.token;
  records[token]={event:e.id,count:recipients.length,undoUntil:Date.now()+300000,receipts:[],undone:false};
  const items=[...s.items];bot.session(id);
  for(const chatId of recipients){
    const header=await bot.api('sendMessage',{chat_id:chatId,text:`📨 Message from the organiser · ${e.title}`,__broadcast:{owner:id,token}});
    await broadcastReceipt(bot,id,token,chatId,header?.message_id);
    if(s.text){
      const result=await bot.api('sendMessage',{chat_id:chatId,text:s.text,__broadcast:{owner:id,token}});
      await broadcastReceipt(bot,id,token,chatId,result?.message_id);
    }
    for(const messageId of items){
      const result=await bot.api('copyMessage',{chat_id:chatId,from_chat_id:id,message_id:messageId,__broadcast:{owner:id,token}});
      await broadcastReceipt(bot,id,token,chatId,result?.message_id);
    }
  }
  return bot.send(id,`Queued for ${recipients.length} guests. Undo is available for 5 minutes.`,markup([[button('↩ Undo message',`bm-undo:${token}`)],[button('Back to event',`v:${e.id}`)]]));
}
