/* Watch Ledger — inventory, sales, profit and market comps.
   Everything is stored on this device (localStorage). Use Backup → Export to keep a copy. */
(() => {
  "use strict";

  const KEY = "watch-ledger.v1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- Storage ---------- */

  const blank = () => ({ watches: [], comps: [], settings: { currency: "USD" } });
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
  const daysBetween = (a, b) => {
    if (!a || !b) return null;
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  };
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const fold = (s) =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const normRef = (s) => fold(s).replace(/[^a-z0-9]/g, "");

  /* ---------- Money math ---------- */

  const costBasis = (w) => num(w.buyPrice) + num(w.extraCosts);
  const isSold = (w) => w.status === "sold";
  const netProceeds = (w) => num(w.sellPrice) - num(w.sellFees);
  const profit = (w) => (isSold(w) ? netProceeds(w) - costBasis(w) : null);
  const label = (w) => [w.brand, w.model].filter(Boolean).join(" ") || "Untitled watch";

  /* ---------- Search ---------- */

  function haystack(w) {
    return fold(
      [w.brand, w.model, w.ref, w.serial, w.year, w.condition, w.set, w.buyFrom, w.soldVia, w.soldTo, w.notes].join(" ")
    ) + " " + normRef(w.ref) + " " + normRef(w.serial);
  }
  function matches(hay, query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    return terms.every((t) => hay.includes(t) || hay.includes(normRef(t)));
  }

  /* Everything known about one reference (or model, when no ref is given). */
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
      sold,
      bought,
      count: sold.length,
      revenue,
      fees,
      cogs,
      net,
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
    $("#sheet-body").scrollTop = 0;
    sheet.scrollTop = 0;
    onReady && onReady($("#sheet-body"));
  }
  const closeSheet = () => sheet.open && sheet.close();
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
    const last12 = Array.from({ length: 12 }, (_, i) => shiftMonth(ui.month, i - 11)).map((m) => ({ m, net: monthStats(m).net, count: monthStats(m).count }));

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h1>${esc(monthName(ui.month))}</h1>
          <div class="muted">Month-end numbers, by sale date</div>
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
          <div class="value ${s.net < 0 ? "neg" : ""}">${money0(s.net)}</div>
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
        <h3>${esc(year)} by month</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Month</th><th>Sold</th><th>Revenue</th><th>Fees</th><th>Cost</th><th>Net profit</th><th>Bought for</th></tr></thead>
            <tbody>
              ${yearRows
                .map(
                  (r) => `<tr class="${r.m === ui.month ? "current" : ""}"><td><a href="#dashboard" data-goto="${r.m}">${esc(monthName(r.m, "short"))}</a></td><td>${r.count}</td><td>${money0(r.revenue)}</td><td>${money0(r.fees)}</td><td>${money0(r.cogs)}</td><td>${r.count ? signed(r.net) : "—"}</td><td>${money0(r.spent)}</td></tr>`
                )
                .join("")}
            </tbody>
            <tfoot><tr><td>Year</td><td>${yt.count}</td><td>${money0(yt.revenue)}</td><td>${money0(yt.fees)}</td><td>${money0(yt.cogs)}</td><td>${signed(yt.net)}</td><td>${money0(yt.spent)}</td></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="section">
        <h3>Sold in ${esc(monthName(ui.month))}</h3>
        ${s.sold.length ? `<div class="list">${s.sold.sort((a, b) => (b.sellDate || "").localeCompare(a.sellDate || "")).map(itemHTML).join("")}</div>` : `<div class="empty">No sales recorded this month.</div>`}
      </div>

      ${aging.length ? `
      <div class="section">
        <h3>Longest in stock</h3>
        <div class="list">${aging.map((x) => itemHTML(x.w)).join("")}</div>
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
    const cur = db.settings.currency || "USD";
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 }).format(v); }
    catch { return String(v); }
  }
  function bindChart(rows) {
    const box = $("#chart"), tip = $("#tip");
    if (!box) return;
    const show = (el) => {
      const r = rows[+el.dataset.i];
      const bb = el.getBoundingClientRect(), cb = box.getBoundingClientRect();
      tip.innerHTML = `<strong>${esc(monthName(r.m))}</strong><br>${esc(money0(r.net))} net · ${r.count} sold`;
      tip.style.left = `${bb.left - cb.left + bb.width / 2}px`;
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
    const lines = [
      `${monthName(ym)} — month-end`,
      `Watches sold: ${s.count}`,
      `Revenue: ${money(s.revenue)}`,
      `Fees & shipping: ${money(s.fees)}`,
      `Cost of watches sold: ${money(s.cogs)}`,
      `NET PROFIT: ${money(s.net)}${s.margin != null ? ` (${pct(s.margin)} margin)` : ""}`,
      `Avg profit per watch: ${money(s.avgProfit)}`,
      `Bought this month: ${s.bought.length} for ${money(s.spent)}`,
      "",
      ...s.sold.map((w) => `• ${label(w)}${w.ref ? " " + w.ref : ""} — sold ${money(w.sellPrice)}, net ${money(profit(w))}`),
    ];
    return lines.join("\n");
  }

  /* ---------- Inventory ---------- */

  function itemHTML(w) {
    const p = profit(w);
    const days = isSold(w) ? daysBetween(w.buyDate, w.sellDate) : daysBetween(w.buyDate, today());
    const meta = [w.ref, w.year, w.set].filter(Boolean).map(esc).join(" · ");
    const right = isSold(w)
      ? `<div class="big">${signed(p)}</div><div class="meta">sold ${money0(w.sellPrice)}</div>`
      : `<div class="big">${money0(costBasis(w))}</div><div class="meta">cost</div>`;
    return `<button class="item" type="button" data-id="${w.id}">
      <div><div class="title">${esc(label(w))}<span class="badge ${isSold(w) ? "" : "stock"}">${isSold(w) ? "Sold" : "In stock"}</span></div>
      <div class="meta">${meta || "&nbsp;"}</div>
      <div class="meta">${isSold(w) ? `Sold ${fmtDate(w.sellDate)}` : `Bought ${fmtDate(w.buyDate)}`}${days != null && days >= 0 ? ` · ${days} days${isSold(w) ? " held" : " in stock"}` : ""}</div></div>
      <div class="right">${right}</div>
    </button>`;
  }
  function bindItems(root) {
    $$(".item[data-id]", root).forEach((b) => b.addEventListener("click", () => showWatch(b.dataset.id)));
  }

  function renderInventory() {
    view.innerHTML = `
      <div class="section-head">
        <div><h1>Inventory</h1><div class="muted" id="inv-count"></div></div>
      </div>
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="q" placeholder="Search brand, model, reference, serial, seller…" value="${esc(ui.q)}" autocomplete="off" aria-label="Search inventory">
      </div>
      <div class="toolbar">
        <div class="chips grow" role="group" aria-label="Filter">
          ${[["all", "All"], ["stock", "In stock"], ["sold", "Sold (past)"]].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filter === k}">${t}</button>`).join("")}
        </div>
        <select id="sort" aria-label="Sort">
          ${[["recent", "Most recent"], ["brand", "Brand A–Z"], ["profit", "Highest profit"], ["cost", "Highest cost"], ["age", "Longest in stock"]].map(([k, t]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <div id="refbox"></div>
      <div class="list" id="inv-list"></div>
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
    let list = db.watches.filter((w) => (ui.filter === "all" ? true : ui.filter === "sold" ? isSold(w) : !isSold(w)));
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

    // When a search narrows to one reference, show the "what did I pay before" box.
    const box = $("#refbox");
    const refs = [...new Set(list.map((w) => normRef(w.ref)).filter(Boolean))];
    if (ui.q.trim() && list.length && refs.length === 1) {
      box.innerHTML = refSummaryHTML(list[0]);
    } else box.innerHTML = "";

    $("#inv-list").innerHTML = list.length
      ? list.map(itemHTML).join("")
      : `<div class="empty">${db.watches.length ? "No watches match that search." : "No watches yet. Tap <strong>Add watch</strong> to log your first one, or load sample data under Backup."}</div>`;
    bindItems($("#inv-list"));
  }

  function refSummaryHTML(w, excludeId) {
    const h = history(w, excludeId);
    const mk = marketFor(w);
    const paid = h.paid.map((x) => num(x.buyPrice));
    const soldP = h.sold.map((x) => num(x.sellPrice));
    const profits = h.sold.map(profit);
    if (!h.mine.length && !mk.soldCount && !mk.askingCount) return "";
    return `<div class="card section" style="margin-top:0;margin-bottom:12px">
      <h3>${esc(w.ref ? "Reference " + w.ref : label(w))} — your history</h3>
      <div class="compare">
        <div><div class="muted">You paid (${paid.length}×)</div><div class="num"><strong>${money0(avg(paid))}</strong> avg</div><div class="muted num">${paid.length ? `${money0(Math.min(...paid))} – ${money0(Math.max(...paid))} · last ${money0(paid[0])} on ${fmtDate(h.paid[0].buyDate)}` : "no purchases"}</div></div>
        <div><div class="muted">You sold (${soldP.length}×)</div><div class="num"><strong>${money0(avg(soldP))}</strong> avg</div><div class="muted num">${soldP.length ? `avg net ${money0(avg(profits))} · last ${money0(soldP[0])} on ${fmtDate(h.sold[0].sellDate)}` : "no sales"}</div></div>
        <div><div class="muted">Market sold, 180 days (${mk.soldCount})</div><div class="num"><strong>${money0(mk.median)}</strong> median</div><div class="muted num">${mk.soldCount ? `${money0(mk.low)} – ${money0(mk.high)}` : "no sold comps logged"}${mk.askingCount ? ` · asking ${money0(mk.askingMedian)}` : ""}</div></div>
      </div>
    </div>`;
  }

  function showWatch(id) {
    const w = db.watches.find((x) => x.id === id);
    if (!w) return;
    const p = profit(w);
    const h = history(w, w.id);
    const mk = marketFor(w);
    const pastRows = h.mine
      .sort((a, b) => (b.buyDate || "").localeCompare(a.buyDate || ""))
      .map((x) => `<tr><td><a href="#" data-open="${x.id}">${fmtDate(x.buyDate)}</a></td><td>${money0(costBasis(x))}</td><td>${isSold(x) ? money0(x.sellPrice) : "in stock"}</td><td>${isSold(x) ? signed(profit(x)) : "—"}</td></tr>`)
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
      <div class="muted" style="margin-top:-6px;margin-bottom:12px">${[w.ref, w.serial && "Serial " + w.serial, w.year].filter(Boolean).map(esc).join(" · ")}
        <span class="badge ${isSold(w) ? "" : "stock"}">${isSold(w) ? "Sold" : "In stock"}</span></div>

      <div class="row-actions" style="margin-bottom:16px">
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
          <dt>Condition</dt><dd>${esc(w.condition || "—")}</dd>
          <dt>Box / papers</dt><dd>${esc(w.set || "—")}</dd>
          <dt>Bought</dt><dd>${fmtDate(w.buyDate)}${w.buyFrom ? " from " + esc(w.buyFrom) : ""}</dd>
          ${isSold(w) ? `<dt>Sold</dt><dd>${fmtDate(w.sellDate)}${w.soldVia ? " via " + esc(w.soldVia) : ""}${w.soldTo ? " to " + esc(w.soldTo) : ""}</dd>
          <dt>Days held</dt><dd>${daysBetween(w.buyDate, w.sellDate) ?? "—"}</dd>` : `<dt>Days in stock</dt><dd>${daysBetween(w.buyDate, today()) ?? "—"}</dd>`}
        </dl>
        ${w.notes ? `<p style="white-space:pre-wrap">${esc(w.notes)}</p>` : ""}
      </div>

      <div class="section"><h3>Market (sold prices)</h3>${mkHTML}</div>

      ${pastRows ? `<div class="section"><h3>Other times you had this watch</h3>
        <div class="table-wrap"><table><thead><tr><th>Bought</th><th>Cost</th><th>Sold</th><th>Profit</th></tr></thead><tbody>${pastRows}</tbody></table></div></div>` : ""}

      <div class="section"><button class="btn danger small" id="w-del">Delete this watch</button></div>
    `, (root) => {
      $("#w-sell", root)?.addEventListener("click", () => editWatch(w, { sell: true }));
      $("#w-edit", root).addEventListener("click", () => editWatch(w));
      $("#w-again", root).addEventListener("click", () => {
        const copy = { brand: w.brand, model: w.model, ref: w.ref, year: "", condition: "", set: "" };
        editWatch(copy);
      });
      $("#w-comps", root).addEventListener("click", () => {
        ui.mq = w.ref || label(w);
        closeSheet();
        if (ui.tab === "market") render();
        else location.hash = "#market";
      });
      $("#w-del", root).addEventListener("click", () => {
        if (!confirm(`Delete ${label(w)}? This cannot be undone.`)) return;
        db.watches = db.watches.filter((x) => x.id !== w.id);
        save(); closeSheet(); render(); toast("Deleted");
      });
      $$("[data-open]", root).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showWatch(a.dataset.open); }));
    });
  }

  /* ---------- Add / edit form ---------- */

  const CONDITIONS = ["New / unworn", "Excellent", "Very good", "Good", "Fair", "Needs service"];
  const SETS = ["Full set (box & papers)", "Papers only", "Box only", "Watch only"];
  const datalist = (id, values) =>
    `<datalist id="${id}">${[...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const options = (list, val) => `<option value=""></option>` + list.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("") + (val && !list.includes(val) ? `<option selected>${esc(val)}</option>` : "");

  function editWatch(w = {}, { sell = false } = {}) {
    const isNew = !w.id;
    const showSale = sell || isSold(w);
    openSheet(isNew ? "Add watch" : sell ? "Mark sold" : "Edit watch", `
      <form class="form" id="wform" autocomplete="off">
        <fieldset>
          <legend>Watch</legend>
          <div class="grid2">
            <label>Brand<input name="brand" list="dl-brand" value="${esc(w.brand)}" required></label>
            <label>Model<input name="model" list="dl-model" value="${esc(w.model)}"></label>
          </div>
          <div class="grid3">
            <label>Reference<input name="ref" list="dl-ref" value="${esc(w.ref)}"></label>
            <label>Serial<input name="serial" value="${esc(w.serial)}"></label>
            <label>Year<input name="year" inputmode="numeric" value="${esc(w.year)}"></label>
          </div>
          <div class="grid2">
            <label>Condition<select name="condition">${options(CONDITIONS, w.condition)}</select></label>
            <label>Box / papers<select name="set">${options(SETS, w.set)}</select></label>
          </div>
          <div class="hint" id="ref-hint"></div>
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
        ${datalist("dl-brand", db.watches.map((x) => x.brand).concat(db.comps.map((c) => c.brand)))}
        ${datalist("dl-model", db.watches.map((x) => x.model).concat(db.comps.map((c) => c.model)))}
        ${datalist("dl-ref", db.watches.map((x) => x.ref).concat(db.comps.map((c) => c.ref)))}
        ${datalist("dl-from", db.watches.map((x) => x.buyFrom))}
        ${datalist("dl-via", ["eBay", "Chrono24", "Instagram", "Forum", "Direct", "Dealer"].concat(db.watches.map((x) => x.soldVia)))}
      </form>
    `, (root) => {
      const f = $("#wform", root);
      const soldBox = $("#is-sold", root);
      soldBox.addEventListener("change", () => { $("#sale", root).hidden = !soldBox.checked; updateHints(); });

      // Fill in brand/model when a known reference is typed.
      f.ref.addEventListener("change", () => {
        const r = normRef(f.ref.value);
        if (!r) return;
        const known = db.watches.find((x) => normRef(x.ref) === r) || db.comps.find((c) => normRef(c.ref) === r);
        if (known) {
          if (!f.brand.value) f.brand.value = known.brand || "";
          if (!f.model.value) f.model.value = known.model || "";
        }
        updateHints();
      });
      ["brand", "model", "ref", "buyPrice", "extraCosts", "sellPrice", "sellFees"].forEach((n) => f[n].addEventListener("input", updateHints));

      function updateHints() {
        const t = { brand: f.brand.value, model: f.model.value, ref: f.ref.value };
        const h = history(t, w.id);
        const mk = marketFor(t);
        const bits = [];
        if (h.paid.length) {
          const paid = h.paid.map((x) => num(x.buyPrice));
          bits.push(`You've bought this ${h.paid.length}× — avg <strong>${money0(avg(paid))}</strong>, last <strong>${money0(paid[0])}</strong> (${fmtDate(h.paid[0].buyDate)}).`);
        }
        if (h.sold.length) bits.push(`You sold it ${h.sold.length}× — avg ${money0(avg(h.sold.map((x) => num(x.sellPrice))))}, avg net ${money0(avg(h.sold.map(profit)))}.`);
        if (mk.soldCount) bits.push(`Market median <strong>sold</strong>: ${money0(mk.median)} (${mk.soldCount} sales, 180 days).`);
        const bp = num(f.buyPrice.value) + num(f.extraCosts.value);
        if (mk.median && bp && !soldBox.checked) {
          const room = mk.median - bp;
          bits.push(`At this price, room to market median: ${signed(room)} before selling fees.`);
        }
        $("#ref-hint", root).innerHTML = (t.ref || t.model) ? bits.join("<br>") : "";
        if (soldBox.checked && f.sellPrice.value) {
          const net = num(f.sellPrice.value) - num(f.sellFees.value) - bp;
          $("#profit-hint", root).innerHTML = `Net profit: <strong>${signed(net)}</strong>`;
        } else $("#profit-hint", root).innerHTML = "";
      }
      updateHints();

      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        ["buyPrice", "extraCosts", "sellPrice", "sellFees"].forEach((k) => (data[k] = data[k] === "" ? "" : num(data[k])));
        Object.keys(data).forEach((k) => typeof data[k] === "string" && (data[k] = data[k].trim()));
        data.ref = data.ref.toUpperCase();
        data.status = soldBox.checked ? "sold" : "stock";
        if (!soldBox.checked) ["sellDate", "sellPrice", "sellFees", "soldVia", "soldTo"].forEach((k) => (data[k] = ""));
        let id = w.id;
        if (isNew) {
          id = uid();
          db.watches.push({ id, created: new Date().toISOString(), ...data });
        } else {
          Object.assign(db.watches.find((x) => x.id === w.id), data, { updated: new Date().toISOString() });
        }
        save();
        render();
        toast(isNew ? "Watch saved" : data.status === "sold" && !isSold(w) ? "Marked sold" : "Saved");
        showWatch(id);
      });
      if (isNew && !w.brand) f.brand.focus();
      else if (sell) f.sellPrice.focus();
    });
  }

  /* ---------- Market comps ---------- */

  function renderMarket() {
    view.innerHTML = `
      <div class="section-head"><div><h1>Market</h1><div class="muted">What watches actually <strong>sell</strong> for</div></div>
        <button class="btn" id="add-comp">Log a sale comp</button></div>
      <div class="note">
        <strong>Sold ≠ asking.</strong> Only completed sales count toward the market median here. Asking prices you log are kept apart
        and shown for comparison, so you can see the gap between what dealers ask and what watches really go for.
        Your own sales of the same reference are counted as sold comps too.
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
    const known = db.comps.find((c) => normRef(c.ref) === r) || db.watches.find((w) => normRef(w.ref) === r);
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
      // Overview: every reference with sold comps, most data first.
      const groups = new Map();
      db.comps.forEach((c) => {
        const k = normRef(c.ref) || fold(c.brand + " " + c.model);
        if (!groups.has(k)) groups.set(k, c);
      });
      const rows = [...groups.values()].map((c) => ({ c, m: marketFor(c) })).sort((a, b) => b.m.soldCount - a.m.soldCount);
      out.innerHTML = rows.length
        ? `<div class="section"><h3>References you track</h3><div class="table-wrap"><table>
            <thead><tr><th>Watch</th><th>Sold</th><th>Median sold</th><th>Median asking</th><th>Gap</th></tr></thead>
            <tbody>${rows.map(({ c, m }) => `<tr><td class="wrap"><a href="#market" data-q="${esc(c.ref || label(c))}">${esc(label(c))}</a><div class="muted" style="font-size:12px">${esc(c.ref || "")}</div></td><td>${m.soldCount}</td><td>${money0(m.median)}</td><td>${m.askingCount ? money0(m.askingMedian) : "—"}</td><td>${m.median && m.askingMedian ? pct((m.askingMedian - m.median) / m.median) : "—"}</td></tr>`).join("")}</tbody>
          </table></div><p class="muted" style="font-size:13px">Last 180 days. Gap = how far asking prices sit above real sales.</p></div>`
        : `<div class="empty section">No comps logged yet. Search a reference, check the sold listings, and log the real sale prices you find.</div>`;
      $$("[data-q]", out).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); ui.mq = a.dataset.q; $("#mq").value = ui.mq; drawMarket(); }));
      return;
    }

    const target = guessFromQuery(q);
    const exactRef = db.comps.some((c) => normRef(c.ref) === normRef(q)) || db.watches.some((w) => normRef(w.ref) === normRef(q));
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
        <div class="section-head"><h2>${esc(exactRef ? (label(target) !== "Untitled watch" ? label(target) + " " : "") + (target.ref || q) : `Comps matching “${q}”`)}</h2></div>
        ${exactRef ? `<div class="stats">
            ${stat("Median sold · 90 days", m90)}
            ${stat("Median sold · 180 days", m180)}
            ${stat("Median sold · all time", mAll)}
            <div class="card stat"><div class="label">Median asking</div><div class="value">${m180.askingCount ? money0(m180.askingMedian) : "—"}</div>
              <div class="sub">${m180.askingCount ? `${m180.askingCount} listings · ${m180.median ? pct((m180.askingMedian - m180.median) / m180.median) + " above sold" : ""}` : "none logged"}</div></div>
          </div>
          ${mineHist && mineHist.paid.length ? `<div class="note" style="margin-top:10px">You've paid ${mineHist.paid.map((x) => money0(num(x.buyPrice))).slice(0, 6).join(", ")}${mineHist.paid.length > 6 ? "…" : ""} for this reference (most recent first).</div>` : ""}` : ""}
      </div>
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
    $$(".item[data-comp]", out).forEach((b) => b.addEventListener("click", () => editComp(db.comps.find((c) => c.id === b.dataset.comp))));
  }

  function compHTML(c) {
    return `<button class="item" type="button" data-comp="${c.id}">
      <div><div class="title">${esc(label(c))} ${esc(c.ref || "")}${c.kind === "asking" ? `<span class="badge asking">Asking</span>` : `<span class="badge">Sold</span>`}</div>
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
          <label>Brand<input name="brand" list="dl-cbrand" value="${esc(c.brand)}"></label>
          <label>Model<input name="model" list="dl-cmodel" value="${esc(c.model)}"></label>
        </div>
        <div class="grid2">
          <label>Reference<input name="ref" list="dl-cref" value="${esc(c.ref)}" required></label>
          <label>Price<input name="price" inputmode="decimal" value="${esc(c.price ?? "")}" required></label>
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
        ${datalist("dl-cbrand", db.watches.map((x) => x.brand).concat(db.comps.map((x) => x.brand)))}
        ${datalist("dl-cmodel", db.watches.map((x) => x.model).concat(db.comps.map((x) => x.model)))}
        ${datalist("dl-cref", db.watches.map((x) => x.ref).concat(db.comps.map((x) => x.ref)))}
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
      if (!c.brand) f.brand.focus(); else f.price.focus();
    });
  }

  /* ---------- Backup / settings ---------- */

  function renderSettings() {
    const bytes = new Blob([JSON.stringify(db)]).size;
    view.innerHTML = `
      <h1>Backup &amp; settings</h1>
      <div class="note" style="margin-top:8px">
        Your data is stored <strong>only on this device, in this browser</strong>. Export a backup regularly (e.g. every month-end)
        and keep it in iCloud/Google Drive. To move to another phone or computer, export here and import there.
      </div>

      <div class="section card">
        <h3>Backup</h3>
        <p class="muted" style="margin-top:0">${db.watches.length} watches · ${db.comps.length} market comps · ${(bytes / 1024).toFixed(1)} KB</p>
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
    $("#exp").addEventListener("click", () => {
      download(`watch-ledger-backup-${today()}.json`, JSON.stringify({ app: "watch-ledger", version: 1, exported: new Date().toISOString(), ...db }, null, 2), "application/json");
    });
    $("#imp").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.watches)) throw new Error("bad");
        const replace = confirm(`Backup has ${data.watches.length} watches and ${(data.comps || []).length} comps.\n\nOK = replace everything on this device\nCancel = merge into existing data`);
        if (replace) {
          db = { ...blank(), watches: data.watches, comps: data.comps || [], settings: { ...blank().settings, ...(data.settings || {}) } };
        } else {
          const ids = new Set(db.watches.map((w) => w.id));
          const cids = new Set(db.comps.map((c) => c.id));
          db.watches.push(...data.watches.filter((w) => !ids.has(w.id)));
          db.comps.push(...(data.comps || []).filter((c) => !cids.has(c.id)));
        }
        save(); setFormats(); applyTheme(); render(); toast("Backup imported");
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
      loadDemo(); save(); toast("Sample data loaded"); location.hash = "#dashboard";
    });
    $("#wipe").addEventListener("click", () => {
      if (!confirm("Erase ALL watches and comps on this device? Export a backup first if you need one.")) return;
      if (!confirm("Are you sure? This cannot be undone.")) return;
      db = { ...blank(), settings: db.settings };
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
    const head = ["Brand", "Model", "Reference", "Serial", "Year", "Condition", "Box/Papers", "Status", "Date bought", "Price paid", "Extra costs", "Cost basis", "Bought from", "Date sold", "Sold for", "Fees & shipping", "Net profit", "Days held", "Sold via", "Buyer", "Notes"];
    const rows = list.map((w) => [
      w.brand, w.model, w.ref, w.serial, w.year, w.condition, w.set, isSold(w) ? "Sold" : "In stock",
      w.buyDate, num(w.buyPrice), num(w.extraCosts), costBasis(w), w.buyFrom,
      w.sellDate, isSold(w) ? num(w.sellPrice) : "", isSold(w) ? num(w.sellFees) : "", isSold(w) ? profit(w) : "",
      isSold(w) ? daysBetween(w.buyDate, w.sellDate) ?? "" : "", w.soldVia, w.soldTo, w.notes,
    ]);
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
    const d = (offset) => {
      const t = new Date();
      t.setDate(t.getDate() - offset);
      return t.toISOString().slice(0, 10);
    };
    const W = (brand, model, ref, year, buyAgo, buy, extra, sellAgo, sell, fees, via, set = "Full set (box & papers)", cond = "Excellent") => ({
      id: uid(), brand, model, ref, year, set, condition: cond, buyDate: d(buyAgo), buyPrice: buy, extraCosts: extra, buyFrom: "Sample seller",
      status: sellAgo == null ? "stock" : "sold", sellDate: sellAgo == null ? "" : d(sellAgo), sellPrice: sell ?? "", sellFees: fees ?? "", soldVia: via || "", soldTo: "", notes: "Sample data",
    });
    db.watches.push(
      W("Rolex", "Submariner Date", "126610LN", "2022", 300, 11800, 0, 270, 13400, 420, "Direct"),
      W("Rolex", "Submariner Date", "126610LN", "2021", 120, 12100, 150, 95, 13250, 400, "Chrono24"),
      W("Rolex", "Submariner Date", "126610LN", "2023", 20, 12300, 0, null),
      W("Omega", "Speedmaster Professional", "310.30.42.50.01.001", "2021", 200, 5200, 0, 150, 6100, 610, "eBay"),
      W("Omega", "Speedmaster Professional", "310.30.42.50.01.001", "2022", 40, 5050, 0, 12, 5900, 590, "eBay"),
      W("Tudor", "Black Bay 58", "M79030N-0001", "2020", 150, 2900, 120, 110, 3450, 120, "Instagram", "Watch only"),
      W("Tudor", "Pelagos 39", "M25407N-0001", "2023", 70, 3900, 0, 33, 4300, 140, "Direct"),
      W("Cartier", "Santos Medium", "WSSA0029", "2022", 60, 5600, 0, 28, 6350, 210, "Chrono24"),
      W("Grand Seiko", "Snowflake", "SBGA211", "2019", 90, 4300, 250, null, null, null, "", "Full set (box & papers)", "Very good"),
      W("Rolex", "Datejust 41", "126300", "2020", 15, 9100, 0, 4, 9900, 300, "Direct"),
      W("Omega", "Seamaster 300M", "210.30.42.20.03.001", "2022", 8, 3600, 0, null),
    );
    const C = (brand, model, ref, ago, price, source, kind = "sold") => ({ id: uid(), brand, model, ref, date: d(ago), price, source, kind, condition: "Excellent", set: "Full set (box & papers)", link: "", notes: "Sample data" });
    db.comps.push(
      C("Rolex", "Submariner Date", "126610LN", 10, 13100, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 25, 12950, "Forum / Reddit"),
      C("Rolex", "Submariner Date", "126610LN", 40, 13300, "eBay (sold)"),
      C("Rolex", "Submariner Date", "126610LN", 61, 13050, "Auction house"),
      C("Rolex", "Submariner Date", "126610LN", 5, 14500, "Dealer", "asking"),
      C("Rolex", "Submariner Date", "126610LN", 9, 14900, "Chrono24 (sold)", "asking"),
      C("Omega", "Speedmaster Professional", "310.30.42.50.01.001", 14, 5750, "eBay (sold)"),
      C("Omega", "Speedmaster Professional", "310.30.42.50.01.001", 30, 5600, "eBay (sold)"),
      C("Omega", "Speedmaster Professional", "310.30.42.50.01.001", 7, 6600, "Dealer", "asking"),
      C("Grand Seiko", "Snowflake", "SBGA211", 20, 4650, "Forum / Reddit"),
      C("Grand Seiko", "Snowflake", "SBGA211", 45, 4500, "eBay (sold)"),
      C("Grand Seiko", "Snowflake", "SBGA211", 12, 5400, "Dealer", "asking"),
    );
  }

  /* ---------- Start ---------- */

  $("#btn-add").addEventListener("click", () => editWatch());
  applyTheme();
  route();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
