import {createHmac, createHash, timingSafeEqual, randomBytes, randomUUID} from 'node:crypto';
import {bookingAction} from './bookings.mjs';
import {update} from './store.mjs';
const cookieName = '__Host-aas-session';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const error = (message, status) => Object.assign(new Error(message), {status});
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
function verify(token, secret, password, now) {
  try {
    const [body, signature] = token.split('.');
    if (!equal(signature || '', createHmac('sha256', secret).update(body).digest('base64url'))) return null;
    const user = JSON.parse(Buffer.from(body, 'base64url'));
    if (!Number.isFinite(user.expires) || user.expires <= now || typeof user.id !== 'string' || typeof user.staff !== 'boolean') return null;
    if (user.staff && !equal(user.version || '', createHmac('sha256', secret).update(password).digest('hex'))) return null;
    return user;
  } catch { return null; }
}
async function sessionSecret(store) {
  const existing = await store.get('session-secret', {type: 'json', consistency: 'strong'});
  if (existing) return existing;
  const secret = randomBytes(48).toString('base64url');
  await store.setJSON('session-secret', secret, {onlyIfNew: true});
  return store.get('session-secret', {type: 'json', consistency: 'strong'});
}
async function limit(store, ip, category, max, now) {
  const key = 'rate-' + createHash('sha256').update(category + ip).digest('hex');
  const allowed = await update(store, key, () => ({count: 0, until: now + 900000}), data => {
    if (data.until <= now) { data.count = 0; data.until = now + 900000; }
    if (data.count >= max) return false;
    data.count++;
    return true;
  });
  if (!allowed) throw error('ทำรายการบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่', 429);
}
export function createHandler(getStore, env = process.env) {
  return async (request, context = {}) => {
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
    try {
      if (request.method !== 'POST') return reply({message: 'Method not allowed'}, 405);
      const origin = new URL(request.url).origin;
      if (request.headers.get('origin') !== origin) throw error('กรุณาเปิดผ่านหน้าเว็บไซต์', 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw error('รูปแบบข้อมูลไม่ถูกต้อง', 415);
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 4000000) throw error('ไฟล์มีขนาดใหญ่เกินไป', 413);
      let input;
      try { input = JSON.parse(raw); } catch { throw error('รูปแบบข้อมูลไม่ถูกต้อง', 400); }
      if (!input || typeof input !== 'object') throw error('รูปแบบข้อมูลไม่ถูกต้อง', 400);
      const {action, data = {}} = input;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw error('รูปแบบข้อมูลไม่ถูกต้อง', 400);
      const password = env.STAFF_PASSWORD || '';
      if (password.length < 12) throw error('ผู้ดูแลต้องตั้ง STAFF_PASSWORD ใน Netlify อย่างน้อย 12 ตัวอักษร', 503);
      const store = getStore();
      const secret = await sessionSecret(store);
      const now = Date.now();
      const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
      let user = verify(token, secret, password, now);
      // Consult persistent revocations for every request, including legacy cookies.
      if (user && await store.get('revoked-' + user.id, {type: 'json', consistency: 'strong'})) user = null;
      const setSession = (staff) => {
        const seconds = staff ? 8 * 3600 : 30 * 86400;
        user = {id: randomUUID(), staff, expires: now + seconds * 1000};
        if (staff) user.version = createHmac('sha256', secret).update(password).digest('hex');
        headers['Set-Cookie'] = `${cookieName}=${sign(user, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
      };
      const ip = context.ip || 'unknown';
      if (action === 'login') {
        await limit(store, ip, 'login', 10, now);
        if (typeof data.password !== 'string' || data.password.length > 1024 || !equal(data.password, password)) throw error('รหัสผ่านไม่ถูกต้อง', 401);
        if (user) await store.setJSON('revoked-' + user.id, {expires: user.expires});
        setSession(true);
        return reply({ok: true, staff: true});
      }
      if (action === 'logout') {
        // Clear the browser cookie only after server-side revocation succeeds.
        if (user) await store.setJSON('revoked-' + user.id, {expires: user.expires});
        headers['Set-Cookie'] = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
        return reply({ok: true});
      }
      if (action === 'guest') {
        if (!user) { await limit(store, ip, 'guest', 60, now); setSession(false); }
        return reply({ok: true});
      }
      if (!user) throw error('กรุณาเข้าสู่ระบบอีกครั้ง', 401);
      if (action !== 'state') await limit(store, ip, 'write', 100, now);
      return reply(await bookingAction(store, user, action, data, now));
    } catch (err) {
      if (err.status) return reply({message: err.message}, err.status);
      // Validation errors from the shared calendar core are safe to display.
      if (/วันที่ไม่ถูกต้อง|กรุณาระบุชื่อกิจกรรม|ไม่พบห้องที่เลือก|เวลาสิ้นสุด|จองได้ในช่วง/.test(err.message)) return reply({message: err.message}, 400);
      console.error('Booking service failed', err.name);
      return reply({message: 'ติดต่อระบบจัดเก็บข้อมูลไม่ได้ กรุณาลองอีกครั้ง'}, 500);
    }
  };
}
