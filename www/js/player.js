import { isNative } from './net.js';
import { $, esc, dur } from './util.js';
import { focusEl } from './nav.js';

const Cap = window.Capacitor;
export const hasNativePlayer = () => !!(isNative && Cap.isPluginAvailable && Cap.isPluginAvailable('NativePlayer'));

/**
 * Play a list of items. opts = { items:[{url,title,subtitle,headers}], index, startMs, live, settings }
 * Resolves when the viewer closes the player: { position, duration, index, ended, error }.
 */
export async function play(opts) {
  const s = opts.settings || {};
  if (hasNativePlayer() && s.player !== 'web') {
    try {
      return await Cap.Plugins.NativePlayer.play({
        items: opts.items, index: opts.index || 0, startMs: Math.round(opts.startMs || 0), live: !!opts.live,
        userAgent: s.userAgent || '', resizeMode: s.resize || 'fit', buffer: s.buffer || 'normal'
      });
    } catch (e) { console.warn('Native player failed, using web player', e); }
  }
  return webPlayer.open(opts);
}

// ---------- Web player (desktop browsers, or when chosen in Settings) ----------
const FITS = [['contain', 'Fit'], ['fill', 'Fill'], ['cover', 'Zoom']];
const webPlayer = {
  open(opts) {
    return new Promise(resolve => {
      this.opts = opts; this.items = opts.items; this.idx = opts.index || 0; this.resolve = resolve; this.ended = false;
      this.fit = Math.max(0, FITS.findIndex(f => f[1].toLowerCase() === (opts.settings && opts.settings.resize || 'fit')));
      const wp = $('#wp');
      wp.hidden = false; document.body.classList.add('playing');
      wp.classList.toggle('is-live', !!opts.live);
      wp.classList.toggle('single', this.items.length < 2);
      this.applyFit();
      this.load(this.idx, opts.live ? 0 : (opts.startMs || 0));
      this.poke();
      setTimeout(() => focusEl($('#wpPlay')), 50);
    });
  },
  load(i, startMs = 0) {
    const v = $('#wpv'), it = this.items[i];
    this.idx = i; this.triedNative = false;
    $('#wpTitle').textContent = it.title || ''; $('#wpSub').textContent = it.subtitle || '';
    this.msg(null); this.status('Loading…');
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    v.removeAttribute('src'); v.load();
    v.onloadedmetadata = () => {
      if (startMs > 0 && isFinite(v.duration)) v.currentTime = startMs / 1000;
      this.fillTracks();
    };
    v.onplaying = () => { this.status(null); this.msg(null); };
    v.onwaiting = () => this.status('Buffering…');
    v.ontimeupdate = () => this.tick();
    v.onended = () => { if (!this.opts.live && this.idx < this.items.length - 1) this.load(this.idx + 1); else { this.ended = true; this.close(); } };
    v.onerror = () => this.fail('This stream can’t be played in this browser.');
    const useHls = /\.m3u8(\?|$)/i.test(it.url) || (!/\.(mp4|webm|mkv|mov|m4v|mp3|aac|ogg)(\?|$)/i.test(it.url) && !/\.ts(\?|$)/i.test(it.url));
    if (useHls && window.Hls && Hls.isSupported()) {
      const h = this.hls = new Hls({ enableWorker: true, lowLatencyMode: !!this.opts.live, manifestLoadingTimeOut: 15000 });
      h.on(Hls.Events.MANIFEST_PARSED, () => { this.fillTracks(); if (startMs > 0) v.currentTime = startMs / 1000; v.play().catch(() => {}); });
      h.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.fillTracks());
      h.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.fillTracks());
      h.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); return; }
        if (!this.triedNative) { this.triedNative = true; h.destroy(); this.hls = null; v.src = it.url; v.play().catch(() => {}); return; }
        this.fail('The stream is offline or blocks web browsers.');
      });
      h.loadSource(it.url); h.attachMedia(v);
    } else {
      v.src = it.url; v.play().catch(() => {});
    }
  },
  fail(text) {
    this.status(null);
    const hint = this.opts.live && this.items.length > 1 ? '<br>Use ▲ ▼ to change channel.' : '';
    this.msg(`<b>Can’t play this</b>${esc(text)}${hint}`);
    this.poke(true);
  },
  msg(html) { const m = $('#wpMsg'); m.hidden = !html; if (html) m.innerHTML = html; },
  status(text) { const s = $('#wpStatus'); s.hidden = !text; if (text) s.textContent = text; },
  tick() {
    const v = $('#wpv');
    if (this.opts.live || !isFinite(v.duration)) return;
    const seek = $('#wpSeek');
    if (!this.dragging) seek.value = String(Math.round(v.currentTime / v.duration * 1000));
    $('#wpTime').textContent = `${dur(v.currentTime * 1000)} / ${dur(v.duration * 1000)}`;
  },
  fillTracks() {
    const v = $('#wpv'), a = $('#wpAudio'), s = $('#wpSubs');
    let audio = [], subs = [], curA = 0, curS = -1;
    if (this.hls) {
      audio = this.hls.audioTracks.map((t, i) => [i, t.name || t.lang || 'Track ' + (i + 1)]); curA = this.hls.audioTrack;
      subs = this.hls.subtitleTracks.map((t, i) => [i, t.name || t.lang || 'Subtitles ' + (i + 1)]); curS = this.hls.subtitleTrack;
    } else {
      if (v.audioTracks) { audio = [...v.audioTracks].map((t, i) => [i, t.label || t.language || 'Track ' + (i + 1)]); curA = Math.max(0, [...v.audioTracks].findIndex(t => t.enabled)); }
      subs = [...v.textTracks].map((t, i) => [i, t.label || t.language || 'Subtitles ' + (i + 1)]); curS = [...v.textTracks].findIndex(t => t.mode === 'showing');
    }
    a.innerHTML = audio.map(([i, n]) => `<option value="${i}">${esc(n)}</option>`).join(''); a.value = String(curA); a.hidden = audio.length < 2;
    s.innerHTML = '<option value="-1">Subtitles off</option>' + subs.map(([i, n]) => `<option value="${i}">${esc(n)}</option>`).join(''); s.value = String(curS); s.hidden = !subs.length;
  },
  setAudio(i) {
    const v = $('#wpv');
    if (this.hls) this.hls.audioTrack = i; else if (v.audioTracks) [...v.audioTracks].forEach((t, k) => { t.enabled = k === i; });
  },
  setSubs(i) {
    const v = $('#wpv');
    if (this.hls) { this.hls.subtitleDisplay = i >= 0; this.hls.subtitleTrack = i; }
    else [...v.textTracks].forEach((t, k) => { t.mode = k === i ? 'showing' : 'disabled'; });
  },
  applyFit() { $('#wpv').style.objectFit = FITS[this.fit][0]; $('#wpFit').textContent = '⤢ ' + FITS[this.fit][1]; },
  zap(d) { const n = this.items.length; if (n < 2) return; this.load((this.idx + d + n) % n); this.poke(); },
  seekBy(sec) { const v = $('#wpv'); if (isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec)); this.poke(); },
  toggle() { const v = $('#wpv'); if (v.paused) v.play().catch(() => {}); else v.pause(); this.poke(); },
  poke(stay) {
    const wp = $('#wp'); wp.classList.add('ui');
    clearTimeout(this.hideT);
    if (!stay) this.hideT = setTimeout(() => { if (!$('#wpv').paused && !wp.matches(':focus-within select:focus')) wp.classList.remove('ui'); }, 3500);
  },
  close() {
    const v = $('#wpv');
    const res = { position: Math.round((v.currentTime || 0) * 1000), duration: isFinite(v.duration) ? Math.round(v.duration * 1000) : 0, index: this.idx, ended: this.ended };
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    v.pause(); v.removeAttribute('src'); v.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('#wp').hidden = true; document.body.classList.remove('playing');
    const r = this.resolve; this.resolve = null; r && r(res);
  }
};

export function initWebPlayer() {
  const wp = $('#wp'), v = $('#wpv');
  wp.addEventListener('click', e => {
    const b = e.target.closest('[data-wp]');
    if (!b) { if (e.target === v || e.target.closest('.wp-stage')) { webPlayer.toggle(); } return; }
    const a = b.dataset.wp;
    if (a === 'close') webPlayer.close();
    else if (a === 'play') webPlayer.toggle();
    else if (a === 'back10') webPlayer.seekBy(-10);
    else if (a === 'fwd10') webPlayer.seekBy(10);
    else if (a === 'prev') webPlayer.opts.live ? webPlayer.zap(-1) : webPlayer.load(Math.max(0, webPlayer.idx - 1));
    else if (a === 'next') webPlayer.opts.live ? webPlayer.zap(1) : webPlayer.load(Math.min(webPlayer.items.length - 1, webPlayer.idx + 1));
    else if (a === 'fit') { webPlayer.fit = (webPlayer.fit + 1) % FITS.length; webPlayer.applyFit(); }
    else if (a === 'fs') { const p = document.fullscreenElement ? document.exitFullscreen() : wp.requestFullscreen && wp.requestFullscreen(); p && p.catch && p.catch(() => {}); }
    webPlayer.poke();
  });
  ['mousemove', 'touchstart', 'focusin'].forEach(ev => wp.addEventListener(ev, () => webPlayer.poke(), { passive: true }));
  v.addEventListener('play', () => { $('#wpPlay').textContent = '❚❚'; $('#wpPlay').setAttribute('aria-label', 'Pause'); });
  v.addEventListener('pause', () => { $('#wpPlay').textContent = '▶'; $('#wpPlay').setAttribute('aria-label', 'Play'); webPlayer.poke(true); });
  const seek = $('#wpSeek');
  seek.addEventListener('input', () => { webPlayer.dragging = true; if (isFinite(v.duration)) $('#wpTime').textContent = `${dur(seek.value / 1000 * v.duration * 1000)} / ${dur(v.duration * 1000)}`; });
  seek.addEventListener('change', () => { webPlayer.dragging = false; if (isFinite(v.duration)) v.currentTime = seek.value / 1000 * v.duration; });
  $('#wpSpeed').addEventListener('change', e => { v.playbackRate = +e.target.value; });
  $('#wpAudio').addEventListener('change', e => webPlayer.setAudio(+e.target.value));
  $('#wpSubs').addEventListener('change', e => webPlayer.setSubs(+e.target.value));
  // Keys while the player is open and its controls are hidden: OK = pause, ◀ ▶ = seek, ▲ ▼ = channel.
  wp.onKey = e => {
    const uiShown = wp.classList.contains('ui');
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') { if (uiShown && !v.paused) { wp.classList.remove('ui'); return true; } webPlayer.close(); return true; }
    if (k === 'MediaPlayPause' || (k === ' ' && document.activeElement.tagName !== 'BUTTON')) { webPlayer.toggle(); return true; }
    if (k === 'ChannelUp' || k === 'PageUp') { webPlayer.zap(1); return true; }
    if (k === 'ChannelDown' || k === 'PageDown') { webPlayer.zap(-1); return true; }
    if (uiShown) { webPlayer.poke(); return false; }
    if (webPlayer.opts.live && (k === 'ArrowUp' || k === 'ArrowDown')) { webPlayer.zap(k === 'ArrowUp' ? 1 : -1); return true; }
    if (!webPlayer.opts.live && (k === 'ArrowLeft' || k === 'ArrowRight')) { webPlayer.seekBy(k === 'ArrowRight' ? 10 : -10); return true; }
    webPlayer.poke(); focusEl($('#wpPlay')); return true;
  };
}
export const webPlayerOpen = () => !$('#wp').hidden;
export const closeWebPlayer = () => webPlayer.resolve && webPlayer.close();
