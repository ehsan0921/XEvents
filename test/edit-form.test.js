import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {setupGallery} from '../public/gallery.js';
import {setupEventActions} from '../public/event-actions.js';

test('editing fetches fresh details, preserves all attendee count modes and invitation message and previews the existing banner',async()=>{
  class El {
    constructor(){this.children=[];this.dataset={};this.value='';this.files=[];this.classList={toggle(){},add(){},remove(){}};}
    append(...items){this.children.push(...items);this.firstChild=this.children[0];}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(){} removeAttribute(){} addEventListener(){} reset(){} focus(){} setCustomValidity(text){this.validation=text;} querySelector(){return new El();}
  }
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace("import { setupGallery } from './gallery.js';",'').replace("import { setupEventActions } from './event-actions.js';",'');
  const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new El()]));
  const tabs=[...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>{const el=m[1]==='admin'?ids.get('admin-tab'):new El();el.dataset.tab=m[1];return el;});
  const nav=new El(),errors=[];
  const document={body:new El(),getElementById:id=>ids.get(id),createElement:()=>new El(),addEventListener(){},querySelector:s=>s==='.bottom-nav'?nav:s==='.section-heading h2'?new El():tabs.find(e=>s.includes('"'+e.dataset.tab+'"')),querySelectorAll:s=>s==='[data-tab]'?tabs:[]};
  const window={Telegram:{WebApp:{initData:'test-session',ready(){},expand(){},onEvent(){}}},scrollTo(){},reportAppError:error=>errors.push(error.message)};
  const event={id:'0123456789abcdef',title:'Saved title',location:'Saved address',description:'Saved description',isOwner:true,invitationMode:'named',inviteMessage:'Come celebrate with us.',qrEnabled:false,invitees:[{name:'Alex',participants:3},{name:'Sam',participantMode:'ask'},{name:'Taylor',participants:2,participantMode:'confirm'},{name:'Jordan',participants:4,participantMode:'fixed'},{name:'Casey'}],hasBanner:true,group:'Upcoming events',startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',localDate:'2099-10-24',localTime:'18:00',permissions:{},paymentMethod:'bank',displayPrice:'AUD $20',paymentInstructions:'Bank reference',paymentTerms:'Refund on cancellation',requireApproval:true};
  const bootstrap={user:{firstName:'Owner',isSuperAdmin:true},preference:{timezone:'Australia/Sydney'},pricing:{rates:{}},currencyCodes:['AUD'],localCurrency:'AUD',events:[{...event,title:'Old cached title'}]};
  const paths=[];
  const fetcher=async path=>{paths.push(path);return {ok:true,status:200,json:async()=>path==='/api/bootstrap'?bootstrap:path==='/api/events/'+event.id?{event}: {localDate:event.localDate,localTime:event.localTime,startsAt:event.startsAt,timezone:event.timezone},blob:async()=>new Blob(['banner'],{type:'image/jpeg'})};};
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('window','document','location','fetch','crypto','navigator','setupGallery','setupEventActions',source)(window,document,{search:'?event='+event.id},fetcher,webcrypto,{},setupGallery,setupEventActions);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,[]);
  assert.ok(paths.includes('/api/events/'+event.id));
  assert.equal(ids.get('title').value,'Saved title');assert.equal(ids.get('location').value,'Saved address');assert.equal(ids.get('description').value,'Saved description');
  assert.equal(ids.has('questions'),false);assert.equal(ids.get('invite-message').value,'Come celebrate with us.');assert.equal(ids.get('qr-enabled').checked,false);assert.equal(ids.get('guest-names').value,'Alex = 3\nSam = ?\nTaylor = 2!\nJordan = 4*\nCasey');
  assert.equal(ids.get('event-details').hidden,false);assert.equal(ids.get('banner-preview').hidden,false);
  assert.match(ids.get('banner-preview').src,/^blob:/);assert.equal(ids.get('payment-terms').validation,'');
  // Switching footer tabs must preserve a partly edited event.
  ids.get('title').value='Unfinished event edit';
  tabs.find(b=>b.dataset.tab==='settings').onclick();
  tabs.find(b=>b.dataset.tab==='create').onclick();
  assert.equal(ids.get('title').value,'Unfinished event edit');
  assert.equal(ids.get('invite-message').value,'Come celebrate with us.');
  // Updating the photo must not overwrite text that has not been saved yet.
  ids.get('profile-name').value='Unsaved profile name';ids.get('profile-phone').value='+61 400 000 000';
  const bootstrapCalls=paths.filter(path=>path==='/api/bootstrap').length;
  await ids.get('profile-photo-remove').onclick();
  assert.equal(ids.get('profile-name').value,'Unsaved profile name');
  assert.equal(ids.get('profile-phone').value,'+61 400 000 000');
  assert.equal(paths.filter(path=>path==='/api/bootstrap').length,bootstrapCalls);
  assert.equal(ids.has('profile-events'),false);
  let prevented=false;ids.get('home-brand').onclick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(ids.get('home-view').hidden,false);
  URL.revokeObjectURL(ids.get('banner-preview').src);
});
