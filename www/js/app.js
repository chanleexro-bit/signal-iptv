import { $, $$, esc, uid, debounce, hm, dayLabel, dur, minutesLabel, pct, initials, setClock, isTV } from './util.js';
import { ls, idb, settings as loadSettings, saveSettings } from './store.js';
import { setUserAgent, isNative } from './net.js';
import { loadCatalog, loadGuide, dropCatalog, clientFor } from './sources.js';
import { Xtream, normalizeServer, parseXtreamLink } from './xtream.js';
import { nowNext } from './xmltv.js';
import { PRESETS, COUNTRY_GUIDES } from './presets.js';
import { FULL_PRESETS } from './presets-full.js';
import { EDITION, VERSION } from './config.js';
import { play, hasNativePlayer, initWebPlayer, webPlayerOpen, closeWebPlayer } from './player.js';
import { initNav, focusFirst, focusEl } from './nav.js';

const Cap = window.Capacitor;
const ADULT = /\b(adult|xxx|18\+|porn)/i;
const CHUNK = 120;

// ---------- icons ----------
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  live: I('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4"/>'),
  movies: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),
  series: I('<rect x="2" y="7" width="15" height="13" rx="2"/><path d="M6 4h13a2 2 0 0 1 2 2v10"/>'),
  favorites: I('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  playlists: I('<path d="M4 6h12M4 12h12M4 18h7"/><circle cx="18" cy="17" r="3"/><path d="M21 17V5"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
  key: I('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>'),
  link: I('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  file: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')
};

// ---------- state ----------
const S = {
  playlists: ls.get('playlists', []),
  activeId: ls.get('active', null),
  set: loadSettings(),
  favs: ls.get('favs', {}),
  recent: ls.get('recent', {}),
  progress: ls.get('progress', {}),
  cat: null, byId: {}, catNames: {}, libCache: {}, loading: false, error: null, account: null,
  guide: null, guideMsg: '', guideSeq: 0, gcache: new Map(),
  view: 'live', params: {}, stack: [], focusKey: null, lastBack: 0,
  ui: { liveCat: '__all', movieCat: '__all', seriesCat: '__all', liveFilter: '', libFilter: { movie: '', series: '' }, sort: { movie: 'default', series: 'default' }, favTab: 'live', selLive: null, season: {}, q: '' },
  sched: new Map(), info: new Map(), pager: null, after: []
};
const pl = () => S.playlists.find(p => p.id === S.activeId) || null;
const savePlaylists = () => ls.set('playlists', S.playlists);

// ---------- favorites, recents, progress ----------
function favs(kind) {
  const f = S.favs[S.activeId] = S.favs[S.activeId] || {};
  return f[kind] = f[kind] || [];
}
const isFav = (kind, id) => favs(kind).includes(id);
function toggleFav(kind, id) {
  const f = favs(kind), i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1); else f.unshift(id);
  ls.set('favs', S.favs);
  toast(i >= 0 ? 'Removed from favorites' : 'Added to favorites');
}
function addRecent(id) {
  const r = S.recent[S.activeId] = S.recent[S.activeId] || [];
  const i = r.indexOf(id); if (i >= 0) r.splice(i, 1);
  r.unshift(id); r.length = Math.min(r.length, 40);
  ls.set('recent', S.recent);
}
const pkey = (kind, id) => `${S.activeId}|${kind}|${id}`;
const getProg = (kind, id) => S.progress[pkey(kind, id)];
function setProg(kind, id, data) {
  S.progress[pkey(kind, id)] = { ...data, kind, id, at: Date.now() };
  const keys = Object.keys(S.progress);
  if (keys.length > 400) keys.sort((a, b) => S.progress[a].at - S.progress[b].at).slice(0, keys.length - 400).forEach(k => delete S.progress[k]);
  ls.set('progress', S.progress);
}
const watched = p => p && p.dur > 0 && p.pos >= p.dur * 0.94;
const inProgress = p => p && p.dur > 0 && p.pos > 20000 && p.pos < p.dur * 0.94;
function saveResult(kind, id, res, meta) {
  if (!res) return;
  const d = res.duration || 0;
  const pos = res.ended ? d : (res.position || 0);
  if (d > 0 && pos > 5000) setProg(kind, id, { pos, dur: d, ...meta });
}

// ---------- catalog ----------
function indexCatalog() {
  S.byId = {}; S.catNames = {}; S.libCache = {}; S.gcache = new Map();
  for (const k of ['live', 'movie', 'series']) {
    S.byId[k] = new Map(S.cat[k].items.map(i => [i.id, i]));
    S.catNames[k] = new Map(S.cat[k].cats.map(c => [c.id, c.name]));
  }
}
function lib(kind) {
  if (!S.cat) return { cats: [], items: [], counts: new Map() };
  const key = kind + (S.set.hideAdult ? ':safe' : '');
  if (S.libCache[key]) return S.libCache[key];
  const c = S.cat[kind];
  let cats = c.cats, items = c.items;
  if (S.set.hideAdult) {
    const bad = new Set(c.cats.filter(x => ADULT.test(x.name)).map(x => x.id));
    cats = cats.filter(x => !bad.has(x.id)); items = items.filter(i => !i.adult && !bad.has(i.cat));
  }
  const counts = new Map();
  for (const i of items) counts.set(i.cat, (counts.get(i.cat) || 0) + 1);
  return S.libCache[key] = { cats: cats.filter(x => counts.get(x.id)), items, counts };
}
const catName = (kind, id) => (S.catNames[kind] && S.catNames[kind].get(id)) || '';

async function ensureCatalog(force = false) {
  const p = pl();
  if (!p || S.loading) return;
  S.loading = true; S.error = null; S.cat = null;
  render();
  try {
    let accountP = null;
    if (p.type === 'xtream') {
      accountP = new Xtream(p).auth();
      accountP.catch(() => {});
      const cached = await idb.get('cat:' + p.id);
      if (force || !cached) p.account = { ...(await accountP), checked: Date.now() };
    }
    const cat = await loadCatalog(p, { force });
    if (p.id !== S.activeId) return;
    S.cat = cat; indexCatalog();
    if (accountP) accountP.then(a => { p.account = { ...a, checked: Date.now() }; savePlaylists(); renderTop(); }).catch(() => {});
    savePlaylists();
  } catch (e) {
    S.error = e.message || String(e);
  } finally {
    S.loading = false;
  }
  render();
  if (S.cat) startGuide();
}

async function startGuide() {
  const p = pl(); if (!p || !S.cat) return;
  const seq = ++S.guideSeq;
  S.guide = null; S.gcache = new Map();
  let urls = [];
  if (p.epg && p.epg.length) urls = p.epg;
  else if (p.type === 'xtream') urls = S.set.fullGuide ? [new Xtream(p).xmltvUrl()] : [];
  else { const u = (S.cat.epgUrls || []).filter(x => !/ALL_SOURCES/i.test(x)); urls = u.length <= 3 ? u : []; }
  if (!urls.length) { S.guideMsg = ''; renderTop(); return; }
  S.guideMsg = 'Loading TV guide…'; renderTop();
  const { guide, failed } = await loadGuide(urls, () => {});
  if (seq !== S.guideSeq) return;
  S.guide = guide.size ? guide : null;
  S.guideMsg = guide.size ? '' : (failed.length ? 'TV guide unavailable' : '');
  renderTop();
  refreshLive();
}

/** Programmes for a channel: full guide when loaded, else the provider's per-channel schedule. */
function schedFor(ch) {
  if (S.guide) {
    if (!S.gcache.has(ch.id)) S.gcache.set(ch.id, S.guide.find(ch));
    const g = S.gcache.get(ch.id);
    if (g) return g;
  }
  const c = S.sched.get(S.activeId + ':' + ch.id);
  return c ? c.list : null;
}
async function fetchSched(ch) {
  const p = pl(); if (!p || p.type !== 'xtream') return null;
  const key = S.activeId + ':' + ch.id, c = S.sched.get(key);
  if (c && Date.now() - c.at < 10 * 60e3) return c.list;
  try { const list = await new Xtream(p).schedule(ch.streamId); S.sched.set(key, { at: Date.now(), list }); return list; }
  catch { S.sched.set(key, { at: Date.now(), list: [] }); return []; }
}

// ---------- navigation ----------
const SECTIONS = [['live', 'Live TV'], ['movies', 'Movies'], ['series', 'Series'], ['favorites', 'Favorites'], ['search', 'Search'], null, ['playlists', 'Playlists'], ['settings', 'Settings']];
const TABS = [['live', 'Live TV'], ['movies', 'Movies'], ['series', 'Series'], ['favorites', 'Favorites'], ['menu', 'More']];
const sectionOf = v => ({ movie: 'movies', show: 'series', 'playlist-edit': 'playlists', onboarding: 'playlists' })[v] || v;

function buildNav() {
  const btn = ([k, label]) => `<button class="nav-btn" data-go="${k}" data-key="nav:${k}" title="${label}" aria-label="${label}">${ICON[k]}<span>${label}</span></button>`;
  $('#rail').innerHTML = `<div class="brand"><span class="dot"></span><span class="brand-text">Signal IPTV</span></div>` +
    SECTIONS.map(s => s ? btn(s) : '<div class="nav-sep"></div>').join('') +
    `<div class="ver">v${VERSION}${EDITION === 'play' ? '' : ' · GitHub'}</div>`;
  $('#tabs').innerHTML = TABS.map(btn).join('');
}
function markNav() {
  const sec = sectionOf(S.view);
  const tabSec = ['search', 'playlists', 'settings'].includes(sec) ? 'menu' : sec;
  $$('#rail .nav-btn').forEach(b => { if (b.dataset.go === sec) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('#tabs .nav-btn').forEach(b => { if (b.dataset.go === tabSec) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

function go(view, params = {}, { push = true, section = false } = {}) {
  if (section) S.stack = [];
  else if (push) S.stack.push({ view: S.view, params: S.params, key: activeKey(), scroll: scrollState() });
  S.view = view; S.params = params; S.focusKey = null; S.scroll = null;
  render();
  $('#view').scrollTop = 0;
}
function back() {
  if (webPlayerOpen()) { closeWebPlayer(); return; }
  if (!$('#sheet').hidden) { closeSheet(); return; }
  const prev = S.stack.pop();
  if (prev) { S.view = prev.view; S.params = prev.params; S.focusKey = prev.key; S.scroll = prev.scroll; render(); return; }
  if (S.view !== 'live' && S.playlists.length && S.view !== 'onboarding') { go('live', {}, { section: true }); focusEl($('#rail [data-go="live"]')); return; }
  if (isNative && Cap.Plugins && Cap.Plugins.App) {
    if (Date.now() - S.lastBack < 2200) Cap.Plugins.App.exitApp();
    else { S.lastBack = Date.now(); toast('Press back again to exit'); }
  }
}
function activeKey() {
  const a = document.activeElement;
  if (!a || !$('#view').contains(a)) return null;
  const k = a.closest('[data-key]');
  return k ? k.dataset.key : (a.id ? '#' + a.id : null);
}
function scrollState() {
  return { view: $('#view').scrollTop, panes: $$('#view .pane-body, #view .cats').map(el => el.scrollTop) };
}

// ---------- rendering ----------
function render() {
  markNav();
  renderTop();
  const keep = S.focusKey || activeKey();
  const needsCatalog = ['live', 'movies', 'series', 'favorites', 'search', 'movie', 'show'].includes(S.view);
  if (!S.playlists.length && !['playlist-edit', 'settings', 'menu'].includes(S.view)) S.view = 'onboarding';
  let html;
  S.after = []; S.pager = null;
  if (needsCatalog && pl() && !S.cat) {
    if (S.error) html = errorState();
    else { html = `<div class="center-state"><div><div class="spinner"></div><b>Loading ${esc(pl().name)}</b>Getting channels${pl().type === 'xtream' ? ', movies and series' : ''}…</div></div>`; if (!S.loading) setTimeout(() => ensureCatalog(), 0); }
  } else {
    html = (VIEWS[S.view] || VIEWS.live)(S.params);
  }
  const v = $('#view');
  v.innerHTML = html;
  S.after.forEach(fn => fn());
  if (S.scroll) { v.scrollTop = S.scroll.view; $$('#view .pane-body, #view .cats').forEach((el, i) => { if (S.scroll.panes[i] != null) el.scrollTop = S.scroll.panes[i]; }); S.scroll = null; }
  let el = null;
  if (keep) el = keep[0] === '#' ? $('#view ' + keep) : $(`#view [data-key="${CSS.escape(keep)}"]`);
  if (el) focusEl(el);
  else if (document.documentElement.classList.contains('tv') && (!document.activeElement || document.activeElement === document.body)) focusFirst(v);
  S.focusKey = null;
}
function errorState() {
  const p = pl();
  return `<div class="center-state"><div><b>Couldn’t load ${esc(p.name)}</b><p>${esc(S.error)}</p>
    <div class="row" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn primary" data-act="retry" data-autofocus>Try again</button>
      <button class="btn" data-act="edit-pl" data-id="${p.id}">Edit playlist</button>
      ${S.playlists.length > 1 ? '<button class="btn" data-go="playlists">Switch playlist</button>' : ''}
    </div></div></div>`;
}
function accountChip(acc) {
  if (!acc) return '';
  if (acc.status && !/active/i.test(acc.status)) return `<span class="chip bad">${esc(acc.status)}</span>`;
  if (!acc.expires) return `<span class="chip ok">Active</span>`;
  const days = Math.floor((acc.expires - Date.now()) / 864e5);
  if (days < 0) return `<span class="chip bad">Expired</span>`;
  if (days <= 7) return `<span class="chip warn">Expires in ${days} day${days === 1 ? '' : 's'}</span>`;
  return `<span class="chip ok">Until ${new Date(acc.expires).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</span>`;
}
function renderTop() {
  const p = pl();
  const a = document.activeElement;
  if (a && $('#top').contains(a)) return; // don't pull focus out from under the viewer
  $('#top').innerHTML = `<div class="brand brand-sm"><span class="dot"></span>Signal</div>
    ${p ? `<div class="pl-switch">${S.playlists.length > 1
      ? `<select id="plSel" aria-label="Playlist">${S.playlists.map(x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
      : `<span class="pl-name">${esc(p.name)}</span>`}</div>
      ${p.type === 'xtream' ? accountChip(p.account) : ''}
      ${S.guideMsg ? `<span class="chip${/unavailable/.test(S.guideMsg) ? ' warn' : ''}">${esc(S.guideMsg)}</span>` : ''}` : ''}
    <span class="grow"></span>
    ${p ? `<button class="icon-btn" data-act="refresh" title="Reload playlist" aria-label="Reload playlist">${ICON.refresh}</button>` : ''}`;
}

// ---------- shared pieces ----------
function logoHtml(src, name) {
  const ini = esc(initials(name));
  return src ? `<img loading="lazy" src="${esc(src)}" alt="" data-ini="${ini}" onerror="this.parentNode.textContent=this.dataset.ini">` : ini;
}
function posterHtml(kind, it, prog) {
  const r = it.rating ? `<span class="rate">★ ${(+it.rating).toFixed(1)}</span>` : '';
  const fav = isFav(kind, it.id) ? '<span class="fav">★</span>' : '';
  const bar = prog ? `<span class="bar"><span style="width:${pct(prog.pos, prog.dur).toFixed(1)}%"></span></span>` : '';
  return `<div class="poster"><div class="ph">${esc(it.name)}</div>${it.poster ? `<img loading="lazy" src="${esc(it.poster)}" alt="" onerror="this.remove()">` : ''}${r}${fav}${bar}</div>`;
}
function cardHtml(kind, it) {
  const prog = kind === 'movie' ? getProg('movie', it.id) : null;
  return `<button class="card" data-act="open-${kind}" data-id="${esc(it.id)}" data-key="${kind}:${esc(it.id)}">
    ${posterHtml(kind, it, inProgress(prog) ? prog : null)}
    <div class="card-t">${esc(it.name)}</div><div class="card-s">${esc(it.year || '')}</div></button>`;
}
function catsColumn(kind, current, extra) {
  const L = lib(kind);
  const btn = (id, name, n) => `<button class="cat" data-act="cat" data-kind="${kind}" data-cat="${esc(id)}" aria-pressed="${current === id}" data-key="cat:${kind}:${esc(id)}"><span>${esc(name)}</span><span class="n">${n ?? ''}</span></button>`;
  return extra.map(([id, name, n]) => btn(id, name, n)).join('') + L.cats.map(c => btn(c.id, c.name, L.counts.get(c.id))).join('');
}
function catSelect(kind, current, extra) {
  const L = lib(kind);
  return `<select class="cat-sel" data-change="cat" data-kind="${kind}" aria-label="Category">
    ${extra.map(([id, name, n]) => `<option value="${esc(id)}"${current === id ? ' selected' : ''}>${esc(name)}${n != null ? ` (${n})` : ''}</option>`).join('')}
    ${L.cats.map(c => `<option value="${esc(c.id)}"${current === c.id ? ' selected' : ''}>${esc(c.name)} (${L.counts.get(c.id)})</option>`).join('')}</select>`;
}
/** Render long lists in chunks; more items are added as the viewer scrolls near the end. */
function pager(sel, items, itemHtml, wantKey) {
  let shown = CHUNK;
  if (wantKey) { const i = items.findIndex(x => wantKey.endsWith(':' + x.id)); if (i >= 0) shown = Math.max(shown, i + CHUNK); }
  S.pager = { sel, items, itemHtml, shown };
  S.after.push(() => {
    const host = $(sel); if (!host) return;
    const sentinel = host.parentNode.querySelector('.sentinel'); if (!sentinel) return;
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting) || !S.pager || S.pager.sel !== sel) return;
      const pg = S.pager; if (pg.shown >= pg.items.length) return;
      host.insertAdjacentHTML('beforeend', pg.items.slice(pg.shown, pg.shown + CHUNK).map(pg.itemHtml).join(''));
      pg.shown += CHUNK;
    }, { rootMargin: '600px' });
    io.observe(sentinel);
  });
  return items.slice(0, shown).map(itemHtml).join('');
}

// ---------- Live TV ----------
function liveItems(ctx) {
  if (ctx === 'fav') return favs('live').map(id => S.byId.live.get(id)).filter(Boolean);
  if (ctx === 'search') return S.searchLive || [];
  const L = lib('live'), c = S.ui.liveCat;
  let items;
  if (c === '__fav') items = favs('live').map(id => S.byId.live.get(id)).filter(Boolean);
  else if (c === '__recent') items = (S.recent[S.activeId] || []).map(id => S.byId.live.get(id)).filter(Boolean);
  else if (c === '__all') items = L.items;
  else items = L.items.filter(i => i.cat === c);
  const f = S.ui.liveFilter.trim().toLowerCase();
  return f ? items.filter(i => i.name.toLowerCase().includes(f)) : items;
}
function chRow(ch, ctx = 'live') {
  const nn = nowNext(schedFor(ch), 0);
  const now = nn && nn.now;
  const sub = now
    ? `<div class="ch-now">${esc(now.t)}</div><div class="bar"><span style="width:${pct(Date.now() - now.s, now.e - now.s).toFixed(1)}%"></span></div>`
    : `<div class="ch-now">${esc(catName('live', ch.cat))}</div>`;
  return `<li class="ch${S.ui.selLive === ch.id ? ' sel' : ''}" tabindex="0" role="button" data-act="play-live" data-ctx="${ctx}" data-id="${esc(ch.id)}" data-key="live:${esc(ch.id)}">
    <span class="ch-num">${ch.num || ''}</span><span class="logo">${logoHtml(ch.logo, ch.name)}</span>
    <span style="min-width:0"><div class="ch-name">${esc(ch.name)}</div>${sub}</span>
    <span class="ch-side">${ch.archive ? '<span class="tag">Catch-up</span>' : ''}${isFav('live', ch.id) ? '<span class="star" aria-label="Favorite">★</span>' : ''}<button class="ch-more" data-act="ch-info" data-id="${esc(ch.id)}" aria-label="Schedule and options" tabindex="-1">ⓘ</button></span>
  </li>`;
}
function viewLive() {
  const L = lib('live');
  if (!L.items.length) return `<div class="center-state"><div><b>No live channels</b>This playlist only has ${S.cat.movie.items.length ? 'movies' : ''}${S.cat.movie.items.length && S.cat.series.items.length ? ' and ' : ''}${S.cat.series.items.length ? 'series' : ''}.</div></div>`;
  const extra = [['__fav', '★ Favorites', favs('live').length], ['__recent', 'Recently watched', (S.recent[S.activeId] || []).length], ['__all', 'All channels', L.items.length]];
  const items = liveItems();
  if (items.length && !items.some(i => i.id === S.ui.selLive)) S.ui.selLive = items[0].id;
  const sel = S.byId.live.get(S.ui.selLive) || items[0];
  S.after.push(() => {
    if (document.documentElement.classList.contains('tv') && (!document.activeElement || document.activeElement === document.body)) focusEl($('#chlist .ch.sel') || $('#chlist .ch'));
  });
  const curName = (extra.find(e => e[0] === S.ui.liveCat) || [0, catName('live', S.ui.liveCat)])[1];
  if (sel) S.after.push(() => updateInfo(sel));
  const empty = S.ui.liveCat === '__fav' ? 'No favorite channels yet. Open a channel’s details and choose Favorite.' : S.ui.liveCat === '__recent' ? 'Channels you watch will show up here.' : 'No channels match.';
  return `<div class="live">
    <aside class="cats" aria-label="Channel groups">${catsColumn('live', S.ui.liveCat, extra)}</aside>
    <section class="pane">
      <div class="pane-head"><h1 class="h2">${esc(curName)}</h1>${catSelect('live', S.ui.liveCat, extra)}
        <input type="search" id="liveFilter" data-input="liveFilter" value="${esc(S.ui.liveFilter)}" placeholder="Filter channels" aria-label="Filter channels">
        <span class="count">${items.length.toLocaleString()} channels</span></div>
      <div class="pane-body">${items.length ? `<ul class="chlist" id="chlist">${pager('#chlist', items, c => chRow(c), S.focusKey)}</ul><div class="sentinel"></div>` : `<div class="empty">${empty}</div>`}</div>
    </section>
    <aside class="info" id="liveInfo" aria-label="Channel details"></aside>
  </div>`;
}
function infoHtml(ch, loading) {
  const list = schedFor(ch);
  const nn = nowNext(list, 6);
  const fav = isFav('live', ch.id);
  let body;
  if (nn && nn.now) {
    body = `<div class="prog-now"><p class="eyebrow">On now</p><p class="prog-title">${esc(nn.now.t)}</p>
      <div class="prog-time">${hm(nn.now.s)} – ${hm(nn.now.e)} · ${Math.max(0, Math.round((nn.now.e - Date.now()) / 60000))} min left</div>
      <div class="bar"><span style="width:${pct(Date.now() - nn.now.s, nn.now.e - nn.now.s).toFixed(1)}%"></span></div>
      ${nn.now.d ? `<p class="prog-desc">${esc(nn.now.d)}</p>` : ''}</div>`;
  } else if (loading) body = '<p class="hint">Loading schedule…</p>';
  else body = `<p class="hint">${S.guide || pl().type === 'xtream' ? 'No schedule for this channel.' : 'No TV guide loaded. Add one under Playlists → Edit → TV guide.'}</p>`;
  const next = nn && nn.next.length ? `<p class="eyebrow">Up next</p><ul class="sched">${nn.next.map(p => `<li><time>${hm(p.s)}</time><span>${esc(p.t)}</span><span></span></li>`).join('')}</ul>` : '';
  const replay = ch.archive && list ? list.filter(p => p.e < Date.now() && (p.archive || ch.catchupSource) && p.s > Date.now() - (ch.archiveDays || 3) * 864e5).slice(-14).reverse() : [];
  const catchup = replay.length ? `<p class="eyebrow">Catch up</p><div class="sched">${replay.map(p => `<button data-act="catchup" data-id="${esc(ch.id)}" data-s="${p.s}" data-e="${p.e}" data-start="${esc(p.start || '')}" data-t="${esc(p.t)}" data-key="cu:${p.s}"><time>${dayLabel(p.s) === 'Today' ? hm(p.s) : dayLabel(p.s).slice(0, 3) + ' ' + hm(p.s)}</time><span>${esc(p.t)}</span><span class="replay">▶ Replay</span></button>`).join('')}</div>` : '';
  return `<div class="info-head"><span class="logo">${logoHtml(ch.logo, ch.name)}</span><div style="min-width:0"><p class="eyebrow">${ch.num ? 'CH ' + ch.num + ' · ' : ''}${esc(catName('live', ch.cat))}</p><h2 class="h2" id="sheetTitle">${esc(ch.name)}</h2></div></div>
    <div class="info-actions"><button class="btn primary" data-act="play-live" data-id="${esc(ch.id)}" data-key="info:play">▶ Watch</button>
      <button class="btn" data-act="fav" data-kind="live" data-id="${esc(ch.id)}" data-key="info:fav">${fav ? '★ Favorite' : '☆ Favorite'}</button></div>
    ${body}${next}${catchup}`;
}
let infoSeq = 0;
async function updateInfo(ch, target = $('#liveInfo')) {
  if (!target) return;
  const seq = ++infoSeq;
  const needFetch = pl().type === 'xtream' && !(S.guide && S.guide.find(ch) && !ch.archive);
  const key = S.activeId + ':' + ch.id;
  const have = S.sched.has(key) && Date.now() - S.sched.get(key).at < 10 * 60e3;
  if (target.contains(document.activeElement) && target.id === 'liveInfo') return;
  target.innerHTML = infoHtml(ch, needFetch && !have);
  if (needFetch && !have) {
    await fetchSched(ch);
    if (seq !== infoSeq || !target.isConnected) return;
    const keep = target.contains(document.activeElement) ? activeKey() : null;
    target.innerHTML = infoHtml(ch, false);
    if (keep) { const el = target.querySelector(`[data-key="${CSS.escape(keep)}"]`); if (el) focusEl(el); }
  }
}
const selectChannel = debounce(id => {
  const ch = S.byId.live && S.byId.live.get(id); if (!ch) return;
  S.ui.selLive = id;
  $$('#view .ch.sel').forEach(r => r.classList.remove('sel'));
  const row = $(`#view .ch[data-key="live:${CSS.escape(id)}"]`); if (row) row.classList.add('sel');
  updateInfo(ch);
}, 180);
function refreshLive() {
  if (S.view === 'live' || S.view === 'favorites' || S.view === 'search') {
    $$('#view .ch[data-id]').forEach(row => {
      const ch = S.byId.live && S.byId.live.get(row.dataset.id); if (!ch) return;
      const nn = nowNext(schedFor(ch), 0); const side = row.children[2]; if (!side) return;
      side.innerHTML = `<div class="ch-name">${esc(ch.name)}</div>` + (nn && nn.now
        ? `<div class="ch-now">${esc(nn.now.t)}</div><div class="bar"><span style="width:${pct(Date.now() - nn.now.s, nn.now.e - nn.now.s).toFixed(1)}%"></span></div>`
        : `<div class="ch-now">${esc(catName('live', ch.cat))}</div>`);
    });
    const info = $('#liveInfo'); const sel = S.byId.live && S.byId.live.get(S.ui.selLive);
    if (info && sel && !info.contains(document.activeElement)) info.innerHTML = infoHtml(sel, false);
  }
}
async function playLive(ch, ctx) {
  const p = pl(), x = clientFor(p);
  let list = liveItems(ctx);
  if (!list.includes(ch)) list = [ch];
  let idx = list.indexOf(ch);
  if (list.length > 1500) { const from = Math.max(0, idx - 750); list = list.slice(from, from + 1500); idx = list.indexOf(ch); }
  const items = list.map(c => {
    const nn = nowNext(schedFor(c), 0);
    return { url: x ? x.liveUrl(c.streamId, S.set.liveFormat) : c.url, title: `${c.num ? c.num + '   ' : ''}${c.name}`, subtitle: nn && nn.now ? nn.now.t : catName('live', c.cat), headers: c.headers };
  });
  addRecent(ch.id);
  const res = await play({ items, index: idx, live: true, settings: S.set });
  const last = list[res && res.index] || ch;
  addRecent(last.id);
  S.ui.selLive = last.id;
  S.focusKey = 'live:' + last.id;
  if (res && res.error) toast('Stream problem: ' + res.error.replace(/^ERROR_CODE_/, '').toLowerCase().replace(/_/g, ' '));
  render();
}
function catchupUrl(ch, p) {
  const x = clientFor(pl());
  if (x) return x.timeshiftUrl(ch.streamId, p.start || new Date(p.s).toISOString().replace('T', ' '), (p.e - p.s) / 60000);
  const s = Math.floor(p.s / 1000), e = Math.floor(p.e / 1000), now = Math.floor(Date.now() / 1000), dt = new Date(p.s), z = n => String(n).padStart(2, '0');
  const map = { '{utc}': s, '${start}': s, '{start}': s, '{utcend}': e, '${end}': e, '{end}': e, '{duration}': e - s, '${duration}': e - s, '{lutc}': now, '${timestamp}': now, '{offset}': now - s,
    '{Y}': dt.getUTCFullYear(), '{m}': z(dt.getUTCMonth() + 1), '{d}': z(dt.getUTCDate()), '{H}': z(dt.getUTCHours()), '{M}': z(dt.getUTCMinutes()), '{S}': z(dt.getUTCSeconds()) };
  let src = ch.catchupSource || '';
  for (const k in map) src = src.split(k).join(String(map[k]));
  return /^https?:/i.test(src) ? src : ch.url + src;
}

// ---------- Movies & Series ----------
function libItems(kind) {
  const L = lib(kind), key = kind === 'movie' ? 'movieCat' : 'seriesCat', c = S.ui[key];
  let items = c === '__fav' ? favs(kind).map(id => S.byId[kind].get(id)).filter(Boolean) : c === '__all' ? L.items : L.items.filter(i => i.cat === c);
  const f = S.ui.libFilter[kind].trim().toLowerCase();
  if (f) items = items.filter(i => i.name.toLowerCase().includes(f));
  const sort = S.ui.sort[kind];
  if (sort === 'az') items = [...items].sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'added') items = [...items].sort((a, b) => (b.added || 0) - (a.added || 0));
  else if (sort === 'rating') items = [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === 'year') items = [...items].sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')));
  return items;
}
function continueShelf(kind) {
  const prefix = S.activeId + '|' + (kind === 'movie' ? 'movie' : 'ep') + '|';
  let list = Object.entries(S.progress).filter(([k, p]) => k.startsWith(prefix) && inProgress(p)).sort((a, b) => b[1].at - a[1].at);
  if (kind === 'series') { const seen = new Set(); list = list.filter(([, p]) => !seen.has(p.seriesId) && seen.add(p.seriesId)); }
  list = list.slice(0, 14);
  if (!list.length) return '';
  return `<div class="row-title"><h2 class="h2">Continue watching</h2></div><div class="shelf">${list.map(([k, p]) => `
    <button class="card" data-act="resume" data-pk="${esc(k)}" data-key="cw:${esc(k)}">
      ${posterHtml(kind, { id: p.seriesId || p.id, name: p.name, poster: p.poster }, p)}
      <div class="card-t">${esc(p.name)}</div><div class="card-s">${esc(p.epLabel ? p.epLabel + ' · ' : '')}${dur(p.dur - p.pos)} left</div></button>`).join('')}</div>`;
}
function viewLib(kind) {
  const L = lib(kind), label = kind === 'movie' ? 'Movies' : 'Series';
  if (!L.items.length) return `<div class="center-state"><div><b>No ${label.toLowerCase()} in this playlist</b>${pl().type === 'xtream' ? 'Your provider doesn’t offer any, or your plan doesn’t include them.' : 'M3U playlists usually only contain live channels. Xtream Codes logins include movies and series when the provider offers them.'}</div></div>`;
  const key = kind === 'movie' ? 'movieCat' : 'seriesCat', c = S.ui[key];
  const extra = [['__all', 'All ' + label.toLowerCase(), L.items.length], ['__fav', '★ Favorites', favs(kind).length]];
  const items = libItems(kind);
  const title = (extra.find(e => e[0] === c) || [0, catName(kind, c)])[1];
  const sorts = [['default', 'Provider order'], ['added', 'Recently added'], ['az', 'A–Z'], ['rating', 'Top rated'], ['year', 'Newest release']];
  return `<div class="cols">
    <aside class="cats" aria-label="${label} categories">${catsColumn(kind, c, extra)}</aside>
    <section class="pane">
      <div class="pane-head"><h1 class="h2">${esc(title)}</h1>${catSelect(kind, c, extra)}
        <select data-change="sort" data-kind="${kind}" aria-label="Sort">${sorts.map(([v, n]) => `<option value="${v}"${S.ui.sort[kind] === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <input type="search" id="libFilter-${kind}" data-input="libFilter" data-kind="${kind}" value="${esc(S.ui.libFilter[kind])}" placeholder="Filter ${label.toLowerCase()}" aria-label="Filter ${label.toLowerCase()}">
        <span class="count">${items.length.toLocaleString()} titles</span></div>
      <div class="pane-body">
        ${c === '__all' && !S.ui.libFilter[kind] ? continueShelf(kind) : ''}
        ${items.length ? `<div class="grid" id="grid-${kind}">${pager('#grid-' + kind, items, it => cardHtml(kind, it), S.focusKey)}</div><div class="sentinel"></div>` : `<div class="empty">${c === '__fav' ? 'No favorites yet.' : 'Nothing matches.'}</div>`}
      </div>
    </section></div>`;
}

function detailShell(it, info, kind, actions, extraBelow = '') {
  const meta = [it.year || (info && String(info.released || '').slice(0, 4)), info && info.minutes ? minutesLabel(info.minutes) : '', info && info.genre, catName(kind, it.cat)].filter(Boolean);
  const rating = (info && info.rating) || it.rating;
  const plot = (info && info.plot) || it.plot || '';
  const credits = info ? [['Director', info.director], ['Cast', info.cast], ['Released', info.released]].filter(([, v]) => v) : [];
  const backdrop = (info && (info.backdrop || info.poster)) || it.poster;
  return `<div class="detail">
    ${backdrop ? `<div class="backdrop"><img src="${esc(backdrop)}" alt="" onerror="this.remove()"></div>` : ''}
    <div class="detail-body">
      <div>${posterHtml(kind, { ...it, poster: (info && info.poster) || it.poster }, null)}</div>
      <div style="min-width:0">
        <button class="btn sm ghost back-btn" data-act="back" data-key="act:back">← Back</button>
        <p class="eyebrow">${kind === 'movie' ? 'Movie' : 'Series'}</p>
        <h1 class="h1">${esc(it.name)}</h1>
        <div class="detail-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}${rating ? `<span class="rating">★ ${(+rating).toFixed(1)}</span>` : ''}</div>
        <div class="detail-actions">${actions}</div>
        ${plot ? `<p class="plot">${esc(plot)}</p>` : (info === undefined ? '<p class="hint">Loading details…</p>' : '')}
        ${credits.length ? `<dl class="credits">${credits.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${extraBelow}
      </div>
    </div></div>`;
}
function viewMovie({ id }) {
  const it = S.byId.movie && S.byId.movie.get(id);
  if (!it) return '<div class="empty">This movie isn’t in the playlist any more.</div>';
  const x = clientFor(pl());
  const info = x ? S.info.get('m:' + S.activeId + ':' + id) : null;
  if (x && info === undefined) S.after.push(async () => {
    let i = null; try { i = await x.movieInfo(it.streamId); } catch {}
    S.info.set('m:' + S.activeId + ':' + id, i);
    if (S.view === 'movie' && S.params.id === id) render();
  });
  const pr = getProg('movie', id);
  const resume = inProgress(pr);
  const actions = `<button class="btn primary big" data-act="play-movie" data-id="${esc(id)}" data-key="act:play" data-autofocus>▶ ${resume ? 'Resume from ' + dur(pr.pos) : 'Play'}</button>
    ${resume ? `<button class="btn big" data-act="play-movie" data-id="${esc(id)}" data-from="0" data-key="act:start">Play from start</button>` : ''}
    <button class="btn big" data-act="fav" data-kind="movie" data-id="${esc(id)}" data-key="act:fav">${isFav('movie', id) ? '★ Favorite' : '☆ Favorite'}</button>`;
  return detailShell(it, info === undefined && !x ? null : info, 'movie', actions);
}
async function playMovie(it, fromStart) {
  const x = clientFor(pl());
  const info = S.info.get('m:' + S.activeId + ':' + it.id);
  const url = x ? x.movieUrl(it.streamId, (info && info.ext) || it.ext) : it.url;
  const pr = getProg('movie', it.id);
  const startMs = !fromStart && inProgress(pr) ? pr.pos : 0;
  const res = await play({ items: [{ url, title: it.name, subtitle: it.year || '', headers: it.headers }], index: 0, startMs, live: false, settings: S.set });
  saveResult('movie', it.id, res, { name: it.name, poster: it.poster, url, sub: it.year || '' });
  if (res && res.error) toast('Can’t play this movie: ' + res.error.replace(/^ERROR_CODE_/, '').toLowerCase().replace(/_/g, ' '));
  S.focusKey = 'act:play';
  render();
}

function seriesInfo(it) {
  const x = clientFor(pl());
  if (!x) return { episodes: it.episodes || {}, plot: it.plot };
  return S.info.get('s:' + S.activeId + ':' + it.id);
}
function orderedEps(info) {
  return Object.keys(info.episodes).sort((a, b) => +a - +b).flatMap(s => info.episodes[s]);
}
function nextEpisode(info) {
  const all = orderedEps(info);
  const progressed = all.filter(e => getProg('ep', e.id));
  if (!progressed.length) return all[0];
  const last = progressed.sort((a, b) => getProg('ep', b.id).at - getProg('ep', a.id).at)[0];
  if (!watched(getProg('ep', last.id))) return last;
  return all[all.indexOf(last) + 1] || all[0];
}
function viewSeries({ id }) {
  const it = S.byId.series && S.byId.series.get(id);
  if (!it) return '<div class="empty">This series isn’t in the playlist any more.</div>';
  const info = seriesInfo(it);
  const x = clientFor(pl());
  if (x && info === undefined) S.after.push(async () => {
    let i = null; try { i = await x.seriesInfo(it.seriesId); } catch (e) { i = { error: e.message, episodes: {} }; }
    S.info.set('s:' + S.activeId + ':' + id, i);
    if (S.view === 'show' && S.params.id === id) render();
  });
  let actions = `<button class="btn big" data-act="fav" data-kind="series" data-id="${esc(id)}" data-key="act:fav">${isFav('series', id) ? '★ Favorite' : '☆ Favorite'}</button>`;
  let below = '';
  if (info === undefined) below = '<p class="hint">Loading episodes…</p>';
  else if (info && info.error) below = `<p class="form-err">Couldn’t load episodes: ${esc(info.error)}</p>`;
  else if (info) {
    const seasons = Object.keys(info.episodes).filter(s => info.episodes[s].length).sort((a, b) => +a - +b);
    if (!seasons.length) below = '<p class="hint">No episodes yet.</p>';
    else {
      const nxt = nextEpisode(info);
      const np = nxt && getProg('ep', nxt.id);
      if (nxt) actions = `<button class="btn primary big" data-act="play-ep" data-id="${esc(id)}" data-ep="${esc(nxt.id)}" data-key="act:play" data-autofocus>▶ ${inProgress(np) ? 'Resume' : 'Play'} S${nxt.season} E${nxt.num}</button>` + actions;
      let season = S.ui.season[id];
      if (!seasons.includes(String(season))) season = String(nxt ? nxt.season : seasons[0]);
      const eps = info.episodes[season] || [];
      below = `<div class="seasons" role="group" aria-label="Seasons">${seasons.map(s => `<button class="btn sm${s === season ? ' primary' : ''}" data-act="season" data-id="${esc(id)}" data-season="${s}" data-key="season:${s}" aria-pressed="${s === season}">Season ${s}</button>`).join('')}</div>
        <ol class="eps">${eps.map(e => {
          const p = getProg('ep', e.id);
          const right = watched(p) ? '<span class="ep-r done">✓ Watched</span>' : inProgress(p) ? `<span class="ep-r">${dur(p.dur - p.pos)} left</span>` : `<span class="ep-r">${e.minutes ? minutesLabel(e.minutes) : ''}</span>`;
          return `<li><button class="ep" data-act="play-ep" data-id="${esc(id)}" data-ep="${esc(e.id)}" data-key="ep:${esc(e.id)}">
            <span class="ep-n">E${String(e.num).padStart(2, '0')}</span>
            <span style="min-width:0"><div class="ep-t">${esc(e.title)}</div>${e.plot ? `<div class="ep-p">${esc(e.plot)}</div>` : ''}${inProgress(p) ? `<div class="bar"><span style="width:${pct(p.pos, p.dur).toFixed(1)}%"></span></div>` : ''}</span>
            ${right}</button></li>`;
        }).join('')}</ol>`;
    }
  }
  return detailShell(it, info && !info.error ? info : (info === undefined ? undefined : null), 'series', actions, below);
}
async function playEpisode(it, epId) {
  const info = seriesInfo(it); if (!info) return;
  const x = clientFor(pl());
  const ep = orderedEps(info).find(e => e.id === epId); if (!ep) return;
  const eps = info.episodes[ep.season] || info.episodes[String(ep.season)];
  const start = eps.indexOf(ep);
  const list = eps.slice(start);
  const items = list.map(e => ({ url: x ? x.episodeUrl(e.id, e.ext) : e.url, title: it.name, subtitle: `S${e.season} E${e.num} · ${e.title}` }));
  const pr = getProg('ep', ep.id);
  const res = await play({ items, index: 0, startMs: inProgress(pr) ? pr.pos : 0, live: false, settings: S.set });
  if (res) {
    const endIdx = Math.min(res.index || 0, list.length - 1);
    for (let i = 0; i < endIdx; i++) setProg('ep', list[i].id, { pos: 1, dur: 1, name: it.name, poster: it.poster, seriesId: it.id, epLabel: `S${list[i].season} E${list[i].num}` });
    const cur = list[endIdx];
    saveResult('ep', cur.id, res, { name: it.name, poster: it.poster, seriesId: it.id, epLabel: `S${cur.season} E${cur.num}`, url: items[endIdx].url, sub: items[endIdx].subtitle });
    S.ui.season[it.id] = String(cur.season);
    S.focusKey = 'ep:' + cur.id;
    if (res.error) toast('Can’t play this episode: ' + res.error.replace(/^ERROR_CODE_/, '').toLowerCase().replace(/_/g, ' '));
  }
  render();
}
async function resume(pk) {
  const p = S.progress[pk]; if (!p || !p.url) return;
  const res = await play({ items: [{ url: p.url, title: p.name, subtitle: p.sub || p.epLabel || '' }], index: 0, startMs: p.pos, live: false, settings: S.set });
  saveResult(p.kind, p.id, res, { name: p.name, poster: p.poster, seriesId: p.seriesId, epLabel: p.epLabel, url: p.url, sub: p.sub });
  S.focusKey = 'cw:' + pk;
  render();
}

// ---------- Favorites, Search, Menu ----------
function viewFavs() {
  const t = S.ui.favTab;
  const tabs = [['live', 'Channels'], ['movie', 'Movies'], ['series', 'Series']];
  let body;
  if (t === 'live') {
    const items = favs('live').map(id => S.byId.live.get(id)).filter(Boolean);
    body = items.length ? `<ul class="chlist" style="max-width:900px">${items.map(c => chRow(c, 'fav')).join('')}</ul>` : '<div class="empty"><b>No favorite channels yet</b>Open a channel and choose ☆ Favorite.</div>';
  } else {
    const items = favs(t).map(id => S.byId[t].get(id)).filter(Boolean);
    body = items.length ? `<div class="grid" style="padding-left:0;padding-right:0">${items.map(it => cardHtml(t, it)).join('')}</div>` : `<div class="empty"><b>No favorite ${t === 'movie' ? 'movies' : 'series'} yet</b>Open one and choose ☆ Favorite.</div>`;
  }
  return `<div class="pad"><h1 class="h1" style="margin-bottom:16px">Favorites</h1>
    <div class="seg" role="group" aria-label="Favorite type">${tabs.map(([k, n]) => `<button data-act="fav-tab" data-tab="${k}" aria-pressed="${t === k}" data-key="ftab:${k}">${n} <span class="count">${favs(k).length}</span></button>`).join('')}</div>
    <div style="margin-top:16px">${body}</div></div>`;
}
function viewSearch() {
  S.after.push(() => { runSearch(); const q = $('#q'); if (q && !S.focusKey) q.focus(); });
  return `<div class="pad"><h1 class="h1" style="margin-bottom:16px">Search</h1>
    <div class="search-box"><input type="search" id="q" data-input="q" value="${esc(S.ui.q)}" placeholder="Channels, movies, series or shows on now" aria-label="Search" autocomplete="off"></div>
    <div id="searchRes"></div></div>`;
}
function runSearch() {
  const box = $('#searchRes'); if (!box) return;
  const q = S.ui.q.trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = '<p class="hint" style="margin-top:16px">Type at least two letters.</p>'; return; }
  const live = lib('live').items.filter(c => c.name.toLowerCase().includes(q) || ((nowNext(schedFor(c), 0) || {}).now || { t: '' }).t.toLowerCase().includes(q)).slice(0, 60);
  const movies = lib('movie').items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 60);
  const series = lib('series').items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 60);
  S.searchLive = live;
  const sec = (title, n, html) => n ? `<h2 class="h2 res-title">${title} <span class="count">${n}</span></h2>${html}` : '';
  box.innerHTML = (live.length + movies.length + series.length) ?
    sec('Channels', live.length, `<ul class="chlist" style="max-width:900px;padding:0">${live.map(c => chRow(c, 'search')).join('')}</ul>`) +
    sec('Movies', movies.length, `<div class="grid" style="padding:10px 0 0">${movies.map(i => cardHtml('movie', i)).join('')}</div>`) +
    sec('Series', series.length, `<div class="grid" style="padding:10px 0 0">${series.map(i => cardHtml('series', i)).join('')}</div>`)
    : `<div class="empty"><b>No results for “${esc(S.ui.q)}”</b>Try a shorter name.</div>`;
}
function viewMenu() {
  return `<div class="pad"><h1 class="h1" style="margin-bottom:16px">More</h1><div class="stack">
    ${[['search', 'Search', 'Channels, movies and series'], ['playlists', 'Playlists', 'Add, switch or edit your playlists'], ['settings', 'Settings', 'Player, TV guide, backup']].map(([k, n, d]) =>
      `<button class="method" data-go="${k}" data-key="menu:${k}">${ICON[k]}<b>${n}</b><span>${d}</span></button>`).join('')}</div></div>`;
}

// ---------- Playlists ----------
function plSub(p) {
  if (p.type === 'xtream') { try { return 'Xtream Codes · ' + new URL(p.server).host + ' · ' + p.username; } catch { return 'Xtream Codes'; } }
  if (p.type === 'file') return 'M3U file · ' + (p.fileName || 'from this device');
  try { return 'M3U link · ' + new URL(p.url).host; } catch { return 'M3U link'; }
}
function viewPlaylists() {
  return `<div class="pad"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px"><h1 class="h1" style="margin-right:auto">Playlists</h1>
    <button class="btn primary" data-go="playlist-edit" data-key="pl:add">+ Add playlist</button></div>
    <div class="stack">${S.playlists.map(p => {
      const a = p.account;
      const acc = p.type === 'xtream' && a ? `<div class="pl-acc">${accountChip(a)}${a.maxConnections ? `<span class="chip">${a.activeConnections}/${a.maxConnections} connections</span>` : ''}${a.trial ? '<span class="chip warn">Trial</span>' : ''}</div>` : '';
      return `<div class="pl-card${p.id === S.activeId ? ' active' : ''}">
        <div style="min-width:0"><div class="pl-title">${esc(p.name)}${p.id === S.activeId ? ' <span class="chip ok" style="vertical-align:middle">In use</span>' : ''}</div><div class="pl-sub">${esc(plSub(p))}</div>${acc}</div>
        <div class="pl-btns">
          ${p.id !== S.activeId ? `<button class="btn sm primary" data-act="use-pl" data-id="${p.id}" data-key="pl:use:${p.id}">Use</button>` : `<button class="btn sm" data-act="reload-pl" data-id="${p.id}" data-key="pl:reload:${p.id}">Reload</button>`}
          <button class="btn sm" data-act="edit-pl" data-id="${p.id}" data-key="pl:edit:${p.id}">Edit</button>
          <button class="btn sm danger" data-act="del-pl" data-id="${p.id}" data-key="pl:del:${p.id}">Delete</button>
        </div></div>`;
    }).join('') || '<div class="empty">No playlists yet.</div>'}</div>
    <p class="hint" style="margin-top:22px;max-width:70ch">Signal IPTV is a player. It doesn’t provide channels; use playlists and logins from your TV provider or free public lists.</p></div>`;
}
function methodCards() {
  return `<div class="methods">
    <button class="method" data-act="method" data-m="xtream" data-key="m:xtream" data-autofocus>${ICON.key}<b>Xtream Codes login</b><span>Server address, username and password from your provider. Includes movies, series and catch-up.</span></button>
    <button class="method" data-act="method" data-m="m3u" data-key="m:m3u">${ICON.link}<b>M3U playlist link</b><span>A link ending in .m3u or .m3u8, or a get.php link.</span></button>
    <button class="method" data-act="method" data-m="file" data-key="m:file">${ICON.file}<b>M3U file</b><span>A playlist file saved on this device.</span></button>
    <button class="method" data-act="method" data-m="free" data-key="m:free">${ICON.globe}<b>Free public channels</b><span>Lists of freely available broadcasts, sorted by topic, country or language.</span></button>
  </div>`;
}
function viewOnboarding() {
  return `<div class="pad" style="max-width:980px"><p class="eyebrow">Welcome to Signal IPTV</p>
    <h1 class="h1" style="margin-bottom:10px">Add a playlist to start watching</h1>
    <p class="hint" style="margin:0 0 22px;max-width:62ch">Signal plays live TV, movies and series from the playlist or login your provider gave you. Pick how you want to add it.</p>
    ${methodCards()}</div>`;
}
function viewEditor({ id, m }) {
  const p = id ? S.playlists.find(x => x.id === id) : null;
  const method = m || (p ? p.type : null);
  const head = (t) => `<button class="btn sm ghost back-btn" data-act="back" data-key="act:back">← Back</button><h1 class="h1" style="margin-bottom:18px">${t}</h1>`;
  if (!method) return `<div class="pad" style="max-width:980px">${head('Add a playlist')}${methodCards()}</div>`;
  if (method === 'free') {
    const groups = [...PRESETS, ...(EDITION === 'play' ? [] : FULL_PRESETS)];
    return `<div class="pad">${head('Free public channels')}
      <p class="hint" style="max-width:66ch;margin:-6px 0 18px">These lists link to channels that broadcasters stream for free. Some streams may be offline or unavailable in your country.</p>
      <div class="presets">${groups.map(g => `<div><p class="eyebrow">${esc(g.group)}</p><div class="chips">${g.items.map(([n, u]) => `<button class="btn" data-act="add-preset" data-name="${esc(n)}" data-url="${esc(u)}" data-key="pre:${esc(n)}">${esc(n)}</button>`).join('')}</div></div>`).join('')}</div></div>`;
  }
  const v = (k, d = '') => esc(p ? (p[k] ?? d) : d);
  const epg = p && p.epg ? p.epg.join('\n') : '';
  const fields = method === 'xtream' ? `
      <label class="field">Server address<input type="text" inputmode="url" id="f-server" value="${v('server')}" placeholder="http://example.com:8080" autocomplete="off" spellcheck="false" data-autofocus></label>
      <label class="field">Username<input type="text" id="f-user" value="${v('username')}" autocomplete="off" spellcheck="false" autocapitalize="off"></label>
      <label class="field">Password<input type="password" id="f-pass" value="${v('password')}" autocomplete="off"></label>
      <div class="row"><button class="btn sm ghost" type="button" data-act="show-pass">Show password</button></div>`
    : method === 'm3u' ? `<label class="field">Playlist link<input type="text" inputmode="url" id="f-url" value="${v('url')}" placeholder="https://example.com/playlist.m3u" spellcheck="false" data-autofocus></label>`
    : `<label class="field">Playlist file<input type="file" id="f-file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" data-autofocus></label>${p && p.fileName ? `<p class="hint">Current file: ${esc(p.fileName)}. Choose a file only to replace it.</p>` : ''}`;
  const titles = { xtream: 'Xtream Codes login', m3u: 'M3U playlist link', file: 'M3U playlist file' };
  return `<div class="pad">${head((p ? 'Edit · ' : '') + titles[method])}
    <form class="form" id="plForm" novalidate data-method="${method}" data-id="${p ? p.id : ''}" autocomplete="off">
      ${fields}
      <label class="field">Name (optional)<input type="text" id="f-name" value="${v('name')}" placeholder="My TV"></label>
      <details${epg ? ' open' : ''}><summary class="hint" style="cursor:pointer">TV guide (EPG) — optional</summary>
        <div class="form" style="margin-top:12px">
          <label class="field">XMLTV guide links, one per line<textarea id="f-epg" rows="3" placeholder="${method === 'xtream' ? 'Leave empty to use your provider’s guide' : 'https://example.com/guide.xml.gz'}">${esc(epg)}</textarea></label>
          ${method !== 'xtream' ? `<div class="row">${COUNTRY_GUIDES.map(([n, u]) => `<button class="btn sm" type="button" data-act="add-epg" data-url="${esc(u)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
        </div></details>
      <div id="formMsg"></div>
      <div class="row"><button class="btn primary big" type="submit" data-key="act:save">${p ? 'Save changes' : method === 'xtream' ? 'Log in and add' : 'Add playlist'}</button>
        <button class="btn big ghost" type="button" data-act="back">Cancel</button></div>
    </form>
    <p class="hint" style="margin-top:20px;max-width:64ch">Your login is saved only on this device and is sent only to the server you enter.</p></div>`;
}
async function submitPlaylist(form) {
  const method = form.dataset.method, id = form.dataset.id;
  const msg = $('#formMsg');
  const say = (html, ok) => { msg.innerHTML = html ? `<div class="${ok ? 'form-ok' : 'form-err'}">${html}</div>` : ''; };
  const val = s => ($(s) && $(s).value || '').trim();
  const existing = id ? S.playlists.find(x => x.id === id) : null;
  const entry = existing ? { ...existing } : { id: uid(), created: Date.now() };
  entry.epg = val('#f-epg').split(/[\s,]+/).filter(u => /^https?:\/\//i.test(u));
  const btn = form.querySelector('[type=submit]'); btn.disabled = true;
  try {
    if (method === 'xtream') {
      const server = normalizeServer(val('#f-server')), username = val('#f-user'), password = $('#f-pass').value;
      if (!server || !username || !password) throw new Error('Enter the server address, username and password.');
      say('Logging in…', true);
      const acc = await new Xtream({ server, username, password }).auth();
      Object.assign(entry, { type: 'xtream', server, username, password, account: { ...acc, checked: Date.now() } });
      entry.name = val('#f-name') || new URL(server).hostname;
    } else if (method === 'm3u') {
      const url = val('#f-url');
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Enter a link starting with http:// or https://');
      const xl = parseXtreamLink(url);
      if (xl) {
        say('This is an Xtream Codes link. Logging in to include movies and series…', true);
        const acc = await new Xtream(xl).auth();
        Object.assign(entry, { type: 'xtream', ...xl, account: { ...acc, checked: Date.now() } });
        delete entry.url;
        entry.name = val('#f-name') || new URL(xl.server).hostname;
      } else {
        Object.assign(entry, { type: 'm3u', url });
        entry.name = val('#f-name') || new URL(url).hostname;
      }
    } else if (method === 'file') {
      const f = $('#f-file').files[0];
      if (!f && !existing) throw new Error('Choose a playlist file.');
      if (f) {
        const text = await f.text();
        if (!/#EXTINF/.test(text)) throw new Error('That file isn’t an M3U playlist.');
        await idb.set('file:' + entry.id, text);
        entry.fileName = f.name;
      }
      Object.assign(entry, { type: 'file' });
      entry.name = val('#f-name') || (entry.fileName || 'Playlist').replace(/\.(m3u8?|txt)$/i, '');
    }
  } catch (e) {
    say(esc(e.message || String(e))); btn.disabled = false; return;
  }
  if (existing) S.playlists = S.playlists.map(x => x.id === entry.id ? entry : x); else S.playlists.push(entry);
  savePlaylists();
  await idb.del('cat:' + entry.id);
  activate(entry.id, true);
}
function activate(id, force) {
  S.activeId = id; ls.set('active', id);
  S.cat = null; S.error = null; S.guide = null; S.guideMsg = ''; S.guideSeq++; S.sched = new Map();
  S.ui.liveCat = '__all'; S.ui.movieCat = '__all'; S.ui.seriesCat = '__all'; S.ui.selLive = null;
  S.stack = []; S.view = 'live'; S.params = {};
  render();
  ensureCatalog(!!force);
}
function addPreset(name, url) {
  const existing = S.playlists.find(p => p.url === url);
  if (existing) { activate(existing.id); return; }
  const isPublicList = PRESETS.some(g => g.items.some(([, u]) => u === url));
  const entry = { id: uid(), created: Date.now(), type: 'm3u', url, name: isPublicList ? 'Free · ' + name : name, epg: [] };
  S.playlists.push(entry); savePlaylists();
  activate(entry.id);
}

// ---------- Settings ----------
function viewSettings() {
  const s = S.set;
  const sel = (k, opts) => `<select data-set="${k}" id="set-${k}">${opts.map(([v, n]) => `<option value="${v}"${String(s[k]) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const sw = (k) => `<button class="switch" role="switch" aria-checked="${!!s[k]}" data-act="toggle-set" data-set="${k}" id="set-${k}" aria-label="${k}"></button>`;
  const row = (title, hint, ctl) => `<div class="set-row"><div><b>${title}</b>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${ctl}</div>`;
  return `<div class="pad"><h1 class="h1" style="margin-bottom:18px">Settings</h1><div class="stack">
    <section class="set-group"><h3>Player</h3>
      ${hasNativePlayer() ? row('Video player', 'The built-in player plays more stream types and supports subtitles and audio tracks.', sel('player', [['native', 'Built-in (recommended)'], ['web', 'Web player']])) : ''}
      ${row('Buffer size', 'Use a larger buffer if streams stutter on a slow connection.', sel('buffer', [['small', 'Small (starts faster)'], ['normal', 'Normal'], ['large', 'Large (fewer pauses)']]))}
      ${row('Picture size', 'How video fills the screen. You can also change it while watching.', sel('resize', [['fit', 'Fit'], ['fill', 'Stretch'], ['zoom', 'Zoom']]))}
      ${row('Xtream live format', 'Try MPEG-TS if live channels don’t start.', sel('liveFormat', [['m3u8', 'HLS (.m3u8)'], ['ts', 'MPEG-TS (.ts)']]))}
      ${row('User agent', 'Some providers only accept certain players. Leave empty unless your provider tells you otherwise.', `<input type="text" id="set-userAgent" data-set="userAgent" value="${esc(s.userAgent)}" placeholder="Default" spellcheck="false">`)}
    </section>
    <section class="set-group"><h3>TV guide and content</h3>
      ${row('Load full TV guide for Xtream logins', 'Shows what’s on in the channel list. Large providers’ guides can be slow on older TV boxes; channel details always show the schedule.', sw('fullGuide'))}
      ${row('Clock', '', sel('clock', [['auto', 'Device default'], ['12', '12-hour'], ['24', '24-hour']]))}
      ${row('Hide adult categories', 'Hides categories marked adult or 18+.', sw('hideAdult'))}
    </section>
    <section class="set-group"><h3>Backup</h3>
      ${row('Export playlists and favorites', 'Copy this text to move your setup to another device. It includes your logins, so keep it private.', '<button class="btn" data-act="export" id="exportBtn">Export</button>')}
      <div id="exportBox" hidden style="padding-bottom:14px"><textarea id="exportText" rows="5" readonly></textarea><div class="row" style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" data-act="copy-export">Copy</button></div></div>
      ${row('Import', 'Paste text exported from Signal IPTV on another device.', '<button class="btn" data-act="show-import" id="importBtn">Import</button>')}
      <div id="importBox" hidden style="padding-bottom:14px"><textarea id="importText" rows="5" placeholder="Paste your backup here"></textarea><div class="row" style="display:flex;gap:8px;margin-top:8px"><button class="btn sm primary" data-act="import">Import backup</button></div><div id="importMsg"></div></div>
      ${row('Clear saved channel lists', 'Playlists reload from your provider next time.', '<button class="btn" data-act="clear-cache" id="clearBtn">Clear</button>')}
    </section>
    <section class="set-group"><h3>About</h3>
      <div class="set-row"><div><b>Signal IPTV ${VERSION}</b><div class="hint">${EDITION === 'play' ? 'Google Play edition' : 'GitHub edition'} · ${hasNativePlayer() ? 'Android' : 'Web'}. Signal IPTV is a player only and doesn’t provide any channels or video content.</div></div>
      <a class="btn sm" href="https://github.com/chanleexro-bit/signal-iptv/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy policy</a></div>
    </section></div></div>`;
}
function applySetting(k, v) {
  S.set[k] = v; saveSettings(S.set);
  if (k === 'clock') setClock(v);
  if (k === 'userAgent') setUserAgent(v);
  if (k === 'hideAdult') { S.libCache = {}; S.ui.liveCat = S.ui.movieCat = S.ui.seriesCat = '__all'; }
  if (k === 'fullGuide' && pl() && pl().type === 'xtream') startGuide();
  toast('Saved');
}

// ---------- sheet + toast ----------
function openSheet(html) {
  $('#sheetBody').innerHTML = html + '<div class="row"><button class="btn" data-act="close-sheet">Close</button></div>';
  $('#sheet').hidden = false;
  setTimeout(() => focusFirst($('#sheet')), 30);
}
function closeSheet() {
  $('#sheet').hidden = true;
  const k = S.sheetReturn; S.sheetReturn = null;
  if (k) { const el = $(`#view [data-key="${CSS.escape(k)}"]`); if (el) focusEl(el); }
}
let toastT;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- events ----------
const VIEWS = { live: viewLive, movies: () => viewLib('movie'), series: () => viewLib('series'), favorites: viewFavs, search: viewSearch, menu: viewMenu,
  playlists: viewPlaylists, 'playlist-edit': viewEditor, onboarding: viewOnboarding, settings: viewSettings, movie: viewMovie, show: viewSeries };

const confirmDel = new Map();
document.addEventListener('click', async e => {
  const goEl = e.target.closest('[data-go]');
  if (goEl) {
    const v = goEl.dataset.go;
    go(v, {}, { section: !$('#view').contains(goEl) });
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case 'retry': ensureCatalog(true); break;
    case 'refresh': if (pl()) { await idb.del('cat:' + S.activeId); S.info = new Map(); S.sched = new Map(); ensureCatalog(true); } break;
    case 'back': back(); break;
    case 'cat': {
      const k = el.dataset.kind, key = k === 'live' ? 'liveCat' : k === 'movie' ? 'movieCat' : 'seriesCat';
      S.ui[key] = el.dataset.cat; S.focusKey = `cat:${k}:${el.dataset.cat}`; render();
      const pb = $('#view .pane-body'); if (pb) pb.scrollTop = 0;
      break;
    }
    case 'play-live': {
      const ch = S.byId.live.get(id); if (ch) { S.ui.selLive = id; playLive(ch, el.dataset.ctx || 'live'); }
      if (!$('#sheet').hidden) $('#sheet').hidden = true;
      break;
    }
    case 'ch-info': {
      e.stopPropagation();
      const ch = S.byId.live.get(id); if (!ch) break;
      S.sheetReturn = 'live:' + id;
      openSheet('<div id="sheetInfo"></div>');
      updateInfo(ch, $('#sheetInfo'));
      break;
    }
    case 'catchup': {
      const ch = S.byId.live.get(id); if (!ch) break;
      const prog = { s: +el.dataset.s, e: +el.dataset.e, start: el.dataset.start, t: el.dataset.t };
      if (!$('#sheet').hidden) $('#sheet').hidden = true;
      const res = await play({ items: [{ url: catchupUrl(ch, prog), title: ch.name, subtitle: `${prog.t} · ${dayLabel(prog.s)} ${hm(prog.s)}`, headers: ch.headers }], index: 0, live: false, settings: S.set });
      if (res && res.error) toast('Catch-up isn’t available for this programme');
      S.focusKey = 'live:' + id; render();
      break;
    }
    case 'fav': {
      toggleFav(el.dataset.kind, id);
      if (el.closest('#sheet')) { $('#sheetInfo') && updateInfo(S.byId.live.get(id), $('#sheetInfo')); refreshLive(); break; }
      S.focusKey = el.dataset.key; render();
      break;
    }
    case 'open-movie': go('movie', { id }); break;
    case 'open-series': go('show', { id }); break;
    case 'play-movie': { const it = S.byId.movie.get(id); if (it) playMovie(it, el.dataset.from === '0'); break; }
    case 'play-ep': { const it = S.byId.series.get(id); if (it) playEpisode(it, el.dataset.ep); break; }
    case 'season': S.ui.season[id] = el.dataset.season; S.focusKey = el.dataset.key; render(); break;
    case 'resume': resume(el.dataset.pk); break;
    case 'fav-tab': S.ui.favTab = el.dataset.tab; S.focusKey = el.dataset.key; render(); break;
    case 'method': go('playlist-edit', { m: el.dataset.m }); break;
    case 'add-preset': addPreset(el.dataset.name, el.dataset.url); break;
    case 'add-epg': { const t = $('#f-epg'); if (t && !t.value.includes(el.dataset.url)) t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + el.dataset.url; break; }
    case 'show-pass': { const f = $('#f-pass'); f.type = f.type === 'password' ? 'text' : 'password'; el.textContent = f.type === 'password' ? 'Show password' : 'Hide password'; break; }
    case 'use-pl': activate(id); break;
    case 'reload-pl': await idb.del('cat:' + id); activate(id, true); break;
    case 'edit-pl': go('playlist-edit', { id }); break;
    case 'del-pl': {
      if (!confirmDel.has(id)) { confirmDel.set(id, setTimeout(() => { confirmDel.delete(id); el.textContent = 'Delete'; }, 4000)); el.textContent = 'Press again to delete'; break; }
      clearTimeout(confirmDel.get(id)); confirmDel.delete(id);
      S.playlists = S.playlists.filter(p => p.id !== id); savePlaylists();
      delete S.favs[id]; ls.set('favs', S.favs); dropCatalog(id);
      if (S.activeId === id) { S.activeId = S.playlists[0] ? S.playlists[0].id : null; ls.set('active', S.activeId); S.cat = null; }
      toast('Playlist deleted');
      if (!S.playlists.length) { S.stack = []; S.view = 'onboarding'; }
      render();
      break;
    }
    case 'toggle-set': { const k = el.dataset.set; applySetting(k, !S.set[k]); el.setAttribute('aria-checked', String(!!S.set[k])); break; }
    case 'export': {
      const data = { app: 'signal-iptv', v: 2, playlists: S.playlists.filter(p => p.type !== 'file'), favs: S.favs, settings: S.set };
      $('#exportText').value = JSON.stringify(data); $('#exportBox').hidden = false; $('#exportText').select();
      break;
    }
    case 'copy-export': {
      const t = $('#exportText');
      try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch { t.select(); toast('Select the text and copy it'); }
      break;
    }
    case 'show-import': $('#importBox').hidden = false; $('#importText').focus(); break;
    case 'import': {
      const m = $('#importMsg');
      try {
        const d = JSON.parse($('#importText').value.trim());
        if (d.app !== 'signal-iptv' || !Array.isArray(d.playlists)) throw new Error();
        let added = 0;
        for (const p of d.playlists) if (p && p.id && !S.playlists.some(x => x.id === p.id)) { S.playlists.push(p); added++; }
        S.favs = { ...d.favs, ...S.favs };
        savePlaylists(); ls.set('favs', S.favs);
        if (!S.activeId && S.playlists[0]) { S.activeId = S.playlists[0].id; ls.set('active', S.activeId); }
        m.innerHTML = `<div class="form-ok" style="margin-top:10px">Imported ${added} playlist${added === 1 ? '' : 's'}.</div>`;
        renderTop();
      } catch { m.innerHTML = '<div class="form-err" style="margin-top:10px">That isn’t a Signal IPTV backup.</div>'; }
      break;
    }
    case 'clear-cache': for (const p of S.playlists) await idb.del('cat:' + p.id); S.cat = null; toast('Saved channel lists cleared'); break;
    case 'close-sheet': closeSheet(); break;
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'plForm') { e.preventDefault(); submitPlaylist(e.target); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'plSel') { activate(t.value); return; }
  if (t.dataset.set && t.tagName === 'SELECT') { applySetting(t.dataset.set, t.value); return; }
  if (t.dataset.set === 'userAgent') { applySetting('userAgent', t.value.trim()); return; }
  if (t.dataset.change === 'cat') {
    const k = t.dataset.kind, key = k === 'live' ? 'liveCat' : k === 'movie' ? 'movieCat' : 'seriesCat';
    S.ui[key] = t.value; S.focusKey = null; render(); const s = $('#view .cat-sel'); if (s) s.focus();
  }
  if (t.dataset.change === 'sort') { S.ui.sort[t.dataset.kind] = t.value; render(); const s = $(`#view [data-change="sort"]`); if (s) s.focus(); }
});
const rerenderFilter = debounce(id => { render(); const f = $('#' + id); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 250);
document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.input;
  if (!k) return;
  if (k === 'liveFilter') { S.ui.liveFilter = t.value; rerenderFilter(t.id); }
  else if (k === 'libFilter') { S.ui.libFilter[t.dataset.kind] = t.value; rerenderFilter(t.id); }
  else if (k === 'q') { S.ui.q = t.value; debouncedSearch(); }
});
const debouncedSearch = debounce(runSearch, 220);
document.addEventListener('focusin', e => {
  const row = e.target.closest && e.target.closest('#view .live .ch[data-id]');
  if (row) selectChannel(row.dataset.id);
});
document.addEventListener('mouseover', e => {
  const row = e.target.closest && e.target.closest('#view .live .ch[data-id]');
  if (row && matchMedia('(hover: hover)').matches) selectChannel(row.dataset.id);
});

// ---------- start ----------
function migrateOldVersion() {
  if (S.playlists.length) return;
  try {
    const raw = localStorage.getItem('sigiptv:lastSrc');
    if (!raw) return;
    const url = JSON.parse(raw);
    if (typeof url !== 'string' || !/^https?:/.test(url)) return;
    const preset = [...PRESETS, ...FULL_PRESETS].flatMap(g => g.items).find(([, u]) => u === url);
    const epg = JSON.parse(localStorage.getItem('sigiptv:epgUrls') || '[]');
    const p = { id: uid(), created: Date.now(), type: 'm3u', url, name: preset ? preset[0] : new URL(url).hostname, epg: Array.isArray(epg) ? epg : [] };
    S.playlists = [p]; S.activeId = p.id; savePlaylists(); ls.set('active', p.id);
  } catch {}
}
function start() {
  document.documentElement.classList.toggle('tv', isTV());
  setClock(S.set.clock); setUserAgent(S.set.userAgent);
  migrateOldVersion();
  if (!pl() && S.playlists.length) { S.activeId = S.playlists[0].id; ls.set('active', S.activeId); }
  buildNav();
  initNav({ onBack: back });
  initWebPlayer();
  if (isNative && Cap.Plugins && Cap.Plugins.App) Cap.Plugins.App.addListener('backButton', back);
  S.view = S.playlists.length ? 'live' : 'onboarding';
  render();
  if (pl()) ensureCatalog();
  setInterval(refreshLive, 60000);
  if (document.documentElement.classList.contains('tv')) setTimeout(() => { if (document.activeElement === document.body) focusFirst($('#view')); }, 300);
}
window.__signal = { S, render, go };
start();
