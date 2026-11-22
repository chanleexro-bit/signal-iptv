// HTTP helpers. Inside the Android app requests go through native HTTP, so provider servers
// without CORS headers (most IPTV servers) still work.
const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const native = isNative && Cap.Plugins && Cap.Plugins.CapacitorHttp;

let userAgent = '';
export const setUserAgent = ua => { userAgent = ua || ''; };

async function nativeRequest(url, responseType, timeout = 60000) {
  const headers = userAgent ? { 'User-Agent': userAgent } : {};
  const r = await Cap.Plugins.CapacitorHttp.request({ url, method: 'GET', responseType, headers, connectTimeout: 20000, readTimeout: timeout });
  if (r.status >= 400) throw httpError(r.status);
  return r;
}
function httpError(status) {
  const e = new Error(status === 401 || status === 403 ? 'Access denied (HTTP ' + status + ')' : status === 404 ? 'Not found (HTTP 404)' : 'Server error (HTTP ' + status + ')');
  e.status = status; return e;
}
async function webFetch(url, timeout = 60000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw httpError(r.status);
    return r;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server took too long to answer');
    if (e instanceof TypeError) { const x = new Error('Couldn’t reach the server' + (isNative ? '' : ' (it may block web browsers; the Android app isn’t affected)')); x.network = true; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}

export async function getText(url, timeout) {
  if (native) { const r = await nativeRequest(url, 'text', timeout); return typeof r.data === 'string' ? r.data : JSON.stringify(r.data); }
  return (await webFetch(url, timeout)).text();
}
export async function getJSON(url, timeout) {
  const text = await getText(url, timeout);
  try { return JSON.parse(text); }
  catch { const e = new Error('The server sent an unexpected answer'); e.body = text.slice(0, 200); throw e; }
}
export async function getBytes(url, timeout) {
  if (native) {
    const r = await nativeRequest(url, 'arraybuffer', timeout ?? 120000);
    if (typeof r.data !== 'string') return new TextEncoder().encode(JSON.stringify(r.data));
    try { const bin = atob(r.data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    catch { return new TextEncoder().encode(r.data); }
  }
  return new Uint8Array(await (await webFetch(url, timeout ?? 120000)).arrayBuffer());
}
/** Text that may be gzip-compressed (.xml.gz guides). */
export async function getMaybeGzip(url) {
  const b = await getBytes(url);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (!('DecompressionStream' in window)) throw new Error('this device can’t unpack .gz guides');
    return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return new TextDecoder().decode(b);
}
