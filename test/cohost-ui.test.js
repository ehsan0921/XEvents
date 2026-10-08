import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {setupGallery} from '../public/gallery.js';
import {setupEventActions} from '../public/event-actions.js';

const eventFixture=fields=>({id:'0123456789abcdef',title:'Club evening',location:'Club house',description:'Meet the team',isOwner:true,isManager:true,isCoHost:false,cohosts:[],cohostLinks:[],cohost:null,cohostInviteUrl:null,cohostVersion:'0000000000000000',invitationMode:'named',invitees:[{name:'Alex',participants:2,url:'https://t.me/test?start=guest'}],group:'Upcoming events',upcoming:true,startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',localDate:'2099-10-24',localTime:'18:00',permissions:{},qrEnabled:true,uploadLink:'https://t.me/test?start=upload',paymentMethod:'stars',starPrice:100,starPricing:'person',paymentTerms:'Admission for one person.',...fields});
const pendingLink=(id,label)=>({id,label,status:'pending',createdAt:'2026-10-07T00:00:00Z',cohost:null,url:'https://t.me/test?start=cohost_'+id});
const activeLink=(id,label,person)=>({...pendingLink(id,label),status:'active',url:null,cohost:{id:2,name:'Alex',username:'alex',joinedAt:'2026-10-07T00:00:00Z',...person}});

async function harness(initial,{scheduleError,clipboardMode='ok',search='',invitationError,telegramErrors={},telegramClose=true}={}){
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
  const telegramLinks=[],telegramStartupCalls=[],scanCallbacks=[],copied=[],calls=[],errors=[],errorContexts=[];
  const telegramCall=method=>{telegramStartupCalls.push(method);if(telegramErrors[method])throw new Error(telegramErrors[method]);};
  const window={Telegram:{WebApp:{initData:'test-session',ready(){telegramCall('ready');},expand(){telegramCall('expand');},onEvent(){telegramCall('onEvent');},close(){telegramCall('close');},showScanQrPopup:(options,callback)=>scanCallbacks.push(callback),closeScanQrPopup(){},openTelegramLink:url=>telegramLinks.push(url)}},scrollTo(){},reportAppError:(error,context)=>{errors.push(error.message);errorContexts.push(context);}};
  if(!telegramClose)delete window.Telegram.WebApp.close;
  let event=initial,token=0,revision=0,invitationHold,eventReadHold,eventSaveHold,ticketHold;
  const project=value=>({...value,cohosts:(value.cohostLinks || []).filter(link=>link.status==='active').map(link=>link.cohost),cohost:(value.cohostLinks || []).find(link=>link.status==='active')?.cohost || null,cohostInviteUrl:[...(value.cohostLinks || [])].reverse().find(link=>link.status==='pending')?.url || null});
  const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,blob:async()=>new Blob(['image'],{type:'image/jpeg'})});
  const fetcher=async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({path,body});
    if(path==='/api/bootstrap')return response({user:{id:initial.isOwner?1:2,firstName:'User',isSuperAdmin:false},preference:{timezone:'Australia/Sydney'},pricing:{rates:{}},currencyCodes:['AUD'],events:[event]});
    if(path.startsWith('/api/explore?'))return response({events:[]});
    if(path==='/api/branding/icon')return response({error:'Not found'},404);
    if(path==='/api/events/'+event.id){if(eventReadHold){const hold=eventReadHold;eventReadHold=null;await hold;}return response({event});}
    if(path==='/api/events/'+event.id+'/ticket'){if(ticketHold){const hold=ticketHold;ticketHold=null;await hold;}return response({ticket:{title:event.title,name:'Alex',participants:2,code:'FICTIONAL1234',image:null}});}
    if(path.endsWith('/ticket-check'))return response({ticket:{valid:false,reason:'Fictional ticket not found.'}});
    if(/\/invitations\/(add|edit|response|revoke|delete|remove)$/.test(path)){
      if(invitationHold){const hold=invitationHold;invitationHold=null;await hold;}
      if(body.version!==event.invitationsVersion)return response({error:'Invitations changed. Review the current list.'},409);
      if(invitationError)return response({error:invitationError.message},invitationError.status || 400);
      let invitees=[...event.invitees],revokedInvitees=[...(event.revokedInvitees || [])];
      if(path.endsWith('/add'))for(const line of body.guestNames.split('\n').filter(line=>line.trim())){
        const match=line.match(/^\s*(.*?)\s*(?:=\s*(\?|\d+[!*]?))?\s*$/),rule=match[2],guestToken=(++token).toString(16).padStart(32,'0');
        invitees.push({name:match[1],token:guestToken,url:'https://t.me/test?start=i_'+event.id+'_'+guestToken,participants:rule && rule!=='?' ? parseInt(rule,10) : null,participantMode:rule==='?' ? 'ask' : rule?.endsWith('!') ? 'confirm' : rule?.endsWith('*') ? 'fixed' : null,claimed:false,status:null,responses:[],responseCounts:{yes:0,no:0,maybe:0,later:0}});
      }
      else if(path.endsWith('/edit'))invitees=invitees.map(guest=>guest.token===body.token?{...guest,name:body.name,participants:body.participants,participantMode:body.participantMode,history:[...(guest.history || []),{type:'edited',at:'2026-10-08T02:00:00Z',name:body.name,previousName:guest.name,participants:body.participants,actorRole:'organiser'}]}:guest);
      else if(path.endsWith('/response'))invitees=invitees.map(guest=>{
        if(guest.token!==body.token)return guest;
        const replies=guest.responses.map(reply=>reply.id===body.userId?{...reply,status:body.status,participants:body.status==='yes'?body.participants || 1:0,responded:true,respondedAt:'2026-10-08T02:00:00Z'}:reply),previous=guest.responses.find(reply=>reply.id===body.userId),statuses=[...new Set(replies.map(reply=>reply.status))];
        return {...guest,responses:replies,status:statuses.length>1?'mixed':statuses[0],history:[...(guest.history || []),{type:'changed',at:'2026-10-08T02:00:00Z',status:body.status,previousStatus:previous?.status,participants:body.participants,actorRole:'organiser',notify:body.notify}]};
      });
      else if(path.endsWith('/revoke')){
        const guest=invitees.find(guest=>guest.token===body.token);
        if(guest)revokedInvitees.push({...guest,revoked:true,revokedAt:'2026-10-08T02:00:00Z',canNotify:false,history:[...(guest.history || []),{type:'revoked',at:'2026-10-08T02:00:00Z',name:guest.name,notify:body.notify,actorRole:'organiser'}]});
        invitees=invitees.filter(guest=>guest.token!==body.token);
      }else if(path.endsWith('/delete'))revokedInvitees=revokedInvitees.filter(guest=>guest.token!==body.token);
      else invitees=invitees.filter(guest=>guest.token!==body.token);
      event={...event,invitees,revokedInvitees,invitationsVersion:(++revision).toString(16).padStart(16,'0')};
      return response({event,notifyCount:body.notify ? 1 : 0});
    }
    if(path.endsWith('/cohost/invite') || path.endsWith('/cohost/revoke')){
      if(body.version!==event.cohostVersion)return response({error:'Co-host changed. Review the current co-host list.'},409);
      const links=[...event.cohostLinks];
      if(path.endsWith('/invite'))links.push(pendingLink((++token).toString(16).padStart(16,'0'),body.label));
      else {const index=links.findIndex(link=>link.id===body.linkId);if(index<0)return response({error:'Invitation not found.'},404);links[index]={...links[index],status:'revoked',url:null,revokedAt:'2026-10-07T01:00:00Z'};}
      event=project({...event,cohostLinks:links,cohostVersion:(++revision).toString(16).padStart(16,'0')});
      return response({event});
    }
    if(path==='/api/events'){if(eventSaveHold){const hold=eventSaveHold;eventSaveHold=null;await hold;}event={...event,...body};return response({event});}
    if(path.endsWith('/schedule')){if(eventSaveHold){const hold=eventSaveHold;eventSaveHold=null;await hold;}if(scheduleError)return response({error:scheduleError},400);event={...event,...body};return response({event});}
    if(path==='/api/preview')return response({startsAt:event.startsAt,timezone:event.timezone});
    return response({});
  };
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace("import { setupGallery } from './gallery.js';",'').replace("import { setupEventActions } from './event-actions.js';",'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const navigator={};
  if(clipboardMode!=='absent')navigator.clipboard={writeText:async text=>{if(clipboardMode==='denied')throw Error('Clipboard denied.');copied.push(text);}};
  await new AsyncFunction('window','document','location','fetch','crypto','navigator','setupGallery','setupEventActions',source)(window,document,{search},fetcher,webcrypto,navigator,setupGallery,setupEventActions);
  await new Promise(resolve=>setImmediate(resolve));
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  const findButton=(id,label)=>descendants(ids.get(id)).find(node=>node.tag==='button' && node.textContent===label);
  const findEntry=id=>ids.get('cohost-list').children.find(node=>node.dataset.linkId===id);
  return {ids,tabs,calls,errors,errorContexts,copied,telegramLinks,telegramStartupCalls,scanCallbacks,findButton,findEntry,descendants,setClipboardMode:value=>{clipboardMode=value;},setEvent:value=>{event=value;},getEvent:()=>event,setInvitationError:value=>{invitationError=value;},holdNextInvitationMutation:()=>{let release;invitationHold=new Promise(resolve=>{release=resolve;});return release;},holdNextEventRead:()=>{let release;eventReadHold=new Promise(resolve=>{release=resolve;});return release;},holdNextEventSave:()=>{let release;eventSaveHold=new Promise(resolve=>{release=resolve;});return release;},holdNextTicket:()=>{let release;ticketHold=new Promise(resolve=>{release=resolve;});return release;}};
}

for(const method of ['ready','expand','onEvent'])test('a Telegram '+method+' bridge failure keeps Home, My events and Create usable',async()=>{
  const initial=eventFixture(),message='Fictional '+method+' bridge failure';
  const f=await harness(initial,{telegramErrors:{[method]:message}});
  assert.deepEqual(f.errors,[message]);
  assert.deepEqual(f.errorContexts,['Telegram '+method]);
  assert.deepEqual(f.telegramStartupCalls,['ready','expand','onEvent'],'a failed bridge method must not prevent the other startup calls');
  assert.equal(f.calls.filter(call=>call.path==='/api/bootstrap').length,1);
  assert.equal(f.ids.get('home-view').hidden,false);
  assert.ok(f.findButton('home-upcoming','📅 View event'));
  assert.ok(f.findButton('event-list','✏️ Edit event'));
  f.ids.get('hero-create').onclick();
  assert.equal(f.ids.get('create-view').hidden,false);
  assert.equal(f.ids.get('event-form').hidden,false);
  assert.equal(f.ids.get('invitation-mode').value,'tickets');
  assert.ok(f.calls.every(call=>call.body===undefined || call.path==='/api/preview'),'startup and opening Create must not mutate event data');
  assert.deepEqual(f.telegramLinks,[]);
  assert.strictEqual(f.getEvent(),initial);
});

test('the page close button returns every secondary view Home and preserves an unfinished event draft',async()=>{
  const f=await harness(eventFixture());
  f.ids.get('hero-create').onclick();f.ids.get('title').value='Unfinished picnic';f.ids.get('guest-names').value='Alex = 2*';
  assert.equal(f.ids.get('app-close').attributes['aria-label'],'Close this page and return Home');f.ids.get('app-close').onclick();assert.equal(f.ids.get('home-view').hidden,false);assert.equal(f.ids.get('title').value,'Unfinished picnic');assert.equal(f.ids.get('guest-names').value,'Alex = 2*');
  f.tabs.find(tab=>tab.dataset.tab==='create').onclick();assert.equal(f.ids.get('create-view').hidden,false);assert.equal(f.ids.get('title').value,'Unfinished picnic');
  for(const tab of ['events','settings','explore']){f.tabs.find(button=>button.dataset.tab===tab).onclick();assert.equal(f.ids.get(tab+'-view').hidden,false);f.ids.get('app-close').onclick();assert.equal(f.ids.get('home-view').hidden,false);}
  assert.equal(f.calls.filter(call=>call.body && !call.path.startsWith('/api/preview')).length,0);assert.equal(f.telegramStartupCalls.filter(method=>method==='close').length,0);
  assert.equal(f.ids.get('app-close').attributes['aria-label'],'Close App');f.ids.get('app-close').onclick();assert.equal(f.telegramStartupCalls.filter(method=>method==='close').length,1);
});

test('standalone Home close remains usable and both compact pickers close back to Telegram',async()=>{
  const standalone=await harness(eventFixture(),{telegramClose:false});standalone.ids.get('app-close').onclick();assert.equal(standalone.ids.get('home-view').hidden,false);assert.deepEqual(standalone.errors,[]);assert.equal(standalone.telegramStartupCalls.includes('close'),false);
  for(const mode of ['picker','deadline']){const f=await harness(eventFixture(),{search:'?mode='+mode+'&session=fictional'});assert.equal(f.ids.get('create-view').hidden,false);assert.equal(f.ids.get('app-close').attributes['aria-label'],'Close App');f.ids.get('app-close').onclick();assert.equal(f.telegramStartupCalls.filter(method=>method==='close').length,1);assert.equal(f.calls.some(call=>call.path==='/api/picker' || call.path==='/api/draft-deadline'),false);}
});

test('saving an event disables close and competing form navigation until the save settles',async()=>{
  for(const editing of [false,true]){
    const f=await harness(eventFixture({paymentMethod:'free',starPrice:0}));if(editing)await f.findButton('event-list','✏️ Edit event').onclick();else f.ids.get('hero-create').onclick();f.ids.get('title').value='Picnic draft';const release=f.holdNextEventSave(),saving=f.ids.get('event-form').onsubmit({preventDefault(){}});
    assert.equal(f.ids.get('app-close').disabled,true);for(const id of ['cancel-edit','edit-cancel-event','edit-delete-event']){assert.equal(f.ids.get(id).disabled,true);f.ids.get(id).onclick();}assert.equal(f.ids.get('event-end-dialog').open,false);
    f.ids.get('app-close').onclick();f.ids.get('hero-create').onclick();f.tabs.find(tab=>tab.dataset.tab==='events').onclick();assert.equal(f.ids.get('create-view').hidden,false);assert.equal(f.ids.get('title').value,'Picnic draft');assert.match(f.ids.get('notice').textContent,/saving/);assert.equal(f.calls.filter(call=>call.path==='/api/events' || call.path.endsWith('/schedule')).length,1);
    release();await saving;assert.equal(f.ids.get('app-close').disabled,false);assert.equal(f.ids.get('edit-delete-event').disabled,false);assert.equal(f.getEvent().title,'Picnic draft');f.ids.get('app-close').onclick();assert.equal(f.ids.get('home-view').hidden,false);
  }
});

test('closing a page while manager details load prevents a late dialog or editor from reopening',async()=>{
  for(const [label,dialog] of [['👥 Guest list','guest-list-dialog'],['📷 Scan tickets','checkin-dialog'],['🤝 Co-hosts','cohost-dialog'],['✉️ Guest invitations','invitation-links-dialog'],['✏️ Edit event',null]]){
    const f=await harness(eventFixture());f.tabs.find(tab=>tab.dataset.tab==='events').onclick();const release=f.holdNextEventRead(),opening=f.findButton('event-list',label).onclick();f.ids.get('app-close').onclick();release();await opening;assert.equal(f.ids.get('home-view').hidden,false,label);assert.equal(f.ids.get('create-view').hidden,true,label);if(dialog)assert.equal(f.ids.get(dialog).open,false,label);
  }
  const f=await harness(eventFixture({ticket:{name:'Alex',code:'FICTIONAL1234'}}));f.tabs.find(tab=>tab.dataset.tab==='events').onclick();const release=f.holdNextTicket(),opening=f.findButton('event-list','🔳 Ticket QR').onclick();f.ids.get('app-close').onclick();release();await opening;assert.equal(f.ids.get('ticket-dialog').open,false);assert.equal(f.ids.get('home-view').hidden,false);
});

test('the ticket-check close button shuts the dialog and a delayed native scan cannot overwrite a newer session',async()=>{
  const f=await harness(eventFixture());await f.findButton('event-list','📷 Scan tickets').onclick();f.ids.get('checkin-scan').onclick();assert.equal(f.scanCallbacks.length,1);f.ids.get('checkin-close').onclick();assert.equal(f.ids.get('checkin-dialog').open,false);await f.findButton('event-list','📷 Scan tickets').onclick();f.ids.get('checkin-code').value='CURRENT';assert.equal(f.scanCallbacks[0]('STALE'),true);assert.equal(f.ids.get('checkin-code').value,'CURRENT');assert.equal(f.calls.filter(call=>call.path.endsWith('/ticket-check')).length,0);
});

test('closing or dismissing a confirmation cancels the operation and permits the next confirmation',async()=>{
  for(const close of [f=>f.ids.get('confirm-close').onclick(),f=>f.ids.get('confirm-dialog').close()]){
    const f=await harness(eventFixture({cohostLinks:[pendingLink('aaaaaaaaaaaaaaaa','Door')]}));await f.findButton('event-list','🤝 Co-hosts').onclick();const cancelling=f.findButton('cohost-list','Cancel invite').onclick();assert.equal(f.ids.get('confirm-dialog').open,true);close(f);await cancelling;assert.equal(f.ids.get('confirm-dialog').open,false);assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,0);
    const next=f.findButton('cohost-list','Cancel invite').onclick();assert.equal(f.ids.get('confirm-dialog').open,true);f.ids.get('confirm-close').onclick();await next;assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,0);
  }
});

test('a queued native confirmation close cannot dismiss or mutate a different confirmation',async()=>{
  const f=await harness(eventFixture({cohostLinks:[pendingLink('aaaaaaaaaaaaaaaa','Door'),pendingLink('bbbbbbbbbbbbbbbb','Registration')]}));await f.findButton('event-list','🤝 Co-hosts').onclick();const dialog=f.ids.get('confirm-dialog');let queuedClose;dialog.close=()=>{dialog.open=false;queuedClose=dialog.onclose;};
  const first=f.findButton('cohost-list','Cancel invite').onclick();f.ids.get('confirm-proceed').onclick();await first;assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,1);
  await f.findButton('cohost-list','Cancel invite').onclick();assert.equal(dialog.open,false,'a new prompt must wait until the old native close is delivered');assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,1);queuedClose();
  const next=f.findButton('cohost-list','Cancel invite').onclick();assert.equal(dialog.open,true);f.ids.get('confirm-close').onclick();queuedClose();await next;assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,1);
});

test('compact guest list status badges distinguish approval, payment, actual Later and opened invitations',async()=>{
  const guests=[{id:11,name:'Alex',status:'yes',participants:2,confirmed:true,responded:true},{id:12,name:'Morgan',status:'yes',participants:1,confirmed:false,approval:'pending',responded:true},{id:13,name:'Sam',status:'yes',participants:3,confirmed:false,approval:'approved',responded:true},{id:14,name:'Taylor',status:'no',participants:0,responded:true},{id:15,name:'Casey',status:'maybe',participants:0,responded:true},{id:16,name:'Jordan',status:'later',participants:0,responded:true},{id:17,name:'Drew',status:'later',participants:0,responded:false},{id:null,name:'Jess',status:'unopened',participants:0,responded:false}];
  const f=await harness(eventFixture({guestRoster:guests,invitees:guests.map((guest,index)=>managedInvite(guest.name,index+50,guest.id?[guest]:[]))}));await f.findButton('event-list','👥 Guest list').onclick();assert.equal(f.ids.get('guest-list-title').textContent,'Guest list');assert.equal(f.ids.get('guest-list-event').textContent,'Club evening');assert.match(f.ids.get('guest-list-summary').textContent,/6 people accepted/);
  const rows=f.ids.get('guest-list-rows').children;assert.deepEqual(rows.map(row=>row.dataset.status),['yes','pending','payment','no','maybe','later','unanswered','unopened']);assert.deepEqual(rows.map(row=>f.descendants(row).find(node=>node.className==='invitation-status').textContent),['Accepted','Awaiting approval','Awaiting payment','Declined','Maybe','Respond later','Awaiting response','Not opened']);assert.match(textOf(f,rows[0]),/Alex/);assert.match(textOf(f,rows[0]),/2 people/);assert.equal(rows[0].children.some(node=>node.tag==='details' && node.className==='event-more guest-roster-more'),true);
  await f.findButton('guest-list-filters','Later').onclick();assert.equal(f.ids.get('guest-list-rows').children.length,1);assert.match(textOf(f,f.ids.get('guest-list-rows').children[0]),/Jordan/);f.ids.get('guest-list-close').onclick();assert.equal(f.ids.get('guest-list-dialog').open,false);
});

test('co-host events expose management actions and keep payment fields read-only',async()=>{
  const f=await harness(eventFixture({isOwner:false,isCoHost:true}));
  for(const label of ['✏️ Edit event','👥 Guest list','📷 Scan tickets','✉️ Guest invitations','🗂 Shared media'])assert.ok(f.findButton('event-list',label),label+' should be available');
  for(const label of ['🤝 Co-hosts','🛑 Cancel event','🗑 Delete event','💳 Payments & refunds'])assert.equal(f.findButton('event-list',label),undefined,label+' should remain owner-only');
  assert.ok(f.descendants(f.ids.get('home-upcoming')).some(node=>node.textContent==='Co-hosting'));
  assert.ok(f.descendants(f.ids.get('event-list')).some(node=>node.textContent==='CO-HOSTING'));
  assert.ok(f.descendants(f.ids.get('event-list')).some(node=>node.tag==='label' && node.textContent==='🔔 Event reminder'));
  await f.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(f.ids.get('public-invitation-mode').disabled,true);
  assert.equal(f.ids.get('tickets-invitation-mode').disabled,true);
  assert.equal(f.ids.get('named-invitation-mode').disabled,false);
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
  await f.findButton('event-list','🤝 Co-hosts').onclick();
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
  await f.findButton('event-list','🤝 Co-hosts').onclick();
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
  await f.findButton('event-list','🤝 Co-hosts').onclick();assert.ok(f.descendants(f.ids.get('cohost-list')).some(node=>node.textContent==='Alex · No Telegram username · ID 2'));
  f.ids.get('cohost-close').onclick();await f.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(f.ids.get('payment-owner-note').hidden,true);assert.equal(f.ids.get('stars-price').disabled,false);assert.equal(f.ids.get('payment-terms').disabled,false);
});

test('named edits hide general count and approval controls, retain per-name rules and preserve private locations',async()=>{
  const f=await harness(eventFixture({requireApproval:true,askParticipantCount:true,hideLocation:false,invitees:[{name:'Alex',participants:2,participantMode:'confirm'},{name:'Sam',participantMode:'ask'},{name:'Jordan',participants:4,participantMode:'fixed'}]}));
  await f.findButton('event-list','✏️ Edit event').onclick();
  for(const id of ['require-approval-option','ask-participant-count-option'])assert.equal(f.ids.get(id).hidden,true);
  for(const id of ['require-approval','ask-participant-count']){assert.equal(f.ids.get(id).checked,false);assert.equal(f.ids.get(id).disabled,true);}
  assert.equal(f.ids.get('hide-location').checked,true);assert.equal(f.ids.get('hide-location').disabled,false);
  assert.equal(f.ids.get('one-time-invite').checked,true);assert.match(f.ids.get('one-time-invite-note').textContent,/Respond later does not lock/);
  assert.equal(f.ids.get('guest-names').value,'Alex = 2!\nSam = ?\nJordan = 4*');
  for(const id of ['extra-details','timing-options','stars-panel','guest-permissions','media-options'])assert.equal(f.ids.get(id).open,false);
  // Even stale UI state cannot re-enable the two general options in the named payload.
  f.ids.get('require-approval').checked=true;f.ids.get('ask-participant-count').checked=true;
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path.endsWith('/schedule')).body;
  assert.equal(saved.requireApproval,false);assert.equal(saved.askParticipantCount,false);assert.equal(saved.hideLocation,true);assert.equal(saved.oneTimeInvite,true);
  assert.equal(saved.guestNames,'Alex = 2!\nSam = ?\nJordan = 4*');assert.equal(saved.starPrice,100);
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
  await named.findButton('event-list','✏️ Edit event').onclick();assert.equal(named.ids.get('one-time-invite').checked,false);
  const tickets=await harness(eventFixture({invitationMode:'tickets',requireApproval:true,askParticipantCount:true}));
  await tickets.findButton('event-list','✏️ Edit event').onclick();assert.equal(tickets.ids.get('one-time-invite').checked,false);
  assert.equal(tickets.ids.get('require-approval').checked,true);assert.equal(tickets.ids.get('ask-participant-count').checked,true);
  assert.equal(tickets.ids.get('require-approval-option').hidden,false);assert.equal(tickets.ids.get('ask-participant-count-option').hidden,false);
});

test('new public events use reusable ticket booking without carrying named invitation rules',async()=>{
  const f=await harness(eventFixture());f.ids.get('hero-create').onclick();
  f.ids.get('invitation-mode').value='named';f.ids.get('invitation-mode').onchange();
  assert.equal(f.ids.get('one-time-invite').checked,true);
  f.ids.get('guest-names').value='Private guest = 2*';
  f.ids.get('invitation-mode').value='public';f.ids.get('invitation-mode').onchange();
  assert.equal(f.ids.get('one-time-invite').checked,false);
  assert.equal(f.ids.get('guest-names-panel').hidden,true);
  assert.equal(f.ids.get('require-approval-option').hidden,false);
  assert.equal(f.ids.get('ask-participant-count-option').hidden,false);
  f.ids.get('title').value='Community training';f.ids.get('location').value='Park';
  f.ids.get('require-approval').checked=true;f.ids.get('ask-participant-count').checked=true;
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path==='/api/events').body;
  assert.equal(saved.invitationMode,'tickets');assert.equal(saved.isPublic,true);assert.equal(saved.oneTimeInvite,false);
  assert.equal(saved.guestNames,undefined);assert.equal(saved.requireApproval,true);assert.equal(saved.askParticipantCount,true);
  assert.deepEqual(f.errors,[]);
});

test('existing public ticket events can become private and public without resetting their invitation settings',async()=>{
  const f=await harness(eventFixture({invitationMode:'tickets',isPublic:true,oneTimeInvite:true,requireApproval:true,askParticipantCount:true}));
  await f.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(f.ids.get('invitation-mode').value,'public');assert.equal(f.ids.get('one-time-invite').checked,true);
  f.ids.get('invitation-mode').value='tickets';f.ids.get('invitation-mode').onchange();
  assert.equal(f.ids.get('one-time-invite').checked,true);
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  let saved=f.calls.filter(call=>call.path.endsWith('/schedule')).at(-1).body;
  assert.equal(saved.invitationMode,'tickets');assert.equal(saved.isPublic,false);assert.equal(saved.oneTimeInvite,true);
  assert.equal(saved.requireApproval,true);assert.equal(saved.askParticipantCount,true);
  await f.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(f.ids.get('invitation-mode').value,'tickets');
  f.ids.get('invitation-mode').value='public';f.ids.get('invitation-mode').onchange();
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  saved=f.calls.filter(call=>call.path.endsWith('/schedule')).at(-1).body;
  assert.equal(saved.invitationMode,'tickets');assert.equal(saved.isPublic,true);assert.equal(saved.oneTimeInvite,true);
  assert.equal(saved.requireApproval,true);assert.equal(saved.askParticipantCount,true);
  assert.deepEqual(f.errors,[]);
});

test('editing an existing public RSVP event preserves the legacy link mode and its one-time choice',async()=>{
  for(const oneTimeInvite of [false,true]){
    const f=await harness(eventFixture({invitationMode:'legacy',isPublic:true,oneTimeInvite,requireApproval:true,askParticipantCount:true}));
    await f.findButton('event-list','✏️ Edit event').onclick();
    assert.equal(f.ids.get('invitation-mode').value,'public');assert.equal(f.ids.get('legacy-invitation-mode').hidden,false);
    assert.equal(f.ids.get('one-time-invite').checked,oneTimeInvite);
    f.ids.get('invitation-mode').onchange();
    assert.equal(f.ids.get('one-time-invite').checked,oneTimeInvite);
    await f.ids.get('event-form').onsubmit({preventDefault(){}});
    const saved=f.calls.find(call=>call.path.endsWith('/schedule')).body;
    assert.equal(saved.invitationMode,'legacy');assert.equal(saved.isPublic,true);assert.equal(saved.oneTimeInvite,oneTimeInvite);
    assert.equal(saved.requireApproval,true);assert.equal(saved.askParticipantCount,true);
    assert.equal(saved.guestNames,undefined);assert.deepEqual(f.errors,[]);
    f.ids.get('invitation-mode').value='legacy';f.ids.get('invitation-mode').onchange();
    await f.ids.get('event-form').onsubmit({preventDefault(){}});
    let changed=f.calls.filter(call=>call.path.endsWith('/schedule')).at(-1).body;
    assert.equal(changed.invitationMode,'legacy');assert.equal(changed.isPublic,false);assert.equal(changed.oneTimeInvite,oneTimeInvite);
    f.ids.get('invitation-mode').value='public';f.ids.get('invitation-mode').onchange();
    await f.ids.get('event-form').onsubmit({preventDefault(){}});
    changed=f.calls.filter(call=>call.path.endsWith('/schedule')).at(-1).body;
    assert.equal(changed.invitationMode,'legacy');assert.equal(changed.isPublic,true);assert.equal(changed.oneTimeInvite,oneTimeInvite);
  }
});

test('co-hosts can switch ticket visibility while forbidden invitation modes and owner payment fields stay locked',async()=>{
  const f=await harness(eventFixture({isOwner:false,isCoHost:true,invitationMode:'tickets',isPublic:false,oneTimeInvite:false}));
  await f.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(f.ids.get('tickets-invitation-mode').disabled,false);assert.equal(f.ids.get('public-invitation-mode').disabled,false);
  assert.equal(f.ids.get('named-invitation-mode').disabled,true);
  assert.equal(f.ids.get('legacy-invitation-mode').hidden,true);
  assert.equal(f.ids.get('stars-price').disabled,true);assert.equal(f.ids.get('payment-terms').disabled,true);
  f.ids.get('invitation-mode').value='public';f.ids.get('invitation-mode').onchange();
  await f.ids.get('event-form').onsubmit({preventDefault(){}});
  const saved=f.calls.find(call=>call.path.endsWith('/schedule')).body;
  assert.equal(saved.invitationMode,'tickets');assert.equal(saved.isPublic,true);assert.equal(saved.oneTimeInvite,false);
  assert.equal(saved.paymentMethod,'stars');assert.equal(saved.starPrice,100);assert.equal(saved.starPricing,'person');
  assert.equal(saved.paymentTerms,'Admission for one person.');assert.deepEqual(f.errors,[]);
});

test('collapsed settings expand for invalid required fields and payment errors',async()=>{
  const f=await harness(eventFixture(),{scheduleError:'Payment and refund terms is required.'});
  await f.findButton('event-list','✏️ Edit event').onclick();
  const payment=f.ids.get('stars-panel');payment.tagName='DETAILS';
  f.ids.get('payment-terms').parentElement=payment;
  f.ids.get('event-form').listeners.invalid({target:f.ids.get('payment-terms')});
  assert.equal(payment.open,true);
  payment.open=false;await f.ids.get('event-form').onsubmit({preventDefault(){}});
  assert.equal(payment.open,true);assert.equal(f.ids.get('form-error').hidden,false);assert.match(f.ids.get('form-error').textContent,/Payment and refund terms/);
});

test('personal invitation rows distinguish an unanswered open link from a locked RSVP and a reusable link',async()=>{
  const f=await harness(eventFixture({oneTimeInvite:true,invitees:[{name:'Alex',status:'later',claimed:false,url:'https://t.me/test?start=alex'},{name:'Sam',status:'yes',claimed:true,url:'https://t.me/test?start=sam'}]}));
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  let rows=f.descendants(f.ids.get('invitation-links-list')).map(node=>node.textContent).join('\n');
  assert.match(rows,/Respond later/);assert.match(rows,/One-time link/);assert.match(rows,/Accepted/);assert.match(rows,/Locked to one guest/);assert.doesNotMatch(rows,/Not opened/);
  f.setEvent({...f.getEvent(),oneTimeInvite:false});await f.findButton('event-list','✉️ Guest invitations').onclick();
  rows=f.descendants(f.ids.get('invitation-links-list')).map(node=>node.textContent).join('\n');
  assert.match(rows,/Accepted/);assert.match(rows,/Reusable link/);assert.match(f.ids.get('invitation-links-note').textContent,/more than one guest/);
});

test('guest invitation actions copy the full invitation or only that guest link and preserve sharing',async()=>{
  const f=await harness(eventFixture({paymentMethod:'free',starPrice:0,endsAt:'2099-10-24T10:00:00Z',responseDeadline:'2099-10-23T08:00:00Z',inviteMessage:'Bring a scarf.',invitees:[{name:'Alex',participants:2,url:'https://t.me/test?start=alex'},{name:'Sam',participantMode:'ask',url:'https://t.me/test?start=sam'}]}));
  f.setEvent({...f.getEvent(),title:'Updated club evening'});
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  await f.findButton('invitation-links-list','Alex').onclick();
  const alex=f.copied.at(-1);
  assert.match(alex,/^Dear Alex,/);assert.match(alex,/You are invited to Updated club evening on/);assert.match(alex,/Australia\/Sydney/);
  assert.match(alex,/At Club house\./);assert.match(alex,/Host has reserved 2 places/);assert.match(alex,/Bring a scarf\./);
  assert.match(alex,/Finishes:/);assert.match(alex,/\n\nFree\n\n/);assert.match(alex,/Please respond by/);
  assert.match(alex,/Please respond below\.\n\nhttps:\/\/t\.me\/test\?start=alex$/);assert.doesNotMatch(alex,/Dear Sam|start=sam/);
  assert.equal(alex.split('https://t.me/test?start=alex').length,2);
  const rows=f.ids.get('invitation-links-list').children;
  const rowButton=(row,label)=>f.descendants(row).find(node=>node.tag==='button' && node.textContent===label);
  for(const [row,name,url] of [[rows[0],'Alex','https://t.me/test?start=alex'],[rows[1],'Sam','https://t.me/test?start=sam']]){
    for(const label of ['📤 Share invite','Copy invite','Copy link'])assert.ok(rowButton(row,label),name+' should have '+label);
    const mainActions=row.children.find(node=>node.className==='event-actions invitation-actions');assert.deepEqual(mainActions.children.map(button=>button.textContent),['Copy invite','Copy link']);
    const more=row.children.find(node=>node.tag==='details' && node.className==='event-more invitation-more');assert.equal(more.open,false);assert.ok(f.descendants(more).includes(rowButton(row,'📤 Share invite')));
    await rowButton(row,name).onclick();const personal=f.copied.at(-1);
    await rowButton(row,'Copy invite').onclick();assert.equal(f.copied.at(-1),personal);
    await rowButton(row,'Copy link').onclick();assert.equal(f.copied.at(-1),url);
  }
  await f.findButton('invitation-links-list','Sam').onclick();assert.match(f.copied.at(-1),/^Dear Sam,/);assert.match(f.copied.at(-1),/Please choose how many people/);assert.match(f.copied.at(-1),/start=sam$/);
  await f.findButton('invitation-links-list','📤 Share invite').onclick();
  const shared=new URL(f.telegramLinks.at(-1));assert.equal(shared.searchParams.get('url'),'https://t.me/test?start=alex');assert.equal(shared.searchParams.get('text')+'\n\n'+shared.searchParams.get('url'),alex);
  assert.equal(f.ids.get('invitation-links-status').textContent,'Invitation copied for Sam.');
});

test('owner and co-host copy actions never include acceptance, approval or payment-protected addresses',async()=>{
  for(const owner of [true,false])for(const privacy of [{hideLocation:true},{requireApproval:true},{locationAfterApproval:true},{paymentMethod:'bank'},{paymentMethod:'link'},{paymentMethod:'stars',starPrice:25}]){
    const f=await harness(eventFixture({paymentMethod:'free',starPrice:0,isOwner:owner,isCoHost:!owner,location:'SECRET VENUE',...privacy}));
    await f.findButton('event-list','✉️ Guest invitations').onclick();await f.findButton('invitation-links-list','Copy invite').onclick();
    assert.doesNotMatch(f.copied.at(-1),/SECRET VENUE/);assert.match(f.copied.at(-1),/Location will be available after/);assert.match(f.copied.at(-1),/\n\nhttps:\/\/t\.me\/test\?start=guest$/);
  }
});

test('copied paid invitations retain the configured Stars or manual text price',async()=>{
  for(const [pricing,expected] of [[{paymentMethod:'stars',starPrice:25,starPricing:'person'},'25 Stars per person'],[{paymentMethod:'stars',starPrice:50,starPricing:'group'},'50 Stars per group'],[{paymentMethod:'bank',starPrice:0,displayPrice:'AUD $20 each'},'Paid · AUD $20 each'],[{paymentMethod:'link',starPrice:0,displayPrice:'Members £15 / guests £20'},'Paid · Members £15 / guests £20']]){
    const f=await harness(eventFixture(pricing));await f.findButton('event-list','✉️ Guest invitations').onclick();await f.findButton('invitation-links-list','Copy invite').onclick();assert.ok(f.copied.at(-1).includes(expected));
  }
});

test('explicit copy preserves long custom invitations without putting their text into the link-only copy',async()=>{
  const inviteMessage='Bring your friends, a warm scarf and your favourite snack. '.repeat(16).trim();
  const url='https://t.me/test?start=personal_link';
  const f=await harness(eventFixture({paymentMethod:'free',starPrice:0,inviteMessage,invitees:[{name:'Alex',participants:3,url}]}));
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  await f.findButton('invitation-links-list','Copy invite').onclick();
  const text=f.copied.at(-1);assert.ok(text.length>1000);assert.ok(text.includes(inviteMessage));assert.match(text,/^Dear Alex,/);assert.ok(text.endsWith('\n\n'+url));
  await f.findButton('invitation-links-list','Copy link').onclick();assert.equal(f.copied.at(-1),url);
});

test('denied or unavailable clipboard exposes selectable full text and a denied copy can recover',async()=>{
  for(const clipboardMode of ['denied','absent']){
    const f=await harness(eventFixture({hideLocation:true,inviteMessage:'Bring a scarf.'}),{clipboardMode});
    await f.findButton('event-list','✉️ Guest invitations').onclick();
    const copy=f.findButton('invitation-links-list','Copy invite');await copy.onclick();
    const nodes=f.descendants(f.ids.get('invitation-links-list')),fullText=nodes.find(node=>node.tag==='textarea');
    assert.equal(nodes.find(node=>node.className==='invitation-preview').open,true);assert.equal(fullText.readOnly,true);assert.equal(fullText.focused,true);assert.equal(fullText.selected,true);
    assert.match(fullText.value,/^Dear Alex,/);assert.match(fullText.value,/Bring a scarf\./);assert.match(fullText.value,/start=guest$/);assert.doesNotMatch(fullText.value,/Club house/);
    assert.equal(f.copied.length,0);assert.match(f.ids.get('invitation-links-status').textContent,/Could not copy/);assert.doesNotMatch(f.ids.get('invitation-links-status').textContent,/Invitation copied/);assert.equal(copy.disabled,false);
    if(clipboardMode==='denied'){f.setClipboardMode('ok');await copy.onclick();assert.equal(f.copied.at(-1),fullText.value);assert.equal(f.ids.get('invitation-links-status').textContent,'Invitation copied for Alex.');}
  }
});

test('link-only copy failures expose a selectable personal URL and can recover without copying invitation text',async()=>{
  for(const clipboardMode of ['denied','absent']){
    const url='https://t.me/test?start=guest';
    const f=await harness(eventFixture({hideLocation:true,inviteMessage:'Bring a scarf.'}),{clipboardMode});
    await f.findButton('event-list','✉️ Guest invitations').onclick();
    const copy=f.findButton('invitation-links-list','Copy link');await copy.onclick();
    const nodes=f.descendants(f.ids.get('invitation-links-list')),link=nodes.find(node=>node.tag==='input' && node.attributes['aria-label']==='Personal link for Alex');
    assert.ok(link);assert.equal(link.value,url);assert.equal(link.readOnly,true);assert.equal(link.focused,true);assert.equal(link.selected,true);
    assert.equal(nodes.find(node=>node.className==='invitation-preview').open,true);assert.equal(f.copied.length,0);assert.equal(copy.disabled,false);
    assert.match(f.ids.get('invitation-links-status').textContent,/Could not copy/);assert.doesNotMatch(f.ids.get('invitation-links-status').textContent,/Link copied/);
    if(clipboardMode==='denied'){f.setClipboardMode('ok');await copy.onclick();assert.equal(f.copied.at(-1),url);assert.match(f.ids.get('invitation-links-status').textContent,/Link copied/);}
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
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(f.ids.get('invitation-links-list').children.length,0);assert.match(f.ids.get('notice').textContent,/Only event managers/);
});

const managedInvite=(name,number,responses=[])=>{
  const token=number.toString(16).padStart(32,'0'),statuses=[...new Set(responses.map(guest=>guest.status))];
  return {name,token,url:'https://t.me/test?start=i_0123456789abcdef_'+token,participants:2,claimed:responses.some(guest=>['yes','no','maybe'].includes(guest.status)),status:statuses.length>1?'mixed':statuses[0] || null,responses,responseCounts:Object.fromEntries(['yes','no','maybe','later'].map(status=>[status,responses.filter(guest=>guest.status===status).length])),canNotify:responses.length>0,hasPayments:false};
};
const managedEvent=fields=>eventFixture({paymentMethod:'free',starPrice:0,invitationsVersion:'0000000000000000',...fields});
const invitationRows=f=>f.ids.get('invitation-links-list').children;
const invitationRow=(f,name)=>invitationRows(f).find(row=>f.descendants(row).some(node=>node.tag==='button' && node.textContent===name));
const rowAction=(f,row,label)=>f.descendants(row).find(node=>node.tag==='button' && node.textContent===label);
const rowField=(f,row,key)=>f.descendants(row).find(node=>node.dataset?.field===key);
const rowPanel=(f,row)=>f.descendants(row).find(node=>node.className==='invitation-management');
const visibleInvitations=f=>invitationRows(f).filter(row=>!row.hidden).map(row=>f.descendants(row).find(node=>node.tag==='button').textContent);
const textOf=(f,node)=>[node.textContent,...f.descendants(node).map(child=>child.textContent)].filter(Boolean).join('\n');

test('invitation manager shows all response outcomes and filters reusable links by each actual response',async()=>{
  const f=await harness(managedEvent({oneTimeInvite:false,invitees:[
    managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2,comment:'See you there.'},{name:'Taylor',status:'no',participants:0}]),
    managedInvite('Sam',12,[{name:'Sam',status:'yes',participants:3}]),
    managedInvite('Morgan',13,[{name:'Morgan',status:'maybe',participants:0}]),
    managedInvite('Drew',14,[{name:'Drew',status:'later',participants:0}]),managedInvite('Jess',15)
  ]}));
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  const summary=textOf(f,f.ids.get('invitation-links-summary'));
  assert.match(summary,/5 invitations/);assert.match(summary,/4 responses/);assert.match(summary,/5 people accepted/);
  assert.deepEqual(f.ids.get('invitation-links-filter').children.map(option=>option.textContent),['All (5)','Accepted (2)','Declined (1)','Maybe (1)','Later (1)','Unanswered (2)','Revoked (0)']);
  const alex=textOf(f,invitationRow(f,'Alex'));
  assert.match(alex,/Taylor/);assert.match(alex,/Accepted/);assert.match(alex,/Declined/);assert.match(alex,/See you there\./);
  for(const [filter,names] of [['all',['Alex','Sam','Morgan','Drew','Jess']],['yes',['Alex','Sam']],['no',['Alex']],['maybe',['Morgan']],['later',['Drew']],['unanswered',['Drew','Jess']]]){
    f.ids.get('invitation-links-filter').value=filter;f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),names,filter);
  }
  assert.deepEqual(f.errors,[]);
});

test('invitation response filters combine with case-insensitive guest search and show an empty result',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}]),managedInvite('Sam',12,[{name:'Sam',status:'no',participants:0}]),managedInvite('Samira',13,[{name:'Samira',status:'yes',participants:1}])]}));
  await f.findButton('event-list','✉️ Guest invitations').onclick();
  assert.equal(f.ids.get('invitation-links-search').hidden,false);
  f.ids.get('invitation-links-search').value='  sAm  ';f.ids.get('invitation-links-search').oninput();assert.deepEqual(visibleInvitations(f),['Sam','Samira']);
  f.ids.get('invitation-links-filter').value='yes';f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),['Samira']);
  f.ids.get('invitation-links-search').value='Nobody';f.ids.get('invitation-links-search').oninput();assert.deepEqual(visibleInvitations(f),[]);assert.equal(f.ids.get('invitation-links-empty').hidden,false);
  f.ids.get('invitation-links-search').value='';f.ids.get('invitation-links-search').oninput();assert.deepEqual(visibleInvitations(f),['Alex','Samira']);assert.equal(f.ids.get('invitation-links-empty').hidden,true);
});

test('owner and co-host can append named guests with count rules without resetting existing invitations or current filters',async()=>{
  for(const owner of [true,false]){
    const existing=managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}]);
    const f=await harness(managedEvent({isOwner:owner,isCoHost:!owner,invitees:[existing]}));
    await f.findButton('event-list','✉️ Guest invitations').onclick();
    f.ids.get('invitation-links-search').value='casey';f.ids.get('invitation-links-search').oninput();
    f.ids.get('invitation-links-filter').value='unanswered';f.ids.get('invitation-links-filter').onchange();
    f.ids.get('invitation-add-names').value='  Jamie = ?\nCasey = 2!\nJordan = 2*\nTaylor = 3  ';
    await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});
    const request=f.calls.find(call=>call.path.endsWith('/invitations/add'));
    assert.equal(request.body.guestNames.trim(),'Jamie = ?\nCasey = 2!\nJordan = 2*\nTaylor = 3');assert.equal(request.body.version,'0000000000000000');assert.match(request.body.requestId,/^[a-f0-9-]{36}$/i);
    assert.deepEqual(f.getEvent().invitees[0],existing);assert.equal(f.getEvent().invitees.length,5);
    assert.equal(f.getEvent().invitees[1].participantMode,'ask');assert.equal(f.getEvent().invitees[2].participantMode,'confirm');assert.equal(f.getEvent().invitees[2].participants,2);
    assert.equal(f.getEvent().invitees[3].participantMode,'fixed');assert.equal(f.getEvent().invitees[3].participants,2);assert.equal(f.getEvent().invitees[4].participants,3);assert.equal(f.getEvent().invitees[4].participantMode,null);
    const fixed=invitationRow(f,'Jordan');assert.ok(f.descendants(fixed).some(node=>node.tag==='strong' && node.textContent==='2 attendees'));assert.match(textOf(f,fixed),/Fixed count/);assert.doesNotMatch(textOf(f,fixed),/Guest can change count/);
    await rowAction(f,fixed,'Copy invite').onclick();assert.match(f.copied.at(-1),/Host has reserved 2 places for you\. This count is fixed\./);assert.doesNotMatch(f.copied.at(-1),/<strong>|<b>|\*\*/);
    assert.equal(f.ids.get('invitation-add-names').value,'');assert.equal(f.ids.get('invitation-links-search').value,'casey');assert.equal(f.ids.get('invitation-links-filter').value,'unanswered');assert.deepEqual(visibleInvitations(f),['Casey']);
    await rowAction(f,invitationRow(f,'Casey'),'Copy link').onclick();assert.equal(f.copied.at(-1),f.getEvent().invitees[2].url);
    f.ids.get('invitation-add-names').value='Lee';await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});
    const requests=f.calls.filter(call=>call.path.endsWith('/invitations/add'));assert.equal(requests[1].body.version,'0000000000000001');assert.notEqual(requests[1].body.requestId,requests[0].body.requestId);assert.deepEqual(f.errors,[]);
  }
});

test('revoking one invitation explicitly chooses notification and preserves its history separately',async()=>{
  for(const notify of [true,false]){
    const alex=managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}]),sam=managedInvite('Sam',12);
    const f=await harness(managedEvent({invitees:[alex,sam]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
    await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();const row=invitationRow(f,'Alex');
    assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/revoke')).length,0);
    assert.equal(rowField(f,row,'notify').checked,false);assert.equal(rowField(f,row,'deleteAfter').checked,false);
    const question=textOf(f,row);assert.match(question,/Alex/);assert.match(question,/notif|notify/i);
    rowField(f,row,'notify').checked=notify;await rowAction(f,row,'Revoke invite').onclick();
    const request=f.calls.find(call=>call.path.endsWith('/invitations/revoke'));assert.deepEqual({...request.body,requestId:undefined},{token:alex.token,notify,confirm:true,version:'0000000000000000',requestId:undefined});assert.match(request.body.requestId,/^[a-f0-9-]{36}$/i);
    assert.ok(invitationRow(f,'Alex'));assert.ok(invitationRow(f,'Sam'));assert.deepEqual(f.getEvent().invitees,[sam]);assert.equal(f.getEvent().revokedInvitees[0].history.at(-1).type,'revoked');assert.equal(f.getEvent().revokedInvitees[0].token,alex.token);assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/delete')).length,0);assert.deepEqual(f.errors,[]);
  }
});

test('Back cancels invitation revocation without any mutation',async()=>{
  const alex=managedInvite('Alex',11,[{name:'Alex',status:'no',participants:0}]);
  const f=await harness(managedEvent({invitees:[alex]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();await rowAction(f,invitationRow(f,'Alex'),'Back').onclick();
  assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/revoke')).length,0);assert.deepEqual(f.getEvent().invitees,[alex]);assert.ok(invitationRow(f,'Alex'));assert.equal(rowPanel(f,invitationRow(f,'Alex')).hidden,true);
});

test('an unopened invitation disables response and notification while allowing revocation',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  assert.equal(rowAction(f,invitationRow(f,'Alex'),'↻ Change response').disabled,true);assert.match(textOf(f,invitationRow(f,'Alex')),/guest must open/);
  await rowAction(f,invitationRow(f,'Alex'),'↻ Change response').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/response')).length,0);
  await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();const row=invitationRow(f,'Alex');assert.equal(rowField(f,row,'notify').disabled,true);assert.match(textOf(f,row),/No Telegram account is available/);
  await rowAction(f,row,'Revoke invite').onclick();assert.equal(f.getEvent().invitees.length,0);assert.equal(f.calls.find(call=>call.path.endsWith('/invitations/revoke')).body.notify,false);
});

test('an add validation error keeps guest input and existing links visible for correction',async()=>{
  const alex=managedInvite('Alex',11),f=await harness(managedEvent({invitees:[alex]}),{invitationError:{status:400,message:'A ticket can include at most 10 people.'}});
  await f.findButton('event-list','✉️ Guest invitations').onclick();f.ids.get('invitation-add-names').value='Casey = 20';await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});
  assert.equal(f.ids.get('invitation-add-names').value,'Casey = 20');assert.match(f.ids.get('invitation-links-status').textContent,/at most 10/);assert.equal(f.ids.get('invitation-add-submit').disabled,false);assert.deepEqual(f.getEvent().invitees,[alex]);assert.ok(invitationRow(f,'Alex'));
  f.setInvitationError(null);f.ids.get('invitation-add-names').value='Casey = 2';await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});assert.equal(f.getEvent().invitees.length,2);
});

test('a revoke failure keeps the invitation and displays the server error instead of reporting success',async()=>{
  const alex=managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}]),f=await harness(managedEvent({invitees:[alex]}),{invitationError:{status:400,message:'Refund this ticket before removing its invitation.'}});
  await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();await rowAction(f,invitationRow(f,'Alex'),'Revoke invite').onclick();
  assert.deepEqual(f.getEvent().invitees,[alex]);assert.ok(invitationRow(f,'Alex'));assert.match(f.ids.get('invitation-links-status').textContent,/Refund this ticket/);assert.doesNotMatch(f.ids.get('invitation-links-status').textContent,/removed|notified/i);
});

test('a response arriving before revocation refreshes the list and requires another explicit confirmation',async()=>{
  const alex=managedInvite('Alex',11),f=await harness(managedEvent({invitees:[alex]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  f.ids.get('invitation-links-search').value='alex';f.ids.get('invitation-links-search').oninput();await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();const row=invitationRow(f,'Alex');
  const responded=managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}]);f.setEvent({...f.getEvent(),invitationsVersion:'1111111111111111',invitees:[responded]});
  await rowAction(f,row,'Revoke invite').onclick();
  assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/revoke')).length,1);assert.deepEqual(f.getEvent().invitees,[responded]);assert.match(f.ids.get('invitation-links-status').textContent,/Invitations changed/);assert.match(textOf(f,invitationRow(f,'Alex')),/Accepted/);assert.equal(f.ids.get('invitation-links-search').value,'alex');
  await rowAction(f,invitationRow(f,'Alex'),'Revoke invite').onclick();
  assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/revoke')).at(-1).body.version,'1111111111111111');assert.equal(f.getEvent().invitees.length,0);
});

test('closing invitation management ignores a late add response and a later opening fetches current invitations',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  const release=f.holdNextInvitationMutation();f.ids.get('invitation-add-names').value='Casey';const adding=f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});
  f.ids.get('invitation-links-close').onclick();assert.equal(f.ids.get('invitation-links-dialog').open,false);release();await adding;
  assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(invitationRow(f,'Casey'),undefined);
  await f.findButton('event-list','✉️ Guest invitations').onclick();assert.ok(invitationRow(f,'Casey'));
});

test('a pending revocation blocks competing mutations and disables notification controls',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:2}])]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();const row=invitationRow(f,'Alex'),revoke=rowAction(f,row,'Revoke invite'),edit=rowAction(f,row,'✏️ Edit invite');
  const release=f.holdNextInvitationMutation();const removing=revoke.onclick();
  assert.equal(edit.disabled,true);assert.equal(rowField(f,row,'notify').disabled,true);assert.equal(f.ids.get('invitation-add-submit').disabled,true);assert.equal(f.ids.get('invitation-add-names').disabled,true);
  await edit.onclick();f.ids.get('invitation-add-names').value='Casey';await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});
  assert.equal(f.calls.filter(call=>/\/invitations\/(?:add|revoke)$/.test(call.path)).length,1);
  release();await removing;assert.equal(f.getEvent().invitees.length,0);assert.equal(f.ids.get('invitation-add-submit').disabled,false);
});

test('revoking then deleting the last invitation requires a separate deletion confirmation and keeps additions available',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();const row=invitationRow(f,'Alex');rowField(f,row,'deleteAfter').checked=true;await rowAction(f,row,'Revoke invite').onclick();
  assert.equal(f.getEvent().invitees.length,0);assert.equal(f.getEvent().revokedInvitees.length,1);assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/delete')).length,0);assert.match(textOf(f,invitationRow(f,'Alex')),/cannot be undone/);
  await rowAction(f,invitationRow(f,'Alex'),'Delete permanently').onclick();assert.equal(f.getEvent().revokedInvitees.length,0);assert.equal(f.calls.find(call=>call.path.endsWith('/invitations/delete')).body.confirm,true);
  assert.equal(invitationRows(f).length,0);assert.match(f.ids.get('invitation-links-summary').textContent,/0 invitations/);
  f.ids.get('invitation-links-close').onclick();assert.ok(f.findButton('event-list','✉️ Guest invitations'));await f.findButton('event-list','✉️ Guest invitations').onclick();
  f.ids.get('invitation-add-names').value='Sam';await f.ids.get('invitation-add-form').onsubmit({preventDefault(){}});assert.ok(invitationRow(f,'Sam'));
});

test('refresh gets current responses without clearing a search, response filter or guest draft',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  f.ids.get('invitation-links-search').value='alex';f.ids.get('invitation-links-search').oninput();f.ids.get('invitation-links-filter').value='yes';f.ids.get('invitation-links-filter').onchange();f.ids.get('invitation-add-names').value='Casey = ?';
  assert.equal(visibleInvitations(f).length,0);const fresh=managedInvite('Alex',11,[{name:'Alex',status:'yes',participants:3,comment:'Bringing my family.'}]);f.setEvent({...f.getEvent(),invitationsVersion:'1111111111111111',invitees:[fresh]});
  await f.ids.get('invitation-links-refresh').onclick();
  assert.deepEqual(visibleInvitations(f),['Alex']);assert.match(textOf(f,invitationRow(f,'Alex')),/3 people/);assert.match(textOf(f,invitationRow(f,'Alex')),/Bringing my family/);
  assert.equal(f.ids.get('invitation-links-search').value,'alex');assert.equal(f.ids.get('invitation-links-filter').value,'yes');assert.equal(f.ids.get('invitation-add-names').value,'Casey = ?');assert.match(f.ids.get('invitation-links-status').textContent,/refreshed/i);
});

test('editing one invitation preserves its token, claim, responses and other invites for every attendee setting',async()=>{
  for(const [mode,count,participantMode,participants] of [['one','1','default',null],['editable','4','preset',4],['ask','1','ask',null],['confirm','3','confirm',3],['fixed','10','fixed',10]]){
    const reply={id:18,name:'Alex',status:'maybe',participants:0},alex=managedInvite('Alex',11,[reply]),sam=managedInvite('Sam',12);
    const f=await harness(managedEvent({invitees:[alex,sam]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
    await rowAction(f,invitationRow(f,'Alex'),'✏️ Edit invite').onclick();const row=invitationRow(f,'Alex');
    rowField(f,row,'name').value='Alex Smith';rowField(f,row,'mode').value=mode;rowField(f,row,'mode').onchange();rowField(f,row,'count').value=count;
    await rowAction(f,row,'Save invite').onclick();const request=f.calls.find(call=>call.path.endsWith('/invitations/edit'));
    assert.deepEqual({...request.body,requestId:undefined},{token:alex.token,name:'Alex Smith',participants,participantMode,version:'0000000000000000',requestId:undefined});assert.match(request.body.requestId,/^[a-f0-9-]{36}$/i);
    const edited=f.getEvent().invitees[0];assert.equal(edited.token,alex.token);assert.equal(edited.claimed,alex.claimed);assert.deepEqual(edited.responses,[reply]);assert.deepEqual(f.getEvent().invitees[1],sam);assert.equal(edited.history.at(-1).type,'edited');assert.equal(rowPanel(f,invitationRow(f,'Alex Smith')).hidden,true);
    await rowAction(f,invitationRow(f,'Alex Smith'),'Copy invite').onclick();assert.match(f.copied.at(-1),/^Dear Alex Smith,/);assert.ok(f.copied.at(-1).endsWith(alex.url));
  }
});

test('invitation edits reject duplicate names, malformed names and counts over ten without mutating',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11),managedInvite('Sam',12)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'✏️ Edit invite').onclick();const row=invitationRow(f,'Alex');
  for(const name of ['','Bad = 2','Sam']){rowField(f,row,'name').value=name;await rowAction(f,row,'Save invite').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/edit')).length,0);assert.ok(f.ids.get('invitation-links-status').textContent);}
  rowField(f,row,'name').value='Alex';rowField(f,row,'mode').value='fixed';rowField(f,row,'mode').onchange();rowField(f,row,'count').value='11';await rowAction(f,row,'Save invite').onclick();assert.match(f.ids.get('invitation-links-status').textContent,/1 to 10/);assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/edit')).length,0);
});

test('failed invitation edits retain the draft and reuse the request ID when retried',async()=>{
  const original=managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}]),f=await harness(managedEvent({invitees:[original]}),{invitationError:{message:'This paid ticket needs a refund first.'}});await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'✏️ Edit invite').onclick();let row=invitationRow(f,'Alex');
  rowField(f,row,'name').value='Alex Smith';rowField(f,row,'mode').value='confirm';rowField(f,row,'mode').onchange();rowField(f,row,'count').value='3';rowField(f,row,'count').onchange();await rowAction(f,row,'Save invite').onclick();
  row=invitationRow(f,'Alex');assert.equal(rowField(f,row,'name').value,'Alex Smith');assert.equal(rowField(f,row,'mode').value,'confirm');assert.equal(rowField(f,row,'count').value,'3');assert.match(f.ids.get('invitation-links-status').textContent,/needs a refund/);assert.deepEqual(f.getEvent().invitees,[original]);
  f.setInvitationError(null);await rowAction(f,row,'Save invite').onclick();const requests=f.calls.filter(call=>call.path.endsWith('/invitations/edit'));assert.equal(requests[0].body.requestId,requests[1].body.requestId);assert.ok(invitationRow(f,'Alex Smith'));
});

test('reusable invitation response changes require choosing the exact guest and preserve other responses',async()=>{
  for(const [status,notify] of [['yes',true],['no',false],['maybe',true],['later',false]]){
    const alex={id:18,name:'Alex',status:'yes',participants:2,selectedParticipants:2},sam={id:19,name:'Sam',status:'no',participants:0,selectedParticipants:4},invite=managedInvite('Team',11,[alex,sam]);
    const f=await harness(managedEvent({oneTimeInvite:false,invitees:[invite]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Team'),'↻ Change response').onclick();const row=invitationRow(f,'Team');
    assert.equal(rowField(f,row,'userId').value,'');assert.equal(rowField(f,row,'notify').checked,false);await rowAction(f,row,'Save response').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/response')).length,0);assert.match(f.ids.get('invitation-links-status').textContent,/Choose the guest/);
    rowField(f,row,'userId').value='19';rowField(f,row,'userId').onchange();assert.equal(rowField(f,row,'status').value,'no');assert.equal(rowField(f,row,'count').value,'4');
    rowField(f,row,'status').value=status;rowField(f,row,'status').onchange();rowField(f,row,'notify').checked=notify;await rowAction(f,row,'Save response').onclick();
    const request=f.calls.find(call=>call.path.endsWith('/invitations/response'));assert.deepEqual({...request.body,requestId:undefined},{token:invite.token,userId:19,status,...(status==='yes'?{participants:4}:{}),notify,version:'0000000000000000',requestId:undefined});assert.match(request.body.requestId,/^[a-f0-9-]{36}$/i);assert.deepEqual(f.getEvent().invitees[0].responses[0],alex);assert.equal(f.getEvent().invitees[0].responses[1].status,status);
  }
});

test('fixed and one-person invitations disable attendee changes in the response form',async()=>{
  for(const fields of [{participants:3,participantMode:'fixed'},{participants:null,participantMode:null}]){
    const invite={...managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:fields.participants || 1}]),...fields};
    const f=await harness(managedEvent({invitees:[invite]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'↻ Change response').onclick();const row=invitationRow(f,'Alex');assert.equal(rowField(f,row,'count').disabled,true);assert.equal(rowField(f,row,'count').value,String(fields.participants || 1));assert.match(textOf(f,row),fields.participantMode==='fixed'?/count is fixed/:/for one person/);
  }
});

test('response errors keep the selected guest and notification choice and reuse the request on retry',async()=>{
  const invite=managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}]),f=await harness(managedEvent({invitees:[invite]}),{invitationError:{message:'This guest is already checked in.'}});await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'↻ Change response').onclick();let row=invitationRow(f,'Alex');rowField(f,row,'status').value='no';rowField(f,row,'status').onchange();rowField(f,row,'notify').checked=true;rowField(f,row,'notify').onchange();await rowAction(f,row,'Save response').onclick();
  row=invitationRow(f,'Alex');assert.equal(rowField(f,row,'userId').value,'18');assert.equal(rowField(f,row,'status').value,'no');assert.equal(rowField(f,row,'notify').checked,true);assert.match(f.ids.get('invitation-links-status').textContent,/already checked in/);assert.equal(f.getEvent().invitees[0].responses[0].status,'yes');
  f.setInvitationError(null);await rowAction(f,row,'Save response').onclick();const requests=f.calls.filter(call=>call.path.endsWith('/invitations/response'));assert.equal(requests[0].body.requestId,requests[1].body.requestId);assert.equal(f.getEvent().invitees[0].responses[0].status,'no');
});

test('revoked invitations are filterable, retain history and cannot be copied, shared or edited',async()=>{
  const active=managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}]),archived={...managedInvite('Sam',12,[{id:19,name:'Sam',status:'yes',participants:4}]),revoked:true,history:[{type:'created',at:'2026-10-07T00:00:00Z'},{type:'revoked',at:'2026-10-08T00:00:00Z'}]};
  const f=await harness(managedEvent({invitees:[active],revokedInvitees:[archived]}));await f.findButton('event-list','✉️ Guest invitations').onclick();assert.match(f.ids.get('invitation-links-summary').textContent,/1 invitations · 1 responses · 2 people accepted · 1 revoked/);
  const row=invitationRow(f,'Sam');assert.equal(rowAction(f,row,'Sam').disabled,true);for(const label of ['Copy invite','Copy link','📤 Share invite','✏️ Edit invite','↻ Change response','🚫 Revoke invite'])assert.equal(rowAction(f,row,label),undefined);await rowAction(f,row,'Sam').onclick();assert.equal(f.copied.length,0);
  f.ids.get('invitation-links-filter').value='yes';f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),['Alex']);f.ids.get('invitation-links-filter').value='revoked';f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),['Sam']);await rowAction(f,row,'🕘 See history').onclick();assert.match(textOf(f,invitationRow(f,'Sam')),/Invitation revoked/);
});

test('deleting an archived invitation can be cancelled and only deletes the selected revoked row',async()=>{
  const archived={...managedInvite('Sam',12),revoked:true,history:[{type:'revoked',at:'2026-10-08T00:00:00Z'}]},other={...managedInvite('Taylor',13),revoked:true},active=managedInvite('Alex',11),f=await harness(managedEvent({invitees:[active],revokedInvitees:[archived,other]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  await rowAction(f,invitationRow(f,'Sam'),'🗑 Delete invite').onclick();await rowAction(f,invitationRow(f,'Sam'),'Back').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/delete')).length,0);assert.deepEqual(f.getEvent().revokedInvitees,[archived,other]);
  await rowAction(f,invitationRow(f,'Sam'),'🗑 Delete invite').onclick();assert.match(textOf(f,invitationRow(f,'Sam')),/audit records are retained/);await rowAction(f,invitationRow(f,'Sam'),'Delete permanently').onclick();const request=f.calls.find(call=>call.path.endsWith('/invitations/delete'));assert.equal(request.body.token,archived.token);assert.equal(request.body.confirm,true);assert.deepEqual(f.getEvent().invitees,[active]);assert.deepEqual(f.getEvent().revokedInvitees,[other]);assert.equal(invitationRow(f,'Sam'),undefined);
});

test('invitation history displays tracked actions, exact timestamps and attendee changes in the profile timezone',async()=>{
  const types=['created','opened','responded','changed','edited','revoked'],history=types.map((type,index)=>({type,at:'2026-10-08T0'+index+':00:00Z',name:index===4?'Alex Smith':'Alex',...(index===3?{status:'no',previousStatus:'yes',actorRole:'organiser',notify:true}:{}),...(index===4?{previousName:'Alex',participants:3,previousParticipants:2,participantMode:'fixed',previousParticipantMode:'preset',actorRole:'organiser'}:{}),...(index===5?{notify:false}:{})}));
  const f=await harness(managedEvent({invitees:[{...managedInvite('Alex',11),history}]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'🕘 See history').onclick();const row=invitationRow(f,'Alex'),text=textOf(f,row),times=f.descendants(rowPanel(f,row)).filter(node=>node.tag==='time');
  for(const label of ['Invite created','Invitation opened','Response received','Response changed','Invite edited','Invitation revoked','Times shown in Australia/Sydney.','Accepted → Declined','Alex → Alex Smith','2 → 3 people','Guest can change count → Fixed count','Notification requested','Guest not notified'])assert.ok(text.includes(label),label);
  assert.equal(times.length,history.length);for(let i=0;i<times.length;i++){assert.equal(times[i].attributes.datetime,new Date(history[i].at).toISOString());assert.equal(times[i].textContent,new Intl.DateTimeFormat(undefined,{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'}).format(new Date(history[i].at)));}assert.doesNotMatch(text,/Earlier activity/);
});

test('legacy invitation history explains missing records without inventing creation or open times',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'🕘 See history').onclick();const row=invitationRow(f,'Alex');assert.match(textOf(f,row),/No recorded history yet. Earlier activity isn’t available/);assert.equal(f.descendants(row).filter(node=>node.tag==='time').length,0);assert.doesNotMatch(textOf(f,row),/Invite created|Invitation opened/);
});

test('current invitation responses stay visible without expanding details and distinguish opened from Respond later',async()=>{
  const names=[['Accepted','yes',true],['Declined','no',true],['Maybe','maybe',true],['Respond later','later',true],['Awaiting response','later',false]];
  const guests=names.map(([name,status,responded],i)=>managedInvite(name,i+21,[{id:i+101,name,status,responded,respondedAt:null,participants:status==='yes'?2:0}]));guests.push(managedInvite('Unopened',30));
  const f=await harness(managedEvent({invitees:guests}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  for(const [name] of names){const row=invitationRow(f,name),status=row.children.find(node=>node.className==='invitation-current-status'),badge=f.descendants(status).find(node=>node.className==='invitation-status');assert.ok(status);assert.notEqual(status.hidden,true);assert.equal(badge.textContent,name);assert.equal(badge.attributes['aria-label'],'Current response: '+name);assert.equal(f.descendants(status).some(node=>node.tag==='time'),false);}
  const unopened=invitationRow(f,'Unopened'),badge=f.descendants(unopened).find(node=>node.className==='invitation-status');assert.equal(badge.textContent,'Not opened');
  f.ids.get('invitation-links-filter').value='later';f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),['Respond later']);f.ids.get('invitation-links-filter').value='unanswered';f.ids.get('invitation-links-filter').onchange();assert.deepEqual(visibleInvitations(f),['Respond later','Awaiting response','Unopened']);
});

test('mixed reusable invitations show the latest genuine response and each guest response time',async()=>{
  const first='2026-10-08T01:00:00Z',last='2026-10-08T02:00:00Z',invite={...managedInvite('Team',11,[{id:18,name:'Alex',status:'yes',responded:true,respondedAt:first,participants:2},{id:19,name:'Sam',status:'no',responded:true,respondedAt:last,participants:0}]),history:[{type:'responded',at:first,userId:18,status:'yes'},{type:'changed',at:last,userId:19,status:'no'},{type:'edited',at:'2026-10-09T00:00:00Z',name:'Team'}]};
  const f=await harness(managedEvent({oneTimeInvite:false,invitees:[invite]}));await f.findButton('event-list','✉️ Guest invitations').onclick();const row=invitationRow(f,'Team'),status=row.children.find(node=>node.className==='invitation-current-status'),badge=f.descendants(status).find(node=>node.className==='invitation-status'),time=f.descendants(status).find(node=>node.tag==='time');assert.equal(badge.textContent,'Mixed responses · 2 guests');assert.equal(badge.dataset.status,'mixed');assert.equal(time.attributes.datetime,new Date(last).toISOString());assert.equal(time.textContent,'Last response: '+new Intl.DateTimeFormat(undefined,{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'}).format(new Date(last)));
  const details=f.descendants(row).find(node=>node.className==='invitation-responses');assert.equal(details.open,false);assert.deepEqual(f.descendants(details).filter(node=>node.tag==='time').map(node=>node.attributes.datetime),[first,last].map(at=>new Date(at).toISOString()));assert.match(textOf(f,details),/Alex: Accepted/);assert.match(textOf(f,details),/Sam: Declined/);
});

test('legacy accepted and newly opened invitations do not invent a last-response timestamp',async()=>{
  const legacy=managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}]),opened={...managedInvite('Sam',12,[{id:19,name:'Sam',status:'later',responded:false,respondedAt:null,participants:0}]),history:[{type:'opened',at:'2026-10-08T01:00:00Z',userId:19},{type:'edited',at:'2026-10-09T00:00:00Z',name:'Sam'}]};
  const f=await harness(managedEvent({invitees:[legacy,opened]}));await f.findButton('event-list','✉️ Guest invitations').onclick();for(const name of ['Alex','Sam']){const row=invitationRow(f,name);assert.equal(f.descendants(row).filter(node=>node.tag==='time').length,0);assert.doesNotMatch(textOf(f,row),/Last response:/);}
});

test('a manager access change during refresh closes the invitation dialog and clears private rows',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();f.setEvent({...f.getEvent(),isOwner:false,isManager:false,isCoHost:false,invitees:[]});await f.ids.get('invitation-links-refresh').onclick();assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(invitationRows(f).length,0);assert.match(f.ids.get('notice').textContent,/management access has changed/);
});

test('refresh closes an edit or response form when another manager revokes that invitation',async()=>{
  for(const label of ['✏️ Edit invite','↻ Change response']){
    const invite=managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}]),f=await harness(managedEvent({invitees:[invite]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),label).onclick();assert.equal(rowPanel(f,invitationRow(f,'Alex')).hidden,false);
    f.setEvent({...f.getEvent(),invitationsVersion:'1111111111111111',invitees:[],revokedInvitees:[{...invite,revoked:true}]});await f.ids.get('invitation-links-refresh').onclick();const row=invitationRow(f,'Alex');assert.equal(rowPanel(f,row).hidden,true);assert.equal(rowAction(f,row,'Save invite'),undefined);assert.equal(rowAction(f,row,'Save response'),undefined);assert.equal(rowAction(f,row,'Alex').disabled,true);
  }
});

test('closing while a response change is pending prevents a late result from reopening its form',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11,[{id:18,name:'Alex',status:'yes',participants:2}])]}));await f.findButton('event-list','✉️ Guest invitations').onclick();await rowAction(f,invitationRow(f,'Alex'),'↻ Change response').onclick();const row=invitationRow(f,'Alex');rowField(f,row,'status').value='maybe';rowField(f,row,'status').onchange();const release=f.holdNextInvitationMutation(),saving=rowAction(f,row,'Save response').onclick();f.ids.get('invitation-links-close').onclick();release();await saving;assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(f.getEvent().invitees[0].responses[0].status,'maybe');await f.findButton('event-list','✉️ Guest invitations').onclick();assert.match(textOf(f,invitationRow(f,'Alex')),/Maybe/);assert.equal(rowPanel(f,invitationRow(f,'Alex')).hidden,true);
});

test('one-by-one guests append to an unsaved event list and preserve every attendee setting',async()=>{
  const f=await harness(managedEvent());f.ids.get('hero-create').onclick();
  f.ids.get('invitation-mode').value='named';f.ids.get('invitation-mode').onchange();f.ids.get('guest-names').value='Existing = 2!';
  assert.deepEqual(f.ids.get('guest-single-count').children.map(option=>option.value),Array.from({length:10},(_,i)=>String(i+1)));
  for(const [name,mode,count,line] of [['One','one','1','One'],['Ask','ask','1','Ask = ?'],['Change','editable','3','Change = 3'],['Confirm','confirm','2','Confirm = 2!'],['Fixed','fixed','10','Fixed = 10*']]){
    f.ids.get('guest-single-name').value=name;f.ids.get('guest-single-mode').value=mode;f.ids.get('guest-single-mode').onchange();f.ids.get('guest-single-count').value=count;
    assert.equal(f.ids.get('guest-single-count-field').hidden,['one','ask'].includes(mode));
    await f.ids.get('guest-single-add').onclick();assert.ok(f.ids.get('guest-names').value.endsWith(line));assert.equal(f.ids.get('guest-single-name').value,'');
  }
  assert.equal(f.ids.get('guest-names').value,'Existing = 2!\nOne\nAsk = ?\nChange = 3\nConfirm = 2!\nFixed = 10*');
  assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/add')).length,0);
});

test('individual guest controls reject duplicate names, malformed names, invalid counts and the guest limit without losing drafts',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11,[{id:8,name:'Alex',status:'yes',participants:2}])]}));
  await f.findButton('event-list','✏️ Edit event').onclick();const original=f.ids.get('guest-names').value;
  f.ids.get('guest-single-name').value='alex';await f.ids.get('guest-single-add').onclick();assert.match(f.ids.get('guest-single-status').textContent,/already in the list/);assert.equal(f.ids.get('guest-names').value,original);
  f.ids.get('guest-single-name').value='Bad = 2';await f.ids.get('guest-single-add').onclick();assert.match(f.ids.get('guest-single-status').textContent,/without =/);
  f.ids.get('guest-single-name').value='Sam';f.ids.get('guest-single-mode').value='fixed';f.ids.get('guest-single-count').value='11';await f.ids.get('guest-single-add').onclick();assert.match(f.ids.get('guest-single-status').textContent,/1 to 10/);assert.equal(f.ids.get('guest-names').value,original);
  f.ids.get('guest-single-count').value='2';f.ids.get('guest-names').value=Array.from({length:100},(_,i)=>'Guest '+i).join('\n');await f.ids.get('guest-single-add').onclick();assert.match(f.ids.get('guest-single-status').textContent,/100 invitations/);assert.equal(f.ids.get('guest-single-name').value,'Sam');
});

test('individual invitation additions use current versions, preserve existing responses and keep a separate bulk draft',async()=>{
  const original=managedInvite('Alex',11,[{id:9,name:'Alex',status:'yes',participants:2}]);
  const f=await harness(managedEvent({isOwner:false,isCoHost:true,invitees:[original]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  f.ids.get('invitation-add-names').value='Bulk draft = ?';f.ids.get('invitation-single-name').value='Taylor';f.ids.get('invitation-single-mode').value='fixed';f.ids.get('invitation-single-mode').onchange();f.ids.get('invitation-single-count').value='4';
  await f.ids.get('invitation-single-add').onclick();
  const request=f.calls.find(call=>call.path.endsWith('/invitations/add'));assert.equal(request.body.guestNames,'Taylor = 4*');assert.equal(request.body.version,'0000000000000000');assert.match(request.body.requestId,/^[a-f0-9-]{36}$/i);
  assert.deepEqual(f.getEvent().invitees[0],original);assert.equal(f.getEvent().invitees[1].participantMode,'fixed');assert.equal(f.ids.get('invitation-add-names').value,'Bulk draft = ?');assert.equal(f.ids.get('invitation-single-name').value,'');
  f.ids.get('invitation-single-name').value='Alex';await f.ids.get('invitation-single-add').onclick();assert.match(f.ids.get('invitation-single-status').textContent,/already in the list/);assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/add')).length,1);
});

test('individual invitation errors preserve settings and reuse the idempotency request when retried',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}),{invitationError:{message:'Please try again.'}});await f.findButton('event-list','✉️ Guest invitations').onclick();
  f.ids.get('invitation-single-name').value='Sam';f.ids.get('invitation-single-mode').value='confirm';f.ids.get('invitation-single-count').value='3';await f.ids.get('invitation-single-add').onclick();
  assert.equal(f.ids.get('invitation-single-name').value,'Sam');assert.equal(f.ids.get('invitation-single-mode').value,'confirm');assert.equal(f.ids.get('invitation-single-count').value,'3');assert.match(f.ids.get('invitation-single-status').textContent,/Please try again/);
  f.setInvitationError(null);await f.ids.get('invitation-single-add').onclick();const requests=f.calls.filter(call=>call.path.endsWith('/invitations/add'));assert.equal(requests[0].body.requestId,requests[1].body.requestId);assert.equal(f.getEvent().invitees.length,2);
});

test('guest roster opens manual additions and revokes the exact invitation mapped by response ID',async()=>{
  const wrong=managedInvite('Alex',11,[{id:18,name:'Sam',status:'yes',participants:2}]),right=managedInvite('Sam',12,[{id:19,name:'Alex',status:'maybe',participants:0}]);
  const f=await harness(managedEvent({invitees:[wrong,right],guestRoster:[{id:19,name:'Alex',status:'maybe',participants:0},{id:null,name:'Unopened',status:'unopened',participants:0}]}));
  await f.findButton('event-list','👥 Guest list').onclick();assert.equal(f.ids.get('guest-list-add').hidden,false);
  await f.findButton('guest-list-rows','🚫 Revoke invitation').onclick();assert.equal(f.ids.get('guest-list-dialog').open,false);assert.equal(f.ids.get('invitation-links-dialog').open,true);
  const row=invitationRow(f,'Sam');assert.equal(rowPanel(f,row).hidden,false);assert.equal(rowPanel(f,invitationRow(f,'Alex')).hidden,true);
  await rowAction(f,row,'Revoke invite').onclick();assert.equal(f.calls.find(call=>call.path.endsWith('/invitations/revoke')).body.token,right.token);
  f.ids.get('invitation-links-close').onclick();await f.findButton('event-list','👥 Guest list').onclick();await f.ids.get('guest-list-add').onclick();assert.equal(f.ids.get('guest-list-dialog').open,false);assert.equal(f.ids.get('invitation-add').open,true);assert.equal(f.ids.get('invitation-single').open,true);assert.equal(f.ids.get('invitation-single-name').focused,true);
});

test('ticket-booking guest rosters omit named-invite add and revoke controls',async()=>{
  const f=await harness(managedEvent({invitationMode:'tickets',invitees:[],guestRoster:[{id:19,name:'Alex',status:'yes',participants:1,confirmed:true}]}));await f.findButton('event-list','👥 Guest list').onclick();
  assert.equal(f.ids.get('guest-list-add').hidden,true);assert.equal(f.ids.get('guest-list-invitations').hidden,true);assert.equal(f.findButton('guest-list-rows','🚫 Revoke invitation'),undefined);assert.ok(f.ids.get('guest-list-manage').onclick);
});

test('individual additions share the mutation guard and cannot update a closed invitation dialog',async()=>{
  const f=await harness(managedEvent({invitees:[managedInvite('Alex',11)]}));await f.findButton('event-list','✉️ Guest invitations').onclick();
  const release=f.holdNextInvitationMutation();f.ids.get('invitation-single-name').value='Sam';const adding=f.ids.get('invitation-single-add').onclick();
  assert.equal(f.ids.get('invitation-single-add').disabled,true);assert.equal(f.ids.get('invitation-add-submit').disabled,true);assert.equal(f.ids.get('invitation-single-mode').disabled,true);
  await rowAction(f,invitationRow(f,'Alex'),'🚫 Revoke invite').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/revoke')).length,0);
  f.ids.get('invitation-links-close').onclick();release();await adding;assert.equal(f.ids.get('invitation-links-dialog').open,false);assert.equal(f.ids.get('invitation-single-name').value,'Sam');
  await f.findButton('event-list','✉️ Guest invitations').onclick();assert.ok(invitationRow(f,'Sam'));assert.equal(f.ids.get('invitation-single-name').value,'');assert.equal(f.ids.get('invitation-single-add').disabled,false);
});

test('unopened roster revocation uses its personal link and finished events disable guest mutations',async()=>{
  const invite=managedInvite('Alex',11),f=await harness(managedEvent({invitees:[invite],guestRoster:[{id:null,name:'Alex',status:'unopened',participants:0}]}));
  await f.findButton('event-list','👥 Guest list').onclick();await f.findButton('guest-list-rows','🚫 Revoke invitation').onclick();
  const row=invitationRow(f,'Alex');assert.equal(rowPanel(f,row).hidden,false);assert.equal(rowField(f,row,'notify').disabled,true);
  f.ids.get('invitation-links-close').onclick();f.setEvent({...f.getEvent(),group:'Past events'});await f.findButton('event-list','👥 Guest list').onclick();assert.equal(f.ids.get('guest-list-add').disabled,true);assert.equal(f.findButton('guest-list-rows','🚫 Revoke invitation').disabled,true);
  await f.ids.get('guest-list-invitations').onclick();assert.equal(f.ids.get('invitation-single-add').disabled,true);assert.equal(f.ids.get('invitation-add-submit').disabled,true);await f.ids.get('invitation-single-add').onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/invitations/add')).length,0);
});

test('the edit page exposes cancel and delete only to the owner and hides them for new events',async()=>{
  const owner=await harness(eventFixture());
  await owner.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(owner.ids.get('edit-event-actions').hidden,false);
  assert.equal(owner.ids.get('edit-cancel-event').disabled,false);
  assert.equal(owner.ids.get('create-view').hidden,false);
  owner.ids.get('hero-create').onclick();
  assert.equal(owner.ids.get('edit-event-actions').hidden,true);
  assert.equal(await owner.ids.get('edit-cancel-event').onclick(),null);
  assert.equal(owner.ids.get('event-end-dialog').open,false);

  const cohost=await harness(eventFixture({isOwner:false,isCoHost:true}));
  await cohost.findButton('event-list','✏️ Edit event').onclick();
  assert.equal(cohost.ids.get('edit-event-actions').hidden,true);
  assert.equal(await cohost.ids.get('edit-cancel-event').onclick(),false);
  assert.equal(await cohost.ids.get('edit-delete-event').onclick(),false);
  assert.equal(cohost.ids.get('event-end-dialog').open,false);
  assert.equal(cohost.calls.filter(call=>/\/(?:cancel|delete)$/.test(call.path)).length,0);
});

test('edit cancellation can delete in one request and clears the stale editor and cached event',async()=>{
  const original=eventFixture(),f=await harness(original);
  await f.findButton('event-list','✏️ Edit event').onclick();
  f.ids.get('title').value='Unsaved title';
  const ending=f.ids.get('edit-cancel-event').onclick();
  assert.equal(f.ids.get('event-end-dialog').open,true);
  assert.equal(f.ids.get('event-end-name').textContent,original.title);
  f.ids.get('event-end-delete').checked=true;
  f.ids.get('event-end-delete').onchange();
  await f.ids.get('event-end-confirm').onclick();
  assert.equal(await ending,true);
  const mutations=f.calls.filter(call=>/\/(?:cancel|delete)$/.test(call.path));
  assert.deepEqual(mutations,[{path:'/api/events/'+original.id+'/delete',body:{confirm:true}}]);
  assert.equal(f.getEvent(),original,'the mock still returns the old event on refresh');
  assert.equal(f.calls.filter(call=>call.path==='/api/bootstrap').length,2);
  assert.equal(f.ids.get('event-end-dialog').open,false);
  assert.equal(f.ids.get('event-form').hidden,true);
  assert.equal(f.ids.get('create-view').hidden,true);
  assert.equal(f.ids.get('events-view').hidden,false);
  assert.equal(f.descendants(f.ids.get('event-list')).filter(node=>node.tag==='article').length,0);
  assert.equal(f.findButton('event-list','✏️ Edit event'),undefined);
  assert.equal(await f.ids.get('edit-cancel-event').onclick(),null,'the stale edit target was cleared');
  assert.equal(f.calls.filter(call=>/\/(?:cancel|delete)$/.test(call.path)).length,1);
  f.ids.get('hero-create').onclick();
  assert.equal(f.ids.get('edit-event-actions').hidden,true);
  assert.equal(f.ids.get('title').value,'');
  assert.equal(f.ids.get('form-title').textContent,'Make a plan.');
});

test('edit cancellation keeps the record unless delete is explicitly selected',async()=>{
  const original=eventFixture(),f=await harness(original);
  await f.findButton('event-list','✏️ Edit event').onclick();
  const ending=f.ids.get('edit-cancel-event').onclick();
  assert.equal(f.ids.get('event-end-delete').checked,false);
  await f.ids.get('event-end-confirm').onclick();
  assert.equal(await ending,true);
  assert.deepEqual(f.calls.filter(call=>/\/(?:cancel|delete)$/.test(call.path)),[{path:'/api/events/'+original.id+'/cancel',body:{confirm:true}}]);
  assert.equal(f.ids.get('event-form').hidden,true);
  assert.equal(f.descendants(f.ids.get('event-list')).filter(node=>node.tag==='article').length,0);
  assert.match(f.ids.get('notice').textContent,/Event cancelled/);
});

test('edit delete opens the dedicated permanent deletion dialog and honours Keep event',async()=>{
  const f=await harness(eventFixture());
  await f.findButton('event-list','✏️ Edit event').onclick();
  const keeping=f.ids.get('edit-delete-event').onclick();
  assert.equal(f.ids.get('event-end-title').textContent,'Delete event?');
  assert.equal(f.ids.get('event-end-delete-option').hidden,true);
  assert.match(f.ids.get('event-end-message').textContent,/Permanently remove/);
  f.ids.get('event-end-back').onclick();
  assert.equal(await keeping,false);
  assert.equal(f.ids.get('event-form').hidden,false);
  assert.equal(f.ids.get('create-view').hidden,false);
  assert.equal(f.calls.filter(call=>/\/(?:cancel|delete)$/.test(call.path)).length,0);
  const deleting=f.ids.get('edit-delete-event').onclick();
  await f.ids.get('event-end-confirm').onclick();
  assert.equal(await deleting,true);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/delete')).length,1);
  assert.equal(f.ids.get('event-form').hidden,true);
});
