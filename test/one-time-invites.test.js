import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationSettings,claimInvitation,consumeInvitation,invitationAvailable,oneTimeInvites,reconcileInvitationClaims} from '../src/invitations.js';
import {Bot} from '../src/bot.js';

function fixture(mode='named',extra={}){
  const e={id:'0123456789abcdef',owner:1,title:'Dinner',location:'Venue',description:'',questions:[],guests:{},media:[],permissions:{},...invitationSettings({invitationMode:mode,...(mode==='named'?{guestNames:'Alex\nSam'}:{}),...extra})};
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const msg=(id,text)=>bot.handle({message:{chat:{id,type:'private'},from:{id,first_name:'Guest'},text}});
  const cb=(id,text)=>bot.handle({callback_query:{id:'q',from:{id,first_name:'Guest'},data:text}});
  return {e,data,calls,bot,msg,cb,token:Object.keys(e.invitees || {})[0]};
}

test('one-time links default to named lists, shared ticket links remain reusable, and values are validated',()=>{
  assert.equal(oneTimeInvites(fixture().e),true);
  assert.equal(oneTimeInvites(fixture('tickets').e),false);
  assert.equal(oneTimeInvites(fixture('tickets',{oneTimeInvite:true}).e),true);
  for(const oneTimeInvite of [0,1,'true',null])assert.throws(()=>invitationSettings({invitationMode:'tickets',oneTimeInvite}),/checked or unchecked/);
});

test('opening and Later do not consume a personal link; each completed RSVP locks it and preserves revisions',async()=>{
  for(const status of ['yes','no','maybe']){
    const f=fixture(),link=`/start i_${f.e.id}_${f.token}`;
    await f.msg(2,link);await f.cb(2,`r:${f.e.id}:later`);
    assert.equal(f.e.invitees[f.token].claimedBy,null);
    await f.msg(3,link);assert.equal(f.e.guests[3].status,'later');
    await f.cb(2,`r:${f.e.id}:${status}`);
    assert.equal(f.e.invitees[f.token].respondedBy,2);
    assert.equal(f.e.guests[3],undefined);
    await f.cb(3,`r:${f.e.id}:yes`);assert.equal(f.e.guests[3],undefined);
    await f.msg(4,link);assert.equal(f.e.guests[4],undefined);
    await f.msg(2,link);await f.cb(2,`r:${f.e.id}:later:${f.e.guests[2].responseVersion}`);
    assert.equal(f.e.guests[2].status,'later');
    await f.msg(4,link);assert.equal(f.e.guests[4],undefined);
    await f.cb(2,`r:${f.e.id}:yes:${f.e.guests[2].responseVersion}`);
    assert.equal(f.e.guests[2].status,'yes');
  }
});

test('another account cannot finish an already-open response after the first guest locks the link',async()=>{
  const f=fixture('named',{guestNames:'Alex = ?',oneTimeInvite:true}),link=`/start i_${f.e.id}_${f.token}`;
  await f.msg(2,link);await f.msg(3,link);
  await f.cb(3,`r:${f.e.id}:yes`);assert.equal(f.data.sessions[3].step,'participants');
  const stale={...f.data.sessions[3].response},countToken=f.data.sessions[3].countToken;
  await f.cb(2,`r:${f.e.id}:no`);
  assert.equal(f.data.sessions[3],undefined);
  await f.cb(3,`size:${f.e.id}:2:${countToken}`);
  await f.bot.saveResponse(3,f.e,{...stale,participants:2});
  assert.equal(f.e.guests[3],undefined);assert.equal(f.e.invitees[f.token].respondedBy,2);
});

test('reusable named links accept multiple accounts and single-use cannot be enabled over duplicate responses',async()=>{
  const f=fixture('named',{oneTimeInvite:false}),link=`/start i_${f.e.id}_${f.token}`;
  for(const id of [2,3]){await f.msg(id,link);await f.cb(id,`r:${f.e.id}:yes`);assert.equal(f.e.guests[id].status,'yes');}
  assert.throws(()=>invitationSettings({oneTimeInvite:true},f.e),/several guests/);
});

test('ticket one-time links lock at completed booking, with same account revisits and no stale access',async()=>{
  const f=fixture('tickets',{oneTimeInvite:true}),link=`/start e_${f.e.id}`;
  await f.msg(2,link);await f.msg(3,link);
  await f.cb(2,`book:${f.e.id}`);assert.equal(f.e.inviteClaimedBy,null);
  await f.msg(2,'Alex');assert.equal(f.e.inviteClaimedBy,2);assert.equal(f.e.guests[3],undefined);
  await f.msg(3,link);assert.equal(f.e.guests[3],undefined);
  await f.msg(2,link);assert.equal(f.e.guests[2].status,'yes');
});

test('legacy first-open binding is released until RSVP; previous final responses retain protection',()=>{
  const f=fixture();claimInvitation(f.e,f.token,2);f.e.invitees[f.token].claimedBy=2;
  assert.equal(invitationAvailable(f.e,3,f.token),true);
  f.e.guests[2].status='maybe';assert.equal(invitationAvailable(f.e,3,f.token),false);
  assert.throws(()=>claimInvitation(f.e,f.token,3),/already been used/);
  consumeInvitation(f.e,2,{...f.e.guests[2],status:'later'});f.e.guests[2].status='later';
  assert.equal(invitationAvailable(f.e,3,f.token),false);
});

test('enabling one-time use protects an existing sole booking but rejects already shared ticket links',()=>{
  const f=fixture('tickets');f.e.guests[2]={name:'Alex',status:'yes'};
  f.e.guests[4]={name:'Pending guest',status:'later'};f.data.sessions[4]={event:f.e.id,step:'name'};
  Object.assign(f.e,invitationSettings({oneTimeInvite:true},f.e));
  reconcileInvitationClaims(f.e,f.data.sessions);
  assert.equal(f.e.inviteClaimedBy,2);assert.equal(invitationAvailable(f.e,3),false);
  assert.equal(f.e.guests[4],undefined);assert.equal(f.data.sessions[4],undefined);
  Object.assign(f.e,invitationSettings({oneTimeInvite:false},f.e));f.e.guests[3]={name:'Sam',status:'maybe'};
  assert.throws(()=>invitationSettings({oneTimeInvite:true},f.e),/several guests/);
});
