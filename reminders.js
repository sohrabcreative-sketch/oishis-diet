// রিমাইন্ডার: APK-তে Capacitor LocalNotifications (অ্যাপ বন্ধ থাকলেও বাজে),
// ব্রাউজারে অ্যাপ খোলা থাকা অবস্থায় Notification API।
const native = () => !!window.Capacitor?.isNativePlatform?.();
const LN = () => window.Capacitor.Plugins.LocalNotifications;
const FIRED = 'jk.fired';

export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function waterTimes(s) {
  const out = [], end = toMin(s.sleep);
  for (let t = toMin(s.wake); t < end; t += Number(s.interval)) out.push(t);
  return out;
}

// একটি দিনের সব রিমাইন্ডার: [{min, key, title, body}]
function plan(state) {
  const items = waterTimes(state.settings).map((min) => ({
    min, key: 'w' + min, kind: 'water',
    title: 'পানি পান করার সময় হয়েছে', body: 'এক গ্লাস পানি পান করে অ্যাপে যোগ করুন।',
  }));
  for (const m of state.meals) items.push({
    min: toMin(m.time), key: 'm' + m.id, kind: 'meal', id: m.id,
    title: m.name, body: m.hint ? `খাবারের সময় — ${m.hint}` : 'খাবারের সময় হয়েছে — খেয়ে টিক দিন।',
  });
  return items.sort((a, b) => a.min - b.min);
}

function skipToday(item, state) {
  const d = state.days[dayKey()] || {};
  if (item.kind === 'meal') return !!d.meals?.[item.id];
  const total = (d.water || []).reduce((a, w) => a + w.ml, 0);
  return total >= state.settings.waterGoal;
}

export async function requestPermission() {
  if (native()) return (await LN().requestPermissions()).display === 'granted';
  if (!('Notification' in window)) return false;
  return (await Notification.requestPermission()) === 'granted';
}

// অবস্থা বদলালেই ডাকুন — পরের ৭ দিনের নোটিফিকেশন নতুন করে সাজায় (শুধু APK-তে)।
export async function reschedule(state) {
  if (!native()) return;
  const pending = await LN().getPending();
  if (pending.notifications.length) await LN().cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!state.settings.remind) return;
  const items = plan(state), now = Date.now(), notifications = [];
  for (let d = 0; d < 7; d++) {
    items.forEach((it, i) => {
      const at = new Date(); at.setDate(at.getDate() + d); at.setHours(0, it.min, 0, 0);
      if (at.getTime() <= now || (d === 0 && skipToday(it, state))) return;
      notifications.push({ id: d * 100 + i + 1, title: it.title, body: it.body, schedule: { at, allowWhileIdle: true } });
    });
  }
  if (notifications.length) await LN().schedule({ notifications });
}

// ব্রাউজারে: অ্যাপ খোলা থাকলে প্রতি ৩০ সেকেন্ডে সময় মিলিয়ে দেখে।
export function startTicker(getState) {
  if (native()) return;
  const tick = async () => {
    const state = getState();
    if (!state.settings.remind || !('Notification' in window) || Notification.permission !== 'granted') return;
    const today = dayKey(), n = new Date(), nowMin = n.getHours() * 60 + n.getMinutes();
    let fired = JSON.parse(localStorage.getItem(FIRED) || '{}');
    if (fired.date !== today) fired = { date: today, keys: [] };
    for (const it of plan(state)) {
      if (nowMin < it.min || nowMin - it.min > 5 || fired.keys.includes(it.key)) continue;
      fired.keys.push(it.key);
      if (skipToday(it, state)) continue;
      const opt = { body: it.body, icon: 'icon.svg', tag: it.key };
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(it.title, opt); else new Notification(it.title, opt);
    }
    localStorage.setItem(FIRED, JSON.stringify(fired));
  };
  tick(); setInterval(tick, 30000);
}
