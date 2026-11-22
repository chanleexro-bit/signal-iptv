// Runs after `npx cap add android` / `npx cap sync android`.
// Adds Android TV support, allows plain-HTTP streams and sets the version.
//   VERSION_CODE=107 VERSION_NAME=1.1.7 node scripts/patch-android.js
const fs = require('fs');
const path = require('path');

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(manifestPath, 'utf8');

// Works on TVs and boxes without a touchscreen; listed in the Android TV launcher.
if (!m.includes('android.software.leanback')) {
  m = m.replace(/<application/, [
    '<uses-feature android:name="android.software.leanback" android:required="false" />',
    '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
    '    <application'
  ].join('\n'));
}
if (!m.includes('LEANBACK_LAUNCHER')) {
  m = m.replace(/(<category android:name="android.intent.category.LAUNCHER"\s*\/>)/,
    '$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
}
// Most IPTV servers stream over plain http.
if (!m.includes('usesCleartextTraffic')) {
  m = m.replace(/<application/, '<application android:usesCleartextTraffic="true"');
}
const hasBanner = fs.existsSync('assets/tv_banner.png');
if (!m.includes('android:banner')) {
  m = m.replace(/<application/, `<application android:banner="${hasBanner ? '@drawable/tv_banner' : '@mipmap/ic_launcher'}"`);
}
m = m.replace(/android:configChanges="([^"]*)"/g, (all, v) => v.includes('density') ? all : `android:configChanges="${v}|density"`);
fs.writeFileSync(manifestPath, m);

const bannerDir = 'android/app/src/main/res/drawable-xhdpi';
if (hasBanner) {
  fs.mkdirSync(bannerDir, { recursive: true });
  fs.copyFileSync('assets/tv_banner.png', path.join(bannerDir, 'tv_banner.png'));
}

const gradlePath = 'android/app/build.gradle';
let g = fs.readFileSync(gradlePath, 'utf8');
if (process.env.VERSION_CODE) g = g.replace(/versionCode \d+/, `versionCode ${process.env.VERSION_CODE}`);
if (process.env.VERSION_NAME) g = g.replace(/versionName "[^"]*"/, `versionName "${process.env.VERSION_NAME}"`);
fs.writeFileSync(gradlePath, g);

const checks = ['leanback', 'LEANBACK_LAUNCHER', 'usesCleartextTraffic', 'android:banner'].map(k => `${k}: ${m.includes(k) ? 'yes' : 'NO'}`);
console.log('Android project patched →', checks.join(', '));
console.log((g.match(/versionCode \d+/) || [''])[0], (g.match(/versionName "[^"]*"/) || [''])[0]);
