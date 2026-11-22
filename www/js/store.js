// Small persistence layer: localStorage for settings and lists, IndexedDB for big cached catalogs.
const P = 'signal:';
export const ls = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(P + k); } catch {} }
};

let dbp = null;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
  dbp = dbp || new Promise((res, rej) => {
    const r = indexedDB.open('signal-iptv', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const s = t.objectStore('kv'); const req = fn(s);
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export const idb = {
  get: k => tx('readonly', s => s.get(k)).catch(() => undefined),
  set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => {}),
  del: k => tx('readwrite', s => s.delete(k)).catch(() => {}),
  clear: () => tx('readwrite', s => s.clear()).catch(() => {})
};

export const DEFAULT_SETTINGS = {
  player: 'native',      // native (Android) | web
  buffer: 'normal',      // small | normal | large
  resize: 'fit',         // fit | fill | zoom
  liveFormat: 'm3u8',    // m3u8 | ts  (Xtream live streams)
  userAgent: '',
  clock: 'auto',         // auto | 12 | 24
  fullGuide: false,      // load the provider's full TV guide for Xtream playlists (can be very large)
  hideAdult: false
};
export const settings = () => ({ ...DEFAULT_SETTINGS, ...ls.get('settings', {}) });
export const saveSettings = s => ls.set('settings', s);
