'use strict';
const form = document.querySelector('#loginForm');
const message = document.querySelector('#loginMessage');
form.onsubmit = async event => {
  event.preventDefault();
  const button = document.querySelector('#loginSubmit');
  button.disabled = true;
  message.textContent = 'กำลังตรวจสอบรหัสผ่าน…';
  try {
    await AAS.login(form.elements.password.value);
    form.reset();
    const next = new URLSearchParams(location.search).get('next');
    location.replace(['daily', 'monitor'].includes(next) ? '/' + next + '.html' : '/staff.html');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
