import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePricing,localCurrency,priceText} from '../src/pricing.js';

test('timezone currency inference avoids ambiguous countries and allows explicit override',()=>{
  assert.equal(localCurrency({timezone:'Australia/Sydney'}),'AUD');
  assert.equal(localCurrency({timezone:'Asia/Dubai'}),null);
  assert.equal(localCurrency({timezone:'Asia/Dubai',currency:'AED'}),'AED');
  assert.equal(localCurrency({timezone:'UTC'}),null);
});
test('automatic reward estimates do not imply a guest purchase price and settings validate fees',()=>{
  const defaults=parsePricing({defaultStarPrice:20,defaultStarPricing:'person',rates:{AUD:999}});
  assert.equal(defaults.rates,undefined);
  const settings={...defaults,rates:{AUD:0.02}};
  assert.equal(settings.defaultStarPrice,20);
  assert.equal(priceText({}, {timezone:'Australia/Sydney'}, settings),'Free');
  assert.match(priceText({starPrice:100,starPricing:'person'},{timezone:'Australia/Sydney'},settings),/100 Stars per person.*AUD.*2\.00.*estimate/);
  assert.doesNotMatch(priceText({starPrice:100},{timezone:'UTC'},settings),/≈/);
  for(const input of [{...settings,defaultStarPrice:1.5},{...settings,defaultStarPricing:'invalid'}])assert.throws(()=>parsePricing(input));
});
