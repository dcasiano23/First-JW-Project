(function () {
  "use strict";

  const book = window.BOOK;
  const app = document.getElementById("app");

  // ---------- Almacenamiento local (puede fallar en modo privado) ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("lp:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("lp:" + key, JSON.stringify(value));
      } catch (e) {}
    },
  };

  // ---------- Citas bíblicas ----------

  const BOOK_NUMBERS = {};
  [
    "Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut",
    "1 Samuel", "2 Samuel", "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas", "Esdras",
    "Nehemías", "Ester", "Job", "Salmos", "Proverbios", "Eclesiastés", "El Cantar de los Cantares",
    "Isaías", "Jeremías", "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel", "Amós",
    "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc", "Sofonías", "Ageo", "Zacarías",
    "Malaquías", "Mateo", "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios",
    "2 Corintios", "Gálatas", "Efesios", "Filipenses", "Colosenses", "1 Tesalonicenses",
    "2 Tesalonicenses", "1 Timoteo", "2 Timoteo", "Tito", "Filemón", "Hebreos", "Santiago",
    "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan", "Judas", "Apocalipsis",
  ].forEach((name, i) => (BOOK_NUMBERS[name] = i + 1));
  BOOK_NUMBERS["Salmo"] = 19;

  const WOL = "https://wol.jw.org/es/wol";

  function scriptureUrl(ref) {
    const m = ref.match(/^(.+?)\s+(\d+)(?::(\d+))?/);
    const num = m && BOOK_NUMBERS[m[1]];
    if (!num) {
      console.warn("Cita no reconocida:", ref);
      return WOL + "/s/r4/lp-s?q=" + encodeURIComponent(ref);
    }
    const base = `${WOL}/b/r4/lp-s/nwtsty/${num}/${m[2]}`;
    return m[3] ? `${base}#v=${num}:${m[2]}:${m[3]}` : base;
  }

  function searchUrl(query, filter) {
    let url = WOL + "/s/r4/lp-s?q=" + encodeURIComponent(query).replace(/%20/g, "+");
    if (filter) url += "&fc%5B%5D=" + encodeURIComponent(filter);
    return url;
  }

  // ---------- Formato del contenido ----------

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function emphasis(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])_(.+?)_(?!\w)/g, "$1<em>$2</em>");
  }

  // Los enlaces se guardan aparte para que el formato de negrita/cursiva no toque sus URL.
  function inline(text) {
    const saved = [];
    const keep = (html) => "\u0000" + (saved.push(html) - 1) + "\u0000";
    let s = escapeHtml(text);

    s = s.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
      const [label, ref] = inner.split("|");
      return keep(
        `<a class="ref" href="${escapeHtml(scriptureUrl(ref || label))}" target="_blank" rel="noopener">${label}</a>`
      );
    });
    s = s.replace(/\{\{([^}]+)\}\}/g, (_, inner) => {
      const [label, query, filter] = inner.split("|");
      const q = query.replace(/&quot;/g, '"');
      return keep(
        `<a class="pub" href="${escapeHtml(searchUrl(q, filter))}" target="_blank" rel="noopener">${emphasis(label)}<span class="ext" aria-hidden="true">↗</span></a>`
      );
    });
    s = s.replace(/\[#(\d+)\]/g, (_, n) => keep(`<a class="topic-link" href="#tema-${n}">${n}</a>`));
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, label, url) =>
      keep(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`)
    );

    s = emphasis(s);
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[i]);
  }

  // Versión en texto plano, para la búsqueda.
  function plain(text) {
    return text
      .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
      .replace(/\{\{([^}|]+)[^}]*\}\}/g, "$1")
      .replace(/\[#(\d+)\]/g, "Tema $1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*|(^|[^\w])_|_(?!\w)/g, "$1")
      .replace(/^\s*(\||##|>|-|\d+\.)\s*/gm, "")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slugify(s) {
    return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function renderBody(body) {
    const lines = body.trim().split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
      } else if (line.startsWith("## ")) {
        const title = line.slice(3).trim();
        out.push(`<h2 id="s-${slugify(title)}"><span>${inline(title)}</span></h2>`);
        i++;
      } else if (line.startsWith("- ")) {
        const items = [];
        while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
        out.push("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
      } else if (/^\d+\. /.test(line)) {
        const start = parseInt(line, 10);
        const items = [];
        while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
        out.push(
          `<ol${start !== 1 ? ` start="${start}"` : ""}>` + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ol>"
        );
      } else if (line.startsWith("|")) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          rows.push(lines[i++].replace(/^\||\|\s*$/g, "").split(" | ").map((c) => c.trim()));
        }
        const [head, ...bodyRows] = rows;
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
            head.map((c) => `<th>${inline(c)}</th>`).join("") +
            "</tr></thead><tbody>" +
            bodyRows
              .map(
                (r) =>
                  "<tr>" + r.map((c, ci) => `<td data-label="${escapeHtml(head[ci] || "")}">${inline(c)}</td>`).join("") + "</tr>"
              )
              .join("") +
            "</tbody></table></div>"
        );
      } else if (line.startsWith("> ")) {
        out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
        i++;
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^(## |- |\d+\. |\||> )/.test(lines[i])) para.push(lines[i++]);
        out.push(`<p>${inline(para.join(" "))}</p>`);
      }
    }
    return out.join("\n");
  }

  // ---------- Datos derivados ----------

  const topics = book.topics;
  const mainTopics = topics.filter((t) => t.id > 0);
  const refCount = (t) => (t.body.match(/\[\[/g) || []).length;
  const sectionsOf = (t) => [...t.body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const illustrationCount = (topics.find((t) => t.id === 14).body.match(/^\| \*\*/gm) || []).length;
  const totalRefs = topics.reduce((n, t) => n + refCount(t), 0);

  // ---------- Búsqueda ----------

  // Quita acentos y pasa a minúsculas conservando la longitud del texto,
  // para poder resaltar las coincidencias en el texto original.
  function fold(s) {
    let out = "";
    for (const ch of s) {
      const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      out += f.length === 1 ? f : ch.length === 1 ? ch.toLowerCase() : " ";
    }
    return out;
  }

  const index = [];
  topics.forEach((t) => {
    const parts = ("\n" + t.body).split(/\n## /);
    parts.forEach((part, pi) => {
      const nl = part.indexOf("\n");
      const heading = pi === 0 ? null : part.slice(0, nl).trim();
      const text = plain(pi === 0 ? part : part.slice(nl + 1));
      if (!text) return;
      index.push({ topic: t, heading, text, folded: fold(text), headFolded: heading ? fold(heading) : "" });
    });
  });

  function search(query) {
    const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    const results = [];
    for (const entry of index) {
      const hay = entry.folded + " " + entry.headFolded + " " + fold(entry.topic.title);
      if (!words.every((w) => hay.includes(w))) continue;
      let score = 0;
      words.forEach((w) => {
        if (fold(entry.topic.title).includes(w)) score += 3;
        if (entry.headFolded.includes(w)) score += 2;
        score += entry.folded.split(w).length - 1;
      });
      results.push({ entry, score, words });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function highlight(text, folded, words) {
    const ranges = [];
    words.forEach((w) => {
      let pos = folded.indexOf(w);
      while (pos !== -1) {
        ranges.push([pos, pos + w.length]);
        pos = folded.indexOf(w, pos + w.length);
      }
    });
    ranges.sort((a, b) => a[0] - b[0]);
    let out = "";
    let last = 0;
    for (const [a, b] of ranges) {
      if (a < last) continue;
      out += escapeHtml(text.slice(last, a)) + "<mark>" + escapeHtml(text.slice(a, b)) + "</mark>";
      last = b;
    }
    return out + escapeHtml(text.slice(last));
  }

  function snippet(entry, words) {
    const first = Math.max(0, Math.min(...words.map((w) => entry.folded.indexOf(w)).filter((p) => p >= 0)));
    const start = Math.max(0, first - 60);
    const end = Math.min(entry.text.length, first + 160);
    const text = entry.text.slice(start, end);
    const folded = entry.folded.slice(start, end);
    return (start > 0 ? "…" : "") + highlight(text, folded, words) + (end < entry.text.length ? "…" : "");
  }

  // ---------- Vistas ----------

  const favs = () => store.get("favs", []);
  const isFav = (id) => favs().includes(id);
  function toggleFav(id) {
    const f = favs();
    store.set("favs", f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
  }

  function topicCard(t) {
    const n = refCount(t);
    return `
      <a class="card" href="#tema-${t.id}">
        <span class="card-num">${String(t.num).padStart(2, "0")}</span>
        <span class="card-body">
          <span class="card-title">${escapeHtml(t.title)}</span>
          <span class="card-meta">${t.id === 14 ? illustrationCount + " ilustraciones" : n + (n === 1 ? " texto" : " textos")}</span>
        </span>
        ${isFav(t.id) ? '<span class="card-star" aria-label="Favorito">★</span>' : ""}
      </a>`;
  }

  function renderHome(query) {
    document.title = book.title;
    const last = topics.find((t) => t.id === store.get("last", null));
    const favTopics = favs().map((id) => topics.find((t) => t.id === id)).filter(Boolean);

    app.innerHTML = `
      <section class="hero">
        <p class="kicker">${escapeHtml(book.kicker)}</p>
        <h1>${escapeHtml(book.title)}</h1>
        <p class="lead">${escapeHtml(book.subtitle)}</p>
        <p class="stats"><span><b>${mainTopics.length}</b> temas</span><span><b>${totalRefs}</b> textos enlazados</span><span><b>${illustrationCount}</b> ilustraciones</span></p>
      </section>

      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Buscar en el libro: oración, Mateo 5, tucán…" autocomplete="off" aria-label="Buscar en el libro" value="${escapeHtml(query || "")}">
      </div>

      <div id="results"></div>

      <div id="browse">
        ${last ? `<a class="resume" href="#tema-${last.id}"><span>Continuar leyendo</span><b>${escapeHtml(last.title)}</b><span aria-hidden="true">→</span></a>` : ""}
        ${favTopics.length ? `<h2 class="section-label">Favoritos</h2><div class="grid">${favTopics.map(topicCard).join("")}</div>` : ""}
        <h2 class="section-label">Temas</h2>
        <div class="grid">${mainTopics.map(topicCard).join("")}</div>
        <a class="intro-link" href="#tema-0">Cómo usar este libro →</a>
      </div>`;

    const input = document.getElementById("q");
    const results = document.getElementById("results");
    const browse = document.getElementById("browse");

    function update() {
      const q = input.value.trim();
      lastQuery = q;
      if (fold(q).replace(/\s/g, "").length < 2) {
        results.innerHTML = "";
        browse.hidden = false;
        return;
      }
      browse.hidden = true;
      const found = search(q);
      results.innerHTML = found.length
        ? `<p class="result-count">${found.length} ${found.length === 1 ? "resultado" : "resultados"}</p>` +
          found
            .slice(0, 60)
            .map(({ entry, words }) => {
              const t = entry.topic;
              return `
                <a class="result" href="#tema-${t.id}" data-q="${escapeHtml(q)}" data-s="${entry.heading ? slugify(entry.heading) : ""}">
                  <span class="result-where">${t.id ? "Tema " + t.num : "Introducción"} · ${escapeHtml(t.title)}${entry.heading ? " · " + escapeHtml(entry.heading) : ""}</span>
                  <span class="result-text">${snippet(entry, words)}</span>
                </a>`;
            })
            .join("")
        : `<p class="empty">No se encontró "${escapeHtml(q)}". Pruebe con otra palabra o busque en la <a href="${searchUrl(q)}" target="_blank" rel="noopener">Biblioteca en línea</a>.</p>`;
    }

    input.addEventListener("input", update);
    if (query) update();
    return input;
  }

  function renderTopic(id, params) {
    const t = topics.find((x) => x.id === id);
    if (!t) return renderHome();
    store.set("last", id);
    document.title = t.title + " · " + book.title;

    const pos = topics.indexOf(t);
    const prev = topics[pos - 1];
    const next = topics[pos + 1];
    const n = refCount(t);
    const kicker = t.kicker || `Tema ${t.num} · ${n} ${n === 1 ? "texto bíblico" : "textos bíblicos"}`;
    const sections = sectionsOf(t);

    app.innerHTML = `
      <article class="topic">
        <header class="topic-head">
          <span class="topic-num">${escapeHtml(t.num)}</span>
          <div>
            <p class="kicker muted">${escapeHtml(kicker)}</p>
            <h1>${escapeHtml(t.title)}</h1>
          </div>
          <button class="star${isFav(id) ? " on" : ""}" id="fav" aria-pressed="${isFav(id)}" aria-label="Guardar en favoritos" title="Favorito">★</button>
        </header>
        ${
          sections.length > 1
            ? `<nav class="toc" aria-label="Secciones">${sections
                .map((s) => `<a href="#tema-${id}" data-s="${slugify(s)}">${inline(s)}</a>`)
                .join("")}</nav>`
            : ""
        }
        <div class="prose">${renderBody(t.body)}</div>
      </article>
      <nav class="pager">
        ${prev ? `<a href="#tema-${prev.id}" class="prev"><span>← Anterior</span><b>${escapeHtml(prev.title)}</b></a>` : "<span></span>"}
        ${next ? `<a href="#tema-${next.id}" class="next"><span>Siguiente →</span><b>${escapeHtml(next.title)}</b></a>` : `<a href="#inicio" class="next"><span>Fin →</span><b>Volver al índice</b></a>`}
      </nav>
      <p class="disclaimer">Material personal de estudio, basado en apuntes de clase. No es una publicación oficial. Para cualquier pregunta, consulte <a href="https://www.jw.org/es/" target="_blank" rel="noopener">jw.org</a> y la <a href="https://wol.jw.org/es/wol/h/r4/lp-s" target="_blank" rel="noopener">Biblioteca en línea Watchtower</a>.</p>`;

    document.getElementById("fav").addEventListener("click", (e) => {
      toggleFav(id);
      e.currentTarget.classList.toggle("on", isFav(id));
      e.currentTarget.setAttribute("aria-pressed", isFav(id));
    });

    const q = params.q;
    if (q) markTerms(app.querySelector(".prose"), fold(q).split(/\s+/).filter((w) => w.length > 1));

    const section = params.s && document.getElementById("s-" + params.s);
    const marks = [...app.querySelectorAll(".prose mark")];
    const after = (el) => !section || section.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    const target = marks.find(after) || section;
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    } else {
      window.scrollTo(0, 0);
    }
  }

  function markTerms(root, words) {
    if (!words.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const folded = fold(text);
      if (!words.some((w) => folded.includes(w))) return;
      const span = document.createElement("span");
      span.innerHTML = highlight(text, folded, words);
      node.replaceWith(...span.childNodes);
    });
  }

  // ---------- Navegación ----------

  // Direcciones sencillas (#tema-4) para que funcionen en cualquier servidor.
  // La búsqueda y la sección elegida se guardan en memoria, no en la dirección.
  let lastQuery = "";
  let pending = {};

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-q], a[data-s]");
    if (!a) return;
    pending = { q: a.dataset.q || "", s: a.dataset.s || "" };
    if (a.getAttribute("href") === location.hash) {
      e.preventDefault();
      route();
    }
  });

  function route() {
    const hash = location.hash.slice(1);
    const params = pending;
    pending = {};
    const m = hash.match(/^tema-(\d+)$/);

    if (m) {
      renderTopic(parseInt(m[1], 10), params);
    } else if (hash === "buscar") {
      const input = renderHome(lastQuery);
      input.focus();
      window.scrollTo(0, 0);
    } else {
      renderHome(lastQuery);
      window.scrollTo(0, 0);
    }
  }

  window.addEventListener("hashchange", route);

  // ---------- Preferencias: tema y tamaño de letra ----------

  const root = document.documentElement;
  const SIZES = [1, 1.125, 1.25];

  function applyPrefs() {
    const theme = store.get("theme", null);
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.style.setProperty("--scale", SIZES[store.get("size", 0)] || 1);
  }

  document.getElementById("btn-theme").addEventListener("click", () => {
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    store.set("theme", current === "dark" ? "light" : "dark");
    applyPrefs();
  });

  document.getElementById("btn-size").addEventListener("click", () => {
    store.set("size", (store.get("size", 0) + 1) % SIZES.length);
    applyPrefs();
  });

  document.getElementById("btn-search").addEventListener("click", () => {
    const input = document.getElementById("q");
    if (input) {
      input.focus();
      input.scrollIntoView({ block: "center" });
    } else {
      location.hash = "buscar";
    }
  });

  applyPrefs();
  route();

  // ---------- Uso sin conexión ----------

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
