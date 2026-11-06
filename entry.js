location.replace(location.hash.includes('access_token=') || location.hash.includes('error=') ? '/login.html'+location.hash : '/borrower.html');
