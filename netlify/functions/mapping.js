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
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
    const mapping = await readJSON(`mapping:${sessionId}`, null);
    return new Response(JSON.stringify(mapping), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (req.method === 'PUT') {
    const body = await req.json();
    const { sessionId, mapping } = body || {};
    if (!sessionId || !mapping) return new Response(JSON.stringify({ error: 'sessionId and mapping required' }), { status: 400 });
    await writeJSON(`mapping:${sessionId}`, mapping);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
