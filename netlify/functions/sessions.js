// netlify/functions/sessions.js
import { getStore } from '@netlify/blobs';

const store = getStore('sharbatly-count'); // your namespace

async function readJSON(key, fallback) {
  const data = await store.get(key, { type: 'json' });
  return data ?? structuredClone(fallback);
}
async function writeJSON(key, value) {
  await store.setJSON(key, value);
  return value;
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default async (req) => {
  const url = new URL(req.url);
  const { searchParams } = url;

  if (req.method === 'GET') {
    const sessions = await readJSON('sessions', []);
    return json(sessions);
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { name, city } = body || {};
    if (!name) return json({ error: 'name required' }, 400);

    const sessions = await readJSON('sessions', []);
    const id = (globalThis.crypto?.randomUUID?.() ||
      require('crypto').randomUUID());
    const session = {
      id,
      name,
      city: city || '',
      created_at: new Date().toISOString(),
    };
    sessions.unshift(session);
    await writeJSON('sessions', sessions);
    return json(session, 201);
  }

  if (req.method === 'DELETE') {
    // admin guard
    const adminKey = searchParams.get('key') || '';
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const id = searchParams.get('id'); // optional

    if (id) {
      // delete a single session + any blobs whose key mentions this id
      const beforeSessions = await readJSON('sessions', []);
      const afterSessions = beforeSessions.filter((s) => s.id !== id);
      await writeJSON('sessions', afterSessions);

      const { blobs = [] } = await store.list();
      let deleted = 0;
      for (const b of blobs) {
        if (b.key.includes(id)) {
          await store.delete(b.key).catch(() => {});
          deleted += 1;
        }
      }
      return json({
        ok: true,
        mode: 'single',
        sessionId: id,
        deletedRelatedBlobs: deleted,
        sessionsRemaining: afterSessions.length,
      });
    }

    // delete EVERYTHING in this namespace (including 'sessions')
    const { blobs = [] } = await store.list();
    let deleted = 0;
    for (const b of blobs) {
      await store.delete(b.key).catch(() => {});
      deleted += 1;
    }
    return json({ ok: true, mode: 'all', deleted });
  }

  return new Response('Method Not Allowed', { status: 405 });
};
