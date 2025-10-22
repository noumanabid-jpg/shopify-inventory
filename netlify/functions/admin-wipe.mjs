// netlify/functions/admin-wipe.mjs
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const key = event.queryStringParameters?.key || '';
  const confirm = event.queryStringParameters?.confirm || '';

  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (confirm !== 'yes') {
    return {
      statusCode: 400,
      body:
        'Safety check: add &confirm=yes to actually wipe. Example: /admin-wipe?key=...&confirm=yes',
    };
  }

  // Manual Blobs context (fixes MissingBlobsEnvironmentError)
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    return {
      statusCode: 500,
      body:
        'Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN env vars. Add both in Site settings → Environment variables.',
    };
  }

  const namespaces = ['sessions', 'counts', 'destructions', 'mapping'];
  const summary = {};

  for (const ns of namespaces) {
    const store = getStore({ name: ns, siteID, token });
    const { blobs } = await store.list(); // [{ key }]
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
