export function setupGallery({ $, api, element, action, go, notice, openTelegram, initData }) {
  let galleryEvent = null;
  const urls = new Set();
  const filename = file => file.filename==='photo'?'photo.jpg':file.filename==='video'?'video.mp4':file.filename;
  function showMedia(id,file,blob,url) {
    $('photo-full').hidden=file.type!=='photo'; $('video-full').hidden=file.type!=='video';
    if(file.type==='photo') { $('photo-full').src=url; $('photo-full').alt=file.caption || 'Shared photo'; }
    else { $('video-full').src=url; }
    $('media-popup-status').textContent='';
    $('media-save').onclick=()=>saveBlob(blob,filename(file));
    $('media-send').onclick=async()=>{ $('media-send').disabled=true; try { await api(`events/${id}/media/${file.id}/send`,{}); $('media-popup-status').textContent='Sent to your Telegram chat.'; } catch(error) { $('media-popup-status').textContent=error.message; } finally { $('media-send').disabled=false; } };
    $('photo-dialog').showModal();
  }
  function saveBlob(blob, filename) { const url=URL.createObjectURL(blob); const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function mediaBlob(eventId, fileId) {
    const response=await fetch(`/api/events/${eventId}/media/${fileId}`,{headers:{Authorization:'tma '+initData}});
    if(!response.ok){const data=await response.json();throw new Error(data.error || 'Could not download this file.');}return response.blob();
  }
  async function openGallery(id) {
    galleryEvent=id;go('gallery');$('gallery-error').hidden=true;$('gallery-list').replaceChildren(element('p','Loading files…','muted'));
    for(const url of urls) URL.revokeObjectURL(url);urls.clear();
    try {
      const gallery=await api(`events/${id}/gallery`);if(galleryEvent!==id)return;
      $('gallery-title').textContent=gallery.title;$('gallery-summary').textContent=`${gallery.media.length} shared files. Download here or send a file to your Telegram chat.`;
      $('gallery-upload').hidden=!gallery.canUpload;$('gallery-upload').onclick=()=>openTelegram(gallery.uploadUrl);
      const list=$('gallery-list');list.replaceChildren();if(!gallery.media.length)list.append(element('p','No files have been shared yet.','muted'));
      for(const file of gallery.media) {
        const card=element('article','','gallery-item');const body=element('div','','gallery-item-body');
        if(file.type==='photo') {
          const img=document.createElement('img');img.alt=file.caption || `Photo shared by ${file.name}`;img.loading='lazy';card.append(img);
          const observer=new IntersectionObserver(async entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();try{const blob=await mediaBlob(id,file.id);if(!img.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);img.src=url;img.onclick=()=>showMedia(id,file,blob,url);}catch(error){img.remove();body.prepend(element('p',error.message,'small muted'));}});observer.observe(img);
        }
        body.append(element('strong',file.filename==='photo'?'Photo':file.filename),element('p',`Shared by ${file.name}${file.caption?'\n'+file.caption:''}`,'small muted'));
        const buttons=element('div','','event-actions');
        buttons.append(action('Download',async()=>{try{saveBlob(await mediaBlob(id,file.id),file.filename==='photo'?'photo.jpg':file.filename==='video'?'video.mp4':file.filename);}catch(error){notice(error.message);}}));
        buttons.append(action('Send to Telegram',async()=>{try{await api(`events/${id}/media/${file.id}/send`,{});notice('File sent to your Telegram chat.');}catch(error){notice(error.message);}}));
        if(file.type==='video')buttons.append(action('Play video',async()=>{try{const blob=await mediaBlob(id,file.id);const url=URL.createObjectURL(blob);urls.add(url);showMedia(id,file,blob,url);}catch(error){notice(error.message);}}));
        body.append(buttons);card.append(body);list.append(card);
      }
    }catch(error){$('gallery-list').replaceChildren();$('gallery-error').textContent=error.message;$('gallery-error').hidden=false;}
  }
  async function showQr(id) {
    try{const qr=await api(`events/${id}/upload-qr`);$('upload-qr').src=qr.image; $('qr-description').textContent=qr.anyone ? 'Anyone with this link can add media without an RSVP. They can view Shared media if you enable viewing. Private event details stay hidden.' : 'Existing event guests can scan this code to add media. Enable uploads by link in event settings to let anyone contribute without an RSVP.';
      $('qr-share').onclick=()=>openTelegram(`https://t.me/share/url?url=${encodeURIComponent(qr.link)}&text=${encodeURIComponent('Share your event photos and files')}`);
      $('qr-download').onclick=()=>{const bytes=Uint8Array.from(atob(qr.image.split(',')[1]),character=>character.charCodeAt(0));saveBlob(new Blob([bytes],{type:'image/gif'}),'event-upload-qr.gif');};$('qr-dialog').showModal();
    }catch(error){notice(error.message);}
  }
  $('gallery-back').onclick=()=>go('events');$('gallery-refresh').onclick=()=>galleryEvent && openGallery(galleryEvent);
  $('qr-close').onclick=()=>$('qr-dialog').close();$('photo-close').onclick=()=>$('photo-dialog').close();
  $('photo-dialog').onclose=()=>{ $('video-full').pause(); $('video-full').removeAttribute('src'); $('video-full').load(); };
  return {openGallery,showQr};
}
