import { randomBytes } from 'node:crypto';
import { invitationAvailable } from './invitations.js';
import { hasRecordedResponse } from './invitation-management.js';
import { invitationHistory } from './invitation-history.js';

const groups = { yes: 'Accepted', no: 'Rejected', maybe: 'Maybe', later: 'Respond later', unanswered: 'Unanswered' };
const markup = rows => ({ inline_keyboard: rows });
const button = (text, callback_data) => ({ text, callback_data });
export const broadcastKeyboard = () => ({keyboard:[[{text:'📨 Send message'},{text:'✖ Cancel'}]],resize_keyboard:true,is_persistent:true});
export function broadcastRecord(data, owner, token) { return data.preferences[owner]?.broadcasts?.[token]; }
export function broadcastHistory(data,owner,eventId) {
  return Object.entries(data.preferences[owner]?.broadcasts || {}).filter(([,r])=>r.event===eventId).map(([token,r])=>{
    const recipients=new Map();
    for(const receipt of r.receipts)recipients.set(String(receipt.chatId),(recipients.get(String(receipt.chatId)) || 0)+1);
    const delivered=r.expectedMessages ? [...recipients.values()].filter(n=>n>=r.expectedMessages).length : null;
    const failed=Object.keys(r.failures || {}).filter(id=>!r.expectedMessages || (recipients.get(id) || 0)<r.expectedMessages).length;
    const createdAt=r.createdAt || r.undoUntil-300000;
    const deleted=r.receipts.filter(receipt=>receipt.deleted).length;
    const deleteFailed=r.receipts.filter(receipt=>receipt.deleteFailed).length;
    return {token,createdAt,preview:r.preview || 'Previous message (content unavailable)',attachments:r.attachments || [],count:r.count,delivered,failed,pending:delivered===null?null:Math.max(0,r.count-delivered-failed),undone:!!r.undone,deleted,deleteFailed,deletePending:r.undone?Math.max(0,r.receipts.length-deleted-deleteFailed):0,canDelete:!r.undone && Date.now()-createdAt<48*3600000};
  }).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100);
}
export async function queueBroadcastDelete(bot,owner,token,receipt) {
  if(receipt.deleted)return;
  const result=await bot.api('deleteMessage',{chat_id:receipt.chatId,message_id:receipt.messageId,__broadcastDelete:{owner,token}});
  if(result===true)receipt.deleted=true;
}
export function broadcastDeliveryResult(data,owner,token,chatId,result,messageId) {
  const r=broadcastRecord(data,owner,token);if(!r)return;
  if(messageId!==undefined){
    const receipt=r.receipts.find(item=>item.chatId===chatId && item.messageId===messageId);
    if(receipt){receipt.deleted=result.ok===true;receipt.deleteFailed=!result.ok;}
  }else if(!result.ok){(r.failures ||= {})[chatId]=result.snapshotBlocked?'test-restricted':result.error_code===403?'unavailable':'failed';}
}
export function broadcastRecipients(e, selected) {
  return Object.entries(e.guests).filter(([id,g]) => Number.isSafeInteger(Number(id)) && Number(id)>0 && Number(id)!==e.owner && invitationAvailable(e,Number(id)) && selected.includes(hasRecordedResponse(g,invitationHistory(e,g.invitationToken),Number(id)) ? g.status : 'unanswered')).map(([id])=>Number(id));
}
export async function broadcastReceipt(bot, owner, token, chatId, messageId) {
  const record=broadcastRecord(bot.db,owner,token);
  if(!record || !Number.isSafeInteger(messageId) || messageId<=0)return;
  const key=chatId+':'+messageId;
  if(record.receipts.some(r=>r.key===key))return;
  const receipt={key,chatId,messageId,sentAt:Date.now()};record.receipts.push(receipt);
  if(record.undone)await queueBroadcastDelete(bot,owner,token,receipt);
}
export async function undoBroadcast(bot,id,token,deleteOld=false) {
  const record=broadcastRecord(bot.db,id,token);
  if(!record)return bot.send(id,'This message is unavailable.');
  if(record.undone)return bot.send(id,'Undo already requested.');
  if(deleteOld ? Date.now()-(record.createdAt || record.undoUntil-300000)>=48*3600000 : Date.now()>record.undoUntil)return bot.send(id,deleteOld?'Telegram can only delete messages sent within 48 hours.':'The five-minute undo window has ended.');
  record.undone=true;
  record.deleteRequestedAt=Date.now();
  for(const r of record.receipts)await queueBroadcastDelete(bot,id,token,r);
  return bot.api('sendMessage',{chat_id:id,text:'Undo requested. Queued messages are stopped; delivered messages are being deleted.',__broadcastNotice:true});
}
export async function startBroadcast(bot,id,e,quiet=false) {
  bot.session(id,{step:'broadcast',event:e.id,token:randomBytes(6).toString('hex'),groups:['yes'],items:[],chatComposer:!quiet});
  if(!quiet){await broadcastMenu(bot,id,e);return bot.send(id,'Write your message or attach files. When finished, press Send message.',broadcastKeyboard());}
}
export function broadcastMenu(bot,id,e,message) {
  const s=bot.db.sessions[id],counts=Object.fromEntries(Object.keys(groups).map(key=>[key,broadcastRecipients(e,[key]).length]));
  const options=Object.entries(groups).map(([key,label])=>button(`${s.groups.includes(key)?'✅':'❌'} ${label} (${counts[key]})`,`bm-group:${e.id}:${key}:${s.token}`));
  const text=`${e.title}\nMessage guests · ${broadcastRecipients(e,s.groups).length} recipients\nChoose recipient categories below.`;
  const reply_markup=markup([
    [button(`${s.groups.length===Object.keys(groups).length?'✅':'❌'} All` ,`bm-group:${e.id}:all:${s.token}`)],
    ...Array.from({length:Math.ceil(options.length/2)},(_,i)=>options.slice(i*2,i*2+2)),
  ]);
  if(message?.chat?.id===id && Number.isSafeInteger(message.message_id) && message.message_id>0)return bot.api('editMessageText',{chat_id:id,message_id:message.message_id,text,reply_markup,__broadcastNotice:true});
  return bot.send(id,text,reply_markup);
}
export function toggleBroadcast(bot,id,e,key,message) {
  const s=bot.db.sessions[id];
  if(key==='all')s.groups=s.groups.length===Object.keys(groups).length?[]:Object.keys(groups);
  else if(Object.hasOwn(groups,key))s.groups=s.groups.includes(key)?s.groups.filter(k=>k!==key):[...s.groups,key];
  return broadcastMenu(bot,id,e,message);
}
export function collectBroadcast(bot,id,e,m) {
  const s=bot.db.sessions[id];
  if(!(m.text || m.photo || m.video || m.document || m.audio || m.voice || m.animation) || !Number.isSafeInteger(m.message_id))return bot.send(id,'Send text, a photo, video or file.');
  if(s.items.includes(m.message_id))return;
  if(s.items.length>=20)return bot.send(id,'Maximum 20 items. Tap Send message below.');
  s.items.push(m.message_id);
  (s.previews ||= []).push((m.text || m.caption || '').slice(0,500));
  if(!m.text)(s.attachments ||= []).push(m.document?.file_name || m.audio?.file_name || (m.photo?'Photo':m.video?'Video':m.voice?'Voice message':'Attachment'));
  // Albums arrive as separate updates; avoid a reply for every attachment.
}
export async function sendBroadcast(bot,id,e) {
  const s=bot.db.sessions[id],recipients=broadcastRecipients(e,s.groups);
  if(!recipients.length)return bot.send(id,'No reachable guests selected. Choose another group.');
  if(!s.items.length && !s.text)return bot.send(id,'Write your message or attach files first. Then press Send message.',broadcastKeyboard());
  const pref=bot.db.preferences[id] ||= {},records=pref.broadcasts ||= {};
  const token=s.token;
  records[token]={event:e.id,count:recipients.length,createdAt:Date.now(),preview:(s.text || s.previews?.filter(Boolean).join('\n') || 'Message with attachments').slice(0,4000),attachments:s.attachments || [],expectedMessages:1+(s.text?1:0)+s.items.length,undoUntil:Date.now()+300000,receipts:[],undone:false};
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
  if(s.chatComposer)await bot.home(id,'Message queued. Back to the main menu.',true);
  return bot.api('sendMessage',{chat_id:id,text:`Sending to ${recipients.length} guests now. Undo is available for 5 minutes.`,reply_markup:markup([[button('↩ Undo message',`bm-undo:${token}`)],[button('Back to event',`v:${e.id}`)]]),__broadcastNotice:true});
}
