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
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json();
  const { sessionId, rows } = body || {};
  if (!sessionId || !Array.isArray(rows)) return new Response(JSON.stringify({ error: 'sessionId and rows[] required' }), { status: 400 });
  // Normalize and "upsert" by sku
  const existing = await readJSON(`counts:${sessionId}`, []);
  const bySku = Object.fromEntries(existing.map(r => [r.sku, r]));
  const result = [...existing];
  for (const r of rows) {
    const base = {
      id: bySku[r.sku]?.id ?? (result.length ? Math.max(...result.map(x => x.id)) + 1 : 1),
      session_id: sessionId,
      city: String(r.city ?? '').trim(),
      sku: String(r.sku ?? '').trim(),
      name: String(r.name ?? '').trim(),
      system_qty: Number(r.system_qty ?? 0),
      committed_qty: Number(r.committed_qty ?? 0),
      counted_qty: bySku[r.sku]?.counted_qty ?? null,
      updated_at: new Date().toISOString(),
    };
    if (bySku[r.sku]) {
      // replace existing
      const idx = result.findIndex(x => x.sku === r.sku);
      result[idx] = { ...bySku[r.sku], ...base, id: bySku[r.sku].id };
    } else {
      result.push(base);
    }
  }
  await writeJSON(`counts:${sessionId}`, result);
  return new Response(JSON.stringify({ inserted: result.length }), { status: 200, headers: { 'content-type': 'application/json' } });
}
