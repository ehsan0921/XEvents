import {InputError} from './time.js';

export const paymentMethod=e=>e.paymentMethod || (e.starPrice ? 'stars':'free');
export const paidEvent=e=>paymentMethod(e)!=='free';
const text=(value,label,max,required=false)=>{
  if(typeof value!=='string' || value.trim().length>max || (required && !value.trim()))throw new InputError(`${label} ${required?'is required and ':''}must be at most ${max} characters.`);
  return value.trim();
};
export function parseEventPayment(input,event={},starsAllowed=false){
  const method=input.paymentMethod ?? (input.starPrice!==undefined ? input.starPrice>0?'stars': ['bank','link'].includes(paymentMethod(event))?paymentMethod(event):'free' : paymentMethod(event));
  if(!['free','stars','bank','link'].includes(method))throw new InputError('Choose Free, bank transfer, payment link or Telegram Stars.');
  const result={paymentMethod:method,starPrice:0,starPricing:'group',displayPrice:'',paymentInstructions:'',paymentUrl:'',paymentTerms:''};
  if(method==='free')return result;
  const terms=input.paymentTerms ?? event.paymentTerms ?? '';
  if(typeof terms!=='string' || !terms.trim())throw new InputError('Enter payment and refund terms for this paid event, or turn off Paid event to make it free.');
  result.paymentTerms=text(terms, 'Payment and refund terms',1000);
  if(method==='stars'){
    if(!starsAllowed)throw new InputError('Stars collection is not enabled for your account on this bot.');
    if(!Number.isSafeInteger(input.starPrice) || input.starPrice<1 || input.starPrice>100000)throw new InputError('Stars price must be a whole number from 1 to 100,000.');
    if(!['person','group'].includes(input.starPricing))throw new InputError('Choose per-person or per-group pricing.');
    result.starPrice=input.starPrice;result.starPricing=input.starPricing;
  }else{
    result.displayPrice=text(input.displayPrice ?? event.displayPrice ?? '', 'Price',120,true);
    result.paymentInstructions=text(input.paymentInstructions ?? event.paymentInstructions ?? '', 'Payment instructions',1500,method==='bank');
    if(method==='link'){
      result.paymentUrl=text(input.paymentUrl ?? event.paymentUrl ?? '', 'Payment link',1000,true);
      try{const url=new URL(result.paymentUrl);if(url.protocol!=='https:' || url.username || url.password)throw Error();}catch{throw new InputError('Use an HTTPS payment link without embedded login details.');}
    }
  }
  return result;
}
