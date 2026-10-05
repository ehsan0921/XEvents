import { createHmac, timingSafeEqual } from 'node:crypto';

export function authenticate(initData, token, now = Math.floor(Date.now() / 1000)) {
  if (!token || typeof initData !== 'string' || initData.length > 12000) return null;
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash || '')) return null;
  params.delete('hash');
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', key).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || now - authDate > 3600 || authDate > now + 30) return null;
  try {
    const user = JSON.parse(params.get('user'));
    return Number.isSafeInteger(user?.id) && user.id > 0 && !user.is_bot ? user : null;
  } catch { return null; }
}
