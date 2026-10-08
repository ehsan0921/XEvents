import qrcode from 'qrcode-generator';
import { deflateSync } from 'node:zlib';

function chunk(type,data){
  const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,bytes,sum]);
}
export function qrPhoto(link){
  const qr=qrcode(0,'M');qr.addData(link);qr.make();const scale=6,margin=4,size=(qr.getModuleCount()+margin*2)*scale;
  const raw=Buffer.alloc((size+1)*size,255);
  for(let y=0;y<size;y++){raw[y*(size+1)]=0;for(let x=0;x<size;x++){const r=Math.floor(y/scale)-margin,c=Math.floor(x/scale)-margin;if(r>=0 && c>=0 && r<qr.getModuleCount() && c<qr.getModuleCount() && qr.isDark(r,c))raw[y*(size+1)+x+1]=0;}}
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
export function telegramPayload(params){
  const {__photoUpload,...safe}=params;
  if(!__photoUpload)return {headers:{'Content-Type':'application/json'},body:JSON.stringify(safe)};
  const body=new FormData();
  for(const [key,value] of Object.entries(safe))if(value!==undefined)body.append(key,typeof value==='object'?JSON.stringify(value):String(value));
  body.set('photo',new Blob([Buffer.from(__photoUpload,'base64')],{type:'image/png'}),'event-upload-qr.png');
  return {body};
}
