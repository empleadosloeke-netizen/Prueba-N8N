document.addEventListener("DOMContentLoaded", () => {

  const GOOGLE_SHEET_WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbx2geVAhLh3h4wlDU9DqbKWqJ42OW1yI8cPP9c3kFfoiLRblqPZxm-8tgPSfJXKgps/exec";

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
    return new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }); // dd/mm/aaaa
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

  // Validación rápida: si falta algún id, lo muestra
  const required = {
    legajoScreen, optionsScreen, legajoInput, daySummary,
    row1, row2, row3,
    selectedArea, selectedBox, selectedDesc, inputArea, inputLabel, textInput, error,
    btnContinuar, btnBackTop, btnBackLabel, btnResetSelection, btnEnviar
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

  // “No tiempo muerto”
  const NON_DOWNTIME_CODES = new Set(["E","C","Perm","RM","RD"]);

  function isDowntime(payload) {
    return !NON_DOWNTIME_CODES.has(payload.opcion);
  }

  function sameDowntime(a, b) {
    if (!a || !b) return false;
    // “mismo tiempo muerto” = misma opcion + mismo texto
    return String(a.opcion) === String(b.opcion) && String(a.texto || "") === String(b.texto || "");
  }

  let selected = null;

  /* ================= COOKIES (REAL) ================= */
  const COOKIE_NAME = "prod_day_state_v5";
  const COOKIE_DAYS = 365;

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24*60*60*1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; ${expires}; path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split("; ") : [];
    for (const c of cookies) {
      const [k, ...rest] = c.split("=");
      if (k === name) return decodeURIComponent(rest.join("="));
    }
    return "";
  }

  function freshDayState() {
    return {
      dayKey: todayKeyAR(),
      lastMatrix: null,     // {opcion, descripcion, texto, ts}
      lastCajon: null,      // {opcion, descripcion, texto, ts}
      last2: [],            // últimos 2 mensajes del día (cualquier opción)
      lastDowntime: null    // último tiempo muerto pendiente
    };
  }

  function readState() {
    try {
      const raw = getCookie(COOKIE_NAME);
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
    setCookie(COOKIE_NAME, JSON.stringify(state), COOKIE_DAYS);
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
            <div style="margin-top:6px;color:#a15c00;">
              Solo podés repetir el mismo tiempo muerto (2da vez) o enviar E/C/Perm/RM/RD.
            </div>
          </div>
        </div>`;
    };

    daySummary.className = "";
    daySummary.innerHTML = [
      block("Última Matriz (E)", s.lastMatrix),
      block("Último Cajón (C)", s.lastCajon),
      last2Block("Últimos 2 mensajes del día", s.last2),
      downtimeBlock("Último Tiempo Muerto", s.lastDowntime),
    ].join("");
  }

  // refresco suave al tipear
  let legajoTimer = null;
  legajoInput.addEventListener("input", () => {
    clearTimeout(legajoTimer);
    legajoTimer = setTimeout(renderSummary, 150);
  });

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
  }

  function resetSelection() {
    selected = null;
    selectedArea.classList.add("hidden");
    error.innerText = "";
    textInput.value = "";
  }

  /* ================= REGLAS: TInicio ================= */
  function computeTInicioForC(state) {
    // Si cookie de último cajón no está vacía => enviar tiempo del cookie del último cajón
    if (state.lastCajon && state.lastCajon.ts) return state.lastCajon.ts;
    // Si cookie de último cajón está vacía => enviar tiempo del cookie de la última matriz
    if (state.lastMatrix && state.lastMatrix.ts) return state.lastMatrix.ts;
    return "";
  }

  /* ================= VALIDACIÓN TIEMPO MUERTO ================= */
  function validateBeforeSend(payload) {
    const state = readState();
    const ld = state.lastDowntime;

    if (!ld) return { ok: true };

    // si lo que envío NO es downtime => permitido
    if (!isDowntime(payload)) return { ok: true };

    // si es downtime y es distinto => bloquear
    if (!sameDowntime(ld, payload)) {
      return {
        ok: false,
        msg:
          `Hay un "Tiempo Muerto" pendiente (${ld.opcion}${ld.texto ? " " + ld.texto : ""}).\n` +
          `Solo podés enviar el MISMO tiempo muerto, o enviar E / C / Perm / RM / RD.`
      };
    }

    // es el mismo => esto es “segunda vez”
    return { ok: true, isSecondSameDowntime: true, downtimeTs: ld.ts || "" };
  }

  /* ================= ENVÍO ================= */
  async function send() {
    if (!selected) return;

    const legajo = String(legajoInput.value || "").trim();
    if (!legajo) {
      alert("Ingresá el número de legajo");
      return;
    }

    const texto = String(textInput.value || "").trim();

    if (selected.input.show && !selected.input.validate.test(texto)) {
      error.innerText = "Solo se permiten números";
      return;
    }

    const tsEvent = isoNowSeconds(); // ✅ timestamp unificado

    // armo payload
    const payload = {
      legajo,
      opcion: selected.code,
      descripcion: selected.desc,
      texto,
      tsEvent,   // ✅ el Apps Script usa esto para Fecha/Hora
      tInicio: "" // ISO (Apps Script lo formatea a HH:mm:ss)
    };

    const stateBefore = readState();

    // TInicio para Cajón (C)
    if (payload.opcion === "C") {
      payload.tInicio = computeTInicioForC(stateBefore);
    }

    // Validación tiempo muerto (detecta 2da vez)
    const v = validateBeforeSend(payload);
    if (!v.ok) {
      alert(v.msg);
      return;
    }

    // Si es 2da vez del mismo tiempo muerto => TInicio = ts del cookie del downtime
    if (v.isSecondSameDowntime) {
      payload.tInicio = v.downtimeTs || "";
    }

    try {
      await fetch(GOOGLE_SHEET_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        mode: "no-cors"
      });

      // Actualizo cookies (mismo tsEvent para todo)
      const s = readState();
      const item = {
        opcion: payload.opcion,
        descripcion: payload.descripcion,
        texto: payload.texto || "",
        ts: payload.tsEvent
      };

      // últimos 2 mensajes
      s.last2.unshift(item);
      s.last2 = s.last2.slice(0, 2);

      // regla E: si es distinto al anterior, borrar último cajón
      if (payload.opcion === "E") {
        if (s.lastMatrix && String(s.lastMatrix.texto||"") !== String(item.texto||"")) {
          s.lastCajon = null;
        }
        s.lastMatrix = item;
        // E limpia downtime pendiente
        s.lastDowntime = null;
      }

      // C actualiza cajón y limpia downtime
      if (payload.opcion === "C") {
        s.lastCajon = item;
        s.lastDowntime = null;
      }

      // Perm/RM/RD limpian downtime
      if (NON_DOWNTIME_CODES.has(payload.opcion) && payload.opcion !== "E" && payload.opcion !== "C") {
        s.lastDowntime = null;
      }

      // Si es downtime:
      if (isDowntime(payload)) {
        if (!s.lastDowntime) {
          // primera vez => queda pendiente
          s.lastDowntime = item;
        } else if (sameDowntime(s.lastDowntime, payload)) {
          // segunda vez => limpiar
          s.lastDowntime = null;
        } else {
          // no debería pasar por la validación
          s.lastDowntime = item;
        }
      }

      writeState(s);
      renderSummary();

      alert("Registro enviado correctamente");

      resetSelection();
      optionsScreen.classList.add("hidden");
      legajoScreen.classList.remove("hidden");

    } catch (e) {
      console.log("FETCH ERROR:", e);
      error.innerText = "No se pudo enviar. Revisá WiFi.";
    }
  }

  /* ================= EVENTOS ================= */
  btnContinuar.addEventListener("click", goToOptions);
  btnBackTop.addEventListener("click", backToLegajo);
  btnBackLabel.addEventListener("click", backToLegajo);
  btnResetSelection.addEventListener("click", resetSelection);
  btnEnviar.addEventListener("click", send);
  legajoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") goToOptions(); });

  /* ================= INIT ================= */
  renderOptions();
  renderSummary();
  console.log("app.js cargado OK ✅ (cookies activas)");

});
