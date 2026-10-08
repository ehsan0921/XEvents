import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {invitationSettings} from '../src/invitations.js';
import {responseCounts} from '../src/permissions.js';

function fixture(mode='named',fields={}) {
  const e={id:'0123456789abcdef',title:'Club evening',owner:1,location:'Club house',description:'An evening together',when:'24 October 2026, 6pm Sydney',questions:[],guests:{},media:[],permissions:{},invitationMode:mode,...fields};
  if(mode==='named')Object.assign(e,invitationSettings({guestNames:'Alex = 3'},e));
  const data={events:{[e.id]:e},sessions:{},preferences:{}},calls=[];
  const bot=new Bot({data},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  bot.appUrl='https://example.test/app';
  const msg=(id,text)=>bot.handle({message:{chat:{id,type:'private'},from:{id,first_name:'Telegram guest'},text}});
  const cb=(id,value)=>bot.handle({callback_query:{id:'callback',from:{id,first_name:'Telegram guest'},data:value}});
  const open=()=>msg(2,mode==='named' ? `/start i_${e.id}_${Object.keys(e.invitees)[0]}` : `/start e_${e.id}`);
  const accept=()=>cb(2,mode==='tickets' ? `book:${e.id}` : `r:${e.id}:yes`);
  return {e,data,calls,bot,msg,cb,open,accept};
}

test('preset named invitation skips attendee selection and notifies the organiser with the actual group count',async()=>{
  const f=fixture('named',{askParticipantCount:true,askPhone:false,askComments:false});
  await f.open();await f.accept();
  assert.equal(f.e.guests[2].name,'Alex');assert.equal(f.e.guests[2].status,'yes');assert.equal(f.e.guests[2].participants,3);
  assert.equal(f.data.sessions[2],undefined);assert.equal(responseCounts(f.e).participants,3);
  assert.ok(f.calls.some(c=>c.chat_id===1 && c.text?.includes('Alex:') && c.text.includes('People: 3')));
  assert.equal(f.calls.some(c=>c.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data?.startsWith('size:'))),false);
  assert.equal(f.calls.some(c=>/how many|people are coming|number of people/i.test(c.text || '')),false);
});

test('unchecked phone collection is skipped for legacy, named invitation and ticket booking flows',async()=>{
  for(const mode of ['legacy','named','tickets'])for(const askPhone of [undefined,false]){
    const f=fixture(mode,{askPhone,askComments:false});
    await f.open();await f.accept();
    if(mode!=='named')await f.msg(2,'Guest name');
    assert.equal(f.e.guests[2].status,'yes',`${mode}: response saves without a phone choice`);
    assert.equal(f.e.guests[2].phone,'');assert.equal(f.data.sessions[2],undefined);
    assert.equal(f.calls.some(c=>c.reply_markup?.keyboard?.flat().some(b=>b.request_contact)),false);
    assert.equal(f.calls.some(c=>/phone number|share your phone/i.test(c.text || '')),false);
  }
});

test('stored legacy questions are skipped and an enabled comment follows the name directly',async()=>{
  const f=fixture('legacy',{askPhone:false,askComments:true,questions:['Dietary needs?','What will you bring?']});
  await f.open();await f.accept();await f.msg(2,'Guest name');
  assert.equal(f.data.sessions[2].step,'comment');
  assert.equal(f.calls.some(c=>/Dietary needs\?|What will you bring\?/.test(c.text || '')),false);
  await f.msg(2,'See you there');
  assert.deepEqual(f.e.guests[2].answers,[]);assert.equal(f.e.guests[2].comment,'See you there');assert.equal(f.e.guests[2].status,'yes');
  assert.equal(f.data.sessions[2],undefined);
});

test('custom invitation message reaches event cards and public or personal Telegram shares',async()=>{
  const inviteMessage='Join us for a relaxed club evening. Bring your team!';
  for(const mode of ['tickets','legacy','named']){
    const f=fixture(mode,{inviteMessage});
    await f.open();assert.ok(f.calls.some(c=>c.chat_id===2 && (c.text || c.caption || '').includes(inviteMessage)));
    f.calls.length=0;
    if(mode==='named'){
      await f.bot.personalLinks(1,f.e);
      assert.ok(f.calls.some(c=>c.reply_markup?.inline_keyboard?.flat().some(b=>b.text==='Alex')));
      const token=Object.keys(f.e.invitees)[0];
      await f.cb(1,`invite-copy:${f.e.id}:${token}`);
    }else await f.bot.card(1,f.e);
    const shares=f.calls.flatMap(c=>c.reply_markup?.inline_keyboard?.flat() || []).filter(b=>b.url?.startsWith('https://t.me/share/url?'));
    assert.equal(shares.length,1);
    const share=new URL(shares[0].url);assert.ok(share.searchParams.get('text').includes(inviteMessage));
    assert.ok(share.searchParams.get('url').includes(mode==='named' ? `start=i_${f.e.id}_` : `start=e_${f.e.id}`));
    if(mode==='named'){
      assert.ok(share.searchParams.get('text').includes('Dear Alex,'));
      assert.ok(share.searchParams.get('text').includes('3 places'));
    }
  }
});

test('check-in codes are requested from the ticket page even with QR disabled',async()=>{
  const f=fixture('tickets',{qrEnabled:false,askPhone:false,askComments:false});
  await f.open();await f.accept();await f.msg(2,'Ticket holder');
  assert.equal(f.e.guests[2].status,'yes');assert.ok(f.e.guests[2].ticket);
  const ticketMessage=f.calls.find(c=>c.chat_id===2 && c.text?.includes('YOUR TICKET'));
  assert.equal(ticketMessage.text.includes(f.e.guests[2].ticket),false);
  assert.equal(f.e.guests[2].ticketCode,undefined,'confirmation does not generate a code in the background');
  assert.ok(ticketMessage.reply_markup.inline_keyboard.flat().some(b=>b.text==='🎟 Check-in code' && b.web_app.url.endsWith(`?ticket=${f.e.id}`)));
  assert.equal(f.calls.some(c=>c.chat_id===2 && c.reply_markup?.inline_keyboard?.flat().some(b=>/QR/.test(b.text))),false);
  f.calls.length=0;await f.cb(2,`ticket:${f.e.id}`);
  assert.equal(f.calls.some(c=>c.reply_markup?.inline_keyboard?.flat().some(b=>/QR/.test(b.text))),false);
  f.e.qrEnabled=true;f.calls.length=0;await f.bot.ticket(2,f.e);
  assert.ok(f.calls.some(c=>c.reply_markup?.inline_keyboard?.flat().some(b=>b.text==='🎟 Check-in code')));
});

test('bot-only installations show an on-demand six-digit code instead of the permanent ticket identifier',async()=>{
  const f=fixture('tickets',{qrEnabled:false,askPhone:false,askComments:false});f.bot.appUrl='';
  await f.open();await f.accept();await f.msg(2,'Ticket holder');
  assert.equal(f.e.guests[2].ticketCode,undefined);
  f.calls.length=0;await f.cb(2,`ticket:${f.e.id}`);
  const message=f.calls.find(c=>c.chat_id===2 && c.text?.includes('YOUR TICKET'));
  assert.match(message.text,/Check-in code: \d{6}\nValid this minute/);
  assert.equal(message.text.includes(f.e.guests[2].ticket),false);
  f.e.endsAt='2000-01-01T00:00:00Z';f.calls.length=0;await f.cb(2,`ticket:${f.e.id}`);
  assert.match(f.calls.at(-1).text,/finished/);
});
