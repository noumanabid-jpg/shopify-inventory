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
    const lines = await readJSON(`destructions:${sessionId}`, []);
    return new Response(JSON.stringify(lines), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (req.method === 'POST') {
    const body = await req.json();
    const { sessionId, sku, name, qty, reason } = body || {};
    if (!sessionId || !sku) return new Response(JSON.stringify({ error: 'sessionId and sku required' }), { status: 400 });
    const lines = await readJSON(`destructions:${sessionId}`, []);
    const id = lines.length ? Math.max(...lines.map(l => l.id)) + 1 : 1;
    const line = { id, session_id: sessionId, sku, name: name || '', qty: Number(qty || 0), reason: reason || '', created_at: new Date().toISOString() };
    lines.push(line);
    await writeJSON(`destructions:${sessionId}`, lines);
    return new Response(JSON.stringify(line), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !id) return new Response(JSON.stringify({ error: 'sessionId and id required' }), { status: 400 });
    const lines = await readJSON(`destructions:${sessionId}`, []);
    const next = lines.filter(l => l.id !== id);
    await writeJSON(`destructions:${sessionId}`, next);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
