import test from 'node:test';
import assert from 'node:assert/strict';
import {claimInvitation,invitationParticipants,invitationSettings} from '../src/invitations.js';
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
  guest.participants=8;assert.equal(participantCount(e,guest),3);
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
