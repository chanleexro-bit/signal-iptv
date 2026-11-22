// Turns www/ into the Google Play edition: no extra free-service playlists.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'www';

const cfg = path.join(dir, 'js/config.js');
fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/EDITION = '[a-z]+'/, "EDITION = 'play'"));
fs.writeFileSync(path.join(dir, 'js/presets-full.js'), '// Not included in the Google Play edition.\nexport const FULL_PRESETS = [];\n');

const banned = /i\.mjh\.nz|PlutoTV|SamsungTVPlus|Free-TV\/IPTV/;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const offenders = walk(dir).filter(f => /\.(html|js|json)$/.test(f) && !f.endsWith('hls.min.js') && banned.test(fs.readFileSync(f, 'utf8')));
if (offenders.length) { console.error('Play edition still references removed sources:', offenders); process.exit(1); }
console.log('Play edition prepared in', dir);
