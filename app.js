import { APP, DEVELOPER } from './config.js';
import * as drive from './sync.js';
import { dayKey, toMin, waterTimes, requestPermission, reschedule, startTicker } from './reminders.js';

const KEY = 'jk.data';
const uid = () => Math.random().toString(36).slice(2, 9);

// ওজন/পেশি বাড়ানোর লক্ষ্যে সাজানো ডিফল্ট পরিকল্পনা (সেটিংস থেকে বদলানো যায়)
const DEFAULTS = () => ({
  v: 1, updatedAt: 0,
  profile: { name: '', targetKg: null },
  settings: { waterGoal: 3000, glass: 250, wake: '07:00', sleep: '23:00', interval: 90, remind: false },
  meals: [
    { id: uid(), name: 'সকালের নাস্তা', time: '08:00', hint: 'ডিম, রুটি বা পরোটা, কলা' },
    { id: uid(), name: 'মধ্য-সকালের নাস্তা', time: '10:30', hint: 'বাদাম, খেজুর, দুধ' },
    { id: uid(), name: 'দুপুরের খাবার', time: '13:30', hint: 'ভাত, মাছ বা মাংস, ডাল, সবজি' },
    { id: uid(), name: 'বিকেলের নাস্তা', time: '17:00', hint: 'ছোলা, পিনাট বাটার টোস্ট, ফল' },
    { id: uid(), name: 'রাতের খাবার', time: '20:30', hint: 'ভাত বা রুটি, মুরগি বা ডিম, সবজি' },
    { id: uid(), name: 'ঘুমের আগে', time: '22:15', hint: 'এক গ্লাস দুধ' },
  ],
  days: {}, weights: [],
});

let state = load();
let tab = 'today';
let syncMsg = '';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.v === 1) { const d = DEFAULTS(); return { ...d, ...s, profile: { ...d.profile, ...s.profile }, settings: { ...d.settings, ...s.settings } }; }
  } catch {}
  return DEFAULTS();
}

let syncTimer;
function save() {
  state.updatedAt = Date.now();
  localStorage.setItem(KEY, JSON.stringify(state));
  reschedule(state).catch(() => {});
  clearTimeout(syncTimer);
  if (drive.hasToken()) syncTimer = setTimeout(() => doSync(true), 4000);
}

// ---------- helpers ----------
const BN = '০১২৩৪৫৬৭৮৯';
const bn = (s) => String(s).replace(/\d/g, (d) => BN[d]);
const num = (n, f = 0) => Number(n).toLocaleString('bn-BD', { maximumFractionDigits: f });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => (state.days[dayKey()] ??= { water: [], meals: {} });
const waterOf = (d) => (d?.water || []).reduce((a, w) => a + w.ml, 0);
const mealsOf = (d) => state.meals.filter((m) => d?.meals?.[m.id]).length;
const sortedMeals = () => [...state.meals].sort((a, b) => toMin(a.time) - toMin(b.time));

function timeBn(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const part = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকেল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${part} ${bn((h % 12) || 12)}:${bn(String(m).padStart(2, '0'))}`;
}
function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'শুভ রাত্রি' : h < 12 ? 'শুভ সকাল' : h < 17 ? 'শুভ অপরাহ্ন' : h < 20 ? 'শুভ সন্ধ্যা' : 'শুভ রাত্রি';
  return state.profile.name ? `${g}, ${esc(state.profile.name)}` : g;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
function isComplete(d) { return waterOf(d) >= state.settings.waterGoal && state.meals.length > 0 && mealsOf(d) === state.meals.length; }
function streak() {
  let n = 0; const d = new Date();
  if (!isComplete(state.days[dayKey(d)])) d.setDate(d.getDate() - 1);
  while (isComplete(state.days[dayKey(d)])) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const ICON = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20v-6M12 20V5M19 20v-9"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

// ---------- views ----------
function viewToday() {
  const d = today(), s = state.settings, total = waterOf(d);
  const pct = Math.min(1, total / s.waterGoal), C = 2 * Math.PI * 90;
  const left = Math.max(0, s.waterGoal - total);
  const done = mealsOf(d), meals = sortedMeals();
  const n = new Date(), nowMin = n.getHours() * 60 + n.getMinutes();
  const next = meals.find((m) => !d.meals[m.id] && toMin(m.time) >= nowMin - 45);
  const nextWater = waterTimes(s).find((t) => t > nowMin);
  const dateStr = new Date().toLocaleDateString('bn-BD', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
  <header class="top"><div class="date">${dateStr}</div><h1>${greeting()}</h1></header>
  <section class="card">
    <h2>পানি <small>${left ? `আরও ${num(left)} মি.লি. বাকি` : 'আজকের লক্ষ্য পূরণ হয়েছে'}</small></h2>
    <div class="ring-wrap">
      <svg viewBox="0 0 210 210"><defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs>
        <circle class="ring-bg" cx="105" cy="105" r="90"/>
        <circle class="ring-fg" cx="105" cy="105" r="90" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="ring-center"><div class="big">${num(total)}</div><div class="unit">/ ${num(s.waterGoal)} মি.লি.</div><div class="pct">${num(pct * 100)}%</div></div>
    </div>
    <div class="row">
      <button class="btn primary" data-act="water" data-ml="${s.glass}">+ ১ গ্লাস (${num(s.glass)})</button>
      <button class="btn" data-act="water" data-ml="500">+ ${num(500)} মি.লি.</button>
    </div>
    ${d.water.length ? '<button class="undo" data-act="undo">শেষেরটি বাদ দিন</button>' : ''}
    ${left && nextWater != null ? `<div class="muted" style="text-align:center;margin-top:8px">পরের রিমাইন্ডার: ${timeBn(`${Math.floor(nextWater / 60)}:${String(nextWater % 60).padStart(2, '0')}`)}</div>` : ''}
  </section>
  <section class="card">
    <h2>আজকের খাবার <small>${num(done)}/${num(meals.length)}</small></h2>
    <div class="bar"><i style="width:${meals.length ? (done / meals.length) * 100 : 0}%"></i></div>
    ${meals.map((m) => `
      <button class="meal ${d.meals[m.id] ? 'done' : ''} ${m === next ? 'next' : ''}" data-act="meal" data-id="${m.id}">
        <span class="check">${ICON.check}</span>
        <span><div class="name">${esc(m.name)}</div>${m.hint ? `<div class="hint">${esc(m.hint)}</div>` : ''}</span>
        <span class="time">${timeBn(m.time)}</span>
      </button>`).join('') || '<div class="muted">সেটিংস থেকে খাবারের তালিকা যোগ করুন।</div>'}
  </section>`;
}

function viewProgress() {
  const s = state.settings, days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const wk = days.map((d) => state.days[dayKey(d)]);
  const avg = wk.reduce((a, d) => a + waterOf(d), 0) / 7;
  const mealPct = state.meals.length ? (wk.reduce((a, d) => a + mealsOf(d), 0) / (7 * state.meals.length)) * 100 : 0;
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const last = w.at(-1), first = w[0], tgt = state.profile.targetKg;
  let chart = '';
  if (w.length > 1) {
    const ks = w.map((x) => x.kg), lo = Math.min(...ks, tgt || Infinity) - 0.5, hi = Math.max(...ks, tgt || -Infinity) + 0.5;
    const X = (i) => 8 + (i / (w.length - 1)) * 304, Y = (k) => 100 - ((k - lo) / (hi - lo)) * 90;
    chart = `<svg class="chart" viewBox="0 0 320 110" preserveAspectRatio="none">
      ${tgt ? `<line x1="0" x2="320" y1="${Y(tgt)}" y2="${Y(tgt)}" stroke="#28a860" stroke-width="1.5" stroke-dasharray="5 5" opacity=".7"/>` : ''}
      <polyline fill="none" stroke="#0a84ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${w.map((x, i) => `${X(i)},${Y(x.kg)}`).join(' ')}"/>
      ${w.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.kg)}" r="4" fill="#0a84ff"/>`).join('')}</svg>`;
  }
  const diff = last && first ? last.kg - first.kg : 0;
  return `
  <header class="top"><div class="date">গত ৭ দিন</div><h1>অগ্রগতি</h1></header>
  <div class="stats">
    <div class="card stat"><b>${num(streak())}</b><span>দিনের ধারা</span></div>
    <div class="card stat"><b>${num(avg / 1000, 1)}</b><span>গড় লিটার/দিন</span></div>
    <div class="card stat"><b>${num(mealPct)}%</b><span>খাবার সম্পন্ন</span></div>
  </div>
  <section class="card">
    <h2>পানি ও খাবার</h2>
    <div class="week">${days.map((d, i) => {
      const p = Math.min(100, (waterOf(wk[i]) / s.waterGoal) * 100);
      return `<div class="day ${p >= 100 ? 'full' : ''} ${i === 6 ? 'today' : ''}"><div class="col"><i style="height:${p}%"></i></div>${d.toLocaleDateString('bn-BD', { weekday: 'short' })}<em>${num(mealsOf(wk[i]))}/${num(state.meals.length)}</em></div>`;
    }).join('')}</div>
  </section>
  <section class="card">
    <h2>ওজন <small>${last ? `${num(last.kg, 1)} কেজি` : ''}</small></h2>
    ${w.length > 1 ? `<div class="muted">শুরু থেকে ${diff >= 0 ? '+' : '−'}${num(Math.abs(diff), 1)} কেজি${tgt && last ? ` · লক্ষ্যে পৌঁছাতে ${num(Math.max(0, tgt - last.kg), 1)} কেজি বাকি` : ''}</div>` : '<div class="muted">সপ্তাহে একবার সকালে খালি পেটে ওজন লিখুন।</div>'}
    ${chart}
    <div class="row" style="margin-top:10px"><input type="number" id="kg" inputmode="decimal" step="0.1" placeholder="কেজি" style="flex:1;width:auto;text-align:left"><button class="btn primary small" data-act="weight">আজকের ওজন যোগ</button></div>
    <div style="margin-top:10px">${w.slice(-4).reverse().map((x) => `<div class="wlist"><span>${new Date(x.date + 'T00:00').toLocaleDateString('bn-BD', { day: 'numeric', month: 'long' })}</span><b>${num(x.kg, 1)} কেজি</b></div>`).join('')}</div>
  </section>`;
}

function viewSettings() {
  const s = state.settings, p = state.profile, m = drive.meta();
  const last = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  let driveUi;
  if (!drive.configured()) driveUi = '<div class="muted">Google Client ID এখনও সেট করা হয়নি, তাই Drive ব্যাকআপ বন্ধ আছে।</div>';
  else if (!m.connected) driveUi = '<div class="muted" style="margin-bottom:12px">আপনার তথ্য আপনার নিজের Google Drive-এ নিরাপদে জমা থাকবে।</div><div class="row"><button class="btn primary" data-act="signin">Google দিয়ে সাইন ইন</button></div>';
  else driveUi = `<div class="muted" style="margin-bottom:12px">${m.last ? `শেষ সিঙ্ক: ${new Date(m.last).toLocaleString('bn-BD', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}` : 'সংযুক্ত'}</div>
    <div class="row"><button class="btn primary" data-act="signin">এখনই সিঙ্ক করুন</button><button class="btn ghost danger" data-act="signout">সাইন আউট</button></div>`;
  const dev = DEVELOPER.name ? `<div class="dev"><div class="muted">ডেভেলপার</div><div class="n">${esc(DEVELOPER.name)}</div>${DEVELOPER.credentials ? `<div class="muted">${esc(DEVELOPER.credentials)}</div>` : ''}${DEVELOPER.contact ? `<div class="muted">${esc(DEVELOPER.contact)}</div>` : ''}</div>` : '';
  return `
  <header class="top"><div class="date">আপনার মতো করে সাজান</div><h1>সেটিংস</h1></header>
  <section class="card"><h2>প্রোফাইল</h2>
    <div class="field"><label>নাম</label><input type="text" data-set="profile.name" value="${esc(p.name)}" placeholder="আপনার নাম"></div>
    <div class="field"><label>লক্ষ্য ওজন<span class="sub">কেজি</span></label><input type="number" step="0.5" data-set="profile.targetKg" value="${p.targetKg ?? ''}"></div>
  </section>
  <section class="card"><h2>পানি</h2>
    <div class="field"><label>দৈনিক লক্ষ্য<span class="sub">মি.লি.</span></label><input type="number" step="50" data-set="settings.waterGoal" value="${s.waterGoal}"></div>
    ${last ? `<div class="field"><label>ওজন অনুযায়ী হিসাব<span class="sub">${num(last.kg, 1)} কেজি × ৩৫ মি.লি.</span></label><button class="btn small" data-act="calc">বসান</button></div>` : ''}
    <div class="field"><label>গ্লাসের মাপ<span class="sub">মি.লি.</span></label><input type="number" step="10" data-set="settings.glass" value="${s.glass}"></div>
  </section>
  <section class="card"><h2>রিমাইন্ডার</h2>
    <div class="field"><label>রিমাইন্ডার চালু<span class="sub">পানি ও খাবারের সময়ে নোটিফিকেশন</span></label><span class="switch"><input type="checkbox" data-set="settings.remind" ${s.remind ? 'checked' : ''}><i></i></span></div>
    <div class="field"><label>ঘুম থেকে ওঠা</label><input type="time" data-set="settings.wake" value="${s.wake}"></div>
    <div class="field"><label>ঘুমাতে যাওয়া</label><input type="time" data-set="settings.sleep" value="${s.sleep}"></div>
    <div class="field"><label>পানির রিমাইন্ডার</label><select data-set="settings.interval">${[60, 90, 120].map((v) => `<option value="${v}" ${+s.interval === v ? 'selected' : ''}>প্রতি ${v === 60 ? '১ ঘণ্টা' : v === 90 ? 'দেড় ঘণ্টা' : '২ ঘণ্টা'}</option>`).join('')}</select></div>
  </section>
  <section class="card"><h2>খাবারের তালিকা</h2>
    ${sortedMeals().map((x) => `<div class="mealedit">
      <input type="text" data-meal="${x.id}" data-k="name" value="${esc(x.name)}" placeholder="খাবারের নাম">
      <input type="time" data-meal="${x.id}" data-k="time" value="${x.time}">
      <button class="icon-btn" data-act="delmeal" data-id="${x.id}" aria-label="মুছুন">×</button>
      <input type="text" class="hintin" data-meal="${x.id}" data-k="hint" value="${esc(x.hint)}" placeholder="কী খাবেন (ঐচ্ছিক)"></div>`).join('')}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="addmeal">+ নতুন খাবার যোগ করুন</button></div>
  </section>
  <section class="card"><h2>Google Drive ব্যাকআপ</h2>${driveUi}${syncMsg ? `<div class="muted" style="margin-top:10px">${esc(syncMsg)}</div>` : ''}</section>
  <section class="card about"><img class="logo" src="icon.svg" alt=""><b>${APP.name}</b><div class="muted">সংস্করণ ${bn(APP.version)}</div>${dev}</section>`;
}

function render() {
  document.getElementById('view').innerHTML = { today: viewToday, progress: viewProgress, settings: viewSettings }[tab]();
  document.getElementById('tabs').innerHTML = [['today', 'আজ'], ['progress', 'অগ্রগতি'], ['settings', 'সেটিংস']]
    .map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${ICON[k]}${l}</button>`).join('');
}

// ---------- actions ----------
async function doSync(silent) {
  try {
    if (!drive.hasToken()) { if (silent) return; await drive.signIn(); }
    syncMsg = 'সিঙ্ক হচ্ছে…'; if (!silent && tab === 'settings') render();
    const pulled = await drive.sync(state);
    if (pulled?.v === 1) { state = pulled; localStorage.setItem(KEY, JSON.stringify(state)); reschedule(state).catch(() => {}); }
    syncMsg = '';
    if (!silent) toast(pulled ? 'Drive থেকে তথ্য আনা হয়েছে' : 'Drive-এ ব্যাকআপ হয়েছে');
  } catch (e) {
    syncMsg = e.message === 'offline' ? 'ইন্টারনেট সংযোগ নেই।' : 'সিঙ্ক করা যায়নি — আবার চেষ্টা করুন।';
  }
  if (!silent || tab === 'settings') render();
}

const actions = {
  water(el) {
    const before = waterOf(today());
    today().water.push({ t: Date.now(), ml: +el.dataset.ml });
    if (before < state.settings.waterGoal && waterOf(today()) >= state.settings.waterGoal) toast('দারুণ! আজকের পানির লক্ষ্য পূরণ হয়েছে');
  },
  undo() { today().water.pop(); },
  meal(el) { const m = today().meals; if (m[el.dataset.id]) delete m[el.dataset.id]; else m[el.dataset.id] = true; },
  weight() {
    const kg = parseFloat(document.getElementById('kg').value);
    if (!(kg > 20 && kg < 300)) return toast('সঠিক ওজন লিখুন'), false;
    state.weights = state.weights.filter((x) => x.date !== dayKey());
    state.weights.push({ date: dayKey(), kg });
    toast('ওজন সংরক্ষণ হয়েছে');
  },
  calc() {
    const last = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    state.settings.waterGoal = Math.round((last.kg * 35) / 50) * 50;
  },
  addmeal() { state.meals.push({ id: uid(), name: 'নতুন খাবার', time: '12:00', hint: '' }); },
  delmeal(el) { state.meals = state.meals.filter((m) => m.id !== el.dataset.id); },
  signin() { doSync(false); return false; },
  signout() { drive.signOut(); syncMsg = ''; render(); return false; },
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = e.target.closest('[data-act]');
  if (a && actions[a.dataset.act](a) !== false) { save(); render(); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.meal) {
    const m = state.meals.find((x) => x.id === el.dataset.meal);
    if (el.dataset.k === 'time' && !el.value) return render();
    m[el.dataset.k] = el.value.trim();
    save(); if (el.dataset.k === 'time') render();
    return;
  }
  if (!el.dataset.set) return;
  const [grp, k] = el.dataset.set.split('.');
  let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value.trim();
  if (el.type === 'number') {
    if (k === 'targetKg') v = v > 0 ? v : null;
    else if (!(v > 0)) return render();
  }
  if (el.type === 'time' && !v) return render();
  if (k === 'interval') v = +v;
  if (k === 'remind' && v && !(await requestPermission())) { v = false; toast('নোটিফিকেশনের অনুমতি পাওয়া যায়নি'); }
  state[grp][k] = v;
  save(); render();
});

// নতুন দিন শুরু হলে বা অ্যাপে ফিরে এলে পর্দা হালনাগাদ
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab !== 'settings') render(); });
setInterval(() => { if (tab === 'today' && !document.hidden) render(); }, 60000);

if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
reschedule(state).catch(() => {});
startTicker(() => state);
