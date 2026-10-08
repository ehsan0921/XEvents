import test from 'node:test';
import assert from 'node:assert/strict';
import {unavailablePhotoFallback,drainOutbox} from '../src/worker.js';

const photo={chat_id:710001,photo:'fictional-other-bot-file',caption:'Example event\nExample address',caption_entities:[{type:'code',offset:14,length:15}],reply_markup:{inline_keyboard:[[{text:'Manage',callback_data:'h:0123456789abcdef'}]]}};
const rejected={ok:false,error_code:400,description:'Bad Request: wrong file identifier/HTTP URL specified'};
test('unavailable photo fallback preserves authorised content, entities and buttons',()=>{
  const fallback=unavailablePhotoFallback(photo,rejected);
  assert.equal(fallback.chat_id,photo.chat_id);assert.ok(fallback.text.startsWith(photo.caption));
  assert.deepEqual(fallback.entities,photo.caption_entities);assert.deepEqual(fallback.reply_markup,photo.reply_markup);
  assert.equal('photo' in fallback,false);
  for(const result of [{ok:true},{ok:false,error_code:403,description:'Forbidden'},{ok:false,error_code:429},{ok:false,error_code:503}, {...rejected,description:'Bad Request: BUTTON_DATA_INVALID'}])assert.equal(unavailablePhotoFallback(photo,result),null);
  assert.equal(unavailablePhotoFallback({...photo,caption:''},rejected),null);
});

for(const retry of [false,true])test(`photo delivery persists text fallback and ${retry?'retries transient errors':'delivers the event buttons'}`,async t=>{
  const row={id:'fictional-delivery',method:'sendPhoto',params:JSON.stringify(photo),due:0,attempts:1},calls=[],removed=[],saved=[];
  const env={APP_ENV:'production',TELEGRAM_BOT_TOKEN:'fictional-token',DB:{prepare(sql){
    return {values:[],bind(...values){this.values=values;return this;},async first(){if(sql.startsWith('INSERT INTO delivery_lease'))return {owner:'fixture'};if(sql.startsWith('UPDATE outbox SET due=unixepoch()+60'))return {...row};throw Error('Unexpected first');},async all(){assert.match(sql,/SELECT id,due FROM outbox/);return {results:[row]};},async run(){
      if(sql==='UPDATE outbox SET method=?,params=? WHERE id=?'){saved.push(this.values);row.method=this.values[0];row.params=this.values[1];}
      else if(sql==='DELETE FROM outbox WHERE id=?')removed.push(this.values[0]);
      else if(sql.startsWith('UPDATE outbox SET due=unixepoch()+?'))saved.push(['retry']);
      else assert.equal(sql,'DELETE FROM delivery_lease WHERE owner=?');
    }};
  }}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({method:new URL(url).pathname.split('/').at(-1),params:JSON.parse(options.body)});return Response.json(calls.length===1?rejected:retry&&calls.length===2?{ok:false,error_code:503}:{ok:true});});
  await drainOutbox(env);
  assert.deepEqual(calls.map(call=>call.method),['sendPhoto','sendMessage']);
  assert.deepEqual(calls[1].params.reply_markup,photo.reply_markup);
  assert.equal(row.method,'sendMessage');assert.equal(saved[0][2],row.id);
  if(retry){assert.deepEqual(removed,[]);assert.deepEqual(saved.at(-1),['retry']);await drainOutbox(env);assert.equal(calls.at(-1).method,'sendMessage');}
  assert.deepEqual(removed,[row.id]);
});
