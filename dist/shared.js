// Catalog loading + utilities shared with the rest of the UI.
// Mirrors the web version's shared.js but trimmed for the desktop app:
// we always run a real Homebrew install, so the script/banner helpers
// from the web one-liner are gone.

export const CASK_URL = 'https://formulae.brew.sh/api/cask.json';
export const FORMULA_URL = 'https://formulae.brew.sh/api/formula.json';
export const CACHE_KEY = 'macnite:catalog:v2';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const TOKEN_RE = /^[a-z0-9][a-z0-9._+-]*$/i;

export const keyOf = (kind, token) => `${kind}:${token}`;

export async function loadCatalogs() {
  const cached = readCache();
  if (cached) return cached;
  const [casksRaw, formulaeRaw] = await Promise.all([
    fetch(CASK_URL).then(checkOk).then(r => r.json()),
    fetch(FORMULA_URL).then(checkOk).then(r => r.json()),
  ]);
  const casks = casksRaw.map(c => ({
    kind: 'cask',
    token: c.token,
    name: Array.isArray(c.name) ? c.name[0] : c.token,
    desc: c.desc || '',
    homepage: c.homepage || '',
  }));
  const formulae = formulaeRaw.map(f => ({
    kind: 'formula',
    token: f.name,
    name: f.name,
    desc: f.desc || '',
    homepage: f.homepage || '',
  }));
  const data = { casks, formulae, savedAt: Date.now() };
  writeCache(data);
  return data;
}

function checkOk(res) {
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status} ${res.statusText} (${res.url})`);
  return res;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
  catch { /* localStorage may be full or disabled; ignore */ }
}

export function buildIndex({ casks, formulae }) {
  const index = [...casks, ...formulae];
  const byKey = new Map();
  for (const e of index) byKey.set(keyOf(e.kind, e.token), e);
  return { index, byKey };
}

export function splitSelection(selectedKeys) {
  const casks = [];
  const formulae = [];
  for (const key of selectedKeys) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const token = key.slice(i + 1);
    if (!TOKEN_RE.test(token)) continue;
    if (kind === 'cask') casks.push(token);
    else if (kind === 'formula') formulae.push(token);
  }
  casks.sort(); formulae.sort();
  return { casks, formulae };
}

export function selectionToPackages(selectedKeys) {
  const out = [];
  for (const key of selectedKeys) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const token = key.slice(i + 1);
    if ((kind !== 'cask' && kind !== 'formula') || !TOKEN_RE.test(token)) continue;
    out.push({ kind, token });
  }
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function faviconUrl(homepage) {
  if (!homepage) return null;
  try {
    const host = new URL(homepage).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

export function buildIcon(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'icon';
  const url = faviconUrl(entry.homepage);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.remove();
      wrap.textContent = (entry.name || entry.token).charAt(0).toUpperCase();
      wrap.classList.add('icon-fallback');
    }, { once: true });
    wrap.appendChild(img);
  } else {
    wrap.textContent = (entry.name || entry.token).charAt(0).toUpperCase();
    wrap.classList.add('icon-fallback');
  }
  return wrap;
}
