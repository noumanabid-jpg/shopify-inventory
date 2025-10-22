import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Layers3,
  Upload,
  RefreshCw,
  Loader2,
  ClipboardCheck,
  Clipboard,
  ClipboardList,
  PackageOpen,
  Download,
} from "lucide-react";

/* ----------------- helpers ----------------- */
const toNumber = (v) => {
  const n =
    typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const csvFromRows = (rows) => Papa.unparse(rows);
const blobFromText = (text, mime = "text/csv;charset=utf-8;") =>
  new Blob([text], { type: mime });
const downloadTextAs = (text, filename) => {
  const blob = blobFromText(text);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
const api = async (path, opts = {}) => {
  const r = await fetch(`/api/${path}`, opts);
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`${r.status} ${r.statusText} :: ${msg}`);
  }
  if (r.status === 204) return null;
  return r.json();
};

export default function App() {
  const [page, setPage] = useState("count");
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [newSessionName, setNewSessionName] = useState("");

  const [city, setCity] = useState("Jeddah");

  const [csvHeaders, setCsvHeaders] = useState([]);
  const [mapping, setMapping] = useState({
    city: "",
    sku: "",
    name: "",
    systemQty: "",
    committedQty: "",
  });
  const [rawRows, setRawRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fileInfo, setFileInfo] = useState("");

  const [rows, setRows] = useState([]);
  const [destructions, setDestructions] = useState([]);

  /* ----------- Counting: Scan field + mode ----------- */
  const [scanMode, setScanMode] = useState("count"); // 'count' | 'filter'
  const [scanInput, setScanInput] = useState("");
  const [scanLog, setScanLog] = useState([]); // used only in 'count' mode
  const [filterSku, setFilterSku] = useState(""); // active filter in 'filter' mode
  const scanTimerRef = useRef(null);

  // NEW: submitScan now accepts the value so we avoid stale state
  const submitScan = async (valRaw) => {
    const val = (valRaw ?? scanInput).trim();
    if (!val || !sessionId) return;

    const row = rows.find((r) => r.city === city && r.sku === val);
    setScanInput("");

    if (scanMode === "filter") {
      // exact match filter for stability + no duplicates
      setFilterSku(val);
      return;
    }

    // COUNT MODE: record + increment
    setScanLog((prev) => [
      { sku: val, name: row?.name || "(not found)", ts: Date.now() },
      ...prev,
    ]);

    if (!row) return;
    const next = (row.counted_qty ?? 0) + 1;

    // optimistic UI
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, counted_qty: next } : r)));

    try {
      await api("counts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, id: row.id, counted_qty: next }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const scheduleAuto = (nextVal) => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(() => submitScan(nextVal), 120);
  };

  const clearScans = () => {
    if (scanMode === "count") setScanLog([]);
    setFilterSku("");
    setScanInput("");
  };

  /* ----------- Destructions scan ----------- */
  const [dScanInput, setDScanInput] = useState("");
  const [dScanLog, setDScanLog] = useState([]);
  const dScanTimerRef = useRef(null);
  const [destroySku, setDestroySku] = useState("");
  const [destroyQty, setDestroyQty] = useState("");
  const [destroyReason, setDestroyReason] = useState("Poor quality");

  const submitDScan = (valRaw) => {
    const val = (valRaw ?? dScanInput).trim();
    if (!val || !sessionId) return;
    const row = rows.find((r) => r.city === city && r.sku === val);
    setDScanLog((prev) => [{ sku: val, name: row?.name || "(not found)", ts: Date.now() }, ...prev]);
    setDScanInput("");
    if (row) setDestroySku(row.sku);
  };
  const scheduleDAuto = (nextVal) => {
    if (dScanTimerRef.current) clearTimeout(dScanTimerRef.current);
    dScanTimerRef.current = setTimeout(() => submitDScan(nextVal), 120);
  };
  const clearDScans = () => {
    setDScanLog([]);
    setDScanInput("");
    setDestroySku("");
  };

  useEffect(() => {
    (async () => {
      const list = await api("sessions");
      setSessions(list);
    })().catch(console.error);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const m = await api(`mapping?sessionId=${sessionId}`).catch(() => null);
      if (m) setMapping(m);
      const c = await api(`counts?sessionId=${sessionId}`);
      setRows(c);
      const d = await api(`destructions?sessionId=${sessionId}`);
      setDestructions(d);
    })().catch(console.error);
  }, [sessionId]);

  const fileInputRef = useRef(null);
  const triggerFileDialog = () => fileInputRef.current?.click();
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

  const canSeed =
    !!sessionId &&
    !!rawRows.length &&
    !!mapping.city &&
    !!mapping.sku &&
    !!mapping.name &&
    !!mapping.systemQty;

  const seedSessionFromCsv = async () => {
    if (!canSeed) {
      alert("Select a Session and map all required columns first.");
      return;
    }
    try {
      await api("mapping", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, mapping }),
      });

      const norm = rawRows.map((r) => ({
        city: String(r[mapping.city] ?? "").trim(),
        sku: String(r[mapping.sku] ?? "").trim(),
        name: String(r[mapping.name] ?? "").trim(),
        system_qty: toNumber(r[mapping.systemQty]),
        committed_qty: mapping.committedQty ? toNumber(r[mapping.committedQty]) : 0,
      }));

      await api("counts-seed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, rows: norm }),
      });

      const c = await api(`counts?sessionId=${sessionId}`);
      setRows(c);
      alert("Session seeded!");
    } catch (err) {
      console.error(err);
      alert(`Seeding failed: ${err.message}`);
    }
  };

  /* ------------ FILTERING (with dedupe & instant update) ------------ */
  const filtered = useMemo(() => {
    // Base city filter
    let base = rows.filter((r) => r.city === city);

    // Filter-on-scan: exact SKU match for stability
    if (scanMode === "filter" && filterSku) {
      base = base.filter((r) => r.sku === filterSku);
    }

    // Dedupe by SKU to avoid accidental duplicates
    const seen = new Set();
    base = base.filter((r) => {
      const key = r.sku || r.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return base;
  }, [rows, city, scanMode, filterSku]);

  const totals = useMemo(() => {
    let sys = 0,
      cnt = 0,
      committed = 0,
      diff = 0,
      lines = 0;
    for (const r of filtered) {
      const c = r.counted_qty ?? r.system_qty;
      sys += Number(r.system_qty || 0);
      committed += Number(r.committed_qty || 0);
      cnt += Number(c || 0);
      diff += c - Number(r.system_qty || 0);
      lines++;
    }
    return { sys, cnt, committed, diff, lines };
  }, [filtered]);

  const addDestruction = async () => {
    if (!sessionId) return;
    const sku = destroySku.trim();
    const qty = toNumber(destroyQty);
    const row = rows.find((r) => r.sku === sku && r.city === city);
    if (!row || !sku || qty <= 0) return;
    const line = await api("destructions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        sku,
        name: row.name,
        qty,
        reason: destroyReason || "Poor quality",
      }),
    });
    setDestructions((prev) => [...prev, line]);
    setDestroyQty("");
  };
  const removeDestruction = async (id) => {
    await api(`destructions?id=${id}&sessionId=${sessionId}`, { method: "DELETE" });
    setDestructions((prev) => prev.filter((d) => d.id !== id));
  };

  const exportReport = () => {
    const report = filtered.map((r) => {
      const c = r.counted_qty ?? r.system_qty;
      return {
        City: r.city,
        SKU: r.sku,
        Name: r.name,
        SystemQty: r.system_qty,
        CommittedQty: r.committed_qty,
        CountedQty: c,
        Difference: c - r.system_qty,
      };
    });
    downloadTextAs(
      csvFromRows(report),
      `count_report_${city}_${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 py-3 flex items-center gap-2">
          <Layers3 className="w-6 h-6" />
          <h1 className="text-base sm:text-lg font-semibold">Sharbatly Count</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-3 pt-3">
        <div className="flex w-full rounded-xl bg-white border p-1 gap-1 sticky top-[56px] z-20">
          <button
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              page === "count" ? "bg-neutral-900 text-white" : "bg-transparent"
            }`}
            onClick={() => setPage("count")}
          >
            <ClipboardCheck className="w-4 h-4 inline mr-1" />
            Counting
          </button>
          <button
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              page === "destructions" ? "bg-neutral-900 text-white" : "bg-transparent"
            }`}
            onClick={() => setPage("destructions")}
          >
            <Clipboard className="w-4 h-4 inline mr-1" />
            Destructions
          </button>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-3 py-4 space-y-6">
        {/* Session + City (unchanged UI from previous reply) */}
        <section className="bg-white border rounded-2xl shadow-sm">
          <div className="px-3 py-3 border-b flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            <h2 className="font-semibold text-sm sm:text-base">Session</h2>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="text-sm">Select existing</label>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">— Choose a session —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm">City / Branch</label>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="Jeddah">Jeddah</option>
                <option value="Riyadh">Riyadh</option>
                <option value="Dammam">Dammam</option>
              </select>
            </div>

            <div className="sm:col-span-2 flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="New session name"
              />
              <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={() => {
                if (!newSessionName.trim()) return;
                api("sessions", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name: newSessionName.trim(), city }),
                }).then((s) => {
                  setSessions((prev) => [s, ...prev]);
                  setSessionId(s.id);
                  setNewSessionName("");
                }).catch(console.error);
              }}>
                Create
              </button>
            </div>
          </div>
        </section>

        {/* COUNTING PAGE */}
        {page === "count" && !!sessionId && (
          <>
            {/* Upload + mapping section ... (keep from previous file) */}
            {/* Counting workspace */}
            <section className="bg-white border rounded-2xl shadow-sm">
              <div className="px-3 py-3 border-b flex items-center gap-2">
                <PackageOpen className="w-4 h-4" />
                <h2 className="font-semibold text-sm sm:text-base">Counting — Workspace</h2>
              </div>

              <div className="p-3">
                {/* Scan controls */}
                <div className="mb-2 flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="flex-1">
                    <label className="text-sm font-medium block mb-1">SKU / Scan Barcode</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Focus here, then scan"
                      value={scanInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        setScanInput(v);
                        scheduleAuto(v); // instant filter/count using current value
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
                          submitScan(e.currentTarget.value);
                        }
                      }}
                      autoFocus
                    />
                    {scanMode === "filter" && filterSku && (
                      <div className="mt-2 inline-flex items-center gap-2 text-sm">
                        <span className="px-2 py-1 rounded border bg-neutral-50">
                          Filter: <span className="font-mono">{filterSku}</span>
                        </span>
                        <button className="px-2 py-1 border rounded" onClick={clearScans}>
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="sm:w-56">
                    <label className="text-sm font-medium block mb-1">Scan Mode</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2"
                      value={scanMode}
                      onChange={(e) => {
                        setScanMode(e.target.value);
                        setScanInput("");
                        setFilterSku("");
                        setScanLog([]);
                      }}
                    >
                      <option value="count">Count (+1 on each scan)</option>
                      <option value="filter">Filter (show scanned only)</option>
                    </select>
                  </div>
                  <div className="sm:w-auto">
                    <label className="text-sm font-medium block mb-1"> </label>
                    <button className="px-3 py-2 border rounded-lg w-full" onClick={clearScans}>
                      Clear scans
                    </button>
                  </div>
                </div>

                {scanMode === "count" && scanLog.length > 0 && (
                  <div className="mb-4 border rounded-lg p-2 bg-neutral-50 max-h-44 overflow-auto text-sm">
                    <div className="font-medium mb-1">Recent scans</div>
                    <ul className="space-y-1">
                      {scanLog.map((s) => (
                        <li key={s.ts} className="border-b last:border-none pb-1">
                          <span className="font-mono">{s.sku}</span>{" "}
                          <span className="text-neutral-600">— {s.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* TABLE: mobile-friendly grid; hide SKU/Barcode on mobile */}
                <div className="border rounded-2xl overflow-hidden">
                  <div className="grid grid-cols-9 sm:grid-cols-12 bg-neutral-100 text-xs font-semibold px-3 py-2">
                    <div className="hidden sm:block sm:col-span-3">SKU/Barcode</div>
                    <div className="col-span-5 sm:col-span-5">Name</div>
                    <div className="col-span-1 text-right">System</div>
                    <div className="col-span-1 text-right">Committed</div>
                    <div className="col-span-2 text-right">Counted</div>
                  </div>
                  <div className="max-h-[480px] overflow-auto divide-y">
                    {filtered.map((r) => (
                      <div key={`${r.id || r.sku}`} className="grid grid-cols-9 sm:grid-cols-12 items-center px-3 py-2 text-sm">
                        <div className="hidden sm:block sm:col-span-3 font-mono truncate" title={r.sku}>
                          {r.sku}
                        </div>
                        <div className="col-span-5 sm:col-span-5 truncate" title={r.name}>
                          {r.name}
                        </div>
                        <div className="col-span-1 text-right tabular-nums">{r.system_qty}</div>
                        <div className="col-span-1 text-right tabular-nums">{r.committed_qty}</div>
                        <div className="col-span-2 text-right">
                          <input
                            inputMode="numeric"
                            className="text-right w-full border rounded-lg px-2 py-1"
                            value={r.counted_qty ?? ""}
                            placeholder={String(r.system_qty)}
                            onChange={async (e) => {
                              const v = e.target.value === "" ? null : toNumber(e.target.value);
                              setRows((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, counted_qty: v } : x))
                              );
                              try {
                                await api("counts", {
                                  method: "PATCH",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ sessionId, id: r.id, counted_qty: v }),
                                });
                              } catch {}
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {!filtered.length && (
                      <div className="p-6 text-center text-sm text-neutral-500">
                        No items to show for {city}.{" "}
                        {scanMode === "filter" && filterSku
                          ? "Clear the filter or scan a different SKU."
                          : "Seed CSV or pick a different session."}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 text-[11px] text-neutral-500 border-t">
                    *Diff is exported in CSV (Counted − System). Live view shows System/Committed/Counted.
                  </div>
                </div>

                {/* Totals + export (unchanged) */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="px-2 py-1 border rounded-lg">Lines {totals.lines}</span>
                    <span className="px-2 py-1 border rounded-lg">System {totals.sys}</span>
                    <span className="px-2 py-1 border rounded-lg">Committed {totals.committed}</span>
                    <span className="px-2 py-1 border rounded-lg">Counted {totals.cnt}</span>
                    <span className="px-2 py-1 border rounded-lg">
                      Δ {totals.diff > 0 ? `+${totals.diff}` : totals.diff}
                    </span>
                  </div>
                  <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={exportReport}>
                    <Download className="w-4 h-4 inline-block mr-1" />
                    Export Main CSV
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* DESTRUCTIONS PAGE (kept same mobile tweak for columns if you want later) */}
        {page === "destructions" && !!sessionId && (
          <section className="bg-white border rounded-2xl shadow-sm">
            <div className="px-3 py-3 border-b flex items-center gap-2">
              <Clipboard className="w-4 h-4" />
              <h2 className="font-semibold text-sm sm:text-base">Destructions (Write-Off)</h2>
            </div>

            <div className="p-3 space-y-4">
              {/* Scan/search on destructions */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">SKU / Scan Barcode</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Focus here, then scan"
                    value={dScanInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDScanInput(v);
                      scheduleDAuto(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (dScanTimerRef.current) clearTimeout(dScanTimerRef.current);
                        submitDScan(e.currentTarget.value);
                      }
                    }}
                  />
                </div>
                <div className="sm:w-auto">
                  <label className="text-sm font-medium block mb-1"> </label>
                  <button className="px-3 py-2 border rounded-lg w-full" onClick={clearDScans}>
                    Clear scans
                  </button>
                </div>
              </div>

              {dScanLog.length > 0 && (
                <div className="border rounded-lg p-2 bg-neutral-50 max-h-40 overflow-auto text-sm">
                  <div className="font-medium mb-1">Recent scans</div>
                  <ul className="space-y-1">
                    {dScanLog.map((s) => (
                      <li key={s.ts} className="border-b last:border-none pb-1">
                        <span className="font-mono">{s.sku}</span>{" "}
                        <span className="text-neutral-600">— {s.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-sm">SKU</label>
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={destroySku}
                    onChange={(e) => setDestroySku(e.target.value)}
                    placeholder="Type or paste SKU"
                  />
                </div>
                <div>
                  <label className="text-sm">Quantity to Destroy</label>
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    inputMode="numeric"
                    value={destroyQty}
                    onChange={(e) => setDestroyQty(e.target.value)}
                    placeholder="e.g., 5"
                  />
                </div>
                <div>
                  <label className="text-sm">Reason</label>
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={destroyReason}
                    onChange={(e) => setDestroyReason(e.target.value)}
                    placeholder="Poor quality / Damaged / Expired"
                  />
                </div>
                <div className="flex items-end">
                  <button className="px-3 py-2 rounded-lg bg-black text-white w-full" onClick={addDestruction}>
                    Add Line
                  </button>
                </div>
              </div>

              <div className="border rounded-2xl overflow-hidden">
                <div className="grid grid-cols-9 sm:grid-cols-12 bg-neutral-100 text-xs font-semibold px-3 py-2">
                  <div className="hidden sm:block sm:col-span-3">SKU/Barcode</div>
                  <div className="col-span-5 sm:col-span-5">Name</div>
                  <div className="col-span-2 sm:col-span-2 text-right">Destroyed</div>
                  <div className="col-span-2 sm:col-span-2 text-right">Action</div>
                </div>
                <div className="max-h-[360px] overflow-auto divide-y">
                  {destructions.map((d) => (
                    <div key={d.id} className="grid grid-cols-9 sm:grid-cols-12 items-center px-3 py-2 text-sm">
                      <div className="hidden sm:block sm:col-span-3 font-mono truncate" title={d.sku}>
                        {d.sku}
                      </div>
                      <div className="col-span-5 sm:col-span-5 truncate" title={d.name}>
                        {d.name}
                      </div>
                      <div className="col-span-2 sm:col-span-2 text-right">{d.qty}</div>
                      <div className="col-span-2 sm:col-span-2 text-right">
                        <button className="px-2 py-1 border rounded-lg" onClick={() => removeDestruction(d.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {!destructions.length && (
                    <div className="p-4 text-sm text-neutral-500">No destructions yet.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
