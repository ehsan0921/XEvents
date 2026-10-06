import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function exploreHarness(){
  class El{
    constructor(tag='',text=''){this.tag=tag;this.textContent=text;this.value='';this.dataset={};this.children=[];}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
  }
  const nodes=new Map(['explore-refresh','explore-error','explore-zone','explore-list','explore-search'].map(id=>[id,new El()]));
  const $=id=>nodes.get(id),requests=[];
  let zone='Australia/Sydney';
  const api=path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}));
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('let exploreSequence='),end=source.indexOf('async function loadAdmin()',start);
  assert.ok(start>=0 && end>start,'Explore implementation must be present.');
  const loadExplore=new Function('$','selectedZone','api','element','priceTag','format','priceEstimate','action','openTelegram',source.slice(start,end)+'\nreturn loadExplore;')($,()=>zone,api,(tag,text)=>new El(tag,text),()=>new El('span','Free'),()=> 'Local event time',()=>'',label=>new El('button',label),()=>{});
  return {$,requests,loadExplore,setZone:value=>{zone=value;}};
}

for(const oldResult of ['success','failure'])test(`Explore keeps the latest timezone results when an older request ends with ${oldResult}`,async()=>{
  const {$,requests,loadExplore,setZone}=exploreHarness();
  const older=loadExplore();
  setZone('Europe/London');
  const newer=loadExplore();
  assert.deepEqual(requests.map(request=>request.path),['explore?timezone=Australia%2FSydney','explore?timezone=Europe%2FLondon']);

  requests[1].resolve({events:[{title:'London meetup',description:'The current timezone event',inviteUrl:'https://t.me/test?start=new'}]});
  await newer;
  assert.equal($('explore-refresh').disabled,false);
  assert.equal($('explore-zone').textContent,'Public events in Europe/London');

  if(oldResult==='success')requests[0].resolve({events:[{title:'Sydney meetup',description:'The outdated event'}]});
  else requests[0].reject(new Error('Old request failed.'));
  await older;

  const cards=$('explore-list').children;
  assert.equal(cards.length,1);
  assert.equal(cards[0].children.find(child=>child.tag==='h3').textContent,'London meetup');
  assert.equal($('explore-error').hidden,true);
  assert.equal($('explore-zone').textContent,'Public events in Europe/London');
  assert.equal($('explore-refresh').disabled,false);
});
