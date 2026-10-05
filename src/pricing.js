import ct from 'countries-and-timezones';
import countryToCurrency from 'country-to-currency';
import { InputError } from './time.js';

export const currencyCodes=[...new Set(Object.values(countryToCurrency))].filter(c=>/^[A-Z]{3}$/.test(c)).sort();
export function timezoneCurrencies(zone) {
  return [...new Set((ct.getTimezone(zone)?.countries || []).map(c=>countryToCurrency[c]).filter(c=>currencyCodes.includes(c)))].sort();
}
export function localCurrency(preference={}) {
  if(currencyCodes.includes(preference.currency))return preference.currency;
  const candidates=timezoneCurrencies(preference.timezone);
  return candidates.length===1 ? candidates[0] : null;
}
export function pricingSettings(value={}) {
  return {defaultStarPrice:value.defaultStarPrice || 0,defaultStarPricing:value.defaultStarPricing || 'person',rates:value.rates || {},updatedAt:value.updatedAt || null};
}
export function parsePricing(input) {
  if(!Number.isSafeInteger(input.defaultStarPrice) || input.defaultStarPrice<0 || input.defaultStarPrice>100000)throw new InputError('Default fee must be a whole number from 0 to 100,000 Stars.');
  if(!['person','group'].includes(input.defaultStarPricing))throw new InputError('Choose per-person or per-group pricing.');
  if(!input.rates || typeof input.rates!=='object' || Array.isArray(input.rates) || Object.keys(input.rates).length>200)throw new InputError('Provide currency reference rates.');
  for(const [code,rate] of Object.entries(input.rates))if(!currencyCodes.includes(code) || typeof rate!=='number' || !Number.isFinite(rate) || rate<=0 || rate>1000000)throw new InputError('Use supported currencies and positive reference rates.');
  return {...pricingSettings(input),updatedAt:new Date().toISOString()};
}
export function priceText(event,preference={},settings={}) {
  if(['bank','link'].includes(event.paymentMethod))return 'Paid · '+event.displayPrice;
  if(!event.starPrice)return 'Free';
  const unit=event.starPricing==='person'?'per person':'per group';
  const currency=localCurrency(preference),rate=settings.rates?.[currency];
  const money=currency && rate ? new Intl.NumberFormat('en',{style:'currency',currency,currencyDisplay:'code'}).format(event.starPrice*rate) : null;
  return `⭐ ${event.starPrice} Stars ${unit}${money ? ` · ≈ ${money} (owner-set estimate; actual Stars cost varies)` : ''}`;
}
