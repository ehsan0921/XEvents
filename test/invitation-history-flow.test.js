import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationSettings,claimInvitation} from '../src/invitations.js';
import {invitationHistory} from '../src/invitation-history.js';
import {Bot} from '../src/bot.js';

function fixture(guestNames='Alex = 2') {
  const e={id:'0123456789abcdef',owner:1,title:'Community dinner',invitationMode:'named',guests:{},media:[],permissions:{},startsAt:'2099-12-05T08:00:00Z',timezone:'UTC',askPhone:false,askComments:false};
  Object.assign(e,invitationSettings({guestNames},e));
  const token=Object.keys(e.invitees)[0],data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const open=(id=2)=>bot.handle({message:{chat:{id,type:'private'},from:{id,first_name:'Guest'},text:`/start i_${e.id}_${token}`}});
  const response=(status,id=2,version=e.guests[id]?.responseVersion || 0)=>bot.handle({callback_query:{id:'query',from:{id,first_name:'Guest'},data:`r:${e.id}:${status}:${version}`}});
  return {e,token,data,calls,bot,open,response,history:()=>invitationHistory(e,token)};
}

test('new invitations record creation and successful first opens with real timestamps',async()=>{
  const f=fixture();
  assert.deepEqual(f.history().map(row=>row.type),['created']);
  assert.ok(Number.isFinite(Date.parse(f.history()[0].at)));
  await f.open();await f.open();
  assert.deepEqual(f.history().map(row=>row.type),['created','opened']);
  assert.equal(f.history()[1].userId,2);
  await f.response('yes');
  const before=structuredClone(f.history());await f.open(3);
  assert.deepEqual(f.history(),before);assert.equal(f.e.guests[3],undefined);
});

test('existing invitations keep unknown past timestamps instead of inventing history',()=>{
  const token='a'.repeat(32),legacy={id:'0123456789abcdef',owner:1,invitationMode:'named',invitees:{[token]:{name:'Alex',claimedBy:null}},guests:{}};
  const next=invitationSettings({guestNames:'Alex\nSam'},legacy);
  assert.deepEqual(invitationHistory(next,token),[]);
  const added=Object.keys(next.invitees).find(key=>key!==token);
  assert.deepEqual(invitationHistory(next,added).map(row=>row.type),['created']);
  assert.equal(legacy.invitationHistory,undefined);
});

test('bulk editor records real edits and revokes unopened removed links without losing their history',()=>{
  const f=fixture('Alex = 2\nSam'),removed=Object.keys(f.e.invitees)[1],at=Date.parse('2026-10-08T10:00:00Z');
  const next=invitationSettings({guestNames:'Alex = 3'},f.e,at,6);
  assert.equal(next.invitees[f.token].participants,3);
  assert.equal(invitationHistory(next,f.token).at(-1).type,'edited');
  assert.equal(invitationHistory(next,f.token).at(-1).actorId,6);
  assert.equal(invitationHistory(next,removed).at(-1).type,'revoked');
  assert.equal(next.removedInvitations[removed].revokedAt,'2026-10-08T10:00:00.000Z');
  assert.equal(next.removedInvitations[removed].invite.name,'Sam');
  assert.ok(f.e.invitees[removed]);assert.equal(f.e.removedInvitations,undefined);
});

test('completed RSVP and later changes are tracked without duplicate stale-button entries',async()=>{
  const f=fixture();await f.open();await f.response('yes');
  assert.deepEqual(f.history().map(row=>row.type),['created','opened','responded']);
  assert.equal(f.history().at(-1).status,'yes');assert.equal(f.history().at(-1).participants,2);
  await f.response('maybe');assert.equal(f.history().at(-1).type,'changed');
  assert.equal(f.history().at(-1).previousStatus,'yes');assert.equal(f.history().at(-1).status,'maybe');
  const history=structuredClone(f.history());await f.response('no',2,1);
  assert.deepEqual(f.history(),history);assert.equal(f.e.guests[2].status,'maybe');
});

test('explicit Respond later is recorded once even though an opened invite starts as later',async()=>{
  const f=fixture();await f.open();await f.response('later');
  assert.equal(f.history().at(-1).type,'responded');assert.equal(f.history().at(-1).status,'later');
  const history=structuredClone(f.history());await f.response('later');assert.deepEqual(f.history(),history);
  assert.equal(f.e.invitees[f.token].respondedBy,undefined);
  await f.response('yes');await f.response('later');
  assert.equal(f.history().at(-1).type,'changed');assert.equal(f.history().at(-1).previousStatus,'yes');
  assert.equal(f.e.invitees[f.token].respondedBy,2);
});

test('nonaccepted guest count changes are audited with before and after counts',async()=>{
  const f=fixture();await f.open();await f.response('maybe');
  const previous=f.e.guests[2];
  f.data.sessions[2]={event:f.e.id,countOnly:true,baseVersion:previous.responseVersion,response:{...previous},step:'participants'};
  await f.bot.chooseParticipants(2,f.e,f.data.sessions[2],4);
  assert.equal(f.e.guests[2].participants,4);assert.equal(f.history().at(-1).type,'changed');
  assert.equal(f.history().at(-1).previousParticipants,2);assert.equal(f.history().at(-1).participants,4);
});

test('choosing an attendee count before RSVP stays awaiting a response until an explicit choice',async()=>{
  for(const status of ['later','yes']){
    const f=fixture();await f.open();
    const previous=f.e.guests[2];
    f.data.sessions[2]={event:f.e.id,countOnly:true,baseVersion:previous.responseVersion || 0,response:{...previous},step:'participants'};
    await f.bot.chooseParticipants(2,f.e,f.data.sessions[2],3);
    assert.equal(f.e.guests[2].responseRecorded,false);
    assert.equal(f.history().at(-1).type,'edited');assert.equal(f.history().at(-1).status,undefined);
    await f.response(status);
    assert.equal(f.e.guests[2].responseRecorded,true);
    assert.equal(f.history().at(-1).type,'responded');assert.equal(f.history().at(-1).status,status);
  }
});

test('refused payment or checked-in RSVP changes do not add false history',async()=>{
  for(const protectedState of ['paid','reported','checked-in']){
    const f=fixture();await f.open();await f.response('yes');
    const guest=f.e.guests[2];
    if(protectedState==='checked-in')f.e.checkIns={[guest.ticket]:{userId:2}};
    else guest.payment={status:protectedState};
    const before=structuredClone(f.history());await f.bot.saveResponse(2,f.e,{...guest,status:'no'});
    assert.deepEqual(f.history(),before);assert.equal(f.e.guests[2].status,'yes');
  }
});
