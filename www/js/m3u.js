import { hash, yearOf } from './util.js';

const SERIES_RE = /^(.*?)[\s._\-|]*\bS(\d{1,2})\s*[\s._-]?E(\d{1,4})\b/i;
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|webm)(\?|$)/i;

/** Parse an M3U/M3U8 playlist into live channels, movies and series (grouped by episode names). */
export function parseM3U(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  let header = '', info = null, extGroup = '', opts = {};
  const entries = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) { header = line; continue; }
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      line.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k.toLowerCase()] = v; });
      const q = line.lastIndexOf('"');
      const comma = line.indexOf(',', q > 0 ? q : 0);
      const name = (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || 'Untitled';
      info = { name, attrs };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) { extGroup = line.slice(8).trim(); continue; }
    if (line.startsWith('#EXTVLCOPT:')) {
      const m = /^#EXTVLCOPT:http-(user-agent|referrer|referer)=(.*)$/i.exec(line);
      if (m) opts[m[1].toLowerCase() === 'user-agent' ? 'User-Agent' : 'Referer'] = m[2].trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    const a = info ? info.attrs : {};
    entries.push({
      url: line,
      name: info ? info.name : (line.split('/').pop() || line),
      logo: a['tvg-logo'] || '',
      group: a['group-title'] || extGroup || 'Ungrouped',
      tvgId: a['tvg-id'] || '',
      tvgName: a['tvg-name'] || '',
      num: a['tvg-chno'] ? +a['tvg-chno'] : 0,
      catchup: a['catchup'] || a['catchup-type'] || '',
      catchupDays: +(a['catchup-days'] || a['timeshift'] || 0),
      catchupSource: a['catchup-source'] || '',
      headers: Object.keys(opts).length ? opts : undefined
    });
    info = null; extGroup = ''; opts = {};
  }
  const tvg = /(?:url-tvg|x-tvg-url)="([^"]*)"/i.exec(header);
  const epgUrls = tvg ? tvg[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  return { entries, epgUrls };
}

function catsFrom(items) {
  const seen = new Map();
  for (const it of items) if (!seen.has(it.cat)) seen.set(it.cat, { id: it.cat, name: it.cat });
  return [...seen.values()];
}

export function catalogFromM3U(text) {
  const { entries, epgUrls } = parseM3U(text);
  const live = [], movies = [], seriesMap = new Map();
  for (const e of entries) {
    const path = e.url.toLowerCase();
    const isSeriesPath = path.includes('/series/');
    const isMoviePath = path.includes('/movie/');
    const sm = SERIES_RE.exec(e.name);
    if (isSeriesPath || (sm && (VIDEO_EXT.test(e.url) || isMoviePath))) {
      const show = (sm ? sm[1] : e.name).replace(/[\s._\-|]+$/, '').trim() || e.name;
      const sid = hash('s:' + e.group + ':' + show.toLowerCase());
      if (!seriesMap.has(sid)) seriesMap.set(sid, { id: sid, name: show, poster: e.logo, cat: e.group, rating: 0, year: yearOf(show), plot: '', episodes: {} });
      const s = seriesMap.get(sid);
      const season = sm ? +sm[2] : 1, epNum = sm ? +sm[3] : Object.values(s.episodes).flat().length + 1;
      (s.episodes[season] = s.episodes[season] || []).push({ id: hash(e.url), num: epNum, season, title: e.name, url: e.url, poster: e.logo });
      continue;
    }
    if (isMoviePath || VIDEO_EXT.test(e.url)) {
      movies.push({ id: hash(e.url), name: e.name, poster: e.logo, cat: e.group, rating: 0, year: yearOf(e.name), url: e.url, headers: e.headers });
      continue;
    }
    live.push({
      id: hash(e.url), name: e.name, logo: e.logo, cat: e.group, num: e.num, epgId: e.tvgId, tvgName: e.tvgName,
      url: e.url, headers: e.headers,
      archive: !!(e.catchup && e.catchupSource), archiveDays: e.catchupDays, catchupSource: e.catchupSource
    });
  }
  live.forEach((c, i) => { if (!c.num) c.num = i + 1; });
  const series = [...seriesMap.values()];
  for (const s of series) for (const k in s.episodes) s.episodes[k].sort((a, b) => a.num - b.num);
  return {
    live: { cats: catsFrom(live), items: live },
    movie: { cats: catsFrom(movies), items: movies },
    series: { cats: catsFrom(series), items: series },
    epgUrls
  };
}
