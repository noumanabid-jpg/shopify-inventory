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
    const rows = await readJSON(`counts:${sessionId}`, []);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (req.method === 'PATCH') {
    const body = await req.json();
    const { id, counted_qty } = body || {};
    if (id === undefined) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
    const sessionId = body.sessionId;
    if (!sessionId) return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
    const rows = await readJSON(`counts:${sessionId}`, []);
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return new Response(JSON.stringify({ error: 'row not found' }), { status: 404 });
    rows[idx].counted_qty = counted_qty === null || counted_qty === '' ? null : Number(counted_qty);
    rows[idx].updated_at = new Date().toISOString();
    await writeJSON(`counts:${sessionId}`, rows);
    return new Response(JSON.stringify(rows[idx]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
