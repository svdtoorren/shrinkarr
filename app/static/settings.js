// Settings page: every option, with test buttons and live GPU information.
import { $, $$, esc, t, lang, setLang, bytes, dur, num, when, I, icon, api, post, put, toast, presetLabel } from './util.js';
import { applyStaticTexts, route } from './app.js';

let SET = null;          // settings as returned by the server (secrets masked)
let gpuTimer = null;

export const setSettingsState = (s) => { SET = s; };
export const settingsState = () => SET;
export const save = async (vals) => {
  try { SET = (await put('/api/settings', vals)).settings; return true; } catch (e) { toast(e.message, 'bad'); return false; }
};

// --- small building blocks ------------------------------------------------------------
export const sw = (id, on, label = '') => `<label class="srow" style="margin:0"><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span>${label ? `<b>${label}</b>` : ''}</label>`;
export const field = (label, control, help = '') => `<label class="ff"><span class="ff-l">${label}</span>${control}${help ? `<span class="ff-h">${help}</span>` : ''}</label>`;
export const inp = (id, value, attrs = '') => `<input class="input" id="${id}" value="${esc(value ?? '')}" autocomplete="off" spellcheck="false" ${attrs}>`;
export const sel = (id, opts, value) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
export const card = (id, title, help, body) => `<section class="card" id="${id}"><h3>${title}</h3>${help ? `<p class="help">${help}</p>` : ''}${body}</section>`;
export const result = (r) => (r.ok
  ? `<span class="res ok">${icon('check', 14)} ${esc(r.text || t('common.ok'))}</span>`
  : `<span class="res bad">${icon('x', 14)} ${esc(r.error || t('common.failed'))}</span>`);

// --- connections ------------------------------------------------------------------------
export function connectionsHtml(s, prefix = 'c') {
  const arrBlock = (app, name, port) => `
    <div class="conn" data-app="${app}">
      <div class="conn-h"><b>${name}</b><span class="muted">${t('set.optional')}</span></div>
      <div class="form">
        ${field(t('set.url'), inp(`${prefix}-${app}-url`, s[`${app}_url`], `placeholder="http://192.168.1.10:${port}"`))}
        ${field(t('set.apiKey'), inp(`${prefix}-${app}-key`, s[`${app}_api_key`], 'placeholder="Settings → General → API Key"'))}
      </div>
      <div class="srow"><button class="btn sm" data-test="${app}">${t('set.test')}</button><span id="${prefix}-${app}-res"></span></div>
    </div>`;
  return `${arrBlock('sonarr', 'Sonarr', 8989)}${arrBlock('radarr', 'Radarr', 7878)}
    <div class="conn" data-app="plex">
      <div class="conn-h"><b>Plex</b><span class="muted">${t('set.plexWhy')}</span></div>
      <div class="form">
        ${field(t('set.url'), inp(`${prefix}-plex-url`, s.plex_url, 'placeholder="http://192.168.1.10:32400"'))}
        ${field(t('set.plexToken'), inp(`${prefix}-plex-token`, s.plex_token, 'placeholder="X-Plex-Token"'), t('set.plexTokenHelp'))}
      </div>
      <div class="srow"><button class="btn sm" data-test="plex">${t('set.test')}</button><span id="${prefix}-plex-res"></span></div>
    </div>`;
}
export function bindConnections(root, prefix, onSaved) {
  const keys = { sonarr: ['sonarr_url', 'sonarr_api_key'], radarr: ['radarr_url', 'radarr_api_key'], plex: ['plex_url', 'plex_token'] };
  const ids = { sonarr: ['url', 'key'], radarr: ['url', 'key'], plex: ['url', 'token'] };
  for (const [app, [k1, k2]] of Object.entries(keys)) {
    const [a, b] = ids[app].map((x) => $(`#${prefix}-${app}-${x}`, root));
    if (!a || !b) continue;  // block not shown (wizard)
    a.onchange = async () => { await save({ [k1]: a.value.trim() }); onSaved?.(); };
    b.onchange = async () => { await save({ [k2]: b.value.trim() }); b.value = SET[k2]; onSaved?.(); };
  }
  $$('[data-test]', root).forEach((btn) => btn.addEventListener('click', async () => {
    const app = btn.dataset.test, out = $(`#${prefix}-${app}-res`, root);
    out.innerHTML = '<span class="spinner"></span>';
    const url = $(`#${prefix}-${app}-url`, root).value.trim();
    try {
      let r;
      if (app === 'plex') {
        r = await post('/api/test/plex', { url, token: $(`#${prefix}-plex-token`, root).value.trim() });
        if (r.ok) r.text = t('set.plexOk', { version: r.version, n: r.sections.length });
      } else {
        r = await post('/api/test/arr', { app, url, api_key: $(`#${prefix}-${app}-key`, root).value.trim() });
        if (r.ok) r.text = t('set.arrOk', { version: r.version, n: r.roots.length });
      }
      out.innerHTML = result(r);
    } catch (e) { out.innerHTML = result({ ok: false, error: e.message }); }
  }));
}

// --- path mappings --------------------------------------------------------------------
export function pathsHtml(maps, prefix = 'p') {
  const rows = (maps.length ? maps : [{ arr: '', local: '', plex: '' }]).map((m, i) => `
    <div class="map-row" data-i="${i}">
      ${field(t('set.pathArr'), inp(`${prefix}-arr-${i}`, m.arr, 'placeholder="/media"'))}
      <span class="map-arrow" aria-hidden="true">→</span>
      ${field(t('set.pathLocal'), inp(`${prefix}-local-${i}`, m.local, 'placeholder="/data/media"'))}
      ${field(t('set.pathPlex'), inp(`${prefix}-plex-${i}`, m.plex, `placeholder="${esc(t('set.pathPlexPh'))}"`))}
      <button class="btn sm ghost map-del" data-del="${i}" aria-label="${t('set.pathRemove')}" title="${t('set.pathRemove')}">${I.trash}</button>
    </div>`).join('');
  return `<div id="${prefix}-rows">${rows}</div>
    <div class="srow"><button class="btn sm" id="${prefix}-add">${I.plus} ${t('set.pathAdd')}</button>
      <button class="btn sm" id="${prefix}-check">${t('set.pathCheck')}</button></div>
    <div id="${prefix}-check-res"></div>`;
}
export function readPaths(root, prefix) {
  return $$('.map-row', root).map((r) => {
    const i = r.dataset.i;
    return { arr: $(`#${prefix}-arr-${i}`, root).value.trim().replace(/\/+$/, ''),
      local: $(`#${prefix}-local-${i}`, root).value.trim().replace(/\/+$/, ''),
      plex: $(`#${prefix}-plex-${i}`, root).value.trim().replace(/\/+$/, '') };
  }).filter((m) => m.arr || m.local);
}
export function bindPaths(root, prefix, container, rerender) {
  const persist = async () => { await save({ path_mappings: readPaths(root, prefix) }); };
  $$(`#${prefix}-rows input`, root).forEach((el) => { el.onchange = persist; });
  $$(`#${prefix}-rows [data-del]`, root).forEach((b) => { b.onclick = async () => {
    const maps = readPaths(root, prefix); maps.splice(+b.dataset.del, 1);
    await save({ path_mappings: maps }); rerender();
  }; });
  $(`#${prefix}-add`, root).onclick = async () => {
    const maps = readPaths(root, prefix); maps.push({ arr: '', local: '', plex: '' });
    SET.path_mappings = maps; rerender(maps);
  };
  $(`#${prefix}-check`, root).onclick = async () => {
    const out = $(`#${prefix}-check-res`, root);
    out.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await post('/api/test/paths', { mappings: readPaths(root, prefix) });
      if (!r.roots.length) { out.innerHTML = `<p class="help">${t('set.pathNoRoots')}</p>`; return; }
      out.innerHTML = `<div class="checks">${r.roots.map((x, i) => `
        <div class="check-row">
          ${x.exists ? (x.writable && (!x.plex || x.plex.ok) ? `<span class="res ok">${icon('check', 14)}</span>` : `<span class="res warn">!</span>`) : `<span class="res bad">${icon('x', 14)}</span>`}
          <div style="min-width:0"><div class="mono">${esc(x.arr)} → ${esc(x.local)}</div>
            <div class="ff-h">${x.app === 'radarr' ? 'Radarr' : 'Sonarr'} · ${x.exists ? (x.writable ? t('set.pathOk') : t('set.pathReadOnly')) : t('set.pathMissing')}</div>
            ${x.suggestion ? `<button class="btn sm" data-sug="${i}">${t('set.pathSuggest', { arr: esc(x.suggestion.arr), local: esc(x.suggestion.local) })}</button>` : ''}
            ${x.plex ? `<div class="ff-h">Plex · ${x.plex.ok ? `<span class="mono">${esc(x.plex.path)}</span>` : `<span style="color:var(--warn)">${t('set.pathNoPlex', { path: esc(x.plex.path) })}</span>`}</div>` : ''}
            ${x.plex?.suggestion ? `<button class="btn sm" data-psug="${i}">${t('set.pathSuggestPlex', { local: esc(x.plex.suggestion.local), plex: esc(x.plex.suggestion.plex) })}</button>` : ''}
          </div></div>`).join('')}</div>`;
      $$('[data-sug]', out).forEach((b) => { b.onclick = async () => {
        const sg = r.roots[+b.dataset.sug].suggestion;
        const maps = readPaths(root, prefix).filter((m) => m.arr || m.local);
        maps.push({ arr: sg.arr, local: sg.local, plex: '' });
        await save({ path_mappings: maps }); rerender(); $(`#${prefix}-check`, root)?.click();
      }; });
      $$('[data-psug]', out).forEach((b) => { b.onclick = async () => {
        const sg = r.roots[+b.dataset.psug].plex.suggestion;
        const maps = readPaths(root, prefix).filter((m) => m.arr || m.local);
        const same = maps.find((m) => m.arr === sg.arr && m.local === sg.local);
        if (same) same.plex = sg.plex; else maps.push({ arr: sg.arr, local: sg.local, plex: sg.plex });
        await save({ path_mappings: maps }); rerender(); $(`#${prefix}-check`, root)?.click();
      }; });
    } catch (e) { out.innerHTML = result({ ok: false, error: e.message }); }
  };
}

// --- encoder ----------------------------------------------------------------------------
export function encoderHtml(enc, s, prefix = 'e') {
  const opts = [['auto', t('set.encAuto', { name: enc.active.label })],
    ...['qsv', 'vaapi', 'nvenc', 'cpu'].map((k) => {
      const found = enc.detected.filter((d) => d.encoder === k);
      const ok = found.some((d) => d.ok);
      return [k, `${t('enc.' + k)} – ${found.length ? (ok ? t('set.encWorks') : t('set.encFails')) : t('set.encMissing')}`];
    })];
  const devs = [['', t('set.devAuto')], ...enc.devices.map((d) => [d.path, `${d.path} (${d.vendor})`])];
  return `<div class="form">
      ${field(t('set.encoder'), sel(`${prefix}-enc`, opts, s.encoder))}
      ${enc.devices.length > 1 ? field(t('set.device'), sel(`${prefix}-dev`, devs, s.gpu_device)) : ''}
    </div>
    <div class="checks" style="margin-top:10px">${enc.detected.map((d) => `
      <div class="check-row">${d.ok ? `<span class="res ok">${icon('check', 14)}</span>` : `<span class="res bad">${icon('x', 14)}</span>`}
        <div style="min-width:0"><div><b>${esc(t('enc.' + d.encoder))}</b> <span class="muted mono">${esc(d.device)}</span></div>
        ${d.ok ? '' : `<div class="ff-h">${esc(d.error)}</div>`}</div></div>`).join('')}</div>
    <div class="srow"><button class="btn sm" id="${prefix}-detect">${I.refresh} ${t('set.detect')}</button></div>`;
}
export function bindEncoder(root, prefix, rerender) {
  $(`#${prefix}-enc`, root).onchange = (e) => save({ encoder: e.target.value }).then(() => rerender());
  const dev = $(`#${prefix}-dev`, root);
  if (dev) dev.onchange = (e) => save({ gpu_device: e.target.value }).then(() => rerender());
  $(`#${prefix}-detect`, root).onclick = async (e) => {
    e.currentTarget.innerHTML = `<span class="spinner"></span> ${t('set.detecting')}`;
    await api('/api/encoders?force=true'); rerender();
  };
}

// --- GPU card (live) --------------------------------------------------------------------
const ENGINE = { render: 'eng.render', video: 'eng.video', 'video-enhance': 'eng.enhance', copy: 'eng.copy', gfx: 'eng.gfx',
  enc: 'eng.enc', dec: 'eng.dec', encoder: 'eng.enc', decoder: 'eng.dec', compute: 'eng.compute' };
const THROTTLE = ['pl1', 'pl2', 'pl4', 'thermal', 'prochot', 'ratl', 'vr_tdc', 'vr_thermalert'];
function meter(label, pct, sub = '') {
  const v = pct == null ? null : Math.round(pct);
  return `<div><div class="srow" style="justify-content:space-between;margin:0"><b>${label}</b>
    <span class="num">${v == null ? '–' : v + '%'}${sub ? ` <span class="muted">${sub}</span>` : ''}</span></div>
    <div class="diskbar"><i style="width:${v || 0}%;background:var(--grad)"></i></div></div>`;
}
function throttleHtml(list) {
  if (!list?.length) return `<div class="value" style="font-size:15px">${t('gpu.no')}</div>`;
  const hot = list.some((x) => ['thermal', 'prochot', 'vr_thermalert'].includes(x));
  return `<div class="value" style="font-size:15px;${hot ? 'color:var(--warn)' : ''}">${list.map((x) => esc(THROTTLE.includes(x) ? t('thr.' + x) : x)).join(', ')}</div>
    <div class="muted" style="font-size:12px">${hot ? t('gpu.hot') : t('gpu.power')}</div>`;
}
function drawGpu(d) {
  const el = $('#gpu-body'); if (!el) return;
  const st = d.static, lv = d.live, f = lv.freq || {};
  const yes = '<span class="good">✓</span>', no = '<span class="faint">–</span>';
  const measured = new Set(d.measured);
  const engines = Object.entries(lv.engines || {}).filter(([k]) => ENGINE[k] && !(k === 'copy' || k === 'video-enhance'));
  el.innerHTML = `
    <div class="srow" style="margin:0 0 12px;justify-content:space-between">
      <div><div style="font-size:18px;font-weight:750">${esc(st.name)}</div>
        <div class="muted" style="font-size:12.5px">${esc(t('enc.' + d.encoder.encoder))}${st.kernelDriver ? ' · ' + esc(st.kernelDriver) : ''}${st.mediaDriver ? ' · ' + esc(st.mediaDriver) : ''}</div></div>
      <span class="badge ${d.encoding ? 'accent' : ''}">${d.encoding ? t('gpu.encoding') : t('gpu.idle')}</span>
    </div>
    <div style="display:grid;gap:12px">
      ${d.encoder.encoder === 'cpu' ? meter(t('gpu.cpu'), lv.cpu) : meter(t('gpu.busy'), lv.busy, `(${t('gpu.allUsers')})`)}
      ${d.encoding && engines.length ? engines.map(([k, v]) => meter(`Shrinkarr · ${t(ENGINE[k])}`, v)).join('') : ''}
    </div>
    <div class="metrics" style="margin-top:14px">
      ${f.act != null ? `<div class="metric"><div class="label">${t('gpu.clock')}</div><div class="value num">${num(f.act)} <span class="muted" style="font-size:13px">/ ${f.max != null ? num(f.max) : '–'} MHz</span></div></div>` : ''}
      <div class="metric"><div class="label">${t('gpu.temp')}</div><div class="value num">${lv.temp != null ? Math.round(lv.temp) + ' °C' : '–'}</div></div>
      ${st.vendor === 'intel' ? `<div class="metric"><div class="label">${t('gpu.throttle')}</div>${throttleHtml(lv.throttle)}</div>` : ''}
      <div class="metric"><div class="label">${t('gpu.converted')}</div><div class="value num">${d.jobs.n} <span class="muted" style="font-size:13px">· ${t('gpu.gpuTime', { time: dur(d.jobs.secs) })}</span></div></div>
    </div>
    <div class="section-title" style="margin-top:18px">${t('gpu.speed')}</div>
    <div class="metrics">${Object.entries(d.fps).map(([b, v]) => `<div class="metric"><div class="label">${b === 'sd' ? 'SD' : b}</div>
      <div class="value num">${v} fps</div><div class="muted" style="font-size:12px">${measured.has(b) ? t('gpu.measured') : t('gpu.assumed')}</div></div>`).join('')}</div>
    ${st.codecs.length ? `<div class="section-title" style="margin-top:18px">${t('gpu.codecs')}</div>
    <div style="border:1px solid var(--border);border-radius:12px"><dl class="kv" style="grid-template-columns:1fr auto auto;gap:6px 22px">
      <dt><b>${t('gpu.codec')}</b></dt><dd class="muted">${t('gpu.decode')}</dd><dd class="muted">${t('gpu.encode')}</dd>
      ${st.codecs.map((c) => `<dt style="color:var(--text)">${esc(c.name)}</dt><dd style="text-align:center">${c.decode ? yes : no}</dd><dd style="text-align:center">${c.encode ? yes : no}</dd>`).join('')}
    </dl></div>` : ''}
    <p class="help" style="margin:8px 0 0">${st.vendor === 'intel' ? t('gpu.noteIntel') : t('gpu.note')}</p>`;
}

// --- notifications ----------------------------------------------------------------------
function notifyHtml(s) {
  const email = s.notify_method !== 'pushover';
  return `${sw('n-on', s.notify_enabled, t('set.on'))}
    <div class="srow"><span>${t('set.notifyAt')}</span><input type="time" id="n-time" value="${esc(s.notify_time)}"></div>
    <div class="srow"><span>${t('set.via')}</span>
      <div class="seg" id="n-method">${[['email', t('set.email')], ['pushover', 'Pushover']].map(([k, l]) => `<button data-v="${k}" class="${(email ? 'email' : 'pushover') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div id="n-email" ${email ? '' : 'hidden'}><div class="form">
      ${field(t('set.smtpHost'), inp('n-host', s.smtp_host, 'placeholder="smtp.example.com"'))}
      ${field(t('set.smtpPort'), inp('n-port', s.smtp_port, 'inputmode="numeric" placeholder="587"'))}
      ${field(t('set.smtpSecurity'), sel('n-sec', [['none', t('set.secNone')], ['starttls', 'STARTTLS'], ['ssl', 'SSL/TLS']], s.smtp_security))}
      ${field(t('set.smtpUser'), inp('n-user', s.smtp_user, `placeholder="${esc(t('set.optionalPh'))}"`))}
      ${field(t('set.smtpPassword'), inp('n-pass', s.smtp_password, `type="password" placeholder="${esc(t('set.optionalPh'))}"`))}
      ${field(t('set.from'), inp('n-from', s.notify_from, 'placeholder="shrinkarr@example.com"'))}
      ${field(t('set.to'), inp('n-to', s.notify_to, 'placeholder="you@example.com"'), t('set.toHelp'))}
    </div></div>
    <div id="n-po" ${email ? 'hidden' : ''}><div class="form">
      ${field(t('set.poToken'), inp('po-token', s.pushover_token, `placeholder="${esc(t('set.poTokenPh'))}"`))}
      ${field(t('set.poUser'), inp('po-user', s.pushover_user, `placeholder="${esc(t('set.poUserPh'))}"`))}
      ${field(t('set.poDevice'), inp('po-device', s.pushover_device, 'placeholder="iphone"'))}
      ${field(t('set.poPriority'), sel('po-prio', [[-1, t('set.prioQuiet')], [0, t('set.prioNormal')], [1, t('set.prioHigh')]], s.pushover_priority))}
    </div><p class="help" style="margin:8px 0 0">${t('set.poHelp')}</p></div>
    <div class="form" style="margin-top:12px">${field(t('set.publicUrl'), inp('n-public', s.public_url, 'placeholder="https://shrinkarr.example.com"'), t('set.publicUrlHelp'))}</div>
    <div class="srow" style="margin-top:12px"><button class="btn sm" id="n-test">${t('set.notifyTest')}</button><span id="n-res"></span></div>`;
}
function bindNotify(root) {
  $('#n-on', root).onchange = (e) => save({ notify_enabled: e.target.checked });
  $('#n-time', root).onchange = (e) => save({ notify_time: e.target.value });
  $('#n-method', root).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#n-method button', root).forEach((x) => x.classList.toggle('on', x === b));
    $('#n-email', root).hidden = b.dataset.v !== 'email'; $('#n-po', root).hidden = b.dataset.v !== 'pushover';
    await save({ notify_method: b.dataset.v });
  };
  const map = { 'n-host': 'smtp_host', 'n-sec': 'smtp_security', 'n-user': 'smtp_user', 'n-pass': 'smtp_password',
    'n-from': 'notify_from', 'n-to': 'notify_to', 'po-token': 'pushover_token', 'po-user': 'pushover_user',
    'po-device': 'pushover_device', 'n-public': 'public_url' };
  for (const [id, key] of Object.entries(map)) {
    $('#' + id, root).onchange = async (e) => { if (await save({ [key]: e.target.value.trim() }) && key in SET) e.target.value = SET[key]; };
  }
  $('#n-port', root).onchange = (e) => save({ smtp_port: parseInt(e.target.value, 10) || 25 });
  $('#po-prio', root).onchange = (e) => save({ pushover_priority: +e.target.value });
  $('#n-test', root).onclick = async (e) => {
    const out = $('#n-res', root); out.innerHTML = '<span class="spinner"></span>';
    try { const r = await post('/api/notify/test'); out.innerHTML = result({ ok: true, text: t('set.sent', { subject: r.subject }) }); }
    catch (err) { out.innerHTML = result({ ok: false, error: err.message }); }
  };
}

// --- login ----------------------------------------------------------------------------
function authHtml(s, enabled) {
  return `${sw('a-on', enabled, t('set.authOn'))}
    <div class="form" style="margin-top:10px">
      ${field(t('login.user'), inp('a-user', s.auth_user, 'autocomplete="username"'))}
      ${field(enabled ? t('set.newPassword') : t('login.password'), inp('a-pass', '', `type="password" autocomplete="new-password" placeholder="${esc(enabled ? t('set.keepPassword') : t('set.minChars'))}"`))}
    </div>
    <div class="srow"><button class="btn sm primary" id="a-save">${t('common.save')}</button><span id="a-res"></span></div>`;
}
function bindAuth(root) {
  $('#a-save', root).onclick = async () => {
    const out = $('#a-res', root);
    try {
      const r = await put('/api/auth', { enabled: $('#a-on', root).checked, user: $('#a-user', root).value, password: $('#a-pass', root).value });
      out.innerHTML = result({ ok: true, text: r.enabled ? t('set.authSaved') : t('set.authOff') });
      $('#a-pass', root).value = '';
      $('#logout-btn').hidden = !r.enabled;
    } catch (e) { out.innerHTML = result({ ok: false, error: e.message }); }
  };
}

// --- the page ---------------------------------------------------------------------------
export async function renderSettings(S) {
  clearInterval(gpuTimer);
  const v = $('#view');
  v.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
  const [setRes, st, enc, hooks, authSt, ver, lib] = await Promise.all([
    api('/api/settings'), api('/api/status').catch(() => null), api('/api/encoders'), api('/api/hooks'),
    api('/api/auth/status'), api('/api/version').catch(() => null), api('/api/library').catch(() => null)]);
  SET = setRes.settings;
  const s = SET;
  const roots = lib?.roots || [];
  const dot = (ok) => `<span class="dot ${ok === true ? 'ok' : ok === false ? 'no' : ''}"></span>`;
  const disk = (d, label) => (d ? `<div><div class="srow" style="justify-content:space-between;margin:0"><b>${label}</b><span class="muted num">${t('set.diskFree', { free: bytes(d.free), total: bytes(d.total) })}</span></div>
    <div class="diskbar"><i style="width:${(1 - d.free / d.total) * 100}%"></i></div><div class="ff-h mono">${esc(d.path)}</div></div>` : '');

  v.innerHTML = `
    <h1 class="page">${t('nav.settings')}</h1><p class="page-sub">${t('set.autosave')}</p>
    <nav class="set-nav" aria-label="${t('nav.settings')}">${[['s-general', t('set.general')], ['s-conn', t('set.connections')], ['s-paths', t('set.paths')],
      ['s-enc', t('set.encoding')], ['s-auto', t('set.automatic')], ['s-notify', t('set.notify')], ['s-auth', t('set.login')],
      ['s-gpu', 'GPU'], ['s-about', t('set.about')]].map(([id, l]) => `<a href="#${id}" data-jump="${id}">${l}</a>`).join('')}</nav>
    <div class="settings">
      ${card('s-general', t('set.general'), '', `
        <div class="form">
          ${field(t('set.language'), sel('g-lang', [['en', 'English'], ['nl', 'Nederlands']], lang()), t('set.languageHelp'))}
        </div>
        <div class="srow" style="margin-top:12px"><a class="btn sm" href="#/setup">${t('set.rerunWizard')}</a></div>`)}

      ${card('s-conn', t('set.connections'), t('set.connHelp'), `
        ${st ? `<div class="health">${[['sonarr', 'Sonarr'], ['radarr', 'Radarr'], ['plex', 'Plex']].map(([k, l]) =>
          `<div class="h">${dot(st[k])}${l}<span class="muted" style="margin-left:auto;font-weight:500">${st[k] == null ? t('set.notSet') : st[k] ? t('set.online') : t('set.offline')}</span></div>`).join('')}</div>` : ''}
        <div id="conn-body">${connectionsHtml(s)}</div>`)}

      ${card('s-paths', t('set.paths'), t('set.pathsHelp'), `<div id="paths-body">${pathsHtml(s.path_mappings)}</div>
        ${st ? `<div style="display:grid;gap:14px;margin-top:16px">${disk(st.disk.media, t('set.diskMedia'))}${disk(st.disk.work, t('set.diskWork'))}</div>` : ''}`)}

      ${card('s-enc', t('set.encoding'), t('set.encHelp'), `
        <div id="enc-body">${encoderHtml(enc, s)}</div>
        <h4>${t('set.quality')}</h4>
        <div class="presets" id="presets">${['high', 'balanced', 'max'].map((k) => `
          <button class="preset ${s.preset === k ? 'on' : ''}" data-v="${k}"><b>${presetLabel(k)}</b><span>${t('preset.' + k + '.help')}</span></button>`).join('')}</div>
        <h4>${t('set.minSavings')}</h4><p class="help">${t('set.minSavingsHelp')}</p>
        <div class="srow"><input type="range" id="min-sav" min="0" max="50" step="5" value="${s.min_savings}" aria-label="${t('set.minSavings')}"><b class="num" id="min-sav-v">${s.min_savings}%</b></div>
        <h4>${t('set.keep')}</h4><p class="help">${t('set.keepHelp')}</p>
        <div class="srow">${sel('keep-days', [0, 1, 3, 7, 14, 30].map((n) => [n, n ? t('set.keepDays', { n }) : t('set.keepOff')]), s.keep_days)}</div>
        <h4>${t('set.dts')}</h4><p class="help">${t('set.dtsHelp')}</p>
        <div class="srow">${sw('dts-on', s.dts_to_eac3, t('set.on'))}</div>
        <h4>${t('set.window')}</h4><p class="help">${t('set.windowHelp')}</p>
        <div class="srow">${sw('win-on', s.window_enabled)}<span>${t('set.from_')}</span><input type="time" id="win-a" value="${esc(s.window_start)}"><span>${t('set.to_')}</span><input type="time" id="win-b" value="${esc(s.window_end)}"></div>`)}

      ${card('s-auto', t('set.automatic'), t('set.autoHelp'), `
        ${sw('auto-on', s.auto_enabled, t('set.on'))}
        <div class="srow">
          <label class="srow" style="margin:0"><input type="checkbox" class="cb" id="auto-movies" ${s.auto_movies ? 'checked' : ''}> ${t('lib.movies')}</label>
          <label class="srow" style="margin:0"><input type="checkbox" class="cb" id="auto-series" ${s.auto_series ? 'checked' : ''}> ${t('lib.series')}</label>
        </div>
        ${roots.length ? `<p class="help" style="margin:10px 0 4px">${t('set.autoRoots')}</p><div class="root-list">${roots.map((r) => `
          <label class="srow" style="margin:0"><input type="checkbox" class="cb" data-root="${esc(r.path)}" ${s.auto_exclude_roots.includes(r.path) ? '' : 'checked'}>
            <span>${esc(r.label)} <span class="muted mono">${esc(r.path)}</span></span></label>`).join('')}</div>` : ''}
        <div class="srow"><span>${t('set.autoBetween')}</span><input type="time" id="auto-a" value="${esc(s.auto_window_start)}"><span>${t('set.and')}</span><input type="time" id="auto-b" value="${esc(s.auto_window_end)}"></div>
        <div class="srow"><span>${t('set.atLeast')}</span>${sel('auto-delay', [0, 1, 2, 4, 6, 12, 24].map((h) => [h, t('set.hours', { n: h })]), s.auto_delay_hours)}<span>${t('set.afterDownload')}</span></div>
        <div class="srow"><span>${t('set.quality')}</span>${sel('auto-preset', ['high', 'balanced', 'max'].map((k) => [k, presetLabel(k)]), s.auto_preset)}</div>
        <label class="srow"><input type="checkbox" class="cb" id="auto-cutoff" ${s.auto_skip_cutoff ? 'checked' : ''}> ${t('set.autoCutoff')}</label>
        <h4>${t('set.webhooks')}</h4><p class="help">${t('set.webhooksHelp')}</p>
        <div class="form">${field(t('set.hookBase'), inp('hook-base', s.hook_base_url, `placeholder="${esc(hooks.base)}"`), t('set.hookBaseHelp'))}</div>
        <div class="hook-urls">${['sonarr', 'radarr'].map((a) => `<div class="mono hook-url"><b>${a === 'sonarr' ? 'Sonarr' : 'Radarr'}</b> <span>${esc(hooks[a])}</span>
          <button class="btn sm ghost" data-copy="${esc(hooks[a])}" aria-label="${t('set.copy')}" title="${t('set.copy')}">${I.copy}</button></div>`).join('')}</div>
        <div class="srow"><button class="btn sm primary" id="hooks-install">${I.link} ${t('set.hooksInstall')}</button><span id="hooks-res"></span></div>
        <p class="help" style="margin:6px 0 0">${t('set.hooksLast', { sonarr: hooks.last.sonarr ? when(hooks.last.sonarr) : t('set.never'), radarr: hooks.last.radarr ? when(hooks.last.radarr) : t('set.never') })}</p>`)}

      ${card('s-notify', t('set.notify'), t('set.notifyHelp'), notifyHtml(s))}

      ${card('s-auth', t('set.login'), t('set.loginHelp'), authHtml(s, authSt.enabled))}

      ${card('s-gpu', 'GPU', t('set.gpuHelp'), `<div id="gpu-body"><div class="spinner"></div></div>`)}

      ${card('s-about', t('set.about'), '', `
        <p style="margin:0 0 6px"><b>Shrinkarr ${esc(setRes.version)}</b>${ver?.update ? ` · <span class="badge accent">${t('set.updateAvail', { v: esc(ver.latest) })}</span>` : ver?.latest ? ` · ${t('set.upToDate')}` : ''}</p>
        <p class="help">${t('set.updateHelp')}</p>
        <div class="srow"><a class="btn sm" href="${esc(ver?.url || 'https://github.com/rvanderend/shrinkarr')}" target="_blank" rel="noopener">GitHub</a>
          ${st ? `<span class="muted">${t('set.libInfo', { movies: st.library.movies, series: st.library.series, n: st.learned })}</span>` : ''}</div>`)}
    </div>`;

  const root = v;
  // general
  $('#g-lang').onchange = async (e) => {
    setLang(e.target.value); await save({ language: e.target.value });
    applyStaticTexts(); route(true);
  };
  $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); document.getElementById(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  // connections
  bindConnections($('#conn-body'), 'c', () => { S.lib = null; });
  // paths
  const rerenderPaths = (maps) => {
    $('#paths-body').innerHTML = pathsHtml(maps || SET.path_mappings);
    bindPaths($('#paths-body'), 'p', $('#paths-body'), rerenderPaths);
  };
  rerenderPaths();
  // encoding
  const rerenderEnc = async () => {
    const e2 = await api('/api/encoders');
    $('#enc-body').innerHTML = encoderHtml(e2, SET); bindEncoder($('#enc-body'), 'e', rerenderEnc);
  };
  bindEncoder($('#enc-body'), 'e', rerenderEnc);
  $('#presets').onclick = async (e) => {
    const b = e.target.closest('.preset'); if (!b) return;
    $$('#presets .preset').forEach((x) => x.classList.toggle('on', x === b));
    await save({ preset: b.dataset.v });
    S.preset = b.dataset.v; S.lib = null;
  };
  $('#min-sav').oninput = (e) => { $('#min-sav-v').textContent = e.target.value + '%'; };
  $('#min-sav').onchange = (e) => save({ min_savings: +e.target.value });
  $('#keep-days').onchange = (e) => save({ keep_days: +e.target.value });
  $('#dts-on').onchange = async (e) => { await save({ dts_to_eac3: e.target.checked }); S.lib = null; };
  const bind = (id, key, val = (e) => e.target.checked) => { $('#' + id).onchange = (e) => save({ [key]: val(e) }); };
  bind('win-on', 'window_enabled'); bind('win-a', 'window_start', (e) => e.target.value); bind('win-b', 'window_end', (e) => e.target.value);
  // automatic
  bind('auto-on', 'auto_enabled'); bind('auto-movies', 'auto_movies'); bind('auto-series', 'auto_series');
  bind('auto-cutoff', 'auto_skip_cutoff'); bind('auto-a', 'auto_window_start', (e) => e.target.value);
  bind('auto-b', 'auto_window_end', (e) => e.target.value); bind('auto-delay', 'auto_delay_hours', (e) => +e.target.value);
  bind('auto-preset', 'auto_preset', (e) => e.target.value);
  $$('[data-root]').forEach((cb) => { cb.onchange = () => save({ auto_exclude_roots: $$('[data-root]').filter((x) => !x.checked).map((x) => x.dataset.root) }); });
  $('#hook-base').onchange = async (e) => { await save({ hook_base_url: e.target.value.trim() }); renderSettings(S); };
  $$('[data-copy]').forEach((b) => { b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('set.copied'), 'good'); } catch { prompt(t('set.copy'), b.dataset.copy); }
  }; });
  $('#hooks-install').onclick = async () => {
    const out = $('#hooks-res'); out.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await post('/api/hooks/install');
      const parts = Object.entries(r).map(([a, x]) => `${a === 'sonarr' ? 'Sonarr' : 'Radarr'}: ${x.ok ? '✓' : '✗ ' + x.error}`);
      out.innerHTML = parts.length ? result({ ok: Object.values(r).every((x) => x.ok), text: parts.join(' · '), error: parts.join(' · ') }) : result({ ok: false, error: t('set.noArr') });
    } catch (e) { out.innerHTML = result({ ok: false, error: e.message }); }
  };
  bindNotify(root);
  bindAuth(root);
  // GPU, live while the page is open
  const tick = async () => {
    if (S.route !== 'settings' || !$('#gpu-body')) { clearInterval(gpuTimer); return; }
    try { drawGpu(await api('/api/gpu')); } catch { /* next time */ }
  };
  tick(); gpuTimer = setInterval(tick, 2000);
}
