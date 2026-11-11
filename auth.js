'use strict';
window.AAS = (() => {
  async function request(action, data = {}) {
    const response = await fetch('/.netlify/functions/booking', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action, data}), signal: AbortSignal.timeout(30000)
    });
    const result = await response.json().catch(() => ({message: 'โหลดระบบไม่สำเร็จ กรุณาตรวจสอบการเผยแพร่เว็บ'}));
    if (!response.ok) {
      if (response.status === 401 && action !== 'login' && ['/staff.html', '/daily.html', '/monitor.html'].includes(location.pathname)) location.replace('/login.html?next=' + location.pathname.slice(1, -5));
      throw new Error(result.message || 'ทำรายการไม่สำเร็จ');
    }
    return result;
  }
  return {
    guest: () => request('guest'),
    login: password => request('login', {password}),
    rpc: (action, data) => request(action, data),
    logout: async () => { await request('logout'); location.replace('/login.html'); }
  };
})();
