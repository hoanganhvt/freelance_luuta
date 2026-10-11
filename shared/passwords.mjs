import { scryptSync, timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `pbkdf2:100000:${Buffer.from(salt).toString('hex')}:${Buffer.from(bits).toString('hex')}`;
}

export async function checkPassword(password, hash) {
  if (!hash.startsWith('pbkdf2:')) {
    const [salt, value] = hash.split(':');
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(value, 'hex'));
  }
  const [, iterations, salt, value] = hash.split(':');
  if (iterations !== '100000' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(value)) return false;
  const actual = await hashPassword(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(Buffer.from(actual.split(':')[3], 'hex'), Buffer.from(value, 'hex'));
}
