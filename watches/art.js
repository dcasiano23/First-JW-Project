/* Draws a watch as SVG from a look/spec: case, bezel, dial, hands, bracelet or strap.
   It is an illustration of the configuration (dial colour, bezel, bracelet/strap, metal), not a photo. */
window.WatchArt = (() => {
  "use strict";
  const C = window.WatchCatalog;
  let uid = 0;

  const METAL = {
    steel: { hi: "#ffffff", a: "#e8ebee", b: "#b7bec6", c: "#848c95", edge: "#5a626b" },
    whitegold: { hi: "#ffffff", a: "#eceef0", b: "#c3c8cd", c: "#8e959c", edge: "#626a71" },
    titanium: { hi: "#f0f1f2", a: "#c8ccd0", b: "#9ba1a7", c: "#6d7379", edge: "#4b5157" },
    yellowgold: { hi: "#fff7dc", a: "#f2d58c", b: "#d4a94f", c: "#a27b2d", edge: "#6e521b" },
    rosegold: { hi: "#ffeee5", a: "#f1c4ad", b: "#d5937b", c: "#a5644f", edge: "#6e4032" },
    black: { hi: "#6a6e74", a: "#3c3f44", b: "#27292d", c: "#18191c", edge: "#0a0b0c" },
    bronze: { hi: "#f6d9b2", a: "#c99560", b: "#9d6b3b", c: "#744b28", edge: "#4c3018" },
  };
  METAL.twotone = METAL.steel;

  /* ---------- colour helpers ---------- */
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
  const shade = (h, amt) => (amt < 0 ? mix(h, "#000000", -amt) : mix(h, "#ffffff", amt));
  const lum = (h) => { const [r, g, b] = hex(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const f = (n) => Math.round(n * 100) / 100;
  const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))]; };

  function render(spec, { title = "", crop = true } = {}) {
    const id = "w" + ++uid;
    const s = { ...spec };
    const M = METAL[s.metal] || METAL.steel;
    const accent = s.metal === "twotone" ? METAL.yellowgold : M;
    const dial = C.DIALS[s.dial] || C.DIALS.black;
    const strap = C.STRAPS[s.strap] || C.STRAPS.bracelet;
    const bez = C.BEZELS[s.bezel] || C.BEZELS.smooth;
    const W = 240, H = 340, cx = 120, cy = 170;
    const R = 44 + (s.size || 40) * 0.62;
    const square = s.shape === "square";
    const S = R * 0.86;
    const strapW = square ? S * 1.62 : R * 1.18;
    const endW = strapW * 0.86;
    const lugTop = cy - (square ? S + 12 : R + 9);
    const lugH = (cy - lugTop) * 2;

    let defs = "", out = "";

    /* ---------- gradients ---------- */
    const grad = (gid, stops, x2 = 1, y2 = 0) =>
      `<linearGradient id="${gid}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
    defs += grad(`${id}brushed`, [[0, M.c], [0.5, M.a], [1, M.c]]);
    defs += grad(`${id}polished`, [[0, M.b], [0.3, M.hi], [0.55, M.a], [1, M.b]]);
    defs += grad(`${id}accent`, [[0, accent.c], [0.35, accent.hi], [0.6, accent.a], [1, accent.b]]);
    defs += grad(`${id}lug`, [[0, M.c], [0.2, M.a], [0.5, M.b], [0.8, M.a], [1, M.c]]);
    defs += `<radialGradient id="${id}case" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="${M.hi}"/><stop offset="0.55" stop-color="${M.a}"/><stop offset="1" stop-color="${M.c}"/></radialGradient>`;
    defs += grad(`${id}bezelmetal`, [[0, accent.hi], [0.45, accent.a], [0.7, accent.b], [1, accent.c]], 1, 1);
    const tex = s.dialTexture || dial.texture || "sunburst";
    const hiC = tex === "matte" ? mix(dial.fill, dial.hi, 0.35) : dial.hi;
    defs += `<radialGradient id="${id}dial" cx="0.36" cy="0.3" r="0.85"><stop offset="0" stop-color="${hiC}"/><stop offset="0.55" stop-color="${dial.fill}"/><stop offset="1" stop-color="${shade(dial.fill, -0.28)}"/></radialGradient>`;
    defs += grad(`${id}glass`, [[0, "#ffffff", 0.22], [0.42, "#ffffff", 0.04], [0.5, "#ffffff", 0], [1, "#ffffff", 0]], 0.7, 1);
    defs += `<filter id="${id}shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity="0.3"/></filter>`;
    defs += `<filter id="${id}noise"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.6  0 0 0 0 0.68  2.2 0 0 0 -0.95"/></filter>`;

    /* ---------- bracelet / strap ---------- */
    const yTopEnd = -4, yTopCase = cy - (square ? S : R) * 0.55;
    const yBotCase = cy + (square ? S : R) * 0.55, yBotEnd = H + 4;
    const width = (y, y0, y1, w0, w1) => w0 + (w1 - w0) * ((y - y0) / (y1 - y0));
    function seg(y0, y1, w0, w1, bottom) {
      const X = (fr, y) => f(cx - width(y, y0, y1, w0, w1) / 2 + fr * width(y, y0, y1, w0, w1));
      const poly = (f0, f1, ya = y0, yb = y1) => `${X(f0, ya)},${f(ya)} ${X(f1, ya)},${f(ya)} ${X(f1, yb)},${f(yb)} ${X(f0, yb)},${f(yb)}`;
      let g = "";
      const kind = strap.kind;
      if (kind === "bracelet") {
        const rows = {
          oyster: [[0, 0.34, "b", 15], [0.34, 0.66, "p", 15], [0.66, 1, "b", 15]],
          rivet: [[0, 0.33, "b", 14], [0.33, 0.67, "b", 14], [0.67, 1, "b", 14]],
          jubilee: [[0, 0.28, "b", 15], [0.28, 0.43, "p", 7.5, 0], [0.43, 0.57, "p", 7.5, 3.75], [0.57, 0.72, "p", 7.5, 0], [0.72, 1, "b", 15]],
          president: [[0, 0.33, "p", 12], [0.33, 0.67, "p", 12], [0.67, 1, "p", 12]],
          santos: [[0, 1, "p", 19]],
          bracelet: [[0, 0.24, "b", 13], [0.24, 0.32, "p", 13], [0.32, 0.68, "b", 13], [0.68, 0.76, "p", 13], [0.76, 1, "b", 13]],
        }[s.strap] || [[0, 0.3, "b", 13], [0.3, 0.7, "p", 13], [0.7, 1, "b", 13]];
        rows.forEach(([f0, f1, finish, linkH, off = 0], ri) => {
          const centre = f0 > 0.2 && f1 < 0.8;
          const fill = centre && s.metal === "twotone" ? `url(#${id}accent)` : finish === "p" ? `url(#${id}polished)` : `url(#${id}brushed)`;
          g += `<polygon points="${poly(f0, f1)}" fill="${fill}" stroke="${M.edge}" stroke-opacity="0.35" stroke-width="0.6"/>`;
          const start = bottom ? y0 + off : y1 - off;
          for (let k = 1; ; k++) {
            const y = bottom ? start + k * linkH : start - k * linkH;
            if (bottom ? y > y1 : y < y0) break;
            g += `<line x1="${X(f0, y)}" y1="${f(y)}" x2="${X(f1, y)}" y2="${f(y)}" stroke="${M.edge}" stroke-opacity="0.55" stroke-width="0.9"/>`;
            if (s.strap === "rivet" && (ri === 0 || ri === 2)) g += `<circle cx="${f((X(f0, y) + X(f1, y)) / 2)}" cy="${f(y + (bottom ? -linkH / 2 : linkH / 2))}" r="1.5" fill="${M.hi}" stroke="${M.c}" stroke-width="0.5"/>`;
            if (s.strap === "santos") {
              const yy = f(y + (bottom ? -linkH / 2 : linkH / 2));
              [0.12, 0.88].forEach((fr) => (g += `<circle cx="${X(fr, yy)}" cy="${yy}" r="2.2" fill="${M.a}" stroke="${M.c}" stroke-width="0.7"/><line x1="${f(X(fr, yy) - 1.4)}" y1="${yy}" x2="${f(X(fr, yy) + 1.4)}" y2="${yy}" stroke="${M.c}" stroke-width="0.7"/>`));
            }
          }
        });
      } else {
        const col = strap.color || "#222";
        const sg = `${id}s${bottom ? "b" : "t"}`;
        defs += grad(sg, [[0, shade(col, -0.35)], [0.18, col], [0.5, shade(col, 0.12)], [0.82, col], [1, shade(col, -0.35)]]);
        g += `<polygon points="${poly(0, 1)}" fill="url(#${sg})"/>`;
        if (kind === "strap") {
          [0.07, 0.93].forEach((fr) => (g += `<line x1="${X(fr, y0)}" y1="${y0}" x2="${X(fr, y1)}" y2="${y1}" stroke="${shade(col, 0.35)}" stroke-width="0.9" stroke-dasharray="3 2.4" stroke-opacity="0.8"/>`));
          if (bottom) {
            [y0 + 46, y0 + 60].forEach((ky) => (g += `<polygon points="${poly(-0.02, 1.02, ky, ky + 7)}" fill="${shade(col, -0.18)}" stroke="${shade(col, -0.45)}" stroke-width="0.6"/>`));
            for (let hy = y0 + 92; hy < y1 - 6; hy += 13) g += `<ellipse cx="${cx}" cy="${hy}" rx="2.4" ry="1.7" fill="${shade(col, -0.6)}"/>`;
          }
        } else if (kind === "rubber") {
          for (let gy = y0 + 6; gy < y1; gy += 9) g += `<line x1="${X(0.22, gy)}" y1="${gy}" x2="${X(0.78, gy)}" y2="${gy}" stroke="${shade(col, -0.5)}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.7"/>`;
          if (bottom) g += `<polygon points="${poly(-0.02, 1.02, y0 + 50, y0 + 58)}" fill="${shade(col, 0.1)}"/>`;
        } else if (kind === "fabric") {
          [[0.28, 0.36], [0.64, 0.72]].forEach(([a, b]) => (g += `<polygon points="${poly(a, b)}" fill="${strap.stripe}"/>`));
          for (let gy = y0; gy < y1; gy += 3) g += `<line x1="${X(0, gy)}" y1="${gy}" x2="${X(1, gy)}" y2="${gy}" stroke="#000" stroke-opacity="0.12" stroke-width="0.8"/>`;
          if (bottom) g += `<polygon points="${poly(-0.02, 1.02, y0 + 48, y0 + 58)}" fill="${M.b}" stroke="${M.c}" stroke-width="0.6"/>`;
        }
      }
      return g;
    }
    out += seg(yTopEnd, yTopCase, endW, strapW, false);
    out += seg(yBotCase, yBotEnd, strapW, endW, true);

    /* ---------- case ---------- */
    let cs = "";
    const lugW = strapW + (square ? 10 : 16);
    const lugIn = strapW / 2 - 2, lugOut = lugW / 2;
    [-1, 1].forEach((side) => {
      const x0 = side < 0 ? cx - lugOut : cx + lugIn;
      cs += `<rect x="${f(x0)}" y="${f(lugTop)}" width="${f(lugOut - lugIn)}" height="${f(lugH)}" rx="3.5" fill="url(#${id}lug)" stroke="${M.edge}" stroke-width="0.8"/>`;
    });
    const crownX = square ? cx + S - 3 : cx + R - 4;
    if (s.guards && !square) cs += `<rect x="${f(crownX - 3)}" y="${cy - 16}" width="10" height="32" rx="5" fill="url(#${id}brushed)" stroke="${M.edge}" stroke-width="0.7"/>`;
    cs += `<rect x="${f(crownX)}" y="${cy - 10}" width="13" height="20" rx="3" fill="url(#${id}polished)" stroke="${M.edge}" stroke-width="0.8"/>`;
    for (let k = 0; k < 6; k++) cs += `<line x1="${f(crownX + 2 + k * 1.9)}" y1="${cy - 9}" x2="${f(crownX + 2 + k * 1.9)}" y2="${cy + 9}" stroke="${M.c}" stroke-width="0.6"/>`;
    if (square) cs += `<circle cx="${f(crownX + 13)}" cy="${cy}" r="4.6" fill="#2a4bb0" stroke="${M.edge}" stroke-width="0.7"/><circle cx="${f(crownX + 12)}" cy="${cy - 1.4}" r="1.4" fill="#8fa9ff" opacity="0.7"/>`;

    let dialR, dialClip;
    if (!square) {
      cs += `<circle cx="${cx}" cy="${cy}" r="${f(R)}" fill="url(#${id}case)" stroke="${M.edge}" stroke-width="1"/>`;
      const Rb = R - 2.5;
      const Ri = bez.type === "thin" ? R * 0.9 : bez.type === "smooth" || bez.type === "fluted" ? R * 0.83 : R * 0.79;
      const rm = (Rb + Ri) / 2, bw = Rb - Ri;
      const ring = (color, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${f(rm)}" fill="none" stroke="${color}" stroke-width="${f(bw)}" ${extra}/>`;
      if (bez.type === "dive" || bez.type === "tachy" || bez.type === "gmt") {
        if (bez.type === "gmt") {
          const [l1, l2] = [polar(cx, cy, rm, -90), polar(cx, cy, rm, 90)];
          cs += `<path d="M${l1} A${f(rm)},${f(rm)} 0 0 1 ${l2}" fill="none" stroke="${bez.color}" stroke-width="${f(bw)}"/>`;
          cs += `<path d="M${l2} A${f(rm)},${f(rm)} 0 0 1 ${l1}" fill="none" stroke="${bez.color2}" stroke-width="${f(bw)}"/>`;
        } else cs += ring(bez.color);
        cs += `<circle cx="${cx}" cy="${cy}" r="${f(Rb)}" fill="none" stroke="${M.b}" stroke-width="1.6"/>`;
        cs += ring("url(#" + id + "glass)", 'opacity="0.5"');
        const fs = f(bw * 0.42);
        const label = (txt, deg, size = fs) => `<text x="${cx}" y="${f(cy - rm + size * 0.36)}" transform="rotate(${deg} ${cx} ${cy})" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${bez.ink}">${txt}</text>`;
        if (bez.type === "dive") {
          for (let m = 0; m < 60; m++) {
            const deg = m * 6;
            if (m === 0) {
              const [a, b, c] = [polar(cx, cy, Rb - 1.5, -4.5), polar(cx, cy, Rb - 1.5, 4.5), polar(cx, cy, Ri + 2, 0)];
              cs += `<polygon points="${a} ${b} ${c}" fill="${bez.ink}"/><circle cx="${polar(cx, cy, rm + 0.5, 0)[0]}" cy="${polar(cx, cy, rm + 0.5, 0)[1]}" r="${f(bw * 0.13)}" fill="${bez.color}"/>`;
            } else if (m % 10 === 0) cs += label(m, deg);
            else if (m % 5 === 0) cs += `<rect x="${f(cx - 1.4)}" y="${f(cy - Rb + 2)}" width="2.8" height="${f(bw - 4)}" transform="rotate(${deg} ${cx} ${cy})" fill="${bez.ink}"/>`;
            else if (m < 15) cs += `<rect x="${f(cx - 0.45)}" y="${f(cy - Rb + 2)}" width="0.9" height="${f(bw * 0.38)}" transform="rotate(${deg} ${cx} ${cy})" fill="${bez.ink}"/>`;
          }
        } else if (bez.type === "gmt") {
          for (let h = 0; h < 24; h++) {
            const deg = h * 15;
            if (h === 0) {
              const [a, b, c] = [polar(cx, cy, Rb - 1.5, -5), polar(cx, cy, Rb - 1.5, 5), polar(cx, cy, Ri + 2, 0)];
              cs += `<polygon points="${a} ${b} ${c}" fill="${bez.ink}"/>`;
            } else if (h % 2 === 0) cs += label(h, deg, fs * 0.92);
            else cs += `<polygon points="${polar(cx, cy, rm + 2.5, deg - 1.6)} ${polar(cx, cy, rm + 2.5, deg + 1.6)} ${polar(cx, cy, rm - 2.5, deg)}" fill="${bez.ink}"/>`;
          }
        } else {
          [[500, 7.2], [400, 9], [300, 12], [200, 18], [150, 24], [120, 30], [100, 36], [90, 40], [80, 45], [70, 51.4], [60, 60]].forEach(([v, sec]) => {
            const deg = sec * 6;
            cs += label(v, deg % 360, fs * 0.82);
          });
          for (let k = 0; k < 60; k++) cs += `<rect x="${f(cx - 0.35)}" y="${f(cy - Ri - 2.4)}" width="0.7" height="2.4" transform="rotate(${k * 6} ${cx} ${cy})" fill="${bez.ink}" opacity="0.8"/>`;
        }
      } else if (bez.type === "fluted") {
        const n = 46;
        for (let k = 0; k < n; k++) {
          const a0 = (k * 360) / n, a1 = ((k + 0.5) * 360) / n, a2 = ((k + 1) * 360) / n;
          cs += `<polygon points="${polar(cx, cy, Rb, a0)} ${polar(cx, cy, Rb, a1)} ${polar(cx, cy, Ri, a1)} ${polar(cx, cy, Ri, a0)}" fill="${accent.hi}"/>`;
          cs += `<polygon points="${polar(cx, cy, Rb, a1)} ${polar(cx, cy, Rb, a2)} ${polar(cx, cy, Ri, a2)} ${polar(cx, cy, Ri, a1)}" fill="${accent.c}"/>`;
        }
        cs += ring(`url(#${id}bezelmetal)`, 'opacity="0.35"');
        cs += `<circle cx="${cx}" cy="${cy}" r="${f(Rb)}" fill="none" stroke="${accent.edge}" stroke-width="0.8"/>`;
      } else {
        cs += ring(`url(#${id}bezelmetal)`);
        cs += `<circle cx="${cx}" cy="${cy}" r="${f(Rb)}" fill="none" stroke="${accent.edge}" stroke-width="0.7"/>`;
      }
      cs += `<circle cx="${cx}" cy="${cy}" r="${f(Ri)}" fill="${shade(dial.fill, -0.35)}" stroke="${M.edge}" stroke-width="0.8"/>`;
      dialR = Ri - 2.2;
      dialClip = `<circle cx="${cx}" cy="${cy}" r="${f(dialR)}"/>`;
    } else {
      const caseS = S;
      cs += `<rect x="${f(cx - caseS)}" y="${f(cy - caseS)}" width="${f(caseS * 2)}" height="${f(caseS * 2)}" rx="${f(caseS * 0.24)}" fill="url(#${id}case)" stroke="${M.edge}" stroke-width="1"/>`;
      const bo = caseS - 4, bi = caseS * 0.8;
      cs += `<rect x="${f(cx - bo)}" y="${f(cy - bo)}" width="${f(bo * 2)}" height="${f(bo * 2)}" rx="${f(bo * 0.22)}" fill="url(#${id}bezelmetal)" stroke="${M.edge}" stroke-width="0.7"/>`;
      const sm = (bo + bi) / 2;
      [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([dx, dy]) => {
        const k = dx && dy ? 0.84 : 1;
        const x = f(cx + dx * sm * k), y = f(cy + dy * sm * k);
        cs += `<circle cx="${x}" cy="${y}" r="3.3" fill="url(#${id}polished)" stroke="${M.edge}" stroke-width="0.7"/><line x1="${f(x - 2.2)}" y1="${f(y + 1)}" x2="${f(x + 2.2)}" y2="${f(y - 1)}" stroke="${M.c}" stroke-width="0.9"/>`;
      });
      cs += `<rect x="${f(cx - bi)}" y="${f(cy - bi)}" width="${f(bi * 2)}" height="${f(bi * 2)}" rx="${f(bi * 0.14)}" fill="${shade(dial.fill, -0.3)}" stroke="${M.edge}" stroke-width="0.8"/>`;
      dialR = bi - 2;
      dialClip = `<rect x="${f(cx - dialR)}" y="${f(cy - dialR)}" width="${f(dialR * 2)}" height="${f(dialR * 2)}" rx="${f(dialR * 0.12)}"/>`;
    }

    /* ---------- dial ---------- */
    const Rd = dialR;
    defs += `<clipPath id="${id}clip">${dialClip}</clipPath>`;
    let dl = `<g clip-path="url(#${id}clip)">`;
    dl += square
      ? `<rect x="${f(cx - Rd)}" y="${f(cy - Rd)}" width="${f(Rd * 2)}" height="${f(Rd * 2)}" fill="url(#${id}dial)"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${f(Rd)}" fill="url(#${id}dial)"/>`;
    if (tex === "sunburst" || tex === "gloss") {
      [[-50, 0.09], [130, 0.05]].forEach(([a, o]) => (dl += `<polygon points="${cx},${cy} ${polar(cx, cy, Rd * 1.5, a - 22)} ${polar(cx, cy, Rd * 1.5, a + 22)}" fill="#fff" opacity="${o}"/>`));
    }
    if (tex === "snowflake") dl += `<rect x="${f(cx - Rd)}" y="${f(cy - Rd)}" width="${f(Rd * 2)}" height="${f(Rd * 2)}" filter="url(#${id}noise)" opacity="0.8"/>`;
    if (tex === "wave") {
      for (let y = cy - Rd; y < cy + Rd; y += 7) {
        let d = `M${f(cx - Rd)},${f(y)}`;
        for (let x = cx - Rd; x <= cx + Rd; x += 6) d += ` L${f(x)},${f(y + Math.sin((x - cx) / 9) * 2.4)}`;
        dl += `<path d="${d}" fill="none" stroke="${shade(dial.fill, 0.14)}" stroke-width="2.2" opacity="0.55"/>`;
      }
    }
    dl += `</g>`;

    const ink = dial.ink;
    const lume = s.dial === "black-gilt" ? "#efe4c6" : "#f4f1e4";
    const frame = s.dial === "black-gilt" ? "#d6b46c" : accent.a;
    const frameEdge = s.dial === "black-gilt" ? "#9a7a36" : accent.c;
    const chrono = !!s.chrono;
    const showDate = s.date && !chrono;

    if (!square) {
      // minute track
      for (let m = 0; m < 60; m++) {
        const big = m % 5 === 0;
        dl += `<rect x="${f(cx - (big ? 0.6 : 0.35))}" y="${f(cy - Rd * 0.985)}" width="${big ? 1.2 : 0.7}" height="${f(Rd * (big ? 0.07 : 0.05))}" transform="rotate(${m * 6} ${cx} ${cy})" fill="${ink}" opacity="0.6"/>`;
      }
      for (let h = 0; h < 12; h++) {
        const deg = h * 30;
        if (h === 3 && showDate) continue;
        if (s.indices === "rolex") {
          if (h === 0) {
            const [a, b, c] = [polar(cx, cy, Rd * 0.92, -6.5), polar(cx, cy, Rd * 0.92, 6.5), polar(cx, cy, Rd * 0.68, 0)];
            dl += `<polygon points="${a} ${b} ${c}" fill="${lume}" stroke="${frame}" stroke-width="1.3" stroke-linejoin="round"/>`;
          } else if (h % 3 === 0) {
            dl += `<rect x="${f(cx - Rd * 0.045)}" y="${f(cy - Rd * 0.92)}" width="${f(Rd * 0.09)}" height="${f(Rd * 0.22)}" rx="1" transform="rotate(${deg} ${cx} ${cy})" fill="${lume}" stroke="${frame}" stroke-width="1.2"/>`;
          } else {
            const [x, y] = polar(cx, cy, Rd * 0.83, deg);
            dl += `<circle cx="${x}" cy="${y}" r="${f(Rd * 0.068)}" fill="${lume}" stroke="${frame}" stroke-width="1.2"/>`;
          }
        } else if (s.indices === "roman") {
          const [x, y] = polar(cx, cy, Rd * 0.8, deg);
          dl += `<text x="${x}" y="${f(y + Rd * 0.06)}" text-anchor="middle" font-family="Georgia, serif" font-size="${f(Rd * 0.17)}" fill="${ink}">${["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"][h]}</text>`;
        } else {
          const r0 = chrono ? 0.76 : 0.68, len = chrono ? 0.15 : 0.22, w = Rd * 0.055;
          const bar = (dx) => `<rect x="${f(cx - w / 2 + dx)}" y="${f(cy - Rd * (r0 + len))}" width="${f(w)}" height="${f(Rd * len)}" rx="0.8" transform="rotate(${deg} ${cx} ${cy})" fill="${lume === "#f4f1e4" && lum(dial.fill) > 0.6 ? accent.b : frame}" stroke="${frameEdge}" stroke-width="0.6"/>`;
          dl += h === 0 ? bar(-w * 0.75) + bar(w * 0.75) : bar(0);
        }
      }
    } else {
      // Santos-style square dial: radial roman numerals + railroad track
      const n = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
      for (let h = 0; h < 12; h++) {
        const deg = h * 30, a = (deg * Math.PI) / 180;
        const sx = Math.sin(a), sy = -Math.cos(a), k = (Rd * 0.72) / Math.max(Math.abs(sx), Math.abs(sy));
        const x = f(cx + sx * k), y = f(cy + sy * k);
        if (h === 3 && showDate) continue;
        dl += `<text x="${x}" y="${f(y + Rd * 0.06)}" transform="rotate(${deg} ${x} ${y})" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${f(Rd * 0.2)}" fill="${ink}">${n[h]}</text>`;
      }
      [0.5, 0.42].forEach((k) => (dl += `<rect x="${f(cx - Rd * k)}" y="${f(cy - Rd * k)}" width="${f(Rd * k * 2)}" height="${f(Rd * k * 2)}" rx="${f(Rd * k * 0.12)}" fill="none" stroke="${ink}" stroke-width="0.6" opacity="0.8"/>`));
      dl += `<rect x="${f(cx - Rd * 0.46)}" y="${f(cy - Rd * 0.46)}" width="${f(Rd * 0.92)}" height="${f(Rd * 0.92)}" rx="${f(Rd * 0.055)}" fill="none" stroke="${ink}" stroke-width="${f(Rd * 0.08)}" stroke-dasharray="0.6 ${f((Rd * 0.92 * 4) / 60 - 0.6)}" opacity="0.7"/>`;
    }

    // chronograph sub-dials
    if (chrono) {
      const light = lum(dial.fill) > 0.55;
      const subFill = light ? "#1b1d21" : shade(dial.fill, -0.2);
      const subInk = light ? "#eceae3" : ink;
      [[-1, 0], [1, 0], [0, 1]].forEach(([dx, dy], i) => {
        const x = cx + dx * Rd * 0.47, y = cy + dy * Rd * 0.47, r = Rd * 0.21;
        dl += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${subFill}" stroke="${light ? M.b : M.b}" stroke-width="1.1"/>`;
        for (let t = 0; t < 12; t++) dl += `<rect x="${f(x - 0.35)}" y="${f(y - r * 0.95)}" width="0.7" height="${f(r * 0.18)}" transform="rotate(${t * 30} ${f(x)} ${f(y)})" fill="${subInk}" opacity="0.8"/>`;
        dl += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y - r * 0.8)}" stroke="${subInk}" stroke-width="1.1" stroke-linecap="round" transform="rotate(${[200, 40, 300][i]} ${f(x)} ${f(y)})"/>`;
      });
    }

    // date window
    if (showDate) {
      const day = new Date().getDate();
      const dw = Rd * 0.2, dh = Rd * 0.16, dx = square ? cx + Rd * 0.62 : cx + Rd * 0.66;
      dl += `<rect x="${f(dx - dw / 2)}" y="${f(cy - dh / 2)}" width="${f(dw)}" height="${f(dh)}" rx="1" fill="#fbfaf6" stroke="${frameEdge}" stroke-width="0.8"/>`;
      const big = s.cyclops ? 1.45 : 1;
      dl += `<text x="${f(dx)}" y="${f(cy + dh * 0.33 * big)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(dh * 0.82 * big)}" fill="#111">${day}</text>`;
      if (s.cyclops) dl += `<rect x="${f(dx - dw * 0.78)}" y="${f(cy - dh * 0.85)}" width="${f(dw * 1.56)}" height="${f(dh * 1.7)}" rx="3" fill="#fff" fill-opacity="0.1" stroke="#fff" stroke-opacity="0.45" stroke-width="0.8"/>`;
    }

    /* ---------- hands (10:10:32) ---------- */
    const blued = s.indices === "roman";
    const handFrame = blued ? "#22337f" : frame;
    const handEdge = blued ? "#141f52" : frameEdge;
    const handLume = blued ? "#22337f" : lume;
    const rot = (deg, body) => `<g transform="translate(${cx} ${cy}) rotate(${deg})">${body}</g>`;
    const Lh = Rd * (square ? 0.5 : 0.55), Lm = Rd * (square ? 0.78 : 0.86), Ls = Rd * 0.92;
    function hand(L, w, style, isHour) {
      if (style === "dauphine") {
        return `<polygon points="0,${f(-L)} ${f(w)},0 0,${f(w * 1.2)}" fill="${M.b}"/><polygon points="0,${f(-L)} ${f(-w)},0 0,${f(w * 1.2)}" fill="${M.hi}"/><polygon points="0,${f(-L)} ${f(w)},0 0,${f(w * 1.2)} ${f(-w)},0" fill="none" stroke="${M.edge}" stroke-width="0.5"/>`;
      }
      if (style === "baton") {
        return `<rect x="${f(-w / 2)}" y="${f(-L)}" width="${f(w)}" height="${f(L + 6)}" rx="1" fill="${handFrame}" stroke="${handEdge}" stroke-width="0.6"/><rect x="${f(-w / 4)}" y="${f(-L + 3)}" width="${f(w / 2)}" height="${f(L * 0.62)}" fill="${handLume}"/>`;
      }
      if (style === "mercedes" && isHour) {
        const cY = -L * 0.66, cr = Rd * 0.1;
        return `<polygon points="${f(-w / 2)},6 ${f(-w * 0.42)},${f(cY + cr)} ${f(w * 0.42)},${f(cY + cr)} ${f(w / 2)},6" fill="${handFrame}"/>
          <circle cx="0" cy="${f(cY)}" r="${f(cr)}" fill="${handLume}" stroke="${handFrame}" stroke-width="1.6"/>
          ${[0, 120, 240].map((a) => `<line x1="0" y1="${f(cY)}" x2="0" y2="${f(cY - cr)}" stroke="${handFrame}" stroke-width="1.2" transform="rotate(${a} 0 ${f(cY)})"/>`).join("")}
          <polygon points="${f(-w * 0.55)},${f(cY - cr + 1)} 0,${f(-L)} ${f(w * 0.55)},${f(cY - cr + 1)}" fill="${handLume}" stroke="${handFrame}" stroke-width="1.1"/>`;
      }
      if (style === "snowflake" && isHour) {
        const sY = -L * 0.72, sz = Rd * 0.09;
        return `<rect x="${f(-w / 2)}" y="${f(sY)}" width="${f(w)}" height="${f(-sY + 6)}" fill="${handFrame}"/>
          <rect x="${f(-sz)}" y="${f(sY - sz)}" width="${f(sz * 2)}" height="${f(sz * 2)}" transform="rotate(45 0 ${f(sY)})" fill="${handLume}" stroke="${handFrame}" stroke-width="1.4"/>
          <polygon points="${f(-w * 0.45)},${f(sY - sz * 1.2)} 0,${f(-L)} ${f(w * 0.45)},${f(sY - sz * 1.2)}" fill="${handFrame}"/>`;
      }
      // sword (default, also minute hand for mercedes/snowflake)
      return `<polygon points="0,${f(-L)} ${f(w / 2)},${f(-L * 0.78)} ${f(w * 0.32)},6 ${f(-w * 0.32)},6 ${f(-w / 2)},${f(-L * 0.78)}" fill="${handFrame}" stroke="${handEdge}" stroke-width="0.6"/>
        ${blued ? "" : `<polygon points="0,${f(-L + 4)} ${f(w * 0.26)},${f(-L * 0.76)} ${f(w * 0.14)},${f(-L * 0.12)} ${f(-w * 0.14)},${f(-L * 0.12)} ${f(-w * 0.26)},${f(-L * 0.76)}" fill="${handLume}"/>`}`;
    }
    const hs = s.hands || "baton";
    let hands = "";
    if (s.gmt) hands += rot(128, `<line x1="0" y1="4" x2="0" y2="${f(-Rd * 0.8)}" stroke="#c4202c" stroke-width="1.4"/><polygon points="${f(-Rd * 0.06)},${f(-Rd * 0.8)} 0,${f(-Rd * 0.96)} ${f(Rd * 0.06)},${f(-Rd * 0.8)}" fill="${lume}" stroke="#c4202c" stroke-width="1.4"/>`);
    hands += rot(305, hand(Lh, Rd * (hs === "dauphine" ? 0.07 : 0.085), hs, true));
    hands += rot(60, hand(Lm, Rd * (hs === "dauphine" ? 0.055 : 0.07), hs === "dauphine" || hs === "baton" ? hs : "sword", false));
    const secCol = s.secColor || (blued ? "#22337f" : chrono ? frame : frame);
    if (!square) hands += rot(192, `<line x1="0" y1="${f(Ls * 0.24)}" x2="0" y2="${f(-Ls)}" stroke="${secCol}" stroke-width="1.1" stroke-linecap="round"/>${hs === "mercedes" || hs === "snowflake" ? `<circle cx="0" cy="${f(-Ls * 0.72)}" r="${f(Rd * 0.045)}" fill="${lume}" stroke="${secCol}" stroke-width="1"/>` : ""}`);
    hands += `<circle cx="${cx}" cy="${cy}" r="3.4" fill="${handFrame}" stroke="${handEdge}" stroke-width="0.6"/><circle cx="${cx}" cy="${cy}" r="1.2" fill="${M.c}"/>`;

    // crystal reflection
    const glass = square
      ? `<rect x="${f(cx - Rd)}" y="${f(cy - Rd)}" width="${f(Rd * 2)}" height="${f(Rd * 2)}" rx="${f(Rd * 0.12)}" fill="url(#${id}glass)"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${f(Rd)}" fill="url(#${id}glass)"/>`;

    out += `<g filter="url(#${id}shadow)">${cs}</g>${dl}${hands}${glass}`;
    return `<svg viewBox="0 ${crop ? 48 : 0} ${W} ${crop ? H - 96 : H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title.replace(/"/g, "&quot;")}"><defs>${defs}</defs>${out}</svg>`;
  }

  return { render };
})();
