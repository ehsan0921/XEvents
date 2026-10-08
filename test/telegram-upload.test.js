import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {qrPhoto,telegramPayload} from '../src/telegram-upload.js';
test('QR photo uses a valid PNG and multipart transport without internal metadata',async()=>{
  const encoded=qrPhoto('https://t.me/FictionalBot?start=a_example'),png=Buffer.from(encoded,'base64');
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const size=png.readUInt32BE(16);assert.ok(size>100);
  const compressedSize=png.readUInt32BE(33);assert.equal(inflateSync(png.subarray(41,41+compressedSize)).length,(size+1)*size);
  const result=telegramPayload({chat_id:1,__photoUpload:encoded,caption:'Fictional QR',reply_markup:{inline_keyboard:[]}});
  assert.ok(result.body instanceof FormData);assert.equal(result.body.has('__photoUpload'),false);
  assert.equal(result.body.get('photo').type,'image/png');assert.equal(result.body.get('chat_id'),'1');
  assert.deepEqual(Buffer.from(await result.body.get('photo').arrayBuffer()),png);
  assert.deepEqual(JSON.parse(telegramPayload({chat_id:1,text:'Example'}).body),{chat_id:1,text:'Example'});
});
