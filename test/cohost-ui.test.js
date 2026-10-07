import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {setupGallery} from '../public/gallery.js';

const eventFixture=fields=>({id:'0123456789abcdef',title:'Club evening',location:'Club house',description:'Meet the team',isOwner:true,isManager:true,isCoHost:false,cohosts:[],cohostLinks:[],cohost:null,cohostInviteUrl:null,cohostVersion:'0000000000000000',invitationMode:'named',invitees:[{name:'Alex',participants:2,url:'https://t.me/test?start=guest'}],group:'Upcoming events',upcoming:true,startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',localDate:'2099-10-24',localTime:'18:00',permissions:{},qrEnabled:true,uploadLink:'https://t.me/test?start=upload',paymentMethod:'stars',starPrice:100,starPricing:'person',paymentTerms:'Admission for one person.',...fields});
const pendingLink=(id,label)=>({id,label,status:'pending',createdAt:'2026-10-07T00:00:00Z',cohost:null,url:'https://t.me/test?start=cohost_'+id});
const activeLink=(id,label,person)=>({...pendingLink(id,label),status:'active',url:null,cohost:{id:2,name:'Alex',username:'alex',joinedAt:'2026-10-07T00:00:00Z',...person}});

async function harness(initial,{scheduleError,clipboardMode='ok',search=''}={}){
  class El{
    constructor(tag=''){this.tag=tag;this.children=[];this.dataset={};this.value='';this.files=[];this.attributes={};this.listeners={};this.open=false;this.classList={toggle(){},add(){},remove(){}};}
    append(...children){this.children.push(...children);this.firstChild=this.children[0];}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(type,callback){this.listeners[type]=callback;} reset(){} focus(){this.focused=true;} select(){this.selected=true;} scrollIntoView(){this.scrolled=true;} setCustomValidity(value){this.validation=value;} querySelector(){return new El();}
    showModal(){this.open=true;}
    close(){this.open=false;this.onclose?.();}
  }
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new El()]));
  const tabs=[...html.matchAll(/data-tab="([^"]+)"/g)].map(match=>{const el=match[1]==='admin'?ids.get('admin-tab'):new El();el.dataset.tab=match[1];return el;});
  const document={body:new El(),getElementById:id=>ids.get(id),createElement:tag=>new El(tag),addEventListener(){},querySelector:selector=>selector==='.bottom-nav'?new El():tabs.find(el=>selector.includes('"'+el.dataset.tab+'"')),querySelectorAll:selector=>selector==='[data-tab]'?tabs:[]};
  const telegramLinks=[],copied=[],calls=[],errors=[];
  const window={Telegram:{WebApp:{initData:'test-session',ready(){},expand(){},onEvent(){},openTelegramLink:url=>telegramLinks.push(url)}},scrollTo(){},reportAppError:error=>errors.push(error.message)};
  let event=initial,token=0,revision=0;
  const project=value=>({...value,cohosts:(value.cohostLinks || []).filter(link=>link.status==='active').map(link=>link.cohost),cohost:(value.cohostLinks || []).find(link=>link.status==='active')?.cohost || null,cohostInviteUrl:[...(value.cohostLinks || [])].reverse().find(link=>link.status==='pending')?.url || null});
  const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,blob:async()=>new Blob(['image'],{type:'image/jpeg'})});
  const fetcher=async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({path,body});
    if(path==='/api/bootstrap')return response({user:{id:initial.isOwner?1:2,firstName:'User',isSuperAdmin:false},preference:{timezone:'Australia/Sydney'},pricing:{rates:{}},currencyCodes:['AUD'],events:[event]});
    if(path.startsWith('/api/explore?'))return response({events:[]});
    if(path==='/api/branding/icon')return response({error:'Not found'},404);
    if(path==='/api/events/'+event.id)return response({event});
    if(path.endsWith('/cohost/invite') || path.endsWith('/cohost/revoke')){
      if(body.version!==event.cohostVersion)return response({error:'Co-host changed. Review the current co-host list.'},409);
      const links=[...event.cohostLinks];
      if(path.endsWith('/invite'))links.push(pendingLink((++token).toString(16).padStart(16,'0'),body.label));
      else {const index=links.findIndex(link=>link.id===body.linkId);if(index<0)return response({error:'Invitation not found.'},404);links[index]={...links[index],status:'revoked',url:null,revokedAt:'2026-10-07T01:00:00Z'};}
      event=project({...event,cohostLinks:links,cohostVersion:(++revision).toString(16).padStart(16,'0')});
      return response({event});
    }
    if(path==='/api/events'){event={...event,...body};return response({event});}
    if(path.endsWith('/schedule')){if(scheduleError)return response({error:scheduleError},400);event={...event,...body};return response({event});}
    if(path==='/api/preview')return response({startsAt:event.startsAt,timezone:event.timezone});
    return response({});
  };
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace("import { setupGallery } from './gallery.js';",'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const navigator={};
  if(clipboardMode!=='absent')navigator.clipboard={writeText:async text=>{if(clipboardMode==='denied')throw Error('Clipboard denied.');copied.push(text);}};
  await new AsyncFunction('window','document','location','fetch','crypto','navigator','setupGallery',source)(window,document,{search},fetcher,webcrypto,navigator,setupGallery);
  await new Promise(resolve=>setImmediate(resolve));
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  const findButton=(id,label)=>descendants(ids.get(id)).find(node=>node.tag==='button' && node.textContent===label);
  const findEntry=id=>ids.get('cohost-list').children.find(node=>node.dataset.linkId===id);
  return {ids,calls,errors,copied,telegramLinks,findButton,findEntry,descendants,setClipboardMode:value=>{clipboardMode=value;},setEvent:value=>{event=value;},getEvent:()=>event};
}

test('co-host events expose management actions and keep payment fields read-only',async()=>{
  const f=await harness(eventFixture({isOwner:false,isCoHost:true}));
  for(const label of ['Edit event','Guest list','Scan tickets','Guest invitations','🗂 Shared media'])assert.ok(f.findButton('event-list',label),label+' should be available');
  for(const label of ['Co-hosts','Cancel event','Delete event','Payments & refunds'])assert.equal(f.findButton('event-list',label),undefined,label+' should remain owner-only');
  assert.ok(f.descendants(f.ids.get('home-upcoming')).some(node=>node.textContent==='Co-hosting'));
  assert.ok(f.descendants(f.ids.get('event-list')).some(node=>node.textContent==='CO-HOSTING'));
  assert.ok(f.descendants(f.ids.get('event-list')).some(node=>node.tag==='label' && node.textContent==='Event reminder'));
  await f.findButton('event-list','Edit event').onclick();
  assert.equal(f.ids.get('payment-owner-note').hidden,false);
  for(const id of ['stars-enabled','payment-method','stars-price','stars-pricing','payment-terms','display-price','payment-instructions','payment-url'])assert.equal(f.ids.get(id).disabled,true,id+' must be read-only');
  assert.equal(f.ids.get('stars-price').value,100);
  assert.equal(f.ids.get('payment-terms').value,'Admission for one person.');
  f.ids.get('title').value='Co-host update';
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path.endsWith('/schedule'));
  assert.equal(saved.body.title,'Co-host update');
  assert.equal(saved.body.starPrice,100);assert.equal(saved.body.paymentMethod,'stars');assert.equal(saved.body.paymentTerms,'Admission for one person.');
  assert.deepEqual(f.errors,[]);
});

test('owner creates multiple labelled co-host links without replacing earlier links and cancels one exact entry',async()=>{
  const f=await harness(eventFixture());
  await f.findButton('event-list','Co-hosts').onclick();
  assert.equal(f.ids.get('cohost-dialog').open,true);
  assert.equal(f.ids.get('cohost-settings').open,false);
  f.ids.get('cohost-label').value='  Door team  ';
  await f.ids.get('cohost-generate').onclick();
  assert.deepEqual(f.calls.find(call=>call.path.endsWith('/cohost/invite')).body,{version:'0000000000000000',label:'Door team'});
  assert.equal(f.ids.get('cohost-label').value,'');
  await f.findButton('cohost-list','Copy link').onclick();assert.equal(f.copied.at(-1),'https://t.me/test?start=cohost_0000000000000001');
  await f.findButton('cohost-list','Share privately').onclick();assert.equal(new URL(f.telegramLinks.at(-1)).searchParams.get('url'),'https://t.me/test?start=cohost_0000000000000001');
  f.ids.get('cohost-label').value='Registration';
  await f.ids.get('cohost-generate').onclick();
  assert.equal(f.ids.get('confirm-dialog').open,false);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/invite')).at(-1).body.version,'0000000000000001');
  assert.deepEqual(f.getEvent().cohostLinks.map(link=>link.label),['Door team','Registration']);
  assert.equal(f.getEvent().cohostLinks[0].status,'pending');
  const cancel=f.findButton('cohost-list','Cancel invite').onclick();
  assert.equal(f.ids.get('confirm-title').textContent,'Cancel co-host invite?');
  assert.match(f.ids.get('confirm-message').textContent,/Door team/);
  assert.match(f.ids.get('confirm-message').textContent,/Other co-hosts and invitations stay active/);
  f.ids.get('confirm-proceed').onclick();await cancel;
  assert.deepEqual(f.calls.find(call=>call.path.endsWith('/cohost/revoke')).body,{version:'0000000000000002',linkId:'0000000000000001'});
  assert.equal(f.getEvent().cohostLinks[0].status,'revoked');assert.equal(f.getEvent().cohostLinks[1].status,'pending');
  assert.equal(f.descendants(f.findEntry('0000000000000001')).filter(node=>node.tag==='button').length,0);
  assert.equal(f.descendants(f.findEntry('0000000000000002')).find(node=>node.tag==='button').textContent,'Copy link');
  assert.equal(f.ids.get('cohost-status').textContent,'Invite link cancelled.');
});

test('a co-host claimed during cancellation is refreshed and cannot be revoked by a stale confirmation',async()=>{
  const linkId='aaaaaaaaaaaaaaaa',otherId='bbbbbbbbbbbbbbbb';
  const f=await harness(eventFixture({cohostLinks:[pendingLink(linkId,'Door'),activeLink(otherId,'Registration',{id:3,name:'Sam',username:'sam'})],cohostVersion:'1111111111111111'}));
  await f.findButton('event-list','Co-hosts').onclick();
  const cancel=f.findButton('cohost-list','Cancel invite').onclick();
  f.setEvent({...f.getEvent(),cohostLinks:[activeLink(linkId,'Door',{name:'Alex Smith'}),activeLink(otherId,'Registration',{id:3,name:'Sam',username:'sam'})],cohostVersion:'2222222222222222'});
  f.ids.get('confirm-proceed').onclick();await cancel;
  assert.equal(f.getEvent().cohostLinks[0].cohost.name,'Alex Smith');
  assert.ok(f.descendants(f.findEntry(linkId)).some(node=>node.textContent==='Alex Smith · @alex · ID 2'));
  assert.equal(f.getEvent().cohostLinks[0].status,'active');assert.equal(f.getEvent().cohostLinks[1].status,'active');
  assert.match(f.ids.get('cohost-status').textContent,/Review the current co-host/);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,1);
  const revoke=f.findButton('cohost-list','Revoke access').onclick();
  assert.match(f.ids.get('confirm-message').textContent,/Remove Alex Smith/);
  f.ids.get('confirm-proceed').onclick();await revoke;
  assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).at(-1).body,{version:'2222222222222222',linkId});
  assert.equal(f.getEvent().cohostLinks[0].status,'revoked');assert.equal(f.getEvent().cohostLinks[1].status,'active');
  assert.equal(f.getEvent().cohost.name,'Sam');
});

test('claimed co-host without a username shows an explicit fallback and owner payments remain editable',async()=>{
  const f=await harness(eventFixture({cohostLinks:[activeLink('aaaaaaaaaaaaaaaa','Support',{username:null})]}));
  await f.findButton('event-list','Co-hosts').onclick();assert.ok(f.descendants(f.ids.get('cohost-list')).some(node=>node.textContent==='Alex · No Telegram username · ID 2'));
  f.ids.get('cohost-close').onclick();await f.findButton('event-list','Edit event').onclick();
  assert.equal(f.ids.get('payment-owner-note').hidden,true);assert.equal(f.ids.get('stars-price').disabled,false);assert.equal(f.ids.get('payment-terms').disabled,false);
});

test('named edits hide general count and approval controls, retain per-name rules and preserve private locations',async()=>{
  const f=await harness(eventFixture({requireApproval:true,askParticipantCount:true,hideLocation:false,invitees:[{name:'Alex',participants:2,participantMode:'confirm'},{name:'Sam',participantMode:'ask'}]}));
  await f.findButton('event-list','Edit event').onclick();
  for(const id of ['require-approval-option','ask-participant-count-option'])assert.equal(f.ids.get(id).hidden,true);
  for(const id of ['require-approval','ask-participant-count']){assert.equal(f.ids.get(id).checked,false);assert.equal(f.ids.get(id).disabled,true);}
  assert.equal(f.ids.get('hide-location').checked,true);assert.equal(f.ids.get('hide-location').disabled,false);
  assert.equal(f.ids.get('one-time-invite').checked,true);assert.match(f.ids.get('one-time-invite-note').textContent,/Respond later does not lock/);
  assert.equal(f.ids.get('guest-names').value,'Alex = 2!\nSam = ?');
  for(const id of ['extra-details','timing-options','stars-panel','guest-permissions','media-options'])assert.equal(f.ids.get(id).open,false);
  // Even stale UI state cannot re-enable the two general options in the named payload.
  f.ids.get('require-approval').checked=true;f.ids.get('ask-participant-count').checked=true;
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path.endsWith('/schedule')).body;
  assert.equal(saved.requireApproval,false);assert.equal(saved.askParticipantCount,false);assert.equal(saved.hideLocation,true);assert.equal(saved.oneTimeInvite,true);
  assert.equal(saved.guestNames,'Alex = 2!\nSam = ?');assert.equal(saved.starPrice,100);
});

test('new forms default to reusable tickets and one-time named links while respecting an unchecked choice',async()=>{
  const f=await harness(eventFixture());
  f.ids.get('hero-create').onclick();
  assert.equal(f.ids.get('invitation-mode').value,'tickets');assert.equal(f.ids.get('one-time-invite').checked,false);
  assert.equal(f.ids.get('require-approval-option').hidden,false);assert.equal(f.ids.get('ask-participant-count-option').hidden,false);
  f.ids.get('require-approval').checked=true;
  f.ids.get('invitation-mode').value='named';f.ids.get('invitation-mode').onchange();
  assert.equal(f.ids.get('one-time-invite').checked,true);assert.equal(f.ids.get('require-approval').checked,false);assert.equal(f.ids.get('hide-location').checked,true);
  f.ids.get('one-time-invite').checked=false;f.ids.get('one-time-invite').onchange();
  assert.match(f.ids.get('one-time-invite-note').textContent,/More than one guest/);
  f.ids.get('guest-names').value='Alex = ?';f.ids.get('title').value='New event';f.ids.get('location').value='Park';
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path==='/api/events').body;
  assert.equal(saved.oneTimeInvite,false);assert.equal(saved.invitationMode,'named');assert.equal(saved.requireApproval,false);assert.equal(saved.askParticipantCount,false);
  assert.deepEqual(f.errors,[]);
});

test('existing reusable named links and legacy ticket defaults load without being changed',async()=>{
  const named=await harness(eventFixture({oneTimeInvite:false}));
  await named.findButton('event-list','Edit event').onclick();assert.equal(named.ids.get('one-time-invite').checked,false);
  const tickets=await harness(eventFixture({invitationMode:'tickets',requireApproval:true,askParticipantCount:true}));
  await tickets.findButton('event-list','Edit event').onclick();assert.equal(tickets.ids.get('one-time-invite').checked,false);
  assert.equal(tickets.ids.get('require-approval').checked,true);assert.equal(tickets.ids.get('ask-participant-count').checked,true);
  assert.equal(tickets.ids.get('require-approval-option').hidden,false);assert.equal(tickets.ids.get('ask-participant-count-option').hidden,false);
});

test('collapsed settings expand for invalid required fields and payment errors',async()=>{
  const f=await harness(eventFixture(),{scheduleError:'Payment and refund terms is required.'});
  await f.findButton('event-list','Edit event').onclick();
  const payment=f.ids.get('stars-panel');payment.tagName='DETAILS';
  f.ids.get('payment-terms').parentElement=payment;
  f.ids.get('event-form').listeners.invalid({target:f.ids.get('payment-terms')});
  assert.equal(payment.open,true);
  payment.open=false;await f.ids.get('event-form').onsubmit({preventDefault(){}});
  assert.equal(payment.open,true);assert.equal(f.ids.get('form-error').hidden,false);assert.match(f.ids.get('form-error').textContent,/Payment and refund terms/);
});

test('personal invitation rows distinguish an unanswered open link from a locked RSVP and a reusable link',async()=>{
  const f=await harness(eventFixture({oneTimeInvite:true,invitees:[{name:'Alex',status:'later',claimed:false,url:'https://t.me/test?start=alex'},{name:'Sam',status:'yes',claimed:true,url:'https://t.me/test?start=sam'}]}));
  await f.findButton('event-list','Guest invitations').onclick();
  let rows=f.descendants(f.ids.get('invitation-links-list')).filter(node=>node.tag==='p').map(node=>node.textContent).join('\n');
  assert.match(rows,/Awaiting RSVP · One-time link/);assert.match(rows,/Accepted · Locked to one guest/);assert.doesNotMatch(rows,/Not opened/);
  f.setEvent({...f.getEvent(),oneTimeInvite:false});await f.findButton('event-list','Guest invitations').onclick();
  rows=f.descendants(f.ids.get('invitation-links-list')).filter(node=>node.tag==='p').map(node=>node.textContent).join('\n');
  assert.match(rows,/Accepted · Reusable link/);assert.match(f.ids.get('invitation-links-note').textContent,/more than one guest/);
});

test('guest-name buttons copy the fresh full personal invitation and link, preserving each guest and share action',async()=>{
  const f=await harness(eventFixture({paymentMethod:'free',starPrice:0,endsAt:'2099-10-24T10:00:00Z',responseDeadline:'2099-10-23T08:00:00Z',inviteMessage:'Bring a scarf.',invitees:[{name:'Alex',participants:2,url:'https://t.me/test?start=alex'},{name:'Sam',participantMode:'ask',url:'https://t.me/test?start=sam'}]}));
  f.setEvent({...f.getEvent(),title:'Updated club evening'});
  await f.findButton('event-list','Guest invitations').onclick();
  await f.findButton('invitation-links-list','Alex').onclick();
  const alex=f.copied.at(-1);
  assert.match(alex,/^Dear Alex,/);assert.match(alex,/You are invited to Updated club evening on/);assert.match(alex,/Australia\/Sydney/);
  assert.match(alex,/At Club house\./);assert.match(alex,/Host has reserved 2 places/);assert.match(alex,/Bring a scarf\./);
  assert.match(alex,/Finishes:/);assert.match(alex,/\n\nFree\n\n/);assert.match(alex,/Please respond by/);
  assert.match(alex,/Please respond below\.\n\nhttps:\/\/t\.me\/test\?start=alex$/);assert.doesNotMatch(alex,/Dear Sam|start=sam/);
  assert.equal(alex.split('https://t.me/test?start=alex').length,2);
  await f.findButton('invitation-links-list','Sam').onclick();assert.match(f.copied.at(-1),/^Dear Sam,/);assert.match(f.copied.at(-1),/Please choose how many people/);assert.match(f.copied.at(-1),/start=sam$/);
  await f.findButton('invitation-links-list','Share invitation').onclick();
  const shared=new URL(f.telegramLinks.at(-1));assert.equal(shared.searchParams.get('url'),'https://t.me/test?start=alex');assert.equal(shared.searchParams.get('text')+'\n\n'+shared.searchParams.get('url'),alex);
  assert.equal(f.ids.get('invitation-links-status').textContent,'Invitation copied for Sam.');
});

test('owner and co-host copy actions never include acceptance, approval or payment-protected addresses',async()=>{
  for(const owner of [true,false])for(const privacy of [{hideLocation:true},{requireApproval:true},{locationAfterApproval:true},{paymentMethod:'bank'},{paymentMethod:'link'},{paymentMethod:'stars',starPrice:25}]){
    const f=await harness(eventFixture({paymentMethod:'free',starPrice:0,isOwner:owner,isCoHost:!owner,location:'SECRET VENUE',...privacy}));
    await f.findButton('event-list','Guest invitations').onclick();await f.findButton('invitation-links-list','Alex').onclick();
    assert.doesNotMatch(f.copied.at(-1),/SECRET VENUE/);assert.match(f.copied.at(-1),/Location will be available after/);assert.match(f.copied.at(-1),/\n\nhttps:\/\/t\.me\/test\?start=guest$/);
  }
});

test('copied paid invitations retain the configured Stars or manual text price',async()=>{
  for(const [pricing,expected] of [[{paymentMethod:'stars',starPrice:25,starPricing:'person'},'25 Stars per person'],[{paymentMethod:'stars',starPrice:50,starPricing:'group'},'50 Stars per group'],[{paymentMethod:'bank',starPrice:0,displayPrice:'AUD $20 each'},'Paid · AUD $20 each'],[{paymentMethod:'link',starPrice:0,displayPrice:'Members £15 / guests £20'},'Paid · Members £15 / guests £20']]){
    const f=await harness(eventFixture(pricing));await f.findButton('event-list','Guest invitations').onclick();await f.findButton('invitation-links-list','Alex').onclick();assert.ok(f.copied.at(-1).includes(expected));
  }
});

test('denied or unavailable clipboard exposes selectable full text and a denied copy can recover',async()=>{
  for(const clipboardMode of ['denied','absent']){
    const f=await harness(eventFixture({hideLocation:true,inviteMessage:'Bring a scarf.'}),{clipboardMode});
    await f.findButton('event-list','Guest invitations').onclick();
    const copy=f.findButton('invitation-links-list','Alex');await copy.onclick();
    const nodes=f.descendants(f.ids.get('invitation-links-list')),fullText=nodes.find(node=>node.tag==='textarea');
    assert.equal(nodes.find(node=>node.tag==='details').open,true);assert.equal(fullText.readOnly,true);assert.equal(fullText.focused,true);assert.equal(fullText.selected,true);
    assert.match(fullText.value,/^Dear Alex,/);assert.match(fullText.value,/Bring a scarf\./);assert.match(fullText.value,/start=guest$/);assert.doesNotMatch(fullText.value,/Club house/);
    assert.equal(f.copied.length,0);assert.match(f.ids.get('invitation-links-status').textContent,/Could not copy/);assert.doesNotMatch(f.ids.get('invitation-links-status').textContent,/Invitation copied/);assert.equal(copy.disabled,false);
    if(clipboardMode==='denied'){f.setClipboardMode('ok');await copy.onclick();assert.equal(f.copied.at(-1),fullText.value);assert.equal(f.ids.get('invitation-links-status').textContent,'Invitation copied for Alex.');}
  }
});

test('a Telegram guest deep link selects the matching current invitation without auto-copying',async()=>{
  const token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',id='0123456789abcdef';
  const f=await harness(eventFixture({invitees:[{name:'Alex',url:'https://t.me/test?start=i_'+id+'_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},{name:'Sam',url:'https://t.me/test?start=i_'+id+'_'+token}]}),{search:'?invitations='+id+'&guest='+token});
  assert.equal(f.ids.get('invitation-links-dialog').open,true);
  const first=f.ids.get('invitation-links-list').children[0],copy=f.descendants(first).find(node=>node.tag==='button');
  assert.equal(copy.textContent,'Sam');assert.equal(copy.focused,true);assert.equal(copy.scrolled,true);assert.match(first.className,/invitation-selected/);assert.equal(f.copied.length,0);
  await copy.onclick();assert.match(f.copied.at(-1),/^Dear Sam,/);assert.match(f.copied.at(-1),new RegExp(token+'$'));
});

test('unknown guest deep links do not select another guest, and large lists can be searched',async()=>{
  const guests=Array.from({length:12},(_,i)=>({name:'Guest '+i,url:'https://t.me/test?start=i_0123456789abcdef_'+String(i).padStart(32,'0')}));
  const f=await harness(eventFixture({invitees:guests}),{search:'?invitations=0123456789abcdef&guest=unavailable'});
  assert.match(f.ids.get('invitation-links-status').textContent,/unavailable/);assert.equal(f.copied.length,0);assert.equal(f.ids.get('invitation-links-search').hidden,false);
  assert.equal(f.descendants(f.ids.get('invitation-links-list')).filter(node=>node.focused).length,0);
  f.ids.get('invitation-links-search').value='  guest 11  ';f.ids.get('invitation-links-search').oninput();
  assert.equal(f.ids.get('invitation-links-list').children.filter(node=>!node.hidden).length,1);assert.equal(f.ids.get('invitation-links-empty').hidden,true);
  f.ids.get('invitation-links-search').value='Nobody';f.ids.get('invitation-links-search').oninput();assert.equal(f.ids.get('invitation-links-empty').hidden,false);
});

test('invitation links recheck current manager access before exposing personal copy actions',async()=>{
  const f=await harness(eventFixture());f.setEvent({...f.getEvent(),isOwner:false,isManager:false,isCoHost:false,invitees:[]});
  await f.findButton('event-list','Guest invitations').onclick();
  assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(f.ids.get('invitation-links-list').children.length,0);assert.match(f.ids.get('notice').textContent,/Only event managers/);
});
