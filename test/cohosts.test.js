import test from 'node:test';
import assert from 'node:assert/strict';
import {claimCohost,cohostEntries,cohostGuard,cohostIds,cohostLink,cohostVersion,createCohostInvite,isManager,revokeCohost} from '../src/cohosts.js';
import {can,canSeeLocation,responseCounts} from '../src/permissions.js';
import {publicEvent} from '../src/mini-api.js';

const event=()=>({id:'0123456789abcdef',owner:1,guests:{},cancelled:false});
const user=(id=2)=>({id,first_name:'Alex',last_name:'Smith',username:'alex_smith'});

test('owner adds labelled one-use links with Telegram-compatible payloads',()=>{
  const e=event(),first=createCohostInvite(e,1,'  Door team  '),second=createCohostInvite(e,1,'Media');
  assert.equal(first.label,'Door team');assert.equal(first.status,'pending');assert.equal(first.cohost,null);
  assert.match(first.id,/^[a-f0-9]{16}$/);assert.match(first.token,/^[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));assert.notEqual(first.token,second.token);
  assert.equal(e.cohostLinks.length,2);assert.equal(e.cohostInvite.token,second.token);
  for(const entry of [first,second]){
    const url=new URL(cohostLink(e,'ExampleBot',entry.id)),payload=url.searchParams.get('start');
    assert.equal(url.origin,'https://t.me');assert.equal(url.pathname,'/ExampleBot');
    assert.equal(payload,`c_${e.id}_${entry.token}`);assert.ok(payload.length<=64);
  }
  assert.equal(cohostLink(e,'ExampleBot'),cohostLink(e,'ExampleBot',second.id));
  assert.equal(isManager(e,1),true);assert.equal(isManager(e,2),false);
});

test('each link records its claimant while other links and active co-hosts remain usable',()=>{
  const e=event(),first=createCohostInvite(e,1,'Door'),second=createCohostInvite(e,1,'Media');
  const alex=claimCohost(e,first.token,user()),sam=claimCohost(e,second.token,{id:3,first_name:'Sam'});
  assert.deepEqual({...alex,joinedAt:null},{id:2,name:'Alex Smith',username:'alex_smith',joinedAt:null});
  assert.ok(Number.isFinite(Date.parse(alex.joinedAt)));assert.equal(sam.username,'');
  assert.deepEqual(cohostIds(e),[2,3]);assert.equal(e.cohost.id,2);assert.equal(e.cohostInvite,null);
  assert.equal(cohostLink(e,'ExampleBot',first.id),null);assert.equal(cohostLink(e,'ExampleBot'),null);
  for(const id of [1,2,3])assert.equal(isManager(e,id),true);
  assert.equal(isManager(e,4),false);
  assert.throws(()=>claimCohost(e,first.token,user(4)),/unavailable/);
  assert.throws(()=>claimCohost(e,second.token,user(4)),/unavailable/);
  const third=createCohostInvite(e,1,'Support');assert.equal(e.cohostLinks.length,3);assert.equal(third.status,'pending');
});

test('an active co-host cannot consume another invitation or replace their recorded identity',()=>{
  const e=event(),first=createCohostInvite(e,1),second=createCohostInvite(e,1);
  claimCohost(e,first.token,user());const before=structuredClone(e);
  assert.throws(()=>claimCohost(e,second.token,{...user(),first_name:'Replacement'}),/already a co-host/);
  assert.deepEqual(e,before);assert.equal(cohostEntries(e)[1].status,'pending');
  claimCohost(e,second.token,user(3));assert.deepEqual(cohostIds(e),[2,3]);
});

test('only the owner creates or revokes entries and each revocation requires a valid entry ID',()=>{
  const e=event(),entry=createCohostInvite(e,1);claimCohost(e,entry.token,user());
  for(const actor of [2,0,-1,'1',NaN,undefined]){
    assert.throws(()=>createCohostInvite(e,actor),/Only the event owner/);
    assert.throws(()=>revokeCohost(e,actor,entry.id),/Only the event owner/);
  }
  const before=structuredClone(e);
  for(const id of [undefined,null,'',entry.token,'f'.repeat(16)])assert.throws(()=>revokeCohost(e,1,id));
  assert.deepEqual(e,before);assert.equal(isManager(e,'1'),false);assert.equal(isManager(null,1),false);
});

test('revoking one active entry removes only that co-host and retains its claimant history',()=>{
  const e=event(),first=createCohostInvite(e,1,'Door'),second=createCohostInvite(e,1,'Media'),pending=createCohostInvite(e,1,'Support');
  const alex=claimCohost(e,first.token,user());claimCohost(e,second.token,user(3));
  const otherGuard=cohostGuard(e,second.id),pendingUrl=cohostLink(e,'ExampleBot',pending.id);
  assert.deepEqual(revokeCohost(e,1,first.id),alex);
  assert.equal(isManager(e,2),false);assert.equal(isManager(e,3),true);assert.equal(e.cohost.id,3);
  const revoked=cohostEntries(e).find(entry=>entry.id===first.id);
  assert.equal(revoked.status,'revoked');assert.equal(revoked.cohost.id,2);assert.ok(Number.isFinite(Date.parse(revoked.revokedAt)));
  assert.equal(cohostGuard(e,first.id),null);assert.equal(cohostGuard(e,second.id),otherGuard);
  assert.equal(cohostLink(e,'ExampleBot',pending.id),pendingUrl);
  assert.throws(()=>claimCohost(e,first.token,user(4)),/unavailable/);
  assert.throws(()=>revokeCohost(e,1,first.id),/no longer available/);
  claimCohost(e,pending.token,user());assert.equal(isManager(e,2),true);
});

test('revoking one pending link does not invalidate a separate pending or active entry',()=>{
  const e=event(),first=createCohostInvite(e,1),second=createCohostInvite(e,1),third=createCohostInvite(e,1);
  claimCohost(e,first.token,user());const guard=cohostGuard(e,first.id);
  assert.equal(revokeCohost(e,1,second.id),null);assert.equal(isManager(e,2),true);assert.equal(cohostGuard(e,first.id),guard);
  assert.throws(()=>claimCohost(e,second.token,user(3)),/unavailable/);
  claimCohost(e,third.token,user(3));assert.deepEqual(cohostIds(e),[2,3]);
});

test('labels are optional, limited to 80 characters and validated before changing legacy state',()=>{
  const e=event();e.cohostInvite={token:'a'.repeat(32),createdAt:'2026-10-01T00:00:00Z'};
  const before=structuredClone(e);
  for(const label of [null,123,{},'x'.repeat(81)])assert.throws(()=>createCohostInvite(e,1,label),/at most 80/);
  assert.deepEqual(e,before);assert.equal(createCohostInvite(e,1,'').label,'');
  assert.equal(createCohostInvite(e,1,'x'.repeat(80)).label.length,80);
});

test('owners, bots and invalid Telegram identities leave a valid pending invitation untouched',()=>{
  const e=event(),entry=createCohostInvite(e,1),before=structuredClone(e);
  for(const invalid of [user(1),user(0),user(-2),user('2'),user(Number.MAX_SAFE_INTEGER+1),{...user(),is_bot:true},null])assert.throws(()=>claimCohost(e,entry.token,invalid));
  for(const invalid of [
    {...user(),first_name:''},{...user(),first_name:'  '},{...user(),first_name:123},{...user(),last_name:123},
    {...user(),first_name:'X'.repeat(161)},{...user(),username:'@alex'},{...user(),username:'bad handle'},{...user(),username:'X'.repeat(33)}
  ])assert.throws(()=>claimCohost(e,entry.token,invalid),/Telegram profile/);
  assert.deepEqual(e,before);claimCohost(e,entry.token,{id:2,first_name:'  Alex   Smith  '});assert.equal(e.cohost.name,'Alex Smith');
});

test('invalid, wrong-event and tampered tokens do not migrate or consume pending legacy data',()=>{
  const e=event();e.cohostInvite={token:'a'.repeat(32),createdAt:'2026-10-01T00:00:00Z'};
  const before=structuredClone(e),other=createCohostInvite(event(),1).token;
  for(const value of [undefined,null,'','x'.repeat(32),'0'.repeat(31),'f'.repeat(33),'A'.repeat(32),other])assert.throws(()=>claimCohost(e,value,user()),/unavailable/);
  assert.deepEqual(e,before);assert.equal(cohostLink(e,'bad/handle'),null);assert.equal(cohostLink({...e,id:'not-an-id'},'ExampleBot'),null);
});

test('cancelled and finished events block new links and claims but allow targeted revocation',()=>{
  for(const fields of [{cancelled:true},{endsAt:'2000-01-01T00:00:00Z'}]){
    const e=event(),entry=createCohostInvite(e,1);Object.assign(e,fields);
    assert.throws(()=>createCohostInvite(e,1),/cancelled or finished/);assert.throws(()=>claimCohost(e,entry.token,user()),/unavailable/);
    assert.equal(cohostLink(e,'ExampleBot',entry.id),null);assert.equal(revokeCohost(e,1,entry.id),null);assert.equal(e.cohostInvite,null);
  }
});

test('legacy active roles and pending links have stable immutable adapters and migrate without losing access',()=>{
  const e=event();e.cohost={id:2,name:'Existing host',username:'existing_host',joinedAt:'2026-10-01T00:00:00Z'};e.cohostInvite={token:'a'.repeat(32),createdAt:'2026-10-02T00:00:00Z'};
  e.guests[2]={name:'Paid guest',status:'yes',participants:4,payment:{status:'paid'},ticket:'ABCDEF012345'};
  const before=structuredClone(e),entries=cohostEntries(e),version=cohostVersion(e),legacyUrl=cohostLink(e,'ExampleBot');
  assert.deepEqual(e,before);assert.deepEqual(cohostEntries(e),entries);assert.equal(isManager(e,2),true);
  assert.throws(()=>entries.push({}),TypeError);assert.throws(()=>{entries[0].cohost.name='Changed';},TypeError);
  createCohostInvite(e,1,'New entry');assert.equal(e.cohostLinks.length,3);assert.notEqual(cohostVersion(e),version);
  assert.equal(cohostLink(e,'ExampleBot',entries[1].id),legacyUrl);assert.deepEqual(e.guests,before.guests);
  claimCohost(e,before.cohostInvite.token,user(3));assert.deepEqual(cohostIds(e),[2,3]);
  revokeCohost(e,1,entries[0].id);assert.equal(isManager(e,2),false);assert.equal(isManager(e,3),true);assert.deepEqual(e.guests,before.guests);
});

test('canonical entries prevent stale legacy aliases from reviving revoked permissions',()=>{
  const e=event();e.cohost={id:2,name:'Old host',joinedAt:'2026-10-01T00:00:00Z'};e.cohostInvite={token:'a'.repeat(32)};e.cohostLinks=[];
  assert.deepEqual(cohostEntries(e),[]);assert.equal(isManager(e,2),false);assert.equal(cohostLink(e,'ExampleBot'),null);
  assert.throws(()=>claimCohost(e,'a'.repeat(32),user(3)),/unavailable/);
});

test('central permissions grant both co-hosts private tools and revoke each independently',()=>{
  const e=event();Object.assign(e,{permissions:{},hideLocation:true,requireApproval:true});e.guests[2]={name:'Guest',status:'yes',approval:'pending'};
  const first=createCohostInvite(e,1),second=createCohostInvite(e,1);claimCohost(e,first.token,user());claimCohost(e,second.token,user(3));
  for(const id of [2,3]){for(const key of ['guestList','uploadMedia','viewMedia'])assert.equal(can(e,id,key),true);assert.equal(canSeeLocation(e,id),true);}
  revokeCohost(e,1,first.id);
  for(const key of ['guestList','uploadMedia','viewMedia']){assert.equal(can(e,2,key),false);assert.equal(can(e,3,key),true);}
  assert.equal(canSeeLocation(e,2),false);assert.equal(canSeeLocation(e,3),true);
});

test('co-host changes retain independently earned paid guest attendance and tickets',()=>{
  const e=event();Object.assign(e,{permissions:{},hideLocation:true,requireApproval:true,starPrice:25,askParticipantCount:true});
  e.guests[2]={name:'Paid guest',status:'yes',approval:'approved',participants:4,payment:{status:'paid'},ticket:'ABCDEF012345'};
  const before=structuredClone(e.guests),counts=responseCounts(e),entry=createCohostInvite(e,1);claimCohost(e,entry.token,user());revokeCohost(e,1,entry.id);
  assert.deepEqual(e.guests,before);assert.deepEqual(responseCounts(e),counts);assert.equal(canSeeLocation(e,2),true);assert.equal(can(e,2,'guestList'),false);
});

test('global versions change for each mutation while entry guards isolate unrelated links and stale claims',()=>{
  const e=event(),empty=cohostVersion(e);assert.match(empty,/^[a-f0-9]{16}$/);assert.match(cohostVersion(null),/^[a-f0-9]{16}$/);
  const first=createCohostInvite(e,1),firstVersion=cohostVersion(e),pendingGuard=cohostGuard(e,first.id);assert.match(pendingGuard,/^[a-f0-9]{12}$/);assert.notEqual(firstVersion,empty);
  const second=createCohostInvite(e,1);assert.notEqual(cohostVersion(e),firstVersion);assert.equal(cohostGuard(e,first.id),pendingGuard);
  const secondGuard=cohostGuard(e,second.id);claimCohost(e,first.token,user());assert.notEqual(cohostGuard(e,first.id),pendingGuard);assert.equal(cohostGuard(e,second.id),secondGuard);
  const activeVersion=cohostVersion(e);revokeCohost(e,1,first.id);assert.notEqual(cohostVersion(e),activeVersion);assert.equal(cohostGuard(e,first.id),null);assert.equal(cohostGuard(e,'f'.repeat(16)),null);
});

test('only owners receive tagged link history and pending URLs; managers receive active identities',()=>{
  const e=event(),active=createCohostInvite(e,1,'Door'),pending=createCohostInvite(e,1,'Media');claimCohost(e,active.token,user());
  const owner=publicEvent(e,1,'ExampleBot'),manager=publicEvent(e,2,'ExampleBot'),guest=publicEvent(e,3,'ExampleBot');
  assert.equal(owner.cohostLinks.length,2);assert.equal(owner.cohostLinks[0].url,null);assert.equal(owner.cohostLinks[1].label,'Media');assert.equal(owner.cohostLinks[1].url,cohostLink(e,'ExampleBot',pending.id));
  assert.equal(owner.cohostLinks[0].cohost.username,'alex_smith');assert.equal(owner.cohostLinks[0].cohost.id,2);assert.equal(owner.cohostLinks[0].token,undefined);
  assert.equal(manager.cohostLinks,undefined);assert.equal(manager.cohostVersion,undefined);assert.equal(manager.cohostInviteUrl,undefined);assert.deepEqual(manager.cohosts.map(host=>host.id),[2]);
  assert.equal(guest.cohosts,undefined);assert.equal(guest.cohost,undefined);assert.equal(guest.cohostLinks,undefined);
  for(const output of [manager,guest])for(const token of [active.token,pending.token])assert.equal(JSON.stringify(output).includes(token),false);
  revokeCohost(e,1,pending.id);const revoked=publicEvent(e,1,'ExampleBot').cohostLinks[1];assert.equal(revoked.status,'revoked');assert.equal(revoked.url,null);
});
