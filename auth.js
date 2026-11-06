'use strict';
window.AAS = (() => {
 const cfg=window.AAS_CONFIG||{}, key='aas-auth-v2';let session=null,refreshing=null;
 try{session=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}
 const configured=()=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl||'')&&!!cfg.publishableKey;
 function keep(s){session=s?{access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600)}:null;if(session)sessionStorage.setItem(key,JSON.stringify(session));else sessionStorage.removeItem(key)}
 async function request(path,body,token,method='POST'){
  if(!configured())throw Error('ยังไม่ได้เชื่อมฐานข้อมูล กรุณาตั้งค่า Supabase ก่อน');
  const res=await fetch(cfg.supabaseUrl+path,{method,headers:{apikey:cfg.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const error=Error(data.msg||data.message||data.error_description||'ติดต่อระบบไม่สำเร็จ');error.status=res.status;throw error}return data;
 }
 async function access(){
  if(!session)throw Error('กรุณาเข้าสู่ระบบ');
  if(session.expires_at*1000<Date.now()+60000){
   if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token}).then(keep).catch(e=>{if(e.status===400||e.status===401){keep(null);location.replace('/login.html')}throw e}).finally(()=>refreshing=null);
   await refreshing;
  }return session.access_token;
 }
 return {configured,guest:async()=>{const result=await request('/auth/v1/signup',{data:{}});if(!result.access_token)throw Error('เปิดการจองทั่วไปใน Supabase ก่อน');keep(result)},hasSession:()=>!!session,
  login:async(email,password)=>keep(await request('/auth/v1/token?grant_type=password',{email,password})),
  logout:async()=>{try{if(session)await request('/auth/v1/logout',{},await access())}finally{keep(null);location.replace('/login.html')}},
  rpc:async(action,data={})=>request('/rest/v1/rpc/booking_api',{p_action:action,p_data:data},await access()),
  recover:email=>request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+'/login.html'),{email}),
  updatePassword:async password=>request('/auth/v1/user',{password},await access(),'PUT'),
  consumeLink:()=>{const p=new URLSearchParams(location.hash.slice(1));if(p.has('access_token')){keep({access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in'))});history.replaceState(null,'',location.pathname);return p.get('type')}if(p.has('error_description')){const message=p.get('error_description');history.replaceState(null,'',location.pathname);throw Error(message)}return null;}
 };
})();
