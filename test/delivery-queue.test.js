import test from 'node:test';
import assert from 'node:assert/strict';
import {drainOutbox} from '../src/worker.js';

test('normal delivery drains beyond one batch so messages do not wait for the next cron',async t=>{
  const rows=Array.from({length:25},(_,i)=>({id:'fictional-'+i,due:0,attempts:1,method:'sendMessage',params:JSON.stringify({chat_id:1,text:'Fictional notice '+i})}));
  const sent=[];
  const env={APP_ENV:'production',TELEGRAM_BOT_TOKEN:'fictional-token',DB:{prepare(sql){return {bind(...args){this.args=args;return this;},async first(){if(sql.startsWith('INSERT INTO delivery_lease'))return {owner:'fixture'};if(sql.startsWith('UPDATE outbox SET due=unixepoch()+60'))return rows.find(r=>r.id===this.args[0]);throw Error('Unexpected query');},async all(){return {results:rows.slice(0,20)};},async run(){if(sql==='DELETE FROM outbox WHERE id=?')rows.splice(rows.findIndex(r=>r.id===this.args[0]),1);else assert.equal(sql,'DELETE FROM delivery_lease WHERE owner=?');}};}}};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{sent.push(JSON.parse(options.body).text);return Response.json({ok:true});});
  await drainOutbox(env);assert.equal(sent.length,25);assert.equal(rows.length,0);assert.equal(new Set(sent).size,25);
});
