import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGallery} from '../public/gallery.js';

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
