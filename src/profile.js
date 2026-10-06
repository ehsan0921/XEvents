import {InputError} from './time.js';
import {mutateState} from './worker-store.js';
import {isSuperAdmin} from './admin.js';
export const profilePreference=p=>({timezone:p.timezone,currency:p.currency || '',profileName:p.profileName || '',profilePhone:p.profilePhone || '',hasPhoto:!!p.profilePhoto});
export function profileFields(input){
  const result={};
  for(const [key,max] of [['profileName',100],['profilePhone',30]])if(input[key]!==undefined){
    if(typeof input[key]!=='string' || input[key].trim().length>max)throw new InputError('Invalid profile '+(key==='profileName'?'name':'phone number')+'.');
    const value=input[key].trim();if(key==='profilePhone' && value && !/^\+?[\d\s().-]{5,30}$/.test(value))throw new InputError('Enter a valid phone number, or leave it blank.');result[key]=value;
  }
  return result;
}
export async function profilePhotoApi(request,env,user){
  const path=new URL(request.url).pathname,branding=path==='/api/branding/icon';
  if(path!=='/api/profile/photo' && !branding)return null;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},json=(x,s=200)=>Response.json(x,{status:s,headers});
  if(branding && request.method!=='GET' && !isSuperAdmin(user,env))return json({error:'Super admin access required.'},403);
  const recordId=branding?'_branding':String(user.id),key=branding?'botIcon':'profilePhoto';
  if(request.method==='DELETE'){await mutateState(env,data=>{if(data.preferences[recordId])delete data.preferences[recordId][key];});return json({saved:true});}
  if(request.method==='GET'){
    const row=await env.DB.prepare("SELECT data FROM records WHERE kind='preferences' AND id=?").bind(recordId).first();let fileId=row && JSON.parse(row.data)[key];
    if(branding && !fileId){
      const photos=await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUserProfilePhotos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:Number(env.TELEGRAM_BOT_TOKEN.split(':')[0]),limit:1}),signal:AbortSignal.timeout(10000)})).json();
      fileId=photos.ok && photos.result?.photos?.[0]?.at(-1)?.file_id;
    }
    if(!fileId)return json({error:'No profile photo.'},404);
    const file=await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:fileId}),signal:AbortSignal.timeout(10000)})).json();
    if(!file.ok || !file.result?.file_path)return json({error:'Could not load your photo.'},502);
    const image=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.result.file_path}`,{signal:AbortSignal.timeout(10000)});
    if(!image.ok)return json({error:'Could not load your photo.'},502);return new Response(image.body,{headers:{...headers,'Content-Type':'image/jpeg'}});
  }
  if(request.method!=='POST')return json({error:'Not found.'},404);
  if(Number(request.headers.get('Content-Length'))>6*1024*1024)return json({error:'Photo must be under 5 MB.'},413);
  const bytes=await request.arrayBuffer();if(bytes.byteLength>6*1024*1024)return json({error:'Photo must be under 5 MB.'},413);
  const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type') || ''}}).formData(),photo=form.get('photo');
  if(!(photo instanceof File) || !photo.size || photo.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(photo.type))return json({error:'Choose JPG, PNG or WebP under 5 MB.'},400);
  const upload=new FormData();upload.set('chat_id',String(user.id));upload.set('photo',photo);upload.set('caption',branding?'XEvents bot icon':'Your XEvents profile photo');
  const sent=await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,{method:'POST',body:upload,signal:AbortSignal.timeout(20000)})).json();
  const fileId=sent.result?.photo?.at(-1)?.file_id;if(!sent.ok || !fileId)return json({error:'Could not save your photo.'},502);
  await mutateState(env,data=>{data.preferences[recordId] ||= {};data.preferences[recordId][key]=fileId;});return json({saved:true});
}
