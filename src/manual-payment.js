import {randomBytes} from 'node:crypto';
import {paymentMethod} from './event-payment.js';

export async function manualInstructions(bot,id,e){
  const g=e.guests[id];
  if(e.cancelled || !['bank','link'].includes(paymentMethod(e)) || g?.status!=='yes' || (e.requireApproval && g.approval!=='approved'))return bot.send(id,'Payment instructions are available after your acceptance is approved.');
  if(g.payment?.status==='paid')return bot.ticket(id,e);
  const rows=[];
  if(e.paymentUrl)rows.push([{text:'Open payment link',url:e.paymentUrl}]);
  rows.push([{text:'I have paid — request review',callback_data:`manual-report:${e.id}`}],[{text:'Back to event',callback_data:`v:${e.id}`}]);
  return bot.send(id,`${e.title}\nPaid · ${e.displayPrice}\n\n${e.paymentInstructions || 'Pay using the organiser’s external link.'}\n\n${e.paymentTerms}\n\nYour organiser must verify receipt. Reporting payment does not confirm your ticket.`,{inline_keyboard:rows});
}
export async function manualReport(bot,id,e){
  const g=e.guests[id];
  if(e.cancelled || !['bank','link'].includes(paymentMethod(e)) || g?.status!=='yes' || (e.requireApproval && g.approval!=='approved'))return bot.send(id,'You cannot report payment for this booking.');
  if(g.payment?.status==='paid' || g.payment?.status==='reported')return bot.send(id,g.payment.status==='paid'?'Your payment is already confirmed.':'Your organiser is reviewing your payment.');
  const token=randomBytes(12).toString('hex');
  g.payment={status:'reported',method:paymentMethod(e),record:token};
  bot.db.preferences[id] ||= {};bot.db.preferences[id].manualPayments ||= {};
  bot.db.preferences[id].manualPayments[token]={event:e.id,owner:e.owner,title:e.title,price:e.displayPrice,method:paymentMethod(e),status:'reported',reportedAt:new Date().toISOString()};
  await bot.send(e.owner,`${g.name} reports payment for ${e.title}\nPrice: ${e.displayPrice}\nVerify receipt in your bank or payment provider before confirming.`,{inline_keyboard:[[{text:'Confirm received',callback_data:`manual-confirm:${e.id}:${id}`}]]});
  return bot.send(id,'Payment reported. The organiser will confirm after checking receipt.');
}
export async function manualConfirm(bot,actor,e,uid,clear=false){
  const g=e.guests[uid];
  if(e.owner!==actor || !['bank','link'].includes(paymentMethod(e)) || !g || (clear ? !['paid','reported'].includes(g.payment?.status) : e.cancelled || g.status!=='yes' || g.payment?.status!=='reported' || (e.requireApproval && g.approval!=='approved')))return bot.send(actor,'This payment cannot be updated.');
  const record=bot.db.preferences[uid]?.manualPayments?.[g.payment.record];
  g.payment.status=clear?'voided':'paid';
  if(record){record.status=g.payment.status;record.updatedAt=new Date().toISOString();}
  if(clear){delete g.ticket;await bot.send(uid,`The organiser cleared your payment confirmation for ${e.title}. This action does not transfer or refund money.`);}
  else{g.ticket=randomBytes(6).toString('hex').toUpperCase();await bot.send(uid,`Payment confirmed by the organiser for ${e.title}.`);await bot.ticket(uid,e);}
  return bot.send(actor,clear?'Payment record cleared. No money was refunded by XEvents.':'Payment confirmed and ticket sent.');
}
