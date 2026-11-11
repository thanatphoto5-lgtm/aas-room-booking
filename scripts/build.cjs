const fs = require('node:fs');
const path = require('node:path');
fs.rmSync('dist', {recursive: true, force: true});
fs.mkdirSync('dist');
const files = ['daily.html', 'monitor.html', 'reports.js', 'reports.css', 'login.html', 'borrower.html', 'staff.html', 'login.js', 'auth.js', 'app.js', 'core.js', 'style.css', 'AAS_Schedule_Template.xlsx', 'assets', 'vendor'];
for (const file of files) fs.cpSync(file, path.join('dist', file), {recursive: true});
// Serve the full booking screen directly at the root URL.
fs.copyFileSync('borrower.html', 'dist/index.html');
fs.writeFileSync('dist/_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
  Cache-Control: no-cache
`);
console.log('Built Netlify app in dist. Staff password is read only by the server.');
