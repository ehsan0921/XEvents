import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGallery} from '../public/gallery.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function galleryHarness(t,api=async()=>({title:'Club meetup',media:[],canUpload:false})){
  class Node{
    constructor(tag='div',text=''){this.tagName=tag.toUpperCase();this.textContent=text;this.children=[];this.attributes={};this.isConnected=true;this.open=false;this.opens=0;this.pauses=0;this.loads=0;}
    append(...children){this.children.push(...children);}
    prepend(...children){this.children.unshift(...children);}
    replaceChildren(...children){for(const child of this.children)child.isConnected=false;this.children=children;}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];delete this[key];}
    remove(){this.isConnected=false;}
    showModal(){this.open=true;this.opens++;}
    close(){this.open=false;this.onclose?.();}
    pause(){this.pauses++;}
    load(){this.loads++;}
  }
  const globals={document:globalThis.document,IntersectionObserver:globalThis.IntersectionObserver,fetch:globalThis.fetch};
  t.after(()=>{for(const [name,value] of Object.entries(globals)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
  globalThis.document={createElement:tag=>new Node(tag)};
  const observers=[];
  globalThis.IntersectionObserver=class{
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(node){this.node=node;}
    disconnect(){}
    intersect(){return this.callback([{isIntersecting:true,target:this.node}]);}
  };
  const fetches=[],calls=[],notices=[],routes=[],nodes=new Map();
  let fetchResult=()=>Promise.resolve(new Response(new Blob(['fictional media'],{type:'video/mp4'})));
  globalThis.fetch=(...args)=>{fetches.push(args);return fetchResult(...args);};
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const element=(tag,text='',className='')=>Object.assign(new Node(tag,text),{className});
  const action=(text,onclick)=>Object.assign(new Node('button',text),{onclick});
  const controls=setupGallery({$,api:(...args)=>{calls.push(args);return api(...args);},element,action,go:route=>routes.push(route),notice:message=>notices.push(message),openTelegram(){},initData:'fictional-init-data'});
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  return {$,calls,notices,routes,fetches,observers,...controls,setFetch(fn){fetchResult=fn;},button:text=>descendants($('gallery-list')).find(node=>node.tagName==='BUTTON' && node.textContent===text)};
}

test('opening another gallery clears the previous event upload action while loading and after failure',async()=>{
  const nodes=new Map();
  const $=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,onclick:null,children:[],replaceChildren(...children){this.children=children;}});
    return nodes.get(id);
  };
  let rejectSecond;
  const second=new Promise((resolve,reject)=>{rejectSecond=reject;});
  const opened=[];
  const {openGallery}=setupGallery({$,api:path=>path==='events/first/gallery' ? Promise.resolve({title:'First event',media:[],canUpload:true,uploadUrl:'https://t.me/test?start=upload_first'}) : second,element:(tag,text)=>({tag,text}),action(){},go(){},notice(){},openTelegram:url=>opened.push(url),initData:'test'});

  await openGallery('first');
  assert.equal($('gallery-title').textContent,'First event');
  assert.equal($('gallery-upload').hidden,false);
  $('gallery-upload').onclick();
  assert.deepEqual(opened,['https://t.me/test?start=upload_first']);

  const loading=openGallery('second');
  assert.equal($('gallery-upload').hidden,true);
  assert.equal($('gallery-upload').onclick,null);
  assert.equal($('gallery-title').textContent,'Shared media');
  assert.equal($('gallery-summary').textContent,'Loading files…');

  rejectSecond(new Error('Gallery unavailable.'));
  await loading;
  assert.equal($('gallery-upload').hidden,true);
  assert.equal($('gallery-upload').onclick,null);
  assert.equal($('gallery-summary').textContent,'');
  assert.equal($('gallery-error').hidden,false);
  assert.equal($('gallery-error').textContent,'Gallery unavailable.');
});

test('closing the page ignores a late gallery response and leaves its upload action disabled',async t=>{
  const pending=deferred(),f=galleryHarness(t,()=>pending.promise);
  const loading=f.openGallery('first');
  f.dismissPendingMedia();
  pending.resolve({title:'Late private event',media:[],canUpload:true,uploadUrl:'https://t.me/fictional_bot?start=late'});
  await loading;
  assert.equal(f.$('gallery-title').textContent,'Shared media');
  assert.equal(f.$('gallery-upload').hidden,true);assert.equal(f.$('gallery-upload').onclick,null);
  assert.equal(f.$('photo-dialog').opens,0);assert.equal(f.$('qr-dialog').opens,0);
  assert.deepEqual(f.routes,['gallery']);assert.deepEqual(f.notices,[]);
});

test('closing the page cancels a pending QR popup while a later explicit request still opens',async t=>{
  const pending=deferred(),qr={image:'data:image/gif;base64,R0lG',link:'https://t.me/fictional_bot?start=upload',anyone:false};
  const f=galleryHarness(t,path=>path.includes('/first/')?pending.promise:Promise.resolve(qr));
  const loading=f.showQr('first');f.dismissPendingMedia();pending.resolve(qr);await loading;
  assert.equal(f.$('qr-dialog').opens,0);assert.equal(f.$('qr-dialog').open,false);
  await f.showQr('second');assert.equal(f.$('qr-dialog').opens,1);assert.equal(f.$('qr-dialog').open,true);
  f.dismissPendingMedia();assert.equal(f.$('qr-dialog').open,false);
  assert.ok(f.calls.every(([,body])=>body===undefined),'Closing a QR popup must not write anything.');
});

test('a delayed video preview cannot reopen after leaving and closing a playing preview stops video',async t=>{
  const video={id:'111111111111',type:'video',filename:'club-video.mp4',name:'Fictional guest',hasThumbnail:false};
  const f=galleryHarness(t,async()=>({title:'Club meetup',media:[video],canUpload:false}));
  await f.openGallery('first');
  const pending=deferred();f.setFetch(()=>pending.promise);
  const loading=f.button('Play video').onclick();
  f.dismissPendingMedia();pending.resolve(new Response(new Blob(['fictional video'],{type:'video/mp4'})));await loading;
  assert.equal(f.$('photo-dialog').opens,0);
  await f.openGallery('second');
  f.setFetch(()=>Promise.resolve(new Response(new Blob(['fictional video'],{type:'video/mp4'}))));
  await f.button('Play video').onclick();
  assert.equal(f.$('photo-dialog').open,true);assert.ok(f.$('video-full').src);
  f.dismissPendingMedia();
  assert.equal(f.$('photo-dialog').open,false);assert.equal(f.$('video-full').src,undefined);
  assert.equal(f.$('video-full').pauses,1);assert.equal(f.$('video-full').loads,1);
  assert.ok(f.calls.every(([,body])=>body===undefined),'Closing a preview must not send or change event files.');
});

test('closing a photo popup suppresses an older pending preview without blocking a new click',async t=>{
  const photo={id:'222222222222',type:'photo',filename:'club-photo.jpg',name:'Fictional guest',hasThumbnail:true};
  const f=galleryHarness(t,async()=>({title:'Club meetup',media:[photo],canUpload:false}));
  await f.openGallery('first');await f.observers[0].intersect();
  const image=f.observers[0].node;
  await image.onclick();assert.equal(f.$('photo-dialog').opens,1);
  const pending=deferred();f.setFetch(()=>pending.promise);
  const loading=image.onclick();f.$('photo-close').onclick();
  pending.resolve(new Response(new Blob(['fictional photo'],{type:'image/jpeg'})));await loading;
  assert.equal(f.$('photo-dialog').opens,1);assert.equal(f.$('photo-dialog').open,false);
  f.setFetch(()=>Promise.resolve(new Response(new Blob(['fictional photo'],{type:'image/jpeg'}))));
  await image.onclick();assert.equal(f.$('photo-dialog').opens,2);assert.equal(f.$('photo-dialog').open,true);
  f.dismissPendingMedia();
});
