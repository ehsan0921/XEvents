export function setupGuestMessages({$,document,api,notice,initData}) {
  const dialog=$('guest-message-dialog');
  let eventId,token,sent=false,uploading=false;
  const groups={yes:'Accepted',no:'Rejected',maybe:'Maybe',later:'Respond later',unanswered:'Unanswered'};
  $('guest-message-close').onclick=()=>dialog.close();
  $('guest-message-all').onchange=()=>{for(const box of $('guest-message-groups').querySelectorAll('input'))box.checked=$('guest-message-all').checked;};
  $('guest-message-files').onchange=async()=>{
    if(uploading || sent)return;uploading=true;$('guest-message-send').disabled=true;
    try{
      for(const file of $('guest-message-files').files){
        if(file.size>20*1024*1024)throw Error('Choose files under 20 MB.');
        const body=new FormData();body.set('file',file);
        const response=await fetch(`/api/events/${eventId}/messages/upload`,{method:'POST',headers:{Authorization:'tma '+initData,'X-Draft-Token':token},body});
        const result=await response.json();if(!response.ok)throw Error(result.error || 'Attachment upload failed.');
        const item=document.createElement('li');item.textContent=file.name;$('guest-message-uploads').append(item);
      }
      $('guest-message-status').textContent='Attachments ready.';
    }catch(error){$('guest-message-status').textContent=error.message;}
    finally{uploading=false;$('guest-message-send').disabled=false;$('guest-message-files').value='';}
  };
  $('guest-message-form').onsubmit=async event=>{
    event.preventDefault();if(uploading || sent)return;
    const button=$('guest-message-send');button.disabled=true;
    try{
      const selected=[...$('guest-message-groups').querySelectorAll('input:checked')].map(box=>box.value);
      const result=await api(`events/${eventId}/messages/send`,{token,groups:selected,text:$('guest-message-text').value});
      sent=true;$('guest-message-compose').hidden=true;button.hidden=true;
      $('guest-message-status').textContent=`Queued for ${result.count} guests. You can undo until ${new Date(result.undoUntil).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
      const undo=$('guest-message-undo');undo.hidden=false;undo.disabled=false;
      undo.onclick=async()=>{undo.disabled=true;try{await api(`events/${eventId}/messages/undo`,{token:result.token});$('guest-message-status').textContent='Undo requested. Queued messages stopped; delivered messages are being deleted.';undo.hidden=true;}catch(error){$('guest-message-status').textContent=error.message;undo.disabled=false;}};
    }catch(error){$('guest-message-status').textContent=error.message;}
    finally{button.disabled=false;}
  };
  return async e=>{
    if(uploading){notice('Wait for the attachment upload to finish.');return;}
    const draft=await api(`events/${e.id}/messages/start`,{});eventId=e.id;token=draft.token;sent=false;
    $('guest-message-event').textContent=e.title;$('guest-message-text').value='';$('guest-message-files').value='';$('guest-message-uploads').replaceChildren();$('guest-message-status').textContent='Only guests who have opened the bot can receive messages. Attachments are also saved in your own bot chat.';
    $('guest-message-compose').hidden=false;$('guest-message-send').hidden=false;$('guest-message-undo').hidden=true;$('guest-message-all').checked=false;
    const container=$('guest-message-groups');container.replaceChildren();
    for(const [key,label] of Object.entries(groups)){
      const row=document.createElement('label');row.className='check-option';const box=document.createElement('input');box.type='checkbox';box.value=key;box.checked=key==='yes';box.onchange=()=>{$('guest-message-all').checked=[...container.querySelectorAll('input')].every(b=>b.checked);};
      const name=document.createElement('span');name.textContent=`${label} (${draft.counts[key]})`;row.append(box,name);container.append(row);
    }
    dialog.showModal();
  };
}
