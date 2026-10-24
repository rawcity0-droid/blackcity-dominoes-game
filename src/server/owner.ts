// Owner back door, same idea as Blackcity Spades: a hidden panel takes the 6-digit OWNER_CODE from the environment.
// The code is never logged or sent back. 5 wrong tries per 15 minutes per connection and per IP, then locked out.
// A right code gives the device an owner pass: a random nonce signed with the code (HMAC), so it survives restarts
// and changing OWNER_CODE on the host cancels every pass.

import crypto from 'node:crypto';

export const OWNER_MAX_FAILS = 5;
export const OWNER_WINDOW_MS = 15 * 60000;

export class OwnerGate {
  private code: Buffer | null;
  private fails = new Map<string, number[]>();

  constructor(code: string | undefined = process.env.OWNER_CODE) {
    this.code = code && /^\d{6}$/.test(code) ? Buffer.from(code) : null;
  }

  get available(): boolean { return this.code !== null; }

  private sign(nonce: string): string { return crypto.createHmac('sha256', this.code!).update('dominoes-owner:' + nonce).digest('hex'); }

  /** Check a typed code. keys = rate-limit buckets (connection id, IP). */
  tryCode(code: string, keys: string[], now = Date.now()): { ok: boolean; code: 'ok' | 'wrong' | 'locked' | 'not_available'; pass?: string; message: string } {
    if (!this.code) return { ok: false, code: 'not_available', message: 'Not available.' };
    const recent = (k: string) => { const a = (this.fails.get(k) ?? []).filter((x) => now - x < OWNER_WINDOW_MS); this.fails.set(k, a); return a; };
    const lockedMsg = 'Too many wrong codes. Try again in 15 minutes.';
    if (keys.some((k) => recent(k).length >= OWNER_MAX_FAILS)) return { ok: false, code: 'locked', message: lockedMsg };
    const given = Buffer.from(/^\d{6}$/.test(code) ? code : '------');
    const ok = crypto.timingSafeEqual(given, this.code);
    console.log(`[activity] ${JSON.stringify({ ev: 'owner_code_unlock', ok, at: new Date(now).toISOString() })}`);
    if (!ok) {
      for (const k of keys) recent(k).push(now);
      const locked = keys.some((k) => recent(k).length >= OWNER_MAX_FAILS);
      return { ok: false, code: locked ? 'locked' : 'wrong', message: locked ? lockedMsg : 'That code is not right.' };
    }
    const nonce = crypto.randomBytes(12).toString('hex');
    return { ok: true, code: 'ok', pass: `${nonce}.${this.sign(nonce)}`, message: 'Owner mode on for this device.' };
  }

  /** Is this a pass we signed with the current code? */
  checkPass(pass: unknown): boolean {
    if (!this.code || typeof pass !== 'string') return false;
    const m = /^([0-9a-f]{24})\.([0-9a-f]{64})$/.exec(pass);
    if (!m) return false;
    return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(this.sign(m[1]), 'hex'));
  }
}

/** Join codes: 5 characters, no look-alikes (0/O, 1/I/L). */
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeJoinCode(taken: (c: string) => boolean): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHA[crypto.randomInt(ALPHA.length)];
    if (!taken(c)) return c;
  }
}
