import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {setupGallery} from '../public/gallery.js';

const eventFixture=fields=>({id:'0123456789abcdef',title:'Club evening',location:'Club house',description:'Meet the team',isOwner:true,isManager:true,isCoHost:false,cohost:null,cohostInviteUrl:null,cohostVersion:'none',invitationMode:'named',invitees:[{name:'Alex',participants:2,url:'https://t.me/test?start=guest'}],group:'Upcoming events',upcoming:true,startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',localDate:'2099-10-24',localTime:'18:00',permissions:{},qrEnabled:true,uploadLink:'https://t.me/test?start=upload',paymentMethod:'stars',starPrice:100,starPricing:'person',paymentTerms:'Admission for one person.',...fields});

async function harness(initial){
  class El{
    constructor(tag=''){this.tag=tag;this.children=[];this.dataset={};this.value='';this.files=[];this.attributes={};this.open=false;this.classList={toggle(){},add(){},remove(){}};}
    append(...children){this.children.push(...children);this.firstChild=this.children[0];}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(){} reset(){} focus(){} setCustomValidity(value){this.validation=value;} querySelector(){return new El();}
    showModal(){this.open=true;}
    close(){this.open=false;this.onclose?.();}
  }
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new El()]));
  const tabs=[...html.matchAll(/data-tab="([^"]+)"/g)].map(match=>{const el=match[1]==='admin'?ids.get('admin-tab'):new El();el.dataset.tab=match[1];return el;});
  const document={body:new El(),getElementById:id=>ids.get(id),createElement:tag=>new El(tag),addEventListener(){},querySelector:selector=>selector==='.bottom-nav'?new El():tabs.find(el=>selector.includes('"'+el.dataset.tab+'"')),querySelectorAll:selector=>selector==='[data-tab]'?tabs:[]};
  const telegramLinks=[],copied=[],calls=[],errors=[];
  const window={Telegram:{WebApp:{initData:'test-session',ready(){},expand(){},onEvent(){},openTelegramLink:url=>telegramLinks.push(url)}},scrollTo(){},reportAppError:error=>errors.push(error.message)};
  let event=initial,token=0;
  const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,blob:async()=>new Blob(['image'],{type:'image/jpeg'})});
  const fetcher=async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({path,body});
    if(path==='/api/bootstrap')return response({user:{id:initial.isOwner?1:2,firstName:'User',isSuperAdmin:false},preference:{timezone:'Australia/Sydney'},pricing:{rates:{}},currencyCodes:['AUD'],events:[event]});
    if(path.startsWith('/api/explore?'))return response({events:[]});
    if(path==='/api/branding/icon')return response({error:'Not found'},404);
    if(path==='/api/events/'+event.id)return response({event});
    if(path.endsWith('/cohost/invite') || path.endsWith('/cohost/revoke')){
      if(body.version!==event.cohostVersion)return response({error:'Co-host changed. Review the current co-host.'},409);
      event=path.endsWith('/invite') ? {...event,cohostInviteUrl:'https://t.me/test?start=cohost_'+(++token),cohostVersion:'pending:'+token} : {...event,cohost:null,cohostInviteUrl:null,cohostVersion:'none'};
      return response({event});
    }
    if(path.endsWith('/schedule')){event={...event,...body};return response({event});}
    if(path==='/api/preview')return response({startsAt:event.startsAt,timezone:event.timezone});
    return response({});
  };
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace("import { setupGallery } from './gallery.js';",'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('window','document','location','fetch','crypto','navigator','setupGallery',source)(window,document,{search:''},fetcher,webcrypto,{clipboard:{writeText:async text=>copied.push(text)}},setupGallery);
  await new Promise(resolve=>setImmediate(resolve));
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  const findButton=(id,label)=>descendants(ids.get(id)).find(node=>node.tag==='button' && node.textContent===label);
  return {ids,calls,errors,copied,telegramLinks,findButton,descendants,setEvent:value=>{event=value;},getEvent:()=>event};
}

test('co-host events expose management actions and keep payment fields read-only',async()=>{
  const f=await harness(eventFixture({isOwner:false,isCoHost:true}));
  for(const label of ['Edit event','Guest list','Scan tickets','Guest invitations','🗂 Shared media'])assert.ok(f.findButton('event-list',label),label+' should be available');
  for(const label of ['Co-host','Cancel event','Delete event','Payments & refunds'])assert.equal(f.findButton('event-list',label),undefined,label+' should remain owner-only');
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

test('owner can create, copy and share a co-host invite, then cancel its exact version',async()=>{
  const f=await harness(eventFixture());
  await f.findButton('event-list','Co-host').onclick();
  assert.equal(f.ids.get('cohost-dialog').open,true);
  await f.ids.get('cohost-generate').onclick();
  assert.equal(f.calls.find(call=>call.path.endsWith('/cohost/invite')).body.version,'none');
  assert.equal(f.ids.get('cohost-link').textContent,'https://t.me/test?start=cohost_1');
  await f.ids.get('cohost-copy').onclick();assert.equal(f.copied.at(-1),'https://t.me/test?start=cohost_1');
  f.ids.get('cohost-share').onclick();assert.equal(new URL(f.telegramLinks.at(-1)).searchParams.get('url'),'https://t.me/test?start=cohost_1');
  const replace=f.ids.get('cohost-generate').onclick();
  assert.equal(f.ids.get('confirm-title').textContent,'Replace co-host invite?');
  assert.match(f.ids.get('confirm-message').textContent,/previous link will stop working/);
  f.ids.get('confirm-proceed').onclick();await replace;
  assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/invite')).at(-1).body.version,'pending:1');
  assert.equal(f.ids.get('cohost-link').textContent,'https://t.me/test?start=cohost_2');
  const cancel=f.ids.get('cohost-revoke').onclick();
  assert.equal(f.ids.get('confirm-title').textContent,'Cancel co-host invite?');
  assert.match(f.ids.get('confirm-message').textContent,/unused co-host invite/);
  f.ids.get('confirm-proceed').onclick();await cancel;
  assert.equal(f.calls.find(call=>call.path.endsWith('/cohost/revoke')).body.version,'pending:2');
  assert.equal(f.ids.get('cohost-link').hidden,true);
  assert.equal(f.ids.get('cohost-generate').hidden,false);
  assert.equal(f.ids.get('cohost-status').textContent,'Invite link cancelled.');
});

test('a co-host claimed during cancellation is refreshed and cannot be revoked by a stale confirmation',async()=>{
  const f=await harness(eventFixture({cohostInviteUrl:'https://t.me/test?start=cohost_pending',cohostVersion:'pending:old'}));
  await f.findButton('event-list','Co-host').onclick();
  const cancel=f.ids.get('cohost-revoke').onclick();
  f.setEvent({...f.getEvent(),cohostInviteUrl:null,cohost:{id:2,name:'Alex Smith',username:'alex',joinedAt:'2026-10-07T00:00:00Z'},cohostVersion:'active:2:2026-10-07T00:00:00Z'});
  f.ids.get('confirm-proceed').onclick();await cancel;
  assert.equal(f.getEvent().cohost.name,'Alex Smith');
  assert.equal(f.ids.get('cohost-identity').textContent,'Alex Smith · @alex');
  assert.equal(f.ids.get('cohost-generate').hidden,true);assert.equal(f.ids.get('cohost-link').hidden,true);
  assert.match(f.ids.get('cohost-status').textContent,/Review the current co-host/);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).length,1);
  const revoke=f.ids.get('cohost-revoke').onclick();
  assert.match(f.ids.get('confirm-message').textContent,/Remove Alex Smith/);
  f.ids.get('confirm-proceed').onclick();await revoke;
  assert.equal(f.calls.filter(call=>call.path.endsWith('/cohost/revoke')).at(-1).body.version,'active:2:2026-10-07T00:00:00Z');
  assert.equal(f.getEvent().cohost,null);
});

test('claimed co-host without a username shows an explicit fallback and owner payments remain editable',async()=>{
  const f=await harness(eventFixture({cohost:{id:2,name:'Alex',username:null,joinedAt:'2026-10-07T00:00:00Z'},cohostVersion:'active:2:2026-10-07T00:00:00Z'}));
  await f.findButton('event-list','Co-host').onclick();assert.equal(f.ids.get('cohost-identity').textContent,'Alex · No Telegram username');
  f.ids.get('cohost-close').onclick();await f.findButton('event-list','Edit event').onclick();
  assert.equal(f.ids.get('payment-owner-note').hidden,true);assert.equal(f.ids.get('stars-price').disabled,false);assert.equal(f.ids.get('payment-terms').disabled,false);
});
