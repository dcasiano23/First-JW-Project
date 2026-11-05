// Tablero de tarjetas de tareas. Todo se guarda en este navegador (localStorage).
(() => {
  "use strict";

  const KEY = "tareas:v1";
  const COLUMNS = [
    { id: "todo", name: "Por hacer" },
    { id: "doing", name: "En curso" },
    { id: "done", name: "Hecho" },
  ];
  const COLORS = [
    { id: "", name: "Sin color" },
    { id: "green", name: "Verde" },
    { id: "gold", name: "Dorado" },
    { id: "red", name: "Rojo" },
    { id: "blue", name: "Azul" },
    { id: "purple", name: "Morado" },
  ];

  const $ = (sel, el = document) => el.querySelector(sel);
  const board = $("#board");
  const dialog = $("#editor");
  const form = $("#editor-form");
  const filterInput = $("#filter");

  // ---------- Datos ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      if (data && Array.isArray(data.cards)) return data;
    } catch (e) {}
    return {
      cards: [
        { id: uid(), col: "todo", title: "Bienvenido a Tareas", notes: "Toque una tarjeta para editarla. Use + para crear una nueva.", color: "green", due: "" },
        { id: uid(), col: "todo", title: "Mueva tarjetas entre columnas", notes: "Arrástrelas (en el teléfono, mantenga presionado) o use las flechas ‹ ›.", color: "gold", due: "" },
        { id: uid(), col: "doing", title: "Ponga una fecha límite", notes: "Las tarjetas vencidas se marcan en rojo.", color: "blue", due: today() },
      ],
    };
  }

  let state = load();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  };

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---------- Pintar ----------
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });

  function dueInfo(due, col) {
    if (!due) return "";
    const t = today();
    const cls = col === "done" ? "" : due < t ? "overdue" : due === t ? "today" : "";
    const label = due === t ? "Hoy" : fmtDate.format(new Date(due + "T12:00:00"));
    return `<span class="due ${cls}" title="Fecha límite">${icon("M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z")}${esc(label)}</span>`;
  }

  function render() {
    const q = filterInput.value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const match = (c) => !q || (c.title + " " + c.notes).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").includes(q);
    const scroll = board.scrollLeft;

    board.innerHTML = COLUMNS.map((col, ci) => {
      const all = state.cards.filter((c) => c.col === col.id);
      const cards = all.filter(match);
      return `
        <section class="column" data-col="${col.id}" aria-labelledby="h-${col.id}">
          <div class="column-head">
            <h2 id="h-${col.id}">${col.name}</h2>
            <span class="count" aria-label="${all.length} tarjetas">${all.length}</span>
            <button class="add" data-add="${col.id}" aria-label="Nueva tarjeta en ${col.name}" title="Nueva tarjeta">${icon("M12 5v14M5 12h14")}</button>
          </div>
          <div class="cards">
            ${cards.length ? cards.map((c) => `
              <article class="card" tabindex="0" data-id="${c.id}" ${c.color ? `style="--card-color: var(--c-${c.color})"` : ""} aria-label="${esc(c.title)}">
                <h3>${esc(c.title)}</h3>
                ${c.notes ? `<p>${esc(c.notes)}</p>` : ""}
                <div class="meta">
                  ${dueInfo(c.due, c.col)}
                  <span class="move">
                    ${ci > 0 ? `<button data-move="-1" aria-label="Mover a ${COLUMNS[ci - 1].name}" title="Mover a ${COLUMNS[ci - 1].name}">${icon("m15 6-6 6 6 6")}</button>` : ""}
                    ${ci < COLUMNS.length - 1 ? `<button data-move="1" aria-label="Mover a ${COLUMNS[ci + 1].name}" title="Mover a ${COLUMNS[ci + 1].name}">${icon("m9 6 6 6-6 6")}</button>` : ""}
                  </span>
                </div>
              </article>`).join("") : `<p class="empty">${q && all.length ? "Ninguna coincide" : "Sin tarjetas"}</p>`}
          </div>
        </section>`;
    }).join("");
    board.scrollLeft = scroll;
  }

  // ---------- Editor ----------
  let editingId = null;

  form.elements.col.innerHTML = COLUMNS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("#color-list").innerHTML = COLORS.map((c) => `
    <label class="swatch" title="${c.name}">
      <input type="radio" name="color" value="${c.id}" aria-label="${c.name}">
      <span class="${c.id ? "" : "none"}" style="--sw: var(--c-${c.id || "none"})"></span>
    </label>`).join("");

  function openEditor(id, col = "todo") {
    const card = id && state.cards.find((c) => c.id === id);
    editingId = card ? card.id : null;
    $("#editor-title").textContent = card ? "Editar tarjeta" : "Nueva tarjeta";
    $("#btn-delete").hidden = !card;
    form.elements.title.value = card ? card.title : "";
    form.elements.notes.value = card ? card.notes : "";
    form.elements.due.value = card ? card.due : "";
    form.elements.col.value = card ? card.col : col;
    form.elements.color.value = card ? card.color : "";
    dialog.showModal();
    form.elements.title.focus();
  }

  form.addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value !== "save") return;
    const data = {
      title: form.elements.title.value.trim(),
      notes: form.elements.notes.value.trim(),
      due: form.elements.due.value,
      col: form.elements.col.value,
      color: form.elements.color.value,
    };
    if (!data.title) { e.preventDefault(); return; }
    if (editingId) {
      const i = state.cards.findIndex((c) => c.id === editingId);
      const old = state.cards[i];
      if (old.col !== data.col) {
        state.cards.splice(i, 1);
        state.cards.push({ ...old, ...data });
      } else {
        state.cards[i] = { ...old, ...data };
      }
    } else {
      state.cards.push({ id: uid(), ...data });
    }
    save();
    render();
    focusCard(editingId);
  });

  $("#btn-cancel").addEventListener("click", () => dialog.close());
  $("#btn-delete").addEventListener("click", () => {
    if (!editingId) return;
    if (!confirm("¿Eliminar esta tarjeta?")) return;
    state.cards = state.cards.filter((c) => c.id !== editingId);
    save();
    dialog.close();
    render();
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  function focusCard(id) {
    const el = id && board.querySelector(`.card[data-id="${id}"]`);
    if (el) el.focus({ preventScroll: false });
  }

  function moveCard(id, dir) {
    const i = state.cards.findIndex((c) => c.id === id);
    if (i < 0) return;
    const ci = COLUMNS.findIndex((c) => c.id === state.cards[i].col) + dir;
    if (ci < 0 || ci >= COLUMNS.length) return;
    const [card] = state.cards.splice(i, 1);
    card.col = COLUMNS[ci].id;
    state.cards.push(card);
    save();
    render();
    const el = board.querySelector(`.card[data-id="${id}"]`);
    if (el) { el.focus({ preventScroll: true }); el.closest(".column").scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" }); }
  }

  // ---------- Clics y teclado ----------
  $("#btn-add").addEventListener("click", () => openEditor(null, "todo"));
  filterInput.addEventListener("input", render);

  board.addEventListener("click", (e) => {
    if (suppressClick) return;
    const add = e.target.closest("[data-add]");
    if (add) return openEditor(null, add.dataset.add);
    const card = e.target.closest(".card");
    if (!card) return;
    const mv = e.target.closest("[data-move]");
    if (mv) return moveCard(card.dataset.id, Number(mv.dataset.move));
    openEditor(card.dataset.id);
  });

  board.addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    if (!card || e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor(card.dataset.id); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); moveCard(card.dataset.id, e.key === "ArrowLeft" ? -1 : 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const sib = e.key === "ArrowUp" ? card.previousElementSibling : card.nextElementSibling;
      if (e.altKey && sib && sib.classList.contains("card")) {
        // Alt + flecha: cambiar el orden dentro de la columna.
        const a = state.cards.findIndex((c) => c.id === card.dataset.id);
        const b = state.cards.findIndex((c) => c.id === sib.dataset.id);
        [state.cards[a], state.cards[b]] = [state.cards[b], state.cards[a]];
        save(); render(); focusCard(card.dataset.id);
      } else if (sib && sib.classList.contains("card")) sib.focus();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (dialog.open || e.target.matches("input, textarea, select")) return;
    if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openEditor(null, "todo"); }
    if (e.key === "/") { e.preventDefault(); filterInput.focus(); }
  });

  // ---------- Arrastrar (ratón y táctil) ----------
  let drag = null;
  let suppressClick = false;

  board.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".card");
    if (!card || e.target.closest("button") || e.button !== 0) return;
    const p = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false, timer: 0 };
    if (e.pointerType === "touch") {
      // En pantallas táctiles, mantener presionado para no estorbar el desplazamiento.
      p.timer = setTimeout(() => { if (drag === p) startDrag(p.x, p.y); }, 280);
    }
    drag = p;
  });

  function startDrag(x, y) {
    const { card } = drag;
    const r = card.getBoundingClientRect();
    drag.active = true;
    drag.dx = x - r.left;
    drag.dy = y - r.top;
    drag.ghost = card.cloneNode(true);
    drag.ghost.classList.add("ghost");
    drag.ghost.style.width = r.width + "px";
    document.body.appendChild(drag.ghost);
    drag.placeholder = document.createElement("div");
    drag.placeholder.className = "placeholder";
    drag.placeholder.style.height = r.height + "px";
    card.after(drag.placeholder);
    card.classList.add("dragging");
    card.hidden = true;
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
    positionGhost(x, y);
  }

  function positionGhost(x, y) {
    drag.ghost.style.left = x - drag.dx + "px";
    drag.ghost.style.top = y - drag.dy + "px";
  }

  function updateDrop(x, y) {
    const under = document.elementFromPoint(x, y);
    const col = under && under.closest(".column");
    board.querySelectorAll(".drop-target").forEach((c) => c !== col && c.classList.remove("drop-target"));
    if (!col) return;
    col.classList.add("drop-target");
    const list = $(".cards", col);
    const empty = $(".empty", list);
    if (empty) empty.hidden = true;
    const others = [...list.querySelectorAll(".card:not(.dragging)")];
    const before = others.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) list.insertBefore(drag.placeholder, before);
    else list.appendChild(drag.placeholder);

    // Desplazar el tablero de lado cerca de los bordes (teléfono).
    const edge = 40;
    if (x < edge) board.scrollLeft -= 12;
    else if (x > innerWidth - edge) board.scrollLeft += 12;
  }

  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (e.pointerType === "touch") { if (moved > 8) { clearTimeout(drag.timer); drag = null; } return; }
      if (moved < 6) return;
      startDrag(drag.x, drag.y);
    }
    e.preventDefault();
    positionGhost(e.clientX, e.clientY);
    updateDrop(e.clientX, e.clientY);
  });

  // Mientras se arrastra con el dedo, impedir que la página se desplace.
  document.addEventListener("touchmove", (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  // Evitar el menú contextual de mantener presionado.
  board.addEventListener("contextmenu", (e) => { if (drag) e.preventDefault(); });

  function endDrag(cancelled) {
    if (!drag) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    if (!d.active) return;
    d.ghost.remove();
    board.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
    const list = d.placeholder.parentElement;
    if (!cancelled && list) {
      const col = list.closest(".column").dataset.col;
      const next = d.placeholder.nextElementSibling && d.placeholder.nextElementSibling.closest(".card:not(.dragging)");
      const i = state.cards.findIndex((c) => c.id === d.id);
      const [card] = state.cards.splice(i, 1);
      card.col = col;
      let j = next ? state.cards.findIndex((c) => c.id === next.dataset.id) : -1;
      if (j < 0) {
        // Al final de la columna: después de la última tarjeta de esa columna.
        let last = -1;
        state.cards.forEach((c, k) => { if (c.col === col) last = k; });
        j = last + 1;
      }
      state.cards.splice(j, 0, card);
      save();
    }
    render();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }

  document.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(false); });
  document.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag && drag.active) endDrag(true); });

  // ---------- Tema ----------
  $("#btn-theme").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("lp:theme", JSON.stringify(next)); } catch (e) {}
  });

  // Sincronizar si se cambia en otra pestaña.
  addEventListener("storage", (e) => { if (e.key === KEY) { state = load(); render(); } });

  render();
})();
