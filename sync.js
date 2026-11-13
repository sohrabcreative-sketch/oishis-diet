// Google Drive ব্যাকআপ — ডেটা ব্যবহারকারীর নিজের Drive-এর লুকানো appDataFolder-এ থাকে।
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'jolkhabar-data.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const META_KEY = 'jk.sync';

let token = null, tokenExp = 0, tokenClient = null, fileId = null;

export const configured = () => !!GOOGLE_CLIENT_ID;
export const meta = () => JSON.parse(localStorage.getItem(META_KEY) || '{}');
const setMeta = (m) => localStorage.setItem(META_KEY, JSON.stringify(m));
export const hasToken = () => !!token && Date.now() < tokenExp;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => rej(new Error('offline'));
    document.head.appendChild(s);
  });
}

// ব্যবহারকারীর ট্যাপ থেকে ডাকতে হবে (পপআপ খোলে)।
export async function signIn() {
  await loadGis();
  return new Promise((res, rej) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPE,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error));
        token = r.access_token;
        tokenExp = Date.now() + (r.expires_in - 60) * 1000;
        setMeta({ ...meta(), connected: true });
        res();
      },
      error_callback: (e) => rej(new Error(e.type || 'popup')),
    });
    tokenClient.requestAccessToken({ prompt: meta().connected ? '' : 'consent' });
  });
}

export function signOut() {
  if (token && window.google) google.accounts.oauth2.revoke(token, () => {});
  token = null; fileId = null;
  setMeta({});
}

async function gfetch(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401) { token = null; throw new Error('auth'); }
  if (!r.ok) throw new Error('drive ' + r.status);
  return r;
}

async function findFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await gfetch(`${API}?spaces=appDataFolder&q=${q}&fields=files(id)`);
  fileId = (await r.json()).files?.[0]?.id || null;
  return fileId;
}

async function upload(data) {
  const body = JSON.stringify(data);
  const id = await findFile();
  if (id) {
    await gfetch(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
  } else {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: FILE, parents: ['appDataFolder'] })], { type: 'application/json' }));
    form.append('file', new Blob([body], { type: 'application/json' }));
    const r = await gfetch(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body: form });
    fileId = (await r.json()).id;
  }
}

// দুই দিকের মধ্যে যেটি নতুন সেটি জেতে। Drive-এর ডেটা নতুন হলে সেটি ফেরত দেয়।
export async function sync(local) {
  if (!hasToken()) throw new Error('auth');
  const id = await findFile();
  let remote = null;
  if (id) remote = await (await gfetch(`${API}/${id}?alt=media`)).json().catch(() => null);
  let pulled = null;
  if (remote && (remote.updatedAt || 0) > (local.updatedAt || 0)) pulled = remote;
  else if (!remote || (remote.updatedAt || 0) < (local.updatedAt || 0)) await upload(local);
  setMeta({ ...meta(), connected: true, last: Date.now() });
  return pulled;
}
