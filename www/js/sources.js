import { idb } from './store.js';
import { getText, getMaybeGzip } from './net.js';
import { catalogFromM3U } from './m3u.js';
import { Xtream } from './xtream.js';
import { Guide } from './xmltv.js';

const CACHE_HOURS = 12;

export function clientFor(pl) {
  return pl.type === 'xtream' ? new Xtream(pl) : null;
}

/** Load a playlist's catalog (live, movies, series), from cache when fresh. */
export async function loadCatalog(pl, { force = false } = {}) {
  const key = 'cat:' + pl.id;
  if (!force) {
    const cached = await idb.get(key);
    if (cached && cached.data && Date.now() - cached.at < CACHE_HOURS * 3600e3) return { ...cached.data, cachedAt: cached.at };
  }
  let data;
  if (pl.type === 'xtream') {
    data = await new Xtream(pl).catalog();
  } else {
    const text = pl.type === 'file' ? await idb.get('file:' + pl.id) : await getText(pl.url, 90000);
    if (!text) throw new Error('The playlist file is missing. Add it again.');
    if (!/#EXTINF|#EXTM3U/.test(text)) throw new Error('That link didn’t return an M3U playlist.');
    data = catalogFromM3U(text);
  }
  const total = data.live.items.length + data.movie.items.length + data.series.items.length;
  if (!total) throw new Error('This playlist has no channels or videos.');
  await idb.set(key, { at: Date.now(), data });
  return { ...data, cachedAt: Date.now() };
}

export const dropCatalog = id => Promise.all([idb.del('cat:' + id), idb.del('file:' + id)]);

/** Load TV guides into one Guide. Reports progress through onStatus. */
export async function loadGuide(urls, onStatus) {
  const g = new Guide();
  const failed = [];
  for (const [i, u] of urls.entries()) {
    onStatus && onStatus(`Loading TV guide ${urls.length > 1 ? (i + 1) + ' of ' + urls.length : ''}…`);
    try { g.add(await getMaybeGzip(u)); } catch (e) { failed.push(e.message || 'failed'); }
  }
  return { guide: g, failed };
}
