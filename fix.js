const fs = require('fs');
let c = fs.readFileSync('script.js', 'utf8');
c = c.replace(/\\`/g, '`').replace(/\\\$/g, '$');
fs.writeFileSync('script.js', c);
