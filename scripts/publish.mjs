// Publishes due items from schedule.json to Instagram via the Instagram API with Instagram Login.
// Runs in GitHub Actions. Env: IG_TOKEN (secret), DRY_RUN=1 to only check the token.
import fs from 'node:fs';

const TOKEN = (process.env.IG_TOKEN || '').trim();
// Instagram-login tokens start with "IG"; Facebook/business (system user) tokens use graph.facebook.com
const HOST = TOKEN.startsWith('IG') ? 'https://graph.instagram.com/' : 'https://graph.facebook.com/';
const API = HOST + (process.env.IG_API_VERSION || 'v23.0');
const IG_USER_ID = process.env.IG_USER_ID || '17841452611939528';
const RAW = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/main/`;
const FILE = 'schedule.json';

if (!TOKEN) { console.error('IG_TOKEN secret is missing'); process.exit(1); }

async function call(method, path, params = {}) {
  const url = new URL(API + path);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === 'GET'
    ? await fetch(url + '?' + body)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(JSON.stringify(json.error || json));
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const media = (p) => (p.startsWith('http') ? p : RAW + p);

async function waitReady(id) {
  for (let i = 0; i < 40; i++) {
    const { status_code } = await call('GET', `/${id}`, { fields: 'status_code' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`container ${id}: ${status_code}`);
    await sleep(15000);
  }
  throw new Error(`container ${id} not ready in time`);
}

async function container(userId, item) {
  const isVideo = (p) => /\.(mp4|mov)$/i.test(p);
  if (item.type === 'carousel') {
    const children = [];
    for (const p of item.media) {
      const c = await call('POST', `/${userId}/media`, isVideo(p)
        ? { media_type: 'VIDEO', video_url: media(p), is_carousel_item: 'true' }
        : { image_url: media(p), is_carousel_item: 'true' });
      await waitReady(c.id);
      children.push(c.id);
    }
    return call('POST', `/${userId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: item.caption || '' });
  }
  const p = item.media[0];
  if (item.type === 'story') {
    return call('POST', `/${userId}/media`, isVideo(p)
      ? { media_type: 'STORIES', video_url: media(p) }
      : { media_type: 'STORIES', image_url: media(p) });
  }
  if (item.type === 'reel') {
    return call('POST', `/${userId}/media`, { media_type: 'REELS', video_url: media(p), caption: item.caption || '', share_to_feed: 'true' });
  }
  return call('POST', `/${userId}/media`, { image_url: media(p), caption: item.caption || '' });
}

function writeStatus(st) {
  let old = {};
  try { old = JSON.parse(fs.readFileSync('status.json', 'utf8')); } catch {}
  if (old.ok !== st.ok || old.detail !== st.detail) {
    fs.writeFileSync('status.json', JSON.stringify({ ...st, checked_at: new Date().toISOString() }, null, 2) + '\n');
  }
}
let me;
try {
  const info = await call('GET', `/${IG_USER_ID}`, { fields: 'username' });
  me = { user_id: IG_USER_ID, username: info.username };
  console.log(`Connected as @${me.username} (${me.user_id}) via ${HOST}`);
  writeStatus({ ok: true, detail: `@${me.username} via ${HOST}` });
} catch (e) {
  writeStatus({ ok: false, detail: String(e.message).slice(0, 400) });
  throw e;
}
if (process.env.DRY_RUN === '1') process.exit(0);

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const now = Date.now();
let changed = false, failed = 0;

for (const item of data.items) {
  if (item.status !== 'scheduled' || new Date(item.at).getTime() > now) continue;
  try {
    const c = await container(me.user_id, item);
    await waitReady(c.id);
    const pub = await call('POST', `/${me.user_id}/media_publish`, { creation_id: c.id });
    item.status = 'published';
    item.media_id = pub.id;
    item.published_at = new Date().toISOString();
    console.log(`✓ ${item.id} published (${pub.id})`);
  } catch (e) {
    item.attempts = (item.attempts || 0) + 1;
    item.last_error = String(e.message).slice(0, 500);
    if (item.attempts >= 3) item.status = 'failed';
    failed++;
    console.error(`✗ ${item.id}: ${item.last_error}`);
  }
  changed = true;
  await sleep(5000);
}

if (changed) fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
if (failed) process.exitCode = 1;
