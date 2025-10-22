// netlify/functions/admin-wipe.mjs
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const key = event.queryStringParameters?.key || '';
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // All namespaces used by the app
  const namespaces = ['sessions', 'counts', 'destructions', 'mapping'];

  const summary = {};
  for (const ns of namespaces) {
    const store = getStore(ns);
    const { blobs } = await store.list();     // [{ key, size, metadata }]
    summary[ns] = { before: blobs.length, deleted: 0 };

    for (const b of blobs) {
      await store.delete(b.key);
      summary[ns].deleted += 1;
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, summary }),
  };
};
