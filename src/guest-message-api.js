import { mutateState } from './worker-store.js';
import { startBroadcast,broadcastRecipients,sendBroadcast,undoBroadcast,broadcastHistory } from './guest-messages.js';
import { InputError } from './time.js';
import { mayUseTestApp } from './test-access.js';
import { snapshotDeliveryAllowed } from './snapshot-mode.js';

export async function guestMessageApi(request,env,user,eventId,action,respond) {
  let phase='validate';
  const check=(data,token)=>{
    const e=data.events[eventId],s=data.sessions[user.id];
    if(!e || e.owner!==user.id || e.cancelled)throw new InputError('Only the creator of an active event can message guests.');
    if(token && (s?.step!=='broadcast' || s.event!==eventId || s.token!==token))throw new InputError('This draft expired. Reopen Message guests.');
    return {e,s};
  };
  try {
    if(action==='upload'){
      const token=request.headers.get('X-Draft-Token');
      if(!token)throw new InputError('Open Message guests first.');
      await mutateState(env,data=>{const {s}=check(data,token);if(s.items.length>=20)throw new InputError('Maximum 20 attachments.');});
      if(!await snapshotDeliveryAllowed(env,'sendDocument',{chat_id:user.id}))throw new InputError('Uploads are unavailable for this test account.');
      const reader=request.body?.getReader();if(!reader)throw new InputError('Choose a file.');
      phase='read-upload';
      const chunks=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>21*1024*1024){await reader.cancel();return respond({error:'Choose a file under 20 MB.'},413);}chunks.push(part.value);}
      const form=await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('Content-Type') || ''}}).formData();
      phase='save-upload';
      const file=form.get('file');
      if(!(file instanceof File) || !file.size || file.size>20*1024*1024)throw new InputError('Choose a file under 20 MB.');
      if(!await mayUseTestApp(env,user))throw new InputError('This test account cannot upload.');
      const upload=new FormData();upload.set('chat_id',String(user.id));upload.set('document',file);upload.set('disable_notification','true');
      const result=await(await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,{method:'POST',body:upload,signal:AbortSignal.timeout(20000)})).json();
      if(!result.ok || !Number.isSafeInteger(result.result?.message_id))throw new InputError('Could not upload attachment. Please retry.');
      await mutateState(env,data=>{const {s}=check(data,token);if(s.items.length>=20)throw new InputError('Maximum 20 attachments.');s.items.push(result.result.message_id);(s.attachments ||= []).push(file.name.slice(0,200));});
      return respond({uploaded:true});
    }
    const reader=request.body?.getReader();if(!reader)throw new InputError('Invalid request.');
    const chunks=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>24000){await reader.cancel();return respond({error:'Too much text.'},413);}chunks.push(part.value);}
    let input;
    try{input=JSON.parse(await new Blob(chunks).text());if(!input || typeof input!=='object' || Array.isArray(input))throw Error();}catch{throw new InputError('Invalid request.');}
    if(action==='history'){
      const [event,preference]=await Promise.all([
        env.DB.prepare("SELECT data FROM records WHERE kind='events' AND id=?").bind(eventId).first(),
        env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first()
      ]);
      if(!event || JSON.parse(event.data).owner!==user.id)throw new InputError('Only the event creator can view message history.');
      return respond({messages:broadcastHistory({preferences:{[user.id]:preference?JSON.parse(preference.data):{}}},user.id,eventId)});
    }
    return respond(await mutateState(env,async(data,bot)=>{
      if(action==='undo' || action==='delete'){
        const r=data.preferences[user.id]?.broadcasts?.[input.token];
        if(!r || r.event!==eventId)throw new InputError('This message is unavailable.');
        if(!r.undone && (action==='delete' ? Date.now()-(r.createdAt || r.undoUntil-300000)>=48*3600000 : Date.now()>r.undoUntil))throw new InputError(action==='delete'?'Telegram can only delete messages sent within 48 hours.':'The five-minute undo window has ended.');
        if(!r.undone)await undoBroadcast(bot,user.id,input.token,action==='delete');
        return {undone:true};
      }
      if(action==='send'){
        if(typeof input.token!=='string' || !/^[a-f0-9]{12}$/.test(input.token))throw new InputError('This draft expired. Reopen Message guests.');
        const previous=data.preferences[user.id]?.broadcasts?.[input.token];
        if(previous?.event===eventId)return {token:input.token,count:previous.count,undoUntil:previous.undoUntil,undone:previous.undone};
      }
      const {e,s}=check(data,action==='send'?input.token:undefined);
      if(action==='start'){
        startBroadcast(bot,user.id,e,true);
        return {token:data.sessions[user.id].token,counts:Object.fromEntries(['yes','no','maybe','later','unanswered'].map(key=>[key,broadcastRecipients(e,[key]).length]))};
      }
      if(action!=='send')throw new InputError('Unknown messaging action.');
      if(!Array.isArray(input.groups) || !input.groups.length || input.groups.some(g=>!['yes','no','maybe','later','unanswered'].includes(g)))throw new InputError('Select at least one guest group.');
      if(typeof input.text!=='string' || input.text.length>4000)throw new InputError('Use up to 4000 characters.');
      s.groups=[...new Set(input.groups)];s.text=input.text.trim();
      if(!s.items.length && !s.text)throw new InputError('Add a message or attachment first.');
      const count=broadcastRecipients(e,s.groups).length;if(!count)throw new InputError('No reachable guests selected.');
      const token=s.token;await sendBroadcast(bot,user.id,e);
      return {token,count,undoUntil:data.preferences[user.id].broadcasts[token].undoUntil};
    }));
  } catch(error) {
    if(!(error instanceof InputError))console.error(JSON.stringify({event:'guest_message_failed',phase,name:error.name}));
    return respond({error:error instanceof InputError?error.message:'Could not process the message. Please retry.'},error instanceof InputError?400:503);
  }
}
