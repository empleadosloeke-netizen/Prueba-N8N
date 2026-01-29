document.addEventListener("DOMContentLoaded", () => {

  const GOOGLE_SHEET_WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbw3uhNP6Mp9UGZTUsjs8KDhgQmSw6crBBBpq6wd79d_FTtIjSmbzE9XNJaIyUmr3lY/exec";

  /* ================= LIMPIEZA (1 vez) ================= */
  const MIGRATION_FLAG = "prod_migrated_v1";
  if (!localStorage.getItem(MIGRATION_FLAG)) {
    [
      "prod_day_state_ls_v1",
      "prod_send_queue_ls_v1",
      "legajo_history_v1",
      "prod_day_state_v7",
      "prod_state_ls_v1"
    ].forEach(k => localStorage.removeItem(k));

    localStorage.setItem(MIGRATION_FLAG, "1");
  }
  /* ==================================================== */

  /* ================= TIEMPO ================= */
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

  const btnContinuar = $("btnContinuar");
  const btnBackTop   = $("btnBackTop");
  const btnBackLabel = $("btnBackLabel");

  const row1 = $("row1");
  const row2 = $("row2");
  const row3 = $("row3");

  const selectedArea = $("selectedArea");
  const selectedBox  = $("selectedBox");
  const selectedDesc = $("selectedDesc");
  const inputArea    = $("inputArea");
  const inputLabel   = $("inputLabel");
  const textInput    = $("textInput");
  const btnResetSelection = $("btnResetSelection");
  const btnEnviar    = $("btnEnviar");
  const error        = $("error");

  const daySummary = $("daySummary");
  const matrizInfo = $("matrizInfo");

  const required = {
    legajoScreen, optionsScreen, legajoInput,
    btnContinuar, btnBackTop, btnBackLabel,
    row1, row2, row3,
    selectedArea, selectedBox, selectedDesc, inputArea, inputLabel, textInput,
    btnResetSelection, btnEnviar, error,
    daySummary, matrizInfo
  };
  const missing = Object.entries(required).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("FALTAN ELEMENTOS EN EL HTML (ids):", missing);
    alert("Error: faltan elementos en el HTML. Mirá consola (F12).");
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
  const isDowntime = (op) => !NON_DOWNTIME_CODES.has(op);
  const sameDowntime = (a,b) => a && b && String(a.opcion)===String(b.opcion) && String(a.texto||"")===String(b.texto||"");

  let selected = null;

  /* ================= STORAGE POR LEGAJO ================= */
  const LS_PREFIX = "prod_state_v1";
  const LS_QUEUE  = "prod_queue_v1";

  function legajoKey() {
    return String(legajoInput.value || "").trim();
  }

  function stateKeyFor(legajo) {
    return `${LS_PREFIX}::${todayKeyAR()}::${String(legajo).trim()}`;
  }

  function freshState() {
    return { lastMatrix:null, lastCajon:null, lastDowntime:null, last2:[] };
  }

  function readStateForLegajo(legajo) {
    try {
      const raw = localStorage.getItem(stateKeyFor(legajo));
      if (!raw) return freshState();
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return freshState();
      s.last2 = Array.isArray(s.last2) ? s.last2 : [];
      s.lastMatrix = s.lastMatrix || null;
      s.lastCajon = s.lastCajon || null;
      s.lastDowntime = s.lastDowntime || null;
      return s;
    } catch {
      return freshState();
    }
  }

  function writeStateForLegajo(legajo, state) {
    localStorage.setItem(stateKeyFor(legajo), JSON.stringify(state));
  }

  /* ================= COLA PENDIENTES ================= */
  function readQueue() {
    try {
      const raw = localStorage.getItem(LS_QUEUE);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function writeQueue(arr) {
    localStorage.setItem(LS_QUEUE, JSON.stringify(arr.slice(-50)));
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

  /* ================= UI: RESUMEN ================= */
  function renderSummary() {
    const leg = legajoKey();

    if (!leg) {
      daySummary.className = "history-empty";
      daySummary.innerText = "Ingresá tu legajo para ver el resumen";
      return;
    }

    const s = readStateForLegajo(leg);
    const qLen = queueLength();

    const renderItem = (title, item) => {
      if (!item) return `<div class="day-item"><div class="t1">${title}</div><div class="t2">—</div></div>`;
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

    const renderLast2 = (arr) => {
      if (!arr || !arr.length) return `<div class="day-item"><div class="t1">Últimos 2 mensajes del día</div><div class="t2">—</div></div>`;
      return `
        <div class="day-item">
          <div class="t1">Últimos 2 mensajes del día</div>
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

    daySummary.className = "";
    daySummary.innerHTML = [
      qLen ? `<div class="day-item"><div class="t1">Pendientes de envío</div><div class="t2"><b>${qLen}</b></div></div>` : "",
      renderItem("Última Matriz (E)", s.lastMatrix),
      renderItem("Último Cajón (C)", s.lastCajon),
      renderLast2(s.last2),
      renderItem("Último Tiempo Muerto", s.lastDowntime),
    ].join("");
  }

  function renderMatrizInfoForCajon() {
    const leg = legajoKey();
    if (!leg || !selected || selected.code !== "C") {
      matrizInfo.classList.add("hidden");
      matrizInfo.innerHTML = "";
      return;
    }

    const s = readStateForLegajo(leg);
    const lm = s.lastMatrix;

    matrizInfo.classList.remove("hidden");
    if (!lm || !lm.texto) {
      matrizInfo.innerHTML = `⚠️ No hay matriz registrada hoy.<br><small>Enviá primero "E (Empecé Matriz)"</small>`;
      return;
    }

    matrizInfo.innerHTML =
      `Matriz en uso: <span style="font-size:22px;">${lm.texto}</span>
       <small>Última matriz: ${lm.ts ? formatDateTimeAR(lm.ts) : ""}</small>`;
  }

  /* ================= RENDER OPCIONES ================= */
  function renderOptions() {
    row1.innerHTML=""; row2.innerHTML=""; row3.innerHTML="";
    OPTIONS.forEach(o=>{
      const d=document.createElement("div");
      d.className="box";
      d.innerHTML=`<div class="box-title">${o.code}</div><div class="box-desc">${o.desc}</div>`;
      d.addEventListener("click",()=>selectOption(o));
      (o.row===1?row1:o.row===2?row2:row3).appendChild(d);
    });
  }

  /* ================= NAVEGACIÓN ================= */
  function goToOptions() {
    if (!legajoKey()) { alert("Ingresá el número de legajo"); return; }
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

  /* ================= REGLAS Hs Inicio ================= */
  function computeHsInicioForC(state) {
    if (state.lastCajon && state.lastCajon.ts) return state.lastCajon.ts;
    if (state.lastMatrix && state.lastMatrix.ts) return state.lastMatrix.ts;
    return "";
  }

  /* ================= VALIDACIÓN TIEMPO MUERTO ================= */
  function validateBeforeSend(legajo, payload) {
    const s = readStateForLegajo(legajo);
    const ld = s.lastDowntime;
    if (!ld) return { ok:true };
    if (!isDowntime(payload.opcion)) return { ok:true };

    if (!sameDowntime(ld, payload)) {
      return { ok:false, msg:`Hay un "Tiempo Muerto" pendiente (${ld.opcion}${ld.texto ? " " + ld.texto : ""}).\nSolo podés enviar el MISMO tiempo muerto, o enviar E / C / Perm / RM / RD.` };
    }
    return { ok:true, isSecondSameDowntime:true, downtimeTs: ld.ts || "" };
  }

  /* ================= ACTUALIZAR ESTADO ================= */
  function updateStateAfterSend(legajo, payload) {
    const s = readStateForLegajo(legajo);
    const item = { opcion:payload.opcion, descripcion:payload.descripcion, texto:payload.texto||"", ts:payload.tsEvent };

    s.last2.unshift(item);
    s.last2 = s.last2.slice(0,2);

    if (payload.opcion === "E") {
      if (s.lastMatrix && String(s.lastMatrix.texto||"") !== String(item.texto||"")) {
        s.lastCajon = null;
      }
      s.lastMatrix = item;
      s.lastDowntime = null;
      writeStateForLegajo(legajo, s);
      return;
    }

    if (payload.opcion === "C") {
      s.lastCajon = item;
      s.lastDowntime = null;
      writeStateForLegajo(legajo, s);
      return;
    }

    if (NON_DOWNTIME_CODES.has(payload.opcion)) {
      s.lastDowntime = null;
      writeStateForLegajo(legajo, s);
      return;
    }

    if (isDowntime(payload.opcion)) {
      if (!s.lastDowntime) s.lastDowntime = item;
      else if (sameDowntime(s.lastDowntime, payload)) s.lastDowntime = null;
      else s.lastDowntime = item;
      writeStateForLegajo(legajo, s);
      return;
    }

    writeStateForLegajo(legajo, s);
  }

  /* ================= ENVÍO ================= */
  async function postToSheet(payload) {
    return fetch(GOOGLE_SHEET_WEBAPP_URL, {
      method:"POST",
      headers:{ "Content-Type":"text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      mode:"no-cors",
      keepalive:true
    });
  }

  // ✅ FIX DUPLICADOS: candado
  let isFlushing = false;

  async function flushQueueOnce() {
    if (isFlushing) return;
    isFlushing = true;

    try {
      const q = readQueue();
      if (!q.length) return;

      const item = q[0];
      await postToSheet(item);
      dequeueOne();
    } catch (e) {
      // queda pendiente
    } finally {
      isFlushing = false;
      renderSummary();
    }
  }

  async function sendFast() {
    if (!selected) return;

    const legajo = legajoKey();
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
      "Hs Inicio": ""
    };

    // ✅ ID único del evento (sirve para dedupe futuro)
    payload.eventId = `${payload.legajo}|${payload.opcion}|${payload.texto||""}|${payload.tsEvent}`;

    const stateBefore = readStateForLegajo(legajo);

    // ✅ Bloqueo: no permitir C si no hay matriz
    if (payload.opcion === "C") {
      if (!stateBefore.lastMatrix || !stateBefore.lastMatrix.ts) {
        alert('Primero tenés que enviar "E (Empecé Matriz)" antes de registrar un Cajón.');
        return;
      }
      payload["Hs Inicio"] = computeHsInicioForC(stateBefore);
    }

    const v = validateBeforeSend(legajo, payload);
    if (!v.ok) { alert(v.msg); return; }

    // ✅ 2da vez del mismo TM: Hs Inicio = ts del TM pendiente
    if (v.isSecondSameDowntime) {
      payload["Hs Inicio"] = v.downtimeTs || "";
    }

    btnEnviar.disabled = true;
    const prev = btnEnviar.innerText;
    btnEnviar.innerText = "Enviando...";

    // 1) Actualizo estado local YA
    updateStateAfterSend(legajo, payload);
    renderSummary();

    // 2) Vuelvo YA
    resetSelection();
    optionsScreen.classList.add("hidden");
    legajoScreen.classList.remove("hidden");

    // 3) Encolo + intento enviar 1
    enqueue(payload);
    flushQueueOnce();

    setTimeout(() => {
      btnEnviar.disabled = false;
      btnEnviar.innerText = prev;
    }, 250);
  }

  /* ================= EVENTOS ================= */
  btnContinuar.addEventListener("click", goToOptions);
  btnBackTop.addEventListener("click", backToLegajo);
  btnBackLabel.addEventListener("click", backToLegajo);
  btnResetSelection.addEventListener("click", resetSelection);
  btnEnviar.addEventListener("click", sendFast);
  legajoInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") goToOptions(); });

  let legajoTimer = null;
  legajoInput.addEventListener("input", () => {
    clearTimeout(legajoTimer);
    legajoTimer = setTimeout(renderSummary, 120);
  });

  window.addEventListener("focus", () => flushQueueOnce());

  /* ================= INIT ================= */
  renderOptions();
  renderSummary();

  console.log("app.js OK ✅ (estado por legajo + no duplicados + Hs Inicio)");
});
