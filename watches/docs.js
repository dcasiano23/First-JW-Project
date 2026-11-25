/* Printable business documents: purchase agreement, bill of sale, thank-you letter, condition report.
   Each returns a complete HTML page. The page is editable before printing (tap any text). */
window.WatchDocs = (() => {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nl = (s) => esc(s).replace(/\n/g, "<br>");
  const blank = (v, w = 180) => (v ? esc(v) : `<span class="blank" style="min-width:${w}px"></span>`);
  const paras = (s) => String(s || "").split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${nl(p.trim())}</p>`).join("");
  const fill = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  const CSS = `
    @page { size: letter; margin: 0.65in; }
    * { box-sizing: border-box; }
    html { background: #e9e6df; }
    body { margin: 0; font: 11pt/1.5 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; color: #1a1d21; }
    .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 16px; background: #0b0b0c; color: #eceef1; font: 14px/1.4 system-ui, -apple-system, sans-serif; }
    .bar button { font: 600 15px system-ui, sans-serif; padding: 9px 16px; border-radius: 9px; border: 0; background: #e4e7eb; color: #0b0b0c; cursor: pointer; }
    .page { max-width: 8.5in; margin: 18px auto; background: #fff; padding: 0.65in; box-shadow: 0 2px 18px rgba(0,0,0,.12); outline: none; }
    @media (max-width: 700px) { .page { margin: 0; padding: 22px 18px; box-shadow: none; } }
    @media print { html { background: #fff; } .bar { display: none; } .page { margin: 0; padding: 0; box-shadow: none; max-width: none; } }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #1a1d21; padding-bottom: 14px; margin-bottom: 22px; }
    .head img { max-height: 96px; max-width: 200px; object-fit: contain; }
    .biz-name { font-size: 17pt; font-weight: 600; letter-spacing: .01em; }
    .biz { text-align: right; font: 9pt/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #444; }
    h1 { font-size: 20pt; font-weight: 600; margin: 0 0 4px; letter-spacing: .01em; }
    .meta { font: 9.5pt system-ui, sans-serif; color: #555; margin-bottom: 18px; }
    h2 { font: 700 8.5pt system-ui, sans-serif; text-transform: uppercase; letter-spacing: .1em; color: #4d535b; margin: 20px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
    td, th { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
    th { width: 34%; color: #555; font-weight: 500; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .party { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; font-size: 10.5pt; }
    .party .lbl { font: 700 8pt system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #4d535b; margin-bottom: 4px; }
    .total { display: flex; justify-content: space-between; font-size: 13pt; font-weight: 700; border-top: 2px solid #1a1d21; margin-top: 10px; padding-top: 8px; }
    ol { padding-left: 18px; } li { margin-bottom: 6px; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 44px; page-break-inside: avoid; }
    .sig { border-top: 1px solid #1a1d21; padding-top: 6px; font: 9pt system-ui, sans-serif; color: #444; }
    .sig b { display: block; font: 600 10.5pt Georgia, serif; color: #1a1d21; }
    .blank { display: inline-block; border-bottom: 1px solid #888; height: 1.1em; vertical-align: bottom; }
    .pass { color: #1d7a46; font-weight: 700; } .fail { color: #b3261e; font-weight: 700; } .na { color: #888; }
    .shots { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .shots img { width: 110px; height: 110px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
    .letter p { margin: 0 0 12px; font-size: 11.5pt; }
    .foot { margin-top: 30px; font: 8.5pt system-ui, sans-serif; color: #777; border-top: 1px solid #ddd; padding-top: 8px; }
    @media (max-width: 560px) { .parties, .sigs { grid-template-columns: 1fr; } .head { flex-direction: column; } .biz { text-align: left; } }
  `;

  function shell(title, body) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head>
      <body><div class="bar"><button onclick="window.print()">Print / Save as PDF</button><span>Tap any text to edit it before printing.</span></div>
      <main class="page" contenteditable="true" spellcheck="false">${body}</main></body></html>`;
  }

  function header(c, title, meta) {
    const b = c.biz;
    return `<div class="head">
        <div>${b.logo ? `<img src="${b.logo}" alt="">` : `<div class="biz-name">${esc(b.name || "Your Business Name")}</div>`}</div>
        <div class="biz">${b.logo && b.name ? `<strong>${esc(b.name)}</strong><br>` : ""}${nl(b.address || "")}${b.address ? "<br>" : ""}${[b.phone, b.email, b.website].filter(Boolean).map(esc).join("<br>")}</div>
      </div>
      <h1>${esc(title)}</h1><div class="meta">${meta}</div>`;
  }

  function watchTable(c, { price, priceLabel } = {}) {
    const w = c.w;
    const rows = [
      ["Brand", w.brand], ["Model", w.model], ["Reference", w.ref], ["Case", w.caseInfo], ["Serial number", w.serial], ["Year", w.year],
      ["Dial", c.cfg.dial], ["Bracelet / strap", c.cfg.strap], ["Condition", w.condition], ["Box & papers", w.set],
    ];
    return `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${blank(v, 160)}</td></tr>`).join("")}
      ${price != null ? `<tr><th>${esc(priceLabel || "Price")}</th><td><strong>${esc(price)}</strong></td></tr>` : ""}</table>`;
  }
  const party = (lbl, name, lines) => `<div class="party"><div class="lbl">${lbl}</div><strong>${blank(name, 200)}</strong>${lines.filter(Boolean).map((l) => `<div>${nl(l)}</div>`).join("")}</div>`;
  const sigs = (left, right) => `<div class="sigs">
      <div><br><br><div class="sig"><b>${esc(left.name || " ")}</b>${esc(left.role)} — signature &amp; date</div></div>
      <div><br><br><div class="sig"><b>${esc(right.name || " ")}</b>${esc(right.role)} — signature &amp; date</div></div></div>`;
  const watchName = (w) => [w.brand, w.model].filter(Boolean).join(" ") + (w.ref ? ` (ref. ${w.ref})` : "");

  /* ---------- You buy a watch from a seller ---------- */
  function purchaseAgreement(c) {
    const w = c.w, b = c.biz;
    const seller = w.buyFrom;
    const body = header(c, "Watch Purchase Agreement", `Date: ${esc(c.fmtDate(w.buyDate) || c.today)} &nbsp;·&nbsp; Ref no. ${esc(c.docNo)}`) + `
      <p>This Purchase Agreement is made between the seller named below (“Seller”) and <strong>${esc(b.name || "the Buyer")}</strong> (“Buyer”) for the purchase of the watch described below.</p>
      <div class="parties">
        ${party("Seller", seller, [w.sellerAddress, w.sellerPhone, w.sellerEmail, w.sellerId ? "ID: " + w.sellerId : ""])}
        ${party("Buyer", b.name, [b.address, b.phone, b.email])}
      </div>
      <h2>The watch</h2>
      ${watchTable(c, { price: c.money(w.buyPrice), priceLabel: "Purchase price" })}
      <h2>Terms</h2>
      <ol>
        <li><strong>Payment.</strong> Buyer agrees to pay Seller the purchase price of <strong>${esc(c.money(w.buyPrice))}</strong> by ${blank(w.buyPayment, 140)}. Seller acknowledges receipt of payment upon signing, unless otherwise stated.</li>
        <li><strong>Ownership.</strong> Seller states that Seller is the sole lawful owner of the watch, has full right to sell it, and that it is free of any liens, loans, claims or encumbrances.</li>
        <li><strong>Not stolen.</strong> Seller states that the watch is not stolen and, to Seller's knowledge, has never been reported lost or stolen.</li>
        <li><strong>Authenticity &amp; description.</strong> Seller states that the watch is authentic and that the description above is accurate, and has disclosed all known repairs, service history, and any replaced or non-original parts.</li>
        <li><strong>Refund if untrue.</strong> If the watch or any of its parts is found to be counterfeit, stolen, or materially different from the description, Seller will refund the full purchase price to Buyer upon return of the watch.</li>
        <li><strong>Identification.</strong> Seller has presented valid government-issued identification${w.sellerId ? ` (${esc(w.sellerId)})` : ""}.</li>
        <li><strong>Transfer.</strong> Ownership and risk of loss pass to Buyer when payment is made and the watch is delivered to Buyer.</li>
      </ol>
      ${paras(b.purchaseTerms)}
      <p>This agreement is the entire agreement between Seller and Buyer about this watch.</p>
      ${sigs({ name: seller, role: "Seller" }, { name: b.signer || b.name, role: `Buyer${b.name ? ", for " + b.name : ""}` })}`;
    return shell(`Purchase Agreement — ${watchName(w)}`, body);
  }

  /* ---------- You sell a watch to a client ---------- */
  function billOfSale(c) {
    const w = c.w, b = c.biz;
    const body = header(c, "Bill of Sale", `Invoice no. ${esc(c.docNo)} &nbsp;·&nbsp; Date of sale: ${esc(c.fmtDate(w.sellDate) || c.today)}`) + `
      <div class="parties">
        ${party("Seller", b.name, [b.address, b.phone, b.email])}
        ${party("Buyer", w.soldTo, [w.buyerAddress, w.buyerPhone, w.buyerEmail])}
      </div>
      <h2>Item sold</h2>
      ${watchTable(c)}
      <div class="total"><span>Total sale price</span><span>${esc(c.money(w.sellPrice))}</span></div>
      <p class="meta" style="margin-top:6px">Paid by: ${blank(w.sellPayment, 140)}</p>
      ${c.check ? `<h2>Inspection before delivery</h2><p>The watch was inspected and tested before it left the Seller's possession. Pre-shipment check completed ${esc(c.check.when)}${c.check.videos ? `, with ${c.check.videos} video recording${c.check.videos > 1 ? "s" : ""} of the watch functioning` : ""}${c.check.tracking ? `. Shipped via ${esc(c.check.carrier || "carrier")}, tracking ${esc(c.check.tracking)}` : ""}.</p>` : ""}
      <h2>Terms</h2>
      <p>Seller transfers ownership of the watch described above to Buyer for the price stated. Seller states that it has good title to the watch, the right to sell it, and that the watch is authentic and as described.</p>
      ${paras(b.terms)}
      ${sigs({ name: b.signer || b.name, role: `Seller${b.name ? ", for " + b.name : ""}` }, { name: w.soldTo, role: "Buyer" })}
      <div class="foot">${esc(b.name || "")}${b.taxId ? " · " + esc(b.taxId) : ""}</div>`;
    return shell(`Bill of Sale ${c.docNo} — ${watchName(w)}`, body);
  }

  /* ---------- Thank-you letter after a client buys ---------- */
  const DEFAULT_THANKS = `Thank you for your purchase of the {watch}. It's been a pleasure helping you find it, and I hope it brings you years of enjoyment.

Before it left our hands, your watch was inspected, tested and recorded to make sure everything was working exactly as it should. If anything ever comes up, or you'd like help with sizing, service or future purchases, please reach out directly — I'm always happy to help.

Thank you again for your trust and your business.`;
  function thankYou(c) {
    const w = c.w, b = c.biz;
    const first = (w.soldTo || "").trim().split(/\s+/)[0] || "";
    const vars = { client: esc(first || "there"), fullname: esc(w.soldTo || ""), watch: esc(watchName(w)), business: esc(b.name || "") };
    const msg = fill(b.thankYou || DEFAULT_THANKS, vars);
    const body = `<div class="head">
        <div>${b.logo ? `<img src="${b.logo}" alt="">` : `<div class="biz-name">${esc(b.name || "Your Business Name")}</div>`}</div>
        <div class="biz">${b.logo && b.name ? `<strong>${esc(b.name)}</strong><br>` : ""}${[b.phone, b.email, b.website].filter(Boolean).map(esc).join("<br>")}</div>
      </div>
      <div class="letter">
        <p>${esc(c.today)}</p>
        ${w.soldTo ? `<p>${esc(w.soldTo)}${w.buyerAddress ? "<br>" + nl(w.buyerAddress) : ""}</p>` : ""}
        <p>Dear ${vars.client},</p>
        ${paras(msg)}
        <p style="margin-top:28px">Warm regards,</p>
        <p><br><strong>${esc(b.signer || "")}</strong><br>${esc(b.name || "")}</p>
      </div>`;
    return shell(`Thank you — ${w.soldTo || watchName(w)}`, body);
  }

  /* ---------- Pre-shipment condition report ---------- */
  function conditionReport(c) {
    const w = c.w, k = c.check;
    const mark = (v) => (v === "pass" ? `<span class="pass">✓ Pass</span>` : v === "fail" ? `<span class="fail">✗ Fail</span>` : v === "na" ? `<span class="na">N/A</span>` : `<span class="na">Not checked</span>`);
    const body = header(c, "Pre-Shipment Condition Report", `${esc(watchName(w))} &nbsp;·&nbsp; Serial ${blank(w.serial, 100)} &nbsp;·&nbsp; ${k.locked ? `Signed off ${esc(k.when)}` : "DRAFT — not signed off"}`) + `
      <h2>The watch</h2>${watchTable(c)}
      ${k.groups.map((g) => `<h2>${esc(g.title)}</h2><table>${g.items.map((it) => `<tr><th>${esc(it.label)}</th><td>${mark(it.value)}</td></tr>`).join("")}</table>`).join("")}
      <h2>Timing</h2>
      <table>
        <tr><th>Rate</th><td>${blank(k.rate ? k.rate + " s/day" : "", 100)}</td></tr>
        <tr><th>Amplitude</th><td>${blank(k.amplitude ? k.amplitude + "°" : "", 100)}</td></tr>
        <tr><th>Beat error</th><td>${blank(k.beatError ? k.beatError + " ms" : "", 100)}</td></tr>
      </table>
      <h2>Shipping</h2>
      <table>
        <tr><th>Carrier</th><td>${blank(k.carrier, 140)}</td></tr>
        <tr><th>Tracking number</th><td>${blank(k.tracking, 180)}</td></tr>
        <tr><th>Insured for</th><td>${blank(k.insured, 100)}</td></tr>
        <tr><th>Recipient</th><td>${blank(w.soldTo, 160)}</td></tr>
      </table>
      <h2>Recordings on file</h2>
      <p>${k.media.length ? k.media.map((m) => `${m.kind === "video" ? "Video" : "Photo"} recorded ${esc(m.when)}${m.size ? ` (${esc(m.size)})` : ""}`).join("<br>") : "None attached."}</p>
      ${k.shots.length ? `<div class="shots">${k.shots.map((s) => `<img src="${s}" alt="">`).join("")}</div>` : ""}
      ${k.notes ? `<h2>Notes</h2><p>${nl(k.notes)}</p>` : ""}
      ${sigs({ name: k.by || c.biz.signer, role: "Inspected by" }, { name: "", role: "Witness (optional)" })}
      <div class="foot">Report generated ${esc(c.today)}. Original video files are kept on file by ${esc(c.biz.name || "the seller")}.</div>`;
    return shell(`Condition Report — ${watchName(w)}`, body);
  }

  return { purchaseAgreement, billOfSale, thankYou, conditionReport, DEFAULT_THANKS };
})();
