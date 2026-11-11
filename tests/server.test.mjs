import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingAction} from '../server/bookings.mjs';
import {createHandler} from '../server/handler.mjs';
class MemoryStore {
  entries = new Map();
  version = 0;
  async get(key) { return structuredClone(this.entries.get(key)?.data ?? null); }
  async getWithMetadata(key) { return structuredClone(this.entries.get(key) ?? null); }
  async setJSON(key, data, options = {}) {
    const current = this.entries.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return {modified: false};
    const etag = String(++this.version);
    this.entries.set(key, {data: structuredClone(data), etag});
    return {modified: true, etag};
  }
}
const guest = {id: 'guest-1', staff: false};
const staff = {id: 'staff-1', staff: true};
const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const booking = (extra = {}) => ({id: randomUUID(), requestId: randomUUID(), room: 'MTR2', title: 'ประชุมทดสอบ', date, start: '09:00', end: '10:00', owner: 'ผู้ทดสอบ', phone: '0812345678', count: 2, ...extra});
test('concurrent overlapping bookings commit once; retry is idempotent', async () => {
  const store = new MemoryStore();
  const a = booking(), b = booking();
  const results = await Promise.allSettled([bookingAction(store, guest, 'book', a), bookingAction(store, guest, 'book', b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const saved = await store.get('bookings');
  assert.equal(saved.events.length, 1);
  const winner = saved.events[0].id === a.id ? a : b;
  await bookingAction(store, guest, 'book', winner);
  assert.equal((await store.get('bookings')).events.length, 1);
});
test('server rejects guest staff operations, cancellation of others, and forged privilege', async () => {
  const store = new MemoryStore();
  const data = booking();
  await bookingAction(store, guest, 'book', data);
  for (const action of ['approve', 'reject', 'room', 'import']) await assert.rejects(bookingAction(store, guest, action, {...data, staff: true}), /เจ้าหน้าที่/);
  await assert.rejects(bookingAction(store, {id: 'other', staff: false}, 'cancel', {...data, reason: 'x'}), /สิทธิ์/);
  const publicState = await bookingAction(store, {id: 'other', staff: false}, 'state');
  assert.equal(publicState.events[0].phone, undefined);
  assert.equal(publicState.events[0].owner, undefined);
  assert.equal(publicState.events[0].title, 'จองห้องประชุม');
  assert.deepEqual(publicState.audit, []);
  await bookingAction(store, staff, 'approve', {...data, requestId: randomUUID()});
  assert.equal((await store.get('bookings')).events[0].status, 'approved');
});
test('invalid booking values do not write; adjacent times accepted', async () => {
  const store = new MemoryStore();
  for (const extra of [{count: 1000}, {end: '08:00'}, {date: '2020-01-01'}, {room: 'missing'}, {phone: ''}]) {
    await assert.rejects(bookingAction(store, guest, 'book', booking(extra)));
    assert.equal(await store.get('bookings'), null);
  }
  await bookingAction(store, guest, 'book', booking());
  await bookingAction(store, guest, 'book', booking({start: '10:00', end: '11:00'}));
  assert.equal((await store.get('bookings')).events.length, 2);
});
test('failed term replacement rolls back fully; successful retry is idempotent', async () => {
  const store = new MemoryStore();
  const row = booking();
  const first = {requestId: randomUUID(), term: '2/2569', events: [row]};
  await bookingAction(store, staff, 'import', first);
  const before = await store.get('bookings');
  await assert.rejects(bookingAction(store, staff, 'import', {requestId: randomUUID(), term: first.term, replace: true, events: [row, row]}), /ไม่ว่าง/);
  assert.deepEqual(await store.get('bookings'), before);
  await bookingAction(store, staff, 'import', first);
  assert.deepEqual(await store.get('bookings'), before);
});
test('HTTP login only needs password; cookies signed; password rotation, CSRF and throttling enforced', async () => {
  const store = new MemoryStore();
  const env = {STAFF_PASSWORD: 'unit-test-password-only'};
  const handler = createHandler(() => store, env);
  const call = (action, data = {}, cookie = '', origin = 'https://example.netlify.app') => handler(new Request('https://example.netlify.app/.netlify/functions/booking', {
    method: 'POST', headers: {'Content-Type': 'application/json', origin, cookie}, body: JSON.stringify({action, data})
  }), {ip: 'test-ip'});
  assert.equal((await call('state')).status, 401);
  assert.equal((await call('login', {password: 'wrong'})).status, 401);
  const login = await call('login', {password: env.STAFF_PASSWORD});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await (await call('state', {}, cookie)).json()).me.staff, true);
  assert.equal((await call('state', {}, cookie + 'x')).status, 401);
  assert.equal((await call('state', {}, cookie, 'https://attacker.example')).status, 403);
  env.STAFF_PASSWORD = 'changed-test-password';
  assert.equal((await call('state', {}, cookie)).status, 401);
  for (let i = 0; i < 8; i++) await call('login', {password: 'wrong'});
  assert.equal((await call('login', {password: env.STAFF_PASSWORD})).status, 429);
  const response = await call('guest');
  const guestCookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('state', {}, guestCookie)).json()).me.guest, true);
  assert.equal((await call('room', {staff: true}, guestCookie)).status, 403);
  assert.match((await call('logout', {}, guestCookie)).headers.get('set-cookie'), /Max-Age=0/);
});
