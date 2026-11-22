// XMLTV guide parsing, kept to programmes from 3 hours ago to 30 hours ahead.
const unx = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
}).trim();
export const normName = s => String(s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265)\b/g, ' ').replace(/[^a-z0-9]+/g, '');

export function xmltvTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s || '');
  if (!m) return NaN;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { const sg = m[7][0] === '-' ? -1 : 1; t -= sg * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000; }
  return t;
}

export class Guide {
  constructor() { this.progs = new Map(); this.names = new Map(); }
  get size() { return this.progs.size; }
  add(xml) {
    const now = Date.now(), lo = now - 3 * 3600e3, hi = now + 30 * 3600e3;
    let m;
    const chRe = /<channel\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
    while ((m = chRe.exec(xml))) {
      const id = unx(m[1]).toLowerCase(); const dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g; let d;
      while ((d = dn.exec(m[2]))) { const k = normName(unx(d[1])); if (k && !this.names.has(k)) this.names.set(k, id); }
    }
    const pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    let added = 0;
    while ((m = pRe.exec(xml))) {
      const a = m[1];
      const s = xmltvTime((/\bstart="([^"]*)"/.exec(a) || [])[1]);
      const e = xmltvTime((/\bstop="([^"]*)"/.exec(a) || [])[1]);
      if (!(e > lo && s < hi)) continue;
      const ch = unx((/\bchannel="([^"]*)"/.exec(a) || [])[1] || '').toLowerCase();
      if (!ch) continue;
      const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
      const sub = /<sub-title[^>]*>([\s\S]*?)<\/sub-title>/.exec(m[2]);
      const dsc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
      let title = t ? unx(t[1]) : 'Untitled';
      if (sub) title += ' — ' + unx(sub[1]);
      let desc = dsc ? unx(dsc[1]) : '';
      if (desc.length > 400) desc = desc.slice(0, 397) + '…';
      if (!this.progs.has(ch)) this.progs.set(ch, []);
      this.progs.get(ch).push({ s, e: isNaN(e) ? s + 3600e3 : e, t: title, d: desc });
      added++;
    }
    for (const arr of this.progs.values()) arr.sort((x, y) => x.s - y.s);
    return added;
  }
  find(ch) {
    for (const id of [ch.epgId, (ch.epgId || '').split('@')[0]].filter(Boolean).map(s => s.toLowerCase())) {
      if (this.progs.has(id)) return this.progs.get(id);
    }
    for (const n of [ch.tvgName, ch.name]) {
      const id = n && this.names.get(normName(n));
      if (id && this.progs.has(id)) return this.progs.get(id);
    }
    return null;
  }
}

export function nowNext(list, n = 8) {
  if (!list || !list.length) return null;
  const t = Date.now();
  const i = list.findIndex(p => p.e > t);
  if (i < 0) return { now: null, next: [], past: list.slice(-n) };
  const now = list[i].s <= t ? list[i] : null;
  const from = now ? i + 1 : i;
  return { now, next: list.slice(from, from + n), past: list.slice(Math.max(0, i - 12), i) };
}
