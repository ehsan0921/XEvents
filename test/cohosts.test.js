import test from 'node:test';
import assert from 'node:assert/strict';
import {claimCohost,cohostLink,cohostVersion,createCohostInvite,isManager,revokeCohost} from '../src/cohosts.js';
import {can,canSeeLocation,responseCounts} from '../src/permissions.js';

const event=()=>({id:'0123456789abcdef',owner:1,guests:{},cancelled:false});
const user=(id=2)=>({id,first_name:'Alex',last_name:'Smith',username:'alex_smith'});

test('event owner creates a one-use co-host link with a Telegram-compatible payload',()=>{
  const e=event(),invite=createCohostInvite(e,1),link=cohostLink(e,'ExampleBot');
  assert.equal(invite,e.cohostInvite);assert.match(invite.token,/^[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(invite.createdAt)));
  const url=new URL(link),payload=url.searchParams.get('start');
  assert.equal(url.origin,'https://t.me');assert.equal(url.pathname,'/ExampleBot');
  assert.equal(payload,`c_${e.id}_${invite.token}`);assert.ok(payload.length<=64);
  assert.equal(isManager(e,1),true);assert.equal(isManager(e,2),false);
});

test('claim stores the authenticated Telegram identity, grants the role, and consumes the link',()=>{
  const e=event(),token=createCohostInvite(e,1).token,identity=claimCohost(e,token,user());
  assert.equal(identity,e.cohost);assert.deepEqual({...identity,joinedAt:null},{id:2,name:'Alex Smith',username:'alex_smith',joinedAt:null});
  assert.ok(Number.isFinite(Date.parse(identity.joinedAt)));assert.equal(e.cohostInvite,null);
  assert.equal(isManager(e,2),true);assert.equal(isManager(e,1),true);assert.equal(isManager(e,3),false);
  assert.equal(cohostLink(e,'ExampleBot'),null);
  assert.throws(()=>claimCohost(e,token,user()),/unavailable|already/);
  assert.throws(()=>claimCohost(e,token,user(3)),/unavailable|already/);
  assert.equal(e.cohost,identity);
});

test('rotating an unclaimed link invalidates the old token and only the latest can claim',()=>{
  const e=event(),old=createCohostInvite(e,1).token,latest=createCohostInvite(e,1).token;
  assert.notEqual(latest,old);
  assert.throws(()=>claimCohost(e,old,user()),/unavailable/);assert.equal(e.cohost,undefined);
  assert.equal(e.cohostInvite.token,latest);claimCohost(e,latest,user());assert.equal(e.cohost.id,2);
  assert.throws(()=>createCohostInvite(e,1),/Revoke/);
});

test('only the owner can create, rotate or revoke co-host access',()=>{
  const e=event(),token=createCohostInvite(e,1).token;
  for(const actor of [2,0,-1,'1',NaN,undefined]){
    assert.throws(()=>createCohostInvite(e,actor),/Only the event owner/);
    assert.throws(()=>revokeCohost(e,actor),/Only the event owner/);
  }
  claimCohost(e,token,user());const identity=e.cohost;
  assert.throws(()=>createCohostInvite(e,2),/Only the event owner/);
  assert.throws(()=>revokeCohost(e,2),/Only the event owner/);assert.equal(e.cohost,identity);
  assert.equal(isManager(e,'1'),false);assert.equal(isManager(null,1),false);
});

test('revocation immediately removes management and permits a new invitation without reviving an old link',()=>{
  const e=event(),old=createCohostInvite(e,1).token,identity=claimCohost(e,old,user());
  assert.equal(revokeCohost(e,1),identity);assert.equal(e.cohost,null);assert.equal(e.cohostInvite,null);assert.equal(isManager(e,2),false);
  const latest=createCohostInvite(e,1).token;assert.notEqual(latest,old);
  assert.throws(()=>claimCohost(e,old,user()),/unavailable/);claimCohost(e,latest,user(3));assert.equal(e.cohost.id,3);
  assert.equal(isManager(e,2),false);assert.equal(isManager(e,3),true);
});

test('revocation clears an unclaimed invitation as well as an active role',()=>{
  const e=event(),token=createCohostInvite(e,1).token;
  assert.equal(revokeCohost(e,1),null);assert.equal(e.cohostInvite,null);
  assert.throws(()=>claimCohost(e,token,user()),/unavailable/);
  assert.equal(revokeCohost(e,1),null);
});

test('owners, bots and invalid Telegram identities cannot consume a valid invitation',()=>{
  const e=event(),token=createCohostInvite(e,1).token;
  for(const invalid of [user(1),user(0),user(-2),user('2'),user(Number.MAX_SAFE_INTEGER+1),{...user(),is_bot:true},null])assert.throws(()=>claimCohost(e,token,invalid));
  for(const invalid of [
    {...user(),first_name:''},{...user(),first_name:'  '},{...user(),first_name:123},{...user(),last_name:123},
    {...user(),first_name:'X'.repeat(161)},{...user(),username:'@alex'},{...user(),username:'bad handle'},{...user(),username:'X'.repeat(33)}
  ])assert.throws(()=>claimCohost(e,token,invalid),/Telegram profile/);
  assert.equal(e.cohostInvite.token,token);assert.equal(e.cohost,undefined);
  claimCohost(e,token,{id:2,first_name:'  Alex   Smith  '});assert.equal(e.cohost.name,'Alex Smith');assert.equal(e.cohost.username,'');
});

test('invalid, wrong-event and tampered tokens leave the invitation untouched',()=>{
  const e=event(),token=createCohostInvite(e,1).token,other=createCohostInvite(event(),1).token;
  for(const value of [undefined,null,'','x'.repeat(32),'0'.repeat(31),'f'.repeat(33),'A'.repeat(32),other])assert.throws(()=>claimCohost(e,value,user()),/unavailable/);
  assert.equal(e.cohostInvite.token,token);assert.equal(e.cohost,undefined);
  assert.equal(cohostLink(e,'bad/handle'),null);assert.equal(cohostLink({...e,id:'not-an-id'},'ExampleBot'),null);
});

test('cancelled and finished events cannot create or claim invitations but owner revocation still works',()=>{
  for(const fields of [{cancelled:true},{endsAt:'2000-01-01T00:00:00Z'}]){
    const e=event(),token=createCohostInvite(e,1).token;Object.assign(e,fields);
    assert.throws(()=>createCohostInvite(e,1),/cancelled or finished/);assert.throws(()=>claimCohost(e,token,user()),/unavailable/);
    assert.equal(cohostLink(e,'ExampleBot'),null);assert.equal(revokeCohost(e,1),null);assert.equal(e.cohostInvite,null);
  }
});

test('claiming or revoking a co-host role preserves existing RSVP, payment, ticket and guest data',()=>{
  const e=event();e.guests[2]={name:'Paid guest name',status:'yes',participants:4,payment:{status:'paid',amount:100},ticket:'ABCDEF012345'};
  const original=structuredClone(e.guests),token=createCohostInvite(e,1).token;
  claimCohost(e,token,user());assert.deepEqual(e.guests,original);revokeCohost(e,1);assert.deepEqual(e.guests,original);
});

test('central event permissions grant a co-host guest tools and private location then revoke them immediately',()=>{
  const e=event();Object.assign(e,{permissions:{},hideLocation:true,requireApproval:true});
  e.guests[2]={name:'Guest',status:'yes',approval:'pending'};
  for(const key of ['guestList','uploadMedia','viewMedia']){assert.equal(can(e,1,key),true);assert.equal(can(e,2,key),false);}
  assert.equal(canSeeLocation(e,1),true);assert.equal(canSeeLocation(e,2),false);
  claimCohost(e,createCohostInvite(e,1).token,user());
  for(const key of ['guestList','uploadMedia','viewMedia']){assert.equal(can(e,2,key),true);assert.equal(can(e,3,key),false);}
  assert.equal(canSeeLocation(e,2),true);assert.equal(canSeeLocation(e,3),false);
  revokeCohost(e,1);
  for(const key of ['guestList','uploadMedia','viewMedia'])assert.equal(can(e,2,key),false);
  assert.equal(canSeeLocation(e,2),false);
});

test('co-host roles retain paid guest attendance and location access earned independently of their role',()=>{
  const e=event();Object.assign(e,{permissions:{},hideLocation:true,requireApproval:true,starPrice:25,askParticipantCount:true});
  e.guests[2]={name:'Paid guest',status:'yes',approval:'approved',participants:4,payment:{status:'paid'},ticket:'ABCDEF012345'};
  const before=responseCounts(e);assert.equal(before.participants,4);
  claimCohost(e,createCohostInvite(e,1).token,user());assert.deepEqual(responseCounts(e),before);assert.equal(canSeeLocation(e,2),true);
  revokeCohost(e,1);assert.deepEqual(responseCounts(e),before);assert.equal(canSeeLocation(e,2),true);
  assert.equal(e.guests[2].ticket,'ABCDEF012345');assert.equal(can(e,2,'guestList'),false);
});

test('co-host state versions track pending link rotation, claimed identity and revoked access',()=>{
  const e=event();assert.equal(cohostVersion(e),'none');assert.equal(cohostVersion(null),'none');
  const first=createCohostInvite(e,1).token;assert.equal(cohostVersion(e),first);
  const latest=createCohostInvite(e,1).token;assert.equal(cohostVersion(e),latest);assert.notEqual(cohostVersion(e),first);
  const identity=claimCohost(e,latest,user());assert.equal(cohostVersion(e),`${identity.id}:${identity.joinedAt}`);assert.notEqual(cohostVersion(e),latest);
  revokeCohost(e,1);assert.equal(cohostVersion(e),'none');
});
