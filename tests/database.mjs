import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;`);
await db.exec(await readFile(new URL('../database/001_schema.sql',import.meta.url),'utf8'));
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',staff='00000000-0000-4000-8000-000000000003',outsider='00000000-0000-4000-8000-000000000004';
await db.exec(`insert into auth.users values ('${a}'),('${b}'),('${staff}'),('${outsider}');insert into booking_private.members(user_id,name,staff) values ('${a}','A',false),('${b}','B',false),('${staff}','Staff',true)`);
async function as(id){await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`)}
async function rpc(action,data={}){return (await db.query('select public.booking_api($1,$2::jsonb) as data',[action,JSON.stringify(data)])).rows[0].data}
const date=new Date(Date.now()+86400000*3).toISOString().slice(0,10);
const booking={id:'10000000-0000-4000-8000-000000000001',room:'MTR2',title:'Test',date,start:'09:00',end:'10:00',count:2,phone:'private-phone',note:'private-note'};
let tests=0;async function reject(fn,pattern){await assert.rejects(fn,pattern);tests++}
await as(outsider);await reject(()=>rpc('state'),/สิทธิ์/);
await as(a);await rpc('book',{...booking,status:'approved',ownerId:b});let state=await rpc('state');assert.equal(state.events[0].status,'pending');assert.equal(state.events[0].ownerId,a);tests++;
await rpc('book',booking);assert.equal((await rpc('state')).events.length,1);tests++;
await reject(()=>rpc('approve',{id:booking.id}),/เจ้าหน้าที่/);
await reject(()=>rpc('room',{id:'X',name:'X',capacity:10}),/เจ้าหน้าที่/);
await reject(()=>rpc('import',{events:[],term:'2/69'}),/เจ้าหน้าที่/);
await reject(()=>db.query('select * from booking_private.events'),/permission denied/);
await reject(()=>db.query('update booking_private.members set staff=true'),/permission denied/);
await as(b);state=await rpc('state');assert.equal(state.events[0].phone,undefined);assert.equal(state.events[0].ownerId,undefined);assert.equal(state.events[0].note,undefined);tests++;
await reject(()=>rpc('cancel',{id:booking.id,reason:'hack'}),/ไม่มีสิทธิ์/);
await reject(()=>rpc('book',{...booking,id:'10000000-0000-4000-8000-000000000002',start:'09:30',end:'10:30'}),/ไม่ว่าง/);
await rpc('book',{...booking,id:'10000000-0000-4000-8000-000000000003',start:'10:00',end:'11:00'});tests++;
await reject(()=>rpc('book',{...booking,id:'10000000-0000-4000-8000-000000000004',count:999}),/ความจุ/);
await reject(()=>rpc('book',{...booking,id:'10000000-0000-4000-8000-000000000005',date:'2020-01-01'}),/อนาคต/);
await as(staff);await rpc('approve',{id:booking.id});assert.equal((await rpc('state')).events[0].phone,'private-phone');tests++;
await reject(()=>rpc('reject',{id:booking.id,reason:'no'}),/พิจารณา/);
const c={room:'AB2-003',title:'Class',date,start:'13:00',end:'14:00'};
await rpc('import',{events:[c],term:'TEST',replace:false});tests++;
await reject(()=>rpc('import',{events:[{...c,start:'14:00',end:'15:00'},{...c,room:'MTR2',start:'09:00',end:'10:00'}],term:'TEST',replace:true}),/ไม่ว่าง/);
state=await rpc('state');assert.equal(state.events.filter(e=>e.type==='class'&&e.status==='approved').length,1);assert.equal(state.events.find(e=>e.type==='class').start,'13:00');tests++;
await as(a);await rpc('cancel',{id:booking.id,reason:'cancel own'});tests++;
await as(b);await rpc('book',{...booking,id:'10000000-0000-4000-8000-000000000006'});tests++;
await db.exec('reset role;set role anon');await reject(()=>rpc('state'),/permission denied/);
await db.exec(`reset role;update booking_private.members set active=false where user_id='${b}'`);await as(b);await reject(()=>rpc('state'),/สิทธิ์/);
console.log(`Database integration: ${tests} cases passed (PostgreSQL WASM).`);await db.close();
