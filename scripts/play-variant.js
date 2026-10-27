// Turns www/index.html into the Google Play version:
// removes <!--full-->…<!--/full--> blocks and un-comments <!--play:…--> blocks.
const fs = require('fs');
const file = process.argv[2] || 'www/index.html';
let s = fs.readFileSync(file, 'utf8');
const before = s.length;
s = s.replace(/<!--full-->[\s\S]*?<!--\/full-->/g, '');
s = s.replace(/<!--play:([\s\S]*?)-->/g, '$1');
if (/i\.mjh\.nz|Free-TV|PlutoTV|SamsungTVPlus/.test(s)) { console.error('Play variant still references removed sources'); process.exit(1); }
fs.writeFileSync(file, s);
console.log(`Play variant written (${before} -> ${s.length} bytes)`);
