const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbx2geVAhLh3h4wlDU9DqbKWqJ42OW1yI8cPP9c3kFfoiLRblqPZxm-8tgPSfJXKgps/exec";

/* ========= UTIL TIEMPO (MISMO RELOJ PARA TODO) ========= */
function isoNowSeconds() {
  const d = new Date();
  d.setMilliseconds(0);
  return d.toISOString();
}

/* ========= ELEMENTOS ========= */
const legajoInput = document.getElementById("legajoInput");
const daySummary  = document.getElementById("daySummary");
const error       = document.getElementById("error");

/* ========= OPCIONES ========= */
const OPTIONS = [
  {code:"E",desc:"Empecé Matriz"},
  {code:"C",desc:"Cajón"},
  {code:"PB",desc:"Paré Baño"},
  {code:"BC",desc:"Busqué Cajón"},
  {code:"MOV",desc:"Movimiento"},
  {code:"LIMP",desc:"Limpieza"},
  {code:"Perm",desc:"Permiso"},
  {code:"AL",desc:"Ayuda Logística"},
  {code:"PR",desc:"Paré Carga Rollo"},
  {code:"CM",desc:"Cambiar Matriz"},
  {code:"RM",desc:"Rotura Matriz"},
  {code:"PC",desc:"Paré Comida"},
  {code:"RD",desc:"Rollo Fleje Doblado"}
];

const NON_DOWNTIME_CODES = new Set(["E","C","Perm","RM","RD"]);

/* ========= COOKIES DEL DÍA ========= */
const COOKIE_NAME = "prod_day_state_v3";
const COOKIE_DAYS = 365;

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + (days*24*60*60*1000));
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function getCookie(name){
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for(const c of cookies){
    const [k,...r]=c.split("=");
    if(k===name) return decodeURIComponent(r.join("="));
  }
  return "";
}
function todayKeyAR(){
  return new Date().toLocaleDateString("es-AR",{timeZone:"America/Argentina/Buenos_Aires"});
}
function freshDayState(){
  return {dayKey:todayKeyAR(),lastMatrix:null,lastCajon:null,last2:[],lastDowntime:null};
}
function readState(){
  try{
    const raw=getCookie(COOKIE_NAME);
    if(!raw) return freshDayState();
    const o=JSON.parse(raw);
    if(o.dayKey!==todayKeyAR()) return freshDayState();
    return o;
  }catch{return freshDayState();}
}
function writeState(s){setCookie(COOKIE_NAME,JSON.stringify(s),COOKIE_DAYS);}

function isDowntime(p){return !NON_DOWNTIME_CODES.has(p.opcion);}
function sameDowntime(a,b){return a&&b&&a.opcion===b.opcion&&(a.texto||"")===(b.texto||"");}

/* ========= VALIDACIÓN ========= */
function validateBeforeSend(payload){
  const s=readState();
  const ld=s.lastDowntime;
  if(!ld) return {ok:true};
  if(!isDowntime(payload)) return {ok:true};
  if(!sameDowntime(ld,payload)){
    return {ok:false,msg:`Tiempo muerto pendiente (${ld.opcion}). Repetí el mismo o enviá E/C/Perm/RM/RD`};
  }
  return {ok:true,isSecondSameDowntime:true,downtimeTs:ld.ts};
}

/* ========= ENVÍO ========= */
async function send(payload){
  const v=validateBeforeSend(payload);
  if(!v.ok){alert(v.msg);return;}

  try{
    await fetch(GOOGLE_SHEET_WEBAPP_URL,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify(payload),
      mode:"no-cors"
    });

    const s=readState();
    const item={...payload,ts:payload.tsEvent};

    s.last2.unshift(item);
    s.last2=s.last2.slice(0,2);

    if(payload.opcion==="E"){
      if(s.lastMatrix && s.lastMatrix.texto!==item.texto){s.lastCajon=null;}
      s.lastMatrix=item;
      s.lastDowntime=null;
    }
    if(payload.opcion==="C"){
      s.lastCajon=item;
      s.lastDowntime=null;
    }
    if(NON_DOWNTIME_CODES.has(payload.opcion) && payload.opcion!=="E" && payload.opcion!=="C"){
      s.lastDowntime=null;
    }
    if(isDowntime(payload)){
      if(!s.lastDowntime) s.lastDowntime=item;
      else if(sameDowntime(s.lastDowntime,payload)) s.lastDowntime=null;
    }

    writeState(s);
    alert("Registro enviado correctamente");
  }catch(e){
    error.innerText="No se pudo enviar";
    console.log(e);
  }
}

/* ========= EJEMPLO DE USO ========= */
// EJEMPLO: enviar E con número 15
function ejemploEnviar(){
  const ts=isoNowSeconds();
  send({legajo:"1",opcion:"E",descripcion:"Empecé Matriz",texto:"15",tsEvent:ts,tInicio:""});
}
