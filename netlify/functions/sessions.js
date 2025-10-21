import { getStore } from '@netlify/blobs';

const store = getStore('sharbatly-count'); // namespace for this site

async function readJSON(key, fallback) {
  const data = await store.get(key, { type: 'json' });
  return data ?? structuredClone(fallback);
}
async function writeJSON(key, value) {
  await store.setJSON(key, value);
  return value;
}


export default async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const sessions = await readJSON('sessions', []);
    return new Response(JSON.stringify(sessions), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (req.method === 'POST') {
    const body = await req.json();
    const { name, city } = body || {};
    if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400 });
    const sessions = await readJSON('sessions', []);
    const id = crypto.randomUUID();
    const session = { id, name, city: city || '', created_at: new Date().toISOString() };
    sessions.unshift(session);
    await writeJSON('sessions', sessions);
    return new Response(JSON.stringify(session), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
