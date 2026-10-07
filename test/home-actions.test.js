import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function declaration(name){
  const start=source.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));
  assert.notEqual(start,-1,name+' must be present in the app.');
  let depth=0,quote='',comment='',escaped=false,opened=false;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    const char=source[i],next=source[i+1];
    if(comment==='line'){if(char==='\n')comment='';continue;}
    if(comment==='block'){if(char==='*' && next==='/'){comment='';i++;}continue;}
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue;}
    if(char==='/' && next==='/'){comment='line';i++;continue;}
    if(char==='/' && next==='*'){comment='block';i++;continue;}
    if(['\"',"'",'`'].includes(char)){quote=char;continue;}
    if(char==='{'){depth++;opened=true;}
    if(char==='}' && --depth===0 && opened)return source.slice(start,i+1);
  }
  assert.fail('Could not read '+name+'.');
}

const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);

function harness(events){
  class El{
    constructor(tag='',text=''){this.tag=tag;this.textContent=text;this.children=[];this.dataset={};this.attributes={};this.classes=new Set();this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),toggle(){}};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=value;}
    removeAttribute(name){delete this.attributes[name];}
    scrollIntoView(options){this.scrolled=options || true;}
    focus(options){this.focused=options || true;}
    querySelector(selector){return descendants(this).find(node=>matches(node,selector)) || null;}
    querySelectorAll(selector){return descendants(this).filter(node=>matches(node,selector));}
  }
  const matches=(node,selector)=>{
    if(selector.startsWith('#'))return node.id===selector.slice(1);
    const eventId=selector.match(/\[data-event-id=["']?([^"'\]]+)/)?.[1];
    if(eventId && node.dataset.eventId!==eventId)return false;
    const className=selector.match(/\.([\w-]+)/)?.[1];
    if(className && !(node.className || '').split(' ').includes(className))return false;
    return !!eventId || !!className;
  };
  const nodes=new Map(['home-upcoming','home-ongoing','event-list','zone-note','events-heading'].map(id=>[id,new El()]));
  const findById=id=>nodes.get(id) || [...nodes.values()].flatMap(descendants).find(node=>node.id===id);
  const calls=[],state={events,preference:{timezone:'Australia/Sydney'}};
  let ui;
  const spy=kind=>(...args)=>{calls.push({kind,args});};
  const dependencies={
    state,$:findById,isManager:e=>e?.isManager===true || e?.isOwner===true,selectedZone:()=>state.preference.timezone,
    dateInZone:instant=>new Date(instant).toISOString().slice(0,10),format:e=>e.title || 'Event time',
    element:(tag,text='',className)=>Object.assign(new El(tag,text),{className}),
    action:(label,fn,className)=>Object.assign(new El('button',label),{onclick:fn,className}),
    priceTag:()=>new El('span','Free'),priceEstimate:()=>'',
    document:{createElement:tag=>new El(tag),getElementById:findById,querySelector:selector=>[...nodes.values()].flatMap(descendants).find(node=>matches(node,selector)),querySelectorAll:selector=>[...nodes.values()].flatMap(descendants).filter(node=>matches(node,selector))},
    openTelegram:spy('chat'),editEvent:spy('edit'),openGuestList:spy('guests'),openNamedLinks:spy('invitations'),
    openCheckin:spy('checkin'),openTicket:spy('ticket'),openGallery:spy('media'),share:spy('share'),openCoHost:spy('cohosts'),showQr:spy('upload'),cancelEvent:spy('cancel'),notice:spy('notice'),
    api:async()=>({}),refresh:async()=>{},navigator:{clipboard:{writeText:async()=>{}}},initData:'test-session',bannerUrls:new Map(),
    go:tab=>{calls.push({kind:'tab',args:[tab]});if(tab==='events')ui.renderEvents();},
    requestAnimationFrame:fn=>fn(),CSS:{escape:value=>value}
  };
  ui=new Function(...Object.keys(dependencies),'let listFilter="all";\n'+['renderHome','renderEvents','openEventInApp'].map(declaration).join('\n')+'\nreturn {renderHome,renderEvents,openEventInApp};')(...Object.values(dependencies));
  const cards=id=>nodes.get(id).children.filter(node=>node.tag==='article');
  const buttons=node=>descendants(node).filter(child=>child.tag==='button');
  const button=(node,label)=>buttons(node).find(child=>child.textContent===label);
  return {ui,nodes,calls,cards,buttons,button};
}

const event=(fields={})=>({id:'0123456789abcdef',title:'Community picnic',startsAt:new Date(Date.now()+7200000).toISOString(),endsAt:new Date(Date.now()+14400000).toISOString(),timezone:'Australia/Sydney',group:'Upcoming events',upcoming:true,isOwner:false,isManager:false,status:'yes',approval:'approved',invitationMode:'named',permissions:{},inviteUrl:'https://t.me/test?start=e_0123456789abcdef',...fields});

test('Home provides app navigation shortcuts alongside event cards',()=>{
  const section=html.slice(html.indexOf('id="home-view"'),html.indexOf('id="events-view"'));
  const shortcuts=section.match(/<nav\b[^>]*class="[^"]*home-shortcuts[^"]*"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(shortcuts,'Home should have its own shortcut navigation.');
  for(const [tab,label] of [['events','My events'],['explore','Explore events'],['create','Create event']]){
    assert.match(shortcuts,new RegExp('<button\\b[^>]*data-tab="'+tab+'"[^>]*>[^<]*'+label+'<\\/button>'));
  }
});

test('Home View event stays in the app and focuses the matching event; chat is explicit',async()=>{
  const e=event(),other=event({id:'fedcba9876543210',title:'Another plan',startsAt:new Date(Date.now()+3600000).toISOString()}),f=harness([other,e]);f.ui.renderHome();
  const card=f.cards('home-upcoming').find(item=>item.children.some(child=>child.tag==='h3' && child.textContent===e.title));
  await f.button(card,'📅 View event').onclick();
  assert.deepEqual(f.calls,[{kind:'tab',args:['events']}]);
  const target=f.cards('event-list').find(item=>item.id==='event-card-'+e.id);
  assert.ok(target,'The selected event must be addressable in the app.');
  assert.ok(target.scrolled,'The selected event must be brought into view.');
  assert.ok(target.focused,'Keyboard focus must follow the selected event.');
  assert.equal(f.cards('event-list').find(item=>item.id==='event-card-'+other.id).focused,undefined,'An unrelated event must not receive focus.');
  await f.button(card,'💬 Open in chat').onclick();
  assert.deepEqual(f.calls.at(-1),{kind:'chat',args:[e.inviteUrl]});
});

for(const role of ['owner','cohost'])test('Home '+role+' actions open event tools in the app',async()=>{
  const e=event({isOwner:role==='owner',isManager:true,isCoHost:role==='cohost'}),f=harness([e]);f.ui.renderHome();
  const card=f.cards('home-upcoming')[0];
  for(const [label,kind,arg] of [['✏️ Edit event','edit',e.id],['👥 Guest list','guests',e.id],['✉️ Invitations','invitations',e],['🗂 Shared media','media',e.id]]){
    const button=f.button(card,label);assert.ok(button,label+' must be available to '+role);await button.onclick();
    assert.deepEqual(f.calls.at(-1),{kind,args:[arg]});
  }
  assert.equal(f.button(card,'🎟 My ticket'),undefined);
  assert.equal(f.button(card,'🛑 Cancel event'),undefined,'Cancellation belongs in event management.');
});

test('Home attendee shortcuts respect media permission and ticket confirmation',()=>{
  for(const fields of [
    {status:'yes',permissions:{viewMedia:true},ticket:{code:'TICKET',name:'Guest'}},
    {status:'yes',permissions:{viewMedia:false},ticket:null},
    {status:'yes',approval:'pending',permissions:{viewMedia:true},ticket:null},
    {status:'maybe',permissions:{viewMedia:true},ticket:null}
  ]){
    const f=harness([event(fields)]);f.ui.renderHome();const card=f.cards('home-upcoming')[0];
    assert.equal(!!f.button(card,'🗂 Shared media'),fields.status==='yes' && fields.permissions.viewMedia);
    assert.equal(!!f.button(card,'🎟 My ticket'),!!fields.ticket);
    for(const label of ['✏️ Edit event','👥 Guest list','✉️ Invitations','🛑 Cancel event'])assert.equal(f.button(card,label),undefined,label+' must remain a management action.');
  }
});

test('Confirmed Home tickets open in app even when QR codes are disabled',async()=>{
  const e=event({ticket:{name:'Guest',code:'TICKET'},qrEnabled:false}),f=harness([e]);f.ui.renderHome();
  await f.button(f.cards('home-upcoming')[0],'🎟 My ticket').onclick();
  assert.deepEqual(f.calls,[{kind:'ticket',args:[e.id]}]);
});

test('Ticket-event hosts have guest tools without personal invitation links',()=>{
  const f=harness([event({isOwner:true,isManager:true,invitationMode:'tickets'})]);f.ui.renderHome();
  const card=f.cards('home-upcoming')[0];
  assert.ok(f.button(card,'👥 Guest list'));
  assert.equal(f.button(card,'✉️ Invitations'),undefined);
});

test('Home shows ongoing and future plans, excluding cancelled and unaccepted invitations',()=>{
  const now=Date.now(),f=harness([
    event({title:'Future'}),event({title:'Ongoing',startsAt:new Date(now-1800000).toISOString(),endsAt:new Date(now+1800000).toISOString()}),
    event({title:'Cancelled',cancelled:true}),event({title:'Declined',status:'no'}),event({title:'Later',status:'later'}),
    event({title:'Finished',startsAt:new Date(now-7200000).toISOString(),endsAt:new Date(now-3600000).toISOString()})
  ]);f.ui.renderHome();
  assert.deepEqual(f.cards('home-upcoming').map(card=>card.children.find(child=>child.tag==='h3').textContent),['Future']);
  assert.deepEqual(f.cards('home-ongoing').map(card=>card.children.find(child=>child.tag==='h3').textContent),['Ongoing']);
});

test('Three-dot menu includes Edit and one owner-only cancellation entry',async()=>{
  for(const role of ['owner','cohost','guest']){
    const e=event({isOwner:role==='owner',isManager:role!=='guest',isCoHost:role==='cohost'}),f=harness([e]);f.ui.renderEvents();
    const card=f.cards('event-list')[0],menu=card.children.find(child=>child.tag==='details');
    const edit=f.button(menu,'✏️ Edit event');assert.equal(!!edit,role!=='guest');
    if(edit){await edit.onclick();assert.deepEqual(f.calls.at(-1),{kind:'edit',args:[e.id]});}
    const cancel=f.button(menu,'🛑 Cancel event');assert.equal(!!cancel,role==='owner');
    if(cancel){await cancel.onclick();assert.deepEqual(f.calls.at(-1),{kind:'cancel',args:[e]});}
    assert.equal(f.buttons(menu).filter(button=>/Cancel event|Delete event/.test(button.textContent)).length,role==='owner'?1:0);
    assert.equal(f.button(menu,'Delete event'),undefined,'Deletion is a choice inside the cancellation flow.');
  }
});
