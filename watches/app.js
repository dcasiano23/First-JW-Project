/* Watch Ledger — inventory, sales, profit, market comps, configurations, your own photos & videos,
   pre-ship checks and business documents. Records live in localStorage, photos & videos in IndexedDB —
   both on this device only. Business → Backup keeps a copy. */
(() => {
  "use strict";

  const KEY = "watch-ledger.v1";
  const CAT = window.WatchCatalog;
  const DOCS = window.WatchDocs;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- Storage ---------- */

  const blank = () => ({ watches: [], comps: [], refLooks: {}, business: {}, settings: { currency: "USD", nextInvoice: 1001 } });
  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const data = JSON.parse(raw);
      return { ...blank(), ...data, business: { ...(data.business || {}) }, settings: { ...blank().settings, ...(data.settings || {}) } };
    } catch {
      return blank();
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      toast("Could not save on this device — export a backup now.");
    }
  }
  /* Built-in branding. Anything entered under Business overrides it. */
  const DEFAULT_BIZ = { name: "CIG Timepieces" };
  const abs = (p) => new URL(p, location.href).href;
  const biz = () => ({ ...DEFAULT_BIZ, ...Object.fromEntries(Object.entries(db.business || {}).filter(([, v]) => v)) });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Photos & videos (IndexedDB) ---------- */

  const mediaDB = (() => {
    let opening;
    const open = () =>
      (opening ||= new Promise((res, rej) => {
        const r = indexedDB.open("watch-ledger", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    const run = async (mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction("photos", mode);
        const req = fn(t.objectStore("photos"));
        t.oncomplete = () => res(req && "result" in req ? req.result : undefined);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      all: () => run("readonly", (s) => s.getAll()),
      get: (id) => run("readonly", (s) => s.get(id)),
      put: (rec) => run("readwrite", (s) => s.put(rec)),
      del: (id) => run("readwrite", (s) => s.delete(id)),
      clear: () => run("readwrite", (s) => s.clear()),
    };
  })();

  /* watchId → [{ id, kind, thumb, created, checkId, size, name, duration }] — the files themselves are read on demand. */
  const media = new Map();
  const metaOf = (p) => ({ id: p.id, kind: p.kind || "photo", thumb: p.thumb, created: p.created, checkId: p.checkId || null, size: p.size || 0, name: p.name || "", duration: p.duration || null });
  async function loadMedia() {
    try {
      const all = await mediaDB.all();
      media.clear();
      for (const p of all) {
        if (String(p.watchId).startsWith("ref:")) { mediaDB.del(p.id).catch(() => {}); continue; } // old web reference photos — removed
        if (!media.has(p.watchId)) media.set(p.watchId, []);
        media.get(p.watchId).push(metaOf(p));
      }
      media.forEach((list) => list.sort((a, b) => (a.created || "").localeCompare(b.created || "")));
    } catch { /* storage unavailable (private mode) — app still works */ }
  }
  const mediaFor = (watchId) => media.get(watchId) || [];
  const photosFor = (watchId) => mediaFor(watchId).filter((m) => m.kind === "photo");

  async function shrink(file, max, quality, type = "image/jpeg") {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }
  function videoPoster(file) {
    return new Promise((res) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (thumb) => {
        if (done) return;
        done = true;
        const duration = isFinite(v.duration) ? v.duration : null;
        try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
        URL.revokeObjectURL(url);
        res({ thumb, duration });
      };
      const grab = () => {
        try {
          if (!v.videoWidth) return finish(null);
          const k = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
          const c = document.createElement("canvas");
          c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          finish(c.toDataURL("image/jpeg", 0.75));
        } catch { finish(null); }
      };
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto";
      v.addEventListener("loadedmetadata", async () => {
        // iPhone only decodes frames once playback starts, so play briefly (muted) before seeking.
        try { await v.play(); v.pause(); } catch {}
        try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch { grab(); }
      }, { once: true });
      v.addEventListener("seeked", grab, { once: true });
      v.onerror = () => finish(null);
      setTimeout(() => (v.videoWidth ? grab() : finish(null)), 6000);
      v.src = url;
    });
  }
  let persistAsked = false;
  async function addMedia(watchId, file, extra = {}) {
    if (!persistAsked) { persistAsked = true; try { await navigator.storage?.persist?.(); } catch {} }
    const created = new Date().toISOString();
    let rec;
    if (file.type.startsWith("video/")) {
      const { thumb, duration } = await videoPoster(file);
      rec = { id: uid(), watchId, kind: "video", blob: file, type: file.type, name: file.name || "video", size: file.size, duration, thumb, created, ...extra };
    } else if (file.type.startsWith("image/")) {
      rec = { id: uid(), watchId, kind: "photo", data: await shrink(file, 1800, 0.86), thumb: await shrink(file, 480, 0.8), name: file.name || "photo", size: file.size, created, ...extra };
    } else return null;
    await mediaDB.put(rec);
    if (!media.has(watchId)) media.set(watchId, []);
    media.get(watchId).push(metaOf(rec));
    return rec;
  }
  async function addFiles(watchId, files, extra) {
    const list = [...files].filter((f) => /^(image|video)\//.test(f.type));
    if (!list.length) { toast("Only photos and videos can be added."); return 0; }
    const total = list.reduce((t, f) => t + f.size, 0);
    toast(list.length > 1 ? `Saving ${list.length} files (${fmtSize(total)})…` : list[0].type.startsWith("video/") ? `Saving video (${fmtSize(total)})…` : "Saving photo…", { ms: 60000 });
    let n = 0;
    for (const f of list) {
      try { if (await addMedia(watchId, f, extra)) n++; }
      catch { toast("Not enough space on this device to save that file."); break; }
    }
    if (n) toast(n > 1 ? `${n} files saved` : list[0].type.startsWith("video/") ? "Video saved" : "Photo saved");
    return n;
  }
  async function removeMedia(watchId, id) {
    await mediaDB.del(id);
    media.set(watchId, mediaFor(watchId).filter((m) => m.id !== id));
  }
  async function downloadMedia(id) {
    const rec = await mediaDB.get(id);
    if (!rec) return;
    const ext = rec.kind === "video" ? (rec.name.match(/\.\w+$/)?.[0] || (rec.type?.includes("quicktime") ? ".mov" : ".mp4")) : ".jpg";
    const base = `${rec.kind}-${rec.created.slice(0, 19).replace(/[:T]/g, "-")}`;
    if (rec.kind === "video") saveBlob(rec.blob, base + ext);
    else saveBlob(await (await fetch(rec.data)).blob(), base + ext);
  }
  const isLockedMedia = (w, m) => !!m.checkId && (w.checks || []).some((c) => c.id === m.checkId && c.locked);

  /* ---------- Formatting & helpers ---------- */

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let moneyFmt, money0Fmt;
  function setFormats() {
    const cur = db.settings.currency || "USD";
    try {
      moneyFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 2, minimumFractionDigits: 0 });
      money0Fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 });
    } catch {
      moneyFmt = money0Fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
    }
  }
  setFormats();
  const money = (n) => (n == null || isNaN(n) ? "—" : moneyFmt.format(n));
  const money0 = (n) => (n == null || isNaN(n) ? "—" : money0Fmt.format(n));
  const signed = (n) => `<span class="${n > 0 ? "pos" : n < 0 ? "neg" : ""}">${n > 0 ? "+" : ""}${money(n)}</span>`;
  const pct = (n) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`);
  const num = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const thisMonth = () => today().slice(0, 7);
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };
  const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const fmtSize = (b) => (!b ? "" : b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
  const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
  const monthName = (ym, style = "long") => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, style === "short" ? { month: "short" } : { month: "long", year: "numeric" });
  };
  const daysBetween = (a, b) => (!a || !b ? null : Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normRef = CAT.normRef;

  /* ---------- Money math ---------- */

  const costBasis = (w) => num(w.buyPrice) + num(w.extraCosts);
  const isSold = (w) => w.status === "sold";
  const netProceeds = (w) => num(w.sellPrice) - num(w.sellFees);
  const profit = (w) => (isSold(w) ? netProceeds(w) - costBasis(w) : null);
  const label = (w) => [w.brand, w.model].filter(Boolean).join(" ") || "Untitled watch";

  /* ---------- Pictures (your own photos only) ---------- */

  const lookOf = (w) => CAT.resolve(w, db.refLooks);
  const configText = (w) => CAT.describe(lookOf(w).spec);
  const initials = (s) => (String(s || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("") || "—").toUpperCase();
  const cameraIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
  function placeholderHTML(w, size = "lg") {
    if (size === "sm") return `<div class="ph ph-sm" aria-hidden="true"><span>${esc(initials(w.brand))}</span></div>`;
    return `<div class="ph" role="img" aria-label="No photo yet">
      <div class="ph-mono">${esc(initials(w.brand))}</div>
      <div class="ph-hint">${cameraIcon}No photo yet</div>
    </div>`;
  }
  function pictureHTML(w, size = "lg") {
    const ph = w.id && photosFor(w.id)[0];
    if (ph) return `<img class="pic photo" src="${ph.thumb}" alt="Photo of ${esc(label(w))}" loading="lazy">`;
    const v = w.id && mediaFor(w.id).find((m) => m.kind === "video" && m.thumb);
    if (v) return `<img class="pic photo" src="${v.thumb}" alt="Video still of ${esc(label(w))}" loading="lazy">`;
    return placeholderHTML(w, size);
  }
  /* For a reference (market lists): your own photo of any watch with that reference, else initials. */
  function refThumb(ref, brand) {
    const w = db.watches.find((x) => normRef(x.ref) === normRef(ref) && photosFor(x.id).length);
    return w ? `<img class="pic photo" src="${photosFor(w.id)[0].thumb}" alt="" loading="lazy">` : placeholderHTML({ brand }, "sm");
  }

  /* What a reference is: built-in list first, then anything you've entered before, then the brand from the reference's format. */
  function refInfo(ref) {
    const k = normRef(ref);
    if (k.length < 4) return null;
    const built = CAT.REFDB.lookup(ref);
    if (built && built.how === "list") return built;
    const mine = [...db.watches].reverse().find((x) => normRef(x.ref) === k && x.brand) || [...db.comps].reverse().find((c) => normRef(c.ref) === k && c.brand);
    if (mine) return { brand: mine.brand, model: mine.model || "", caseInfo: mine.caseInfo || "", how: "mine", ref: mine.ref };
    return built;
  }

  /* ---------- Search ---------- */

  function haystack(w) {
    return fold([w.brand, w.model, w.ref, w.caseInfo, w.serial, w.year, w.condition, w.set, w.buyFrom, w.soldVia, w.soldTo, w.buyerEmail, w.notes, configText(w), w.invoiceNo,
      ...(w.checks || []).map((c) => c.tracking)].join(" ")) + " " + normRef(w.ref) + " " + normRef(w.serial);
  }
  function matches(hay, query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    return terms.every((t) => hay.includes(t) || hay.includes(normRef(t)));
  }

  function sameWatch(a, b) {
    const ra = normRef(a.ref), rb = normRef(b.ref);
    if (ra && rb) return ra === rb;
    return fold(a.brand) === fold(b.brand) && fold(a.model) === fold(b.model) && !!fold(a.model);
  }
  function history(target, excludeId) {
    const mine = db.watches.filter((w) => w.id !== excludeId && sameWatch(w, target));
    const paid = mine.filter((w) => num(w.buyPrice) > 0);
    const sold = mine.filter((w) => isSold(w) && num(w.sellPrice) > 0);
    const byDate = (k) => (a, b) => (b[k] || "").localeCompare(a[k] || "");
    paid.sort(byDate("buyDate"));
    sold.sort(byDate("sellDate"));
    return { mine, paid, sold };
  }

  /* Market comps — SOLD prices only feed the numbers. Asking prices are shown separately. */
  function marketFor(target, { days = 180, includeMine = true } = {}) {
    const cutoff = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : "";
    const comps = db.comps.filter((c) => sameWatch(c, target) && (!cutoff || (c.date || "") >= cutoff));
    const soldComps = comps.filter((c) => c.kind !== "asking");
    const asking = comps.filter((c) => c.kind === "asking");
    const prices = soldComps.map((c) => num(c.price));
    if (includeMine) {
      db.watches
        .filter((w) => isSold(w) && sameWatch(w, target) && num(w.sellPrice) > 0 && (!cutoff || (w.sellDate || "") >= cutoff))
        .forEach((w) => prices.push(num(w.sellPrice)));
    }
    return {
      soldCount: prices.length,
      median: median(prices),
      low: prices.length ? Math.min(...prices) : null,
      high: prices.length ? Math.max(...prices) : null,
      askingMedian: median(asking.map((c) => num(c.price))),
      askingCount: asking.length,
      comps: comps.sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    };
  }

  /* What you can pay and still make your target: market median - selling fees - shipping/other - target profit. */
  const buyPlan = () => ({ fee: num(db.settings.planFeePct), ship: num(db.settings.planShip), profit: num(db.settings.planProfit) });
  function maxBuy(median) {
    if (!median) return null;
    const p = buyPlan();
    const breakEven = median * (1 - p.fee / 100) - p.ship;
    return { breakEven, max: breakEven - p.profit, ...p };
  }
  const bestMedian = (t) => { const m90 = marketFor(t, { days: 90 }); if (m90.soldCount) return { m: m90, days: 90 }; const m180 = marketFor(t); return m180.soldCount ? { m: m180, days: 180 } : null; };

  /* ---------- Month numbers ---------- */

  function monthStats(ym) {
    const sold = db.watches.filter((w) => isSold(w) && (w.sellDate || "").startsWith(ym));
    const bought = db.watches.filter((w) => (w.buyDate || "").startsWith(ym));
    const revenue = sold.reduce((s, w) => s + num(w.sellPrice), 0);
    const fees = sold.reduce((s, w) => s + num(w.sellFees), 0);
    const cogs = sold.reduce((s, w) => s + costBasis(w), 0);
    const net = revenue - fees - cogs;
    const held = sold.map((w) => daysBetween(w.buyDate, w.sellDate)).filter((d) => d != null && d >= 0);
    return {
      sold, bought, count: sold.length, revenue, fees, cogs, net,
      margin: revenue ? net / revenue : null,
      avgProfit: sold.length ? net / sold.length : null,
      avgDays: held.length ? Math.round(avg(held)) : null,
      spent: bought.reduce((s, w) => s + costBasis(w), 0),
    };
  }
  const shiftMonth = (ym, delta) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  /* ---------- UI plumbing ---------- */

  const view = $("#view");
  const sheet = $("#sheet");
  const ui = { tab: "dashboard", month: thisMonth(), q: "", filter: "all", sort: "recent", mq: "" };
  let dropTarget = null; // function(files) for the open sheet that accepts pasted / dropped photos & videos

  function toast(msg, { action, ms } = {}) {
    const t = $("#toast");
    // A modal screen sits above the page, so the message has to live inside whichever one is open.
    const host = [$("#ask"), sheet].find((d) => d.open) || document.body;
    if (t.parentNode !== host) host.appendChild(t);
    t.innerHTML =`<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
    if (action) t.querySelector("button").addEventListener("click", () => { t.classList.remove("show"); action.fn(); }, { once: true });
    t.classList.toggle("has-action", !!action);
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), ms || (action ? 9000 : 2800));
  }

  /* In-app confirmation (the browser's own pop-ups can freeze iPhone home-screen apps). */
  function ask(message, { ok = "OK", cancel = "Cancel", danger = false, buttons } = {}) {
    const dlg = $("#ask");
    const list = buttons || [{ label: cancel, value: false }, { label: ok, value: true, kind: danger ? "danger-fill" : "primary" }];
    dlg.innerHTML = `<form method="dialog" class="ask-box"><p>${esc(message).replace(/\n/g, "<br>")}</p><div class="ask-actions">${list.map((b, i) => `<button class="btn ${b.kind || ""}" value="${i}">${esc(b.label)}</button>`).join("")}</div></form>`;
    return new Promise((res) => {
      dlg.addEventListener("close", () => { const i = dlg.returnValue; res(i === "" || i == null ? (buttons ? null : false) : list[+i].value); }, { once: true });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }

  function openSheet(title, html, onReady) {
    dropTarget = null;
    $("#sheet-title").textContent = title;
    $("#sheet-body").innerHTML = html;
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
    onReady && onReady($("#sheet-body"));
  }
  const closeSheet = () => sheet.open && sheet.close();
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) closeSheet();
  });
  sheet.addEventListener("close", () => { dropTarget = null; sheet.dispatchEvent(new Event("sheetclosed")); });

  /* Paste (Ctrl/Cmd+V) or drag & drop photos and videos onto an open watch or check. */
  document.addEventListener("paste", (e) => {
    if (!dropTarget || e.target.closest?.("input, textarea")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^(image|video)\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    dropTarget(files);
  });
  sheet.addEventListener("dragover", (e) => { if (dropTarget) { e.preventDefault(); sheet.classList.add("dragging"); } });
  sheet.addEventListener("dragleave", (e) => { if (e.target === sheet) sheet.classList.remove("dragging"); });
  sheet.addEventListener("drop", (e) => {
    sheet.classList.remove("dragging");
    if (!dropTarget) return;
    e.preventDefault();
    dropTarget([...(e.dataTransfer?.files || [])]);
  });

  function route() {
    closeSheet();
    const tab = (location.hash || "#dashboard").slice(1);
    ui.tab = ["dashboard", "inventory", "market", "settings"].includes(tab) ? tab : "dashboard";
    $$("#tabs a").forEach((a) => (a.dataset.tab === ui.tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    render();
  }
  window.addEventListener("hashchange", route);

  function render() {
    ({ dashboard: renderDashboard, inventory: renderInventory, market: renderMarket, settings: renderSettings })[ui.tab]();
  }

  function renderBrand() {
    const b = biz();
    $("#brand").innerHTML = db.business?.logo
      ? `<img src="${db.business.logo}" alt="${esc(b.name)}" class="brand-logo">`
      : `<img src="logo-ink.png" alt="${esc(b.name)}" class="brand-logo on-light"><img src="logo-silver.png" alt="" class="brand-logo on-dark">`;
    document.title = b.name;
  }

  /* ---------- Dashboard ---------- */

  function renderDashboard() {
    const s = monthStats(ui.month);
    const stock = db.watches.filter((w) => !isSold(w));
    const capital = stock.reduce((t, w) => t + costBasis(w), 0);
    const aging = stock
      .map((w) => ({ w, days: daysBetween(w.buyDate, today()) }))
      .filter((x) => x.days != null)
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);

    const year = ui.month.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const yearRows = months.map((m) => ({ m, ...monthStats(m) }));
    const yt = yearRows.reduce(
      (t, r) => ({ count: t.count + r.count, revenue: t.revenue + r.revenue, fees: t.fees + r.fees, cogs: t.cogs + r.cogs, net: t.net + r.net, spent: t.spent + r.spent }),
      { count: 0, revenue: 0, fees: 0, cogs: 0, net: 0, spent: 0 }
    );
    const last12 = Array.from({ length: 12 }, (_, i) => shiftMonth(ui.month, i - 11)).map((m) => { const x = monthStats(m); return { m, net: x.net, count: x.count }; });

    view.innerHTML = `
      <div class="section-head">
        <div>
          <div class="eyebrow">Month-end numbers</div>
          <h1>${esc(monthName(ui.month))}</h1>
        </div>
        <div class="month-pick">
          <button class="icon-btn" data-m="-1" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
          <input type="month" id="month" value="${ui.month}" aria-label="Month">
          <button class="icon-btn" data-m="1" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
      </div>

      <div class="stats">
        <div class="card stat hero">
          <div class="label">Net profit</div>
          <div class="value">${money0(s.net)}</div>
          <div class="sub">${s.count} sold · ${pct(s.margin)} margin after fees</div>
        </div>
        <div class="card stat"><div class="label">Watches sold</div><div class="value">${s.count}</div><div class="sub">avg ${s.avgDays == null ? "—" : s.avgDays + " days"} to sell</div></div>
        <div class="card stat"><div class="label">Revenue</div><div class="value">${money0(s.revenue)}</div><div class="sub">${money0(s.fees)} fees &amp; shipping</div></div>
        <div class="card stat"><div class="label">Cost of sold</div><div class="value">${money0(s.cogs)}</div><div class="sub">paid + extra costs</div></div>
        <div class="card stat"><div class="label">Avg profit / watch</div><div class="value">${money0(s.avgProfit)}</div><div class="sub">this month</div></div>
        <div class="card stat"><div class="label">Bought</div><div class="value">${s.bought.length}</div><div class="sub">${money0(s.spent)} spent</div></div>
        <div class="card stat"><div class="label">In stock now</div><div class="value">${stock.length}</div><div class="sub">${money0(capital)} at cost</div></div>
      </div>

      <div class="toolbar">
        <button class="btn small" id="copy-month">Copy month-end summary</button>
        <button class="btn small" id="csv-month">Export this month (CSV)</button>
      </div>

      <div class="section">
        <h3>Net profit — last 12 months</h3>
        <div class="card chart" id="chart"></div>
      </div>

      <div class="section">
        <h3>Sold in ${esc(monthName(ui.month))}</h3>
        ${s.sold.length ? `<div class="list">${s.sold.sort((a, b) => (b.sellDate || "").localeCompare(a.sellDate || "")).map(rowHTML).join("")}</div>` : `<div class="empty">No sales recorded this month.</div>`}
      </div>

      <div class="section">
        <h3>${esc(year)} by month</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Month</th><th>Sold</th><th>Revenue</th><th>Fees</th><th>Cost</th><th>Net profit</th><th>Bought for</th></tr></thead>
            <tbody>
              ${yearRows.map((r) => `<tr class="${r.m === ui.month ? "current" : ""}"><td><a href="#dashboard" data-goto="${r.m}">${esc(monthName(r.m, "short"))}</a></td><td>${r.count}</td><td>${money0(r.revenue)}</td><td>${money0(r.fees)}</td><td>${money0(r.cogs)}</td><td>${r.count ? signed(r.net) : "—"}</td><td>${money0(r.spent)}</td></tr>`).join("")}
            </tbody>
            <tfoot><tr><td>Year</td><td>${yt.count}</td><td>${money0(yt.revenue)}</td><td>${money0(yt.fees)}</td><td>${money0(yt.cogs)}</td><td>${signed(yt.net)}</td><td>${money0(yt.spent)}</td></tr></tfoot>
          </table>
        </div>
      </div>

      ${aging.length ? `
      <div class="section">
        <h3>Longest in stock</h3>
        <div class="list">${aging.map((x) => rowHTML(x.w)).join("")}</div>
      </div>` : ""}
    `;

    $("#month").addEventListener("change", (e) => { if (e.target.value) { ui.month = e.target.value; render(); } });
    $$("[data-m]").forEach((b) => b.addEventListener("click", () => { ui.month = shiftMonth(ui.month, +b.dataset.m); render(); }));
    $$("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); ui.month = a.dataset.goto; render(); window.scrollTo({ top: 0 }); }));
    $("#copy-month").addEventListener("click", () => copyText(monthSummary(ui.month)));
    $("#csv-month").addEventListener("click", () => download(`sales-${ui.month}.csv`, toCSV(s.sold), "text/csv"));
    bindItems(view);
    const box = $("#chart");
    box.innerHTML = barChart(last12, box.clientWidth - 28);
    bindChart(last12);
  }

  function barChart(rows, width) {
    const W = Math.max(300, Math.round(width || 640)), H = W < 500 ? 200 : 240, padL = 52, padR = 8, padT = 12, padB = 26;
    const vals = rows.map((r) => r.net);
    let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    if (max === min) max = 1;
    const nice = (v) => {
      if (v === 0) return 0;
      const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
      return Math.sign(v) * Math.ceil(Math.abs(v) / p) * p;
    };
    max = nice(max); min = nice(min);
    const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);
    const step = (W - padL - padR) / rows.length;
    const bw = Math.max(6, Math.min(28, step - 10));
    const labelEvery = step < 30 ? 2 : 1;
    const ticks = [max, min < 0 ? min : max / 2, 0].filter((v, i, a) => a.indexOf(v) === i);
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net profit by month for the last 12 months">`;
    ticks.forEach((t) => {
      out += `<line class="${t === 0 ? "zero" : "grid"}" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`;
      out += `<text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`;
    });
    rows.forEach((r, i) => {
      const cx = padL + step * i + step / 2;
      const y0 = y(0), y1 = y(r.net);
      const top = Math.min(y0, y1), h = Math.max(Math.abs(y1 - y0), r.net ? 2 : 0);
      const rad = Math.min(4, h / 2, bw / 2);
      const path = r.net >= 0
        ? `M${cx - bw / 2},${y0} V${top + rad} Q${cx - bw / 2},${top} ${cx - bw / 2 + rad},${top} H${cx + bw / 2 - rad} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + rad} V${y0} Z`
        : `M${cx - bw / 2},${y0} V${y0 + h - rad} Q${cx - bw / 2},${y0 + h} ${cx - bw / 2 + rad},${y0 + h} H${cx + bw / 2 - rad} Q${cx + bw / 2},${y0 + h} ${cx + bw / 2},${y0 + h - rad} V${y0} Z`;
      out += `<rect class="hit" data-i="${i}" x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT - padB}" tabindex="0" aria-label="${esc(monthName(r.m))}: ${esc(money0(r.net))}"/>`;
      out += `<path class="bar ${r.m === ui.month ? "selected" : ""}" d="${path}"/>`;
      if ((rows.length - 1 - i) % labelEvery === 0) out += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(monthName(r.m, "short"))}</text>`;
    });
    return out + `</svg><div class="tip" id="tip" hidden></div>`;
  }
  function compact(v) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: db.settings.currency || "USD", notation: "compact", maximumFractionDigits: 1 }).format(v); }
    catch { return String(v); }
  }
  function bindChart(rows) {
    const box = $("#chart"), tip = $("#tip");
    if (!box) return;
    const show = (el) => {
      const r = rows[+el.dataset.i];
      const bb = el.getBoundingClientRect(), cb = box.getBoundingClientRect();
      tip.innerHTML = `<strong>${esc(monthName(r.m))}</strong><br>${esc(money0(r.net))} net · ${r.count} sold`;
      tip.style.left = `${Math.min(cb.width - 70, Math.max(70, bb.left - cb.left + bb.width / 2))}px`;
      tip.style.top = `${Math.max(36, bb.top - cb.top + 20)}px`;
      tip.hidden = false;
    };
    $$(".hit", box).forEach((el) => {
      el.addEventListener("mouseenter", () => show(el));
      el.addEventListener("focus", () => show(el));
      el.addEventListener("mouseleave", () => (tip.hidden = true));
      el.addEventListener("blur", () => (tip.hidden = true));
      el.addEventListener("click", () => { ui.month = rows[+el.dataset.i].m; render(); });
    });
  }

  function monthSummary(ym) {
    const s = monthStats(ym);
    return [
      `${monthName(ym)} — month-end`,
      `Watches sold: ${s.count}`,
      `Revenue: ${money(s.revenue)}`,
      `Fees & shipping: ${money(s.fees)}`,
      `Cost of watches sold: ${money(s.cogs)}`,
      `NET PROFIT: ${money(s.net)}${s.margin != null ? ` (${pct(s.margin)} margin)` : ""}`,
      `Avg profit per watch: ${money(s.avgProfit)}`,
      `Bought this month: ${s.bought.length} for ${money(s.spent)}`,
      "",
      ...s.sold.map((w) => `• ${label(w)}${w.ref ? " " + w.ref : ""} (${configText(w)}) — sold ${money(w.sellPrice)}, net ${money(profit(w))}`),
    ].join("\n");
  }

  /* ---------- Inventory ---------- */

  const statusBadge = (w) => `<span class="badge ${isSold(w) ? "sold" : "stock"}">${isSold(w) ? "Sold" : "In stock"}</span>`;
  const warnDot = (w) => (lookOf(w).warnings.length ? `<span class="badge warn" title="Configuration doesn't match the reference">Check</span>` : "");
  const lastLocked = (w) => (w.checks || []).filter((c) => c.locked).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))[0];
  const shipBadge = (w) => (lastLocked(w) ? `<span class="badge ok" title="Pre-ship check signed off">Checked</span>` : "");

  function rowHTML(w) {
    const p = profit(w);
    const days = isSold(w) ? daysBetween(w.buyDate, w.sellDate) : daysBetween(w.buyDate, today());
    const right = isSold(w)
      ? `<div class="big">${signed(p)}</div><div class="meta">sold ${money0(w.sellPrice)}</div>`
      : `<div class="big">${money0(costBasis(w))}</div><div class="meta">cost</div>`;
    return `<button class="item" type="button" data-id="${w.id}">
      <div class="thumb">${pictureHTML(w, "sm")}</div>
      <div class="item-main"><div class="title">${esc(label(w))}${warnDot(w)}</div>
      <div class="meta">${[w.ref, configText(w)].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="meta">${isSold(w) ? `Sold ${fmtDate(w.sellDate)}` : `Bought ${fmtDate(w.buyDate)}`}${days != null && days >= 0 ? ` · ${days} days${isSold(w) ? " held" : " in stock"}` : ""}</div></div>
      <div class="right">${right}</div>
    </button>`;
  }

  function cardHTML(w) {
    const p = profit(w);
    const days = isSold(w) ? daysBetween(w.buyDate, w.sellDate) : daysBetween(w.buyDate, today());
    const m = mediaFor(w.id);
    const nP = m.filter((x) => x.kind === "photo").length, nV = m.filter((x) => x.kind === "video").length;
    return `<button class="wcard" type="button" data-id="${w.id}">
      <div class="wcard-pic">${pictureHTML(w)}<div class="wcard-tags">${statusBadge(w)}${warnDot(w)}${shipBadge(w)}</div>
        ${nP || nV ? `<span class="photo-count">${nP ? `${cameraIcon}${nP}` : ""}${nV ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>${nV}` : ""}</span>` : ""}
      </div>
      <div class="wcard-body">
        <div class="brand-line">${esc(w.brand || "")}</div>
        <div class="title">${esc(w.model || w.ref || "Untitled")}</div>
        <div class="ref">${esc(w.ref || "No reference")}</div>
        <div class="meta">${esc(configText(w))}</div>
        <div class="wcard-foot">
          ${isSold(w) ? `<span>${signed(p)}</span><span class="muted">${money0(w.sellPrice)}</span>` : `<span class="num"><strong>${money0(costBasis(w))}</strong></span><span class="muted">${days != null && days >= 0 ? days + "d" : ""}</span>`}
        </div>
      </div>
    </button>`;
  }
  function bindItems(root) {
    $$("[data-id]", root).forEach((b) => b.addEventListener("click", () => showWatch(b.dataset.id)));
  }

  function renderInventory() {
    view.innerHTML = `
      <div class="section-head">
        <div><div class="eyebrow">Inventory</div><h1 id="inv-count"></h1></div>
      </div>
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="q" placeholder="Search brand, model, reference, serial, client, tracking…" value="${esc(ui.q)}" autocomplete="off" aria-label="Search inventory">
      </div>
      <div class="toolbar">
        <div class="chips grow" role="group" aria-label="Filter">
          ${[["all", "All"], ["stock", "In stock"], ["sold", "Sold (past)"], ["check", "Needs check"], ["unshipped", "Sold, no pre-ship check"]].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filter === k}">${t}</button>`).join("")}
        </div>
        <select id="sort" aria-label="Sort">
          ${[["recent", "Most recent"], ["brand", "Brand A–Z"], ["profit", "Highest profit"], ["cost", "Highest cost"], ["age", "Longest in stock"]].map(([k, t]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <div id="refbox"></div>
      <div class="grid-cards" id="inv-list"></div>
    `;
    const q = $("#q");
    q.addEventListener("input", () => { ui.q = q.value; drawList(); });
    $$("[data-f]").forEach((b) => b.addEventListener("click", () => {
      ui.filter = b.dataset.f;
      $$("[data-f]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      drawList();
    }));
    $("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; drawList(); });
    drawList();
    if (!matchMedia("(pointer: coarse)").matches) q.focus();
  }

  function drawList() {
    const f = ui.filter;
    let list = db.watches.filter((w) =>
      f === "all" ? true : f === "sold" ? isSold(w) : f === "check" ? lookOf(w).warnings.length > 0 : f === "unshipped" ? isSold(w) && !lastLocked(w) : !isSold(w));
    if (ui.q.trim()) list = list.filter((w) => matches(haystack(w), ui.q));
    const lastDate = (w) => (isSold(w) ? w.sellDate : w.buyDate) || "";
    const sorters = {
      recent: (a, b) => lastDate(b).localeCompare(lastDate(a)),
      brand: (a, b) => label(a).localeCompare(label(b)),
      profit: (a, b) => (profit(b) ?? -Infinity) - (profit(a) ?? -Infinity),
      cost: (a, b) => costBasis(b) - costBasis(a),
      age: (a, b) => (a.buyDate || "9").localeCompare(b.buyDate || "9"),
    };
    list.sort(sorters[ui.sort]);
    $("#inv-count").textContent = `${list.length} of ${db.watches.length} watches`;

    const box = $("#refbox");
    const refs = [...new Set(list.map((w) => normRef(w.ref)).filter(Boolean))];
    box.innerHTML = ui.q.trim() && list.length && refs.length === 1 ? refSummaryHTML(list[0]) : "";

    $("#inv-list").innerHTML = list.length
      ? list.map(cardHTML).join("")
      : `<div class="empty">${db.watches.length ? "No watches match." : "No watches yet. Tap <strong>Add watch</strong> to log your first one, or load sample data under Business."}</div>`;
    bindItems($("#inv-list"));
  }

  function refSummaryHTML(w) {
    const h = history(w);
    const mk = marketFor(w);
    const paid = h.paid.map((x) => num(x.buyPrice));
    const soldP = h.sold.map((x) => num(x.sellPrice));
    const profits = h.sold.map(profit);
    if (!h.mine.length && !mk.soldCount && !mk.askingCount) return "";
    return `<div class="card refcard">
      <h3>${esc(w.ref ? "Reference " + w.ref : label(w))} — your history</h3>
      <div class="compare">
        <div><div class="muted">You paid (${paid.length}×)</div><div class="num"><strong>${money0(avg(paid))}</strong> avg</div><div class="muted num">${paid.length ? `${money0(Math.min(...paid))} – ${money0(Math.max(...paid))} · last ${money0(paid[0])}` : "no purchases"}</div></div>
        <div><div class="muted">You sold (${soldP.length}×)</div><div class="num"><strong>${money0(avg(soldP))}</strong> avg</div><div class="muted num">${soldP.length ? `avg net ${money0(avg(profits))}` : "no sales"}</div></div>
        <div><div class="muted">Market sold · 180 days (${mk.soldCount})</div><div class="num"><strong>${money0(mk.median)}</strong> median</div><div class="muted num">${mk.soldCount ? `${money0(mk.low)} – ${money0(mk.high)}` : "no sold comps"}${mk.askingCount ? ` · asking ${money0(mk.askingMedian)}` : ""}</div></div>
      </div>
    </div>`;
  }

  /* Configurations this reference comes in, as text. */
  function configListHTML(w) {
    const { entry, spec } = lookOf(w);
    if (!entry) return "";
    const cfgs = CAT.configurations(entry);
    const fam = CAT.family(entry).filter((r) => r !== entry);
    return `<div class="section"><h3>${esc(entry.ref)} comes in ${cfgs.length === 1 ? "one configuration" : cfgs.length + " configurations"}</h3>
      <p class="note">${esc(entry.note)}</p>
      <div class="cfg-chips">${cfgs.map((c) => {
        const on = c.dial === spec.dial && c.strap === spec.strap;
        return `<span class="cfg-chip ${on ? "on" : ""}">${dialDot(c.dial)}${esc(CAT.DIALS[c.dial].label)} · ${esc(CAT.STRAPS[c.strap].label)}${on ? " <strong>· this watch</strong>" : ""}</span>`;
      }).join("")}</div>
      ${fam.length ? `<div class="muted" style="margin-top:10px;font-size:13px">Related references: ${fam.map((r) => `<a href="#" data-ref="${esc(r.ref)}">${esc(r.ref)}</a> (${esc(CAT.describe(CAT.resolve({ ref: r.ref }).spec))})`).join(" · ")}</div>` : ""}
    </div>`;
  }
  const dialDot = (k) => { const d = CAT.DIALS[k]; return d ? `<span class="dot" style="background:radial-gradient(circle at 35% 30%, ${d.hi}, ${d.fill})"></span>` : ""; };

  /* ---------- Watch screen ---------- */

  function mediaTileHTML(m, on, locked) {
    const inner = m.kind === "video"
      ? `${m.thumb ? `<img src="${m.thumb}" alt="">` : ""}<span class="play">▶</span>${m.duration ? `<span class="dur">${fmtDur(m.duration)}</span>` : ""}`
      : `<img src="${m.thumb}" alt="">`;
    return `<button type="button" class="hero-thumb ${m.kind} ${on ? "on" : ""}" data-media="${m.id}" aria-label="${m.kind === "video" ? "Video" : "Photo"} ${esc(fmtWhen(m.created))}">${inner}${locked ? `<span class="lock" title="Part of a signed-off check">🔒</span>` : ""}</button>`;
  }

  async function showViewer(main, w, m) {
    const locked = isLockedMedia(w, m);
    const info = `<div class="viewer-info"><span>${m.kind === "video" ? "Video" : "Photo"} · ${esc(fmtWhen(m.created))}${m.size ? " · " + fmtSize(m.size) : ""}${locked ? " · 🔒 pre-ship record" : ""}</span>
      <span class="row-actions"><button type="button" class="btn small" data-dl="${m.id}">Download</button>${locked ? "" : `<button type="button" class="btn small danger" data-rm="${m.id}">Remove</button>`}</span></div>`;
    if (m.kind === "video") {
      main.innerHTML = `<div class="viewer-box">${m.thumb ? `<img class="pic photo" src="${m.thumb}" alt="">` : `<span class="vid-label">Loading video…</span>`}<span class="play big">▶</span></div>${info}`;
      try {
        const rec = await mediaDB.get(m.id);
        if (main.dataset.showing !== m.id) return;
        const url = URL.createObjectURL(rec.blob);
        main.querySelector(".viewer-box").innerHTML = `<video src="${url}" controls playsinline preload="metadata" ${m.thumb ? `poster="${m.thumb}"` : ""}></video>`;
        sheet.addEventListener("sheetclosed", () => URL.revokeObjectURL(url), { once: true });
      } catch { toast("Couldn't load that video."); }
    } else {
      main.innerHTML = `<div class="viewer-box"><img class="pic photo" src="${m.thumb}" alt="Photo"></div>${info}`;
      try { const rec = await mediaDB.get(m.id); if (main.dataset.showing === m.id && rec) main.querySelector(".viewer-box img").src = rec.data; } catch {}
    }
  }

  function showWatch(id, focusMedia) {
    const w = db.watches.find((x) => x.id === id);
    if (!w) return;
    const p = profit(w);
    const { spec, warnings } = lookOf(w);
    const h = history(w, w.id);
    const mk = marketFor(w);
    const all = mediaFor(w.id);
    const first = all.find((m) => m.id === focusMedia) || all.find((m) => m.kind === "photo") || all[0];
    const checks = (w.checks || []).slice().sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    const pastRows = h.mine
      .sort((a, b) => (b.buyDate || "").localeCompare(a.buyDate || ""))
      .map((x) => `<tr><td><a href="#" data-open="${x.id}">${fmtDate(x.buyDate)}</a></td><td class="wrap">${esc(configText(x))}</td><td>${money0(costBasis(x))}</td><td>${isSold(x) ? money0(x.sellPrice) : "in stock"}</td><td>${isSold(x) ? signed(profit(x)) : "—"}</td></tr>`)
      .join("");
    const mkHTML = mk.soldCount || mk.askingCount
      ? `<dl class="kv">
          <dt>Median sold (180 days)</dt><dd><strong>${money0(mk.median)}</strong> (${mk.soldCount})</dd>
          <dt>Sold range</dt><dd>${mk.soldCount ? `${money0(mk.low)} – ${money0(mk.high)}` : "—"}</dd>
          ${mk.askingCount ? `<dt>Median asking</dt><dd>${money0(mk.askingMedian)} (${mk.askingCount})</dd>` : ""}
          ${!isSold(w) && mk.median ? `<dt>If sold at median</dt><dd>${signed(mk.median - costBasis(w))} before fees</dd>` : ""}
        </dl>`
      : `<p class="muted">No market comps logged for this reference yet.</p>`;
    const bizMissing = !db.business?.address && !db.business?.phone && !db.business?.email;

    openSheet(label(w), `
      <div class="media-hero">
        <div class="viewer" id="viewer">${first ? "" : placeholderHTML(w)}</div>
        <div class="hero-strip">
          ${all.map((m) => mediaTileHTML(m, m === first, isLockedMedia(w, m))).join("")}
          <label class="hero-thumb add" aria-label="Add photos">${cameraIcon}<input type="file" accept="image/*" multiple hidden data-add="image"></label>
          <label class="hero-thumb add" aria-label="Add videos"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg><input type="file" accept="video/*" multiple hidden data-add="video"></label>
        </div>
        <div class="drop-hint">Drop or paste photos &amp; videos here</div>
      </div>

      <div class="detail-head">
        <div class="brand-line">${esc(w.brand)}</div>
        <div class="detail-title">${esc(w.model || "")}</div>
        <div class="muted">${[w.ref, w.serial && "Serial " + w.serial, w.year].filter(Boolean).map(esc).join(" · ")} ${statusBadge(w)} ${shipBadge(w)}</div>
        <div class="config-line">${dialDot(spec.dial)}${esc(CAT.describe(spec))}</div>
      </div>

      ${warnings.length ? `<div class="warnbox"><strong>Check this watch</strong>${warnings.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : ""}

      <div class="row-actions" style="margin:14px 0 6px">
        ${isSold(w) ? "" : `<button class="btn primary" id="w-sell">Mark sold</button>`}
        <button class="btn" id="w-edit">Edit</button>
        <button class="btn" id="w-again">Bought another</button>
        <button class="btn" id="w-comps">Market comps</button>
      </div>

      <div class="section">
        <div class="section-head" style="margin-bottom:8px"><h3 style="margin:0">Pre-ship check</h3>
          <button class="btn small ${isSold(w) && !lastLocked(w) ? "primary" : ""}" id="w-check">Start pre-ship check</button></div>
        ${checks.length ? `<div class="list">${checks.map((c) => checkRowHTML(w, c)).join("")}</div>`
          : `<p class="muted" style="margin:0">Before the watch ships, run the checklist and record a video of it working. Once signed off it's locked, time-stamped and kept with this watch.</p>`}
      </div>

      <div class="section">
        <h3>Documents</h3>
        <div class="doc-buttons">
          <button class="docbtn" data-doc="purchase"><strong>Purchase agreement</strong><span>When you buy${w.buyFrom ? " from " + esc(w.buyFrom) : ""}</span></button>
          <button class="docbtn" data-doc="bill"><strong>Bill of sale</strong><span>${w.invoiceNo ? "Invoice " + esc(w.invoiceNo) : "When you sell"}${w.soldTo ? " to " + esc(w.soldTo) : ""}</span></button>
          <button class="docbtn" data-doc="thanks"><strong>Thank-you letter</strong><span>${w.soldTo ? "For " + esc(w.soldTo) : "For your client"}</span></button>
          ${checks.length ? `<button class="docbtn" data-doc="report"><strong>Condition report</strong><span>From the ${lastLocked(w) ? "signed-off" : "draft"} pre-ship check</span></button>` : ""}
        </div>
        ${bizMissing ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Add your address, phone, email and sale terms under <a href="#settings">Business</a> — they're printed on every document.</p>` : ""}
      </div>

      <div class="card section">
        <dl class="kv">
          <dt>Paid</dt><dd>${money(num(w.buyPrice))}</dd>
          ${num(w.extraCosts) ? `<dt>Extra costs</dt><dd>${money(num(w.extraCosts))}</dd>` : ""}
          <dt class="total">Cost basis</dt><dd class="total">${money(costBasis(w))}</dd>
          ${isSold(w) ? `
          <dt>Sold for</dt><dd>${money(num(w.sellPrice))}</dd>
          <dt>Fees &amp; shipping</dt><dd>−${money(num(w.sellFees))}</dd>
          <dt class="total">Net profit</dt><dd class="total">${signed(p)}${num(w.sellPrice) ? ` · ${pct(p / num(w.sellPrice))}` : ""}</dd>` : ""}
        </dl>
      </div>

      <div class="section"><h3>Details</h3>
        <dl class="kv">
          <dt>Dial</dt><dd>${esc(CAT.DIALS[spec.dial]?.label || "—")}</dd>
          <dt>Bracelet / strap</dt><dd>${esc(CAT.STRAPS[spec.strap]?.label || "—")}</dd>
          ${w.caseInfo ? `<dt>Case</dt><dd>${esc(w.caseInfo)}</dd>` : ""}
          <dt>Condition</dt><dd>${esc(w.condition || "—")}</dd>
          <dt>Box / papers</dt><dd>${esc(w.set || "—")}</dd>
          <dt>Bought</dt><dd>${fmtDate(w.buyDate) || "—"}${w.buyFrom ? " from " + esc(w.buyFrom) : ""}${w.buyPayment ? " · " + esc(w.buyPayment) : ""}</dd>
          ${isSold(w) ? `<dt>Sold</dt><dd>${fmtDate(w.sellDate)}${w.soldVia ? " via " + esc(w.soldVia) : ""}${w.soldTo ? " to " + esc(w.soldTo) : ""}${w.sellPayment ? " · " + esc(w.sellPayment) : ""}</dd>
          ${w.buyerEmail || w.buyerPhone ? `<dt>Client contact</dt><dd>${[w.buyerEmail, w.buyerPhone].filter(Boolean).map(esc).join("<br>")}</dd>` : ""}
          <dt>Days held</dt><dd>${daysBetween(w.buyDate, w.sellDate) ?? "—"}</dd>` : `<dt>Days in stock</dt><dd>${daysBetween(w.buyDate, today()) ?? "—"}</dd>`}
        </dl>
        ${w.notes ? `<p style="white-space:pre-wrap">${esc(w.notes)}</p>` : ""}
      </div>

      <div class="section"><h3>Market (sold prices)</h3>${mkHTML}</div>

      ${configListHTML(w)}

      ${pastRows ? `<div class="section"><h3>Other times you had this watch</h3>
        <div class="table-wrap"><table><thead><tr><th>Bought</th><th>Configuration</th><th>Cost</th><th>Sold</th><th>Profit</th></tr></thead><tbody>${pastRows}</tbody></table></div></div>` : ""}

      <div class="section row-actions">
        ${all.length ? `<button class="btn small" id="w-dlall">Download all photos &amp; videos</button>` : ""}
        <button class="btn danger small" id="w-del">Delete this watch</button>
      </div>
    `, (root) => {
      const viewer = $("#viewer", root);
      const show = (m) => {
        viewer.dataset.showing = m.id;
        $$("[data-media]", root).forEach((x) => x.classList.toggle("on", x.dataset.media === m.id));
        showViewer(viewer, w, m);
      };
      if (first) show(first);
      $$("[data-media]", root).forEach((b) => b.addEventListener("click", () => show(all.find((m) => m.id === b.dataset.media))));
      viewer.addEventListener("click", async (e) => {
        const dl = e.target.closest("[data-dl]"), rm = e.target.closest("[data-rm]");
        if (dl) downloadMedia(dl.dataset.dl);
        if (rm) {
          if (!(await ask("Remove this file from the watch?", { ok: "Remove", danger: true }))) return;
          await removeMedia(w.id, rm.dataset.rm);
          render(); showWatch(w.id);
        }
      });
      const add = async (files) => {
        const before = new Set(mediaFor(w.id).map((m) => m.id));
        if (!(await addFiles(w.id, files))) return;
        const added = mediaFor(w.id).filter((m) => !before.has(m.id));
        // Show a newly added photo; for videos keep the current photo on screen.
        const focus = added.find((m) => m.kind === "photo")?.id || viewer.dataset.showing || added[0]?.id;
        render(); showWatch(w.id, focus);
      };
      dropTarget = add;
      $$("[data-add]", root).forEach((inp) => inp.addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; add(f); }));

      $("#w-check", root).addEventListener("click", () => editCheck(w));
      $$("[data-check]", root).forEach((b) => b.addEventListener("click", () => editCheck(w, b.dataset.check)));
      $$("[data-doc]", root).forEach((b) => b.addEventListener("click", () => makeDoc(w, b.dataset.doc)));
      $("#w-sell", root)?.addEventListener("click", () => editWatch(w, { sell: true }));
      $("#w-edit", root).addEventListener("click", () => editWatch(w));
      $("#w-again", root).addEventListener("click", () => editWatch({ brand: w.brand, model: w.model, ref: w.ref, look: { ...(w.look || {}) } }));
      $("#w-comps", root).addEventListener("click", () => goMarket(w.ref || label(w)));
      $$("[data-ref]", root).forEach((t) => t.addEventListener("click", (e) => { e.preventDefault(); goMarket(t.dataset.ref); }));
      $("#w-dlall", root)?.addEventListener("click", async () => {
        for (const m of mediaFor(w.id)) { await downloadMedia(m.id); await new Promise((r) => setTimeout(r, 400)); }
      });
      $("#w-del", root).addEventListener("click", async () => {
        const hasRecords = (w.checks || []).some((c) => c.locked);
        if (!(await ask(`Delete ${label(w)}? This cannot be undone.${hasRecords ? "\n\nThis also deletes its signed-off pre-ship checks and recordings." : ""}`, { ok: "Delete", danger: true }))) return;
        db.watches = db.watches.filter((x) => x.id !== w.id);
        save();
        for (const m of mediaFor(w.id)) await removeMedia(w.id, m.id).catch(() => {});
        media.delete(w.id);
        closeSheet(); render(); toast("Deleted");
      });
      $$("[data-open]", root).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showWatch(a.dataset.open); }));
    });
  }
  function goMarket(q) {
    ui.mq = q;
    closeSheet();
    if (ui.tab === "market") render();
    else location.hash = "#market";
  }

  /* ---------- Pre-ship check ---------- */

  const CHECK_GROUPS = [
    { title: "Identity", items: [["serial", "Serial number matches case and papers"], ["ref", "Reference matches the papers"], ["config", "Dial and bracelet/strap match the papers"]] },
    { title: "Function", items: [["running", "Running and keeping time"], ["winding", "Winds smoothly by the crown"], ["setting", "Time-setting works, hands aligned"], ["date", "Date changes correctly"], ["chrono", "Chronograph starts, stops and resets"], ["bezel", "Bezel turns and clicks properly"], ["crown", "Crown screws down / seals"], ["wr", "Water-resistance tested"]] },
    { title: "Condition", items: [["crystal", "Crystal free of chips and cracks"], ["case", "Case and bracelet condition as described"], ["clasp", "Clasp closes and locks securely"], ["links", "Bracelet links / straps included as listed"]] },
    { title: "Packing & shipping", items: [["accessories", "Box, papers, tags and accessories included as listed"], ["filmed", "Watch recorded running before packing"], ["packed", "Packed securely"], ["insured", "Shipped insured, signature required"]] },
  ];
  const ALL_ITEMS = CHECK_GROUPS.flatMap((g) => g.items.map(([k]) => k));
  const checkStats = (w, c) => {
    const vals = ALL_ITEMS.map((k) => c.items?.[k]);
    const files = mediaFor(w.id).filter((m) => m.checkId === c.id);
    return { pass: vals.filter((v) => v === "pass").length, fail: vals.filter((v) => v === "fail").length, open: vals.filter((v) => !v).length, videos: files.filter((m) => m.kind === "video").length, photos: files.filter((m) => m.kind === "photo").length };
  };
  function checkRowHTML(w, c) {
    const s = checkStats(w, c);
    return `<button class="item check-row" type="button" data-check="${c.id}">
      <div class="thumb">${c.locked ? `<div class="ph ph-sm ok"><span>✓</span></div>` : `<div class="ph ph-sm"><span>…</span></div>`}</div>
      <div class="item-main"><div class="title">${c.locked ? "Signed off " + esc(fmtWhen(c.completedAt)) : "Draft — started " + esc(fmtWhen(c.created))}</div>
        <div class="meta">${s.pass} passed${s.fail ? ` · <span class="neg">${s.fail} failed</span>` : ""}${s.open ? ` · ${s.open} not checked` : ""} · ${s.videos} video${s.videos === 1 ? "" : "s"}, ${s.photos} photo${s.photos === 1 ? "" : "s"}</div>
        ${c.tracking ? `<div class="meta">${esc(c.carrier || "")} ${esc(c.tracking)}</div>` : ""}</div>
      <div class="right">${c.locked ? `<span class="badge ok">Locked</span>` : `<span class="badge">Draft</span>`}</div>
    </button>`;
  }

  function editCheck(w, checkId) {
    w.checks ||= [];
    let c = w.checks.find((x) => x.id === checkId);
    let isNew = false;
    if (!c) {
      const entry = lookOf(w).entry;
      c = { id: uid(), created: new Date().toISOString(), items: {}, by: db.business?.signer || "", locked: false };
      if (entry && !entry.base.chrono) c.items.chrono = "na";
      if (entry && !entry.base.date) c.items.date = "na";
      w.checks.push(c);
      save();
      isNew = true;
    }
    const ro = c.locked;
    const filesOf = () => mediaFor(w.id).filter((m) => m.checkId === c.id);
    const seg = (k, v) => `<div class="tri" role="group" aria-label="Result">${[["pass", "✓ Pass"], ["fail", "✗ Fail"], ["na", "N/A"]].map(([val, t]) => `<button type="button" class="tri-${val}" data-item="${k}" data-val="${val}" aria-pressed="${v === val}" ${ro ? "disabled" : ""}>${t}</button>`).join("")}</div>`;

    openSheet(`Pre-ship check — ${label(w)}`, `
      ${ro ? `<div class="okbox"><strong>Signed off ${esc(fmtWhen(c.completedAt))}${c.by ? " by " + esc(c.by) : ""}.</strong> This record is locked and can't be changed — it's your proof of how the watch left your hands.</div>`
        : `<p class="muted" style="margin-top:0">Go through each point, record a video of the watch running (dial, crown, functions, serial), then sign off. Signing off locks the record with a time stamp.</p>`}

      <div class="section" style="margin-top:12px">
        <div class="section-head" style="margin-bottom:8px"><h3 style="margin:0">Videos &amp; photos</h3>
          ${ro ? "" : `<div class="row-actions">
            <label class="btn small primary"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>Add video<input type="file" accept="video/*" multiple hidden data-cadd></label>
            <label class="btn small">${cameraIcon}Add photo<input type="file" accept="image/*" multiple hidden data-cadd></label></div>`}
        </div>
        <div class="check-media" id="check-media"></div>
        ${ro ? "" : `<div class="drop-zone">Or drop / paste files here</div>`}
      </div>

      ${CHECK_GROUPS.map((g) => `<div class="section"><div class="section-head" style="margin-bottom:6px"><h3 style="margin:0">${esc(g.title)}</h3>${ro ? "" : `<button type="button" class="linkbtn" data-allpass="${esc(g.title)}">Mark unchecked as pass</button>`}</div>
        <div class="check-list">${g.items.map(([k, t]) => `<div class="check-item"><span>${esc(t)}</span>${seg(k, c.items[k])}</div>`).join("")}</div></div>`).join("")}

      <form id="check-form" class="form section" autocomplete="off" novalidate>
        <fieldset ${ro ? "disabled" : ""}>
          <legend>Timing (timegrapher)</legend>
          <div class="grid3">
            <label>Rate (s/day)<input name="rate" inputmode="decimal" value="${esc(c.rate)}" placeholder="+2"></label>
            <label>Amplitude (°)<input name="amplitude" inputmode="decimal" value="${esc(c.amplitude)}" placeholder="280"></label>
            <label>Beat error (ms)<input name="beatError" inputmode="decimal" value="${esc(c.beatError)}" placeholder="0.2"></label>
          </div>
        </fieldset>
        <fieldset ${ro ? "disabled" : ""}>
          <legend>Shipping</legend>
          <div class="grid2">
            <label>Carrier<input name="carrier" list="dl-carrier" value="${esc(c.carrier)}"></label>
            <label>Tracking number<input name="tracking" value="${esc(c.tracking)}"></label>
          </div>
          <div class="grid2">
            <label>Insured for<input name="insured" value="${esc(c.insured)}" placeholder="${esc(w.sellPrice ? money0(num(w.sellPrice)) : "")}"></label>
            <label>Inspected by<input name="by" value="${esc(c.by)}"></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Anything worth remembering — small marks, how it was packed, who picked it up…">${esc(c.notes)}</textarea></label>
          <datalist id="dl-carrier"><option value="FedEx"><option value="UPS"><option value="USPS"><option value="DHL"><option value="Hand delivered"><option value="Picked up in person"></datalist>
        </fieldset>
        <div class="actions">
          ${ro ? `<button type="button" class="btn" id="c-report">Condition report</button><button type="button" class="btn primary" data-close>Done</button>`
            : `<button type="button" class="btn danger" id="c-discard">Delete draft</button><button type="button" class="btn" id="c-save">Save draft</button><button type="button" class="btn primary" id="c-lock">Sign off &amp; lock</button>`}
        </div>
      </form>
    `, (root) => {
      const f = $("#check-form", root);
      const drawMedia = () => {
        const list = filesOf();
        $("#check-media", root).innerHTML = list.length
          ? list.map((m) => `<div class="cm"><button type="button" class="hero-thumb ${m.kind}" data-open-media="${m.id}">${m.kind === "video" ? `${m.thumb ? `<img src="${m.thumb}" alt="">` : ""}<span class="play">▶</span>${m.duration ? `<span class="dur">${fmtDur(m.duration)}</span>` : ""}` : `<img src="${m.thumb}" alt="">`}</button><span>${esc(fmtWhen(m.created))}<br>${fmtSize(m.size)}</span></div>`).join("")
          : `<p class="muted" style="margin:0">No recordings yet.</p>`;
        $$("[data-open-media]", root).forEach((b) => b.addEventListener("click", () => { collect(); save(); showWatch(w.id, b.dataset.openMedia); }));
      };
      drawMedia();
      const collect = () => {
        if (ro) return;
        Object.assign(c, Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()])));
        c.updated = new Date().toISOString();
      };
      if (!ro) {
        const add = async (files) => {
          collect(); save();
          if (await addFiles(w.id, files, { checkId: c.id })) {
            if (filesOf().some((m) => m.kind === "video") && !c.items.filmed) { c.items.filmed = "pass"; save(); $$('[data-item="filmed"]', root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.val === "pass")); }
            drawMedia(); render();
          }
        };
        dropTarget = add;
        $$("[data-cadd]", root).forEach((inp) => inp.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; add(fl); }));
        $$("[data-item]", root).forEach((b) => b.addEventListener("click", () => {
          const k = b.dataset.item;
          c.items[k] = c.items[k] === b.dataset.val ? undefined : b.dataset.val;
          $$(`[data-item="${k}"]`, root).forEach((x) => x.setAttribute("aria-pressed", x.dataset.val === c.items[k]));
          save();
        }));
        $$("[data-allpass]", root).forEach((b) => b.addEventListener("click", () => {
          const g = CHECK_GROUPS.find((x) => x.title === b.dataset.allpass);
          g.items.forEach(([k]) => { if (!c.items[k]) c.items[k] = "pass"; });
          $$("[data-item]", root).forEach((x) => x.setAttribute("aria-pressed", x.dataset.val === c.items[x.dataset.item]));
          save();
        }));
        $("#c-save", root).addEventListener("click", () => { collect(); save(); render(); toast("Draft saved"); showWatch(w.id); });
        $("#c-discard", root).addEventListener("click", async () => {
          if (!(await ask("Delete this draft check and its recordings?", { ok: "Delete", danger: true }))) return;
          for (const m of filesOf()) await removeMedia(w.id, m.id).catch(() => {});
          w.checks = w.checks.filter((x) => x.id !== c.id);
          save(); render(); showWatch(w.id);
        });
        $("#c-lock", root).addEventListener("click", () => {
          collect();
          c.locked = true;
          c.completedAt = new Date().toISOString();
          save(); render();
          showWatch(w.id);
          toast("Signed off & locked", { action: { label: "Undo", fn: () => { c.locked = false; delete c.completedAt; save(); render(); editCheck(w, c.id); } } });
        });
        // Closing an untouched new draft shouldn't leave clutter behind.
        sheet.addEventListener("sheetclosed", () => {
          if (c.locked || !w.checks.includes(c)) return;
          const touched = filesOf().length || Object.values(c.items).some((v) => v && v !== "na") || ["rate", "amplitude", "beatError", "carrier", "tracking", "insured", "notes"].some((k) => c[k]);
          if (isNew && !touched) { w.checks = w.checks.filter((x) => x.id !== c.id); save(); render(); }
          else { collect(); save(); }
        }, { once: true });
      } else {
        $("#c-report", root).addEventListener("click", () => makeDoc(w, "report", c.id));
      }
    });
  }

  /* ---------- Documents ---------- */

  function docContext(w, checkId) {
    const spec = lookOf(w).spec;
    const ck = (w.checks || []).find((c) => c.id === checkId) || lastLocked(w) || (w.checks || []).slice(-1)[0];
    const files = ck ? mediaFor(w.id).filter((m) => m.checkId === ck.id) : [];
    return {
      biz: { ...biz(), logo: db.business?.logo || abs("logo-ink.png") },
      w,
      cfg: { dial: CAT.DIALS[spec.dial]?.label, strap: CAT.STRAPS[spec.strap]?.label },
      money: (v) => (v === "" || v == null ? "" : money(num(v))),
      fmtDate,
      today: fmtDate(today()),
      check: ck && {
        when: fmtWhen(ck.completedAt || ck.created), locked: !!ck.locked, by: ck.by, notes: ck.notes,
        rate: ck.rate, amplitude: ck.amplitude, beatError: ck.beatError, carrier: ck.carrier, tracking: ck.tracking, insured: ck.insured,
        videos: files.filter((m) => m.kind === "video").length,
        groups: CHECK_GROUPS.map((g) => ({ title: g.title, items: g.items.map(([k, t]) => ({ label: t, value: ck.items?.[k] })) })),
        media: files.map((m) => ({ kind: m.kind, when: fmtWhen(m.created), size: fmtSize(m.size) })),
        shots: files.filter((m) => m.thumb).slice(0, 8).map((m) => m.thumb),
      },
    };
  }
  function makeDoc(w, kind, checkId) {
    const c = docContext(w, checkId);
    if (kind === "report" && !c.check) { toast("Start a pre-ship check first."); return; }
    if (kind === "bill" && !w.invoiceNo) {
      w.invoiceNo = `${(w.sellDate || today()).slice(0, 4)}-${db.settings.nextInvoice || 1001}`;
      db.settings.nextInvoice = (db.settings.nextInvoice || 1001) + 1;
      save();
    }
    c.docNo = kind === "bill" ? w.invoiceNo : "PA-" + w.id.slice(-6).toUpperCase();
    // The bill of sale only mentions a check that was actually signed off.
    if (kind === "bill" && c.check && !c.check.locked) c.check = null;
    const html = kind === "purchase" ? DOCS.purchaseAgreement(c) : kind === "bill" ? DOCS.billOfSale(c) : kind === "thanks" ? DOCS.thankYou(c) : DOCS.conditionReport(c);
    const win = window.open("", "_blank");
    if (!win) { toast("Allow pop-ups for this site to open documents."); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  /* ---------- Add / edit form ---------- */

  const CONDITIONS = ["New / unworn", "Excellent", "Very good", "Good", "Fair", "Needs service"];
  const SETS = ["Full set (box & papers)", "Papers only", "Box only", "Watch only"];
  const PAYMENTS = ["Wire transfer", "Zelle", "Cash", "Credit card", "Check", "PayPal", "Escrow", "Trade"];
  const datalist = (id, values) =>
    `<datalist id="${id}">${[...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const options = (list, val) => `<option value=""></option>` + list.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("") + (val && !list.includes(val) ? `<option selected>${esc(val)}</option>` : "");

  function editWatch(w = {}, { sell = false } = {}) {
    const isNew = !w.id;
    const showSale = sell || isSold(w);
    let look = { ...(w.look || {}) };
    let showAll = false;
    const pending = [];
    const allRefs = [...new Set(db.watches.map((x) => x.ref).concat(db.comps.map((c) => c.ref), CAT.REFS.map((r) => r.ref)))];
    const allBrands = db.watches.map((x) => x.brand).concat(db.comps.map((c) => c.brand), CAT.REFS.map((r) => r.brand));
    const allModels = db.watches.map((x) => x.model).concat(db.comps.map((c) => c.model), CAT.REFS.map((r) => r.model));
    const clients = db.watches.filter((x) => x.soldTo);

    openSheet(isNew ? "Add watch" : sell ? "Mark sold" : "Edit watch", `
      <form class="form" id="wform" autocomplete="off" novalidate>
        <fieldset>
          <legend>Watch</legend>
          <div class="grid2">
            <label>Reference<input name="ref" list="dl-ref" value="${esc(w.ref)}" placeholder="e.g. 126610LN"></label>
            <label>Brand<input name="brand" list="dl-brand" value="${esc(w.brand)}"></label>
          </div>
          <div class="ref-status" id="ref-status" aria-live="polite"></div>
          <div class="grid2 stack-sm">
            <label>Model<input name="model" list="dl-model" value="${esc(w.model)}"></label>
            <label>Case (size &amp; material)<input name="caseInfo" value="${esc(w.caseInfo)}" placeholder="e.g. 41 mm steel"></label>
          </div>
          <div class="grid3">
            <label>Serial<input name="serial" value="${esc(w.serial)}"></label>
            <label>Year<input name="year" inputmode="numeric" value="${esc(w.year)}"></label>
            <label>Condition<select name="condition">${options(CONDITIONS, w.condition)}</select></label>
          </div>
          <label>Box / papers<select name="set">${options(SETS, w.set)}</select></label>
          <div class="hint" id="ref-hint"></div>
        </fieldset>

        <fieldset>
          <legend>Configuration</legend>
          <div class="config-pickers" id="cfg-pickers"></div>
          <div id="cfg-warn"></div>
        </fieldset>

        <fieldset>
          <legend>Photos &amp; videos</legend>
          <div class="photo-row" id="photo-row"></div>
          <div class="row-actions">
            <label class="btn small">${cameraIcon} Add photos<input type="file" accept="image/*" multiple hidden data-pin></label>
            <label class="btn small"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg> Add videos<input type="file" accept="video/*" multiple hidden data-pin></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Purchase</legend>
          <div class="grid2">
            <label>Date bought<input type="date" name="buyDate" value="${esc(w.buyDate || (isNew ? today() : ""))}"></label>
            <label>Price paid<input name="buyPrice" inputmode="decimal" value="${esc(w.buyPrice ?? "")}" placeholder="0"></label>
          </div>
          <div class="grid2">
            <label>Extra costs<input name="extraCosts" inputmode="decimal" value="${esc(w.extraCosts ?? "")}" placeholder="service, polish, shipping in"></label>
            <label>Paid by<input name="buyPayment" list="dl-pay" value="${esc(w.buyPayment)}"></label>
          </div>
          <label>Bought from (seller)<input name="buyFrom" list="dl-from" value="${esc(w.buyFrom)}"></label>
          <details ${w.sellerAddress || w.sellerPhone || w.sellerEmail || w.sellerId ? "open" : ""}><summary>Seller details for the purchase agreement</summary>
            <div class="grid2" style="margin-top:10px">
              <label>Phone<input name="sellerPhone" type="tel" value="${esc(w.sellerPhone)}"></label>
              <label>Email<input name="sellerEmail" type="email" value="${esc(w.sellerEmail)}"></label>
            </div>
            <label style="margin-top:10px">Address<textarea name="sellerAddress" rows="2">${esc(w.sellerAddress)}</textarea></label>
            <label style="margin-top:10px">ID shown (type &amp; number)<input name="sellerId" value="${esc(w.sellerId)}" placeholder="e.g. Driver's license ••••1234"></label>
          </details>
        </fieldset>
        <label class="check"><input type="checkbox" id="is-sold" ${showSale ? "checked" : ""}> This watch is sold</label>
        <fieldset id="sale" ${showSale ? "" : "hidden"}>
          <legend>Sale</legend>
          <div class="grid2">
            <label>Date sold<input type="date" name="sellDate" value="${esc(w.sellDate || today())}"></label>
            <label>Sold for<input name="sellPrice" inputmode="decimal" value="${esc(w.sellPrice ?? "")}" placeholder="0"></label>
          </div>
          <div class="grid2">
            <label>Fees &amp; shipping out<input name="sellFees" inputmode="decimal" value="${esc(w.sellFees ?? "")}" placeholder="platform, card, shipping"></label>
            <label>Sold via<input name="soldVia" list="dl-via" value="${esc(w.soldVia)}" placeholder="eBay, Chrono24, direct…"></label>
          </div>
          <div class="grid2">
            <label>Client (buyer)<input name="soldTo" list="dl-client" value="${esc(w.soldTo)}"></label>
            <label>Client paid by<input name="sellPayment" list="dl-pay" value="${esc(w.sellPayment)}"></label>
          </div>
          <div class="grid2">
            <label>Client email<input name="buyerEmail" type="email" value="${esc(w.buyerEmail)}"></label>
            <label>Client phone<input name="buyerPhone" type="tel" value="${esc(w.buyerPhone)}"></label>
          </div>
          <label>Client address<textarea name="buyerAddress" rows="2">${esc(w.buyerAddress)}</textarea></label>
          <div class="hint" id="profit-hint"></div>
        </fieldset>
        <label>Notes<textarea name="notes">${esc(w.notes)}</textarea></label>
        <div class="actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">${isNew ? "Save watch" : "Save changes"}</button>
        </div>
        ${datalist("dl-brand", allBrands)}
        ${datalist("dl-model", allModels)}
        ${datalist("dl-ref", allRefs)}
        ${datalist("dl-from", db.watches.map((x) => x.buyFrom))}
        ${datalist("dl-client", clients.map((x) => x.soldTo))}
        ${datalist("dl-pay", PAYMENTS.concat(db.watches.map((x) => x.sellPayment), db.watches.map((x) => x.buyPayment)))}
        ${datalist("dl-via", ["eBay", "Chrono24", "Instagram", "Forum", "Direct", "Dealer"].concat(db.watches.map((x) => x.soldVia)))}
      </form>
    `, (root) => {
      const f = $("#wform", root);
      const soldBox = $("#is-sold", root);
      soldBox.addEventListener("change", () => { $("#sale", root).hidden = !soldBox.checked; updateHints(); });

      // Picking a returning client fills in their contact details.
      f.soldTo.addEventListener("change", () => {
        const prev = clients.filter((x) => fold(x.soldTo) === fold(f.soldTo.value)).sort((a, b) => (b.sellDate || "").localeCompare(a.sellDate || ""))[0];
        if (!prev) return;
        ["buyerEmail", "buyerPhone", "buyerAddress"].forEach((k) => { if (!f[k].value && prev[k]) f[k].value = prev[k]; });
      });

      /* --- configuration (text chips) --- */
      function drawConfig() {
        const { entry, spec, warnings } = CAT.resolve({ ref: f.ref.value, look }, db.refLooks);
        const dials = entry && !showAll ? entry.options.dial : Object.keys(CAT.DIALS);
        const straps = entry && !showAll ? entry.options.strap : Object.keys(CAT.STRAPS);
        let html = entry
          ? `<div class="note"><strong>${esc(entry.brand)} ${esc(entry.model)}</strong> — ${esc(entry.note)}</div>`
          : `<div class="note">${f.ref.value.trim() ? "Pick the dial and bracelet/strap this watch has — they'll be remembered for this reference." : "Type a reference to load the configurations it comes in."}</div>`;
        html += `<div class="pick-label">Dial${entry && dials.length === 1 && !showAll ? " · only one for this reference" : ""}</div><div class="swatches">${dials.map((k) => `<button type="button" class="swatch ${spec.dial === k ? "on" : ""}" data-dial="${k}" aria-pressed="${spec.dial === k}">${dialDot(k)}${esc(CAT.DIALS[k].label)}</button>`).join("")}</div>`;
        html += `<div class="pick-label">Bracelet / strap${entry && straps.length === 1 && !showAll ? " · only one for this reference" : ""}</div><div class="swatches">${straps.map((k) => `<button type="button" class="swatch ${spec.strap === k ? "on" : ""}" data-strap="${k}" aria-pressed="${spec.strap === k}">${esc(CAT.STRAPS[k].label)}</button>`).join("")}</div>`;
        if (entry) html += `<button type="button" class="linkbtn" id="cfg-all">${showAll ? "Only show this reference's configurations" : "Watch doesn't match? Show all dials & straps"}</button>`;
        $("#cfg-pickers", root).innerHTML = html;
        $("#cfg-warn", root).innerHTML = warnings.length ? `<div class="warnbox"><strong>Check this watch</strong>${warnings.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : "";
        $$("[data-dial]", root).forEach((b) => b.addEventListener("click", () => { look.dial = b.dataset.dial; drawConfig(); }));
        $$("[data-strap]", root).forEach((b) => b.addEventListener("click", () => { look.strap = b.dataset.strap; drawConfig(); }));
        $("#cfg-all", root)?.addEventListener("click", () => { showAll = !showAll; drawConfig(); });
      }

      let lastRef = normRef(f.ref.value);
      const filled = {}; // values this form filled in itself, so a new reference can replace them
      function applyRef() {
        if (normRef(f.ref.value) === lastRef) return;
        lastRef = normRef(f.ref.value);
        const info = refInfo(f.ref.value);
        const st = $("#ref-status", root);
        if (info) {
          [["brand", info.brand], ["model", info.model], ["caseInfo", info.caseInfo]].forEach(([k, v]) => {
            if (!v) return;
            if (!f[k].value || f[k].value === filled[k]) { f[k].value = v; filled[k] = v; }
          });
          st.className = "ref-status " + (info.how === "pattern" ? "partial" : "ok");
          st.textContent = info.how === "list" ? `✓ ${info.brand} ${info.model} — filled from the reference`
            : info.how === "mine" ? `✓ ${info.brand} ${info.model} — filled from your past entries`
            : `Brand recognised: ${info.brand}. Add the model once — it'll fill in automatically next time.`;
        } else {
          ["brand", "model", "caseInfo"].forEach((k) => { if (filled[k] && f[k].value === filled[k]) { f[k].value = ""; delete filled[k]; } });
          st.className = "ref-status";
          st.textContent = normRef(f.ref.value).length >= 4 ? "New reference — fill it in once and it'll fill in automatically next time." : "";
        }
        const entry = CAT.find(f.ref.value);
        if (entry) {
          if (look.dial && !entry.options.dial.includes(look.dial)) delete look.dial;
          if (look.strap && !entry.options.strap.includes(look.strap)) delete look.strap;
          showAll = false;
        }
        drawConfig();
        updateHints();
      }
      f.ref.addEventListener("input", applyRef);
      f.ref.addEventListener("change", applyRef);
      ["brand", "model", "buyPrice", "extraCosts", "sellPrice", "sellFees"].forEach((n) => f[n].addEventListener("input", updateHints));

      /* --- photos & videos --- */
      const existing = [...mediaFor(w.id)];
      const removed = new Set();
      function drawPhotos() {
        const items = existing.filter((p) => !removed.has(p.id)).map((p) => ({ key: p.id, src: p.thumb, kind: p.kind, locked: isLockedMedia(w, p) }))
          .concat(pending.map((p, i) => ({ key: "n" + i, src: p.kind === "photo" ? p.url : "", kind: p.kind })));
        $("#photo-row", root).innerHTML = items.length
          ? items.map((p) => `<div class="photo-tile ${p.kind}">${p.src ? `<img src="${p.src}" alt="">` : ""}${p.kind === "video" ? `<span class="play">▶</span>` : ""}${p.locked ? `<span class="lock">🔒</span>` : `<button type="button" class="x" data-rm="${p.key}" aria-label="Remove">×</button>`}</div>`).join("")
          : `<p class="muted" style="margin:0">Add photos and videos of this exact watch — dial, caseback, clasp, papers, and the watch running.</p>`;
        $$("[data-rm]", root).forEach((b) => b.addEventListener("click", () => {
          const k = b.dataset.rm;
          if (k.startsWith("n")) { const p = pending.splice(+k.slice(1), 1)[0]; if (p.url) URL.revokeObjectURL(p.url); }
          else removed.add(k);
          drawPhotos();
        }));
      }
      const queue = (files) => {
        files.filter((file) => /^(image|video)\//.test(file.type)).forEach((file) => {
          const kind = file.type.startsWith("video/") ? "video" : "photo";
          pending.push({ file, kind, url: kind === "photo" ? URL.createObjectURL(file) : "" });
        });
        drawPhotos();
      };
      dropTarget = queue;
      $$("[data-pin]", root).forEach((inp) => inp.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; queue(fl); }));

      function updateHints() {
        const t = { brand: f.brand.value, model: f.model.value, ref: f.ref.value };
        const h = history(t, w.id);
        const mk = marketFor(t);
        const bits = [];
        if (h.paid.length) {
          const paid = h.paid.map((x) => num(x.buyPrice));
          bits.push(`You've bought this ${h.paid.length}× — avg <strong>${money0(avg(paid))}</strong>, last <strong>${money0(paid[0])}</strong> (${fmtDate(h.paid[0].buyDate)}, ${esc(configText(h.paid[0]))}).`);
        }
        if (h.sold.length) bits.push(`You sold it ${h.sold.length}× — avg ${money0(avg(h.sold.map((x) => num(x.sellPrice))))}, avg net ${money0(avg(h.sold.map(profit)))}.`);
        if (mk.soldCount) bits.push(`Market median <strong>sold</strong>: ${money0(mk.median)} (${mk.soldCount} sales, 180 days).`);
        const bp = num(f.buyPrice.value) + num(f.extraCosts.value);
        const bm = bestMedian(t), mb = bm && maxBuy(bm.m.median);
        if (mb && !soldBox.checked) bits.push(`Max buy price for your target: <strong>${money0(mb.max)}</strong>${bp ? ` — you're ${bp <= mb.max ? `<span class="pos">${money0(mb.max - bp)} under</span>` : `<span class="neg">${money0(bp - mb.max)} over</span>`}` : ""}.`);
        $("#ref-hint", root).innerHTML = t.ref || t.model ? bits.join("<br>") : "";
        if (soldBox.checked && f.sellPrice.value) {
          $("#profit-hint", root).innerHTML = `Net profit: <strong>${signed(num(f.sellPrice.value) - num(f.sellFees.value) - bp)}</strong>`;
        } else $("#profit-hint", root).innerHTML = "";
      }
      drawConfig();
      drawPhotos();
      updateHints();

      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        ["buyPrice", "extraCosts", "sellPrice", "sellFees"].forEach((k) => (data[k] = data[k] === "" ? "" : num(data[k])));
        Object.keys(data).forEach((k) => typeof data[k] === "string" && (data[k] = data[k].trim()));
        data.ref = data.ref.toUpperCase();
        data.status = soldBox.checked ? "sold" : "stock";
        if (!soldBox.checked) ["sellDate", "sellPrice", "sellFees", "soldVia", "soldTo", "sellPayment", "buyerEmail", "buyerPhone", "buyerAddress"].forEach((k) => (data[k] = ""));
        const { entry, spec } = CAT.resolve({ ref: data.ref, look }, db.refLooks);
        data.look = { dial: spec.dial, strap: spec.strap };
        if (!entry && data.ref) db.refLooks[normRef(data.ref)] = { dial: spec.dial, strap: spec.strap };
        let id = w.id;
        if (isNew) {
          id = uid();
          db.watches.push({ id, created: new Date().toISOString(), checks: [], ...data });
        } else {
          Object.assign(db.watches.find((x) => x.id === w.id), data, { updated: new Date().toISOString() });
        }
        save();
        try {
          for (const pid of removed) await removeMedia(id, pid);
          if (pending.length) await addFiles(id, pending.map((p) => p.file));
          pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
        } catch { toast("Watch saved, but some files couldn't be stored on this device."); }
        render();
        toast(isNew ? "Watch saved" : data.status === "sold" && !isSold(w) ? "Marked sold" : "Saved");
        showWatch(id);
      });
      if (isNew && !w.ref) f.ref.focus();
      else if (sell) f.sellPrice.focus();
    });
  }

  /* ---------- Market comps ---------- */

  function renderMarket() {
    view.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">Market</div><h1>What watches actually sell for</h1></div>
        <button class="btn" id="add-comp">Log a comp</button></div>
      <div class="note">
        <strong>Sold ≠ asking.</strong> Only completed sales count toward the market median. Asking prices you log are kept apart
        and shown for comparison, so you can see the gap between what dealers ask and what watches really go for.
        Your own sales of the same reference count as sold comps too.
      </div>
      <div class="search" style="margin-top:12px">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="mq" placeholder="Reference or model, e.g. 126610LN" value="${esc(ui.mq)}" autocomplete="off" aria-label="Look up a watch">
      </div>
      <div id="mresult"></div>
    `;
    const mq = $("#mq");
    mq.addEventListener("input", () => { ui.mq = mq.value; drawMarket(); });
    $("#add-comp").addEventListener("click", () => editComp(guessFromQuery(ui.mq)));
    drawMarket();
  }

  function guessFromQuery(q) {
    if (!normRef(q)) return {};
    const info = refInfo(q);
    return info ? { brand: info.brand, model: info.model, ref: info.ref || q.trim() } : { ref: q.trim() };
  }

  /* Only sources that show COMPLETED sales. Asking-price sites (Chrono24, dealer sites, eBay active listings) are not comps. */
  function soldLinks(q, median) {
    const enc = encodeURIComponent(q);
    const floor = median ? `&_udlo=${Math.floor((median * 0.4) / 100) * 100}` : "";
    return `<div class="links">
      <a class="btn small primary" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${enc}&_sacat=31387&LH_Sold=1&LH_Complete=1&_sop=13${floor}">eBay — sold listings</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://130point.com/sales/">130point — real Best Offer prices</a>
    </div>`;
  }

  function drawMarket() {
    const out = $("#mresult");
    const q = ui.mq.trim();
    if (!q) {
      const groups = new Map();
      db.comps.forEach((c) => {
        const k = normRef(c.ref) || fold(c.brand + " " + c.model);
        if (!groups.has(k)) groups.set(k, c);
      });
      const rows = [...groups.values()].map((c) => ({ c, m: marketFor(c) })).sort((a, b) => b.m.soldCount - a.m.soldCount);
      const famSeen = new Set();
      const guide = CAT.REFS.filter((r) => (famSeen.has(r.family) ? false : famSeen.add(r.family)));
      out.innerHTML = `
        ${rows.length ? `<div class="section"><h3>References you track · last 180 days</h3><div class="list">${rows.map(({ c, m }) => `
          <button class="item" type="button" data-q="${esc(c.ref || label(c))}">
            <div class="thumb">${refThumb(c.ref, c.brand)}</div>
            <div class="item-main"><div class="title">${esc(label(c))}</div><div class="meta">${esc(c.ref || "")}</div>
              <div class="meta">${m.soldCount} sold${m.askingCount ? ` · asking ${money0(m.askingMedian)}` : ""}${m.median && m.askingMedian ? ` · asking is ${pct((m.askingMedian - m.median) / m.median)} above sold` : ""}</div></div>
            <div class="right"><div class="big">${money0(m.median)}</div><div class="meta">median sold</div></div>
          </button>`).join("")}</div></div>`
          : `<div class="empty section">No comps logged yet. Search a reference, check the sold listings, and log the real sale prices you find.</div>`}
        <div class="section">
          <h3>Reference guide — configurations</h3>
          <p class="muted" style="margin-top:0">Built-in references and the dials and bracelets/straps each one comes in.</p>
          <div class="list">${guide.map((r) => {
            const fam = CAT.family(r);
            const n = fam.reduce((t, x) => t + CAT.configurations(x).length, 0);
            return `<button class="item" type="button" data-guide="${esc(r.family)}"><div class="thumb">${refThumb(r.ref, r.brand)}</div>
              <div class="item-main"><div class="title">${esc(r.brand)} ${esc(r.model.replace(/ \(.*\)$/, ""))}</div><div class="meta">${fam.map((x) => esc(x.ref)).join(" · ")}</div></div>
              <div class="right"><div class="meta">${n} config${n > 1 ? "s" : ""}</div></div></button>`;
          }).join("")}</div>
        </div>`;
      $$("[data-q]", out).forEach((a) => a.addEventListener("click", () => { ui.mq = a.dataset.q; $("#mq").value = ui.mq; drawMarket(); }));
      $$("[data-guide]", out).forEach((t) => t.addEventListener("click", () => showFamily(t.dataset.guide)));
      return;
    }

    const target = guessFromQuery(q);
    const entry = CAT.find(q);
    const exactRef = !!entry || db.comps.some((c) => normRef(c.ref) === normRef(q)) || db.watches.some((w) => normRef(w.ref) === normRef(q));
    let comps, m90, m180, mAll;
    if (exactRef) {
      m90 = marketFor(target, { days: 90 });
      m180 = marketFor(target, { days: 180 });
      mAll = marketFor(target, { days: 0 });
      comps = mAll.comps;
    } else {
      comps = db.comps.filter((c) => matches(fold([c.brand, c.model, c.ref, c.source, c.notes].join(" ")) + " " + normRef(c.ref), q))
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }
    const stat = (t, mk) => `<div class="card stat"><div class="label">${t}</div><div class="value">${money0(mk.median)}</div><div class="sub">${mk.soldCount} sold${mk.soldCount ? ` · ${money0(mk.low)}–${money0(mk.high)}` : ""}</div></div>`;
    const mineHist = exactRef ? history(target) : null;

    out.innerHTML = `
      <div class="section">
        ${exactRef ? `<div class="market-head">
          <div><div class="brand-line">${esc(target.brand || "")}</div><h2>${esc(target.model || "")} <span class="ref">${esc(target.ref || q)}</span></h2>
          ${entry ? `<p class="muted" style="margin:4px 0 0">${esc(entry.note)}</p>` : ""}
          ${entry ? `<button class="linkbtn" id="see-cfg">See every configuration</button>` : ""}</div>
        </div>
        <div class="stats" style="margin-top:12px">
            ${stat("Median sold · 90 days", m90)}
            ${stat("Median sold · 180 days", m180)}
            ${stat("Median sold · all time", mAll)}
            <div class="card stat"><div class="label">Median asking</div><div class="value">${m180.askingCount ? money0(m180.askingMedian) : "—"}</div>
              <div class="sub">${m180.askingCount ? `${m180.askingCount} listings${m180.median ? " · " + pct((m180.askingMedian - m180.median) / m180.median) + " above sold" : ""}` : "none logged"}</div></div>
          </div>
          ${mineHist && mineHist.paid.length ? `<div class="note" style="margin-top:10px">You've paid ${mineHist.paid.map((x) => money0(num(x.buyPrice))).slice(0, 6).join(", ")}${mineHist.paid.length > 6 ? "…" : ""} for this reference (most recent first).</div>` : ""}`
        : `<h2>Comps matching “${esc(q)}”</h2>`}
      </div>
      ${exactRef ? `<div class="section card plan" id="plan"></div>` : ""}
      <div class="section">
        <h3>Check real sold prices</h3>
        ${soldLinks(q, (m90?.median || m180?.median))}
        <div class="note" style="margin-top:8px"><strong>Sold only.</strong> The eBay button shows completed sales for this reference, newest first, in Wristwatches${m180?.median ? ", hiding cheap results like straps and boxes" : ""}.
          If a result says <strong>“Best offer accepted”</strong>, the crossed-out price is what the seller <em>asked</em>, not what it sold for — copy that listing's link into 130point to see the real price.
          Chrono24 and dealer sites only show watches <em>for sale</em>, so they're not used for comps here.</div>
      </div>
      <form class="section card form" id="quick" autocomplete="off" novalidate>
        <h3 style="margin:0">Add the sold prices you just looked up</h3>
        <label>Sold prices<input name="prices" inputmode="decimal" placeholder="e.g. 13,100  12,950  13,300"></label>
        <div class="grid2">
          <label>Source<select name="source">${options(SOURCES, "eBay (sold)")}</select></label>
          <label>Date sold<input type="date" name="date" value="${today()}"></label>
        </div>
        <div class="actions" style="position:static;background:none;padding:0"><button type="submit" class="btn primary">Add sold prices</button></div>
      </form>
      <div class="section">
        <div class="section-head"><h3 style="margin:0">Logged comps (${comps.length})</h3><button class="btn small" id="add-comp-2">Log a comp</button></div>
        ${comps.length ? `<div class="list">${comps.map(compHTML).join("")}</div>` : `<div class="empty">No comps logged for this yet.</div>`}
      </div>
    `;
    $("#add-comp-2").addEventListener("click", () => editComp(target));
    if (exactRef) drawPlan(target);
    $("#quick").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const prices = (f.prices.value.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).map((x) => num(x)).filter((x) => x > 0);
      if (!prices.length) { toast("Type one or more prices first."); return; }
      const ref = (target.ref || q).toUpperCase();
      prices.forEach((price) => db.comps.push({ id: uid(), created: new Date().toISOString(), kind: "sold", ref, brand: target.brand || "", model: target.model || "", price, date: f.date.value || today(), source: f.source.value, condition: "", set: "", link: "", notes: "" }));
      save(); drawMarket();
      toast(`${prices.length} sold price${prices.length > 1 ? "s" : ""} added`);
    });
    $("#see-cfg")?.addEventListener("click", () => showFamily(entry.family, entry.ref));
    $$(".item[data-comp]", out).forEach((b) => b.addEventListener("click", () => editComp(db.comps.find((c) => c.id === b.dataset.comp))));
  }

  function drawPlan(target) {
    const box = $("#plan");
    if (!box) return;
    const bm = bestMedian(target);
    const mb = bm && maxBuy(bm.m.median);
    const p = buyPlan();
    box.innerHTML = `
      <h3 style="margin:0 0 8px">What to pay</h3>
      ${mb ? `<div class="plan-out">
          <div><div class="label">Max buy price</div><div class="plan-max">${money0(mb.max)}</div></div>
          <div class="muted">Based on ${bm.days}-day median sold <strong>${money0(bm.m.median)}</strong> (${bm.m.soldCount} sale${bm.m.soldCount > 1 ? "s" : ""}). Break-even ${money0(mb.breakEven)}.</div>
        </div>` : `<p class="muted" style="margin:0 0 8px">Add a few sold prices below to see the most you should pay.</p>`}
      <div class="grid3" style="margin-top:10px">
        <label>Selling fees %<input data-plan="planFeePct" inputmode="decimal" value="${p.fee || ""}" placeholder="0"></label>
        <label>Shipping &amp; other $<input data-plan="planShip" inputmode="decimal" value="${p.ship || ""}" placeholder="0"></label>
        <label>Target profit $<input data-plan="planProfit" inputmode="decimal" value="${p.profit || ""}" placeholder="0"></label>
      </div>`;
    $$("[data-plan]", box).forEach((inp) => inp.addEventListener("change", () => { db.settings[inp.dataset.plan] = inp.value; save(); drawPlan(target); }));
  }

  function showFamily(fam, highlightRef) {
    const refs = CAT.REFS.filter((r) => r.family === fam);
    const first = refs[0];
    openSheet(`${first.brand} ${first.model.replace(/ \(.*\)$/, "")}`, `
      <p class="muted" style="margin-top:0">Use this to confirm the reference on the papers matches the watch in hand — dial and bracelet or strap.</p>
      ${refs.map((r) => `
        <div class="section ${r.ref === highlightRef ? "hl" : ""}">
          <div class="section-head" style="margin-bottom:6px"><h2 class="ref">${esc(r.ref)}</h2><button class="btn small" data-mq="${esc(r.ref)}">Market</button></div>
          <p class="muted" style="margin:0 0 8px">${esc(r.note)}</p>
          <div class="cfg-chips">${CAT.configurations(r).map((c) => {
            const owned = db.watches.filter((w) => !isSold(w) && normRef(w.ref) === normRef(r.ref) && lookOf(w).spec.dial === c.dial && lookOf(w).spec.strap === c.strap).length;
            return `<span class="cfg-chip">${dialDot(c.dial)}${esc(CAT.DIALS[c.dial].label)} · ${esc(CAT.STRAPS[c.strap].label)}${owned ? ` <span class="badge stock">${owned} in stock</span>` : ""}</span>`;
          }).join("")}</div>
        </div>`).join("")}
    `, (root) => {
      $$("[data-mq]", root).forEach((b) => b.addEventListener("click", () => goMarket(b.dataset.mq)));
      if (highlightRef) root.querySelector(".hl")?.scrollIntoView({ block: "start" });
    });
  }

  function compHTML(c) {
    return `<button class="item" type="button" data-comp="${c.id}">
      <div class="thumb">${refThumb(c.ref, c.brand)}</div>
      <div class="item-main"><div class="title">${esc(label(c))} ${esc(c.ref || "")}${c.kind === "asking" ? `<span class="badge asking">Asking</span>` : `<span class="badge sold">Sold</span>`}</div>
      <div class="meta">${[fmtDate(c.date), c.source, c.condition, c.set].filter(Boolean).map(esc).join(" · ")}</div>
      ${c.notes ? `<div class="meta">${esc(c.notes)}</div>` : ""}</div>
      <div class="right"><div class="big">${money0(num(c.price))}</div></div>
    </button>`;
  }

  const SOURCES = ["eBay (sold)", "eBay Best Offer (130point)", "Auction result (realized price)", "Forum / dealer group (sold)", "Private sale", "My own sale", "Other (sold)"];
  const ASK_SOURCES = ["Chrono24 listing", "eBay active listing", "Dealer listing", "Instagram / forum listing", "Other listing"];

  function editComp(c = {}) {
    const isNew = !c.id;
    openSheet(isNew ? "Log a market comp" : "Edit comp", `
      <form class="form" id="cform" autocomplete="off" novalidate>
        <div class="chips" role="radiogroup" aria-label="Type">
          <button type="button" class="chip" data-kind="sold" aria-pressed="${c.kind !== "asking"}">Sold price</button>
          <button type="button" class="chip" data-kind="asking" aria-pressed="${c.kind === "asking"}">Asking price</button>
        </div>
        <div class="note" id="kind-note"></div>
        <div class="grid2">
          <label>Reference<input name="ref" list="dl-cref" value="${esc(c.ref)}"></label>
          <label>Price<input name="price" inputmode="decimal" value="${esc(c.price ?? "")}"></label>
        </div>
        <div class="grid2">
          <label>Brand<input name="brand" list="dl-cbrand" value="${esc(c.brand)}"></label>
          <label>Model<input name="model" list="dl-cmodel" value="${esc(c.model)}"></label>
        </div>
        <div class="grid2">
          <label>Date<input type="date" name="date" value="${esc(c.date || today())}"></label>
          <label>Source<select name="source" id="c-source"></select></label>
        </div>
        <div class="grid2">
          <label>Condition<select name="condition">${options(CONDITIONS, c.condition)}</select></label>
          <label>Box / papers<select name="set">${options(SETS, c.set)}</select></label>
        </div>
        <label>Link<input name="link" type="url" value="${esc(c.link)}" placeholder="https://"></label>
        <label>Notes<input name="notes" value="${esc(c.notes)}"></label>
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">Open link</a>` : ""}
        <div class="actions">
          ${isNew ? "" : `<button type="button" class="btn danger" id="c-del">Delete</button>`}
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">Save comp</button>
        </div>
        ${datalist("dl-cbrand", db.watches.map((x) => x.brand).concat(db.comps.map((x) => x.brand), CAT.REFS.map((r) => r.brand)))}
        ${datalist("dl-cmodel", db.watches.map((x) => x.model).concat(db.comps.map((x) => x.model), CAT.REFS.map((r) => r.model)))}
        ${datalist("dl-cref", db.watches.map((x) => x.ref).concat(db.comps.map((x) => x.ref), CAT.REFS.map((r) => r.ref)))}
      </form>
    `, (root) => {
      const f = $("#cform", root);
      let kind = c.kind === "asking" ? "asking" : "sold";
      const setKind = (k) => {
        kind = k;
        $$("[data-kind]", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === k));
        $("#kind-note", root).innerHTML = k === "sold"
          ? "<strong>Sold:</strong> a completed sale — eBay sold listing, auction result, a deal you saw close. This counts toward the market median."
          : "<strong>Asking:</strong> a listing that hasn't sold (Chrono24, dealer sites, active eBay listings). Kept for comparison only — it does <strong>not</strong> affect the market median.";
        const sel = $("#c-source", root), cur = sel.value || c.source;
        const list = k === "sold" ? SOURCES : ASK_SOURCES;
        sel.innerHTML = options(list, list.includes(cur) ? cur : (c.kind === k || (!c.kind && k === "sold")) && cur ? cur : "");
      };
      setKind(kind);
      $$("[data-kind]", root).forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));
      const cfilled = {};
      const fillComp = () => {
        const info = refInfo(f.ref.value);
        [["brand", info?.brand], ["model", info?.model]].forEach(([k, v]) => {
          if (v && (!f[k].value || f[k].value === cfilled[k])) { f[k].value = v; cfilled[k] = v; }
        });
      };
      f.ref.addEventListener("input", fillComp);
      f.ref.addEventListener("change", fillComp);
      $("#c-del", root)?.addEventListener("click", async () => {
        if (!(await ask("Delete this comp?", { ok: "Delete", danger: true }))) return;
        db.comps = db.comps.filter((x) => x.id !== c.id);
        save(); closeSheet(); render(); toast("Comp deleted");
      });
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        Object.keys(data).forEach((k) => (data[k] = String(data[k]).trim()));
        data.price = num(data.price);
        data.ref = data.ref.toUpperCase();
        data.kind = kind;
        if (isNew) db.comps.push({ id: uid(), created: new Date().toISOString(), ...data });
        else Object.assign(db.comps.find((x) => x.id === c.id), data);
        save();
        closeSheet();
        if (ui.tab === "market" && !ui.mq) ui.mq = data.ref;
        render();
        toast("Comp saved");
      });
      if (!c.ref) f.ref.focus(); else f.price.focus();
    });
  }

  /* ---------- Business, backup & settings ---------- */

  function renderSettings() {
    const b = biz();
    const all = [...media.values()].flat();
    const nP = all.filter((m) => m.kind === "photo").length, nV = all.filter((m) => m.kind === "video").length;
    const vBytes = all.filter((m) => m.kind === "video").reduce((t, m) => t + (m.size || 0), 0);
    view.innerHTML = `
      <div class="eyebrow">Business</div><h1>Your business</h1>

      <form class="section card form" id="biz" autocomplete="off" novalidate>
        <h3>Business details — printed on every document</h3>
        <div class="logo-row">
          <div class="logo-box" id="logo-box"><img src="${b.logo || "logo-ink.png"}" alt="Logo"></div>
          <div class="row-actions">
            <label class="btn small">${b.logo ? "Change logo" : "Use a different logo"}<input type="file" accept="image/*" hidden id="logo-in"></label>
            ${b.logo ? `<button type="button" class="btn small" id="logo-rm">Back to CIG logo</button>` : ""}
          </div>
        </div>
        <div class="grid2">
          <label>Business name<input name="name" value="${esc(b.name)}"></label>
          <label>Your name &amp; title (signs documents)<input name="signer" value="${esc(b.signer)}" placeholder="e.g. Jane Smith, Owner"></label>
        </div>
        <label>Address<textarea name="address" rows="2">${esc(b.address)}</textarea></label>
        <div class="grid3">
          <label>Phone<input name="phone" type="tel" value="${esc(b.phone)}"></label>
          <label>Email<input name="email" type="email" value="${esc(b.email)}"></label>
          <label>Website<input name="website" value="${esc(b.website)}"></label>
        </div>
        <label>Tax / business ID (optional, printed on bills of sale)<input name="taxId" value="${esc(b.taxId)}"></label>
        <label>Sale terms — warranty &amp; return policy (bill of sale)<textarea name="terms" rows="4" placeholder="e.g. Returns accepted within 3 days of delivery if returned in the same condition. 12-month warranty on movement function, excluding water damage, impact and misuse.">${esc(b.terms)}</textarea></label>
        <label>Extra purchase terms (purchase agreement, optional)<textarea name="purchaseTerms" rows="3">${esc(b.purchaseTerms)}</textarea></label>
        <label>Thank-you letter message<textarea name="thankYou" rows="7">${esc(b.thankYou || DOCS.DEFAULT_THANKS)}</textarea></label>
        <p class="muted" style="margin:0;font-size:12px">In the letter, {watch} becomes the watch name and {business} your business name. Every document can also be edited on screen before you print it. These are templates — have your attorney review the wording for your state.</p>
        <div class="actions"><button type="submit" class="btn primary">Save business details</button></div>
      </form>

      <div class="section card">
        <h3>Backup</h3>
        <div class="note" style="margin-bottom:10px">Everything is stored <strong>only on this device, in this browser</strong>. Export a backup regularly (e.g. every month-end) and keep it in iCloud or Google Drive. For pre-ship videos, also use <strong>Download</strong> on the watch so the original files are kept somewhere safe.</div>
        <p class="muted" style="margin-top:0">${db.watches.length} watches · ${db.comps.length} comps · ${nP} photos · ${nV} videos (${fmtSize(vBytes) || "0 KB"}) <span id="quota"></span></p>
        <label class="check"><input type="checkbox" id="exp-photos" checked> Include photos</label>
        <label class="check" style="margin-bottom:10px"><input type="checkbox" id="exp-videos"> Include videos (file can get very large)</label>
        <div class="row-actions">
          <button class="btn primary" id="exp">Export backup (.json)</button>
          <label class="btn" style="color:var(--text);font-size:15px">Import backup<input type="file" id="imp" accept="application/json,.json" hidden></label>
        </div>
      </div>

      <div class="section card">
        <h3>Spreadsheets</h3>
        <div class="row-actions">
          <button class="btn" id="csv-all">All watches (CSV)</button>
          <button class="btn" id="csv-stock">Current inventory (CSV)</button>
          <button class="btn" id="csv-comps">Market comps (CSV)</button>
        </div>
      </div>

      <div class="section card">
        <h3>Settings</h3>
        <div class="grid2">
          <label>Currency<select id="cur">${["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY", "HKD", "SGD", "MXN"].map((c) => `<option ${db.settings.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <label>Theme<select id="theme">${[["", "Match device"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<option value="${v}" ${(db.settings.theme || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <label style="margin-top:10px">Next invoice number<input id="inv-next" inputmode="numeric" value="${esc(db.settings.nextInvoice || 1001)}"></label>
      </div>

      <div class="section card">
        <h3>Try it out</h3>
        <p class="muted" style="margin-top:0">Load example watches and comps to see how everything works. You can erase them afterwards.</p>
        <div class="row-actions">
          <button class="btn" id="demo">Load sample data</button>
          <button class="btn danger" id="wipe">Erase all data</button>
        </div>
      </div>
    `;
    navigator.storage?.estimate?.().then((e) => { const q = $("#quota"); if (q && e.quota) q.textContent = `· ${fmtSize(e.usage) || "0 KB"} used of ${fmtSize(e.quota)} available`; }).catch(() => {});

    const bf = $("#biz");
    bf.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries([...new FormData(bf)].map(([k, v]) => [k, String(v).trim()]));
      if (data.thankYou === DOCS.DEFAULT_THANKS.trim()) data.thankYou = "";
      db.business = { ...db.business, ...data };
      save(); renderBrand(); toast("Business details saved");
    });
    $("#logo-in").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        db.business = { ...db.business, logo: await shrink(file, 700, 0.92, "image/png") };
        save(); renderBrand(); render(); toast("Logo saved");
      } catch { toast("Couldn't read that image."); }
    });
    $("#logo-rm")?.addEventListener("click", () => { delete db.business.logo; save(); renderBrand(); render(); });

    $("#exp").addEventListener("click", async () => {
      toast("Preparing backup…");
      let recs = [];
      try { recs = await mediaDB.all(); } catch {}
      const photos = $("#exp-photos").checked ? recs.filter((r) => r.kind !== "video") : [];
      const videos = $("#exp-videos").checked ? recs.filter((r) => r.kind === "video") : [];
      const head = JSON.stringify({ app: "watch-ledger", version: 3, exported: new Date().toISOString(), ...db, photos });
      const parts = [head.slice(0, -1), ',"videos":['];
      for (let i = 0; i < videos.length; i++) {
        const { blob, ...meta } = videos[i];
        parts.push((i ? "," : "") + JSON.stringify({ ...meta, data: await blobToDataURL(blob) }));
      }
      parts.push("]}");
      saveBlob(new Blob(parts, { type: "application/json" }), `cig-timepieces-backup-${today()}.json`);
    });
    $("#imp").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.watches)) throw new Error("bad");
        const choice = await ask(`Backup has ${data.watches.length} watches, ${(data.comps || []).length} comps, ${(data.photos || []).length} photos and ${(data.videos || []).length} videos.`, { buttons: [{ label: "Cancel", value: null }, { label: "Add to my data", value: "merge" }, { label: "Replace everything", value: "replace", kind: "primary" }] });
        if (!choice) return;
        const replace = choice === "replace";
        if (replace) {
          db = { ...blank(), watches: data.watches, comps: data.comps || [], refLooks: data.refLooks || {}, business: data.business || {}, settings: { ...blank().settings, ...(data.settings || {}) } };
          try { await mediaDB.clear(); } catch {}
        } else {
          const ids = new Set(db.watches.map((w) => w.id));
          const cids = new Set(db.comps.map((c) => c.id));
          db.watches.push(...data.watches.filter((w) => !ids.has(w.id)));
          db.comps.push(...(data.comps || []).filter((c) => !cids.has(c.id)));
          db.refLooks = { ...(data.refLooks || {}), ...db.refLooks };
          if (!db.business?.name && data.business) db.business = data.business;
        }
        try {
          for (const p of data.photos || []) if (!String(p.watchId).startsWith("ref:")) await mediaDB.put(p);
          for (const v of data.videos || []) { const { data: d, ...meta } = v; await mediaDB.put({ ...meta, blob: await (await fetch(d)).blob() }); }
        } catch { toast("Records imported, but some files couldn't be stored."); }
        save(); await loadMedia(); setFormats(); applyTheme(); renderBrand(); render(); toast("Backup imported");
      } catch {
        toast("That file isn't a CIG Timepieces backup (or it's too large to open here).");
      }
    });
    $("#csv-all").addEventListener("click", () => download(`watches-${today()}.csv`, toCSV(db.watches), "text/csv"));
    $("#csv-stock").addEventListener("click", () => download(`inventory-${today()}.csv`, toCSV(db.watches.filter((w) => !isSold(w))), "text/csv"));
    $("#csv-comps").addEventListener("click", () => download(`market-comps-${today()}.csv`, compsCSV(), "text/csv"));
    $("#cur").addEventListener("change", (e) => { db.settings.currency = e.target.value; save(); setFormats(); toast("Currency updated"); });
    $("#theme").addEventListener("change", (e) => { db.settings.theme = e.target.value; save(); applyTheme(); });
    $("#inv-next").addEventListener("change", (e) => { const n = parseInt(e.target.value, 10); if (n > 0) { db.settings.nextInvoice = n; save(); toast("Invoice numbering updated"); } });
    $("#demo").addEventListener("click", async () => {
      if (db.watches.length && !(await ask("Add sample data alongside your existing data?", { ok: "Add sample data" }))) return;
      loadDemo(); save(); toast("Sample data loaded"); location.hash = "#inventory";
    });
    $("#wipe").addEventListener("click", async () => {
      if (!(await ask("Erase ALL watches, comps, photos and videos on this device? This cannot be undone — export a backup first if you need one.", { ok: "Erase everything", danger: true }))) return;
      db = { ...blank(), business: db.business, settings: db.settings };
      try { await mediaDB.clear(); } catch {}
      media.clear();
      save(); render(); toast("All data erased");
    });
  }

  function applyTheme() {
    const t = db.settings.theme;
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  /* ---------- Files ---------- */

  function csvCell(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCSV(list) {
    const head = ["Brand", "Model", "Reference", "Case", "Dial", "Bracelet/strap", "Serial", "Year", "Condition", "Box/Papers", "Status", "Date bought", "Price paid", "Extra costs", "Cost basis", "Bought from", "Paid by", "Date sold", "Sold for", "Fees & shipping", "Net profit", "Days held", "Sold via", "Client", "Client email", "Client phone", "Client paid by", "Invoice", "Pre-ship check", "Tracking", "Config check", "Notes"];
    const rows = list.map((w) => {
      const { spec, warnings } = lookOf(w);
      const ck = lastLocked(w);
      return [
        w.brand, w.model, w.ref, w.caseInfo, CAT.DIALS[spec.dial]?.label, CAT.STRAPS[spec.strap]?.label, w.serial, w.year, w.condition, w.set, isSold(w) ? "Sold" : "In stock",
        w.buyDate, num(w.buyPrice), num(w.extraCosts), costBasis(w), w.buyFrom, w.buyPayment,
        w.sellDate, isSold(w) ? num(w.sellPrice) : "", isSold(w) ? num(w.sellFees) : "", isSold(w) ? profit(w) : "",
        isSold(w) ? daysBetween(w.buyDate, w.sellDate) ?? "" : "", w.soldVia, w.soldTo, w.buyerEmail, w.buyerPhone, w.sellPayment, w.invoiceNo,
        ck ? "Signed off " + fmtWhen(ck.completedAt) : "", ck?.tracking, warnings.join(" "), w.notes,
      ];
    });
    return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  }
  function compsCSV() {
    const head = ["Type", "Brand", "Model", "Reference", "Price", "Date", "Source", "Condition", "Box/Papers", "Link", "Notes"];
    const rows = db.comps.map((c) => [c.kind === "asking" ? "Asking" : "Sold", c.brand, c.model, c.ref, num(c.price), c.date, c.source, c.condition, c.set, c.link, c.notes]);
    return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  }
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function download(name, text, type) {
    saveBlob(new Blob([type === "text/csv" ? "﻿" + text : text], { type }), name);
  }
  const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
    catch { await ask(text, { buttons: [{ label: "Close", value: true }] }); }
  }

  /* ---------- Sample data ---------- */

  function loadDemo() {
    const d = (offset) => { const t = new Date(); t.setDate(t.getDate() - offset); return t.toISOString().slice(0, 10); };
    const W = (brand, model, ref, look, year, buyAgo, buy, extra, sellAgo, sell, fees, via, set = "Full set (box & papers)", cond = "Excellent", notes = "Sample data", client = "") => ({
      id: uid(), brand, model, ref, look, year, set, condition: cond, buyDate: d(buyAgo), buyPrice: buy, extraCosts: extra, buyFrom: "Sample Seller", buyPayment: "Wire transfer",
      status: sellAgo == null ? "stock" : "sold", sellDate: sellAgo == null ? "" : d(sellAgo), sellPrice: sell ?? "", sellFees: fees ?? "", soldVia: via || "",
      soldTo: sellAgo == null ? "" : client || "Sample Client", sellPayment: sellAgo == null ? "" : "Wire transfer", notes, checks: [],
    });
    const dj = W("Rolex", "Datejust 41", "126300", { dial: "blue", strap: "jubilee" }, "2020", 15, 9100, 0, 4, 9900, 300, "Direct", undefined, undefined, "Sample data", "Sample Client");
    dj.serial = "SAMPLE0001";
    dj.buyerEmail = "client@example.com";
    dj.checks.push({ id: uid(), created: new Date(Date.now() - 5 * 864e5).toISOString(), completedAt: new Date(Date.now() - 5 * 864e5 + 36e5).toISOString(), locked: true, by: "Sample",
      items: Object.fromEntries(ALL_ITEMS.map((k) => [k, k === "chrono" || k === "wr" ? "na" : "pass"])), rate: "+2", amplitude: "285", beatError: "0.1", carrier: "FedEx", tracking: "SAMPLE123456", insured: "$9,900", notes: "Sample check (no video in sample data)." });
    db.watches.push(
      W("Rolex", "Submariner Date", "126610LN", { dial: "black", strap: "oyster" }, "2022", 300, 11800, 0, 270, 13400, 420, "Direct"),
      W("Rolex", "Submariner Date", "126610LN", { dial: "black", strap: "oyster" }, "2021", 120, 12100, 150, 95, 13250, 400, "Chrono24"),
      W("Rolex", "Submariner Date", "126610LN", { dial: "black", strap: "oyster" }, "2023", 20, 12300, 0, null),
      W("Rolex", "GMT-Master II “Pepsi”", "126710BLRO", { dial: "black", strap: "jubilee" }, "2022", 35, 19800, 0, null),
      W("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", { dial: "black", strap: "bracelet" }, "2021", 200, 5200, 0, 150, 6100, 610, "eBay"),
      W("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", { dial: "black", strap: "leather-black" }, "2022", 40, 5050, 0, 12, 5900, 590, "eBay", "Watch only", "Excellent", "Sample data — seller had swapped the bracelet for a strap"),
      W("Tudor", "Black Bay 58", "M79030N-0001", { dial: "black-gilt", strap: "rivet" }, "2020", 150, 2900, 120, 110, 3450, 120, "Instagram", "Watch only"),
      W("Tudor", "Black Bay 58 Blue", "M79030B-0003", { dial: "navy", strap: "fabric-blue" }, "2022", 25, 3000, 0, null),
      W("Tudor", "Pelagos 39", "M25407N-0001", { dial: "black", strap: "bracelet" }, "2023", 70, 3900, 0, 33, 4300, 140, "Direct"),
      W("Cartier", "Santos de Cartier Medium", "WSSA0029", { dial: "silver", strap: "santos" }, "2022", 60, 5600, 0, 28, 6350, 210, "Chrono24"),
      W("Grand Seiko", "Snowflake", "SBGA211", { dial: "snowflake", strap: "bracelet" }, "2019", 90, 4300, 250, null, null, null, "", "Full set (box & papers)", "Very good"),
      dj,
      W("Rolex", "Datejust 41", "126334", { dial: "slate", strap: "oyster" }, "2021", 10, 11200, 0, null),
      W("Omega", "Seamaster Diver 300M", "210.30.42.20.03.001", { dial: "blue", strap: "bracelet" }, "2022", 8, 3600, 0, null),
    );
    const C = (brand, model, ref, ago, price, source, kind = "sold") => ({ id: uid(), brand, model, ref, date: d(ago), price, source, kind, condition: "Excellent", set: "Full set (box & papers)", link: "", notes: "Sample data" });
    db.comps.push(
      C("Rolex", "Submariner Date", "126610LN", 10, 13100, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 25, 12950, "Forum / dealer group (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 40, 13300, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 61, 13050, "Auction result (realized price)"),
      C("Rolex", "Submariner Date", "126610LN", 5, 14500, "Dealer listing", "asking"),
      C("Rolex", "Submariner Date", "126610LN", 9, 14900, "Dealer listing", "asking"),
      C("Rolex", "GMT-Master II “Pepsi”", "126710BLRO", 18, 21200, "eBay (sold)"),
      C("Rolex", "GMT-Master II “Pepsi”", "126710BLRO", 6, 23500, "Dealer listing", "asking"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 14, 5750, "eBay (sold)"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 30, 5600, "eBay (sold)"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 7, 6600, "Dealer listing", "asking"),
      C("Grand Seiko", "Snowflake", "SBGA211", 20, 4650, "Forum / dealer group (sold)"),
      C("Grand Seiko", "Snowflake", "SBGA211", 45, 4500, "eBay (sold)"),
      C("Grand Seiko", "Snowflake", "SBGA211", 12, 5400, "Dealer listing", "asking"),
    );
  }

  /* ---------- Start ---------- */
  

  $("#btn-add").addEventListener("click", () => editWatch());
  applyTheme();
  renderBrand();
  route();
  loadMedia().then(() => { if (media.size) render(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
