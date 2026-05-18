import { POPULAR } from './popular.js';
import {
  loadCatalogs, buildIndex, keyOf,
  selectionToPackages,
  escapeHtml, buildIcon,
} from './shared.js';

const MAX_RESULTS = 100;

// Tauri exposes its JS API as a global when withGlobalTauri is true in
// tauri.conf.json. If we're loaded in a plain browser (e.g. opened the
// index.html directly), invoke/listen will be undefined — guard so the
// catalog still renders and we degrade to a "copy command" view.
const tauri = window.__TAURI__ || null;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

const state = {
  index: [],
  byKey: new Map(),
  selected: new Set(),
  installedKeys: new Set(),
  busy: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  warning: $('#brew-warning'),
  popularGrid: $('#popular-grid'),
  searchInput: $('#search'),
  searchResults: $('#search-results'),
  installedGrid: $('#installed-grid'),
  installedEmpty: $('#installed-empty'),
  updatesList: $('#updates-list'),
  updatesEmpty: $('#updates-empty'),
  upgradeAllBtn: $('#upgrade-all'),
  count: $('#count'),
  installBtn: $('#install'),
  clearBtn: $('#clear'),
  logPanel: $('#log-panel'),
  logHeader: $('#log-header'),
  logTitle: $('#log-title'),
  logOutput: $('#log-output'),
  logClose: $('#log-close'),
  logToggle: $('#log-toggle'),
  logSpinner: $('#log-spinner'),
  tabs: $$('.tab'),
  panels: { browse: $('#panel-browse'), installed: $('#panel-installed'), updates: $('#panel-updates') },
};

// ---- Tile rendering ----

function buildTile(entry, { showRowActions = false } = {}) {
  const key = keyOf(entry.kind, entry.token);
  const label = document.createElement('label');
  label.className = 'tile';
  if (state.selected.has(key)) label.classList.add('checked');
  label.dataset.key = key;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.selected.has(key);
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    toggle(key, cb.checked, label);
  });

  const icon = buildIcon(entry);

  const badgeLabel = entry.kind === 'cask' ? 'App' : 'Tool';
  const installedTag = state.installedKeys.has(key) && !showRowActions
    ? '<span class="badge installed">Installed</span>'
    : '';

  const name = document.createElement('div');
  name.className = 'name';
  name.innerHTML = `
    <span class="name-text">${escapeHtml(entry.name)}</span>
    <span class="badge ${entry.kind}">${badgeLabel}</span>
    ${installedTag}
  `;

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = entry.desc || '';

  label.append(cb, icon, name, desc);

  if (showRowActions && invoke) {
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const upgrade = document.createElement('button');
    upgrade.type = 'button';
    upgrade.className = 'ghost';
    upgrade.textContent = 'Update';
    upgrade.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runOp('upgrade_packages', [{ kind: entry.kind, token: entry.token }], `Updating ${entry.name}`);
    });
    const uninstall = document.createElement('button');
    uninstall.type = 'button';
    uninstall.className = 'danger';
    uninstall.textContent = 'Remove';
    uninstall.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`Uninstall ${entry.name}?`)) return;
      runOp('uninstall_packages', [{ kind: entry.kind, token: entry.token }], `Uninstalling ${entry.name}`);
    });
    actions.append(upgrade, uninstall);
    label.append(actions);
  }

  // Stop a click on the row from triggering the label's checkbox toggle when
  // the user is just trying to press an action button.
  for (const btn of label.querySelectorAll('button')) {
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  return label;
}

function toggle(key, checked, tileEl) {
  if (checked) state.selected.add(key);
  else state.selected.delete(key);
  tileEl?.classList.toggle('checked', checked);
  syncMirroredCheckboxes(key, checked);
  updateSelectionBar();
}

function syncMirroredCheckboxes(key, checked) {
  document.querySelectorAll(`.tile[data-key="${cssEscape(key)}"]`).forEach(tile => {
    tile.classList.toggle('checked', checked);
    const cb = tile.querySelector('input[type=checkbox]');
    if (cb && cb.checked !== checked) cb.checked = checked;
  });
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

// ---- Browse panel ----

function renderPopular() {
  els.popularGrid.removeAttribute('aria-busy');
  els.popularGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const { kind, token } of POPULAR) {
    const entry = state.byKey.get(keyOf(kind, token));
    if (!entry) continue;
    frag.appendChild(buildTile(entry));
  }
  els.popularGrid.appendChild(frag);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const renderSearch = debounce((query) => {
  const q = query.trim().toLowerCase();
  els.searchResults.innerHTML = '';
  if (!q) return;
  const matches = [];
  for (const e of state.index) {
    if (matches.length >= MAX_RESULTS + 1) break;
    if (e.token.toLowerCase().includes(q)
        || e.name.toLowerCase().includes(q)
        || e.desc.toLowerCase().includes(q)) {
      matches.push(e);
    }
  }
  const overflow = matches.length > MAX_RESULTS;
  const shown = overflow ? matches.slice(0, MAX_RESULTS) : matches;
  if (shown.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'No matches.';
    els.searchResults.appendChild(hint);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const e of shown) frag.appendChild(buildTile(e));
  if (overflow) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = `Showing first ${MAX_RESULTS}. Refine your search to see more.`;
    frag.appendChild(hint);
  }
  els.searchResults.appendChild(frag);
}, 150);

function updateSelectionBar() {
  const n = state.selected.size;
  els.count.textContent = n === 0
    ? 'Tick an app to get started'
    : `${n} app${n === 1 ? '' : 's'} selected`;
  const disabled = n === 0 || state.busy;
  els.installBtn.disabled = disabled;
  els.clearBtn.disabled = n === 0 || state.busy;
}

function clearSelection() {
  for (const key of [...state.selected]) {
    state.selected.delete(key);
    syncMirroredCheckboxes(key, false);
  }
  updateSelectionBar();
}

// ---- Installed panel ----

async function refreshInstalled() {
  if (!invoke) return;
  els.installedGrid.setAttribute('aria-busy', 'true');
  els.installedGrid.innerHTML = '<p class="loading">Loading installed apps…</p>';
  els.installedEmpty.hidden = true;
  try {
    const { casks, formulae } = await invoke('list_installed');
    state.installedKeys = new Set([
      ...casks.map(t => keyOf('cask', t)),
      ...formulae.map(t => keyOf('formula', t)),
    ]);
    els.installedGrid.innerHTML = '';
    els.installedGrid.removeAttribute('aria-busy');
    const entries = [...state.installedKeys]
      .map(k => state.byKey.get(k))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0) {
      els.installedEmpty.hidden = false;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const e of entries) frag.appendChild(buildTile(e, { showRowActions: true }));
    els.installedGrid.appendChild(frag);
  } catch (err) {
    els.installedGrid.innerHTML = `<p class="hint">Couldn't list installed apps: ${escapeHtml(String(err))}</p>`;
  }
}

// ---- Updates panel ----

async function refreshUpdates() {
  if (!invoke) return;
  els.updatesList.setAttribute('aria-busy', 'true');
  els.updatesList.innerHTML = '<p class="loading">Checking for updates…</p>';
  els.updatesEmpty.hidden = true;
  els.upgradeAllBtn.disabled = true;
  try {
    const data = await invoke('list_outdated');
    const outdated = [
      ...(data.casks || []).map(c => ({ kind: 'cask', token: c.name || c.token, current: c.installed_versions || c.current_version, latest: c.current_version || c.latest })),
      ...(data.formulae || []).map(f => ({ kind: 'formula', token: f.name, current: (f.installed_versions || []).join(', '), latest: f.current_version })),
    ];
    els.updatesList.innerHTML = '';
    els.updatesList.removeAttribute('aria-busy');
    if (outdated.length === 0) {
      els.updatesEmpty.hidden = false;
      return;
    }
    els.upgradeAllBtn.disabled = state.busy;
    const frag = document.createDocumentFragment();
    for (const o of outdated) {
      const entry = state.byKey.get(keyOf(o.kind, o.token)) || {
        kind: o.kind,
        token: o.token,
        name: o.token,
        desc: `${o.current || '?'} → ${o.latest || '?'}`,
        homepage: '',
      };
      frag.appendChild(buildTile({ ...entry, desc: `${o.current || '?'} → ${o.latest || '?'}` }, { showRowActions: true }));
    }
    els.updatesList.appendChild(frag);
  } catch (err) {
    els.updatesList.innerHTML = `<p class="hint">Couldn't check for updates: ${escapeHtml(String(err))}</p>`;
  }
}

// ---- Log panel + running brew ops ----

function showLog(title) {
  els.logTitle.textContent = title;
  els.logOutput.textContent = '';
  els.logClose.hidden = true;
  els.logToggle.hidden = false;
  els.logSpinner.hidden = false;
  els.logPanel.classList.add('collapsed');
  els.logToggle.textContent = 'Show log';
  els.logPanel.hidden = false;
}

function appendLog(line, stream = 'stdout') {
  const span = document.createElement('span');
  if (stream === 'stderr') span.className = 'line-err';
  if (stream === 'info') span.className = 'line-info';
  span.textContent = line + '\n';
  els.logOutput.appendChild(span);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function finishLog(summary) {
  appendLog('');
  appendLog(summary, 'info');
  els.logTitle.textContent = summary;
  els.logSpinner.hidden = true;
  els.logClose.hidden = false;
}

function toggleLog() {
  const expanded = !els.logPanel.classList.toggle('collapsed');
  els.logToggle.textContent = expanded ? 'Hide log' : 'Show log';
}

let logUnlisten = null;

async function runOp(command, packages, title) {
  if (!invoke || !listen) {
    alert('This action only works in the desktop app.');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  updateSelectionBar();
  els.upgradeAllBtn.disabled = true;
  showLog(title);
  const eventName = `brew-log-${Date.now()}`;
  try {
    logUnlisten = await listen(eventName, ({ payload }) => {
      appendLog(payload.line, payload.stream);
    });
    const results = command === 'upgrade_all'
      ? [await invoke(command, { event: eventName })]
      : await invoke(command, { packages, event: eventName });
    const failed = Array.isArray(results)
      ? results.filter(r => r && r.success === false).map(r => r.package?.token).filter(Boolean)
      : [];
    if (failed.length) {
      finishLog(`Done — ${failed.length} package${failed.length === 1 ? '' : 's'} failed: ${failed.join(', ')}`);
    } else {
      finishLog('Done.');
    }
  } catch (err) {
    appendLog(String(err), 'stderr');
    finishLog('Failed.');
  } finally {
    if (logUnlisten) { logUnlisten(); logUnlisten = null; }
    state.busy = false;
    updateSelectionBar();
    refreshInstalled();
    refreshUpdates();
  }
}

async function installSelected() {
  const packages = selectionToPackages(state.selected);
  if (!packages.length) return;
  await runOp('install_packages', packages, `Installing ${packages.length} app${packages.length === 1 ? '' : 's'}`);
  clearSelection();
}

// ---- Tabs ----

function switchTab(name) {
  for (const tab of els.tabs) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const [key, panel] of Object.entries(els.panels)) {
    const on = key === name;
    panel.classList.toggle('is-active', on);
    panel.hidden = !on;
  }
  if (name === 'installed') refreshInstalled();
  if (name === 'updates') refreshUpdates();
}

// ---- Wire-up ----

els.searchInput.addEventListener('input', (e) => renderSearch(e.target.value));
els.installBtn.addEventListener('click', installSelected);
els.clearBtn.addEventListener('click', clearSelection);
els.upgradeAllBtn.addEventListener('click', () => runOp('upgrade_all', null, 'Updating everything'));
els.logClose.addEventListener('click', (e) => {
  e.stopPropagation();
  els.logPanel.hidden = true;
  els.logPanel.classList.add('collapsed');
});
els.logToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleLog(); });
els.logHeader.addEventListener('click', toggleLog);
for (const tab of els.tabs) tab.addEventListener('click', () => switchTab(tab.dataset.tab));

(async function init() {
  if (invoke) {
    try {
      const ok = await invoke('brew_installed');
      els.warning.hidden = !!ok;
    } catch {
      els.warning.hidden = false;
    }
  } else {
    els.warning.hidden = false;
    els.warning.querySelector('strong').textContent = 'Running outside the desktop app.';
    els.warning.querySelector('p').textContent = 'Install actions are disabled. Open this in Macnite Desktop to actually install apps.';
    els.installBtn.title = 'Only available in the desktop app';
  }

  try {
    const data = await loadCatalogs();
    const { index, byKey } = buildIndex(data);
    state.index = index;
    state.byKey = byKey;
    renderPopular();
    updateSelectionBar();
    if (invoke) refreshInstalled();
  } catch (err) {
    els.popularGrid.innerHTML = `<p class="loading">Couldn't load the Homebrew catalog (${escapeHtml(err.message)}). Check your connection and reopen Macnite.</p>`;
  }
})();
