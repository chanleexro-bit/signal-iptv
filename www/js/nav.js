// Remote-control (D-pad) navigation: arrow keys move focus to the nearest control in that direction.
import { $$ } from './util.js';

const SEL = 'button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export function scopeRoot() {
  const open = $$('[data-modal]').filter(m => !m.hidden);
  return open[open.length - 1] || document.body;
}
const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]'); };
export function focusables(root = scopeRoot()) { return $$(SEL, root).filter(visible); }

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
export function focusFirst(root = scopeRoot()) {
  const pref = root.querySelector('[data-autofocus]');
  focusEl(pref && visible(pref) ? pref : focusables(root)[0]);
}

export function move(dir, root = scopeRoot()) {
  const cur = document.activeElement;
  const items = focusables(root);
  if (!cur || cur === document.body || !root.contains(cur)) { focusFirst(root); return; }
  const c = cur.getBoundingClientRect();
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const r = el.getBoundingClientRect();
    let gap, offset, overlap;
    if (dir === 'down' || dir === 'up') {
      gap = dir === 'down' ? r.top - c.bottom : c.top - r.bottom;
      if ((dir === 'down' ? r.top + r.height / 2 <= c.top + c.height / 2 + 1 : r.top + r.height / 2 >= c.top + c.height / 2 - 1)) continue;
      overlap = Math.min(r.right, c.right) - Math.max(r.left, c.left);
      offset = overlap > 0 ? 0 : -overlap;
    } else {
      gap = dir === 'right' ? r.left - c.right : c.left - r.right;
      if ((dir === 'right' ? r.left + r.width / 2 <= c.left + c.width / 2 + 1 : r.left + r.width / 2 >= c.left + c.width / 2 - 1)) continue;
      overlap = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
      offset = overlap > 0 ? 0 : -overlap;
    }
    const score = Math.max(-20, gap) + offset * 3 + (overlap > 0 ? 0 : 400);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) focusEl(best);
}

export function initNav({ onBack }) {
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const root = scopeRoot();
    if (root.onKey && root.onKey(e)) { e.preventDefault(); return; }
    const a = document.activeElement;
    const typing = a && ((a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'file'].includes(a.type)) || a.tagName === 'TEXTAREA');
    if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing)) {
      e.preventDefault(); onBack(); return;
    }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (!dir) {
      if ((e.key === 'Enter' || e.key === ' ') && a && a.matches('[tabindex]:not(button):not(a):not(input):not(select):not(textarea)')) {
        e.preventDefault(); a.click();
      }
      return;
    }
    // In a text box, ◀ ▶ move the cursor until it reaches the edge, then leave the box.
    if (typing && (dir === 'left' || dir === 'right')) {
      let atEdge = true;
      try {
        const len = a.value.length, st = a.selectionStart, en = a.selectionEnd;
        if (st != null) atEdge = st === en && (dir === 'left' ? st === 0 : en === len);
      } catch {}
      if (!atEdge) return;
    }
    if (a && a.type === 'range' && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    move(dir, root);
  });
}
