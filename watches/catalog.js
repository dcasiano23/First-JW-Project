/* Reference catalog: what each reference looks like and which configurations it comes in.
   The art is an illustration built from these settings, not a photo.
   To add a reference, copy an entry in REFS. Option keys must exist in DIALS / STRAPS / BEZELS. */
window.WatchCatalog = (() => {
  "use strict";

  /* ---------- Building blocks ---------- */

  const METALS = {
    steel: { label: "Steel" },
    titanium: { label: "Titanium" },
    yellowgold: { label: "Yellow gold" },
    rosegold: { label: "Rose gold" },
    whitegold: { label: "White gold" },
    twotone: { label: "Two-tone (steel & gold)" },
    black: { label: "Black (DLC / ceramic)" },
    bronze: { label: "Bronze" },
  };

  const DIALS = {
    black: { label: "Black", fill: "#16191d", hi: "#3a3f46", ink: "#f2efe6" },
    "black-gilt": { label: "Black, gilt print", fill: "#17171a", hi: "#3b3a3c", ink: "#d8b46a" },
    blue: { label: "Blue", fill: "#1d3f7c", hi: "#4a78c4", ink: "#f2efe6" },
    navy: { label: "Navy", fill: "#1a2a44", hi: "#3a5276", ink: "#e9ebee" },
    slate: { label: "Slate / grey", fill: "#4b5159", hi: "#8a929c", ink: "#f2efe6" },
    silver: { label: "Silver", fill: "#c6cacf", hi: "#f1f2f4", ink: "#1b1f24" },
    white: { label: "White", fill: "#f1f0ec", hi: "#ffffff", ink: "#1b1f24" },
    mint: { label: "Mint green", fill: "#99c6b1", hi: "#d0e9dc", ink: "#1b2b24" },
    green: { label: "Green", fill: "#1d4a34", hi: "#3f7d5c", ink: "#f2efe6" },
    champagne: { label: "Champagne", fill: "#d7c49a", hi: "#f3e8cc", ink: "#2a2216" },
    snowflake: { label: "White textured (Snowflake)", fill: "#eceef1", hi: "#ffffff", ink: "#2a2f36", texture: "snowflake" },
    brown: { label: "Brown", fill: "#4b3426", hi: "#86604a", ink: "#f2e6d6" },
    red: { label: "Red", fill: "#7c1d22", hi: "#b8424a", ink: "#f2efe6" },
  };

  const STRAPS = {
    oyster: { label: "Oyster bracelet", kind: "bracelet" },
    jubilee: { label: "Jubilee bracelet", kind: "bracelet" },
    president: { label: "President bracelet", kind: "bracelet" },
    bracelet: { label: "Metal bracelet", kind: "bracelet" },
    rivet: { label: "Rivet bracelet", kind: "bracelet" },
    santos: { label: "Santos bracelet (QuickSwitch)", kind: "bracelet" },
    "leather-black": { label: "Black leather strap", kind: "strap", color: "#1d1a18" },
    "leather-brown": { label: "Brown leather strap", kind: "strap", color: "#7a4a2a" },
    "leather-tan": { label: "Tan leather strap", kind: "strap", color: "#a8703f" },
    "rubber-black": { label: "Black rubber strap", kind: "rubber", color: "#1b1d20" },
    "rubber-blue": { label: "Blue rubber strap", kind: "rubber", color: "#1d3557" },
    "fabric-black": { label: "Black fabric strap", kind: "fabric", color: "#24262a", stripe: "#3a3d43" },
    "fabric-blue": { label: "Blue fabric strap", kind: "fabric", color: "#1f3352", stripe: "#304a72" },
    "fabric-green": { label: "Green fabric strap", kind: "fabric", color: "#2d3d2a", stripe: "#46593f" },
  };

  const BEZELS = {
    "dive-black": { label: "Black dive bezel", type: "dive", color: "#141618", ink: "#e8e6df" },
    "dive-green": { label: "Green dive bezel", type: "dive", color: "#0f4a2c", ink: "#e8e6df" },
    "dive-blue": { label: "Blue dive bezel", type: "dive", color: "#16335f", ink: "#e8e6df" },
    "dive-gilt": { label: "Black dive bezel, gilt print", type: "dive", color: "#1a1919", ink: "#d8b46a" },
    "dive-navy": { label: "Navy dive bezel", type: "dive", color: "#1c2c48", ink: "#dfe3ea" },
    "gmt-pepsi": { label: "Red / blue GMT bezel", type: "gmt", color: "#a3202b", color2: "#1c3a7a", ink: "#f0eee8" },
    "gmt-black": { label: "Black GMT bezel", type: "gmt", color: "#151719", color2: "#151719", ink: "#f0eee8" },
    "tachy-black": { label: "Black tachymeter bezel", type: "tachy", color: "#141618", ink: "#f0eee8" },
    smooth: { label: "Smooth polished bezel", type: "smooth" },
    fluted: { label: "Fluted bezel", type: "fluted" },
    thin: { label: "Thin bezel", type: "thin" },
  };

  const SHAPES = { round: { label: "Round" }, square: { label: "Square" } };

  /* ---------- Catalog ---------- */

  const SUB = { shape: "round", size: 41, metal: "steel", indices: "rolex", hands: "mercedes", date: true, cyclops: true, guards: true };
  const DJ41 = { shape: "round", size: 41, metal: "steel", indices: "batons", hands: "baton", date: true, cyclops: true, dialTexture: "sunburst" };
  const SPEEDY = { shape: "round", size: 42, metal: "steel", bezel: "tachy-black", dial: "black", indices: "batons", hands: "baton", chrono: true, dialTexture: "matte", guards: false };
  const BB58 = { shape: "round", size: 39, metal: "steel", indices: "rolex", hands: "snowflake", date: false, guards: false };
  const SMP = { shape: "round", size: 42, metal: "steel", indices: "batons", hands: "sword", date: true, dialTexture: "wave", strap: "bracelet" };

  const REFS = [
    { ref: "126610LN", brand: "Rolex", model: "Submariner Date", family: "sub", base: { ...SUB, bezel: "dive-black" },
      options: { dial: ["black"], strap: ["oyster"] }, note: "41 mm, black Cerachrom bezel, Oyster bracelet only." },
    { ref: "126610LV", brand: "Rolex", model: "Submariner Date", family: "sub", base: { ...SUB, bezel: "dive-green" },
      options: { dial: ["black"], strap: ["oyster"] }, note: "41 mm, green bezel with black dial, Oyster bracelet only." },
    { ref: "124060", brand: "Rolex", model: "Submariner (no date)", family: "sub", base: { ...SUB, bezel: "dive-black", date: false, cyclops: false },
      options: { dial: ["black"], strap: ["oyster"] }, note: "41 mm, no date window." },
    { ref: "126710BLRO", brand: "Rolex", model: "GMT-Master II “Pepsi”", family: "gmt", base: { ...SUB, bezel: "gmt-pepsi", gmt: true, guards: true },
      options: { dial: ["black"], strap: ["jubilee", "oyster"] },
      note: "Same reference on Jubilee or Oyster bracelet — check which one the papers and box label list." },
    { ref: "126500LN", brand: "Rolex", model: "Cosmograph Daytona", family: "daytona",
      base: { shape: "round", size: 40, metal: "steel", bezel: "tachy-black", indices: "batons", hands: "baton", chrono: true, date: false, guards: true },
      options: { dial: ["white", "black"], strap: ["oyster"] }, note: "White (panda) or black dial. Same reference for both — check the dial against the papers." },
    { ref: "126300", brand: "Rolex", model: "Datejust 41", family: "dj41", base: { ...DJ41, bezel: "smooth" },
      options: { dial: ["blue", "black", "slate", "silver", "white", "mint"], strap: ["oyster", "jubilee"] },
      note: "Smooth bezel. The reference doesn't tell you the dial or bracelet — confirm both against the papers." },
    { ref: "126334", brand: "Rolex", model: "Datejust 41", family: "dj41", base: { ...DJ41, bezel: "fluted" },
      options: { dial: ["blue", "black", "slate", "silver", "white", "mint"], strap: ["oyster", "jubilee"] },
      note: "Fluted white-gold bezel. Dial and bracelet vary under one reference — confirm against the papers." },
    { ref: "124270", brand: "Rolex", model: "Explorer 36", family: "explorer",
      base: { shape: "round", size: 36, metal: "steel", bezel: "smooth", indices: "rolex", hands: "mercedes", date: false },
      options: { dial: ["black"], strap: ["oyster"] }, note: "36 mm, black dial, Oyster bracelet." },

    { ref: "310.30.42.50.01.001", brand: "Omega", model: "Speedmaster Moonwatch Professional", family: "speedy", base: { ...SPEEDY },
      options: { dial: ["black"], strap: ["bracelet"] }, note: "Hesalite crystal, on steel bracelet. The .002 version is the same watch on a strap." },
    { ref: "310.30.42.50.01.002", brand: "Omega", model: "Speedmaster Moonwatch Professional", family: "speedy", base: { ...SPEEDY },
      options: { dial: ["black"], strap: ["leather-black", "fabric-black", "rubber-black"] }, note: "Hesalite crystal, on a strap (no bracelet). If it's on a bracelet, it's the .001." },
    { ref: "310.32.42.50.01.001", brand: "Omega", model: "Speedmaster Moonwatch Professional", family: "speedy", base: { ...SPEEDY },
      options: { dial: ["black"], strap: ["bracelet"] }, note: "Sapphire crystal (display caseback), on steel bracelet." },
    { ref: "310.32.42.50.01.002", brand: "Omega", model: "Speedmaster Moonwatch Professional", family: "speedy", base: { ...SPEEDY },
      options: { dial: ["black"], strap: ["leather-black", "fabric-black", "rubber-black"] }, note: "Sapphire crystal, on a strap. If it's on a bracelet, it's the .001." },
    { ref: "210.30.42.20.03.001", brand: "Omega", model: "Seamaster Diver 300M", family: "smp", base: { ...SMP, bezel: "dive-blue" },
      options: { dial: ["blue"], strap: ["bracelet"] }, note: "Blue dial and bezel, steel bracelet." },
    { ref: "210.30.42.20.01.001", brand: "Omega", model: "Seamaster Diver 300M", family: "smp", base: { ...SMP, bezel: "dive-black" },
      options: { dial: ["black"], strap: ["bracelet"] }, note: "Black dial and bezel, steel bracelet." },

    { ref: "M79030N-0001", brand: "Tudor", model: "Black Bay 58", family: "bb58", base: { ...BB58, bezel: "dive-gilt" },
      options: { dial: ["black-gilt"], strap: ["rivet"] }, note: "Black, on riveted steel bracelet. -0002 is leather, -0003 is fabric." },
    { ref: "M79030N-0002", brand: "Tudor", model: "Black Bay 58", family: "bb58", base: { ...BB58, bezel: "dive-gilt" },
      options: { dial: ["black-gilt"], strap: ["leather-brown", "leather-black"] }, note: "Black, on leather strap. On a bracelet it should be -0001." },
    { ref: "M79030N-0003", brand: "Tudor", model: "Black Bay 58", family: "bb58", base: { ...BB58, bezel: "dive-gilt" },
      options: { dial: ["black-gilt"], strap: ["fabric-black"] }, note: "Black, on fabric strap. On a bracelet it should be -0001." },
    { ref: "M79030B-0001", brand: "Tudor", model: "Black Bay 58 Blue", family: "bb58", base: { ...BB58, bezel: "dive-navy" },
      options: { dial: ["navy"], strap: ["rivet"] }, note: "Blue, on riveted steel bracelet. -0002 is leather, -0003 is fabric." },
    { ref: "M79030B-0002", brand: "Tudor", model: "Black Bay 58 Blue", family: "bb58", base: { ...BB58, bezel: "dive-navy" },
      options: { dial: ["navy"], strap: ["leather-brown", "leather-black"] }, note: "Blue, on leather strap. On a bracelet it should be -0001." },
    { ref: "M79030B-0003", brand: "Tudor", model: "Black Bay 58 Blue", family: "bb58", base: { ...BB58, bezel: "dive-navy" },
      options: { dial: ["navy"], strap: ["fabric-blue"] }, note: "Blue, on fabric strap. On a bracelet it should be -0001." },
    { ref: "M25407N-0001", brand: "Tudor", model: "Pelagos 39", family: "pelagos",
      base: { shape: "round", size: 39, metal: "titanium", bezel: "dive-black", indices: "rolex", hands: "snowflake", date: false },
      options: { dial: ["black"], strap: ["bracelet", "rubber-black"] },
      note: "Titanium. Sold with BOTH a titanium bracelet and a black rubber strap — check both are in the box." },

    { ref: "WSSA0029", brand: "Cartier", model: "Santos de Cartier Medium", family: "santos",
      base: { shape: "square", size: 35, metal: "steel", bezel: "thin", indices: "roman", hands: "sword", date: false, dialTexture: "matte" },
      options: { dial: ["silver"], strap: ["santos", "leather-black"] },
      note: "Medium, steel, silver dial. Sold with the steel bracelet AND a leather strap — check both are in the box." },
    { ref: "WSSA0018", brand: "Cartier", model: "Santos de Cartier Large", family: "santos",
      base: { shape: "square", size: 40, metal: "steel", bezel: "thin", indices: "roman", hands: "sword", date: true, dialTexture: "matte" },
      options: { dial: ["silver"], strap: ["santos", "leather-black"] },
      note: "Large, steel, silver dial, date. Sold with the steel bracelet AND a leather strap — check both are in the box." },

    { ref: "SBGA211", brand: "Grand Seiko", model: "Snowflake", family: "gs-snowflake",
      base: { shape: "round", size: 41, metal: "titanium", bezel: "thin", indices: "batons", hands: "dauphine", date: true, secColor: "#2c5bd6" },
      options: { dial: ["snowflake"], strap: ["bracelet"] }, note: "Titanium, textured white dial, blue seconds hand, titanium bracelet." },
  ];

  /* ---------- Lookup & resolution ---------- */

  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normRef = (s) => fold(s).replace(/[^a-z0-9]/g, "");
  const byRef = new Map(REFS.map((r) => [normRef(r.ref), r]));

  const find = (ref) => byRef.get(normRef(ref)) || null;
  const family = (entry) => (entry ? REFS.filter((r) => r.family === entry.family) : []);

  const DEFAULT = { shape: "round", size: 40, metal: "steel", bezel: "smooth", dial: "black", strap: "bracelet", indices: "batons", hands: "baton", date: false, dialTexture: "sunburst" };
  const LOOK_KEYS = ["shape", "metal", "bezel", "dial", "strap"];

  /* Effective look for a watch: defaults ← catalog entry ← saved look for that ref ← the watch's own choices. */
  function resolve(w, refLooks = {}) {
    const entry = find(w.ref);
    const saved = refLooks[normRef(w.ref)] || {};
    const base = { ...DEFAULT };
    if (entry) {
      Object.assign(base, entry.base);
      base.dial = entry.options.dial[0];
      base.strap = entry.options.strap[0];
    }
    const look = { ...base, ...(entry ? {} : saved), ...pick(w.look || {}) };
    return { entry, spec: look, warnings: checks(entry, w.look || {}) };
  }
  function pick(o) {
    const out = {};
    LOOK_KEYS.forEach((k) => o[k] && (out[k] = o[k]));
    return out;
  }

  /* Accuracy checks: does this watch's configuration exist for its reference? */
  function checks(entry, look) {
    if (!entry) return [];
    const w = [];
    if (look.strap && !entry.options.strap.includes(look.strap)) {
      const sib = family(entry).find((r) => r !== entry && r.options.strap.includes(look.strap) && (!look.dial || r.options.dial.includes(look.dial)));
      w.push(
        `${entry.ref} doesn't come on a ${STRAPS[look.strap]?.label.toLowerCase() || look.strap}. ` +
          (sib ? `That configuration is reference ${sib.ref} — check the papers, or the strap may have been swapped.` : `Check the papers — the strap or bracelet may have been swapped.`)
      );
    }
    if (look.dial && !entry.options.dial.includes(look.dial)) {
      w.push(`${entry.ref} isn't made with a ${DIALS[look.dial]?.label.toLowerCase() || look.dial} dial. Check the reference and the dial.`);
    }
    if (look.bezel && entry.base.bezel && look.bezel !== entry.base.bezel) w.push(`${entry.ref} comes with a ${BEZELS[entry.base.bezel].label.toLowerCase()}.`);
    if (look.metal && entry.base.metal && look.metal !== entry.base.metal) w.push(`${entry.ref} is ${METALS[entry.base.metal].label.toLowerCase()}.`);
    return w;
  }

  /* Every configuration a reference comes in (dial × strap). */
  function configurations(entry) {
    if (!entry) return [];
    const out = [];
    entry.options.dial.forEach((dial) => entry.options.strap.forEach((strap) => out.push({ dial, strap })));
    return out;
  }

  function describe(spec) {
    return [DIALS[spec.dial]?.label + " dial", STRAPS[spec.strap]?.label].filter(Boolean).join(" · ");
  }

  return { METALS, DIALS, STRAPS, BEZELS, SHAPES, REFS, find, family, resolve, configurations, describe, normRef, LOOK_KEYS };
})();
