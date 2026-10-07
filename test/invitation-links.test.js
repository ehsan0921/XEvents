import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {buildInvitationCopy,buildInvitationLinksCard,invitationLinksCard,invitationCopyCard} from '../src/invitation-links.js';

function fixture(count=1,appUrl='https://example.test/app'){
  const invitees=Object.fromEntries(Array.from({length:count},(_,i)=>[(i+1).toString(16).padStart(32,'0'),{name:count===1?'Alex':'Guest '+String(i+1).padStart(2,'0'),participants:2}]));
  const event={id:'0123456789abcdef',owner:1,title:'Club dinner',invitationMode:'named',invitees,guests:{},permissions:{},inviteMessage:''};
  const calls=[],bot={username:'ExampleBot',appUrl,namedInvitationText:(e,g)=>`Dear ${g.name},\n\nClub dinner.\n\n`,send:async(id,text,reply_markup)=>{calls.push({id,text,reply_markup});return {};}};
  return {event,bot,calls,token:Object.keys(invitees)[0]};
}

const guestButtons=card=>card.reply_markup.inline_keyboard.flat().filter(b=>b.copy_text || b.web_app || b.callback_data?.startsWith('invite-copy:'));
const personalUrl=(e,token)=>`https://t.me/ExampleBot?start=i_${e.id}_${token}`;

test('guest-name buttons copy the complete short invitation and personal link, with no status text',()=>{
  const f=fixture();f.event.inviteMessage='Bring your team!';f.event.invitees[f.token].claimedBy=5;
  const card=buildInvitationLinksCard(f.bot,1,f.event),button=guestButtons(card)[0];
  const expected=`Dear Alex,\n\nClub dinner.\n\nBring your team!\n\n${personalUrl(f.event,f.token)}`;
  assert.equal(button.text,'Alex');assert.deepEqual(button.copy_text,{text:expected});
  assert.equal(button.callback_data,undefined);assert.equal(button.web_app,undefined);
  assert.doesNotMatch(button.copy_text.text,/Linked to a Telegram account/);
});

test('native invitation details pair sharing with full-text copy and offer a separate personal-link copy',async()=>{
  const f=fixture();f.event.inviteMessage='Bring your team!';
  const copy=buildInvitationCopy(f.bot,1,f.event,f.token);
  await invitationCopyCard(f.bot,1,f.event,f.token);
  const rows=f.calls.at(-1).reply_markup.inline_keyboard;
  assert.deepEqual(rows[0].map(b=>b.text),['Share invite','Copy invite']);
  assert.deepEqual(rows[0][1].copy_text,{text:copy.text});
  assert.deepEqual(rows[1],[{text:'Copy link only',copy_text:{text:personalUrl(f.event,f.token)}}]);
  assert.ok(Array.from(rows[1][0].copy_text.text).length<=256);
  const share=new URL(rows[0][0].url);
  assert.equal(share.searchParams.get('url'),copy.url);assert.equal(share.searchParams.get('text'),copy.message);
  assert.ok(rows[2][0].callback_data.startsWith('invite-links:'));
});

test('long native invitation details keep App full-text copy beside sharing and link-only copy native',async()=>{
  const f=fixture();f.event.inviteMessage='Welcome to our club. '.repeat(25);
  const copy=buildInvitationCopy(f.bot,1,f.event,f.token);
  await invitationCopyCard(f.bot,1,f.event,f.token);
  const rows=f.calls.at(-1).reply_markup.inline_keyboard;
  assert.deepEqual(rows[0].map(b=>b.text),['Share invite','Copy invite in App']);
  assert.equal(rows[0][1].copy_text,undefined);
  assert.equal(rows[0][1].web_app.url,copy.button.web_app.url);
  assert.deepEqual(rows[1],[{text:'Copy link only',copy_text:{text:personalUrl(f.event,f.token)}}]);
});

test('the native copy boundary counts Unicode characters and never truncates longer text',()=>{
  const f=fixture(),overhead=`Dear Alex,\n\nClub dinner.\n\n\n\n${personalUrl(f.event,f.token)}`;
  f.event.inviteMessage='🎉'.repeat(256-Array.from(overhead).length);
  const exact=buildInvitationCopy(f.bot,1,f.event,f.token);
  assert.equal(Array.from(exact.text).length,256);assert.ok(exact.text.length>256);
  assert.equal(exact.button.copy_text.text,exact.text);
  f.event.inviteMessage+='!';
  const longer=buildInvitationCopy(f.bot,1,f.event,f.token);
  assert.equal(Array.from(longer.text).length,257);assert.equal(longer.button.copy_text,undefined);
  assert.ok(longer.text.includes(f.event.inviteMessage));
  const app=new URL(longer.button.web_app.url);
  assert.equal(app.origin,'https://example.test');assert.equal(app.pathname,'/app');
  assert.equal(app.searchParams.get('invitations'),f.event.id);assert.equal(app.searchParams.get('guest'),f.token);
});

test('pages isolate ten guests, use two guest buttons per row, and retain their individual links',()=>{
  const f=fixture(23),page=buildInvitationLinksCard(f.bot,1,f.event,'1'),buttons=guestButtons(page);
  assert.deepEqual(buttons.map(b=>b.text),Array.from({length:10},(_,i)=>'Guest '+String(i+11).padStart(2,'0')));
  assert.equal(page.reply_markup.inline_keyboard.slice(0,5).every(row=>row.length===2),true);
  for(let i=0;i<buttons.length;i++)assert.ok(buttons[i].copy_text.text.endsWith(personalUrl(f.event,(i+11).toString(16).padStart(32,'0'))));
  assert.doesNotMatch(JSON.stringify(page),/Guest 01|Guest 10|Guest 21|Guest 23/);
  const nav=page.reply_markup.inline_keyboard[5];
  assert.deepEqual(nav.map(b=>b.callback_data),[`invite-links:${f.event.id}:0`,`invite-links:${f.event.id}:2`]);
  const last=buildInvitationLinksCard(f.bot,1,f.event,99);
  assert.deepEqual(guestButtons(last).map(b=>b.text),['Guest 21','Guest 22','Guest 23']);
  assert.match(last.text,/Page 3 of 3/);assert.equal(last.reply_markup.inline_keyboard.some(row=>row.some(b=>b.text==='Next →')),false);
});

test('list and detail requests check current host access, invitation mode and stale tokens',async()=>{
  const f=fixture();
  await invitationLinksCard(f.bot,3,f.event);await invitationCopyCard(f.bot,3,f.event,f.token);
  assert.equal(f.calls.length,2);assert.equal(f.calls.every(c=>!c.reply_markup && !c.text.includes('Alex') && !c.text.includes(f.token)),true);
  f.event.cohost={id:2};await invitationLinksCard(f.bot,2,f.event);
  assert.equal(guestButtons(f.calls.at(-1)).length,1);
  f.event.cohost=null;await invitationCopyCard(f.bot,2,f.event,f.token);
  assert.match(f.calls.at(-1).text,/Only event hosts/);
  delete f.event.invitees[f.token];await invitationCopyCard(f.bot,1,f.event,f.token);
  assert.match(f.calls.at(-1).text,/no longer available/);assert.equal(f.calls.at(-1).reply_markup,undefined);
  f.event.invitationMode='tickets';await invitationLinksCard(f.bot,1,f.event);
  assert.match(f.calls.at(-1).text,/shared invitation link/);
});

test('copied and shared invitation text keeps restricted locations private even for a host',async()=>{
  for(const privacy of [{hideLocation:true},{starPrice:20,starPricing:'group'},{requireApproval:true}]){
    const f=fixture();Object.assign(f.event,{location:'Hidden club address',ticketInfo:'Private entry instructions',startsAt:'2099-10-24T08:00:00Z',timezone:'Australia/Sydney',inviteMessage:'Bring a friend.',...privacy});
    const real=new Bot({data:{events:{[f.event.id]:f.event},sessions:{},preferences:{}}},async()=>{},'ExampleBot');
    f.bot.namedInvitationText=real.namedInvitationText.bind(real);
    const copy=buildInvitationCopy(f.bot,1,f.event,f.token);
    assert.match(copy.text,/Dear Alex/);assert.match(copy.text,/Bring a friend\./);assert.ok(copy.text.endsWith(personalUrl(f.event,f.token)));
    assert.doesNotMatch(copy.text,/Hidden club address|Private entry instructions/);
    await invitationCopyCard(f.bot,1,f.event,f.token);
    const share=f.calls.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.url);
    const shared=new URL(share.url);assert.equal(shared.searchParams.get('url'),copy.url);assert.equal(shared.searchParams.get('text'),copy.message);
    assert.doesNotMatch(shared.searchParams.get('text'),/Hidden club address|Private entry instructions/);
  }
});

test('without App, long invitations use a bounded callback and show the entire message with sharing',async()=>{
  const f=fixture(1,null);f.event.inviteMessage='Welcome to our club. '.repeat(25);
  const list=buildInvitationLinksCard(f.bot,1,f.event),button=guestButtons(list)[0];
  assert.equal(button.text,'Alex');assert.equal(button.callback_data,`invite-copy:${f.event.id}:${f.token}`);
  assert.ok(Buffer.byteLength(button.callback_data)<=64);assert.equal(button.copy_text,undefined);assert.equal(button.web_app,undefined);
  await invitationCopyCard(f.bot,1,f.event,f.token);
  const detail=f.calls.at(-1),expected=`Dear Alex,\n\nClub dinner.\n\n${f.event.inviteMessage.trim()}\n\n${personalUrl(f.event,f.token)}`;
  assert.equal(detail.text,expected);
  const actions=detail.reply_markup.inline_keyboard.flat();
  assert.equal(actions.some(b=>b.web_app || b.callback_data?.startsWith('invite-copy:')),false);
  assert.deepEqual(actions.filter(b=>b.copy_text),[{text:'Copy link only',copy_text:{text:personalUrl(f.event,f.token)}}]);
  assert.equal(actions.some(b=>/copied/i.test(b.text)),false);
  const share=new URL(actions.find(b=>b.text==='Share invite').url);
  assert.equal(share.hostname,'t.me');assert.ok(share.searchParams.get('text').includes(f.event.inviteMessage.trim()));
  assert.equal(share.searchParams.get('url'),personalUrl(f.event,f.token));
});

test('long detail cards preserve all text across safe message chunks and put controls on the final chunk',async()=>{
  const f=fixture(1,null);f.event.inviteMessage='🎉'.repeat(2500);
  const copy=buildInvitationCopy(f.bot,1,f.event,f.token);
  await invitationCopyCard(f.bot,1,f.event,f.token);
  assert.equal(f.calls.length,2);assert.equal(f.calls.map(c=>c.text).join(''),copy.text);
  assert.equal(f.calls[0].reply_markup,undefined);assert.ok(f.calls[1].reply_markup);
  for(const call of f.calls){assert.ok(call.text.length<=3900);assert.equal(/[\uD800-\uDBFF]$/.test(call.text),false);assert.equal(/^[\uDC00-\uDFFF]/.test(call.text),false);}
});

test('empty named lists show a concise empty state and retain host navigation',()=>{
  const f=fixture(0),card=buildInvitationLinksCard(f.bot,1,f.event,-1);
  assert.match(card.text,/No named invitations yet/);assert.equal(guestButtons(card).length,0);
  assert.deepEqual(card.reply_markup.inline_keyboard,[[{text:'Back to organiser tools',callback_data:`h:${f.event.id}`}]]);
});

test('native invitation previews bold fixed places without adding markup to clipboard or share text',async()=>{
  const f=fixture();f.event.invitees[f.token]={name:'🎉 Alex',participants:2,participantMode:'fixed'};
  f.event.title='🏏 Club dinner';f.event.inviteMessage='Please come!';
  const calls=[],real=new Bot({data:{events:{[f.event.id]:f.event},sessions:{},preferences:{}}},async(method,params)=>{calls.push({method,...params});return {};},'ExampleBot');
  const copy=buildInvitationCopy(real,1,f.event,f.token);await invitationCopyCard(real,1,f.event,f.token);
  const call=calls.at(-1),bold=call.entities.find(entity=>entity.type==='bold');
  assert.equal(call.text.slice(bold.offset,bold.offset+bold.length),'2 places');
  assert.match(copy.text,/reserved 2 places for you\. This count is fixed\./);assert.doesNotMatch(copy.text,/<b>|\*\*|Alex = 2\*/);
  assert.equal(call.text,copy.text);
  const share=call.reply_markup.inline_keyboard.flat().find(button=>button.url);
  assert.equal(new URL(share.url).searchParams.get('text'),copy.message);
});
