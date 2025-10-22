// CommonJS function + dynamic ESM import for @netlify/blobs
exports.handler = async (event) => {
  const { getStore } = await import('@netlify/blobs');

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

  // Try automatic Netlify Blobs context first (matches your working functions)
  let useManual = false;
  const namespaces = ['sessions', 'counts', 'destructions', 'mapping'];
  const summary = {};

  try {
    // Probe one store to see if automatic context works
    await getStore('sessions').list();
  } catch {
    useManual = true;
  }

  // If automatic context isn't available, require siteID+token (fallback)
  let siteID, token;
  if (useManual) {
    siteID = process.env.NETLIFY_SITE_ID;
    token = process.env.NETLIFY_API_TOKEN;
    if (!siteID || !token) {
      return {
        statusCode: 500,
        body:
          'Blobs auto-context not available AND NETLIFY_SITE_ID/NETLIFY_API_TOKEN not set. Add those env vars or re-deploy.',
      };
    }
  }

  // Helper to get a store in either mode
  const get = (name) => (useManual ? getStore({ name, siteID, token }) : getStore(name));

  for (const ns of namespaces) {
    try {
      const store = get(ns);
      const { blobs = [] } = await store.list();
      summary[ns] = { before: blobs.length, deleted: 0 };
      for (const b of blobs) {
        await store.delete(b.key);
        summary[ns].deleted += 1;
      }
    } catch (e) {
      summary[ns] = { error: String(e) };
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, mode: useManual ? 'manual' : 'auto', summary }),
  };
};
