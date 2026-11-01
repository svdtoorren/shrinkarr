// Shrinkarr web UI (no build step): library, detail panel, queue, history, login and routing.
import {
  $, $$, esc, store, t, lang, bytes, dur, num, savePct, when, clock, collate, I, icon, api, post, put, toast,
  events, stage, presetLabel,
} from './util.js';
import { renderSettings } from './settings.js';
import { renderWizard } from './wizard.js';

const posterOf = (kind, id) => `/api/cover/${kind === 'movie' ? 'radarr' : 'sonarr'}/${id}/poster`;

export const S = {
  route: 'library',
  lib: null,
  preset: store.get('preset', null),
  f: { q: '', type: 'all', show: 'todo', sort: 'savings', root: 'all', ...store.get('filters', {}) },
  selecting: false,
  selected: new Set(),
  jobs: null,
  detail: null,
  doneCount: null,
  setupDone: true,
  auth: { enabled: false, loggedIn: true },
};

// --- static texts in index.html -------------------------------------------------
export function applyStaticTexts() {
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
  applyTheme();
}

// --- theme --------------------------------------------------------------------------
function applyTheme() {
  const th = store.get('theme', 'auto');
  if (th === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  $('#theme-btn').innerHTML = th === 'light' ? I.sun : th === 'dark' ? I.moon : I.auto;
  $('#theme-btn').title = t('theme.' + th);
  $('#theme-btn').setAttribute('aria-label', t('theme.' + th));
}
$('#theme-btn').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  store.set('theme', order[(order.indexOf(store.get('theme', 'auto')) + 1) % 3]);
  applyTheme();
});
$('#logout-btn').addEventListener('click', async () => {
  await post('/api/auth/logout');
  location.reload();
});

// --- routing --------------------------------------------------------------------------
const ROUTES = { queue: 'queue', wachtrij: 'queue', history: 'history', geschiedenis: 'history',
  settings: 'settings', instellingen: 'settings', setup: 'setup' };
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'item') return { route: 'library', item: { kind: parts[1], id: +parts[2] } };
  return { route: ROUTES[parts[0]] || 'library' };
}
export async function route(force = false) {
  let { route: r, item } = parseHash();
  if (!S.setupDone && r !== 'setup') { location.hash = '#/setup'; return; }
  const changed = force || r !== S.route || !$('#view').dataset.route;
  S.route = r;
  document.body.classList.toggle('setup-mode', r === 'setup');
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  if (changed) {
    $('#view').dataset.route = r;
    if (r !== 'library') { S.selecting = false; S.selected.clear(); updateSelectionBar(); }
    const views = { library: renderLibrary, queue: renderQueue, history: renderHistory,
      settings: () => renderSettings(S), setup: () => renderWizard(S) };
    await views[r]();
    window.scrollTo(0, 0);
  }
  if (item) openDetail(item.kind, item.id); else closeDrawer(false);
}
window.addEventListener('hashchange', () => route());

// ==========================================================================
// Library
// ==========================================================================
export async function loadLibrary() {
  S.lib = await api('/api/library' + (S.preset ? `?preset=${S.preset}` : ''));
  if (!S.preset) S.preset = S.lib.preset;
}

async function renderLibrary() {
  const v = $('#view');
  if (!S.lib) {
    v.innerHTML = `<div class="empty"><div class="spinner"></div><p>${t('lib.loading')}</p></div>`;
    try { await loadLibrary(); } catch (e) { v.innerHTML = `<div class="empty">${t('lib.loadFailed', { err: esc(e.message) })}</div>`; return; }
  }
  if (!S.lib.configured) {
    v.innerHTML = `<div class="empty">${I.film}<p>${t('lib.notConfigured')}</p><a class="btn primary" href="#/setup">${t('lib.openSetup')}</a></div>`;
    return;
  }
  const f = S.f;
  v.innerHTML = `
    ${S.lib.error ? `<div class="banner warn">${esc(S.lib.error)}</div>` : ''}
    ${S.lib.roots.some((r) => !r.writable) ? `<div class="banner warn">${t('lib.readOnly', { list: S.lib.roots.filter((r) => !r.writable).map((r) => esc(r.label)).join(', ') })}</div>` : ''}
    <div class="lib-head">
      <section class="ringcard" id="lib-stats" aria-label="${t('lib.storage')}"></section>
      <div class="lib-controls">
        <div class="lib-search">
          <label class="field">${I.search}<input id="q" type="search" placeholder="${t('lib.search')}" aria-label="${t('lib.searchLabel')}" value="${esc(f.q)}" autocomplete="off"></label>
          <button class="icon-btn lg ${S.selecting ? 'on' : ''}" id="select-btn" aria-label="${t('lib.select')}" title="${t('lib.select')}">${I.select}</button>
          <button class="icon-btn lg" id="refresh-btn" aria-label="${t('lib.refresh')}" title="${t('lib.refreshTitle')}">${I.refresh}</button>
        </div>
        <div class="seg seg-full" id="type-seg">
          ${[['all', t('lib.all')], ['movie', t('lib.movies')], ['series', t('lib.series')]].map(([k, l]) => `<button data-v="${k}" class="${f.type === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <div class="chips" id="chips"></div>
      </div>
    </div>
    <div class="grid ${S.selecting ? 'selecting' : ''}" id="grid"></div>`;
  if (f.root !== 'all' && !S.lib.roots.some((r) => r.path === f.root)) f.root = 'all';
  renderChips();

  let tm;
  $('#q').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; saveFilters(); updateGrid(); }, 120); });
  $('#type-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    f.type = b.dataset.v; $$('#type-seg button').forEach((x) => x.classList.toggle('on', x === b)); saveFilters(); updateGrid();
  });
  $('#chips').addEventListener('change', async (e) => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'preset') {
      S.preset = e.target.value; store.set('preset', S.preset); renderChips(); await loadLibrary(); updateGrid(); return;
    }
    f[k] = e.target.value; saveFilters(); renderChips(); updateGrid();
  });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-x'); if (!b) return;
    f[b.dataset.k] = 'all'; saveFilters(); renderChips(); updateGrid();
  });
  $('#select-btn').addEventListener('click', () => {
    S.selecting = !S.selecting; if (!S.selecting) S.selected.clear();
    $('#select-btn').classList.toggle('on', S.selecting); $('#grid').classList.toggle('selecting', S.selecting);
    $$('.tile.selected').forEach((x) => x.classList.remove('selected')); updateSelectionBar();
  });
  $('#refresh-btn').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.innerHTML = '<span class="spinner"></span>'; b.disabled = true;
    try { await post('/api/library/refresh'); await loadLibrary(); updateGrid(); toast(t('lib.refreshed'), 'good'); }
    catch (err) { toast(err.message, 'bad'); }
    b.innerHTML = I.refresh; b.disabled = false;
  });
  $('#grid').addEventListener('click', onTileClick);
  $('#grid').addEventListener('keydown', (e) => { if (e.key === 'Enter') onTileClick(e); });
  updateGrid();
}
function saveFilters() { store.set('filters', S.f); }

function filtered() {
  const f = S.f, q = f.q.trim().toLowerCase();
  const items = S.lib.items.filter((i) =>
    (f.type === 'all' || i.kind === f.type)
    && (f.root === 'all' || i.root === f.root)
    && (!q || i.title.toLowerCase().includes(q))
    && (f.show === 'all' || (f.show === 'todo' && i.convertible > 0) || (f.show === 'efficient' && i.convertible === 0)
      || (f.show === 'queued' && i.queued > 0) || (f.show === 'dts' && i.dts > 0)));
  const sv = (i) => i.size - i.estSize;
  const sorters = {
    savings: (a, b) => sv(b) - sv(a),
    size: (a, b) => b.size - a.size,
    pct: (a, b) => sv(b) / b.size - sv(a) / a.size,
    quick: (a, b) => sv(b) / (b.estSeconds || 1e9) - sv(a) / (a.estSeconds || 1e9),
    name: (a, b) => collate(a.sortTitle, b.sortTitle),
  };
  return items.sort(sorters[f.sort] || sorters.savings);
}

function rootOptions() {
  const roots = S.lib.roots || [];
  const dup = (l) => roots.filter((r) => r.label === l).length > 1;
  return roots.map((r) => [r.path, dup(r.label) ? `${r.label} (${r.app === 'radarr' ? 'Radarr' : 'Sonarr'})` : r.label]);
}

function renderChips() {
  const f = S.f;
  const chip = (k, title, opts, value, active) => {
    const cur = (opts.find(([v]) => v === value) || opts[0])[1];
    return `<span class="chip-group ${active ? 'on' : ''}">
      <label class="chip" title="${esc(title)}"><span>${esc(cur)}</span>${I.chevDown}
        <select data-k="${k}" aria-label="${esc(title)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      ${active ? `<button class="chip-x" data-k="${k}" aria-label="${esc(t('chip.remove', { name: title }))}">${I.x}</button>` : ''}</span>`;
  };
  const show = ['todo', 'efficient', 'queued', 'dts', 'all'].map((k) => [k, t('show.' + k)]);
  const sort = ['savings', 'size', 'pct', 'quick', 'name'].map((k) => [k, t('sort.' + k)]);
  $('#chips').innerHTML = [
    chip('show', t('chip.show'), show, f.show, f.show !== 'all'),
    chip('sort', t('chip.sort'), sort, f.sort, false),
    rootOptions().length > 1 ? chip('root', t('chip.folder'), [['all', t('chip.allFolders')], ...rootOptions()], f.root, f.root !== 'all') : '',
    chip('preset', t('chip.preset'), ['high', 'balanced', 'max'].map((k) => [k, presetLabel(k)]), S.preset, false),
  ].join('');
}

function donut(parts) {
  // parts: [{frac, color}] around the ring, starting at the top
  const C = 2 * Math.PI * 48;
  let off = 0;
  const arcs = parts.map((p) => {
    const len = Math.max(0, p.frac * C);
    const draw = len > 4 ? len - 2 : len;
    const a = len > 0 ? `<circle cx="60" cy="60" r="48" fill="none" stroke="${p.color}" stroke-width="14" stroke-dasharray="${draw.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 60 60)"></circle>` : '';
    off += len;
    return a;
  });
  return `<circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="14"></circle>${arcs.join('')}`;
}

function updateStats() {
  if (!$('#lib-stats')) return;
  const all = S.lib.items;
  const size = all.reduce((s, i) => s + i.size, 0);
  const conv = all.filter((i) => i.convertible > 0);
  const est = all.reduce((s, i) => s + i.estSize, 0);
  const secs = conv.reduce((s, i) => s + i.estSeconds, 0);
  const saved = S.jobs?.totals?.saved || 0;
  const todo = Math.max(0, size - est);
  const orig = size + saved || 1;
  const pct = savePct(size, est);
  const movies = all.filter((i) => i.kind === 'movie').length, series = all.length - movies;
  const p = (x) => Math.round((x / orig) * 100);
  $('#lib-stats').innerHTML = `
    <div class="ring-row">
      <div class="donut">
        <svg width="120" height="120" viewBox="0 0 120 120" role="img"
          aria-label="${esc(t('ring.aria', { total: bytes(orig), saved: p(saved), todo: p(todo), rest: p(est) }))}">
          ${donut([{ frac: saved / orig, color: '#86efac' }, { frac: todo / orig, color: '#ffffff' }, { frac: est / orig, color: 'rgba(255,255,255,0.32)' }])}
        </svg>
        <div class="mid"><span class="pct num">${pct}%</span><span class="lbl">${t('ring.toGain')}</span></div>
      </div>
      <div class="ring-nums">
        <div><div class="legend"><i style="background:#fff"></i>${t('ring.toSave')}</div><div class="big num">~${bytes(todo)}</div></div>
        <div class="ring-pair">
          <div><div class="legend"><i style="background:#86efac"></i>${t('ring.saved')}</div><div class="val num">${bytes(saved)}</div></div>
          <div><div class="legend"><i style="background:rgba(255,255,255,.45)"></i>${t('ring.remains')}</div><div class="val num">~${bytes(est)}</div></div>
        </div>
      </div>
    </div>
    <div class="ring-strip">
      <div title="${esc(t('ring.counts', { movies, series }))}"><div class="l">${t('ring.library')}</div><div class="v num">${bytes(size)}</div></div>
      <div><div class="l">${t('ring.time')}</div><div class="v num">~${dur(secs)}</div></div>
      <div><div class="l">${t('ring.todo')}</div><div class="v num">${t('ring.titles', { n: conv.length })}</div></div>
    </div>`;
}

function tileHtml(i) {
  const savings = i.size - i.estSize;
  const pct = savePct(i.size, i.estSize);
  const eff = i.convertible === 0;
  const isHevc = ['HEVC', 'AV1', 'VP9'].includes(i.codec);
  const sub = i.kind === 'movie' ? `${i.year || ''}${i.rootLabel ? ' · ' + esc(i.rootLabel) : ''}` : `${i.year || ''} · ${t('tile.eps', { n: i.fileCount })}`;
  let foot;
  if (eff) foot = i.saved ? `<span class="good">✓ ${t('tile.saved', { size: bytes(i.saved) })}</span>` : `<span>${t('tile.efficient')}</span>`;
  else foot = `<span class="good num">−${bytes(savings)}</span><span class="num">~${dur(i.estSeconds)}</span>`;
  const partial = !eff && i.kind === 'series' && i.convertible < i.fileCount ? ` · ${t('tile.todo', { n: i.convertible })}` : '';
  return `<div class="tile ${eff ? 'dim' : ''} ${S.selected.has(i.key) ? 'selected' : ''}" data-key="${i.key}" tabindex="0">
    <div class="poster">
      <div class="ph">${esc(i.title)}</div>
      ${i.poster ? `<img loading="lazy" src="${i.poster}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}
      <div class="tags"><span class="badge ${isHevc ? 'hevc' : ''}">${esc(i.codec)}</span><span class="badge">${esc(i.resolution)}</span></div>
      <div class="shade"><span class="num">${bytes(i.size)}</span>${eff ? '' : `<span class="num">−${pct}%</span>`}</div>
      <div class="check">${I.check}</div>
      <div class="ov-slot">${overlayHtml(i.key)}</div>
    </div>
    <div class="meta">
      <div class="title">${esc(i.title)}</div>
      <div class="sub">${sub}${partial}</div>
      ${eff ? '' : `<div class="sizes num"><span>${bytes(i.size)}</span><span class="arrow">→</span><span class="good">~${bytes(i.estSize)}</span></div>
      <div class="savebar"><i style="width:${Math.max(3, 100 - pct)}%"></i></div>`}
      <div class="foot">${foot}</div>
    </div>
  </div>`;
}

const jobKey = (j) => `${j.kind === 'movie' ? 'movie' : 'series'}:${j.arr_id}`;
function overlayHtml(key) {
  const mine = (S.jobs?.queue || []).filter((j) => jobKey(j) === key);
  if (!mine.length) return '';
  const run = mine.find((j) => j.status === 'running');
  if (run) {
    const p = Math.round((run.progress || 0) * 100), c = 2 * Math.PI * 27;
    return `<div class="overlay"><div><div class="ring"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27"/>
      <circle class="fg" cx="32" cy="32" r="27" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - (run.progress || 0))}"/></svg>${p}%</div>
      <div style="margin-top:6px">${esc(stage(run.stage))}</div></div></div>`;
  }
  return `<div class="overlay"><div>${icon('clock', 22)}<div>${t('tile.queued')}${mine.length > 1 ? ` (${mine.length})` : ''}</div></div></div>`;
}

export function updateGrid() {
  if (!$('#grid')) return;
  updateStats();
  const items = filtered();
  $('#grid').innerHTML = items.length ? items.map(tileHtml).join('')
    : `<div class="empty" style="grid-column:1/-1">${I.film}<p>${t('lib.nothing')}</p></div>`;
}
function updateOverlays() {
  $$('#grid .tile').forEach((el) => {
    const html = overlayHtml(el.dataset.key), slot = $('.ov-slot', el);
    if (slot.dataset.h !== html) { slot.innerHTML = html; slot.dataset.h = html; }
  });
}

function onTileClick(e) {
  const el = e.target.closest('.tile'); if (!el) return;
  const key = el.dataset.key;
  if (S.selecting) {
    const item = S.lib.items.find((i) => i.key === key);
    if (!item || item.convertible === 0) { toast(t('lib.alreadyEfficient')); return; }
    if (S.selected.has(key)) S.selected.delete(key); else S.selected.add(key);
    el.classList.toggle('selected', S.selected.has(key));
    updateSelectionBar();
    return;
  }
  const [kind, id] = key.split(':');
  location.hash = `#/item/${kind}/${id}`;
}

function updateSelectionBar() {
  const bar = $('#selection-bar');
  if (!S.selecting) { bar.hidden = true; return; }
  const items = S.lib.items.filter((i) => S.selected.has(i.key));
  const size = items.reduce((s, i) => s + i.size, 0), est = items.reduce((s, i) => s + i.estSize, 0);
  const secs = items.reduce((s, i) => s + i.estSeconds, 0);
  bar.hidden = false;
  bar.innerHTML = `
    <div class="info">${items.length ? `${t('sel.count', { n: items.length })} · <span class="num">${bytes(size)} → ~${bytes(est)}</span>
      · <span class="good num">−${bytes(size - est)}</span> · <span class="num">~${dur(secs)}</span>` : t('sel.hint')}</div>
    <button class="btn sm ghost" id="sel-all">${t('sel.allVisible')}</button>
    <button class="btn sm ghost" id="sel-none">${t('common.cancel')}</button>
    <button class="btn grad" id="sel-go" ${items.length ? '' : 'disabled'}>${I.shrink}${t('common.shrink')}</button>`;
  $('#sel-all').onclick = () => {
    filtered().filter((i) => i.convertible > 0).forEach((i) => S.selected.add(i.key));
    $$('#grid .tile').forEach((el) => el.classList.toggle('selected', S.selected.has(el.dataset.key))); updateSelectionBar();
  };
  $('#sel-none').onclick = () => $('#select-btn').click();
  $('#sel-go').onclick = async () => {
    try {
      const r = await post('/api/jobs', { items: items.map((i) => ({ kind: i.kind, id: i.id })), preset: S.preset });
      toast(t('toast.added', { n: r.added }), 'good');
      if (r.readOnly) toast(t('toast.readOnly', { n: r.readOnly }), 'bad');
      $('#select-btn').click();
      await pollJobs(); updateGrid();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ==========================================================================
// Detail panel
// ==========================================================================
async function openDetail(kind, id, preset) {
  const drawer = $('#drawer');
  const same = S.detail && S.detail.kind === kind && S.detail.id === id;
  if (!same) {
    drawer.innerHTML = `<div class="empty" style="padding-top:120px"><div class="spinner"></div></div>`;
    S.detail = { kind, id, data: null, sel: null };
  }
  drawer.hidden = false; $('#drawer-backdrop').hidden = false; document.body.style.overflow = 'hidden';
  try {
    const d = await api(`/api/item/${kind}/${id}?preset=${preset || S.preset || ''}`);
    if (!S.detail || S.detail.id !== id) return;
    const prevSel = S.detail.sel;
    S.detail.data = d;
    S.detail.sel = prevSel || new Set(d.files.filter((f) => f.convertible && !f.job).map((f) => f.fileId));
    renderDetail();
  } catch (e) {
    drawer.innerHTML = `<button class="icon-btn close-btn" id="close-btn" aria-label="${t('common.close')}">${I.x}</button><div class="empty">${esc(e.message)}</div>`;
    $('#close-btn').onclick = () => closeDrawer();
  }
}
function closeDrawer(nav = true) {
  if ($('#drawer').hidden) return;
  $('#drawer').hidden = true; $('#drawer-backdrop').hidden = true; document.body.style.overflow = '';
  S.detail = null;
  if (nav && location.hash.startsWith('#/item')) location.hash = '#/';
}
$('#drawer-backdrop').addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

function fileDetails(f) {
  const mbps = f.vbr ? num(f.vbr / 1e6, 1) + ' Mbps' : '–';
  return `<dl class="kv">
    <dt>${t('file.file')}</dt><dd>${esc(f.name)}</dd>
    <dt>${t('file.folder')}</dt><dd class="muted">${esc(f.path.replace(/\/[^/]*$/, ''))}</dd>
    <dt>${t('file.video')}</dt><dd>${esc(f.codecLabel)} · ${f.width}×${f.height} · ${f.bitDepth}-bit · ~${mbps}${f.hdr ? ' · ' + esc(f.hdr) : ''}</dd>
    <dt>${t('file.audio')}</dt><dd>${esc(f.audioCodec)} ${f.audioChannels || ''} · ${esc(f.audio || t('file.unknown'))} <span class="muted">(${[f.toEac3 ? t('file.audioEac3') : '', f.dropLangs?.length ? t('file.audioDrop', { list: f.dropLangs.join(', ') }) : ''].filter(Boolean).join('; ') || t('file.audioKept')})</span></dd>
    <dt>${t('file.subs')}</dt><dd>${esc(f.subs || t('file.none'))} <span class="muted">(${t('file.subsKept')})</span></dd>
    <dt>${t('file.duration')}</dt><dd>${dur(f.duration)}</dd>
    <dt>${t('file.quality')}</dt><dd>${esc(f.quality)}</dd>
  </dl>`;
}

const jobBadge = (j) => (j ? `<span class="badge accent" data-job="${j.id}">${jobBadgeInner(j)}</span>` : '');
function jobBadgeInner(j) {
  return j.status === 'running' ? `<span class="spinner" style="width:10px;height:10px;border-width:2px"></span> ${esc(stage(j.stage))} ${Math.round((j.progress || 0) * 100)}%`
    : t('tile.queued');
}
function updateDetailBadges() {
  const q = S.jobs?.queue || [];
  $$('#drawer [data-job]').forEach((el) => {
    const j = q.find((x) => x.id === +el.dataset.job);
    const html = j ? jobBadgeInner(j) : t('status.done');
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  });
}

function renderDetail() {
  const { data: d, sel } = S.detail;
  const conv = d.files.filter((f) => f.convertible);
  const chosen = d.files.filter((f) => sel.has(f.fileId));
  const size = chosen.reduce((s, f) => s + f.size, 0), est = chosen.reduce((s, f) => s + f.estSize, 0);
  const secs = chosen.reduce((s, f) => s + f.estSeconds, 0);
  const pct = savePct(size, est);
  const isSeries = d.kind === 'series';
  const info = [d.year, isSeries ? d.network : null, (d.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  const totalSize = d.files.reduce((s, f) => s + f.size, 0);

  let filesHtml;
  if (!isSeries) {
    const f = d.files[0];
    filesHtml = `<div class="section-title">${t('detail.file')} ${jobBadge(f.job)}</div><div class="card">${fileDetails(f)}</div>`;
  } else {
    const seasons = new Map();
    d.files.forEach((f) => { const k = f.season ?? 0; if (!seasons.has(k)) seasons.set(k, []); seasons.get(k).push(f); });
    filesHtml = `<div class="section-title"><span>${t('detail.episodes')}</span>
      <span><button class="btn sm ghost" id="sel-all-eps">${t('detail.all')}</button><button class="btn sm ghost" id="sel-no-eps">${t('detail.none')}</button></span></div>` +
      [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([s, files]) => {
        const c = files.filter((f) => f.convertible && !f.job);
        const allOn = c.length && c.every((f) => sel.has(f.fileId));
        const sz = files.reduce((a, f) => a + f.size, 0);
        return `<details class="card season" ${seasons.size === 1 ? 'open' : ''}>
          <summary>${I.chev.replace('<svg', '<svg class="chev"')}
            <input type="checkbox" class="cb" data-season="${s}" ${allOn ? 'checked' : ''} ${c.length ? '' : 'disabled'} onclick="event.stopPropagation()" aria-label="${s === 0 ? t('detail.specials') : t('detail.season', { n: s })}">
            ${s === 0 ? t('detail.specials') : t('detail.season', { n: s })}
            <span class="right num">${t('tile.eps', { n: files.length })} · ${bytes(sz)}${c.length ? '' : ' · ' + t('tile.efficient').toLowerCase()}</span></summary>
          <div class="files">${files.map((f) => `
            <label class="file">
              <input type="checkbox" class="cb" data-file="${f.fileId}" ${sel.has(f.fileId) ? 'checked' : ''} ${f.convertible && !f.job ? '' : 'disabled'}>
              <div style="min-width:0"><div class="name">${esc(f.label)}</div>
                <div class="det"><span class="badge ${f.convertible ? '' : 'good'}">${esc(f.codecLabel)}</span>${esc(f.bucket)} ${jobBadge(f.job)}</div></div>
              <div class="sz num">${bytes(f.size)}${f.convertible ? `<br><span class="est">~${bytes(f.estSize)}</span>` : ''}</div>
            </label>`).join('')}</div>
        </details>`;
      }).join('');
  }

  const hist = d.history?.length ? `<div class="section-title">${t('detail.history')}</div><div class="card">${d.history.map((h) => `
    <div class="hrow"><div><div class="t">${esc(h.subtitle || d.title)}</div><div class="s">${esc(h.message || '')} · ${when(h.finished)}</div></div>
    <div class="r">${h.status === 'done' ? `<span class="num">${bytes(h.size_before)} → ${bytes(h.size_after)}</span>` : statusBadge(h.status)}</div></div>`).join('')}</div>` : '';

  $('#drawer').innerHTML = `
    <button class="icon-btn close-btn" id="close-btn" aria-label="${t('common.close')}">${I.x}</button>
    <div class="hero" style="${d.fanart ? `background-image:url('${d.fanart}')` : ''}">
      ${d.poster ? `<img class="poster-sm" src="${d.poster}" alt="">` : ''}
      <div><h2>${esc(d.title)}</h2><div class="info">${esc(info)}</div>
        <div class="chips"><span class="badge">${esc(d.codec)}</span><span class="badge">${esc(d.resolution)}</span>
          <span class="badge">${bytes(totalSize)}</span>${isSeries ? `<span class="badge">${t('detail.episodesN', { n: d.fileCount })}</span>` : ''}
          ${d.saved ? `<span class="badge">✓ ${t('tile.saved', { size: bytes(d.saved) })}</span>` : ''}</div></div>
    </div>
    <div class="drawer-body">
      ${d.overview ? `<p class="overview" onclick="this.classList.toggle('open')">${esc(d.overview)}</p>` : ''}
      ${conv.length ? `
      <div class="card estimate">
        <div class="row"><b>${isSeries ? t('detail.estimateN', { n: chosen.length }) : t('detail.estimate')}</b>
          <div class="seg" id="d-preset">${['high', 'balanced', 'max'].map((k) => `<button data-v="${k}" class="${d.preset === k ? 'on' : ''}">${presetLabel(k)}</button>`).join('')}</div></div>
        <div class="big">
          <div><div class="label">${t('detail.now')}</div><div class="value num">${bytes(size)}</div></div>
          <div><div class="label">${t('detail.after')}</div><div class="value num good">~${bytes(est)}</div></div>
          <div><div class="label">${t('detail.saving')}</div><div class="value num">${pct}%</div></div>
          <div><div class="label">${t('detail.time')}</div><div class="value num">~${dur(secs)}</div></div>
        </div>
        <div class="compare"><i style="width:${size ? Math.max(2, (est / size) * 100) : 0}%"></i></div>
        <div class="note">${d.sampled ? `${icon('flask', 15)} ${t('detail.sampled')}` : (S.lib?.learned ? t('detail.roughLearned') : t('detail.rough'))}</div>
        <div class="actions">
          <button class="btn grad lg" id="go-btn" ${chosen.length ? '' : 'disabled'}>${I.shrink} ${t('common.shrink')}${isSeries ? ` (${chosen.length})` : ''}</button>
          <button class="btn lg" id="sample-btn" title="${t('detail.sampleTitle')}">${I.flask} ${t('detail.sample')}</button>
        </div>
      </div>` : `<div class="banner info">${icon('check', 18)} ${isSeries ? t('detail.allEfficientSeries') : t('detail.allEfficientMovie')}</div>`}
      ${filesHtml}
      ${hist}
    </div>`;

  $('#close-btn').onclick = () => closeDrawer();
  $('#d-preset')?.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    openDetail(d.kind, d.id, b.dataset.v);
  });
  $('#go-btn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await post('/api/jobs', { items: [{ kind: d.kind, id: d.id, fileIds: [...sel] }], preset: d.preset });
      toast(t('toast.added', { n: r.added }), 'good');
      if (r.readOnly) toast(t('toast.readOnly', { n: r.readOnly }), 'bad');
      S.detail.sel = null;
      await pollJobs();
      openDetail(d.kind, d.id, d.preset);
      loadLibrary().then(updateGrid);
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#sample-btn')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = `<span class="spinner"></span> ${t('detail.sampling')}`;
    try {
      const nd = await post('/api/estimate', { kind: d.kind, id: d.id, preset: d.preset });
      if (S.detail?.id === d.id) { S.detail.data = nd; renderDetail(); }
      loadLibrary().then(updateGrid);
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; b.innerHTML = `${I.flask} ${t('detail.sample')}`; }
  });
  $$('#drawer input[data-file]').forEach((cb) => cb.addEventListener('change', () => {
    const id = +cb.dataset.file; if (cb.checked) sel.add(id); else sel.delete(id); renderDetailKeepScroll();
  }));
  $$('#drawer input[data-season]').forEach((cb) => cb.addEventListener('change', () => {
    const s = +cb.dataset.season;
    d.files.filter((f) => (f.season ?? 0) === s && f.convertible && !f.job).forEach((f) => (cb.checked ? sel.add(f.fileId) : sel.delete(f.fileId)));
    renderDetailKeepScroll();
  }));
  $('#sel-all-eps')?.addEventListener('click', () => { d.files.filter((f) => f.convertible && !f.job).forEach((f) => sel.add(f.fileId)); renderDetailKeepScroll(); });
  $('#sel-no-eps')?.addEventListener('click', () => { sel.clear(); renderDetailKeepScroll(); });
}
function renderDetailKeepScroll() {
  const dr = $('#drawer'), top = dr.scrollTop;
  const open = $$('details.season', dr).map((x) => x.open);
  renderDetail();
  $$('details.season', dr).forEach((x, i) => { if (open[i] != null) x.open = open[i]; });
  dr.scrollTop = top;
}

// ==========================================================================
// Queue
// ==========================================================================
const autoBadge = (j) => (j.source === 'auto' ? `<span class="badge">${t('queue.auto')}</span>` : '');
function autoWhen(j) {
  if (j.source !== 'auto' || j.status !== 'queued') return '';
  const nb = j.not_before && j.not_before * 1000 > Date.now() ? ' · ' + t('queue.notBefore', { time: clock(j.not_before) }) : '';
  return ' · ' + t('queue.inWindow') + nb;
}
export function statusBadge(s) {
  const cls = { done: 'good', failed: 'bad', skipped: 'warn', cancelled: '', reverted: '', queued: 'accent', running: 'accent' }[s] ?? '';
  return `<span class="badge ${cls}">${t('status.' + s)}</span>`;
}

async function renderQueue() {
  $('#view').innerHTML = `<div id="q-root"><div class="empty"><div class="spinner"></div></div></div>`;
  await pollJobs();
}

function drawQueue() {
  const root = $('#q-root'); if (!root || !S.jobs) return;
  const J = S.jobs, run = J.queue.find((j) => j.status === 'running'), waiting = J.queue.filter((j) => j.status === 'queued');
  const remaining = (run ? run.eta || 0 : 0) + waiting.reduce((s, j) => s + (j.est_seconds || 0), 0);
  const sig = JSON.stringify([J.paused, J.state, run?.id, run?.stage, waiting.map((j) => j.id), lang()]);
  if (root.dataset.sig !== sig) {
    root.dataset.sig = sig;
    root.innerHTML = `
      <div class="toolbar">
        <div><h1 class="page">${t('nav.queue')}</h1><p class="page-sub" style="margin:0" id="q-sub"></p></div>
        <div class="spacer"></div>
        ${J.paused ? `<button class="btn primary" id="resume-btn">${I.play} ${t('queue.resume')}</button>`
          : `<button class="btn" id="pause-btn">${I.pause} ${t('queue.pause')}</button>`}
      </div>
      ${J.paused ? `<div class="banner warn">${icon('pause', 18)} ${t('queue.paused')}</div>` : ''}
      ${!J.paused && J.state === 'waiting_auto' ? `<div class="banner info">${icon('clock', 18)} ${t('queue.onlyAuto', { window: esc(J.autoWindow) })}
        <a class="btn sm" href="#/settings">${t('nav.settings')}</a></div>` : ''}
      ${!J.paused && J.state === 'waiting' ? `<div class="banner info">${icon('clock', 18)} ${t('queue.waiting', { window: esc(J.window) })}
        <a class="btn sm" href="#/settings">${t('nav.settings')}</a></div>` : ''}
      ${run ? `<div class="card current" id="cur">
        <img class="poster-sm" src="${posterOf(run.kind, run.arr_id)}" alt="" onerror="this.style.visibility='hidden'">
        <div style="min-width:0">
          <h3>${esc(run.title)} ${autoBadge(run)}</h3><div class="muted">${esc(run.subtitle)}</div>
          <div class="stage"><span class="spinner" style="width:13px;height:13px"></span><span id="cur-stage"></span></div>
          <div class="pbar"><i id="cur-bar" style="width:0%"></i></div>
          <div class="metrics">
            <div class="metric"><div class="label">${t('queue.progress')}</div><div class="value num" id="m-pct"></div></div>
            <div class="metric"><div class="label">${t('queue.speed')}</div><div class="value num" id="m-speed"></div></div>
            <div class="metric"><div class="label">${t('queue.remaining')}</div><div class="value num" id="m-eta"></div></div>
            <div class="metric"><div class="label">${t('queue.original')}</div><div class="value num">${bytes(run.size_before)}</div></div>
            <div class="metric"><div class="label">${t('queue.written')}</div><div class="value num" id="m-cur"></div></div>
            <div class="metric"><div class="label">${t('queue.expected')}</div><div class="value num good" id="m-est"></div></div>
          </div>
          <div class="actions"><button class="btn sm danger" data-cancel="${run.id}">${I.x} ${t('common.cancel')}</button></div>
        </div></div>` : ''}
      ${waiting.length ? `<div class="section-title">${t('queue.next', { n: waiting.length })}</div>
        <div class="card qlist">${waiting.map((j, n) => `
          <div class="qrow"><div class="pos">${n + 1}</div>
            <img src="${posterOf(j.kind, j.arr_id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <div style="min-width:0"><div class="t">${esc(j.title)} ${autoBadge(j)}</div><div class="s">${esc(j.subtitle)} · ${presetLabel(j.preset)}${autoWhen(j)}</div></div>
            <div class="r num">${bytes(j.size_before)} → <span class="good">~${bytes(j.est_size)}</span><br><span class="muted">~${dur(j.est_seconds)}</span></div>
            <div class="btns">${n ? `<button class="btn sm ghost" data-top="${j.id}" title="${t('queue.top')}" aria-label="${t('queue.top')}">${I.up}</button>` : ''}
              <button class="btn sm ghost" data-cancel="${j.id}" title="${t('queue.remove')}" aria-label="${t('queue.remove')}">${I.trash}</button></div>
          </div>`).join('')}</div>` : ''}
      ${!run && !waiting.length ? `<div class="empty">${I.inbox}<p>${t('queue.empty')}</p></div>` : ''}`;
    root.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.id === 'pause-btn' || b.id === 'resume-btn') await put('/api/settings', { paused: b.id === 'pause-btn' });
        else if (b.dataset.cancel) {
          if (b.closest('#cur') && !confirm(t('queue.confirmCancel'))) return;
          await api('/api/jobs/' + b.dataset.cancel, { method: 'DELETE' });
        } else if (b.dataset.top) await post(`/api/jobs/${b.dataset.top}/top`);
        await pollJobs();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }
  const toSave = waiting.reduce((s, j) => s + (j.size_before - (j.est_size || j.size_before)), 0) + (run ? run.size_before - (run.est_size || run.size_before) : 0);
  $('#q-sub').textContent = J.queue.length ? t('queue.summary', { files: t('queue.files', { n: J.queue.length }), time: dur(remaining), size: bytes(toSave) }) : t('queue.nothing');
  if (run) {
    const p = (run.progress || 0) * 100;
    const converting = run.stage === 'encode' || run.stage === 'encode_sw';
    $('#cur-stage').textContent = stage(run.stage);
    $('#cur-bar').style.width = p.toFixed(1) + '%';
    $('#m-pct').textContent = num(p, 1) + '%';
    $('#m-speed').textContent = converting && run.speed ? `${num(run.speed, 1)}× · ${num(run.fps)} fps` : '–';
    $('#m-eta').textContent = converting && run.eta != null ? dur(run.eta) : '–';
    $('#m-cur').textContent = run.cur_size ? bytes(run.cur_size) : '–';
    // Expected final size: what is written so far, projected to 100% (once enough is encoded)
    const proj = converting && run.progress > 0.08 && run.cur_size ? run.cur_size / run.progress : run.est_size;
    $('#m-est').textContent = '~' + bytes(proj);
  }
}

// ==========================================================================
// History
// ==========================================================================
async function renderHistory() {
  $('#view').innerHTML = `<div id="h-root"><div class="empty"><div class="spinner"></div></div></div>`;
  await pollJobs();
}
function drawHistory() {
  const root = $('#h-root'); if (!root || !S.jobs) return;
  const J = S.jobs, sig = JSON.stringify([J.recent.map((j) => [j.id, j.status, j.kept_path]), lang()]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  const tt = J.totals;
  root.innerHTML = `
    <div class="toolbar"><div><h1 class="page">${t('nav.history')}</h1></div><div class="spacer"></div>
      <button class="btn ghost" id="clear-btn">${I.trash} ${t('hist.clear')}</button></div>
    <div class="stats">
      <div class="card stat feature"><div class="label">${t('hist.saved')}</div><div class="value num">${bytes(tt.saved)}</div>
        <div class="sub">${tt.before ? t('hist.smaller', { pct: savePct(tt.before, tt.before - tt.saved) }) : '&nbsp;'}</div></div>
      <div class="card stat"><div class="label">${t('hist.converted')}</div><div class="value num">${tt.n}</div><div class="sub">${t('hist.files')}</div></div>
      <div class="card stat"><div class="label">${t('hist.failed')}</div><div class="value num">${tt.failed}</div><div class="sub">${t('hist.kept')}</div></div>
    </div>
    ${J.recent.length ? `<div class="card">${J.recent.map((j) => `
      <div class="hrow">
        <div style="min-width:0"><div class="t">${esc(j.title)} ${statusBadge(j.status)} ${autoBadge(j)}</div>
          <div class="s">${esc(j.subtitle)} · ${when(j.finished)} · ${presetLabel(j.preset)}</div>
          ${j.message ? `<div class="s" style="color:${j.status === 'done' ? 'var(--good)' : j.status === 'failed' ? 'var(--bad)' : 'var(--muted)'}">${esc(j.message)}</div>` : ''}
          ${j.status === 'done' && j.kept_path && j.kept_until * 1000 > Date.now() ? `<div class="s">${t('hist.keptUntil', { date: when(j.kept_until) })}
            <button class="btn sm" data-undo="${j.id}" style="margin-left:6px">${I.retry} ${t('hist.undo')}</button></div>` : ''}</div>
        <div class="r">${j.status === 'done' ? `<span class="num">${bytes(j.size_before)} → <b>${bytes(j.size_after)}</b></span><br><span class="good num">−${bytes(j.size_before - j.size_after)}</span>` : ''}
          <div class="btns" style="margin-top:4px">
            ${j.status !== 'done' ? `<button class="btn sm ghost" data-retry="${j.id}" title="${t('hist.retry')}" aria-label="${t('hist.retry')}">${I.retry}</button>` : ''}
            <button class="btn sm ghost" data-del="${j.id}" title="${t('hist.remove')}" aria-label="${t('hist.remove')}">${I.trash}</button></div></div>
        ${j.status === 'failed' ? `<details data-log="${j.id}"><summary class="s" style="cursor:pointer">${t('hist.log')}</summary><pre>${t('common.loading')}</pre></details>` : ''}
      </div>`).join('')}</div>` : `<div class="empty">${I.inbox}<p>${t('hist.empty')}</p></div>`}`;
  root.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'clear-btn') await post('/api/jobs/clear');
      else if (b.dataset.retry) { await post(`/api/jobs/${b.dataset.retry}/retry`); toast(t('hist.requeued'), 'good'); }
      else if (b.dataset.del) await api('/api/jobs/' + b.dataset.del, { method: 'DELETE' });
      else if (b.dataset.undo) {
        if (!confirm(t('hist.undoConfirm'))) return;
        await post(`/api/jobs/${b.dataset.undo}/undo`); toast(t('hist.undone'), 'good');
        setTimeout(() => loadLibrary(), 25000);
      }
      await pollJobs();
    } catch (err) { toast(err.message, 'bad'); }
  };
  $$('details[data-log]', root).forEach((det) => det.addEventListener('toggle', async () => {
    if (!det.open || det.dataset.loaded) return;
    const j = await api('/api/jobs/' + det.dataset.log);
    $('pre', det).textContent = j.log || t('hist.noLog'); det.dataset.loaded = 1;
  }));
}

// ==========================================================================
// Polling the queue
// ==========================================================================
export async function pollJobs() {
  if (!S.setupDone || !S.auth.loggedIn) return;
  try { S.jobs = await api('/api/jobs'); } catch { return; }
  const J = S.jobs, run = J.queue.find((j) => j.status === 'running');
  const qc = $('#queue-count'); qc.hidden = !J.queue.length; qc.textContent = J.queue.length;
  const mp = $('#mini-progress');
  if (run && S.route !== 'queue') {
    mp.hidden = false;
    mp.innerHTML = `<span class="spinner" style="width:12px;height:12px"></span><span class="txt">${esc(run.title.slice(0, 26))}</span>
      <span class="bar"><i style="width:${(run.progress || 0) * 100}%"></i></span><span class="num">${Math.round((run.progress || 0) * 100)}%</span>`;
    mp.onclick = () => { location.hash = '#/queue'; };
  } else mp.hidden = true;
  if (S.doneCount != null && J.totals.n !== S.doneCount) {
    // Done: Sonarr/Radarr need a moment for the rescan; then reload the library.
    const last = J.recent.find((j) => j.status === 'done');
    if (last) toast(t('toast.saved', { title: last.title, size: bytes(last.size_before - last.size_after) }), 'good');
    setTimeout(() => loadLibrary().then(() => S.route === 'library' && updateGrid()), 25000);
  }
  S.doneCount = J.totals.n;
  if (S.route === 'queue') drawQueue();
  else if (S.route === 'history') drawHistory();
  else if (S.route === 'library' && S.lib) { updateOverlays(); updateStats(); }
  if (S.detail?.data) updateDetailBadges();
}
function schedulePoll() {
  const busy = S.jobs?.queue?.some((j) => j.status === 'running');
  const ms = document.hidden ? 15000 : S.route === 'queue' ? 1500 : busy ? 3000 : 8000;
  setTimeout(async () => { await pollJobs(); schedulePoll(); }, ms);
}

// ==========================================================================
// Login
// ==========================================================================
function renderLogin() {
  document.body.classList.add('login-mode');
  $('#view').innerHTML = `
    <form class="card login" id="login-form">
      <img src="/static/icon.svg" alt="" width="56" height="56">
      <h1>Shrinkarr</h1>
      <label>${t('login.user')}<input class="input" name="user" autocomplete="username" required></label>
      <label>${t('login.password')}<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="login-err" id="login-err" hidden>${t('login.wrong')}</p>
      <button class="btn primary lg" type="submit">${I.lock} ${t('login.submit')}</button>
    </form>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), btn = $('button', e.target);
    btn.disabled = true;
    try {
      await post('/api/auth/login', { user: fd.get('user'), password: fd.get('password') });
      location.reload();
    } catch { $('#login-err').hidden = false; btn.disabled = false; }
  });
  $('input', $('#login-form')).focus();
}
events.addEventListener('login', () => { if (S.auth.loggedIn) { S.auth.loggedIn = false; renderLogin(); } });

// --- start -------------------------------------------------------------------------
applyStaticTexts();
(async () => {
  try { S.auth = await api('/api/auth/status'); } catch { /* network error: try anyway */ }
  if (!S.auth.loggedIn) { renderLogin(); return; }
  $('#logout-btn').hidden = !S.auth.enabled;
  try { S.setupDone = (await api('/api/setup')).setupDone; } catch { /* keep default */ }
  await pollJobs();
  await route(true);
  schedulePoll();
})();
