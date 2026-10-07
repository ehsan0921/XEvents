import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function dateInZone('),end=source.indexOf('function share(e)',start);
assert.ok(start>=0 && end>start);
const {invitationGuestLine,inviteText}=new Function('selectedZone',source.slice(start,end)+'\nreturn {invitationGuestLine,inviteText};')(()=> 'Europe/London');
const event={title:'Club dinner',location:'Private club address',startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',inviteMessage:'Bring your team scarf.'};

test('editing named guests preserves ask, confirmation, editable preset and default count syntax',()=>{
  assert.equal(invitationGuestLine({name:'Alex',participantMode:'ask'}),'Alex = ?');
  assert.equal(invitationGuestLine({name:'Sam',participants:2,participantMode:'confirm'}),'Sam = 2!');
  assert.equal(invitationGuestLine({name:'Taylor',participants:2}),'Taylor = 2');
  assert.equal(invitationGuestLine({name:'Casey'}),'Casey');
});

test('personal sharing greets the guest, uses event time, states places and preserves the custom message',()=>{
  const text=inviteText(event,{name:'Sam',participants:2,participantMode:'confirm'});
  assert.match(text,/^Dear Sam,/);
  assert.match(text,/You are invited to Club dinner on/);
  assert.match(text,/Australia\/Sydney/);
  assert.doesNotMatch(text,/Europe\/London/);
  assert.match(text,/At Private club address\./);
  assert.match(text,/Host has reserved 2 places for you\./);
  assert.match(text,/Bring your team scarf\./);
  assert.match(text,/Please respond below\.$/);
});

test('count questions appear for explicit ask mode and event-wide group selection without a preset',()=>{
  for(const [settings,guest] of [[event,{name:'Alex',participantMode:'ask'}],[{...event,askParticipantCount:true},{name:'Alex'}]]){
    const text=inviteText(settings,guest);
    assert.match(text,/Please choose how many people will attend\./);
    assert.doesNotMatch(text,/Host has reserved/);
  }
  assert.match(inviteText({...event,askParticipantCount:true},{name:'Alex',participants:2}),/Host has reserved 2 places/);
  assert.match(inviteText(event,{name:'Alex'}),/Host has reserved 1 place for you\./);
});

test('owner sharing never reveals protected locations, including approval and payment gated events',()=>{
  for(const fields of [{hideLocation:true},{requireApproval:true},{locationAfterApproval:true},{starPrice:100},{paymentMethod:'bank'},{paymentMethod:'link'},{paymentMethod:'stars'}]){
    const text=inviteText({...event,...fields,isOwner:true},{name:'Alex',participants:2});
    assert.doesNotMatch(text,/Private club address/);
    const paid=fields.starPrice>0 || ['bank','link','stars'].includes(fields.paymentMethod);
    assert.match(text,paid ? /Location will be available after confirmed payment\./ : fields.requireApproval ? /Location will be available after organiser approval\./ : /Location will be available after your response\./);
    assert.match(text,/Bring your team scarf/);
  }
});

test('paid invitations requiring approval explain both requirements before sharing the location',()=>{
  for(const fields of [{starPrice:100},{paymentMethod:'bank'},{paymentMethod:'link'},{paymentMethod:'stars'}]){
    const text=inviteText({...event,...fields,requireApproval:true,isOwner:true},{name:'Alex',participants:2});
    assert.doesNotMatch(text,/Private club address/);
    assert.match(text,/Location will be available after organiser approval and confirmed payment\./);
  }
});

test('a missing location remains private and legacy event times remain readable',()=>{
  const text=inviteText({title:'Club dinner',when:'Saturday at six',location:null},{name:'Alex'});
  assert.match(text,/You are invited to Club dinner on Saturday at six\./);
  assert.match(text,/Location will be available after your response\./);
  assert.doesNotMatch(text,/undefined|null/);
});
