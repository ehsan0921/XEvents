export function setupGuestMessages({$,document,api,notice,initData,zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone,schedule=setTimeout,cancel=clearTimeout}) {
  const dialog=$('guest-message-dialog');
  let eventId,token,sent=false,uploading=false,sending=false,generation=0,timer,polls=0;
  const groups={yes:'Accepted',no:'Rejected',maybe:'Maybe',later:'Respond later',unanswered:'Unanswered'};
  const node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text || '';if(className)el.className=className;return el;};
  const button=(text,fn)=>{const el=node('button',text,'secondary');el.type='button';el.onclick=async()=>{if(el.disabled)return;el.disabled=true;try{await fn();}catch(error){$('guest-message-history-status').textContent=error.message;}finally{el.disabled=false;}};return el;};
  const stop=()=>{generation++;if(timer)cancel(timer);timer=null;};
  $('guest-message-close').onclick=()=>{stop();dialog.close();};dialog.onclose=stop;
  async function loadHistory(){
    const request=++generation,id=eventId;
    const result=await api(`events/${id}/messages/history`,{});
    if(request!==generation || id!==eventId)return;
    const list=$('guest-message-history');list.replaceChildren();
    for(const message of result.messages){
      const card=node('article','','guest-message-record');card.setAttribute('role','listitem');
      const heading=node('div','','guest-message-record-heading'),date=node('time',new Intl.DateTimeFormat('en-AU',{timeZone:zone(),dateStyle:'medium',timeStyle:'short'}).format(new Date(message.createdAt)));
      const menu=node('details'),summary=node('summary','⋯');summary.setAttribute('aria-label','More message options');menu.append(summary);
      if(message.canDelete){
        menu.append(button('🗑 Delete from guest chats',async()=>{
          menu.open=false;
          const confirm=node('div','','guest-message-delete-confirm');
          confirm.append(node('p','Delete this message and its attachments from guests’ chats?'));
          const actions=node('div','','event-actions');
          actions.append(button('Confirm delete',async()=>{await api(`events/${id}/messages/delete`,{token:message.token});$('guest-message-history-status').textContent='Deletion requested.';polls=0;await loadHistory();}),button('Keep message',()=>confirm.remove()));
          confirm.append(actions);card.append(confirm);
        }));
      }else menu.append(node('p',message.undone?'Deletion already requested.':'Telegram’s 48-hour deletion window has ended.','small muted'));
      heading.append(date,menu);card.append(heading,node('p',message.preview,'guest-message-preview'));
      if(message.attachments.length)card.append(node('p','📎 '+message.attachments.join(' · '),'small muted'));
      card.append(node('p',message.delivered===null?`Sent to ${message.count} guests · Delivery count unavailable for this older message`:`Delivered: ${message.delivered}/${message.count} · Pending: ${message.undone?0:message.pending} · Failed: ${message.failed}`,'guest-message-counts'));
      if(message.undone)card.append(node('p',message.deletePending?`Deleting ${message.deletePending} messages…`:message.deleteFailed?`Deleted: ${message.deleted} messages · Could not delete: ${message.deleteFailed}`:message.deleted?'Deleted from guest chats.':'Unsent messages stopped.','small muted'));
      list.append(card);
    }
    if(!result.messages.length)list.append(node('p','No messages sent yet.','muted'));
    if(timer)cancel(timer);
    if(dialog.open && !$('guest-message-history-view').hidden && polls++<10 && result.messages.some(m=>!m.undone && m.pending>0 || m.deletePending>0))timer=schedule(()=>{loadHistory().catch(error=>{$('guest-message-history-status').textContent=error.message;});},2000);
  }
  async function showHistory(){
    $('guest-message-history-view').hidden=false;$('guest-message-form').hidden=true;polls=0;
    await loadHistory();
  }
  $('guest-message-refresh').onclick=async()=>{try{polls=0;await loadHistory();}catch(error){$('guest-message-history-status').textContent=error.message;}};
  $('guest-message-back').onclick=async()=>{if(uploading || sending)return;try{await showHistory();}catch(error){notice(error.message);}};
  $('guest-message-new').onclick=async()=>{
    if(uploading || sending)return;const control=$('guest-message-new');control.disabled=true;
    try{
      const request=++generation,id=eventId,draft=await api(`events/${id}/messages/start`,{});
      if(request!==generation || !dialog.open)return;
      stop();token=draft.token;sent=false;
      $('guest-message-history-status').textContent='';
      $('guest-message-history-view').hidden=true;$('guest-message-form').hidden=false;
      $('guest-message-text').value='';$('guest-message-files').value='';$('guest-message-uploads').replaceChildren();$('guest-message-status').textContent='Only guests who have opened the bot can receive messages. Attachments are also saved in your own bot chat.';
      $('guest-message-compose').hidden=false;$('guest-message-send').hidden=false;$('guest-message-undo').hidden=true;$('guest-message-all').checked=false;
      const container=$('guest-message-groups');container.replaceChildren();
      for(const [key,label] of Object.entries(groups)){
        const row=node('label','','check-option'),box=node('input');box.type='checkbox';box.value=key;box.checked=key==='yes';box.onchange=()=>{$('guest-message-all').checked=[...container.querySelectorAll('input')].every(b=>b.checked);};
        row.append(box,node('span',`${label} (${draft.counts[key]})`));container.append(row);
      }
    }catch(error){$('guest-message-history-status').textContent=error.message;}finally{control.disabled=false;}
  };
  $('guest-message-all').onchange=()=>{for(const box of $('guest-message-groups').querySelectorAll('input'))box.checked=$('guest-message-all').checked;};
  $('guest-message-files').onchange=async()=>{
    if(uploading || sent || sending)return;uploading=true;$('guest-message-send').disabled=true;
    try{
      for(const file of $('guest-message-files').files){
        if(file.size>20*1024*1024)throw Error('Choose files under 20 MB.');
        const body=new FormData();body.set('file',file);
        const response=await fetch(`/api/events/${eventId}/messages/upload`,{method:'POST',headers:{Authorization:'tma '+initData,'X-Draft-Token':token},body});
        const result=await response.json();if(!response.ok)throw Error(result.error || 'Attachment upload failed.');
        $('guest-message-uploads').append(node('li',file.name));
      }
      $('guest-message-status').textContent='Attachments ready.';
    }catch(error){$('guest-message-status').textContent=error.message;}
    finally{uploading=false;$('guest-message-send').disabled=false;$('guest-message-files').value='';}
  };
  $('guest-message-form').onsubmit=async event=>{
    event.preventDefault();if(uploading || sent || sending)return;sending=true;
    const control=$('guest-message-send');control.disabled=true;
    try{
      const selected=[...$('guest-message-groups').querySelectorAll('input:checked')].map(box=>box.value);
      const result=await api(`events/${eventId}/messages/send`,{token,groups:selected,text:$('guest-message-text').value});
      sent=true;$('guest-message-history-status').textContent=`Sending to ${result.count} guests now.`;
      await showHistory();
    }catch(error){$(sent?'guest-message-history-status':'guest-message-status').textContent=error.message;}
    finally{sending=false;control.disabled=false;}
  };
  return async e=>{
    if(uploading || sending){notice('Wait for the current operation to finish.');return;}
    stop();eventId=e.id;$('guest-message-event').textContent=e.title;$('guest-message-history-status').textContent='';$('guest-message-history').replaceChildren();
    $('guest-message-history-view').hidden=false;$('guest-message-form').hidden=true;dialog.showModal();
    try{polls=0;await loadHistory();}catch(error){$('guest-message-history-status').textContent=error.message;}
  };
}
