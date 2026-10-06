export function setupGallery({ $, api, element, action, go, notice, openTelegram, initData }) {
  let galleryEvent = null;
  let generation=0;
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
  async function mediaBlob(eventId, fileId,thumbnail=false) {
    const response=await fetch(`/api/events/${eventId}/media/${fileId}${thumbnail?'/thumbnail':''}`,{headers:{Authorization:'tma '+initData}});
    if(!response.ok){const data=await response.json();throw new Error(data.error || 'Could not download this file.');}return response.blob();
  }
  async function openGallery(id) {
    const current=++generation;
    galleryEvent=id;go('gallery');$('gallery-error').hidden=true;$('gallery-list').replaceChildren(element('p','Loading files…','muted'));
    for(const url of urls) URL.revokeObjectURL(url);urls.clear();
    try {
      const gallery=await api(`events/${id}/gallery`);if(current!==generation)return;
      $('gallery-title').textContent=gallery.title;$('gallery-summary').textContent=`${gallery.media.length} shared files. Download here or send a file to your Telegram chat.`;
      $('gallery-upload').hidden=!gallery.canUpload;$('gallery-upload').onclick=()=>openTelegram(gallery.uploadUrl);
      const list=$('gallery-list');list.replaceChildren();if(!gallery.media.length)list.append(element('p','No files have been shared yet.','muted'));
      for(const file of gallery.media) {
        const kind=file.previewKind || (['photo','video'].includes(file.type)?file.type:null),previewFile={...file,type:kind};
        const card=element('article','','gallery-item');const body=element('div','','gallery-item-body');
        if(kind==='photo' || (kind==='video' && file.hasThumbnail)) {
          const img=document.createElement('img');img.alt=file.caption || `${kind==='video'?'Video preview':'Photo'} shared by ${file.name}`;img.loading='lazy';card.append(img);
          const observer=new IntersectionObserver(async entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();try{const blob=await mediaBlob(id,file.id,file.hasThumbnail);if(!img.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);img.src=url;img.onclick=async()=>{try{const full=file.hasThumbnail?await mediaBlob(id,file.id):blob;if(!img.isConnected)return;const fullUrl=file.hasThumbnail?URL.createObjectURL(full):url;urls.add(fullUrl);showMedia(id,previewFile,full,fullUrl);}catch(error){notice(error.message);}};}catch(error){img.remove();body.prepend(element('p',error.message,'small muted'));}});observer.observe(img);
        }else if(kind==='video'){
          const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label',file.caption || 'Video preview');card.append(video);
          const observer=new IntersectionObserver(async entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();try{const blob=await mediaBlob(id,file.id);if(!video.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);video.src=url;video.onloadeddata=()=>{try{video.currentTime=.1;}catch{}};video.onclick=()=>showMedia(id,previewFile,blob,url);}catch(error){video.remove();body.prepend(element('p',error.message,'small muted'));}});observer.observe(video);
        }
        body.append(element('strong',file.filename==='photo'?'Photo':file.filename),element('p',`Shared by ${file.name}${file.caption?'\n'+file.caption:''}`,'small muted'));
        const buttons=element('div','','event-actions');
        buttons.append(action('Download',async()=>{try{saveBlob(await mediaBlob(id,file.id),file.filename==='photo'?'photo.jpg':file.filename==='video'?'video.mp4':file.filename);}catch(error){notice(error.message);}}));
        buttons.append(action('Send to Telegram',async()=>{try{await api(`events/${id}/media/${file.id}/send`,{});notice('File sent to your Telegram chat.');}catch(error){notice(error.message);}}));
        if(kind==='video')buttons.append(action('Play video',async()=>{try{const blob=await mediaBlob(id,file.id);const url=URL.createObjectURL(blob);urls.add(url);showMedia(id,previewFile,blob,url);}catch(error){notice(error.message);}}));
        body.append(buttons);card.append(body);list.append(card);
      }
    }catch(error){if(current!==generation)return;$('gallery-list').replaceChildren();$('gallery-error').textContent=error.message;$('gallery-error').hidden=false;}
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
