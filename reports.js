'use strict';
const byId=id=>document.getElementById(id);
const monitor=document.body.dataset.mode==='monitor';
const thaiDay=new Intl.DateTimeFormat('th-TH',{dateStyle:'full',timeZone:'Asia/Bangkok'});
const clock=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
let rooms=[], events=[], day=today(), room='', slide=0, busy=false;
function field(tag,value){const el=document.createElement(tag);el.textContent=value;return el}
function draw(){
 if(monitor)day=today();
 const rows=events.filter(e=>e.date===day&&(!room||room===e.room)&&e.status!=='cancelled'&&(!monitor||e.status==='approved')).sort((a,b)=>a.start.localeCompare(b.start)||a.room.localeCompare(b.room));
 const names=new Map(rooms.map(r=>[r.id,r.name]));
 byId('caption').textContent=thaiDay.format(new Date(day+'T12:00:00+07:00'))+' · '+(names.get(room)||'ทุกห้อง');
 const now=clock.format(new Date()),pages=Math.max(1,Math.ceil(rows.length/4));
 slide%=pages;
 const visible=monitor?rows.slice(slide*4,slide*4+4):rows;
 byId('items').replaceChildren(...visible.map(e=>{
  const row=document.createElement('article'),body=field('div',e.title);
  body.append(field('small',names.get(e.room)||e.room));
  const active=day===today()&&e.start<=now&&now<e.end;
  const status=monitor?(active?'กำลังใช้ห้อง':e.end<=now?'เสร็จสิ้น':'กำลังจะเริ่ม'):(e.status==='pending'?'รออนุมัติ':e.type==='class'?'ตารางเรียน':'อนุมัติแล้ว');
  if(active&&e.status==='approved')row.className='current';
  row.append(field('b',e.start+'–'+e.end),body,field('strong',status));return row;
 }));
 byId('foot').textContent=rows.length+' รายการ'+(monitor?' · หน้า '+(slide+1)+'/'+pages+' · เวลา '+now+' น.':'');
}
async function load(){
 if(busy)return;busy=true;
 try{
  const state=await AAS.rpc('state');
  if(!state.me.staff){location.replace('/login.html?next='+(monitor?'monitor':'daily'));throw Error('กรุณาใส่รหัสผ่านเจ้าหน้าที่')}
  rooms=state.rooms;
  events=state.events.map(({date,room,title,start,end,type,status})=>({date,room,title,start,end,type,status}));
  const selected=byId('room').value;
  byId('room').replaceChildren(new Option('ทุกห้อง',''),...rooms.map(r=>new Option(r.name,r.id)));
  byId('room').value=selected;
  byId('screen').hidden=false;byId('message').textContent='อัปเดตล่าสุด '+clock.format(new Date())+' น.';draw();
 }catch(error){events=[];byId('items').replaceChildren();byId('screen').hidden=true;byId('message').textContent='แสดงข้อมูลไม่ได้ · '+error.message}finally{busy=false}
}
{
 if(!monitor)byId('day').value=day;
 byId('filters').onsubmit=e=>{e.preventDefault();room=byId('room').value;day=monitor?today():byId('day').value;slide=0;draw();load()};
 byId('action').onclick=async()=>{if(!monitor)return window.print();try{await document.documentElement.requestFullscreen()}catch{byId('message').textContent='ใช้ปุ่ม F11 ของเบราว์เซอร์เพื่อแสดงเต็มจอ'}};
 load();setInterval(load,30000);if(monitor)setInterval(()=>{slide++;draw()},10000);
}
