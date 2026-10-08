import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';

export async function checkGuestMessages(){
  const calls=[],eventId='1010101010101010';let messageId=100,holdNext=false,release,blocked=false;
  const worker=new Miniflare(convertV4MiniflareOptions({workers:[{
    name:'guest-messages',modules:true,scriptPath:'.wrangler/build/worker.js',compatibilityDate:'2026-10-05',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    bindings:{APP_ENV:'production',BOT_USERNAME:'fictionalBot',APP_URL:'https://messages.test/app',TELEGRAM_BOT_TOKEN:'fictional-message-token',TELEGRAM_WEBHOOK_SECRET:'fictional-secret'},
    outboundService:async request=>{
      const method=new URL(request.url).pathname.split('/').at(-1);
      const params=request.headers.get('Content-Type')?.includes('application/json')?await request.json():Object.fromEntries(await request.formData());
      calls.push({method,params});
      if(blocked && params.chat_id===710003 && ['sendMessage','copyMessage'].includes(method))return Response.json({ok:false,error_code:403});
      if(holdNext && params.text?.startsWith('📨 Message from the organiser')){holdNext=false;await new Promise(resolve=>{release=resolve;});}
      return Response.json({ok:true,result:{message_id:++messageId}});
    }
  }]}));
  try{
    const db=await worker.getD1Database('DB');
    for(const file of ['0001_initial.sql','0002_delivery_lease.sql','0003_mini_app.sql'])await db.exec((await readFile('migrations/'+file,'utf8')).replace(/\n/g,' '));
    const event={id:eventId,owner:710001,title:'Fictional dinner',invitationMode:'legacy',cohost:{id:710003},guests:{710002:{status:'yes',name:'Example guest'},710003:{status:'no',name:'Other guest'}},permissions:{guestList:true},media:[]};
    await db.prepare("INSERT INTO records(kind,id,data) VALUES ('events',?,?)").bind(eventId,JSON.stringify(event)).run();
    const auth=id=>{
      const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Fictional user'})});
      const value=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
      const key=createHmac('sha256','WebAppData').update('fictional-message-token').digest();p.set('hash',createHmac('sha256',key).update(value).digest('hex'));return 'tma '+p;
    };
    const api=async(action,input={},id=710001)=>{
      const r=await worker.dispatchFetch(`https://messages.test/api/events/${eventId}/messages/${action}`,{method:'POST',headers:{Authorization:auth(id),'Content-Type':'application/json'},body:JSON.stringify(input)});
      return {status:r.status,data:await r.json()};
    };
    const settle=async(kick)=>{
      for(let i=0;i<100;i++){
        if((await db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE id<>'fixture-delayed'").first()).n===0)return;
        if(kick && i%5===0)await kick();
        await new Promise(r=>setTimeout(r,20));
      }
      throw Error('Fictional message delivery did not finish.');
    };
    assert.equal((await api('start',{},710003)).status,400);
    assert.equal((await api('history',{},710003)).status,400);
    const draft=await api('start');assert.equal(draft.status,200);assert.equal(draft.data.counts.yes,1);assert.equal(draft.data.counts.no,1);
    assert.equal((await api('send',{groups:['yes'],text:'Example'})).status,400);
    assert.equal((await api('send',{token:draft.data.token,groups:['invalid'],text:'Example'})).status,400);
    const body=new FormData();body.set('file',new File(['fictional bytes'],'example.txt',{type:'text/plain'}));
    const uploadRequest=new Request('https://messages.test/upload',{method:'POST',body});
    const uploaded=await worker.dispatchFetch(`https://messages.test/api/events/${eventId}/messages/upload`,{method:'POST',headers:{Authorization:auth(710001),'X-Draft-Token':draft.data.token,'Content-Type':uploadRequest.headers.get('Content-Type')},body:await uploadRequest.arrayBuffer()});
    assert.equal(uploaded.status,200,await uploaded.text());
    const input={token:draft.data.token,groups:['yes'],text:'Fictional announcement'};
    await db.prepare("INSERT INTO outbox(id,method,params,due) VALUES ('fixture-delayed','sendMessage',?,unixepoch()+3600)").bind(JSON.stringify({chat_id:710001,text:'Delayed routine message'})).run();
    const sent=await api('send',input);assert.equal(sent.status,200);assert.equal(sent.data.count,1);
    await settle();
    assert.equal((await api('send',input)).status,200);await settle();
    const deliveries=calls.filter(c=>c.method==='copyMessage' || c.params.text==='Fictional announcement');
    assert.equal(deliveries.length,2);assert.ok(deliveries.every(c=>c.params.chat_id===710002));
    assert.equal(calls.some(c=>c.params.text==='Delayed routine message'),false);
    const history=await api('history');assert.equal(history.status,200);assert.equal(history.data.messages[0].delivered,1);assert.equal(history.data.messages[0].pending,0);assert.equal(history.data.messages[0].preview,'Fictional announcement');assert.deepEqual(history.data.messages[0].attachments,['example.txt']);
    assert.ok(calls.every(c=>!('__broadcast' in c.params) && !('__broadcastDelivered' in c.params)));
    assert.equal((await api('undo',{token:sent.data.token},710003)).status,400);
    const pref=JSON.parse((await db.prepare("SELECT data FROM records WHERE kind='preferences' AND id='710001'").first()).data);pref.broadcasts[sent.data.token].undoUntil=Date.now()-1;
    await db.prepare("UPDATE records SET data=? WHERE kind='preferences' AND id='710001'").bind(JSON.stringify(pref)).run();
    assert.equal((await api('undo',{token:sent.data.token})).status,400);
    assert.equal((await api('delete',{token:sent.data.token})).status,200);await settle();
    assert.equal(calls.filter(c=>c.method==='deleteMessage' && c.params.chat_id===710002).length,3);
    assert.equal((await api('history')).data.messages[0].deleted,3);
    assert.ok(calls.every(c=>!('__broadcastDelete' in c.params)));
    // Undo while a Telegram send is in flight: delete its receipt and skip the
    // remaining queued content, including attachments.
    const second=await api('start');holdNext=true;const before=calls.length;
    const next=await api('send',{token:second.data.token,groups:['no'],text:'Should not be delivered'});
    assert.equal(next.status,200);
    for(let i=0;!release && i<100;i++)await new Promise(r=>setTimeout(r,20));
    assert.equal(typeof release,'function');
    const undone=await api('undo',{token:next.data.token});assert.equal(undone.status,200);
    release();await settle();
    assert.equal(calls.slice(before).some(c=>c.params.text==='Should not be delivered'),false);
    assert.equal(calls.slice(before).filter(c=>c.method==='deleteMessage' && c.params.chat_id===710003).length,1);
    blocked=true;
    const third=await api('start');await api('send',{token:third.data.token,groups:['no'],text:'Blocked guest fixture'});await settle();
    const failed=(await api('history')).data.messages.find(m=>m.token===third.data.token);
    assert.equal(failed.failed,1);assert.equal(failed.delivered,0);assert.equal(failed.pending,0);
    await db.prepare('DELETE FROM outbox').run();
    event.permissions.uploadMedia=true;event.qrEnabled=true;
    await db.prepare("UPDATE records SET data=? WHERE kind='events' AND id=?").bind(JSON.stringify(event),eventId).run();
    const qrResponse=await worker.dispatchFetch('https://messages.test/telegram',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'fictional-secret'},body:JSON.stringify({update_id:9001,callback_query:{id:'fictional-query',from:{id:710001,first_name:'Fictional host'},data:'upload-qr:'+eventId}})});
    assert.equal(qrResponse.status,200);await settle();
    const photo=calls.find(c=>c.method==='sendPhoto');assert.ok(photo);assert.equal(photo.params.photo.type,'image/png');
    assert.equal(photo.params.__photoUpload,undefined);assert.equal(photo.params.chat_id,'710001');
    const callback=async(data,update_id,message)=>worker.dispatchFetch('https://messages.test/telegram',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'fictional-secret'},body:JSON.stringify({update_id,callback_query:{id:'fictional-category-query',from:{id:710001,first_name:'Fictional host'},data,message}})});
    assert.equal((await callback('bm:'+eventId,9002)).status,200);await settle();
    const session=JSON.parse((await db.prepare("SELECT data FROM records WHERE kind='sessions' AND id=?").bind('710001').first()).data);
    const start=calls.length;
    assert.equal((await callback(`bm-group:${eventId}:no:${session.token}`,9003,{chat:{id:710001},message_id:444})).status,200);await settle();
    const edited=calls.slice(start).find(c=>c.method==='editMessageText');assert.ok(edited);assert.equal(edited.params.message_id,444);
    assert.ok(edited.params.reply_markup.inline_keyboard.flat().some(b=>b.text.startsWith('❌')));
    assert.equal(edited.params.__broadcastNotice,undefined);assert.equal(calls.slice(start).some(c=>c.method==='sendMessage'),false);
    // A guest delivery completing while a webhook owns the state lease must
    // retry receipt persistence without leaving content waiting for a minute.
    blocked=false;release=undefined;holdNext=true;
    const contentionDraft=await api('start'),contentionStart=calls.length;
    await api('send',{token:contentionDraft.data.token,groups:['yes'],text:'Lease contention fixture'});
    for(let i=0;!release && i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(typeof release,'function');
    await db.prepare("INSERT INTO lease(id,owner,expires) VALUES (1,'fictional-contention',unixepoch()+60)").run();
    const unlock=(async()=>{await new Promise(resolve=>setTimeout(resolve,250));await db.prepare("DELETE FROM lease WHERE owner='fictional-contention'").run();})();
    release();await unlock;await settle();
    const contentionHistory=(await api('history')).data.messages.find(m=>m.token===contentionDraft.data.token);
    assert.equal(contentionHistory.delivered,1);assert.equal(contentionHistory.pending,0);
    assert.equal(calls.slice(contentionStart).filter(c=>c.params.text==='Lease contention fixture').length,1);
    console.log('Guest messaging Worker integration passed: creator authorization, filters, attachments, durable receipts, idempotent send and undo. Telegram mocked.');
  }finally{await worker.dispose();}
}
