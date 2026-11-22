import { getJSON } from './net.js';
import { b64, yearOf } from './util.js';

/** Accepts "host:port", "http://host:port/", or a full get.php / player_api.php link. */
export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    let path = u.pathname.replace(/\/(player_api|get|xmltv|panel_api)\.php.*$/i, '').replace(/\/+$/, '');
    return u.origin + path;
  } catch { return s.replace(/\/+$/, ''); }
}

/** If an M3U link is really an Xtream "get.php?username=…&password=…" link, return the login. */
export function parseXtreamLink(url) {
  try {
    const u = new URL(url.trim());
    const user = u.searchParams.get('username'), pass = u.searchParams.get('password');
    if (user && pass && /\/(get|player_api)\.php$/i.test(u.pathname)) return { server: normalizeServer(u.origin + u.pathname), username: user, password: pass };
  } catch {}
  return null;
}

const enc = encodeURIComponent;
const cleanCats = (arr) => (Array.isArray(arr) ? arr : []).map(c => ({ id: String(c.category_id), name: String(c.category_name || 'Other') }));

export class Xtream {
  constructor({ server, username, password }) {
    this.base = normalizeServer(server); this.u = username; this.p = password;
  }
  api(params = '') {
    return getJSON(`${this.base}/player_api.php?username=${enc(this.u)}&password=${enc(this.p)}${params ? '&' + params : ''}`, 90000);
  }
  async auth() {
    let r;
    try { r = await this.api(); }
    catch (e) { if (e.status === 401 || e.status === 403) throw new Error('The server rejected this username or password'); throw e; }
    const ui = r && r.user_info;
    if (!ui) throw new Error('This doesn’t look like an Xtream Codes server. Check the server address.');
    if (+ui.auth === 0) throw new Error('Wrong username or password');
    const exp = ui.exp_date && +ui.exp_date ? +ui.exp_date * 1000 : null;
    return {
      status: ui.status || 'Active', expires: exp, maxConnections: +ui.max_connections || 0,
      activeConnections: +ui.active_cons || 0, trial: +ui.is_trial === 1,
      formats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [],
      timezone: r.server_info && r.server_info.timezone || ''
    };
  }
  async catalog() {
    const calls = ['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'];
    const res = await Promise.allSettled(calls.map(a => this.api('action=' + a)));
    const val = i => res[i].status === 'fulfilled' && Array.isArray(res[i].value) ? res[i].value : [];
    if (res.every(r => r.status === 'rejected')) throw res[1].reason || new Error('Couldn’t load channels');
    const live = val(1).map((s, i) => ({
      id: String(s.stream_id), streamId: s.stream_id, name: String(s.name || 'Channel').trim(), logo: s.stream_icon || '',
      cat: String(s.category_id ?? 'other'), num: +s.num || i + 1, epgId: s.epg_channel_id || '',
      archive: +s.tv_archive === 1, archiveDays: +s.tv_archive_duration || 0, adult: +s.is_adult === 1
    }));
    const movie = val(3).map(s => ({
      id: String(s.stream_id), streamId: s.stream_id, name: String(s.name || 'Movie').trim(), poster: s.stream_icon || '',
      cat: String(s.category_id ?? 'other'), rating: parseFloat(s.rating) || 0, ext: s.container_extension || 'mp4',
      added: +s.added || 0, year: yearOf(s.name) || '', adult: +s.is_adult === 1
    }));
    const series = val(5).map(s => ({
      id: String(s.series_id), seriesId: s.series_id, name: String(s.name || 'Series').trim(), poster: s.cover || '',
      cat: String(s.category_id ?? 'other'), rating: parseFloat(s.rating) || 0, plot: s.plot || '',
      year: String(s.releaseDate || s.release_date || '').slice(0, 4) || yearOf(s.name), added: +s.last_modified || 0
    }));
    return {
      live: { cats: cleanCats(val(0)), items: live },
      movie: { cats: cleanCats(val(2)), items: movie },
      series: { cats: cleanCats(val(4)), items: series },
      epgUrls: [this.xmltvUrl()]
    };
  }
  async movieInfo(id) {
    const r = await this.api('action=get_vod_info&vod_id=' + enc(id));
    const i = (r && r.info) || {};
    const md = (r && r.movie_data) || {};
    return {
      plot: i.plot || i.description || '', cast: i.cast || i.actors || '', director: i.director || '', genre: i.genre || '',
      released: i.releasedate || i.release_date || '', minutes: i.duration_secs ? Math.round(i.duration_secs / 60) : parseDuration(i.duration),
      rating: parseFloat(i.rating) || 0, backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : (i.backdrop_path || ''),
      poster: i.movie_image || i.cover_big || '', ext: md.container_extension || '', trailer: i.youtube_trailer || ''
    };
  }
  async seriesInfo(id) {
    const r = await this.api('action=get_series_info&series_id=' + enc(id));
    const i = (r && r.info) || {};
    const episodes = {};
    const raw = r && r.episodes;
    const groups = Array.isArray(raw) ? raw.map((list, k) => [String(k + 1), list]) : Object.entries(raw || {});
    for (const [season, list] of groups) {
      episodes[season] = (list || []).map(e => ({
        id: String(e.id), num: +e.episode_num || 0, season: +season, title: e.title || `Episode ${e.episode_num}`,
        ext: e.container_extension || 'mp4', plot: (e.info && e.info.plot) || '', poster: (e.info && e.info.movie_image) || '',
        minutes: e.info ? (e.info.duration_secs ? Math.round(e.info.duration_secs / 60) : parseDuration(e.info.duration)) : 0
      })).sort((a, b) => a.num - b.num);
    }
    return {
      plot: i.plot || '', cast: i.cast || '', director: i.director || '', genre: i.genre || '', released: i.releaseDate || i.release_date || '',
      rating: parseFloat(i.rating) || 0, backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : (i.backdrop_path || ''),
      poster: i.cover || '', episodes
    };
  }
  /** Programmes for one channel, including past ones that can be replayed (catch-up). */
  async schedule(streamId) {
    let r;
    try { r = await this.api('action=get_simple_data_table&stream_id=' + enc(streamId)); }
    catch { r = await this.api('action=get_short_epg&limit=12&stream_id=' + enc(streamId)); }
    const list = (r && r.epg_listings) || [];
    return list.map(p => ({
      s: (+p.start_timestamp || Date.parse(p.start)) * (p.start_timestamp ? 1000 : 1),
      e: (+p.stop_timestamp || Date.parse(p.end || p.stop)) * (p.stop_timestamp ? 1000 : 1),
      t: b64(p.title), d: b64(p.description), archive: +p.has_archive === 1, start: p.start
    })).filter(p => p.s && p.e).sort((a, b) => a.s - b.s);
  }
  liveUrl(id, fmt = 'm3u8') { return `${this.base}/live/${enc(this.u)}/${enc(this.p)}/${id}.${fmt === 'ts' ? 'ts' : 'm3u8'}`; }
  movieUrl(id, ext = 'mp4') { return `${this.base}/movie/${enc(this.u)}/${enc(this.p)}/${id}.${ext}`; }
  episodeUrl(id, ext = 'mp4') { return `${this.base}/series/${enc(this.u)}/${enc(this.p)}/${id}.${ext}`; }
  /** Catch-up link. `start` is the programme start in the server's own time ("2026-11-22 13:00:00"). */
  timeshiftUrl(id, start, minutes) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(start || '');
    if (!m) return '';
    return `${this.base}/timeshift/${enc(this.u)}/${enc(this.p)}/${Math.max(1, Math.round(minutes))}/${m[1]}:${m[2]}-${m[3]}/${id}.ts`;
  }
  xmltvUrl() { return `${this.base}/xmltv.php?username=${enc(this.u)}&password=${enc(this.p)}`; }
}

function parseDuration(s) {
  const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(String(s || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}
