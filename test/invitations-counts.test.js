import test from 'node:test';
import assert from 'node:assert/strict';
import {claimInvitation,invitationParticipants,invitationParticipantMode,invitationSettings} from '../src/invitations.js';
import {asksPhone,participantCount,responseCounts} from '../src/permissions.js';

function event(guestNames='Alex = 3\nSam') {
  return {id:'0123456789abcdef',owner:1,guests:{},...invitationSettings({invitationMode:'named',guestNames})};
}

test('named invitation attendee presets keep the display name and apply without a participant question',()=>{
  const e=event(),[alex,sam]=Object.keys(e.invitees);
  assert.equal(e.invitees[alex].name,'Alex');assert.equal(e.invitees[alex].participants,3);
  assert.equal(e.invitees[sam].participants,undefined);
  const guest=claimInvitation(e,alex,2);guest.status='yes';
  assert.equal(guest.name,'Alex');assert.equal(guest.participants,3);
  assert.equal(invitationParticipants(e,guest),3);
  assert.equal(participantCount(e,guest),3);
  assert.equal(responseCounts(e).participants,3);
  const other=claimInvitation(e,sam,3);
  assert.equal(invitationParticipants(e,other),null);assert.equal(participantCount(e,other),1);
  e.askParticipantCount=true;other.participants=5;
  assert.equal(participantCount(e,other),5);
  guest.participants=8;assert.equal(participantCount(e,guest),8);
});

test('an explicit one-person invitation remains a preset and ticket bookings do not inherit named presets',()=>{
  const e=event('Alex = 1'),token=Object.keys(e.invitees)[0],guest=claimInvitation(e,token,2);
  assert.equal(invitationParticipants(e,guest),1);
  assert.equal(invitationParticipants({...e,invitationMode:'tickets'},guest),null);
  assert.equal(invitationParticipants(e,{participants:3}),null);
});

test('editing unclaimed invitation attendee counts preserves their links and can clear a preset',()=>{
  const e=event(),[token]=Object.keys(e.invitees);
  const update=invitationSettings({guestNames:'Alex = 4\nSam'},e);
  assert.deepEqual(Object.keys(update.invitees),Object.keys(e.invitees));
  assert.equal(update.invitees[token].participants,4);assert.equal(e.invitees[token].participants,3);
  Object.assign(e,update);
  const cleared=invitationSettings({guestNames:'Alex\nSam'},e);
  assert.equal(cleared.invitees[token].participants,undefined);
});

test('claimed invitation presets cannot be changed, removed or added after the guest opens their link',()=>{
  const e=event(),[token]=Object.keys(e.invitees);claimInvitation(e,token,2);
  const unchanged=invitationSettings({guestNames:'Alex = 3\nSam'},e);
  assert.equal(unchanged.invitees[token],e.invitees[token]);
  for(const guestNames of ['Alex = 4\nSam','Alex\nSam','Sam'])assert.throws(()=>invitationSettings({guestNames},e),/claimed invitation/);
  const plain=event('Alex'),plainToken=Object.keys(plain.invitees)[0];claimInvitation(plain,plainToken,2);
  assert.throws(()=>invitationSettings({guestNames:'Alex = 1'},plain),/claimed invitation/);
});

test('attendee suffixes validate their bounds and duplicate bare names',()=>{
  for(const guestNames of ['Alex = 0','Alex = 11','Alex = -1','Alex = 1.5','Alex = many','Alex =',' = 2','Alex = 1 = 2'])assert.throws(()=>invitationSettings({invitationMode:'named',guestNames}),/Name = 1–10/);
  assert.throws(()=>invitationSettings({invitationMode:'named',guestNames:'Alex = 2\nAlex = 3'}),/unique guest names/);
  const e=event('  Alex Smith  =  10  ');
  assert.equal(Object.values(e.invitees)[0].name,'Alex Smith');assert.equal(Object.values(e.invitees)[0].participants,10);
});

test('phone collection requires an explicit organiser opt-in for every invitation mode',()=>{
  for(const invitationMode of [undefined,'legacy','named','tickets']){
    assert.equal(asksPhone({invitationMode}),false);
    assert.equal(asksPhone({invitationMode,askPhone:false}),false);
    assert.equal(asksPhone({invitationMode,askPhone:true}),true);
  }
});

test('attendee syntax distinguishes always ask, confirm proposal, editable preset and event defaults',()=>{
  const e=event('Alex = ?\nBea = 2!\nChris = 4\nDana'),tokens=Object.keys(e.invitees);
  const invites=Object.values(e.invitees);
  assert.deepEqual(invites.map(g=>[g.name,g.participantMode,g.participants]),[
    ['Alex','ask',undefined],['Bea','confirm',2],['Chris',undefined,4],['Dana',undefined,undefined]
  ]);
  const guests=tokens.map((token,index)=>claimInvitation(e,token,index+2));
  assert.deepEqual(guests.map(g=>invitationParticipantMode(e,g)),['ask','confirm','preset','default']);
  assert.deepEqual(guests.map(g=>invitationParticipants(e,g)),[null,2,4,null]);
  assert.deepEqual(guests.map(g=>g.participants),[undefined,2,4,undefined]);
  assert.deepEqual(guests.map(g=>participantCount(e,g)),[1,2,4,1]);
});

test('attendee syntax supports whitespace and rejects malformed asks, confirmations and unsafe numbers',()=>{
  const e=event('  Alex Smith  =  ?  \n  Bea   =  10  !  ');
  assert.deepEqual(Object.values(e.invitees).map(g=>[g.name,g.participantMode,g.participants]),[
    ['Alex Smith','ask',undefined],['Bea','confirm',10]
  ]);
  for(const guestNames of ['Alex = 0!','Alex = 11!','Alex = 1.5!','Alex = !','Alex = 2!!','Alex = ?!','Alex = ??','Alex = ?2','Alex = 2?','Alex = 9007199254740992','Alex = ? = 2',' = ?'])assert.throws(()=>invitationSettings({invitationMode:'named',guestNames}),/attendee choices/);
  for(const guestNames of ['Alex = ?\nAlex = 2!','Alex\nAlex = ?'])assert.throws(()=>invitationSettings({invitationMode:'named',guestNames}),/unique guest names/);
});

test('unclaimed invitations retain tokens while changing mode and clear obsolete fields',()=>{
  const e=event('Alex = 3'),token=Object.keys(e.invitees)[0];
  for(const [guestNames,participantMode,participants] of [
    ['Alex = ?','ask',undefined],['Alex = 2!','confirm',2],['Alex = 4',undefined,4],['Alex',undefined,undefined]
  ]){
    Object.assign(e,invitationSettings({guestNames},e));
    assert.deepEqual(Object.keys(e.invitees),[token]);
    assert.equal(e.invitees[token].participantMode,participantMode);assert.equal(e.invitees[token].participants,participants);
  }
});

test('claimed invitations lock both proposed count and mode while unchanged settings preserve references',()=>{
  const variants=['Alex','Alex = ?','Alex = 2!','Alex = 2','Alex = 3'];
  for(const guestNames of variants){
    const e=event(guestNames),token=Object.keys(e.invitees)[0];claimInvitation(e,token,2);
    const unchanged=invitationSettings({guestNames},e);
    assert.equal(unchanged.invitees[token],e.invitees[token]);
    for(const changed of variants.filter(v=>v!==guestNames))assert.throws(()=>invitationSettings({guestNames:changed},e),/claimed invitation/);
  }
});

test('named invite selections override the proposal even when the event group question is off',()=>{
  for(const guestNames of ['Alex = ?','Alex = 2!','Alex = 2']){
    const e=event(guestNames),token=Object.keys(e.invitees)[0],guest=claimInvitation(e,token,2);
    guest.participants=6;guest.status='yes';
    assert.equal(participantCount(e,guest),6);assert.equal(responseCounts(e).participants,6);
    e.requireApproval=true;guest.approval='pending';
    assert.equal(responseCounts(e).participants,0);assert.equal(responseCounts(e).pendingParticipants,6);
    e.askParticipantCount=true;assert.equal(participantCount(e,guest),6);
  }
});

test('invalid selected named counts fall back to a safe organiser proposal or one attendee',()=>{
  for(const guestNames of ['Alex = ?','Alex = 2!','Alex = 2']){
    const e=event(guestNames),token=Object.keys(e.invitees)[0],guest=claimInvitation(e,token,2),fallback=guestNames==='Alex = ?' ? 1 : 2;
    for(const participants of [undefined,null,0,11,1.5,-1,'3',NaN,Infinity]){
      guest.participants=participants;assert.equal(participantCount(e,guest),fallback);
    }
    guest.participants=10;assert.equal(participantCount(e,guest),10);
  }
});

test('reopening a claimed invitation preserves a valid selected count across every explicit mode',()=>{
  for(const guestNames of ['Alex = ?','Alex = 2!','Alex = 2']){
    const e=event(guestNames),token=Object.keys(e.invitees)[0],guest=claimInvitation(e,token,2);
    guest.participants=7;guest.status='yes';guest.approval='approved';
    assert.equal(claimInvitation(e,token,2),guest);
    assert.equal(guest.participants,7);assert.equal(guest.status,'yes');assert.equal(guest.approval,'approved');
    assert.throws(()=>claimInvitation(e,token,3),/another Telegram account/);
  }
});

test('old plain presets remain editable by guests while bare and non-named invitation compatibility remains unchanged',()=>{
  const e=event('Alex = 2'),token=Object.keys(e.invitees)[0],guest=claimInvitation(e,token,2);
  assert.equal(e.invitees[token].participantMode,undefined);assert.equal(invitationParticipantMode(e,guest),'preset');
  guest.participants=4;claimInvitation(e,token,2);assert.equal(participantCount(e,guest),4);
  const plain=event('Alex'),plainToken=Object.keys(plain.invitees)[0],plainGuest=claimInvitation(plain,plainToken,2);
  plainGuest.participants=4;assert.equal(invitationParticipantMode(plain,plainGuest),'default');assert.equal(participantCount(plain,plainGuest),1);
  plain.askParticipantCount=true;assert.equal(participantCount(plain,plainGuest),4);
  for(const invitationMode of ['legacy','tickets',undefined]){
    const other={...e,invitationMode};assert.equal(invitationParticipantMode(other,guest),'default');assert.equal(invitationParticipants(other,guest),null);
    assert.equal(participantCount(other,guest),1);other.askParticipantCount=true;assert.equal(participantCount(other,guest),4);
  }
});
