// Setup wizard: language → Sonarr/Radarr → Plex → paths → encoder → login → automatic → done.
import { $, $$, esc, t, lang, setLang, I, icon, api, post, put, toast } from './util.js';
import { applyStaticTexts } from './app.js';
import {
  setSettingsState, settingsState, save, connectionsHtml, bindConnections, pathsHtml, bindPaths, readPaths,
  encoderHtml, bindEncoder, sw, field, inp, result,
} from './settings.js';

const STEPS = ['welcome', 'arr', 'plex', 'paths', 'encoder', 'login', 'auto', 'done'];
let step = 0;
let S_ = null;

function frame(body, { back = true, next = t('wiz.next'), skip = false } = {}) {
  const name = STEPS[step];
  return `
    <div class="wizard">
      <div class="wiz-head">
        <img src="/static/icon.svg" alt="" width="36" height="36">
        <div><div class="wiz-brand">Shrinkarr</div><div class="muted">${t('wiz.stepOf', { n: step + 1, total: STEPS.length })}</div></div>
      </div>
      <ol class="wiz-steps" aria-label="${t('wiz.progress')}">${STEPS.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'on' : ''}" ${i === step ? 'aria-current="step"' : ''}><span>${t('wiz.s.' + s)}</span></li>`).join('')}</ol>
      <section class="card wiz-card">
        <h1>${t('wiz.' + name + '.title')}</h1>
        <p class="help">${t('wiz.' + name + '.help')}</p>
        ${body}
        <div class="wiz-err" id="wiz-err" hidden></div>
        <div class="wiz-foot">
          ${back && step > 0 ? `<button class="btn ghost" id="wiz-back">${I.back} ${t('wiz.back')}</button>` : '<span></span>'}
          <span class="spacer"></span>
          ${skip ? `<button class="btn ghost" id="wiz-skip">${t('wiz.skip')}</button>` : ''}
          ${next ? `<button class="btn primary" id="wiz-next">${next} ${I.chev}</button>` : ''}
        </div>
      </section>
    </div>`;
}
const err = (msg) => { const e = $('#wiz-err'); e.hidden = !msg; e.innerHTML = msg ? `${icon('x', 16)} ${esc(msg)}` : ''; };
const go = (n) => { step = Math.max(0, Math.min(STEPS.length - 1, n)); draw(); window.scrollTo(0, 0); };

async function draw() {
  const v = $('#view');
  const s = settingsState();
  const name = STEPS[step];

  if (name === 'welcome') {
    v.innerHTML = frame(`
      <div class="lang-pick">${[['en', 'English'], ['nl', 'Nederlands']].map(([k, l]) => `
        <button class="preset ${lang() === k ? 'on' : ''}" data-lang="${k}">${icon('globe', 20)}<b>${l}</b></button>`).join('')}</div>
      <ul class="wiz-list">${['1', '2', '3'].map((k) => `<li>${t('wiz.welcome.point' + k)}</li>`).join('')}</ul>`, { back: false, next: t('wiz.start') });
    $$('[data-lang]').forEach((b) => { b.onclick = async () => {
      setLang(b.dataset.lang); await save({ language: b.dataset.lang }); applyStaticTexts(); draw();
    }; });
  }

  if (name === 'arr') {
    v.innerHTML = frame(`<div id="w-conn">${connectionsHtml(s, 'w')}</div>`);
    $('[data-app="plex"]', v).remove();
    bindConnections($('#w-conn'), 'w');
  }

  if (name === 'plex') {
    v.innerHTML = frame(`<div id="w-conn">${connectionsHtml(s, 'w')}</div>`, { skip: true });
    $$('[data-app="sonarr"], [data-app="radarr"]', v).forEach((el) => el.remove());
    bindConnections($('#w-conn'), 'w');
  }

  if (name === 'paths') {
    v.innerHTML = frame(`<div id="w-paths">${pathsHtml(s.path_mappings, 'wp')}</div>
      <details class="wiz-more"><summary>${t('wiz.paths.example')}</summary><p class="help">${t('wiz.paths.exampleText')}</p></details>`);
    const rerender = (maps) => {
      $('#w-paths').innerHTML = pathsHtml(maps || settingsState().path_mappings, 'wp');
      bindPaths($('#w-paths'), 'wp', $('#w-paths'), rerender);
    };
    rerender();
    $('#wp-check').click();
  }

  if (name === 'encoder') {
    v.innerHTML = frame(`<div id="w-enc"><div class="srow"><span class="spinner"></span> ${t('set.detecting')}</div></div>`);
    const rerender = async () => {
      const e = await api('/api/encoders');
      $('#w-enc').innerHTML = encoderHtml(e, settingsState(), 'we') +
        `<p class="help" style="margin-top:12px">${t('wiz.encoder.active', { name: esc(e.active.label) })}</p>`;
      bindEncoder($('#w-enc'), 'we', rerender);
    };
    rerender();
  }

  if (name === 'login') {
    const st = await api('/api/auth/status');
    v.innerHTML = frame(`
      ${sw('wa-on', st.enabled || !!s.auth_user, t('set.authOn'))}
      <div class="form" style="margin-top:10px">
        ${field(t('login.user'), inp('wa-user', s.auth_user || 'admin', 'autocomplete="username"'))}
        ${field(t('login.password'), inp('wa-pass', '', `type="password" autocomplete="new-password" placeholder="${esc(st.enabled ? t('set.keepPassword') : t('set.minChars'))}"`))}
      </div>`, { skip: true });
  }

  if (name === 'auto') {
    const hooks = await api('/api/hooks');
    v.innerHTML = frame(`
      ${sw('wau-on', s.auto_enabled, t('wiz.auto.enable'))}
      <p class="help" style="margin:10px 0">${t('wiz.auto.window', { from: esc(s.auto_window_start), to: esc(s.auto_window_end) })}</p>
      <div class="form">${field(t('set.hookBase'), inp('w-hook-base', s.hook_base_url, `placeholder="${esc(hooks.base)}"`), t('set.hookBaseHelp'))}</div>
      <div class="srow"><button class="btn sm" id="w-hooks">${I.link} ${t('set.hooksInstall')}</button><span id="w-hooks-res"></span></div>`, { skip: true });
    $('#wau-on').onchange = (e) => save({ auto_enabled: e.target.checked });
    $('#w-hook-base').onchange = (e) => save({ hook_base_url: e.target.value.trim() });
    $('#w-hooks').onclick = async () => {
      const out = $('#w-hooks-res'); out.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await post('/api/hooks/install');
        const parts = Object.entries(r).map(([a, x]) => `${a === 'sonarr' ? 'Sonarr' : 'Radarr'}: ${x.ok ? '✓' : '✗ ' + x.error}`);
        out.innerHTML = result({ ok: parts.length && Object.values(r).every((x) => x.ok), text: parts.join(' · '), error: parts.join(' · ') || t('set.noArr') });
      } catch (e) { out.innerHTML = result({ ok: false, error: e.message }); }
    };
  }

  if (name === 'done') {
    const st = await api('/api/status').catch(() => null);
    const row = (ok, label) => `<li>${ok ? `<span class="res ok">${icon('check', 14)}</span>` : `<span class="res warn">–</span>`} ${label}</li>`;
    v.innerHTML = frame(`<ul class="wiz-summary">
        ${row(s.sonarr_url, 'Sonarr')}${row(s.radarr_url, 'Radarr')}${row(s.plex_url, 'Plex')}
        ${row(s.path_mappings.length, t('set.paths'))}
        ${row(true, t('set.encoder') + ': ' + esc(st?.encoder?.label || ''))}
        ${row(s.auth_enabled, t('set.login'))}${row(s.auto_enabled, t('set.automatic'))}
      </ul><p class="help">${t('wiz.done.more')}</p>`, { next: t('wiz.finish') });
  }

  // --- navigation --------------------------------------------------------------------
  $('#wiz-back')?.addEventListener('click', () => go(step - 1));
  $('#wiz-skip')?.addEventListener('click', () => go(step + 1));
  $('#wiz-next')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; err('');
    try {
      if (await validate(name)) go(step + 1);
    } catch (ex) { err(ex.message); }
    btn.disabled = false;
  });
}

async function validate(name) {
  if (name === 'arr') {
    const results = [];
    for (const app of ['sonarr', 'radarr']) {
      const url = $(`#w-${app}-url`).value.trim(), key = $(`#w-${app}-key`).value.trim();
      await save({ [`${app}_url`]: url, [`${app}_api_key`]: key });
      if (url) {
        const r = await post('/api/test/arr', { app, url, api_key: key });
        $(`#w-${app}-res`).innerHTML = result(r.ok ? { ok: true, text: t('set.arrOk', { version: r.version, n: r.roots.length }) } : r);
        results.push(r.ok);
      }
    }
    if (!results.some(Boolean)) { err(t('wiz.arr.need')); return false; }
    post('/api/library/refresh').catch(() => {});
    return true;
  }
  if (name === 'plex') {
    const url = $('#w-plex-url').value.trim(), token = $('#w-plex-token').value.trim();
    await save({ plex_url: url, plex_token: token });
    if (!url) return true;
    const r = await post('/api/test/plex', { url, token });
    $('#w-plex-res').innerHTML = result(r.ok ? { ok: true, text: t('set.plexOk', { version: r.version, n: r.sections.length }) } : r);
    if (!r.ok) { err(t('wiz.plex.fail')); return false; }
    return true;
  }
  if (name === 'paths') {
    const maps = readPaths($('#w-paths'), 'wp');
    await save({ path_mappings: maps });
    const r = await post('/api/test/paths', { mappings: maps });
    const missing = r.roots.filter((x) => !x.exists);
    if (missing.length) { err(t('wiz.paths.missing', { list: missing.map((x) => x.arr).join(', ') })); $('#wp-check').click(); return false; }
    const ro = r.roots.filter((x) => !x.writable);
    if (ro.length && !confirm(t('wiz.paths.readOnly', { list: ro.map((x) => x.local).join(', ') }))) return false;
    const noPlex = r.roots.filter((x) => x.plex && !x.plex.ok);
    if (noPlex.length && !confirm(t('wiz.paths.noPlex', { list: noPlex.map((x) => x.plex.path).join(', ') }))) { $('#wp-check').click(); return false; }
    return true;
  }
  if (name === 'login') {
    const on = $('#wa-on').checked, user = $('#wa-user').value.trim(), pw = $('#wa-pass').value;
    if (!on) { await put('/api/auth', { enabled: false }); return true; }
    if (pw && pw.length < 8) { err(t('err.short')); return false; }
    await put('/api/auth', { enabled: true, user, password: pw });
    $('#logout-btn').hidden = false;
    return true;
  }
  if (name === 'done') {
    await post('/api/setup/complete');
    S_.setupDone = true; S_.lib = null;
    location.hash = '#/';
    return false;
  }
  return true;
}

export async function renderWizard(S) {
  S_ = S;
  const r = await api('/api/settings');
  setSettingsState(r.settings);
  if (!S.setupDone) step = 0;
  draw();
}
