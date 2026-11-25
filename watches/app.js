/* Watch Ledger — inventory, sales, profit, market comps, configurations and photos.
   Records live in localStorage, photos in IndexedDB — both on this device only. Backup → Export keeps a copy. */
(() => {
  "use strict";

  const KEY = "watch-ledger.v1";
  const CAT = window.WatchCatalog;
  const ART = window.WatchArt;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- Storage ---------- */

  const blank = () => ({ watches: [], comps: [], refLooks: {}, settings: { currency: "USD" } });
  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const data = JSON.parse(raw);
      return { ...blank(), ...data, settings: { ...blank().settings, ...(data.settings || {}) } };
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
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Photos (IndexedDB) ---------- */

  const photoDB = (() => {
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
  /* watchId → [{ id, thumb, created }] kept in memory; full-size images are read on demand. */
  const thumbs = new Map();
  async function loadThumbs() {
    try {
      const all = await photoDB.all();
      thumbs.clear();
      all.sort((a, b) => (a.created || "").localeCompare(b.created || ""))
        .forEach((p) => { if (!thumbs.has(p.watchId)) thumbs.set(p.watchId, []); thumbs.get(p.watchId).push({ id: p.id, thumb: p.thumb, created: p.created }); });
    } catch { /* photos unavailable (private mode) — app still works */ }
  }
  async function shrink(file, max, quality) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }
  async function addPhoto(watchId, file) {
    const rec = { id: uid(), watchId, created: new Date().toISOString(), data: await shrink(file, 1600, 0.84), thumb: await shrink(file, 480, 0.8) };
    await photoDB.put(rec);
    if (!thumbs.has(watchId)) thumbs.set(watchId, []);
    thumbs.get(watchId).push({ id: rec.id, thumb: rec.thumb, created: rec.created });
  }
  async function removePhoto(watchId, id) {
    await photoDB.del(id);
    thumbs.set(watchId, (thumbs.get(watchId) || []).filter((p) => p.id !== id));
  }

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
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };
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

  /* ---------- Pictures ---------- */

  const artCache = new Map();
  function artURL(spec) {
    const key = JSON.stringify(spec);
    if (!artCache.has(key)) artCache.set(key, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(ART.render(spec)));
    return artCache.get(key);
  }
  const lookOf = (w) => CAT.resolve(w, db.refLooks);
  const configText = (w) => CAT.describe(lookOf(w).spec);
  /* Reference photos: one real photo per reference + configuration, saved by you, shown on every matching watch. */
  const refKey = (ref, spec) => `ref:${normRef(ref)}|${spec.dial}|${spec.strap}`;
  const refPhoto = (ref, spec) => (normRef(ref) ? thumbs.get(refKey(ref, spec))?.[0] : null);
  function imgFor(ref, spec, alt = "") {
    const rp = refPhoto(ref, spec);
    return rp
      ? `<img class="pic photo ref-photo" src="${rp.thumb}" alt="Reference photo ${esc(alt)}" loading="lazy">`
      : `<img class="pic art" src="${artURL(spec)}" alt="Illustration ${esc(alt)}" loading="lazy">`;
  }
  function pictureHTML(w, { photo = true, cls = "" } = {}) {
    const ph = photo && w.id && thumbs.get(w.id)?.[0];
    if (ph) return `<img class="pic photo ${cls}" src="${ph.thumb}" alt="Photo of ${esc(label(w))}" loading="lazy">`;
    return imgFor(w.ref, lookOf(w).spec, `of ${label(w)}: ${configText(w)}`);
  }

  /* Links that open real photos of the exact reference (and configuration, when one reference has several). */
  const BRAND_SITES = { rolex: "rolex.com", omega: "omegawatches.com", tudor: "tudorwatch.com", cartier: "cartier.com", "grand seiko": "grand-seiko.com", seiko: "seikowatches.com", "audemars piguet": "audemars-piguet.com", "patek philippe": "patek.com", breitling: "breitling.com", "tag heuer": "tagheuer.com", iwc: "iwc.com", panerai: "panerai.com", "jaeger-lecoultre": "jaeger-lecoultre.com", longines: "longines.com", tissot: "tissotwatches.com", hublot: "hublot.com", "vacheron constantin": "vacheron-constantin.com", zenith: "zenith-watches.com" };
  function photoQuery(brand, ref, spec) {
    const entry = CAT.find(ref);
    const multi = !entry || CAT.configurations(entry).length > 1;
    const cfg = multi ? ` ${CAT.DIALS[spec.dial]?.label || ""} ${(CAT.STRAPS[spec.strap]?.label || "").replace(/ \(.*\)/, "")}` : "";
    return `${brand || ""} ${ref}${cfg}`.replace(/\s+/g, " ").trim();
  }
  function photoLinks(brand, ref, spec) {
    const q = photoQuery(brand, ref, spec);
    const site = BRAND_SITES[fold(brand).trim()];
    const img = (query) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    return `<a class="btn small" target="_blank" rel="noopener" href="${img(q)}">Google Images</a>` +
      (site ? `<a class="btn small" target="_blank" rel="noopener" href="${img(`${ref} site:${site}`)}">Official ${esc(brand)} photos</a>` : "") +
      `<a class="btn small" target="_blank" rel="noopener" href="https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(ref)}">Dealer listing photos</a>`;
  }
  /* Find + save controls for one reference/configuration. */
  function refPhotoTools(brand, ref, spec, { compact = false } = {}) {
    if (!normRef(ref)) return "";
    const key = refKey(ref, spec);
    const has = !!thumbs.get(key)?.length;
    if (compact) {
      return `<div class="rp-mini" data-rp="${esc(key)}">
        <a target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(photoQuery(brand, ref, spec))}">Find photos</a>
        <label>${has ? "Replace" : "Save photo"}<input type="file" accept="image/*" hidden data-rp-file></label>
      </div>`;
    }
    return `<div class="realpics" data-rp="${esc(key)}">
      <p class="muted" style="margin:0 0 8px">Search: <strong>${esc(photoQuery(brand, ref, spec))}</strong>. Open a photo you like, save or copy it, then add it here. It becomes the picture for every ${esc(ref)} in this configuration.</p>
      <div class="links">${photoLinks(brand, ref, spec)}</div>
      <div class="row-actions" style="margin-top:8px">
        <label class="btn small primary">${has ? "Replace reference photo" : "Save reference photo"}<input type="file" accept="image/*" hidden data-rp-file></label>
        <button type="button" class="btn small" data-rp-paste>Paste copied image</button>
        ${has ? `<button type="button" class="btn small danger" data-rp-remove>Remove</button>` : ""}
      </div>
    </div>`;
  }
  async function setRefPhoto(key, blob) {
    for (const old of thumbs.get(key) || []) await removePhoto(key, old.id);
    await addPhoto(key, blob);
  }
  function bindRefPhotoTools(root, after) {
    $$("[data-rp]", root).forEach((box) => {
      const key = box.dataset.rp;
      const done = async (blob) => {
        try { await setRefPhoto(key, blob); toast("Reference photo saved"); }
        catch { toast("Couldn't save that image."); return; }
        after();
      };
      $("[data-rp-file]", box)?.addEventListener("change", (e) => e.target.files[0] && done(e.target.files[0]));
      $("[data-rp-paste]", box)?.addEventListener("click", async () => {
        try {
          for (const item of await navigator.clipboard.read()) {
            const type = item.types.find((t) => t.startsWith("image/"));
            if (type) return done(await item.getType(type));
          }
          toast("No image on the clipboard — copy an image first.");
        } catch { toast("This browser can't read the clipboard here — save the image and use Save reference photo."); }
      });
      $("[data-rp-remove]", box)?.addEventListener("click", async () => {
        if (!confirm("Remove this reference photo?")) return;
        for (const old of thumbs.get(key) || []) await removePhoto(key, old.id);
        after();
      });
    });
  }
  /* Pasting an image (Ctrl/Cmd+V) while a watch or reference is open saves it as the reference photo. */
  document.addEventListener("paste", async (e) => {
    if (!sheet.open && ui.tab !== "market") return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    const box = (sheet.open ? $("#sheet-body") : view).querySelector(".realpics[data-rp]");
    if (!file || !box || e.target.closest?.("input, textarea")) return;
    e.preventDefault();
    try { await setRefPhoto(box.dataset.rp, file); toast("Reference photo saved"); } catch { toast("Couldn't save that image."); return; }
    render();
    if (sheet.open && sheet.dataset.watch) showWatch(sheet.dataset.watch);
  });

  /* ---------- Search ---------- */

  function haystack(w) {
    return fold([w.brand, w.model, w.ref, w.serial, w.year, w.condition, w.set, w.buyFrom, w.soldVia, w.soldTo, w.notes, configText(w)].join(" ")) +
      " " + normRef(w.ref) + " " + normRef(w.serial);
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

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function openSheet(title, html, onReady) {
    $("#sheet-title").textContent = title;
    $("#sheet-body").innerHTML = html;
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
    onReady && onReady($("#sheet-body"));
  }
  const closeSheet = () => sheet.open && sheet.close();
  sheet.addEventListener("close", () => delete sheet.dataset.watch);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) closeSheet();
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

  /* Compact row (dashboard lists). */
  function rowHTML(w) {
    const p = profit(w);
    const days = isSold(w) ? daysBetween(w.buyDate, w.sellDate) : daysBetween(w.buyDate, today());
    const right = isSold(w)
      ? `<div class="big">${signed(p)}</div><div class="meta">sold ${money0(w.sellPrice)}</div>`
      : `<div class="big">${money0(costBasis(w))}</div><div class="meta">cost</div>`;
    return `<button class="item" type="button" data-id="${w.id}">
      <div class="thumb">${pictureHTML(w)}</div>
      <div class="item-main"><div class="title">${esc(label(w))}${warnDot(w)}</div>
      <div class="meta">${[w.ref, configText(w)].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="meta">${isSold(w) ? `Sold ${fmtDate(w.sellDate)}` : `Bought ${fmtDate(w.buyDate)}`}${days != null && days >= 0 ? ` · ${days} days${isSold(w) ? " held" : " in stock"}` : ""}</div></div>
      <div class="right">${right}</div>
    </button>`;
  }

  /* Picture card (inventory grid). */
  function cardHTML(w) {
    const p = profit(w);
    const days = isSold(w) ? daysBetween(w.buyDate, w.sellDate) : daysBetween(w.buyDate, today());
    return `<button class="wcard" type="button" data-id="${w.id}">
      <div class="wcard-pic">${pictureHTML(w)}<div class="wcard-tags">${statusBadge(w)}${warnDot(w)}</div>
        ${(thumbs.get(w.id) || []).length ? `<span class="photo-count" aria-label="${thumbs.get(w.id).length} photos"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${thumbs.get(w.id).length}</span>` : ""}
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
        <input type="search" id="q" placeholder="Search brand, model, reference, dial, bracelet, serial…" value="${esc(ui.q)}" autocomplete="off" aria-label="Search inventory">
      </div>
      <div class="toolbar">
        <div class="chips grow" role="group" aria-label="Filter">
          ${[["all", "All"], ["stock", "In stock"], ["sold", "Sold (past)"], ["check", "Needs check"]].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filter === k}">${t}</button>`).join("")}
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
    let list = db.watches.filter((w) =>
      ui.filter === "all" ? true : ui.filter === "sold" ? isSold(w) : ui.filter === "check" ? lookOf(w).warnings.length > 0 : !isSold(w));
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
      : `<div class="empty">${db.watches.length ? "No watches match." : "No watches yet. Tap <strong>Add watch</strong> to log your first one, or load sample data under Backup."}</div>`;
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
      ${imgFor(w.ref, lookOf(w).spec)}
      <div>
        <h3>${esc(w.ref ? "Reference " + w.ref : label(w))} — your history</h3>
        <div class="compare">
          <div><div class="muted">You paid (${paid.length}×)</div><div class="num"><strong>${money0(avg(paid))}</strong> avg</div><div class="muted num">${paid.length ? `${money0(Math.min(...paid))} – ${money0(Math.max(...paid))} · last ${money0(paid[0])}` : "no purchases"}</div></div>
          <div><div class="muted">You sold (${soldP.length}×)</div><div class="num"><strong>${money0(avg(soldP))}</strong> avg</div><div class="muted num">${soldP.length ? `avg net ${money0(avg(profits))}` : "no sales"}</div></div>
          <div><div class="muted">Market sold · 180 days (${mk.soldCount})</div><div class="num"><strong>${money0(mk.median)}</strong> median</div><div class="muted num">${mk.soldCount ? `${money0(mk.low)} – ${money0(mk.high)}` : "no sold comps"}${mk.askingCount ? ` · asking ${money0(mk.askingMedian)}` : ""}</div></div>
        </div>
      </div>
    </div>`;
  }

  /* Configuration cards: every dial × bracelet/strap a reference comes in, plus sibling references. */
  function configGridHTML(w) {
    const { entry, spec } = lookOf(w);
    if (!entry) return "";
    const cfgs = CAT.configurations(entry);
    const fam = CAT.family(entry).filter((r) => r !== entry);
    const tile = (s, ref, title, sub, current, attrs = "") =>
      `<div class="cfg ${current ? "current" : ""}" ${attrs}>${imgFor(ref, s)}<div class="cfg-t">${esc(title)}</div><div class="cfg-s">${esc(sub)}</div>${current ? `<span class="badge stock">This watch</span>` : ""}</div>`;
    let html = `<div class="section"><h3>${esc(entry.ref)} comes in ${cfgs.length === 1 ? "one configuration" : cfgs.length + " configurations"}</h3>
      <p class="note">${esc(entry.note)}</p>
      <div class="cfg-grid">${cfgs.map((c) => {
        const s = CAT.resolve({ ref: entry.ref, look: c }).spec;
        return tile(s, entry.ref, CAT.DIALS[c.dial].label + " dial", CAT.STRAPS[c.strap].label, c.dial === spec.dial && c.strap === spec.strap);
      }).join("")}</div></div>`;
    if (fam.length) {
      html += `<div class="section"><h3>Related references</h3><div class="cfg-grid">${fam.map((r) => {
        const s = CAT.resolve({ ref: r.ref }).spec;
        return tile(s, r.ref, r.ref, CAT.describe(s), false, `data-ref="${esc(r.ref)}" role="button" tabindex="0"`);
      }).join("")}</div></div>`;
    }
    return html;
  }

  async function showWatch(id) {
    const w = db.watches.find((x) => x.id === id);
    if (!w) return;
    const p = profit(w);
    const { entry, spec, warnings } = lookOf(w);
    const h = history(w, w.id);
    const mk = marketFor(w);
    const photos = thumbs.get(w.id) || [];
    const rp = refPhoto(w.ref, spec);
    sheet.dataset.watch = w.id;
    const firstView = photos.length ? `<img class="pic photo" src="${photos[0].thumb}" alt="Photo">`
      : rp ? `<img class="pic photo" src="${rp.thumb}" alt="Reference photo"><span class="hero-tag">Reference photo — not this exact watch</span>`
      : `<img class="pic art" src="${artURL(spec)}" alt="Illustration: ${esc(CAT.describe(spec))}"><span class="hero-tag">Illustration</span>`;
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

    openSheet(label(w), `
      <div class="hero">
        <div class="hero-main" id="hero-main">${firstView}</div>
        <div class="hero-strip">
          ${photos.map((ph, i) => `<button class="hero-thumb ${i === 0 ? "on" : ""}" data-photo="${ph.id}" aria-label="Photo ${i + 1}"><img src="${ph.thumb}" alt=""></button>`).join("")}
          ${rp ? `<button class="hero-thumb ${photos.length ? "" : "on"}" data-refphoto aria-label="Reference photo"><img src="${rp.thumb}" alt=""></button>` : ""}
          <button class="hero-thumb ${photos.length || rp ? "" : "on"}" data-art aria-label="Illustration"><img src="${artURL(spec)}" alt=""></button>
          <label class="hero-thumb add" aria-label="Add photos"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><input type="file" accept="image/*" multiple hidden id="w-addphoto"></label>
        </div>
      </div>

      <div class="detail-head">
        <div class="brand-line">${esc(w.brand)}</div>
        <div class="detail-title">${esc(w.model || "")}</div>
        <div class="muted">${[w.ref, w.serial && "Serial " + w.serial, w.year].filter(Boolean).map(esc).join(" · ")} ${statusBadge(w)}</div>
        <div class="config-line">${esc(CAT.describe(spec))}${entry ? "" : ` <span class="muted">· not in the built-in catalog</span>`}</div>
      </div>

      ${warnings.length ? `<div class="warnbox"><strong>Check this watch</strong>${warnings.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : ""}

      ${w.ref ? `<details class="section realpics-wrap" ${rp ? "" : "open"}><summary><h3 style="display:inline">Real photos of ${esc(w.ref)}${entry && CAT.configurations(entry).length > 1 ? " in this configuration" : ""}</h3></summary>${refPhotoTools(w.brand, w.ref, spec)}</details>` : ""}

      <div class="row-actions" style="margin:14px 0 16px">
        ${isSold(w) ? "" : `<button class="btn primary" id="w-sell">Mark sold</button>`}
        <button class="btn" id="w-edit">Edit</button>
        <button class="btn" id="w-again">Bought another</button>
        <button class="btn" id="w-comps">Market comps</button>
      </div>

      <div class="card">
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
          <dt>Condition</dt><dd>${esc(w.condition || "—")}</dd>
          <dt>Box / papers</dt><dd>${esc(w.set || "—")}</dd>
          <dt>Bought</dt><dd>${fmtDate(w.buyDate)}${w.buyFrom ? " from " + esc(w.buyFrom) : ""}</dd>
          ${isSold(w) ? `<dt>Sold</dt><dd>${fmtDate(w.sellDate)}${w.soldVia ? " via " + esc(w.soldVia) : ""}${w.soldTo ? " to " + esc(w.soldTo) : ""}</dd>
          <dt>Days held</dt><dd>${daysBetween(w.buyDate, w.sellDate) ?? "—"}</dd>` : `<dt>Days in stock</dt><dd>${daysBetween(w.buyDate, today()) ?? "—"}</dd>`}
        </dl>
        ${w.notes ? `<p style="white-space:pre-wrap">${esc(w.notes)}</p>` : ""}
      </div>

      <div class="section"><h3>Market (sold prices)</h3>${mkHTML}</div>

      ${configGridHTML(w)}

      ${pastRows ? `<div class="section"><h3>Other times you had this watch</h3>
        <div class="table-wrap"><table><thead><tr><th>Bought</th><th>Configuration</th><th>Cost</th><th>Sold</th><th>Profit</th></tr></thead><tbody>${pastRows}</tbody></table></div></div>` : ""}

      <div class="section row-actions">
        ${photos.length ? `<button class="btn small" id="w-delphoto">Remove shown photo</button>` : ""}
        <button class="btn danger small" id="w-del">Delete this watch</button>
      </div>
    `, (root) => {
      let shownPhoto = photos[0]?.id || null;
      const main = $("#hero-main", root);
      $$("[data-photo]", root).forEach((b) => b.addEventListener("click", async () => {
        $$(".hero-thumb", root).forEach((x) => x.classList.toggle("on", x === b));
        shownPhoto = b.dataset.photo;
        const t = photos.find((x) => x.id === shownPhoto);
        main.innerHTML = `<img class="pic photo" src="${t.thumb}" alt="Photo">`;
        try { const full = await photoDB.get(shownPhoto); if (full && shownPhoto === full.id) main.innerHTML = `<img class="pic photo" src="${full.data}" alt="Photo">`; } catch {}
      }));
      // load the first photo at full size
      if (shownPhoto) photoDB.get(shownPhoto).then((full) => { if (full && shownPhoto === full.id) main.innerHTML = `<img class="pic photo" src="${full.data}" alt="Photo">`; }).catch(() => {});
      $("[data-art]", root).addEventListener("click", (e) => {
        $$(".hero-thumb", root).forEach((x) => x.classList.toggle("on", x === e.currentTarget));
        shownPhoto = null;
        main.innerHTML = `<img class="pic art" src="${artURL(spec)}" alt="Illustration"><span class="hero-tag">Illustration</span>`;
      });
      $("[data-refphoto]", root)?.addEventListener("click", async (e) => {
        $$(".hero-thumb", root).forEach((x) => x.classList.toggle("on", x === e.currentTarget));
        shownPhoto = null;
        main.innerHTML = `<img class="pic photo" src="${rp.thumb}" alt="Reference photo"><span class="hero-tag">Reference photo — not this exact watch</span>`;
        try { const full = await photoDB.get(rp.id); if (full) main.innerHTML = `<img class="pic photo" src="${full.data}" alt="Reference photo"><span class="hero-tag">Reference photo — not this exact watch</span>`; } catch {}
      });
      bindRefPhotoTools(root, () => { render(); showWatch(w.id); });
      $("#w-addphoto", root).addEventListener("change", async (e) => {
        const files = [...e.target.files];
        if (!files.length) return;
        toast("Adding photos…");
        try { for (const f of files) await addPhoto(w.id, f); toast(files.length > 1 ? "Photos added" : "Photo added"); }
        catch { toast("Couldn't save photos on this device."); }
        render(); showWatch(w.id);
      });
      $("#w-delphoto", root)?.addEventListener("click", async () => {
        if (!shownPhoto) { toast("Pick a photo first"); return; }
        if (!confirm("Remove this photo?")) return;
        await removePhoto(w.id, shownPhoto);
        render(); showWatch(w.id);
      });
      $("#w-sell", root)?.addEventListener("click", () => editWatch(w, { sell: true }));
      $("#w-edit", root).addEventListener("click", () => editWatch(w));
      $("#w-again", root).addEventListener("click", () => editWatch({ brand: w.brand, model: w.model, ref: w.ref, look: { ...(w.look || {}) } }));
      $("#w-comps", root).addEventListener("click", () => goMarket(w.ref || label(w)));
      $$("[data-ref]", root).forEach((t) => t.addEventListener("click", () => goMarket(t.dataset.ref)));
      $("#w-del", root).addEventListener("click", async () => {
        if (!confirm(`Delete ${label(w)}? This cannot be undone.`)) return;
        db.watches = db.watches.filter((x) => x.id !== w.id);
        save();
        for (const ph of thumbs.get(w.id) || []) await removePhoto(w.id, ph.id).catch(() => {});
        thumbs.delete(w.id);
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

  /* ---------- Add / edit form ---------- */

  const CONDITIONS = ["New / unworn", "Excellent", "Very good", "Good", "Fair", "Needs service"];
  const SETS = ["Full set (box & papers)", "Papers only", "Box only", "Watch only"];
  const datalist = (id, values) =>
    `<datalist id="${id}">${[...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const options = (list, val) => `<option value=""></option>` + list.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("") + (val && !list.includes(val) ? `<option selected>${esc(val)}</option>` : "");
  const keyOptions = (obj, val) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(v.label)}</option>`).join("");

  function editWatch(w = {}, { sell = false } = {}) {
    const isNew = !w.id;
    const showSale = sell || isSold(w);
    let look = { ...(w.look || {}) };
    let showAll = false;
    const pending = [];
    const allRefs = [...new Set(db.watches.map((x) => x.ref).concat(db.comps.map((c) => c.ref), CAT.REFS.map((r) => r.ref)))];
    const allBrands = db.watches.map((x) => x.brand).concat(db.comps.map((c) => c.brand), CAT.REFS.map((r) => r.brand));
    const allModels = db.watches.map((x) => x.model).concat(db.comps.map((c) => c.model), CAT.REFS.map((r) => r.model));

    openSheet(isNew ? "Add watch" : sell ? "Mark sold" : "Edit watch", `
      <form class="form" id="wform" autocomplete="off">
        <fieldset>
          <legend>Watch</legend>
          <div class="grid2">
            <label>Reference<input name="ref" list="dl-ref" value="${esc(w.ref)}" placeholder="e.g. 126610LN"></label>
            <label>Brand<input name="brand" list="dl-brand" value="${esc(w.brand)}" required></label>
          </div>
          <label>Model<input name="model" list="dl-model" value="${esc(w.model)}"></label>
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
          <div class="config">
            <div class="config-preview"><img class="pic art" id="cfg-preview" alt=""><div class="config-caption" id="cfg-caption"></div></div>
            <div class="config-pickers" id="cfg-pickers"></div>
          </div>
          <div id="cfg-warn"></div>
        </fieldset>

        <fieldset>
          <legend>Photos</legend>
          <div class="photo-row" id="photo-row"></div>
          <label class="btn" style="justify-self:start;color:var(--text);font-size:15px">
            <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg> Add photos
            <input type="file" accept="image/*" multiple hidden id="photo-in">
          </label>
        </fieldset>

        <fieldset>
          <legend>Purchase</legend>
          <div class="grid2">
            <label>Date bought<input type="date" name="buyDate" value="${esc(w.buyDate || (isNew ? today() : ""))}"></label>
            <label>Price paid<input name="buyPrice" inputmode="decimal" value="${esc(w.buyPrice ?? "")}" placeholder="0"></label>
          </div>
          <div class="grid2">
            <label>Extra costs<input name="extraCosts" inputmode="decimal" value="${esc(w.extraCosts ?? "")}" placeholder="service, polish, shipping in"></label>
            <label>Bought from<input name="buyFrom" list="dl-from" value="${esc(w.buyFrom)}"></label>
          </div>
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
          <label>Buyer<input name="soldTo" value="${esc(w.soldTo)}"></label>
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
        ${datalist("dl-via", ["eBay", "Chrono24", "Instagram", "Forum", "Direct", "Dealer"].concat(db.watches.map((x) => x.soldVia)))}
      </form>
    `, (root) => {
      const f = $("#wform", root);
      const soldBox = $("#is-sold", root);
      soldBox.addEventListener("change", () => { $("#sale", root).hidden = !soldBox.checked; updateHints(); });

      /* --- configuration pickers --- */
      function drawConfig() {
        const probe = { ref: f.ref.value, look };
        const { entry, spec, warnings } = CAT.resolve(probe, db.refLooks);
        const rpp = refPhoto(f.ref.value, spec);
        $("#cfg-preview", root).src = rpp ? rpp.thumb : artURL(spec);
        $("#cfg-preview", root).className = rpp ? "pic photo" : "pic art";
        $("#cfg-preview", root).alt = "Illustration: " + CAT.describe(spec);
        $("#cfg-caption", root).textContent = CAT.describe(spec);
        const dials = entry && !showAll ? entry.options.dial : Object.keys(CAT.DIALS);
        const straps = entry && !showAll ? entry.options.strap : Object.keys(CAT.STRAPS);
        const swatch = (k) => {
          const d = CAT.DIALS[k];
          return `<button type="button" class="swatch ${spec.dial === k ? "on" : ""}" data-dial="${k}" aria-pressed="${spec.dial === k}"><span class="dot" style="background:radial-gradient(circle at 35% 30%, ${d.hi}, ${d.fill})"></span>${esc(d.label)}</button>`;
        };
        const strapCard = (k) => {
          const s = { ...spec, strap: k };
          return `<button type="button" class="strap-opt ${spec.strap === k ? "on" : ""}" data-strap="${k}" aria-pressed="${spec.strap === k}"><img class="pic art" src="${artURL(s)}" alt=""><span>${esc(CAT.STRAPS[k].label)}</span></button>`;
        };
        let html = "";
        if (entry) {
          html += `<div class="note"><strong>${esc(entry.brand)} ${esc(entry.model)}</strong> — ${esc(entry.note)}</div>`;
        } else {
          html += `<div class="note">${f.ref.value.trim() ? "This reference isn't in the built-in catalog. Pick how it looks — it'll be remembered for this reference." : "Type a reference to load its known configurations, or pick the look by hand."}</div>
            <div class="grid2">
              <label>Case<select data-k="shape">${keyOptions(CAT.SHAPES, spec.shape)}</select></label>
              <label>Metal<select data-k="metal">${keyOptions(CAT.METALS, spec.metal)}</select></label>
            </div>
            <label>Bezel<select data-k="bezel">${keyOptions(CAT.BEZELS, spec.bezel)}</select></label>`;
        }
        html += `<div class="pick-label">Dial${entry && dials.length === 1 && !showAll ? " · only one for this reference" : ""}</div><div class="swatches">${dials.map(swatch).join("")}</div>`;
        html += `<div class="pick-label">Bracelet / strap${entry && straps.length === 1 && !showAll ? " · only one for this reference" : ""}</div><div class="strap-opts">${straps.map(strapCard).join("")}</div>`;
        if (entry) html += `<button type="button" class="linkbtn" id="cfg-all">${showAll ? "Only show this reference's configurations" : "Watch doesn't match? Show all dials & straps"}</button>`;
        $("#cfg-pickers", root).innerHTML = html;
        $("#cfg-warn", root).innerHTML = warnings.length ? `<div class="warnbox"><strong>Check this watch</strong>${warnings.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : "";
        $$("[data-dial]", root).forEach((b) => b.addEventListener("click", () => { look.dial = b.dataset.dial; drawConfig(); }));
        $$("[data-strap]", root).forEach((b) => b.addEventListener("click", () => { look.strap = b.dataset.strap; drawConfig(); }));
        $$("[data-k]", root).forEach((s) => s.addEventListener("change", () => { look[s.dataset.k] = s.value; drawConfig(); }));
        $("#cfg-all", root)?.addEventListener("click", () => { showAll = !showAll; drawConfig(); });
      }

      // When a known reference is typed, fill brand/model and reset choices that don't exist for it.
      let lastRef = normRef(f.ref.value);
      f.ref.addEventListener("change", () => {
        if (normRef(f.ref.value) === lastRef) return;
        lastRef = normRef(f.ref.value);
        const entry = CAT.find(f.ref.value);
        const known = entry || db.watches.find((x) => normRef(x.ref) === normRef(f.ref.value)) || db.comps.find((c) => normRef(c.ref) === normRef(f.ref.value));
        if (known) {
          if (!f.brand.value) f.brand.value = known.brand || "";
          if (!f.model.value) f.model.value = known.model || "";
        }
        if (entry) {
          ["shape", "metal", "bezel"].forEach((k) => delete look[k]);
          if (look.dial && !entry.options.dial.includes(look.dial)) delete look.dial;
          if (look.strap && !entry.options.strap.includes(look.strap)) delete look.strap;
          showAll = false;
        }
        drawConfig();
        updateHints();
      });
      f.ref.addEventListener("input", () => { if (CAT.find(f.ref.value)) f.ref.dispatchEvent(new Event("change")); });
      ["brand", "model", "buyPrice", "extraCosts", "sellPrice", "sellFees"].forEach((n) => f[n].addEventListener("input", updateHints));

      /* --- photos --- */
      const existing = [...(thumbs.get(w.id) || [])];
      const removed = new Set();
      function drawPhotos() {
        const items = existing.filter((p) => !removed.has(p.id)).map((p) => ({ key: p.id, src: p.thumb, kind: "old" }))
          .concat(pending.map((p, i) => ({ key: "n" + i, src: p.url, kind: "new" })));
        $("#photo-row", root).innerHTML = items.length
          ? items.map((p) => `<div class="photo-tile"><img src="${p.src}" alt=""><button type="button" class="x" data-rm="${p.key}" aria-label="Remove photo">×</button></div>`).join("")
          : `<p class="muted" style="margin:0">Add photos of this exact watch — dial, caseback, clasp, papers. They're the best record of what you actually have.</p>`;
        $$("[data-rm]", root).forEach((b) => b.addEventListener("click", () => {
          const k = b.dataset.rm;
          if (k.startsWith("n")) { const p = pending.splice(+k.slice(1), 1)[0]; URL.revokeObjectURL(p.url); }
          else removed.add(k);
          drawPhotos();
        }));
      }
      $("#photo-in", root).addEventListener("change", (e) => {
        [...e.target.files].forEach((file) => pending.push({ file, url: URL.createObjectURL(file) }));
        e.target.value = "";
        drawPhotos();
      });

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
        if (mk.median && bp && !soldBox.checked) bits.push(`At this price, room to market median: ${signed(mk.median - bp)} before selling fees.`);
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
        if (!soldBox.checked) ["sellDate", "sellPrice", "sellFees", "soldVia", "soldTo"].forEach((k) => (data[k] = ""));
        // Record the configuration explicitly so the inventory says exactly what this watch is.
        const { entry, spec } = CAT.resolve({ ref: data.ref, look }, db.refLooks);
        data.look = entry ? { dial: spec.dial, strap: spec.strap, ...pickKeys(look, ["shape", "metal", "bezel"]) } : pickKeys(spec, CAT.LOOK_KEYS);
        if (!entry && data.ref) db.refLooks[normRef(data.ref)] = pickKeys(spec, ["shape", "metal", "bezel", "dial", "strap"]);
        let id = w.id;
        if (isNew) {
          id = uid();
          db.watches.push({ id, created: new Date().toISOString(), ...data });
        } else {
          Object.assign(db.watches.find((x) => x.id === w.id), data, { updated: new Date().toISOString() });
        }
        save();
        try {
          for (const pid of removed) await removePhoto(id, pid);
          if (pending.length) toast("Saving photos…");
          for (const p of pending) { await addPhoto(id, p.file); URL.revokeObjectURL(p.url); }
        } catch { toast("Watch saved, but photos couldn't be stored on this device."); }
        render();
        toast(isNew ? "Watch saved" : data.status === "sold" && !isSold(w) ? "Marked sold" : "Saved");
        showWatch(id);
      });
      if (isNew && !w.ref) f.ref.focus();
      else if (sell) f.sellPrice.focus();
    });
  }
  const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

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
    const r = normRef(q);
    if (!r) return {};
    const known = CAT.find(q) || db.comps.find((c) => normRef(c.ref) === r) || db.watches.find((w) => normRef(w.ref) === r);
    if (known) return { brand: known.brand, model: known.model, ref: known.ref };
    return { ref: q.trim() };
  }

  function soldLinks(q) {
    const enc = encodeURIComponent(q);
    return `<div class="links">
      <a class="btn small" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=13">eBay — sold listings</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(q + " sold price")}">Search "sold price"</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://www.chrono24.com/search/index.htm?query=${enc}">Chrono24 (asking prices)</a>
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
            <div class="thumb">${imgFor(c.ref, lookOf(c).spec)}</div>
            <div class="item-main"><div class="title">${esc(label(c))}</div><div class="meta">${esc(c.ref || "")}</div>
              <div class="meta">${m.soldCount} sold${m.askingCount ? ` · asking ${money0(m.askingMedian)}` : ""}${m.median && m.askingMedian ? ` · asking is ${pct((m.askingMedian - m.median) / m.median)} above sold` : ""}</div></div>
            <div class="right"><div class="big">${money0(m.median)}</div><div class="meta">median sold</div></div>
          </button>`).join("")}</div></div>`
          : `<div class="empty section">No comps logged yet. Search a reference, check the sold listings, and log the real sale prices you find.</div>`}
        <div class="section">
          <h3>Reference guide — configurations</h3>
          <p class="muted" style="margin-top:0">Built-in references and the dials and bracelets/straps each one comes in. Tap one to see every configuration.</p>
          <div class="cfg-grid wide">${guide.map((r) => {
            const fam = CAT.family(r);
            const s = CAT.resolve({ ref: r.ref }).spec;
            const n = fam.reduce((t, x) => t + CAT.configurations(x).length, 0);
            return `<div class="cfg" data-guide="${esc(r.family)}" role="button" tabindex="0">${imgFor(r.ref, s)}<div class="cfg-t">${esc(r.brand)} ${esc(r.model.replace(/ \(.*\)$/, ""))}</div><div class="cfg-s">${fam.length} ref${fam.length > 1 ? "s" : ""} · ${n} configuration${n > 1 ? "s" : ""}</div></div>`;
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
          ${imgFor(target.ref || q, lookOf(target).spec)}
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
      ${exactRef ? `<div class="section"><h3>Real photos</h3>${refPhotoTools(target.brand, target.ref || q, lookOf(target).spec)}</div>` : ""}
      <div class="section">
        <h3>Check real sold prices</h3>
        ${soldLinks(q)}
      </div>
      <div class="section">
        <div class="section-head"><h3 style="margin:0">Logged comps (${comps.length})</h3><button class="btn small" id="add-comp-2">Log a comp</button></div>
        ${comps.length ? `<div class="list">${comps.map(compHTML).join("")}</div>` : `<div class="empty">No comps logged for this yet.</div>`}
      </div>
    `;
    $("#add-comp-2").addEventListener("click", () => editComp(target));
    $("#see-cfg")?.addEventListener("click", () => showFamily(entry.family, entry.ref));
    bindRefPhotoTools(out, () => drawMarket());
    $$(".item[data-comp]", out).forEach((b) => b.addEventListener("click", () => editComp(db.comps.find((c) => c.id === b.dataset.comp))));
  }

  /* All references and configurations in one family (e.g. Black Bay 58 on bracelet / leather / fabric). */
  function showFamily(fam, highlightRef) {
    const refs = CAT.REFS.filter((r) => r.family === fam);
    const first = refs[0];
    openSheet(`${first.brand} ${first.model.replace(/ \(.*\)$/, "")}`, `
      <p class="muted" style="margin-top:0">Each card is one configuration. Use it to confirm the reference on the papers matches the watch in hand — dial, bezel and bracelet or strap.</p>
      ${refs.map((r) => `
        <div class="section ${r.ref === highlightRef ? "hl" : ""}">
          <div class="section-head" style="margin-bottom:6px"><h2 class="ref">${esc(r.ref)}</h2><button class="btn small" data-mq="${esc(r.ref)}">Market</button></div>
          <p class="muted" style="margin:0 0 8px">${esc(r.note)}</p>
          <div class="cfg-grid">${CAT.configurations(r).map((c) => {
            const s = CAT.resolve({ ref: r.ref, look: c }).spec;
            const owned = db.watches.filter((w) => !isSold(w) && normRef(w.ref) === normRef(r.ref) && lookOf(w).spec.dial === c.dial && lookOf(w).spec.strap === c.strap).length;
            return `<div class="cfg">${imgFor(r.ref, s)}<div class="cfg-t">${esc(CAT.DIALS[c.dial].label)} dial</div><div class="cfg-s">${esc(CAT.STRAPS[c.strap].label)}</div>${owned ? `<span class="badge stock">${owned} in stock</span>` : ""}${refPhotoTools(r.brand, r.ref, s, { compact: true })}</div>`;
          }).join("")}</div>
        </div>`).join("")}
    `, (root) => {
      $$("[data-mq]", root).forEach((b) => b.addEventListener("click", () => goMarket(b.dataset.mq)));
      bindRefPhotoTools(root, () => { const y = sheet.scrollTop; render(); showFamily(fam); sheet.scrollTop = y; });
      if (highlightRef) root.querySelector(".hl")?.scrollIntoView({ block: "start" });
    });
  }

  function compHTML(c) {
    return `<button class="item" type="button" data-comp="${c.id}">
      <div class="thumb">${imgFor(c.ref, lookOf(c).spec)}</div>
      <div class="item-main"><div class="title">${esc(label(c))} ${esc(c.ref || "")}${c.kind === "asking" ? `<span class="badge asking">Asking</span>` : `<span class="badge sold">Sold</span>`}</div>
      <div class="meta">${[fmtDate(c.date), c.source, c.condition, c.set].filter(Boolean).map(esc).join(" · ")}</div>
      ${c.notes ? `<div class="meta">${esc(c.notes)}</div>` : ""}</div>
      <div class="right"><div class="big">${money0(num(c.price))}</div></div>
    </button>`;
  }

  const SOURCES = ["eBay (sold)", "Chrono24 (sold)", "Forum / Reddit", "Instagram", "Auction house", "Dealer", "Private sale", "Other"];

  function editComp(c = {}) {
    const isNew = !c.id;
    openSheet(isNew ? "Log a market comp" : "Edit comp", `
      <form class="form" id="cform" autocomplete="off">
        <div class="chips" role="radiogroup" aria-label="Type">
          <button type="button" class="chip" data-kind="sold" aria-pressed="${c.kind !== "asking"}">Sold price</button>
          <button type="button" class="chip" data-kind="asking" aria-pressed="${c.kind === "asking"}">Asking price</button>
        </div>
        <div class="note" id="kind-note"></div>
        <div class="grid2">
          <label>Reference<input name="ref" list="dl-cref" value="${esc(c.ref)}" required></label>
          <label>Price<input name="price" inputmode="decimal" value="${esc(c.price ?? "")}" required></label>
        </div>
        <div class="grid2">
          <label>Brand<input name="brand" list="dl-cbrand" value="${esc(c.brand)}"></label>
          <label>Model<input name="model" list="dl-cmodel" value="${esc(c.model)}"></label>
        </div>
        <div class="grid2">
          <label>Date<input type="date" name="date" value="${esc(c.date || today())}"></label>
          <label>Source<select name="source">${options(SOURCES, c.source)}</select></label>
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
          : "<strong>Asking:</strong> a listing that hasn't sold. Kept for comparison only — it does <strong>not</strong> affect the market median.";
      };
      setKind(kind);
      $$("[data-kind]", root).forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));
      f.ref.addEventListener("change", () => {
        const known = guessFromQuery(f.ref.value);
        if (!f.brand.value && known.brand) f.brand.value = known.brand;
        if (!f.model.value && known.model) f.model.value = known.model;
      });
      $("#c-del", root)?.addEventListener("click", () => {
        if (!confirm("Delete this comp?")) return;
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

  /* ---------- Backup / settings ---------- */

  function renderSettings() {
    const bytes = new Blob([JSON.stringify(db)]).size;
    const nPhotos = [...thumbs.values()].reduce((t, a) => t + a.length, 0);
    view.innerHTML = `
      <div class="eyebrow">Backup</div><h1>Backup &amp; settings</h1>
      <div class="note" style="margin-top:8px">
        Your data is stored <strong>only on this device, in this browser</strong>. Export a backup regularly (e.g. every month-end)
        and keep it in iCloud/Google Drive. To move to another phone or computer, export here and import there.
      </div>

      <div class="section card">
        <h3>Backup</h3>
        <p class="muted" style="margin-top:0">${db.watches.length} watches · ${db.comps.length} market comps · ${nPhotos} photos · ${(bytes / 1024).toFixed(1)} KB of records</p>
        <label class="check" style="margin-bottom:10px"><input type="checkbox" id="exp-photos" checked> Include photos in the backup</label>
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
    $("#exp").addEventListener("click", async () => {
      let photos = [];
      if ($("#exp-photos").checked) { try { photos = await photoDB.all(); } catch {} }
      download(`watch-ledger-backup-${today()}.json`, JSON.stringify({ app: "watch-ledger", version: 2, exported: new Date().toISOString(), ...db, photos }), "application/json");
    });
    $("#imp").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.watches)) throw new Error("bad");
        const replace = confirm(`Backup has ${data.watches.length} watches, ${(data.comps || []).length} comps and ${(data.photos || []).length} photos.\n\nOK = replace everything on this device\nCancel = merge into existing data`);
        if (replace) {
          db = { ...blank(), watches: data.watches, comps: data.comps || [], refLooks: data.refLooks || {}, settings: { ...blank().settings, ...(data.settings || {}) } };
          try { await photoDB.clear(); } catch {}
        } else {
          const ids = new Set(db.watches.map((w) => w.id));
          const cids = new Set(db.comps.map((c) => c.id));
          db.watches.push(...data.watches.filter((w) => !ids.has(w.id)));
          db.comps.push(...(data.comps || []).filter((c) => !cids.has(c.id)));
          db.refLooks = { ...(data.refLooks || {}), ...db.refLooks };
        }
        try { for (const p of data.photos || []) await photoDB.put(p); } catch { toast("Records imported, but photos couldn't be stored."); }
        save(); await loadThumbs(); setFormats(); applyTheme(); render(); toast("Backup imported");
      } catch {
        toast("That file isn't a Watch Ledger backup.");
      }
    });
    $("#csv-all").addEventListener("click", () => download(`watches-${today()}.csv`, toCSV(db.watches), "text/csv"));
    $("#csv-stock").addEventListener("click", () => download(`inventory-${today()}.csv`, toCSV(db.watches.filter((w) => !isSold(w))), "text/csv"));
    $("#csv-comps").addEventListener("click", () => download(`market-comps-${today()}.csv`, compsCSV(), "text/csv"));
    $("#cur").addEventListener("change", (e) => { db.settings.currency = e.target.value; save(); setFormats(); toast("Currency updated"); });
    $("#theme").addEventListener("change", (e) => { db.settings.theme = e.target.value; save(); applyTheme(); });
    $("#demo").addEventListener("click", () => {
      if (db.watches.length && !confirm("Add sample data alongside your existing data?")) return;
      loadDemo(); save(); toast("Sample data loaded"); location.hash = "#inventory";
    });
    $("#wipe").addEventListener("click", async () => {
      if (!confirm("Erase ALL watches, comps and photos on this device? Export a backup first if you need one.")) return;
      if (!confirm("Are you sure? This cannot be undone.")) return;
      db = { ...blank(), settings: db.settings };
      try { await photoDB.clear(); } catch {}
      thumbs.clear();
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
    const head = ["Brand", "Model", "Reference", "Dial", "Bracelet/strap", "Serial", "Year", "Condition", "Box/Papers", "Status", "Date bought", "Price paid", "Extra costs", "Cost basis", "Bought from", "Date sold", "Sold for", "Fees & shipping", "Net profit", "Days held", "Sold via", "Buyer", "Config check", "Notes"];
    const rows = list.map((w) => {
      const { spec, warnings } = lookOf(w);
      return [
        w.brand, w.model, w.ref, CAT.DIALS[spec.dial]?.label, CAT.STRAPS[spec.strap]?.label, w.serial, w.year, w.condition, w.set, isSold(w) ? "Sold" : "In stock",
        w.buyDate, num(w.buyPrice), num(w.extraCosts), costBasis(w), w.buyFrom,
        w.sellDate, isSold(w) ? num(w.sellPrice) : "", isSold(w) ? num(w.sellFees) : "", isSold(w) ? profit(w) : "",
        isSold(w) ? daysBetween(w.buyDate, w.sellDate) ?? "" : "", w.soldVia, w.soldTo, warnings.join(" "), w.notes,
      ];
    });
    return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  }
  function compsCSV() {
    const head = ["Type", "Brand", "Model", "Reference", "Price", "Date", "Source", "Condition", "Box/Papers", "Link", "Notes"];
    const rows = db.comps.map((c) => [c.kind === "asking" ? "Asking" : "Sold", c.brand, c.model, c.ref, num(c.price), c.date, c.source, c.condition, c.set, c.link, c.notes]);
    return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  }
  function download(name, text, type) {
    const blob = new Blob([type === "text/csv" ? "﻿" + text : text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
    catch { prompt("Copy this:", text); }
  }

  /* ---------- Sample data ---------- */

  function loadDemo() {
    const d = (offset) => { const t = new Date(); t.setDate(t.getDate() - offset); return t.toISOString().slice(0, 10); };
    const W = (brand, model, ref, look, year, buyAgo, buy, extra, sellAgo, sell, fees, via, set = "Full set (box & papers)", cond = "Excellent", notes = "Sample data") => ({
      id: uid(), brand, model, ref, look, year, set, condition: cond, buyDate: d(buyAgo), buyPrice: buy, extraCosts: extra, buyFrom: "Sample seller",
      status: sellAgo == null ? "stock" : "sold", sellDate: sellAgo == null ? "" : d(sellAgo), sellPrice: sell ?? "", sellFees: fees ?? "", soldVia: via || "", soldTo: "", notes,
    });
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
      W("Rolex", "Datejust 41", "126300", { dial: "blue", strap: "jubilee" }, "2020", 15, 9100, 0, 4, 9900, 300, "Direct"),
      W("Rolex", "Datejust 41", "126334", { dial: "slate", strap: "oyster" }, "2021", 10, 11200, 0, null),
      W("Omega", "Seamaster Diver 300M", "210.30.42.20.03.001", { dial: "blue", strap: "bracelet" }, "2022", 8, 3600, 0, null),
    );
    const C = (brand, model, ref, ago, price, source, kind = "sold") => ({ id: uid(), brand, model, ref, date: d(ago), price, source, kind, condition: "Excellent", set: "Full set (box & papers)", link: "", notes: "Sample data" });
    db.comps.push(
      C("Rolex", "Submariner Date", "126610LN", 10, 13100, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 25, 12950, "Forum / Reddit"),
      C("Rolex", "Submariner Date", "126610LN", 40, 13300, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 61, 13050, "Auction house"),
      C("Rolex", "Submariner Date", "126610LN", 5, 14500, "Dealer", "asking"),
      C("Rolex", "Submariner Date", "126610LN", 9, 14900, "Dealer", "asking"),
      C("Rolex", "GMT-Master II “Pepsi”", "126710BLRO", 18, 21200, "eBay (sold)"),
      C("Rolex", "GMT-Master II “Pepsi”", "126710BLRO", 6, 23500, "Dealer", "asking"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 14, 5750, "eBay (sold)"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 30, 5600, "eBay (sold)"),
      C("Omega", "Speedmaster Moonwatch Professional", "310.30.42.50.01.001", 7, 6600, "Dealer", "asking"),
      C("Grand Seiko", "Snowflake", "SBGA211", 20, 4650, "Forum / Reddit"),
      C("Grand Seiko", "Snowflake", "SBGA211", 45, 4500, "eBay (sold)"),
      C("Grand Seiko", "Snowflake", "SBGA211", 12, 5400, "Dealer", "asking"),
    );
  }

  /* ---------- Start ---------- */

  $("#btn-add").addEventListener("click", () => editWatch());
  applyTheme();
  route();
  loadThumbs().then(() => { if (thumbs.size) render(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
