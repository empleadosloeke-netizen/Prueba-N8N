document.addEventListener("DOMContentLoaded", () => {

  const GOOGLE_SHEET_WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbwbYx8fqFvG3MeKzLOSpbAJ0mZL1P2mVcKFIneXCOh6iqg8K_RbSwGofIJZMHJHITJy/exec";

  /* ================= TIEMPO UNIFICADO (cliente) ================= */
  function isoNowSeconds() {
    const d = new Date();
    d.setMilliseconds(0);
    return d.toISOString();
  }

  function formatDateTimeAR(iso) {
    try {
      return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    } catch {
      return "";
    }
  }

  function todayKeyAR() {
    return new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  }

  /* ================= ELEMENTOS ================= */
  const $ = (id) => document.getElementById(id);

  const legajoScreen  = $("legajoScreen");
  const optionsScreen = $("optionsScreen");
  const legajoInput   = $("legajoInput");

  const row1 = $("row1");
  const row2 = $("row2");
  const row3 = $("row3");

  const selectedArea = $("selectedArea");
  const selectedBox  = $("selectedBox");
  const selectedDesc = $("selectedDesc");
  const inputArea    = $("inputArea");
  const inputLabel   = $("inputLabel");
  const textInput    = $("textInput");
  const error        = $("error");

  const btnContinuar      = $("btnContinuar");
  const btnBackTop        = $("btnBackTop");
  const btnBackLabel      = $("btnBackLabel");
  const btnResetSelection = $("btnResetSelection");
  const btnEnviar         = $("btnEnviar");

  const daySummary = $("daySummary");
  const matrizInfo = $("matrizInfo");

  const required = {
    legajoScreen, optionsScreen, legajoInput, daySummary,
    row1, row2, row3,
    selectedArea, selectedBox, selectedDesc, inputArea, inputLabel, textInput, error,
    btnContinuar, btnBackTop, btnBackLabel, btnResetSelection, btnEnviar,
    matrizInfo
  };
  const missing = Object.entries(required).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("FALTAN ELEMENTOS EN EL HTML (ids):", missing);
    alert("Error: faltan elementos en el HTML. Mirá la consola (F12).");
    return;
  }

  /* ================= OPCIONES ================= */
  const OPTIONS = [
    {code:"E",desc:"Empecé Matriz",row:1,input:{show:true,label:"Ingresar número",placeholder:"Ejemplo: 110",validate:/^[0-9]+$/}},
    {code:"C",desc:"Cajón",row:1,input:{show:true,label:"Ingresar número",placeholder:"Ejemplo: 1500",validate:/^[0-9]+$/}},
    {code:"PB",desc:"Paré Baño",row:2,input:{show:false}},
    {code:"BC",desc:"Busqué Cajón",row:2,input:{show:false}},
    {code:"MOV",desc:"Movimiento",row:2,input:{show:false}},
    {code:"LIMP",desc:"Limpieza",row:2,input:{show:false}},
    {code:"Perm",desc:"Permiso",row:2,input:{show:false}},
    {code:"AL",desc:"Ayuda Logística",row:3,input:{show:false}},
    {code:"PR",desc:"Paré Carga Rollo",row:3,input:{show:false}},
    {code:"CM",desc:"Cambiar Matriz",row:3,input:{show:false}},
    {code:"RM",desc:"Rotura Matriz",row:3,input:{show:false}},
    {code:"PC",desc:"Paré Comida",row:3,input:{show:false}},
    {code:"RD",desc:"Rollo Fleje Doblado",row:3,input:{show:false}}
  ];

  const NON_DOWNTIME_CODES = new Set(["Perm","RM","RD"]);

  function isDowntime(payload) {
    return !NON_DOWNTIME_CODES.has(payload.opcion);
  }

  function sameDowntime(a, b) {
    if (!a || !b) return false;
    return String(a.opcion) === String(b.opcion) && String(a.texto || "") === String(b.texto || "");
  }

  let selected = null;

  /* ================= localStorage (ESTADO + COLA) ================= */
  const LS_STATE_KEY = "prod_day_state_ls_v1";
  const LS_QUEUE_KEY = "prod_send_queue_ls_v1";

  function freshDayState() {
    return {
      dayKey: todayKeyAR(),
      lastMatrix: null,
      lastCajon: null,
      last2: [],
      lastDowntime: null
    };
  }

  function readState() {
    try {
      const raw = localStorage.getItem(LS_STATE_KEY);
      if (!raw) return freshDayState();
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return freshDayState();
      if (obj.dayKey !== todayKeyAR()) return freshDayState();

      obj.last2 = Array.isArray(obj.last2) ? obj.last2 : [];
      obj.lastMatrix = obj.lastMatrix || null;
      obj.lastCajon = obj.lastCajon || null;
      obj.lastDowntime = obj.lastDowntime || null;
      return obj;
    } catch {
      return freshDayState();
    }
  }

  function writeState(state) {
    localStorage.setItem(LS_STATE_KEY, JSON.stringify(state));
  }

  function readQueue() {
    try {
      const raw = localStorage.getItem(LS_QUEUE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeQueue(arr) {
    localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(arr.slice(-50)));
  }

  function enqueue(payload) {
    const q = readQueue();
    q.push(payload);
    writeQueue(q);
  }

  function dequeueOne() {
    const q = readQueue();
    const item = q.shift();
    writeQueue(q);
    return item;
  }

  function queueLength() {
    return readQueue().length;
  }

  /* ================= RESUMEN UI ================= */
  function renderSummary() {
    const legajo = String(legajoInput.value || "").trim();
    if (!legajo) {
      daySummary.className = "history-empty";
      daySummary.innerText = "Ingresá tu legajo para ver el resumen";
      return;
    }

    const s = readState();
    const qLen = queueLength();

    const block = (title, item) => {
      if (!item) return `
        <div class="day-item">
          <div class="t1">${title}</div>
          <div class="t2">—</div>
        </div>`;
      return `
        <div class="day-item">
          <div class="t1">${title}</div>
          <div class="t2">
            ${item.opcion} — ${item.descripcion}<br>
            ${item.texto ? `Dato: <b>${item.texto}</b><br>` : ""}
            ${item.ts ? `Fecha: ${formatDateTimeAR(item.ts)}` : ""}
          </div>
        </div>`;
    };

    const last2Block = (title, arr) => {
      if (!arr || !arr.length) return `
        <div class="day-item">
          <div class="t1">${title}</div>
          <div class="t2">—</div>
        </div>`;
      return `
        <div class="day-item">
          <div class="t1">${title}</div>
          <div class="t2">
            ${arr.map(it => `
              <div style="margin-top:6px;">
                <b>${it.opcion}</b> — ${it.descripcion}
                ${it.texto ? ` | Dato: <b>${it.texto}</b>` : ""}
                ${it.ts ? `<br><span style="color:#555;">${formatDateTimeAR(it.ts)}</span>` : ""}
              </div>
            `).join("")}
          </div>
        </div>`;
    };

    const downtimeBlock = (title, item) => {
      if (!item) return `
        <div class="day-item">
          <div class="t1">${title}</div>
          <div class="t2">—</div>
        </div>`;
      return `
        <div class="day-item">
          <div class="t1">${title} <span class="badge-warn">pendiente</span></div>
          <div class="t2">
            ${item.opcion} — ${item.descripcion}<br>
            ${item.texto ? `Dato: <b>${item.texto}</b><br>` : ""}
            ${item.ts ? `Fecha: ${formatDateTimeAR(item.ts)}` : ""}
          </div>
        </div>`;
    };

    daySummary.className = "";
    daySummary.innerHTML = [
      qLen ? `<div class="day-item"><div class="t1">Pendientes de envío</div><div class="t2"><b>${qLen}</b> (se reintentan)</div></div>` : "",
      block("Última Matriz (E)", s.lastMatrix),
      block("Último Cajón (C)", s.lastCajon),
      last2Block("Últimos 2 mensajes del día", s.last2),
      downtimeBlock("Último Tiempo Muerto", s.lastDowntime),
    ].join("");
  }

  /* ================= CARTEL MATRIZ EN CAJÓN ================= */
  function renderMatrizInfoForCajon() {
    const s = readState();
    const lm = s.lastMatrix;

    if (!selected || selected.code !== "C") {
      matrizInfo.classList.add("hidden");
      matrizInfo.innerHTML = "";
      return;
    }

    matrizInfo.classList.remove("hidden");

    if (!lm || !lm.texto) {
      matrizInfo.innerHTML =
        `⚠️ No hay matriz registrada hoy.<br><small>Enviá primero "E (Empecé Matriz)"</small>`;
      return;
    }

    matrizInfo.innerHTML =
      `Matriz en uso: <span style="font-size:22px;">${lm.texto}</span>
       <small>Última matriz: ${lm.ts ? formatDateTimeAR(lm.ts) : ""}</small>`;
  }

  /* ================= RENDER OPCIONES ================= */
  function renderOptions() {
    row1.innerHTML=""; row2.innerHTML=""; row3.innerHTML="";
    OPTIONS.forEach(o => {
      const d = document.createElement("div");
      d.className = "box";
      d.innerHTML = `<div class="box-title">${o.code}</div><div class="box-desc">${o.desc}</div>`;
      d.addEventListener("click", () => selectOption(o));
      (o.row===1 ? row1 : o.row===2 ? row2 : row3).appendChild(d);
    });
  }

  /* ================= NAVEGACIÓN ================= */
  function goToOptions() {
    if (!String(legajoInput.value || "").trim()) {
      alert("Ingresá el número de legajo");
      return;
    }
    legajoScreen.classList.add("hidden");
    optionsScreen.classList.remove("hidden");
    renderMatrizInfoForCajon();
  }

  function backToLegajo() {
    optionsScreen.classList.add("hidden");
    legajoScreen.classList.remove("hidden");
    renderSummary();
  }

  /* ================= SELECCIÓN ================= */
  function selectOption(opt) {
    selected = opt;
    selectedArea.classList.remove("hidden");
    selectedBox.innerText = opt.code;
    selectedDesc.innerText = opt.desc;
    error.innerText = "";
    textInput.value = "";

    if (opt.input.show) {
      inputArea.classList.remove("hidden");
      inputLabel.innerText = opt.input.label;
      textInput.placeholder = opt.input.placeholder;
    } else {
      inputArea.classList.add("hidden");
      textInput.placeholder = "";
    }

    renderMatrizInfoForCajon();
  }

  function resetSelection() {
    selected = null;
    selectedArea.classList.add("hidden");
    error.innerText = "";
    textInput.value = "";
    matrizInfo.classList.add("hidden");
    matrizInfo.innerHTML = "";
  }

  /* ================= TInicio ================= */
  function computeTInicioForC(state) {
    if (state.lastCajon && state.lastCajon.ts) return state.lastCajon.ts;
    if (state.lastMatrix && state.lastMatrix.ts) return state.lastMatrix.ts;
    return "";
  }

  /* ================= VALIDACIÓN TIEMPO MUERTO ================= */
  function validateBeforeSend(payload) {
    const state = readState();
    const ld = state.lastDowntime;

    if (!ld) return { ok: true };

    if (!isDowntime(payload)) return { ok: true };

    if (!sameDowntime(ld, payload)) {
      return {
        ok: false,
        msg:
          `Hay un "Tiempo Muerto" pendiente (${ld.opcion}${ld.texto ? " " + ld.texto : ""}).\n` +
          `Solo podés enviar el MISMO tiempo muerto, o enviar E / C / Perm / RM / RD.`
      };
    }

    return { ok: true, isSecondSameDowntime: true, downtimeTs: ld.ts || "" };
  }

  /* ================= COOKIES-LOGIC -> STATE UPDATE ================= */
  function updateStateAfterSend(payload) {
    const s = readState();
    const item = {
      opcion: payload.opcion,
      descripcion: payload.descripcion,
      texto: payload.texto || "",
      ts: payload.tsEvent
    };

    s.last2.unshift(item);
    s.last2 = s.last2.slice(0, 2);

    if (payload.opcion === "E") {
      if (s.lastMatrix && String(s.lastMatrix.texto||"") !== String(item.texto||"")) {
        s.lastCajon = null;
      }
      s.lastMatrix = item;
      s.lastDowntime = null;
    }

    if (payload.opcion === "C") {
      s.lastCajon = item;
      s.lastDowntime = null;
    }

    if (NON_DOWNTIME_CODES.has(payload.opcion) && payload.opcion !== "E" && payload.opcion !== "C") {
      s.lastDowntime = null;
    }

    if (isDowntime(payload)) {
      if (!s.lastDowntime) s.lastDowntime = item;
      else if (sameDowntime(s.lastDowntime, payload)) s.lastDowntime = null;
      else s.lastDowntime = item;
    }

    writeState(s);
  }

  async function postToSheet(payload) {
    return fetch(GOOGLE_SHEET_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      mode: "no-cors",
      keepalive: true
    });
  }

  async function flushQueueOnce() {
    const q = readQueue();
    if (!q.length) return;

    const item = q[0];
    try {
      await postToSheet(item);
      dequeueOne();
      renderSummary();
    } catch {
      // lo dejamos pendiente
    }
  }

  /* ================= ENVÍO RÁPIDO ================= */
  async function sendFast() {
    if (!selected) return;

    const legajo = String(legajoInput.value || "").trim();
    if (!legajo) { alert("Ingresá el número de legajo"); return; }

    const texto = String(textInput.value || "").trim();
    if (selected.input.show && !selected.input.validate.test(texto)) {
      error.innerText = "Solo se permiten números";
      return;
    }

    const tsEvent = isoNowSeconds();

    const payload = {
      legajo,
      opcion: selected.code,
      descripcion: selected.desc,
      texto,
      tsEvent,
      tInicio: ""
    };

    const stateBefore = readState();

    // ✅ BLOQUEO: C sin matriz
    if (payload.opcion === "C") {
      if (!stateBefore.lastMatrix || !stateBefore.lastMatrix.ts) {
        alert('Primero tenés que enviar "E (Empecé Matriz)" antes de registrar un Cajón.');
        return;
      }
      payload.tInicio = computeTInicioForC(stateBefore);
    }

    const v = validateBeforeSend(payload);
    if (!v.ok) { alert(v.msg); return; }

    if (v.isSecondSameDowntime) {
      payload.tInicio = v.downtimeTs || "";
    }

    // UI instantánea
    btnEnviar.disabled = true;
    const prevText = btnEnviar.innerText;
    btnEnviar.innerText = "Enviando...";

    // 1) Estado local inmediato
    updateStateAfterSend(payload);
    renderSummary();

    // 2) volver ya
    resetSelection();
    optionsScreen.classList.add("hidden");
    legajoScreen.classList.remove("hidden");

    // 3) cola + envío
    enqueue(payload);
    flushQueueOnce();

    // 4) reactivar
    setTimeout(() => {
      btnEnviar.disabled = false;
      btnEnviar.innerText = prevText;
    }, 250);
  }

  /* ================= EVENTOS ================= */
  btnContinuar.addEventListener("click", goToOptions);
  btnBackTop.addEventListener("click", backToLegajo);
  btnBackLabel.addEventListener("click", backToLegajo);
  btnResetSelection.addEventListener("click", resetSelection);
  btnEnviar.addEventListener("click", sendFast);
  legajoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") goToOptions(); });

  /* ================= INIT ================= */
  renderOptions();
  renderSummary();
  renderMatrizInfoForCajon();

  window.addEventListener("focus", () => flushQueueOnce());

  console.log("app.js cargado OK ✅ (localStorage + envío rápido)");

});
