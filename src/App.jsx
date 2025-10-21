import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, Upload, RefreshCw, Loader2, Search, Barcode, Building2, Layers3, Plus, Trash2, FileSpreadsheet, ClipboardCheck, ClipboardList } from "lucide-react";

const toNumber = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const csvFromRows = (rows) => Papa.unparse(rows);
const blobFromText = (text, mime = "text/csv;charset=utf-8;") => new Blob([text], { type: mime });
const downloadTextAs = (text, filename) => {
  const blob = blobFromText(text);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export default function App() {
  // sessions
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [city, setCity] = useState("");

  // meta
  const [preparedBy, setPreparedBy] = useState("");
  const [exporterEmail, setExporterEmail] = useState("");
  const [recipients, setRecipients] = useState("");
  const [emailAfterExport, setEmailAfterExport] = useState(false);

  // mapping
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [mapping, setMapping] = useState({ city: "", sku: "", name: "", systemQty: "", committedQty: "" });

  // rows
  const [rawRows, setRawRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fileInfo, setFileInfo] = useState("");
  const [rows, setRows] = useState([]);
  const [destructions, setDestructions] = useState([]);

  // filters
  const [search, setSearch] = useState("");
  const [scanner, setScanner] = useState("");
  const [onlyDiscrepancies, setOnlyDiscrepancies] = useState(false);
  const [countModeFull, setCountModeFull] = useState(true);

  const fileInputRef = useRef(null);
  const triggerFileDialog = () => fileInputRef.current?.click();

  // helpers
  const api = async (path, opts={}) => {
    const res = await fetch(`/api/${path}`, opts);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    if (res.status === 204) return null;
    return res.json();
  };

  // load sessions
  useEffect(() => { (async () => {
    const list = await api('sessions');
    setSessions(list);
  })().catch(console.error); }, []);

  // when selected session changes, load its data
  useEffect(() => { if (!sessionId) return; (async () => {
    // mapping
    const m = await api(`mapping?sessionId=${sessionId}`).catch(()=>null);
    if (m) setMapping(m);
    // rows
    const c = await api(`counts?sessionId=${sessionId}`);
    setRows(c);
    // destructions
    const d = await api(`destructions?sessionId=${sessionId}`);
    setDestructions(d);
  })().catch(console.error); }, [sessionId]);

  // create session
  const createSession = async () => {
    if (!newSessionName.trim()) return;
    const s = await api('sessions', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: newSessionName.trim(), city }) });
    setSessions(prev => [s, ...prev]);
    setSessionId(s.id);
    setNewSessionName("");
  };

  // parse CSV
  const onFileSelected = (file) => {
    if (!file) return;
    setBusy(true);
    setFileInfo(`${file.name} • ${(file.size / 1024).toFixed(1)} KB`);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields || [];
        setCsvHeaders(headers.filter((h) => typeof h === "string" && h.trim() !== ""));
        setRawRows(res.data);
        setBusy(false);
      },
      error: () => setBusy(false),
    });
  };
  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    prevent(e);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileSelected(f);
  };

  // seed from CSV
  const seedSessionFromCsv = async () => {
    if (!sessionId || !rawRows.length || !mapping.city || !mapping.sku || !mapping.name || !mapping.systemQty) return;
    await api('mapping', { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId, mapping }) });
    const norm = rawRows.map(r => ({
      city: String(r[mapping.city] ?? '').trim(),
      sku: String(r[mapping.sku] ?? '').trim(),
      name: String(r[mapping.name] ?? '').trim(),
      system_qty: toNumber(r[mapping.systemQty]),
      committed_qty: mapping.committedQty ? toNumber(r[mapping.committedQty]) : 0,
    }));
    await api('counts-seed', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId, rows: norm }) });
    const c = await api(`counts?sessionId=${sessionId}`);
    setRows(c);
  };

  const setCount = async (id, value) => {
    const counted = value === "" ? null : toNumber(value);
    setRows(prev => prev.map(r => r.id === id ? { ...r, counted_qty: counted } : r)); // optimistic
    await api('counts', { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId, id, counted_qty: counted }) });
  };

  // filtering & totals
  const destroyedBySku = useMemo(() => {
    const map = {};
    for (const d of destructions) map[d.sku] = (map[d.sku] || 0) + Number(d.qty || 0);
    return map;
  }, [destructions]);

  const filtered = useMemo(() => {
    let base = rows;
    if (city !== undefined) base = base.filter(r => (city === "" ? (r.city === "" || r.city === undefined) : r.city === city));
    const q = (countModeFull ? search : (search || scanner)).toLowerCase();
    if (q) base = base.filter(r => String(r.sku).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
    if (onlyDiscrepancies) {
      base = base.filter(r => {
        const c = r.counted_qty ?? r.system_qty;
        const destroyed = destroyedBySku[r.sku] || 0;
        return (Math.max(0, c - destroyed)) !== r.system_qty;
      });
    }
    return base;
  }, [rows, city, search, scanner, onlyDiscrepancies, destroyedBySku, countModeFull]);

  const totals = useMemo(() => {
    let sys = 0, cnt = 0, diff = 0, committed = 0, lines = 0;
    for (const r of rows) {
      const c = r.counted_qty ?? r.system_qty;
      const destroyed = destroyedBySku[r.sku] || 0;
      const effective = Math.max(0, c - destroyed);
      sys += Number(r.system_qty || 0);
      cnt += Number(c || 0);
      diff += (effective - Number(r.system_qty || 0));
      committed += Number(r.committed_qty || 0);
      lines++;
    }
    return { sys, cnt, diff, committed, lines };
  }, [rows, destroyedBySku]);

  // destructions
  const [destroySku, setDestroySku] = useState("");
  const [destroyQty, setDestroyQty] = useState("");
  const [destroyReason, setDestroyReason] = useState("Poor quality");
  const addDestruction = async () => {
    if (!sessionId) return;
    const sku = destroySku.trim();
    const qty = toNumber(destroyQty);
    const row = rows.find(r => r.sku === sku && (city === "" ? (r.city === "" || r.city === undefined) : r.city === city));
    if (!row || !sku || qty <= 0) return;
    const line = await api('destructions', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId, sku, name: row.name, qty, reason: destroyReason || 'Poor quality' }) });
    setDestructions(prev => [...prev, line]);
    setDestroyQty("");
  };
  const removeDestruction = async (id) => {
    await api(`destructions?id=${id}&sessionId=${sessionId}`, { method: 'DELETE' });
    setDestructions(prev => prev.filter(d => d.id !== id));
  };

  const exampleTemplate = () => {
    const example = [
      { City: "Jeddah", SKU: "APPLE-RED-01-JED", Name: "Apple Red 1kg (Jeddah)", SystemQty: 120, CommittedQty: 10 },
      { City: "Riyadh", SKU: "APPLE-RED-01-RYD", Name: "Apple Red 1kg (Riyadh)", SystemQty: 80, CommittedQty: 0 },
      { City: "", SKU: "BANANA-01-UNK", Name: "Banana 1kg (No City)", SystemQty: 50, CommittedQty: 0 },
    ];
    downloadTextAs(csvFromRows(example), "inventory_template.csv");
  };

  const exportReport = () => {
    const report = rows.map(r => {
      const c = r.counted_qty ?? r.system_qty;
      const destroyed = destroyedBySku[r.sku] || 0;
      const effective = Math.max(0, c - destroyed);
      return {
        City: r.city, SKU: r.sku, Name: r.name,
        SystemQty: r.system_qty, CommittedQty: r.committed_qty,
        CountedQty: c, DestroyedQty: destroyed,
        EffectiveCounted: effective, Difference: effective - r.system_qty
      };
    });
    downloadTextAs(csvFromRows(report), `count_report_${city || 'all'}_${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <div className="min-h-screen text-neutral-900">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Layers3 className="w-6 h-6" />
          <h1 className="text-xl font-semibold">Sharbatly Count — Netlify Functions</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Sessions */}
        <section className="bg-white border rounded-2xl shadow-sm">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4"/><h2 className="font-semibold">Session</h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-sm">City / Branch</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2" value={city} onChange={(e)=>setCity(e.target.value)} placeholder="e.g., Jeddah"/>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">Select existing</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2" value={sessionId} onChange={(e)=>setSessionId(e.target.value)}>
                <option value="">— Choose a session —</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name} {s.city ? `· ${s.city}` : ""}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2" value={newSessionName} onChange={(e)=>setNewSessionName(e.target.value)} placeholder="New session name (e.g., Oct-21 Full Count)"/>
              <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={createSession}>Create</button>
            </div>
          </div>
        </section>

        {/* CSV Upload & Mapping */}
        {!!sessionId && (
          <section className="bg-white border rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Upload className="w-4 h-4"/><h2 className="font-semibold">Upload Shopify CSV → Seed Session</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <input ref={fileInputRef} type="file" accept="text/csv,.csv" className="hidden" onChange={(e)=>e.target.files?.[0] && onFileSelected(e.target.files[0])}/>
                <button className="px-4 py-2 rounded-lg bg-black text-white" onClick={triggerFileDialog}><span className="inline-flex items-center gap-2"><Upload className="w-4 h-4"/> Choose CSV</span></button>
                {busy && <span className="inline-flex items-center gap-2 px-2 py-1 border rounded-lg text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Parsing…</span>}
                {!busy && !!rawRows.length && <span className="px-2 py-1 border rounded-lg text-sm">Rows: {rawRows.length}</span>}
                {fileInfo && <span className="px-2 py-1 border rounded-lg text-sm bg-neutral-50">{fileInfo}</span>}
                <button className="px-2 py-1 border rounded-lg text-sm" onClick={()=>{ setCsvHeaders([]); setRawRows([]); setFileInfo(""); }}><span className="inline-flex items-center gap-1"><RefreshCw className="w-4 h-4"/> Reset</span></button>
                <button className="px-2 py-1 border rounded-lg text-sm" onClick={exampleTemplate}><FileSpreadsheet className="w-4 h-4"/> Template</button>
              </div>

              {!!csvHeaders.length && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {["city","sku","name","systemQty"].map((f) => (
                      <div key={f}>
                        <label className="text-sm">{({city:'City / Branch',sku:'SKU or Barcode',name:'Product / Variant Name',systemQty:'System Quantity'})[f]}</label>
                        <select className="mt-1 w-full border rounded-lg px-3 py-2" value={mapping[f]} onChange={(e)=>setMapping(prev=>({...prev, [f]: e.target.value}))}>
                          <option value="">Select CSV column</option>
                          {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <p className="text-xs text-neutral-500 mt-1">Map to your CSV headers</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-2">
                    <div>
                      <label className="text-sm">Committed Quantity (optional)</label>
                      <select className="mt-1 w-full border rounded-lg px-3 py-2" value={mapping.committedQty} onChange={(e)=>setMapping(prev=>({...prev, committedQty: e.target.value}))}>
                        <option value="">(None)</option>
                        {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white" onClick={seedSessionFromCsv}>Seed Session from CSV (Cloud)</button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* Workspace */}
        {!!sessionId && (
          <section className="bg-white border rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <ClipboardList className="w-4 h-4"/><h2 className="font-semibold">Counting — Workspace</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"/>
                  <input className="w-full border rounded-lg pl-9 pr-3 py-2" placeholder="Search by SKU or Name" value={search} onChange={(e)=>setSearch(e.target.value)}/>
                </div>
                <div className="relative">
                  <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"/>
                  <input className="w-full border rounded-lg pl-9 pr-3 py-2" placeholder="Scan / type barcode or SKU" value={scanner} onChange={(e)=>setScanner(e.target.value)}/>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm flex items-center gap-2">
                    <input type="checkbox" checked={onlyDiscrepancies} onChange={(e)=>setOnlyDiscrepancies(e.target.checked)}/>
                    Show discrepancies only
                  </label>
                </div>
              </div>

              <div className="border rounded-2xl overflow-hidden">
                <div className="grid grid-cols-12 bg-neutral-100 text-xs font-semibold px-3 py-2">
                  <div className="col-span-2">SKU</div>
                  <div className="col-span-4">Name</div>
                  <div className="col-span-1 text-right">System</div>
                  <div className="col-span-1 text-right">Committed</div>
                  <div className="col-span-2 text-right">Counted</div>
                  <div className="col-span-2 text-right">Δ Diff*</div>
                </div>
                <div className="max-h-[480px] overflow-auto divide-y">
                  {filtered.map(r => {
                    const c = r.counted_qty ?? r.system_qty;
                    const destroyed = (destructions.reduce((acc, d) => d.sku === r.sku ? acc + Number(d.qty||0) : acc, 0));
                    const effective = Math.max(0, c - destroyed);
                    const diff = effective - r.system_qty;
                    const diffClass = diff === 0 ? "" : diff > 0 ? "text-emerald-600" : "text-red-600";
                    return (
                      <div key={r.id} className="grid grid-cols-12 items-center px-3 py-2 text-sm">
                        <div className="col-span-2 font-mono truncate" title={r.sku}>{r.sku}</div>
                        <div className="col-span-4 truncate" title={r.name}>{r.name}</div>
                        <div className="col-span-1 text-right tabular-nums">{r.system_qty}</div>
                        <div className="col-span-1 text-right tabular-nums">{r.committed_qty}</div>
                        <div className="col-span-2 text-right">
                          <input inputMode="numeric" className="text-right w-full border rounded-lg px-2 py-1"
                            value={r.counted_qty === null || r.counted_qty === undefined ? "" : String(r.counted_qty)}
                            placeholder={String(r.system_qty)}
                            onChange={(e)=>setCount(r.id, e.target.value)} />
                        </div>
                        <div className={`col-span-2 text-right tabular-nums font-medium ${diffClass}`}>{diff > 0 ? `+${diff}` : diff}</div>
                      </div>
                    );
                  })}
                  {!filtered.length && (
                    <div className="p-6 text-center text-sm text-neutral-500">No items to show. Seed the session from CSV first.</div>
                  )}
                </div>
                <div className="px-3 py-2 text-[11px] text-neutral-500 border-t">*Diff = (Counted − Destroyed) − System</div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="px-2 py-1 border rounded-lg">Lines {totals.lines}</span>
                  <span className="px-2 py-1 border rounded-lg">System {totals.sys}</span>
                  <span className="px-2 py-1 border rounded-lg">Committed {totals.committed}</span>
                  <span className="px-2 py-1 border rounded-lg">Counted {totals.cnt}</span>
                  <span className={`px-2 py-1 border rounded-lg ${totals.diff === 0 ? "" : totals.diff > 0 ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-300"}`}>Δ {totals.diff > 0 ? `+${totals.diff}` : totals.diff}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={exportReport}><Download className="w-4 h-4 inline-block mr-1"/> Export Main CSV</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Destructions */}
        {!!sessionId && (
          <section className="bg-white border rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <ClipboardList className="w-4 h-4"/><h2 className="font-semibold">Destructions (Write-Off)</h2>
            </div>
            <div className="p-4 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="md:col-span-2">
                  <label className="text-sm">SKU</label>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2" value={destroySku} onChange={(e)=>setDestroySku(e.target.value)} placeholder="Type or paste SKU"/>
                </div>
                <div>
                  <label className="text-sm">Quantity to Destroy</label>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2" inputMode="numeric" value={destroyQty} onChange={(e)=>setDestroyQty(e.target.value)} placeholder="e.g., 5"/>
                </div>
                <div>
                  <label className="text-sm">Reason</label>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2" value={destroyReason} onChange={(e)=>setDestroyReason(e.target.value)} placeholder="Poor quality / Damaged / Expired"/>
                </div>
                <div className="flex items-end">
                  <button className="px-3 py-2 rounded-lg bg-black text-white w-full" onClick={addDestruction}><Plus className="w-4 h-4 inline-block mr-1"/> Add Line</button>
                </div>
              </div>

              <div className="border rounded-2xl overflow-hidden">
                <div className="grid grid-cols-12 bg-neutral-100 text-xs font-semibold px-3 py-2">
                  <div className="col-span-3">SKU</div>
                  <div className="col-span-5">Name</div>
                  <div className="col-span-2 text-right">Destroyed</div>
                  <div className="col-span-2 text-right">Action</div>
                </div>
                <div className="max-h-[300px] overflow-auto divide-y">
                  {destructions.map(d => (
                    <div key={d.id} className="grid grid-cols-12 items-center px-3 py-2 text-sm">
                      <div className="col-span-3 font-mono truncate" title={d.sku}>{d.sku}</div>
                      <div className="col-span-5 truncate" title={d.name}>{d.name}</div>
                      <div className="col-span-2 text-right">{d.qty}</div>
                      <div className="col-span-2 text-right">
                        <button className="px-2 py-1 border rounded-lg" onClick={()=>removeDestruction(d.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                  {!destructions.length && <div className="p-4 text-sm text-neutral-500">No destructions yet.</div>}
                </div>
              </div>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
