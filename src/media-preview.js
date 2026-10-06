export function mediaPreview(file){
  const mime=file.mimeType || file.mime_type || '',filename=(file.filename || file.file_name || '').toLowerCase();
  const image=/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(mime) || /\.(jpe?g|png|webp|gif|bmp|avif)$/.test(filename);
  const video=/^video\/(mp4|webm|quicktime)$/.test(mime) || /\.(mp4|webm|mov)$/.test(filename);
  return file.type==='photo' || image ? 'photo':file.type==='video' || video ? 'video':null;
}
export function previewMime(file){
  const mime=file.mimeType || file.mime_type;
  if(['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/avif','video/mp4','video/webm','video/quicktime'].includes(mime))return mime;
  const ext=(file.filename || '').toLowerCase().split('.').pop();
  return {png:'image/png',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',avif:'image/avif',webm:'video/webm',mov:'video/quicktime'}[ext] || (mediaPreview(file)==='photo'?'image/jpeg':mediaPreview(file)==='video'?'video/mp4':'application/octet-stream');
}
