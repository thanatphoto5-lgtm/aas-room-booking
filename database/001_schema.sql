-- Run once in a NEW Supabase project via SQL Editor. Transactional migration.
begin;
create schema if not exists booking_private;
revoke all on schema booking_private from public, anon, authenticated;
create table booking_private.members (
 user_id uuid primary key references auth.users(id),
 name text not null check(length(btrim(name)) between 1 and 100),
 staff boolean not null default false,
 active boolean not null default true
);
create table booking_private.rooms (
 room_key integer generated always as identity primary key,
 id text not null unique check(id ~ '^[A-Za-z0-9_-]{1,30}$'),
 name text not null check(length(btrim(name)) between 1 and 100),
 capacity integer not null check(capacity between 1 and 500),
 equipment text not null default '' check(length(equipment)<=180)
);
create unique index rooms_id_casefold on booking_private.rooms(lower(id));
create table booking_private.events (
 id uuid primary key default gen_random_uuid(),
 room_key integer not null references booking_private.rooms(room_key),
 owner_id uuid not null references auth.users(id),
 title text not null check(length(btrim(title)) between 1 and 180),
 day date not null,
 start_time time not null,
 end_time time not null,
 kind text not null check(kind in ('booking','class')),
 status text not null check(status in ('pending','approved','cancelled')),
 owner_name text not null,
 attendees integer check(attendees between 1 and 500),
 phone text not null default '' check(length(phone)<=30),
 department text not null default '' check(length(department)<=150),
 note text not null default '' check(length(note)<=500),
 term text not null default '' check(length(term)<=40),
 reason text not null default '' check(length(reason)<=500),
 created_at timestamptz not null default now(),
 check(start_time>=time '08:00' and end_time<=time '18:00' and start_time<end_time),
 -- Native GiST range constraint rejects overlaps even across concurrent requests.
 exclude using gist (
  int4range(room_key,room_key,'[]') with &&,
  tsrange(day+start_time,day+end_time,'[)') with &&
 ) where (status in ('pending','approved'))
);
create index events_day on booking_private.events(day);
create index events_owner on booking_private.events(owner_id);
create table booking_private.audit (
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 actor_id uuid not null,
 actor text not null,
 action text not null,
 event_id uuid
);
alter table booking_private.members enable row level security;
alter table booking_private.rooms enable row level security;
alter table booking_private.events enable row level security;
alter table booking_private.audit enable row level security;
revoke all on all tables in schema booking_private from public, anon, authenticated;
-- Confirm these SAMPLE capacities with the department before opening bookings.
insert into booking_private.rooms(id,name,capacity,equipment) values
 ('MTR2','ห้องประชุม MTR2',30,'โปรเจกเตอร์ · ไมโครโฟน'),
 ('AB2-003','ห้องเรียน AB2–003',60,'โปรเจกเตอร์ · เครื่องเสียง');
create or replace function public.booking_api(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid := auth.uid(); m booking_private.members%rowtype;
 e booking_private.events%rowtype; r booking_private.rooms%rowtype;
 x jsonb; target uuid; d date; t time; z time; n integer; result jsonb;
begin
 if u is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode='42501'; end if;
 select * into m from booking_private.members where user_id=u and active;
 if not found then raise exception 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อเจ้าหน้าที่' using errcode='42501'; end if;
 if p_action='state' then
  select jsonb_build_object(
   'me',jsonb_build_object('id',u,'name',m.name,'staff',m.staff),
   'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'capacity',capacity,'equipment',equipment) order by id),'[]'::jsonb) from booking_private.rooms),
   'events',(select coalesce(jsonb_agg(
    jsonb_build_object('id',ev.id,'room',rm.id,'title',ev.title,'date',ev.day,'start',to_char(ev.start_time,'HH24:MI'),'end',to_char(ev.end_time,'HH24:MI'),'type',ev.kind,'status',ev.status,'term',ev.term)
    ||case when m.staff or ev.owner_id=u then jsonb_build_object('ownerId',ev.owner_id,'owner',ev.owner_name,'phone',ev.phone,'department',ev.department,'note',ev.note,'count',ev.attendees,'reason',ev.reason,'created',ev.created_at) else '{}'::jsonb end
    order by ev.day,ev.start_time),'[]'::jsonb)
    from booking_private.events ev join booking_private.rooms rm on rm.room_key=ev.room_key),
   'audit',case when m.staff then (select coalesce(jsonb_agg(a),'[]'::jsonb) from (select at,actor,action from booking_private.audit order by id desc limit 100) a) else '[]'::jsonb end
  ) into result;
  return result;
 end if;
 if p_action not in ('book','cancel','approve','reject','room','import') then raise exception 'ไม่รองรับคำสั่งนี้'; end if;
 if p_action in ('approve','reject','room','import') and not m.staff then raise exception 'เฉพาะเจ้าหน้าที่เท่านั้น' using errcode='42501'; end if;
 -- Serialize term replacements against each other, and room capacity changes if extended later.
 if p_action='import' then perform pg_advisory_xact_lock(847210); end if;
 if p_action='book' then
  target:=(p_data->>'id')::uuid;
  if target is null then raise exception 'ไม่พบหมายเลขคำขอ'; end if;
  select * into e from booking_private.events where id=target;
  if found then
   if e.owner_id=u and e.kind='booking' then return jsonb_build_object('ok',true,'id',target); end if;
   raise exception 'หมายเลขคำขอซ้ำ';
  end if;
  select * into r from booking_private.rooms where id=p_data->>'room';
  if not found then raise exception 'ไม่พบห้อง'; end if;
  d:=(p_data->>'date')::date;t:=(p_data->>'start')::time;z:=(p_data->>'end')::time;n:=(p_data->>'count')::integer;
  if d is null or t is null or z is null or (d+t) at time zone 'Asia/Bangkok'<=now() or d>(now() at time zone 'Asia/Bangkok')::date+730 then raise exception 'เลือกเวลาในอนาคต ไม่เกิน 2 ปี'; end if;
  if n is null or n<1 or n>r.capacity then raise exception 'จำนวนผู้เข้าร่วมเกินความจุห้อง'; end if;
  if length(btrim(coalesce(p_data->>'phone','')))=0 then raise exception 'ระบุเบอร์ติดต่อ'; end if;
  insert into booking_private.events(id,room_key,owner_id,owner_name,title,day,start_time,end_time,kind,status,attendees,phone,department,note)
   values(target,r.room_key,u,m.name,p_data->>'title',d,t,z,'booking','pending',n,p_data->>'phone',coalesce(p_data->>'department',''),coalesce(p_data->>'note',''));
 elsif p_action in ('cancel','approve','reject') then
  target:=(p_data->>'id')::uuid;
  select * into e from booking_private.events where id=target for update;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  if not m.staff and (e.owner_id<>u or e.kind<>'booking') then raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้' using errcode='42501'; end if;
  if e.status='cancelled' then raise exception 'รายการถูกยกเลิกแล้ว'; end if;
  if p_action in ('approve','reject') and e.status<>'pending' then raise exception 'รายการนี้ได้รับการพิจารณาแล้ว'; end if;
  if p_action='approve' then
   update booking_private.events set status='approved' where id=target;
  else
   if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'กรุณาระบุเหตุผล'; end if;
   update booking_private.events set status='cancelled',reason=case when p_action='reject' then 'ไม่อนุมัติ: ' else '' end || (p_data->>'reason') where id=target;
  end if;
 elsif p_action='room' then
  insert into booking_private.rooms(id,name,capacity,equipment) values(p_data->>'id',p_data->>'name',(p_data->>'capacity')::integer,coalesce(p_data->>'equipment',''));
 elsif p_action='import' then
  if jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'ข้อมูลคาบเรียนไม่ถูกต้อง'; end if;
  n:=jsonb_array_length(p_data->'events');
  if n<1 or n>10000 or length(btrim(coalesce(p_data->>'term',''))) not between 1 and 40 then raise exception 'ภาคเรียนหรือจำนวนคาบไม่ถูกต้อง (1–10000 คาบ)'; end if;
  if coalesce((p_data->>'replace')::boolean,false) then
   update booking_private.events set status='cancelled',reason='แทนที่ด้วยตารางเรียนชุดใหม่' where kind='class' and term=p_data->>'term' and status<>'cancelled';
  end if;
  for x in select value from jsonb_array_elements(p_data->'events') loop
   select * into r from booking_private.rooms where id=x->>'room';
   if not found then raise exception 'ไม่พบห้องในตารางเรียน'; end if;
   d:=(x->>'date')::date;t:=(x->>'start')::time;z:=(x->>'end')::time;
   if d is null or t is null or z is null or (d+t) at time zone 'Asia/Bangkok'<=now() or d>(now() at time zone 'Asia/Bangkok')::date+730 then raise exception 'คาบเรียนต้องเริ่มในอนาคตและไม่เกิน 2 ปี'; end if;
   insert into booking_private.events(room_key,owner_id,owner_name,title,day,start_time,end_time,kind,status,term)
    values(r.room_key,u,m.name,x->>'title',d,t,z,'class','approved',p_data->>'term');
  end loop;
 end if;
 insert into booking_private.audit(actor_id,actor,action,event_id) values(u,m.name,p_action||case when p_action='import' then ' ภาคเรียน '||(p_data->>'term')||' จำนวน '||n else '' end,target);
 return jsonb_build_object('ok',true,'id',target);
exception when exclusion_violation then raise exception 'ห้องไม่ว่างในช่วงเวลาที่เลือก กรุณาโหลดข้อมูลล่าสุดแล้วเลือกเวลาใหม่';
end;
$$;
revoke all on function public.booking_api(text,jsonb) from public,anon;
grant execute on function public.booking_api(text,jsonb) to authenticated;
commit;
