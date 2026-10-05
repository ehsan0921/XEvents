import {currencyCodes,pricingSettings} from './pricing.js';

const key='online-currency-rates';
export function parseOnlineRates(html,rows,now=Date.now()) {
  const plain=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  const rewardUsd=Number(plain.match(/equivalent of ([0-9.]+) USD worth of rewards for each Telegram Star/i)?.[1]);
  if(!Number.isFinite(rewardUsd) || rewardUsd<=0 || rewardUsd>1 || !Array.isArray(rows))throw Error('Invalid online rate data');
  const rates={USD:rewardUsd},dates={USD:new Date(now).toISOString().slice(0,10)};
  for(const row of rows) {
    if(row.base!=='USD' || !currencyCodes.includes(row.quote) || typeof row.rate!=='number' || !Number.isFinite(row.rate) || row.rate<=0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || Date.parse(row.date)>now+86400000 || now-Date.parse(row.date)>7*86400000)continue;
    rates[row.quote]=rewardUsd*row.rate;dates[row.quote]=row.date;
  }
  if(!rates.AUD || Object.keys(rates).length<20)throw Error('Incomplete online rates');
  return {rates,dates,rewardUsd,retrievedAt:new Date(now).toISOString(),basis:'organiser-reward',source:'Frankfurter + Telegram'};
}
export async function fetchOnlineRates(fetcher=fetch,now=Date.now()) {
  const responses=await Promise.all([
    fetcher('https://telegram.org/tos/bot-developers',{signal:AbortSignal.timeout(5000)}),
    fetcher('https://api.frankfurter.dev/v2/rates?base=USD',{signal:AbortSignal.timeout(5000)})
  ]);
  if(responses.some(r=>!r.ok))throw Error('Online rate provider unavailable');
  const [html,rows]=await Promise.all([responses[0].text(),responses[1].json()]);
  return parseOnlineRates(html,rows,now);
}
export async function readOnlinePricing(env,defaults={}) {
  const row=await env.DB.prepare('SELECT value FROM app_settings WHERE key=?').bind(key).first();
  const snapshot=row ? JSON.parse(row.value) : {};
  const fresh=Date.now()-Date.parse(snapshot.retrievedAt)<7*86400000;
  const rates={},dates={};
  if(fresh)for(const [code,rate] of Object.entries(snapshot.rates || {}))if(Number.isFinite(rate) && rate>0 && Date.now()-Date.parse(snapshot.dates?.[code])<7*86400000){rates[code]=rate;dates[code]=snapshot.dates[code];}
  return {...pricingSettings(defaults),rates,dates,basis:'organiser-reward',retrievedAt:snapshot.retrievedAt || null,source:snapshot.source || null};
}
export async function refreshOnlineRates(env) {
  const row=await env.DB.prepare('SELECT value FROM app_settings WHERE key=?').bind(key).first();
  const previous=row ? JSON.parse(row.value) : {};
  if(Date.now()-Date.parse(previous.attemptedAt || previous.retrievedAt)<(previous.failed ? 15*60000 : 6*3600000))return;
  let next;
  try { next=await fetchOnlineRates(); }
  catch { next={...previous,failed:true};console.error('online_rates_refresh_failed'); }
  next.attemptedAt=new Date().toISOString();
  await env.DB.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(next)).run();
}
