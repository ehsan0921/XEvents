import { randomBytes } from 'node:crypto';
import { participantCount,requiresApproval } from './permissions.js';

export const starTotal = (e, g) => e.starPrice * (e.starPricing === 'person' ? participantCount(e, g) : 1);
export function orderFor(data, uid, token) { return data.preferences[uid]?.starOrders?.[token]; }
export function validOrder(data, uid, order) {
  const e = order && data.events[order.event]; const g = e?.guests[uid];
  return !!(e && !e.cancelled && e.owner === order.owner && e.starPrice > 0 && e.starPrice===order.unitPrice && e.starPricing===order.pricing && e.paymentTerms===order.terms && g?.status === 'yes' && (!requiresApproval(e) || g.approval === 'approved') && g.payment?.status !== 'paid' && order.status === 'pending' && g.payment?.order === order.id && starTotal(e,g) === order.amount && participantCount(e,g) === order.participants && (!e.startsAt || Date.parse(e.startsAt) > Date.now()));
}
export async function invoice(bot, uid, e, consent = false) {
  const g=e.guests[uid];
  if (!e.starPrice || e.cancelled || g?.status !== 'yes' || (requiresApproval(e) && g.approval !== 'approved')) return bot.send(uid,'Payment is available after your acceptance is approved.');
  if (g.payment?.status === 'paid') return bot.send(uid,'Your payment is already confirmed.');
  const previous=orderFor(bot.db,uid,g.payment?.order);
  if(g.payment?.status==='processing' && previous?.checkoutAt && Date.now()-Date.parse(previous.checkoutAt)>15*60000) {previous.status='expired';g.payment={status:'expired'};}
  if (['processing','refund_pending','refund_failed'].includes(g.payment?.status)) return bot.send(uid,'Your payment or refund is being processed. Use /paysupport for help.');
  const total=starTotal(e,g);
  if (!Number.isSafeInteger(total) || total < 1 || total > 100000) return bot.send(uid,'This group total is outside the supported Stars range. Contact the organiser.');
  if (!consent) return bot.send(uid,`${e.title}\nPrice: ${total} Telegram Stars${e.starPricing === 'person' ? ` (${e.starPrice} per person)` : ' per group'}\n\n${e.paymentTerms}\n\nPayments go to this bot’s balance. For payment help use /paysupport. By continuing you agree to these event terms.`, {inline_keyboard:[[{text:'Agree & pay with Stars',callback_data:`star-pay:${e.id}`}],[{text:'Back to event',callback_data:`v:${e.id}`}]]});
  bot.db.preferences[uid] ||= {};
  const orders=bot.db.preferences[uid].starOrders ||= {};
  let order=orderFor(bot.db,uid,g.payment?.order);
  if (!validOrder(bot.db,uid,order)) {
    if (order?.checkoutId && order.status==='pending') return bot.send(uid,'Your payment is being processed. Please wait before trying again.');
    const id=randomBytes(16).toString('hex');
    order=orders[id]={id,event:e.id,owner:e.owner,title:e.title,amount:total,unitPrice:e.starPrice,pricing:e.starPricing,terms:e.paymentTerms,participants:participantCount(e,g),status:'pending',createdAt:new Date().toISOString()};
    g.payment={order:id,status:'pending'};
  }
  return bot.api('sendInvoice',{chat_id:uid,title:e.title.slice(0,32),description:`Event admission · ${order.participants} participant(s)`.slice(0,255),payload:order.id,provider_token:'',currency:'XTR',prices:[{label:'Event admission',amount:order.amount}],start_parameter:`e_${e.id}`});
}
export function checkout(bot,q) {
  const order=orderFor(bot.db,q.from.id,q.invoice_payload);
  const ok=q.currency==='XTR' && validOrder(bot.db,q.from.id,order) && q.total_amount===order.amount && (!order.checkoutId || order.checkoutId===q.id);
  if(ok) { order.checkoutId=q.id; order.checkoutAt ||= new Date().toISOString(); bot.db.events[order.event].guests[q.from.id].payment.status='processing'; }
  return {pre_checkout_query_id:q.id,ok,...(!ok?{error_message:'This invoice is no longer available. Open your event and request a new payment invoice.'}:{})};
}
export async function successful(bot,m) {
  const uid=m.from.id,p=m.successful_payment,order=orderFor(bot.db,uid,p.invoice_payload);
  if (!order || p.currency!=='XTR' || p.total_amount!==order.amount || !p.telegram_payment_charge_id) {
    await bot.send(uid,'Payment needs review. Please contact /paysupport with your Telegram receipt.'); return;
  }
  if(order.charge===p.telegram_payment_charge_id)return;
  if(order.charge) { await bot.api('refundStarPayment',{user_id:uid,telegram_payment_charge_id:p.telegram_payment_charge_id}); return; }
  const valid=validOrder(bot.db,uid,order);
  order.status='paid';order.charge=p.telegram_payment_charge_id;order.paidAt=new Date().toISOString();
  const e=bot.db.events[order.event],g=e?.guests[uid];
  if(!valid) { await requestRefund(bot,uid,order); await bot.send(uid,'Your event changed before payment completed. A full Stars refund has been requested.'); return; }
  g.payment={order:order.id,status:'paid',amount:order.amount};g.ticket=randomBytes(6).toString('hex').toUpperCase();
  await bot.send(uid,`⭐ Payment confirmed: ${order.amount} Stars for ${e.title}.`);
  await bot.send(e.owner,`⭐ ${g.name} paid ${order.amount} Stars for ${order.participants} participant(s).`);
  await bot.ticket(uid,e);
}
export async function requestRefund(bot,uid,order) {
  if(!order?.charge || !['paid','refund_failed'].includes(order.status))return;
  order.status='refund_pending';
  const g=bot.db.events[order.event]?.guests[uid];
  if(g?.payment?.order===order.id)g.payment.status='refund_pending';
  await bot.api('refundStarPayment',{user_id:Number(uid),telegram_payment_charge_id:order.charge});
}
export async function refundResult(bot,uid,charge,ok) {
  const order=Object.values(bot.db.preferences[uid]?.starOrders || {}).find(o=>o.charge===charge);
  if(!order || order.status==='refunded')return;
  order.status=ok?'refunded':'refund_failed';
  const e=bot.db.events[order.event],g=e?.guests[uid];
  if(ok) {
    order.refundedAt=new Date().toISOString();
    if(g?.payment?.order===order.id){g.payment.status='refunded';g.status='no';delete g.ticket;}
    await bot.send(Number(uid),`Your ${order.amount} Stars payment for ${order.title} was refunded.`);
  }
  else if(g?.payment?.order===order.id)g.payment.status='refund_failed';
  await bot.send(order.owner,ok?`Refund confirmed for ${order.title}: ${order.amount} Stars.`:`Refund failed for ${order.title}. Use /paysupport to review and retry.`);
}
