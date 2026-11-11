import {randomUUID} from 'node:crypto';
import Core from '../core.js';
import {update} from './store.mjs';

export const initialState = () => ({
  rooms: [
    {id: 'MTR2', name: 'ห้องประชุม MTR2', capacity: 30, equipment: 'โปรเจกเตอร์ · ไมโครโฟน'},
    {id: 'AB2-003', name: 'ห้องเรียน AB2–003', capacity: 60, equipment: 'โปรเจกเตอร์ · เครื่องเสียง'}
  ], events: [], audit: [], receipts: []
});
function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('กรุณาตรวจสอบข้อความที่กรอก');
  return value.trim();
}
function eventFields(data, rooms, now) {
  const event = {room: text(data.room, 30), title: text(data.title, 180), date: data.date, start: data.start, end: data.end};
  Core.validate(event, rooms);
  const start = Date.parse(`${event.date}T${event.start}:00+07:00`);
  if (start <= now || start > now + 730 * 86400000) fail('เลือกเวลาในอนาคต ไม่เกิน 2 ปี');
  return event;
}
function noConflict(event, events) {
  if (events.some(other => Core.overlap(event, other))) fail('ห้องไม่ว่างในช่วงเวลาที่เลือก กรุณาเลือกเวลาใหม่', 409);
}
export function visibleState(state, user) {
  return {
    me: {id: user.id, name: user.staff ? 'เจ้าหน้าที่' : 'ผู้จองทั่วไป', staff: user.staff, guest: !user.staff},
    rooms: state.rooms,
    events: state.events.filter(e => user.staff || e.ownerId === user.id || e.status !== 'cancelled').map(e => {
      if (user.staff || e.ownerId === user.id) return e;
      const {id, room, date, start, end, type, status, term} = e;
      return {id, room, date, start, end, type, status, term, title: type === 'class' ? e.title : 'จองห้องประชุม'};
    }),
    audit: user.staff ? state.audit : []
  };
}
export async function bookingAction(store, user, action, data = {}, now = Date.now()) {
  if (action === 'state') return visibleState(await store.get('bookings', {type: 'json', consistency: 'strong'}) || initialState(), user);
  if (!['book', 'cancel', 'approve', 'reject', 'room', 'import'].includes(action)) fail('ไม่รองรับคำสั่งนี้');
  if (['approve', 'reject', 'room', 'import'].includes(action) && !user.staff) fail('เฉพาะเจ้าหน้าที่เท่านั้น', 403);
  const requestId = text(data.requestId, 80);
  return update(store, 'bookings', initialState, state => {
    const receipt = state.receipts.find(r => r.id === requestId && r.actor === user.id);
    if (receipt) return receipt.result;
    let target = data.id;
    if (action === 'book') {
      target = text(data.id, 80);
      const old = state.events.find(e => e.id === target);
      if (old) {
        if (old.ownerId === user.id && old.type === 'booking') return {ok: true, id: target};
        fail('หมายเลขคำขอซ้ำ', 409);
      }
      if (!user.staff && state.events.filter(e => e.ownerId === user.id && e.status === 'pending').length >= 5) fail('มีคำขอรออนุมัติครบ 5 รายการแล้ว');
      const event = eventFields(data, state.rooms, now);
      const room = state.rooms.find(r => r.id === event.room);
      if (!Number.isInteger(data.count) || data.count < 1 || data.count > room.capacity) fail('จำนวนผู้เข้าร่วมเกินความจุห้อง');
      Object.assign(event, {id: target, ownerId: user.id, owner: text(data.owner, 100), count: data.count,
        phone: text(data.phone, 30), department: text(data.department || '', 150, false), note: text(data.note || '', 500, false),
        type: 'booking', status: 'pending', term: '', created: new Date(now).toISOString()});
      noConflict(event, state.events);
      state.events.push(event);
    } else if (['cancel', 'approve', 'reject'].includes(action)) {
      const event = state.events.find(e => e.id === target);
      if (!event) fail('ไม่พบรายการ', 404);
      if (!user.staff && (event.ownerId !== user.id || event.type !== 'booking')) fail('ไม่มีสิทธิ์แก้ไขรายการนี้', 403);
      if (event.status === 'cancelled') fail('รายการถูกยกเลิกแล้ว');
      if (action !== 'cancel' && event.status !== 'pending') fail('รายการนี้ได้รับการพิจารณาแล้ว');
      if (action === 'approve') event.status = 'approved';
      else { event.reason = (action === 'reject' ? 'ไม่อนุมัติ: ' : '') + text(data.reason, 500); event.status = 'cancelled'; }
    } else if (action === 'room') {
      const room = {id: text(data.id, 30), name: text(data.name, 100), capacity: data.capacity, equipment: text(data.equipment || '', 180, false)};
      if (!/^[A-Za-z0-9_-]+$/.test(room.id) || !Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 500) fail('รหัสห้องหรือความจุห้องไม่ถูกต้อง');
      if (state.rooms.some(r => r.id.toLowerCase() === room.id.toLowerCase())) fail('รหัสห้องซ้ำ');
      state.rooms.push(room);
    } else {
      const term = text(data.term, 40);
      if (!Array.isArray(data.events) || !data.events.length || data.events.length > 10000) fail('นำเข้าได้ 1–10000 คาบ');
      if (data.replace === true) for (const e of state.events) {
        if (e.type === 'class' && e.term === term && e.status !== 'cancelled') { e.status = 'cancelled'; e.reason = 'แทนที่ด้วยตารางเรียนชุดใหม่'; }
      }
      for (const row of data.events) {
        const event = {...eventFields(row, state.rooms, now), id: randomUUID(), type: 'class', status: 'approved', term,
          ownerId: user.id, owner: 'เจ้าหน้าที่', created: new Date(now).toISOString()};
        noConflict(event, state.events);
        state.events.push(event);
      }
    }
    const result = {ok: true, id: target || null};
    state.audit.unshift({at: new Date(now).toISOString(), actor: user.staff ? 'เจ้าหน้าที่' : 'ผู้จองทั่วไป', action});
    state.audit = state.audit.slice(0, 100);
    state.receipts.push({id: requestId, actor: user.id, result});
    state.receipts = state.receipts.slice(-2000);
    return result;
  });
}
