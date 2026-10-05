import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOnlineRates,refreshOnlineRates,readOnlinePricing} from '../src/exchange.js';
import {currencyCodes} from '../src/pricing.js';

const html='Developers can receive an equivalent of <b>0.013 USD</b> worth of rewards for each Telegram Star.';
const rows=currencyCodes.filter(c=>c!=='USD').map(quote=>({base:'USD',quote,rate:quote==='AUD'?1.5:1,date:new Date().toISOString().slice(0,10)}));
test('online conversions use provider data and reject malformed or outdated data',()=>{
  const data=parseOnlineRates(html,rows);assert.equal(data.rates.AUD,0.0195);assert.equal(data.rewardUsd,0.013);
  assert.throws(()=>parseOnlineRates('Missing value',rows));
  assert.throws(()=>parseOnlineRates(html,rows.map(r=>({...r,date:'2000-01-01'}))));
  const invalid=[...rows,{base:'USD',quote:'AUD',rate:Infinity,date:rows[0].date}];assert.equal(parseOnlineRates(html,invalid).rates.AUD,0.0195);
});
test('provider failure preserves recent cached rates; expired rates are hidden',async()=>{
  let stored=JSON.stringify({...parseOnlineRates(html,rows),retrievedAt:new Date(Date.now()-8*3600000).toISOString()});
  const env={DB:{prepare:sql=>({bind:(...args)=>({first:async()=>({value:stored}),run:async()=>{stored=args[1];}})})}};
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline');};
  try{await refreshOnlineRates(env);}finally{globalThis.fetch=original;}
  assert.equal((await readOnlinePricing(env)).rates.AUD,0.0195);assert.equal(JSON.parse(stored).failed,true);
  stored=JSON.stringify({...JSON.parse(stored),retrievedAt:'2000-01-01'});assert.deepEqual((await readOnlinePricing(env)).rates,{});
});
