# Sharbatly Count — Netlify Functions + Blobs

This build persists **all data in Netlify** using:
- **Netlify Functions** as the API (`/api/*`)
- **Netlify Blobs** as the shared data store (JSON docs; last write wins)

No external DB (like Supabase) required.

## Deploy
1) Push to a Git repo and connect in Netlify.
2) Build command: `npm run build`
3) Publish directory: `dist`
4) No env vars required.

## Endpoints
- `GET /api/sessions` – list sessions
- `POST /api/sessions` – create { name, city }
- `GET /api/mapping?sessionId=...` – get mapping
- `PUT /api/mapping` – body { sessionId, mapping }
- `GET /api/counts?sessionId=...` – list rows
- `POST /api/counts/seed` – body { sessionId, rows: [{city,sku,name,system_qty,committed_qty}] }
- `PATCH /api/counts` – body { id, counted_qty }
- `GET /api/destructions?sessionId=...` – list
- `POST /api/destructions` – body { sessionId, sku, name, qty, reason }
- `DELETE /api/destructions?id=...` – remove

Data model is stored under keys in Netlify Blobs:
- `sessions` (array)
- `mapping:{sessionId}`
- `counts:{sessionId}` (array)
- `destructions:{sessionId}` (array)
