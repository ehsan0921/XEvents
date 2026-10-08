import qrcode from 'qrcode-generator';
import {mediaPreview,previewMime} from './media-preview.js';
import { can, shareUploadLink, uploadLink } from './permissions.js';
import { mutateState } from './worker-store.js';
import {isManager} from './cohosts.js';
import {invitationAvailable} from './invitations.js';


export async function mediaApi(request, env, user) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/events\/([a-f0-9]{16})\/(gallery|gallery-qr|upload-qr|media\/([a-f0-9]{12})(?:\/(send|thumbnail))?)$/);
  if (!match) return null;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (value, status = 200) => Response.json(value, { status, headers });
  const row = await env.DB.prepare("SELECT data FROM records WHERE kind='events' AND id=?").bind(match[1]).first();
  const e = row && JSON.parse(row.data);
  const preference = await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(String(user.id)).first();
  const grant = e && preference && JSON.parse(preference.data).mediaAccess?.[e.id] === e.uploadToken && !!uploadLink(e,env.BOT_USERNAME);
  if (!e || (!isManager(e,user.id) && !(e.guests[user.id] && invitationAvailable(e,user.id)) && !grant)) return json({ error: 'Open a valid event or media link first.' }, 403);
  if (match[2] === 'upload-qr') {
    if (request.method !== 'GET' || !isManager(e,user.id)) return json({ error: 'Only an organiser can view the upload QR code.' }, 403);
    if (e.qrEnabled === false) return json({ error: 'QR codes are disabled for this event.' }, 400);
    const link = shareUploadLink(e, env.BOT_USERNAME);
    if (!link) return json({ error: 'Enable guest uploads first.' }, 400);
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    return json({ link, anyone: !!e.allowLinkUploads, image: qr.createDataURL(6, 24) });
  }
  if (!can(e, user.id, 'viewMedia')) return json({ error: 'The organiser has not enabled the gallery for guests.' }, 403);
  const galleryUrl=`https://t.me/${env.BOT_USERNAME}?startapp=gallery_${e.id}`;
  if(match[2]==='gallery-qr' && request.method==='GET'){
    if(e.qrEnabled===false)return json({error:'QR codes are disabled for this event.'},400);
    const qr=qrcode(0,'M');qr.addData(galleryUrl);qr.make();
    return json({link:galleryUrl,image:qr.createDataURL(6,24)});
  }
  if (match[2] === 'gallery' && request.method === 'GET') return json({ id: e.id, title: e.title, galleryUrl, qrEnabled:e.qrEnabled!==false, cancelled: !!e.cancelled, canUpload: !e.cancelled && can(e, user.id, 'uploadMedia'), uploadUrl: `https://t.me/${env.BOT_USERNAME}?start=a_${e.id}`, media: (e.media || []).map(f => ({ id: f.id, type: f.type, previewKind:mediaPreview(f),hasThumbnail:!!f.thumbnail,filename: f.filename, caption: f.caption, name: f.name, at: f.at, size: f.size || null })) });
  const f = e.media?.find(item => item.id === match[3]);
  if (!f) return json({ error: 'This file is no longer in the event.' }, 404);
  if (match[4] === 'send' && request.method === 'POST') {
    await mutateState(env, async (data, bot) => {
      const current = data.events[e.id];
      if (!bot.mediaAllowed(current, user.id) || !can(current, user.id, 'viewMedia')) throw new Error('Access changed');
      const file = current.media.find(item => item.id === f.id); if (!file) throw new Error('File removed');
      await bot.api({ photo: 'sendPhoto', video: 'sendVideo', document: 'sendDocument' }[file.type], { chat_id: user.id, [file.type]: file.fileId, caption: file.caption || undefined });
    });
    return json({ sent: true });
  }
  if (request.method !== 'GET' || (match[4] && match[4]!=='thumbnail')) return json({ error: 'Not found.' }, 404);
  const thumbnail=match[4]==='thumbnail';if(thumbnail && !f.thumbnail)return json({error:'No thumbnail.'},404);
  if (!thumbnail && f.size > 20 * 1024 * 1024) return json({ error: 'This file is larger than 20 MB. Use Send to Telegram to download it in chat.' }, 413);
  const lookup = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: thumbnail ? f.thumbnail:f.fileId }), signal: AbortSignal.timeout(10000) });
  const result = await lookup.json();
  if (!result.ok || !result.result?.file_path) return json({ error: 'Could not load the file. Use Send to Telegram instead.' }, 502);
  const download = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${result.result.file_path}`, { signal: AbortSignal.timeout(15000) });
  if (!download.ok) return json({ error: 'Could not load this file. Try again.' }, 502);
  const mime=thumbnail || f.type==='photo' ? 'image/jpeg':previewMime(f);
  return new Response(download.body, { headers: { ...headers, 'Content-Type': mime, ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename === 'photo' ? 'photo.jpg' : f.filename === 'video' ? 'video.mp4' : f.filename)}` } : {}) } });
}
