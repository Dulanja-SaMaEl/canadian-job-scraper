const https = require('https');
const fs = require('fs');

https.get('https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=flagperson&fglo=1&sort=M&page=1', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => fs.writeFileSync('scratch.html', data));
});
