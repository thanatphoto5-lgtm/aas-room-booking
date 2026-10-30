(function(root,factory){if(typeof module==='object')module.exports=factory();else root.BookingCore=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
const weekdays=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;let d=new Date(s+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s}
function shift(s,n){let d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function day(s){return new Date(s+'T12:00:00Z').getUTCDay()}
function minutes(t){if(!/^\d{2}:\d{2}$/.test(t||''))return NaN;let [h,m]=t.split(':').map(Number);return h<24&&m<60?h*60+m:NaN}
function overlap(a,b){return a.room===b.room&&a.date===b.date&&a.status!=='cancelled'&&b.status!=='cancelled'&&minutes(a.start)<minutes(b.end)&&minutes(b.start)<minutes(a.end)}
function validate(e,rooms){if(!validDate(e.date))throw Error('วันที่ไม่ถูกต้อง');if(!e.title?.trim())throw Error('กรุณาระบุชื่อกิจกรรม');if(!rooms.some(r=>r.id===e.room))throw Error('ไม่พบห้องที่เลือก');let a=minutes(e.start),b=minutes(e.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw Error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');if(a<480||b>1080)throw Error('จองได้ในช่วง 08.00–18.00 น.');return e}
function weekday(value){let s=String(value??'').trim().replace(/^วัน/,'');let i=weekdays.indexOf(s);if(i>=0)return i;const alias={'อา.':0,'จ.':1,'อ.':2,'พ.':3,'พฤ.':4,'ศ.':5,'ส.':6};if(Object.hasOwn(alias,s))return alias[s];if(/^[0-6]$/.test(s))return Number(s);throw Error('วันเรียนต้องเป็น จันทร์–อาทิตย์ หรือเลข 0–6 (0=อาทิตย์)')}
function expand(rows,options,rooms){if(!validDate(options.start)||!validDate(options.end)||options.end<options.start)throw Error('ตรวจสอบวันเริ่มและวันสิ้นสุดเทอม');if((new Date(options.end)-new Date(options.start))/86400000>370)throw Error('ช่วงภาคเรียนต้องไม่เกิน 370 วัน');if(!options.term.trim())throw Error('ระบุภาคเรียน');if(!rows.length||rows.length>500)throw Error('ไฟล์ต้องมีข้อมูล 1–500 แถว');const excluded=new Set(options.exceptions||[]);for(const d of excluded)if(!validDate(d))throw Error('วันงดสอนไม่ถูกต้อง: '+d);let events=[];rows.forEach((r,i)=>{try{let wd=weekday(r.day);for(let date=options.start;date<=options.end;date=shift(date,1)){if(day(date)!==wd||excluded.has(date))continue;let e={room:r.room,date,start:r.start,end:r.end,title:r.title,type:'class',status:'approved',term:options.term};validate(e,rooms);events.push(e)}}catch(e){throw Error('แถว '+(i+2)+': '+e.message)}});if(!events.length)throw Error('ไม่มีคาบเรียนในช่วงวันที่ที่เลือก');return events}
function conflicts(incoming,existing){let found=[];incoming.forEach((e,i)=>{let other=existing.find(x=>overlap(e,x))||incoming.slice(0,i).find(x=>overlap(e,x));if(other)found.push({event:e,other})});return found}
function layoutEvents(events){
const sorted=events.filter(e=>e.status!=='cancelled').slice().sort((a,b)=>a.date.localeCompare(b.date)||minutes(a.start)-minutes(b.start)||minutes(a.end)-minutes(b.end)||a.room.localeCompare(b.room));
let output=[],group=[],ends=[],groupEnd=-1,groupDate='';
function flush(){for(const item of group)output.push({...item,columns:ends.length});group=[];ends=[];groupEnd=-1}
for(const event of sorted){const start=minutes(event.start),end=minutes(event.end);if(group.length&&(event.date!==groupDate||start>=groupEnd))flush();groupDate=event.date;let lane=ends.findIndex(t=>t<=start);if(lane<0)lane=ends.length;ends[lane]=end;groupEnd=Math.max(groupEnd,end);group.push({event,lane})}flush();return output
}
return {layoutEvents,weekdays,validDate,shift,day,minutes,overlap,validate,weekday,expand,conflicts};
});
