import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaApi} from '../src/media-api.js';

function fixture(qrEnabled){
  const event={id:'0123456789abcdef',owner:1,qrEnabled,guests:{2:{status:'yes'}},permissions:{uploadMedia:true},media:[]};
  const env={BOT_USERNAME:'TestEvents_bot',DB:{prepare(sql){return {bind(){return this;},async first(){return sql.includes("kind='events'") ? {data:JSON.stringify(event)}:null;}};}}};
  return {event,env,request:new Request(`https://test/api/events/${event.id}/upload-qr`)};
}

test('disabled upload QR cannot be requested directly by an organiser or guest',async()=>{
  const {env,request}=fixture(false);
  const organiser=await mediaApi(request,env,{id:1});
  assert.equal(organiser.status,400);assert.deepEqual(await organiser.json(),{error:'QR codes are disabled for this event.'});
  const guest=await mediaApi(request,env,{id:2});
  assert.equal(guest.status,403);
});

test('enabled and existing event upload QR remain available to the organiser',async()=>{
  for(const setting of [true,undefined]){
    const {env,request}=fixture(setting);
    const response=await mediaApi(request,env,{id:1}),body=await response.json();
    assert.equal(response.status,200);assert.match(body.image,/^data:image\/gif;base64,/);
    assert.equal(body.link,'https://t.me/TestEvents_bot?start=a_0123456789abcdef');
  }
});
