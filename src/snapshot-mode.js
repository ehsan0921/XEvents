import { isSuperAdmin } from './admin.js';
import { accessPolicy } from './test-access.js';

export const snapshotPaymentMessage = 'Payments and refunds are disabled for this development database copy.';

export async function snapshotActive(env) {
  if (env.APP_ENV !== 'development') return false;
  // Presence is intentional: malformed or empty metadata must not disable protection.
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key='production-snapshot'").first();
  return row !== null && row !== undefined;
}

export async function snapshotDeliveryAllowed(env, method, params = {}) {
  if (!await snapshotActive(env)) return true;
  if (['sendInvoice', 'createInvoiceLink', 'refundStarPayment'].includes(method)) return false;
  const recipients = ['chat_id', 'user_id'].filter(key => params[key] !== undefined).map(key => params[key]);
  if (!recipients.length) return true;
  let policy;
  for (const value of recipients) {
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return false;
    if (isSuperAdmin({ id: Number(text) }, env)) continue;
    policy ||= await accessPolicy(env, true);
    if (policy.invalid || !policy.ids.includes(text)) return false;
  }
  return true;
}
