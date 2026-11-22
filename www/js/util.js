export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

/** Short stable id from a string (FNV-1a). */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let clock24 = null;
export function setClock(mode) { clock24 = mode === '24' ? true : mode === '12' ? false : null; }
export const hm = t => new Date(t).toLocaleTimeString([], clock24 === null
  ? { hour: 'numeric', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: !clock24 });
export const dayLabel = t => {
  const d = new Date(t), now = new Date();
  const diff = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  if (diff === 0) return 'Today'; if (diff === -1) return 'Yesterday'; if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
export function minutesLabel(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${m ? m + ' min' : ''}`.trim() : `${m} min`;
}
export const pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0;
export const yearOf = s => { const m = /\b(19|20)\d{2}\b/.exec(String(s || '')); return m ? m[0] : ''; };
export const initials = name => String(name).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'TV';

/** Decode base64 text as UTF-8 (Xtream EPG titles). */
export function b64(s) {
  if (!s) return '';
  try { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
  catch { return s; }
}
export const isTV = () => /\b(TV|AFT|BRAVIA|SMART-TV|SmartTV|GoogleTV|Android TV)\b/i.test(navigator.userAgent) || matchMedia('(pointer: none)').matches;
