"use strict";

/* ============================================================
 * PoliGol — cliente v1.4 (vanilla JS, sin dependencias).
 *
 * v1.4 — FÍSICA ESTILO HAXBALL (SPEC v1.4, PISA la física previa):
 *   física         — window.PoliPhysics (physics-core.js, cargado por index.html
 *                    ANTES de client.js): ÚNICA fuente de la física. El cliente NO
 *                    redefine fórmulas/constantes — usa buildArena / stepWorld /
 *                    goalCheck / makeBody / makeBall. Se ELIMINÓ la sim local vieja
 *                    (simSelfStep, dribble assist, kick direccional, constantes
 *                    duplicadas).
 *   extrapolación  — MUNDO COMPLETO (SPEC H): se mantiene el último snapshot
 *                    autoritativo (baseState) y cada frame se clona y se corre
 *                    stepWorld `ext` ticks aplicando los inputs reales propios y el
 *                    último input (neutro) de los rivales; la pelota se simula con
 *                    todos (tu kick la mueve YA). ext = clamp(round(RTT/2/16.67)+1,
 *                    1, 12), configurable con #opt-extrapolation (Auto / 0–200 ms;
 *                    0 = interpolación del pasado). Reconciliación POR DISCO (pelota
 *                    incluida): offset que decae ~120 ms, snap si error > 60 u.
 *   kick MANTENIDO — estado mantenido en TODOS los esquemas (SPEC J): teclado
 *                    Espacio/J (no-duo) y F/L (duo) mantenidos; táctil botón ⚽
 *                    mantenido mientras el dedo está sobre él; táctil duo: dedo en
 *                    la zona sin arrastrar = kick mantenido, arrastrar = mover.
 *                    Input inmediato al apretar Y al soltar (flanco de bajada).
 *   barrida        — opcional por sala (rules.tackles): #rule-tackles (host). Si
 *                    está off, se ocultan botón/leyendas de barrida. Tackle edge.
 *   render         — postes (discos claros r8) desde la geometría del núcleo;
 *                    indicador de kick armado (aro/tinte) en el cuerpo propio;
 *                    pelota/cuerpos con las velocidades nuevas (u/tick).
 *   state v1.4     — u/tick 2 decimales, ka/kc(ticks)/kh por cuerpo propio, lt en
 *                    la pelota; eventos {type:"kicked"}; feedback local inmediato.
 *
 * Se CONSERVA todo lo de v1.3: modos ffa/1v1/2v2/duo, objetivo goles/tiempo, gol de
 * oro, estadios, salas públicas por push, relator + packs de voz, métricas/ping,
 * scoreboard por equipo, botines/halos A·B y "②", joysticks dinámicos, etc.
 *
 * --- Historial (v1.2/v1.3, la física quedó reemplazada por v1.4) ---
 * ETAPA 1 v1.2 — PREDICCIÓN, NETCODE Y SALAS (SPEC A/C/F):
 *   predicción     — simulación local del PROPIO jugador idéntica al server
 *                    (ACCEL 1600 / FRICTION 7.5 / MAX_SPEED 230 + confinamiento
 *                    + stun/slide), pendingInputs con seq, reconciliación con
 *                    iq, offset de corrección que decae ~120 ms (snap > 80 u)
 *   input          — envío INMEDIATO al cambiar (cap 60/s) + keepalive 20 Hz,
 *                    seq incremental por conexión; feedback local de
 *                    patada/barrida al presionar (anim + SFX, KICK_RANGE 44)
 *   interpolación  — delay ADAPTATIVO 50–160 ms (snapInterval×1.5 + jitter,
 *                    ventana ~20 llegadas) para pelota y rivales
 *   ping           — {ping,t}→{pong,t} cada 2 s → #ping-indicator con
 *                    .ping-good/.ping-mid/.ping-bad
 *   salas          — subRooms on/off (push del server), re-suscripción en
 *                    visibilitychange, refresh manual SIN document.hidden,
 *                    badge "Tu sala" (.room-card.mine)
 *
 * v1.1 (se mantiene): pantallas home/lobby/juego, lobby v2 (ready / modo /
 * estadio / equipos / countdown), scoreboard por EQUIPO, perfil y settings
 * en localStorage, joystick dinámico, fullscreen+landscape y vibración.
 *
 * ETAPA 2: render, FX y audio v1.1 (todos los hooks implementados).
 *   drawPlayerFeet — botines con zancada por distancia + pose/polvito de barrida
 *   stadiumTheme   — 4 paletas (clásico/noche/playa/nieve) con estrellas,
 *                    reflectores, sombrillas, arena moteada y copos animados
 *   FX             — squash de pelota al patear, screen-shake de gol (4 px/200 ms),
 *                    estela + polvo de slide, settings.fx respetado en partículas
 *   SFX (WebAudio) — pop de patada, slide-whistle+boing, bocina+ovación, doink
 *                    con rate-limit, beeps de cuenta, fanfarria kazoo (× volumen)
 *   commentator    — relator speechSynthesis es-AR>es-419>es-MX>es-US>es-ES>es*
 *
 * ETAPA 2 v1.2 — PACKS DE VOZ (SPEC D):
 *   voice pack     — public/voices/manifest.json (fetch único al entrar al
 *                    juego, 404 silencioso) → clips ArrayBuffer→AudioBuffer
 *                    reproducidos por masterGain (volumen/mute EN VIVO);
 *                    eventos start/goal/owngoal/tackle/streak/win mapeados
 *                    1:1 con el sintético, no-solapado (solo gol/campeón
 *                    pisan), fallback speechSynthesis POR EVENTO,
 *                    #relator-pack-label con el nombre del pack activo
 *
 * v1.3 — USUARIOS vs CUERPOS + OBJETIVO DE PARTIDO (SPEC v1.3 A/B/C/D):
 *   duo            — cada usuario controla DOS cuerpos (slot 0 = A, 1 = B);
 *                    start trae {id,name,country,team,owner,slot} por cuerpo
 *   predicción ×2  — la MISMA sim local v1.2 generalizada a N cuerpos propios
 *                    (selfPred); pendingInputs = {seq, a:{mx,my}, b:{mx,my}, dt};
 *                    un solo seq por mensaje, iq compartido, corr por cuerpo
 *   input duo      — {type:"input", seq, mx,my,kick,tackle, b:{...}} inmediato
 *                    al cambiar (cap 60/s) + keepalive 20 Hz; táctil: DOS zonas
 *                    (mitades) con joystick dinámico independiente por zona,
 *                    TAP (<220 ms, <12 px) = patear, DOBLE TAP (≤300 ms) =
 *                    barrer, botones ⚽/🦵 ocultos solo en duo; teclado: A =
 *                    WASD+F/G, B = flechas+L/K (+ hint #duo-keys-hint 3 s)
 *   setMatch       — #match-target-select / #match-value-select (whitelists
 *                    goals 1/3/5/10, time 120/180/300/600), chip "a N goles" /
 *                    "N min" en cards de salas y lobby
 *   timer          — #match-clock mm:ss con state.tl (solo target=time);
 *                    {type:"golden"} ⇒ overlay 2 s + reloj "GOL DE ORO"
 *                    pulsante; gameover.reason ("golden"/"time") como
 *                    subtítulo del campeón
 *   identidad      — halo dorado en el cuerpo A propio, plateado + "②" en el
 *                    B; relator/feedback/scoreboard hablan del USUARIO dueño
 *   En modos NO-duo todo queda exactamente como v1.2.
 * ============================================================ */

/* ================= Núcleo de física compartido (v1.4 HaxBall) =================
 * window.PoliPhysics (physics-core.js, cargado por index.html ANTES de este
 * script). Es la ÚNICA fuente de la física: el cliente NO redefine fórmulas ni
 * constantes — usa buildArena / stepWorld / goalCheck / makeBody / makeBall y las
 * constantes (PLAYER_R, BALL_R, R, GOAL_W, KICK_REACH, etc.). La extrapolación de
 * mundo completo (SPEC v1.4 H) corre stepWorld idéntico al server. */
const PHYS = (typeof window !== "undefined" && window.PoliPhysics) || null;
if (!PHYS) {
  // Sin el núcleo no hay física: avisar fuerte en consola (deploy mal armado).
  // eslint-disable-next-line no-console
  console.error("PoliGol: physics-core.js no cargó — window.PoliPhysics ausente.");
}

/* ================= Constantes compartidas (= physics-core.js) ================= */
// Tomadas del núcleo para que el render y los alcances coincidan con la física.
const R = PHYS ? PHYS.R : 380;                 // circunradio del polígono (u de mundo)
const PLAYER_R = PHYS ? PHYS.PLAYER_R : 15;    // radio del jugador (v1.4: 15)
const BALL_R = PHYS ? PHYS.BALL_R : 10;        // radio de la pelota
const GOAL_W = PHYS ? PHYS.GOAL_W : 112;       // ancho del arco
const RECT_W = PHYS ? PHYS.RECT_W : 480;       // half-extent horizontal para n = 2
const RECT_H = PHYS ? PHYS.RECT_H : 290;       // half-extent vertical para n = 2
const POST_R = PHYS ? PHYS.POST_R : 8;         // radio del poste (render de palos)
const KICK_REACH = PHYS ? PHYS.KICK_REACH : 4; // alcance del kick: dist − BALL_R − PLAYER_R < esto
const WIN_SCORE = 3;        // puntaje objetivo por defecto (target=goals)

/* ======================= Constantes propias del cliente ======================= */
const WORLD_MARGIN = 70;    // margen alrededor del bounding del polígono (SPEC render)
const JOY_RADIUS = 38;      // px de recorrido máximo del stick del joystick
const ROOM_NAME_MAX = 24;   // largo máximo del nombre de sala (SPEC)
// Netcode v1.2 → v1.4 (SPEC A/H)
const INPUT_MIN_GAP_MS = 1000 / 60; // cap de 60 mensajes de input por segundo
const KEEPALIVE_MS = 50;    // keepalive de input a 20 Hz mientras se juega
const PING_MS = 2000;       // ping cada 2 s → #ping-indicator
// v1.4 H: reconciliación por disco. El offset de corrección decae ~120 ms; un
// error enorme se resuelve con snap directo (> CORR_SNAP, ahora 60 u por SPEC H).
const CORR_DECAY = 25;      // 1/s: el offset de corrección decae a ~5% en 120 ms
const CORR_SNAP = 60;       // u: corrección mayor que esto ⇒ snap directo (SPEC v1.4 H)
const TICK_MS = 1000 / 60;  // duración de un tick (16.67 ms) — extrapolación adaptativa
const EXT_MAX = 12;         // tope de ticks de extrapolación (≈ 200 ms, SPEC v1.4 H)
const INTERP_MIN = 50;      // ms — piso del delay adaptativo (modo ext = 0)
const INTERP_MAX = 160;     // ms — techo del delay adaptativo (modo ext = 0)
const ARRIVALS_WINDOW = 20; // ~20 llegadas de snapshots para snapInterval + jitter
const SNAP_GAP_CAP = 400;   // ms: un gap outlier (pestaña oculta) no rompe la media
const PROFILE_KEY = "poligol.profile";   // localStorage: { name, country }
const SETTINGS_KEY = "poligol.settings"; // localStorage: { sound, relator, fx, vibration, names }
// v1.3 (SPEC C) — gestos táctiles del modo duo
const TAP_MS = 220;          // tap: duración máxima
const TAP_MOVE_PX = 12;      // tap: desplazamiento máximo (y umbral de arrastre en duo)
const DOUBLE_TAP_MS = 300;   // segundo tap ≤ 300 ms del primero ⇒ barrida
// v1.3 (SPEC D) — objetivo de partido configurable (whitelists del SPEC)
const MATCH_GOALS_VALUES = [1, 3, 5, 10];        // target = "goals"
const MATCH_TIME_VALUES = [120, 180, 300, 600];  // target = "time" (segundos)
const MATCH_GOALS_DEFAULT = 3;                   // default del SPEC
const MATCH_TIME_DEFAULT = 180;                  // default local al pasar a "time"

const MODE_LABELS = { ffa: "Todos contra todos", "1v1": "1 vs 1", "2v2": "2 vs 2", duo: "Dúo" };
const STADIUM_LABELS = { clasico: "Clásico", noche: "Noche", playa: "Playa", nieve: "Nieve" };

/* ================================ Selecciones ================================ */
// code ISO-2 mayúsculas, nombre en español, colores de camiseta {c1, c2}.
const COUNTRIES = [
  { code: "AR", name: "Argentina", c1: "#75aadb", c2: "#ffffff" },
  { code: "BR", name: "Brasil", c1: "#ffdf00", c2: "#009c3b" },
  { code: "UY", name: "Uruguay", c1: "#55b5e5", c2: "#0b1e3c" },
  { code: "CL", name: "Chile", c1: "#d52b1e", c2: "#ffffff" },
  { code: "CO", name: "Colombia", c1: "#fcd116", c2: "#003893" },
  { code: "MX", name: "México", c1: "#006847", c2: "#ffffff" },
  { code: "US", name: "Estados Unidos", c1: "#3c3b6e", c2: "#ffffff" },
  { code: "ES", name: "España", c1: "#aa151b", c2: "#f1bf00" },
  { code: "FR", name: "Francia", c1: "#0055a4", c2: "#ffffff" },
  { code: "DE", name: "Alemania", c1: "#ffffff", c2: "#000000" },
  { code: "IT", name: "Italia", c1: "#0066b2", c2: "#ffffff" },
  { code: "PT", name: "Portugal", c1: "#e42518", c2: "#046a38" },
  { code: "GB", name: "Inglaterra", c1: "#ffffff", c2: "#ce1124" },
  { code: "NL", name: "Países Bajos", c1: "#f36c21", c2: "#ffffff" },
  { code: "BE", name: "Bélgica", c1: "#e30613", c2: "#000000" },
  { code: "HR", name: "Croacia", c1: "#ff2a2a", c2: "#ffffff" },
  { code: "JP", name: "Japón", c1: "#19357c", c2: "#ffffff" },
  { code: "KR", name: "Corea del Sur", c1: "#cd2e3a", c2: "#ffffff" },
  { code: "SA", name: "Arabia Saudita", c1: "#006c35", c2: "#ffffff" },
  { code: "MA", name: "Marruecos", c1: "#c1272d", c2: "#006233" },
  { code: "NG", name: "Nigeria", c1: "#008751", c2: "#ffffff" },
  { code: "SN", name: "Senegal", c1: "#00853f", c2: "#fdef42" },
  { code: "AU", name: "Australia", c1: "#ffb81c", c2: "#00843d" },
  { code: "CA", name: "Canadá", c1: "#ff0000", c2: "#ffffff" },
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

// Bandera emoji desde el código ISO-2 (Regional Indicators, fórmula del SPEC).
function flagOf(code) {
  let out = "";
  for (const ch of code) out += String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65);
  return out;
}

function countryInfo(code) {
  return COUNTRY_BY_CODE.get(code) || { code, name: code, c1: "#9fb0c8", c2: "#ffffff" };
}

/* ================================= DOM refs ================================= */
const $ = (id) => document.getElementById(id);

// addEventListener tolerante a elementos ausentes (deploys parciales del HTML).
function on(el, type, fn, opts) {
  if (el) el.addEventListener(type, fn, opts);
}

// Home
const screenHome = $("screen-home");
const screenLobby = $("screen-lobby");
const screenGame = $("screen-game");
const nameInput = $("name-input");
const countryGrid = $("country-grid");
const btnCreate = $("btn-create");
const roomInput = $("room-input");
const btnJoin = $("btn-join");
const roomsList = $("rooms-list");                 // v1.1
const btnRefreshRooms = $("btn-refresh-rooms");    // v1.1
const roomNameInput = $("room-name-input");        // v1.1
const visPublic = $("vis-public");                 // v1.1 (radio)
const visPrivate = $("vis-private");               // v1.1 (radio, default checked)
const btnOptions = $("btn-options");               // v1.1 (engranaje home/lobby)
// Lobby
const roomCodeLabel = $("room-code-label");
const playersList = $("players-list");
const btnStart = $("btn-start");                   // v1: en v1.1 desaparece (se oculta si quedó)
const btnLeave = $("btn-leave");
const lobbyRoomName = $("lobby-room-name");        // v1.1
const lobbyVisibilityBadge = $("lobby-visibility-badge"); // v1.1
const modeSelect = $("mode-select");               // v1.1
const stadiumSelect = $("stadium-select");         // v1.1
const teamsPanel = $("teams-panel");               // v1.1
const btnSwapTeam = $("btn-swap-team");            // v1.1
const btnReady = $("btn-ready");                   // v1.1
const btnWhatsapp = $("btn-whatsapp");             // v1.1 (<a>)
const btnCopyLink = $("btn-copy-link");            // v1.1
const lobbyCountdown = $("lobby-countdown");       // v1.1
// v1.3 (SPEC D): selects del objetivo de partido. Si el HTML aún no los trae,
// se crean dentro de .lobby-config (mismo markup que modo/estadio) para que el
// host pueda configurarlo igual; si existen en el HTML se usan tal cual.
let matchTargetSelect = $("match-target-select"); // Goles | Tiempo
let matchValueSelect = $("match-value-select");   // values según target (whitelists)
let ruleTacklesCheck = $("rule-tackles");         // v1.4 E: barrida on/off (host)
(function ensureMatchSelects() {
  const cfgBox = document.querySelector(".lobby-config");
  if (!cfgBox) return;
  if (!matchTargetSelect) {
    const field = document.createElement("div");
    field.className = "config-field";
    const lab = document.createElement("label");
    lab.className = "field-label";
    lab.htmlFor = "match-target-select";
    lab.textContent = "Objetivo";
    matchTargetSelect = document.createElement("select");
    matchTargetSelect.id = "match-target-select";
    matchTargetSelect.className = "select";
    const og = document.createElement("option");
    og.value = "goals";
    og.textContent = "🥅 Goles";
    const ot = document.createElement("option");
    ot.value = "time";
    ot.textContent = "⏱️ Tiempo";
    matchTargetSelect.append(og, ot);
    field.append(lab, matchTargetSelect);
    cfgBox.appendChild(field);
  }
  if (!matchValueSelect) {
    const field = document.createElement("div");
    field.className = "config-field";
    const lab = document.createElement("label");
    lab.className = "field-label";
    lab.htmlFor = "match-value-select";
    lab.textContent = "Hasta";
    matchValueSelect = document.createElement("select");
    matchValueSelect.id = "match-value-select";
    matchValueSelect.className = "select";
    field.append(lab, matchValueSelect);
    cfgBox.appendChild(field);
  }
  // v1.4 E: checkbox de barrida si el HTML no lo trae (mismo markup que el opt-check).
  if (!ruleTacklesCheck) {
    const field = document.createElement("div");
    field.className = "config-field config-field-rule";
    const lab = document.createElement("label");
    lab.className = "rule-toggle";
    ruleTacklesCheck = document.createElement("input");
    ruleTacklesCheck.id = "rule-tackles";
    ruleTacklesCheck.className = "opt-check";
    ruleTacklesCheck.type = "checkbox";
    ruleTacklesCheck.checked = true;
    const span = document.createElement("span");
    span.className = "field-label";
    span.textContent = "🦵 Barrida";
    lab.append(ruleTacklesCheck, span);
    field.appendChild(lab);
    cfgBox.appendChild(field);
  }
})();
// Juego
const canvas = $("game-canvas");
const scoreboardEl = $("scoreboard");
const overlayEl = $("overlay");
const btnRematch = $("btn-rematch");
const btnExit = $("btn-exit");
const joystickEl = $("touch-joystick");
const joystickStick = joystickEl ? joystickEl.querySelector(".joystick-stick") : null;
const btnKick = $("btn-kick");
const btnTackle = $("btn-tackle");
const rotateOverlay = $("rotate-overlay");         // v1.1
const btnGameOptions = $("btn-game-options");      // v1.1 (engranaje flotante en juego)
const pingIndicator = $("ping-indicator");         // v1.2 (pill RTT; puntito vía CSS ::before)
// Opciones
const optionsModal = $("options-modal");           // v1.1
const optSound = $("opt-sound");                   // v1.1 (range 0–100)
const optRelator = $("opt-relator");               // v1.1 (checkbox)
const optFx = $("opt-fx");                         // v1.1 (select low/high)
const optVibration = $("opt-vibration");           // v1.1 (checkbox)
const optNames = $("opt-names");                   // v1.1 (checkbox)
const optExtrapolation = $("opt-extrapolation");   // v1.4 H (range 0–200 ms, 0 = Auto)
const optExtrapolationLabel = $("opt-extrapolation-label"); // v1.4 H (texto Auto/N ms)
const btnOptionsClose = $("btn-options-close");    // v1.1
const relatorPackLabel = $("relator-pack-label");  // v1.2 (SPEC D): pack activo o "Voz sintética"
// Contenedores v1 (pueden cambiar en el HTML v1.1: usar con guardas)
const endgameActions = document.querySelector(".endgame-actions");
const lobbyCard = document.querySelector(".lobby-card");
const lobbyActions = document.querySelector(".lobby-actions");
const ctx = canvas.getContext("2d");

/* =========================== Settings (poligol.settings) =========================== */
// v1.4 H: `extrapolation` = ms de extrapolación forzados, o 0 = "Auto" (adaptativo
// por RTT). #opt-extrapolation (slider 0–200 ms) lo edita.
const DEFAULT_SETTINGS = {
  sound: 100, relator: true, fx: "high", vibration: true, names: true, extrapolation: 0,
};

function loadSettings() {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        if (typeof s.sound === "number" && isFinite(s.sound)) {
          out.sound = Math.max(0, Math.min(100, Math.round(s.sound)));
        }
        if (typeof s.relator === "boolean") out.relator = s.relator;
        if (s.fx === "low" || s.fx === "high") out.fx = s.fx;
        if (typeof s.vibration === "boolean") out.vibration = s.vibration;
        if (typeof s.names === "boolean") out.names = s.names;
        if (typeof s.extrapolation === "number" && isFinite(s.extrapolation)) {
          out.extrapolation = Math.max(0, Math.min(200, Math.round(s.extrapolation / 10) * 10));
        }
      }
    }
  } catch (err) {
    /* localStorage deshabilitado: usar defaults */
  }
  return out;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    /* sin persistencia */
  }
}

// Objeto global `settings` (vivo, NO reasignar) — lo leen render/audio:
// settings.sound (0–100), settings.relator, settings.fx ("low"|"high"),
// settings.vibration, settings.names.
const settings = loadSettings();
window.settings = settings;

function syncSettingsUI() {
  if (optSound) optSound.value = String(settings.sound);
  if (optRelator) optRelator.checked = settings.relator;
  if (optFx) optFx.value = settings.fx;
  if (optVibration) optVibration.checked = settings.vibration;
  if (optNames) optNames.checked = settings.names;
  if (optExtrapolation) optExtrapolation.value = String(settings.extrapolation);
  updateExtrapolationLabel(); // v1.4 H: "Auto" / "N ms"
  updateRelatorPackLabel(); // v1.2 (SPEC D): nombre del pack o "Voz sintética"
}

// Etiqueta del slider de extrapolación (#opt-extrapolation-label): 0 = "Auto".
function updateExtrapolationLabel() {
  if (!optExtrapolationLabel) return;
  const v = settings.extrapolation;
  optExtrapolationLabel.textContent = v > 0 ? v + " ms" : "Auto (≈ ½ RTT)";
}

function openOptions() {
  if (!optionsModal) return;
  syncSettingsUI();
  optionsModal.classList.remove("hidden");
}

function closeOptions() {
  if (optionsModal) optionsModal.classList.add("hidden");
}

on(btnOptions, "click", openOptions);
on(btnGameOptions, "click", openOptions);
on(btnOptionsClose, "click", closeOptions);
on(optionsModal, "click", (e) => {
  if (e.target === optionsModal) closeOptions(); // click en el backdrop
});
on(optSound, "input", () => {
  const v = parseInt(optSound.value, 10);
  settings.sound = isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
  saveSettings();
  // Aplica EN VIVO: también baja/sube los sfx que ya están sonando.
  if (masterGain) masterGain.gain.value = masterVol();
});
on(optRelator, "change", () => {
  settings.relator = !!optRelator.checked;
  saveSettings();
  // Apagar el relator también calla la frase en curso (no solo las futuras).
  if (!settings.relator) relatorStop();
});
on(optFx, "change", () => {
  settings.fx = optFx.value === "low" ? "low" : "high";
  saveSettings();
});
on(optVibration, "change", () => {
  settings.vibration = !!optVibration.checked;
  saveSettings();
});
on(optNames, "change", () => {
  settings.names = !!optNames.checked;
  saveSettings();
});
on(optExtrapolation, "input", () => {
  const v = parseInt(optExtrapolation.value, 10);
  settings.extrapolation = isFinite(v) ? Math.max(0, Math.min(200, v)) : 0;
  updateExtrapolationLabel();
  saveSettings();
});

/* ============================ Perfil (poligol.profile) ============================ */
function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      name: typeof p.name === "string" ? p.name : "",
      country: typeof p.country === "string" ? p.country : null,
    };
  } catch (err) {
    return null;
  }
}

function saveProfile(name, country) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, country }));
  } catch (err) {
    /* sin persistencia */
  }
}

/* ================================== Estado ================================== */
let ws = null;
let wsQueue = [];
let myId = null;
let hostId = null;
let roomCode = null;
// Última sala propia (NO se limpia en goHome, que anula roomCode): el badge
// "Tu sala" de #rooms-list compara contra esto. localStorage cubre el caso
// multi-pestaña del SPEC C (la sala se creó en otra pestaña del mismo navegador).
let myLastRoomCode = null;
try {
  myLastRoomCode = localStorage.getItem("poligol.lastRoom") || null;
} catch (err) {
  /* localStorage deshabilitado */
}
let selectedCountry = null;
let phase = "home";        // "home" | "lobby" | "game"
let ended = false;         // true tras gameover (hasta rematch / salir)

let lobby = null;          // { code, roomName, visibility, mode, stadium, players } (lobby v1.1)
let myReady = false;
let match = null;          // { mode, stadium, n, players, byId, teams, myTeam, walls, verts, bounds, fieldPath }
let snaps = [];            // buffer de snapshots {t, ball, players(Map), paused}
let scoreItems = [];       // team index → {root, valEl, value}
let overlayTimers = [];
let copiedTimer = 0;
let inputTimer = 0;        // keepalive de input a 20 Hz (v1.2)
// v1.4: cooldown LOCAL del feedback de barrida POR CUERPO propio (índice = slot;
// en no-duo solo se usa el slot 0). El kick ya no necesita cooldown local: el
// kickArmed del modelo (mantener) evita el doble-disparo sin gating de tiempo.
let tackleCdUntil = [0, 0];
const TACKLE_COOLDOWN_MS = (PHYS ? PHYS.TACKLE_COOLDOWN_TICKS : 96) * TICK_MS; // ≈ 1.6 s
let lobbyCountdownTimer = 0;

// Netcode v1.4 (SPEC H) — EXTRAPOLACIÓN DE MUNDO COMPLETO.
//   El cliente mantiene `baseState` = último snapshot autoritativo del server como
//   un estado de stepWorld real (bodies[] + ball, en u/tick). Cada frame clona ese
//   estado y corre stepWorld hacia adelante `ext` ticks aplicando: los inputs
//   REALES de los cuerpos propios y el último input conocido de los rivales. La
//   pelota se simula con todos (tu kick la mueve YA). El resultado se renderiza.
//   Reconciliación POR DISCO (pelota incluida): un offset visual que decae ~120 ms;
//   snap directo si el error > CORR_SNAP (60 u).
let inputSeq = 0;          // seq incremental por conexión (el primer input manda 1)
let lastSentA = { mx: 0, my: 0, kick: false }; // último input enviado del cuerpo A
let lastSentB = { mx: 0, my: 0, kick: false }; // ídem cuerpo B (solo relevante en duo)
let lastInputSendT = -1e9; // performance.now() del último input enviado (cap 60/s)
// Tackle latcheado si el cap pospuso el envío (edge-trigger, índice = slot). El
// kick NO se latchea: es estado MANTENIDO (se lee en vivo de los controles).
const queuedTackle = [false, false];

// `baseState` (mundo autoritativo). Cada cuerpo: estado completo de makeBody +
// `kh` (kickHeld efectivo del server). La pelota lleva lastTouch. `baseArena` es
// la cancha del partido (buildArena con su estadio). `extWorld` es el estado
// extrapolado del último frame, para render y para medir la corrección por disco.
let baseState = null;      // { bodies:[...], ball:{...}, rules:{tackles} } o null
let baseArena = null;      // salida de PoliPhysics.buildArena(n, stadium)
let extWorld = null;       // último mundo extrapolado renderizado (clon de baseState)
// v1.5 — Modo entrenamiento (solo, 100% client-side): corre el MISMO physics-core
// localmente a 60 Hz (sin servidor, sin latencia). Cuando training != null, el
// pipeline de render/input se alimenta de su estado local en vez de la red.
let training = null;       // { state, accMs, lastNs, goals, defenders, stadium, ... } o null
let trainingCfg = { defenders: 0, stadium: "clasico" };
// Offset de corrección por disco (id → {dx,dy}); render = extrapolado + offset, el
// offset decae a 0 en ~120 ms (anti-snap). La pelota usa la clave "__ball__".
const dragOffset = new Map();
const BALL_KEY = "__ball__";

let lastPaused = false;    // último paused del server (congela la extrapolación)
let snapArrivals = [];     // llegadas de snapshots (ventana ~20) → delay adaptativo
let interpDelay = 100;     // ms: clamp(snapInterval*1.5 + jitter, 50, 160) (modo ext=0)
let lastRttMs = 0;         // último RTT medido (ping/pong) → ticks de extrapolación
let pingTimer = 0;         // ping cada 2 s mientras la conexión esté abierta
let goalStreak = { team: null, count: 0 }; // racha para el relator (etapa 2)

// Efectos visuales
let ringFx = [];                // ondas expansivas de patada (coords de mundo)
let confetti = [];              // confetti (coords de pantalla, px CSS)
let ballTrail = [];
let ballSpin = 0;
let confettiRainUntil = 0;
let rainColors = ["#f5c542", "#ffffff"];
let lastFrameT = performance.now();

// Efectos visuales v1.1 (etapa 2)
const feetState = new Map();   // playerId → {x,y,dist,speed,lastNow} para la zancada
let dustFx = [];               // polvito de barrida (coords de mundo)
let snowflakes = [];           // copos del estadio "nieve" (px CSS de pantalla)
let nightStars = null;         // estrellas del estadio "noche" (coords normalizadas)
let shakeUntil = 0;            // screen-shake de gol (4 px, 200 ms)
let lastKickT = -1e9;          // momento de la última patada (squash de pelota)
let lastBounceMs = -1e9;       // rate-limit del "doink" de rebote

const keysDown = new Set(); // e.code crudos (v1.3: WASD y flechas se separan en duo)
// Joysticks DINÁMICOS: ox,oy = punto de pantalla donde apoyó el dedo. v1.3:
// uno por ZONA (índice 0 = mitad izquierda / cuerpo A, 1 = derecha / cuerpo B;
// en modos no-duo solo existe la zona 0, igual que v1.2). moved/startT/lastTapT
// alimentan los gestos TAP / DOBLE TAP del modo duo.
function makeJoy() {
  return {
    active: false, id: null, ox: 0, oy: 0, mx: 0, my: 0,
    moved: false, startT: 0, lastTapT: -1e9,
  };
}
const joys = [makeJoy(), makeJoy()];

// v1.3: helpers de modo duo y cuerpos propios.
function isDuo() {
  return !!(match && match.mode === "duo");
}

// Nombre del USUARIO dueño de un cuerpo (v1.3: relator, overlays y scoreboard
// hablan del usuario, no del cuerpo). En no-duo coincide con el nombre v1.2.
function bodyUserName(body) {
  if (!body) return "";
  if (match && match.ownerNames && match.ownerNames.has(body.owner)) {
    return match.ownerNames.get(body.owner);
  }
  return body.name || "";
}

// Whitelists del objetivo de partido (SPEC v1.3 D).
function matchValueOk(target, v) {
  const list = target === "time" ? MATCH_TIME_VALUES : MATCH_GOALS_VALUES;
  return typeof v === "number" && list.indexOf(v) !== -1;
}

function matchDefaultValue(target) {
  return target === "time" ? MATCH_TIME_DEFAULT : MATCH_GOALS_DEFAULT;
}

// Texto del chip de objetivo: "a 3 goles" / "a 1 gol" / "5 min" (SPEC v1.3 D).
function matchChipLabel(target, value) {
  const v = matchValueOk(target, value) ? value : matchDefaultValue(target);
  if (target === "time") return Math.round(v / 60) + " min";
  return "a " + v + (v === 1 ? " gol" : " goles");
}

const IS_TOUCH =
  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
  "ontouchstart" in window;

/* ================================ WebSocket ================================= */
function wsUrl() {
  return (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
}

function connectWs() {
  ws = new WebSocket(wsUrl());
  // seq de input por CONEXIÓN (SPEC A): cada socket nuevo arranca de cero.
  inputSeq = 0;
  ws.onopen = () => {
    for (const item of wsQueue) ws.send(item.data);
    wsQueue = [];
    // Reconexión estando en el home: re-suscribirse al push de salas (v1.2).
    // El server pushea la lista inmediatamente al suscribirse (idempotente).
    if (phase === "home") {
      roomsSubbed = true;
      ws.send(JSON.stringify({ type: "subRooms", on: true }));
    }
    startPing();
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (err) {
      return;
    }
    if (msg && typeof msg.type === "string") handleMessage(msg);
  };
  ws.onclose = () => {
    ws = null;
    stopPing();
    const hadJoinIntent = wsQueue.some((i) => i.type === "create" || i.type === "join");
    // Nunca dejar mensajes viejos encolados para una conexión futura.
    wsQueue = [];
    // v1.5: el entrenamiento es 100% local; una caída de la conexión de salas NO
    // debe sacarte del modo solo. Se ignora (la reconexión se hará al volver al home).
    if (training) return;
    if (phase !== "home") {
      toast("Se perdió la conexión con el servidor");
      goHome(false);
    } else if (hadJoinIntent) {
      // La conexión falló con un create/join pendiente: avisar.
      toast("No se pudo conectar al servidor");
    }
    // v1.2: sin polling, la lista de salas vive del push del server. Si el home
    // quedó sin conexión, reintentar cada 3 s para recuperar la suscripción.
    if (phase === "home") {
      setTimeout(() => {
        if (phase === "home" && !ws) ensureWs();
      }, 3000);
    }
  };
  ws.onerror = () => {};
}

function ensureWs() {
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    connectWs();
  }
}

function wsSend(msg) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
    return;
  }
  // Mientras el socket conecta, conservar solo el último create/join pendiente:
  // evita que un doble click genere varias salas/joins al abrirse la conexión.
  if (msg.type === "create" || msg.type === "join") {
    wsQueue = wsQueue.filter((item) => item.type !== "create" && item.type !== "join");
  } else if (msg.type === "listRooms") {
    // No acumular listRooms: con uno encolado alcanza.
    if (wsQueue.some((item) => item.type === "listRooms")) {
      ensureWs();
      return;
    }
  } else if (msg.type === "subRooms") {
    // Solo importa el último estado de suscripción (v1.2).
    wsQueue = wsQueue.filter((item) => item.type !== "subRooms");
  }
  wsQueue.push({ type: msg.type, data });
  ensureWs();
}

/* ============================ Despacho de mensajes ============================ */
function handleMessage(msg) {
  switch (msg.type) {
    case "joined":
      handleJoined(msg);
      break;
    case "error":
      toast(typeof msg.message === "string" ? msg.message : "Error");
      break;
    case "rooms":
      handleRooms(msg);
      break;
    case "lobby":
      handleLobby(msg);
      break;
    case "starting":
      handleStarting(msg);
      break;
    case "startCancelled":
      hideLobbyCountdown();
      break;
    case "start":
      handleStart(msg);
      break;
    case "state":
      handleState(msg);
      break;
    case "goal":
      handleGoal(msg);
      break;
    case "kickoff":
      handleKickoff();
      break;
    case "golden":
      handleGolden();
      break;
    case "gameover":
      handleGameover(msg);
      break;
    case "pong":
      handlePong(msg);
      break;
    default:
      break;
  }
}

/* ============================ Ping → #ping-indicator ============================ */
// {type:"ping", t:performance.now()} cada 2 s → el server ecoa {type:"pong", t}.
// RTT en la pill #ping-indicator: verde < 80 ms, amarillo < 180, rojo ≥ 180 (SPEC A/F).
function sendPing() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping", t: performance.now() }));
  }
}

function startPing() {
  stopPing();
  sendPing();
  pingTimer = setInterval(sendPing, PING_MS);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = 0;
  }
  // Sin conexión no hay medición: vaciar la pill (CSS la oculta con :empty).
  if (pingIndicator) {
    pingIndicator.textContent = "";
    pingIndicator.classList.remove("ping-good", "ping-mid", "ping-bad");
  }
}

function handlePong(msg) {
  if (typeof msg.t !== "number" || !isFinite(msg.t)) return;
  const rtt = Math.max(0, performance.now() - msg.t);
  lastRttMs = rtt; // v1.4 H: alimenta los ticks de extrapolación adaptativos
  if (!pingIndicator) return;
  pingIndicator.textContent = Math.round(rtt) + " ms";
  pingIndicator.classList.toggle("ping-good", rtt < 80);
  pingIndicator.classList.toggle("ping-mid", rtt >= 80 && rtt < 180);
  pingIndicator.classList.toggle("ping-bad", rtt >= 180);
}

function handleJoined(msg) {
  myId = msg.playerId;
  hostId = msg.hostId;
  roomCode = msg.room;
  myLastRoomCode = msg.room;
  try {
    localStorage.setItem("poligol.lastRoom", msg.room);
  } catch (err) {
    /* localStorage deshabilitado */
  }
  match = null;
  lobby = null;
  myReady = false;
  ended = false;
  phase = "lobby";
  if (roomCodeLabel) roomCodeLabel.textContent = roomCode;
  if (playersList) playersList.textContent = "";
  hideLobbyCountdown();
  showScreen("lobby");
}

/* ================================= Pantallas ================================= */
function showScreen(name) {
  screenHome.classList.toggle("hidden", name !== "home");
  screenLobby.classList.toggle("hidden", name !== "lobby");
  screenGame.classList.toggle("hidden", name !== "game");
  // body.in-game: oculta el engranaje global durante el partido (style.css) sin
  // depender de :has(), que falta en Firefox <121 y Safari/iOS <15.4.
  document.body.classList.toggle("in-game", name === "game");
  // v1.2: suscripción push de salas públicas SOLO mientras el home está visible.
  if (name === "home") homeRoomsOn();
  else homeRoomsOff();
  updateRotateOverlay();
}

function goHome(sendLeave) {
  if (sendLeave && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave" }));
  }
  // v1.5: salir del entrenamiento (modo local) limpia su estado y restaura el HUD.
  if (training) {
    training = null;
    const hud = $("training-hud");
    if (hud) hud.classList.add("hidden");
    if (scoreboardEl) scoreboardEl.classList.remove("hidden");
  }
  stopInputLoop();
  clearOverlayTimers();
  hideLobbyCountdown();
  exitGameDisplay();
  overlayEl.textContent = "";
  if (endgameActions) endgameActions.classList.add("hidden");
  match = null;
  lobby = null;
  myReady = false;
  snaps = [];
  confetti = [];
  confettiRainUntil = 0;
  dustFx = [];
  feetState.clear();
  relatorStop();
  resetPrediction();
  hideMatchClock();          // v1.3
  hideDuoKeysHint();         // v1.3
  updateTouchButtonsVisibility(false); // v1.3: ⚽/🦵 vuelven fuera de duo
  snapArrivals = [];
  interpDelay = 100;
  lastPaused = false;
  ended = false;
  roomCode = null;
  phase = "home";
  showScreen("home");
}

/* =================================== Home =================================== */
function selectCountry(code) {
  if (!COUNTRY_BY_CODE.has(code)) return;
  selectedCountry = code;
  for (const el of countryGrid.children) {
    const isSel = el.dataset.code === code;
    el.classList.toggle("selected", isSel);
    el.setAttribute("aria-selected", isSel ? "true" : "false");
  }
}

function buildCountryGrid() {
  for (const c of COUNTRIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "country-item";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", "false");
    btn.dataset.code = c.code;
    btn.title = c.name;
    const flag = document.createElement("span");
    flag.className = "country-flag";
    flag.textContent = flagOf(c.code);
    const name = document.createElement("span");
    name.className = "country-name";
    name.textContent = c.name;
    btn.append(flag, name);
    btn.addEventListener("click", () => selectCountry(c.code));
    countryGrid.appendChild(btn);
  }
}

function validateHome(needCode) {
  const name = nameInput.value.trim();
  if (!name) {
    toast("Escribí tu nombre");
    nameInput.focus();
    return null;
  }
  if (!selectedCountry) {
    toast("Elegí tu selección");
    return null;
  }
  if (needCode) {
    const code = roomInput.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      toast("El código de sala tiene 4 letras");
      roomInput.focus();
      return null;
    }
    return { name, country: selectedCountry, room: code };
  }
  return { name, country: selectedCountry };
}

on(btnCreate, "click", () => {
  const v = validateHome(false);
  if (!v) return;
  saveProfile(v.name, v.country);
  const visibility = visPublic && visPublic.checked ? "public" : "private"; // default privada
  let roomName = roomNameInput ? roomNameInput.value.trim() : "";
  if (!roomName) roomName = "Sala de " + v.name;
  roomName = roomName.slice(0, ROOM_NAME_MAX);
  wsSend({ type: "create", name: v.name, country: v.country, visibility, roomName });
});

on(btnJoin, "click", () => {
  const v = validateHome(true);
  if (!v) return;
  saveProfile(v.name, v.country);
  wsSend({ type: "join", name: v.name, country: v.country, room: v.room });
});

on(roomInput, "input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
});
on(roomInput, "keydown", (e) => {
  if (e.key === "Enter") btnJoin.click();
});
on(nameInput, "keydown", (e) => {
  if (e.key === "Enter") btnCreate.click();
});

// ?room=CODE en la URL → precargar el código en el home (SPEC).
{
  const urlRoom = new URLSearchParams(location.search).get("room");
  if (urlRoom) roomInput.value = urlRoom.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

/* ------------------------- Salas públicas (#rooms-list) ------------------------- */
// v1.2 (SPEC C): el server PUSHEA {type:"rooms"} a las conexiones suscriptas con
// {type:"subRooms", on:true|false} — inmediatamente al suscribirse y ante cada
// cambio. listRooms queda solo para el botón refrescar manual (compat), que NO
// chequea document.hidden.
function requestRooms() {
  if (phase !== "home") return;
  wsSend({ type: "listRooms" });
}

let roomsSubbed = false; // suscripción activa (evita "off" redundantes)

function homeRoomsOn() {
  // Re-suscribirse siempre es idempotente en el server y fuerza un push fresco.
  roomsSubbed = true;
  wsSend({ type: "subRooms", on: true }); // el server responde con la lista al toque
}

function homeRoomsOff() {
  if (!roomsSubbed) return;
  roomsSubbed = false;
  // Solo des-suscribir si hay conexión viva: no abrir un socket para decir "off".
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "subRooms", on: false }));
  } else {
    wsQueue = wsQueue.filter((item) => item.type !== "subRooms");
  }
}

// Pestaña que vuelve a ser visible estando en el home: re-suscribir + pedir la
// lista (SPEC C — fix del bug v1.1 "no se ve la sala").
document.addEventListener("visibilitychange", () => {
  if (document.hidden || phase !== "home") return;
  homeRoomsOn();
  requestRooms();
});

on(btnRefreshRooms, "click", () => {
  // Giro de feedback (.spinning, definido en style.css); se quita al terminar.
  if (btnRefreshRooms) {
    btnRefreshRooms.classList.remove("spinning");
    void btnRefreshRooms.offsetWidth; // re-dispara la animación
    btnRefreshRooms.classList.add("spinning");
    setTimeout(() => btnRefreshRooms.classList.remove("spinning"), 650);
  }
  requestRooms();
});

// Clave de lo ÚLTIMO renderizado en #rooms-list: si el poll de 3 s trae los mismos
// datos no se re-renderiza (evita re-disparar la animación slide-in cada 3 s y
// que un tap sobre "Unirse" se pierda porque el botón fue reemplazado mid-touch).
let lastRoomsKey = null;

function handleRooms(msg) {
  if (phase !== "home" || !roomsList) return;
  const list = Array.isArray(msg.rooms) ? msg.rooms : [];
  const key = JSON.stringify(
    list.map((r) => [
      r.code, r.roomName, r.hostName, r.count, r.max, r.mode, r.stadium,
      r.target, r.value, // v1.3: el chip de objetivo también invalida el cache
      r.tackles, // v1.4: el chip "sin barrida" también invalida el cache
      r.code === roomCode, // el badge "Tu sala" también invalida el cache de render
    ])
  );
  if (key === lastRoomsKey) return;
  lastRoomsKey = key;
  renderRooms(list);
}

function renderRooms(list) {
  roomsList.textContent = "";
  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rooms-empty";
    empty.textContent = "No hay salas públicas — creá la tuya";
    roomsList.appendChild(empty);
    return;
  }
  for (const r of list) {
    const code = typeof r.code === "string" ? r.code : "";
    const card = document.createElement("li");
    card.className = "room-card";
    // Badge "Tu sala" (v1.2 F): si la PROPIA sala aparece en la lista, style.css
    // dibuja el badge vía .room-card.mine::after.
    if (code && (code === roomCode || code === myLastRoomCode)) card.classList.add("mine");

    const info = document.createElement("div");
    info.className = "room-card-info";
    const nm = document.createElement("div");
    nm.className = "room-card-name";
    nm.textContent = r.roomName || code;
    info.appendChild(nm);
    if (r.hostName) {
      const host = document.createElement("div");
      host.className = "room-card-host";
      host.textContent = "👑 " + r.hostName;
      info.appendChild(host);
    }
    const meta = document.createElement("div");
    meta.className = "room-card-meta";
    const chipMode = document.createElement("span");
    chipMode.className = "room-chip room-chip-mode";
    chipMode.textContent = MODE_LABELS[r.mode] || String(r.mode || "");
    const chipCount = document.createElement("span");
    chipCount.className = "room-chip room-chip-count";
    chipCount.textContent =
      (r.count != null ? r.count : "?") + "/" + (r.max != null ? r.max : "?");
    const chipStadium = document.createElement("span");
    chipStadium.className = "room-chip";
    chipStadium.textContent = STADIUM_LABELS[r.stadium] || String(r.stadium || "");
    meta.append(chipMode, chipCount, chipStadium);
    // v1.3 (SPEC D): chip de objetivo de partido ("a 3 goles" / "5 min").
    if (r.target === "goals" || r.target === "time") {
      const chipMatch = document.createElement("span");
      chipMatch.className = "room-chip room-chip-match";
      chipMatch.textContent = matchChipLabel(r.target, r.value);
      meta.appendChild(chipMatch);
    }
    // v1.4 (SPEC E): si la sala desactivó la barrida, chip "HaxBall puro".
    if (r.tackles === false) {
      const chipPure = document.createElement("span");
      chipPure.className = "room-chip room-chip-pure";
      chipPure.textContent = "Sin barrida";
      meta.appendChild(chipPure);
    }
    info.appendChild(meta);

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn btn-secondary btn-join-room";
    joinBtn.textContent = "Unirse";
    joinBtn.addEventListener("click", () => {
      const v = validateHome(false);
      if (!v) return;
      saveProfile(v.name, v.country);
      wsSend({ type: "join", name: v.name, country: v.country, room: code });
    });

    card.append(info, joinBtn);
    roomsList.appendChild(card);
  }
}

/* =================================== Lobby =================================== */
function handleLobby(msg) {
  // Broadcast tardío tras "Salir": si ya no pertenecemos a una sala, ignorarlo
  // (la pertenencia la definen "joined"/goHome, no un mensaje en vuelo).
  if (phase === "home" || !roomCode) return;
  if (phase === "game") {
    // Partido abortado (o rematch → vuelta al lobby): salir del juego.
    stopInputLoop();
    clearOverlayTimers();
    exitGameDisplay();
    overlayEl.textContent = "";
    if (endgameActions) endgameActions.classList.add("hidden");
    match = null;
    snaps = [];
    confetti = [];
    confettiRainUntil = 0;
    dustFx = [];
    feetState.clear();
    relatorStop();
    resetPrediction();
    hideMatchClock();          // v1.3
    hideDuoKeysHint();         // v1.3
    updateTouchButtonsVisibility(false); // v1.3
    lastPaused = false;
    ended = false;
  }
  phase = "lobby";
  // v1.3 (SPEC D): el lobby gana target/value (defaults goals/3 si faltan).
  const target = msg.target === "time" ? "time" : "goals";
  lobby = {
    code: typeof msg.code === "string" ? msg.code : roomCode,
    roomName: typeof msg.roomName === "string" ? msg.roomName : "",
    visibility: msg.visibility === "public" ? "public" : "private",
    mode: typeof msg.mode === "string" ? msg.mode : "ffa",
    stadium: typeof msg.stadium === "string" ? msg.stadium : "clasico",
    target,
    value: matchValueOk(target, msg.value) ? msg.value : matchDefaultValue(target),
    // v1.4 E: barrida opcional por sala (default true si el server no lo manda).
    tackles: msg.tackles !== false,
    players: Array.isArray(msg.players) ? msg.players : [],
  };
  roomCode = lobby.code;
  showScreen("lobby");
  renderLobby(msg.notice);
}

function inviteLink() {
  return location.origin + "/?room=" + (lobby ? lobby.code : roomCode || "");
}

function renderLobby(notice) {
  if (!lobby) return;
  const players = lobby.players;
  if (roomCodeLabel) roomCodeLabel.textContent = lobby.code || "····";
  if (lobbyRoomName) lobbyRoomName.textContent = lobby.roomName || "Sala de espera";
  if (lobbyVisibilityBadge) {
    const isPublic = lobby.visibility === "public";
    lobbyVisibilityBadge.textContent = isPublic ? "🌐 Pública" : "🔒 Privada";
    lobbyVisibilityBadge.classList.toggle("public", isPublic);
    lobbyVisibilityBadge.classList.toggle("private", !isPublic);
  }

  const host = players.find((p) => p.isHost);
  hostId = host ? host.id : null;
  const meHost = hostId === myId;
  const me = players.find((p) => p.id === myId);
  myReady = !!(me && me.ready);

  // Lista de jugadores: bandera, nombre, badge HOST, check ready (.ready + ✅).
  playersList.textContent = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.className = "player-item" + (p.id === myId ? " me" : "") + (p.ready ? " ready" : "");
    const flag = document.createElement("span");
    flag.className = "player-flag";
    flag.textContent = flagOf(p.country);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name;
    li.append(flag, name);
    if (p.isHost) {
      const badge = document.createElement("span");
      badge.className = "host-badge";
      badge.textContent = "Host";
      li.appendChild(badge);
    }
    // El ✅ de ready lo agrega style.css vía .player-item.ready::after.
    playersList.appendChild(li);
  }

  // Selects de modo y estadio: solo el host los puede tocar; siempre reflejan el lobby.
  if (modeSelect) {
    modeSelect.value = lobby.mode;
    modeSelect.disabled = !meHost;
  }
  if (stadiumSelect) {
    stadiumSelect.value = lobby.stadium;
    stadiumSelect.disabled = !meHost;
  }
  // v1.3 (SPEC D): selects de objetivo — host habilitado, no-host solo lectura;
  // las opciones de value se repueblan según el target (whitelists del SPEC).
  if (matchTargetSelect) {
    matchTargetSelect.value = lobby.target;
    matchTargetSelect.disabled = !meHost;
  }
  if (matchValueSelect) {
    populateMatchValues(lobby.target, lobby.value);
    matchValueSelect.disabled = !meHost;
  }
  // v1.4 E: checkbox de barrida — host editable, no-host solo lectura.
  if (ruleTacklesCheck) {
    ruleTacklesCheck.checked = lobby.tackles !== false;
    ruleTacklesCheck.disabled = !meHost;
  }
  renderLobbyMatchChip(); // chip "a N goles" / "N min" también en el lobby

  renderTeamsPanel();

  // Toggle de ready (.is-ready = gris sin pulso, definido en style.css).
  if (btnReady) {
    btnReady.textContent = myReady ? "Esperá... ❌" : "¡ESTOY LISTO! ✅";
    btnReady.classList.toggle("is-ready", myReady);
  }

  // v1.1: el botón "Empezar" del host desaparece (auto-arranque por readies).
  if (btnStart) btnStart.classList.add("hidden");

  // Link de invitación: WhatsApp + copiar.
  if (btnWhatsapp) {
    btnWhatsapp.href =
      "https://wa.me/?text=" +
      encodeURIComponent("⚽ ¡Sumate a mi partido de PoliGol! " + inviteLink());
    btnWhatsapp.target = "_blank";
    btnWhatsapp.rel = "noopener";
  }

  if (lobbyCard) {
    const old = lobbyCard.querySelector(".lobby-notice");
    if (old) old.remove();
    if (notice) {
      const div = document.createElement("div");
      div.className = "lobby-notice";
      div.textContent = notice;
      if (lobbyActions) lobbyCard.insertBefore(div, lobbyActions);
      else lobbyCard.appendChild(div);
    }
  }
}

/* ------------------------- Panel de equipos (1v1 / 2v2) ------------------------- */
// Puebla las columnas YA presentes en el HTML (#team-list-0 / #team-list-1):
// <li> con bandera + nombre por jugador; cupos libres como <li class="empty">.
function renderTeamsPanel() {
  if (!teamsPanel || !lobby) return;
  const show = lobby.mode === "1v1" || lobby.mode === "2v2";
  teamsPanel.classList.toggle("hidden", !show);
  if (!show) return;

  const slotsPerTeam = lobby.mode === "2v2" ? 2 : 1;
  for (let t = 0; t < 2; t++) {
    const ul = $("team-list-" + t);
    if (!ul) continue;
    ul.textContent = "";
    let filled = 0;
    for (const p of lobby.players) {
      if (p.team !== t) continue;
      const li = document.createElement("li");
      if (p.id === myId) li.classList.add("me");
      const flag = document.createElement("span");
      flag.className = "player-flag";
      flag.textContent = flagOf(p.country);
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = p.name;
      li.append(flag, name);
      ul.appendChild(li);
      filled++;
    }
    for (; filled < slotsPerTeam; filled++) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Lugar libre";
      ul.appendChild(li);
    }
  }

  // Cambiar de equipo: solo tiene sentido en 2v2 (SPEC: setTeam valida cupo, solo 2v2).
  if (btnSwapTeam) btnSwapTeam.classList.toggle("hidden", lobby.mode !== "2v2");
}

on(btnSwapTeam, "click", () => {
  if (phase !== "lobby" || !lobby || lobby.mode !== "2v2") return;
  const me = lobby.players.find((p) => p.id === myId);
  if (!me) return;
  wsSend({ type: "setTeam", team: me.team === 0 ? 1 : 0 });
});

on(btnReady, "click", () => {
  if (phase !== "lobby") return;
  wsSend({ type: "ready", ready: !myReady });
});

on(modeSelect, "change", () => {
  if (phase !== "lobby" || hostId !== myId) return;
  wsSend({ type: "setMode", mode: modeSelect.value });
});

on(stadiumSelect, "change", () => {
  if (phase !== "lobby" || hostId !== myId) return;
  wsSend({ type: "setStadium", stadium: stadiumSelect.value });
});

/* -------------------- Objetivo de partido (v1.3, SPEC D) -------------------- */
// Repuebla #match-value-select según el target (goles: 1/3/5/10 — tiempo:
// 2/3/5/10 min) y selecciona `selected` (o el default si no está en la lista).
function populateMatchValues(target, selected) {
  if (!matchValueSelect) return;
  const vals = target === "time" ? MATCH_TIME_VALUES : MATCH_GOALS_VALUES;
  let same = matchValueSelect.options.length === vals.length;
  if (same) {
    for (let i = 0; i < vals.length; i++) {
      if (matchValueSelect.options[i].value !== String(vals[i])) {
        same = false;
        break;
      }
    }
  }
  if (!same) {
    matchValueSelect.textContent = "";
    for (const v of vals) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent =
        target === "time" ? Math.round(v / 60) + " min" : v === 1 ? "1 gol" : v + " goles";
      matchValueSelect.appendChild(opt);
    }
  }
  matchValueSelect.value = String(
    matchValueOk(target, selected) ? selected : matchDefaultValue(target)
  );
}

// Chip de objetivo en el lobby, junto al badge de visibilidad (se crea una vez;
// reusa el estilo .visibility-badge para no exigir CSS nuevo).
function renderLobbyMatchChip() {
  if (!lobby || !lobbyVisibilityBadge || !lobbyVisibilityBadge.parentNode) return;
  let chip = $("lobby-match-chip");
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "lobby-match-chip";
    chip.className = "visibility-badge match-chip";
    lobbyVisibilityBadge.parentNode.insertBefore(chip, lobbyVisibilityBadge.nextSibling);
  }
  chip.textContent =
    (lobby.target === "time" ? "⏱️ " : "🥅 ") + matchChipLabel(lobby.target, lobby.value);
}

on(matchTargetSelect, "change", () => {
  if (phase !== "lobby" || hostId !== myId) return;
  const target = matchTargetSelect.value === "time" ? "time" : "goals";
  const value = matchDefaultValue(target); // al cambiar de target se propone el default
  populateMatchValues(target, value);      // feedback inmediato; el lobby confirma
  wsSend({ type: "setMatch", target, value });
});

on(matchValueSelect, "change", () => {
  if (phase !== "lobby" || hostId !== myId) return;
  const target = matchTargetSelect && matchTargetSelect.value === "time" ? "time" : "goals";
  const value = parseInt(matchValueSelect.value, 10);
  if (!matchValueOk(target, value)) return; // whitelist del SPEC
  wsSend({ type: "setMatch", target, value });
});

// v1.4 E: barrida on/off (solo host, solo lobby).
on(ruleTacklesCheck, "change", () => {
  if (phase !== "lobby" || hostId !== myId) return;
  wsSend({ type: "setRules", tackles: !!ruleTacklesCheck.checked });
});

on(btnLeave, "click", () => goHome(true));

/* -------------------- Countdown de auto-arranque (#lobby-countdown) -------------------- */
function handleStarting(msg) {
  // Pre-carga del pack de voz durante la cuenta de 3 (idempotente): así el
  // clip de "start" llega bajado y decodificado al pitazo inicial (SPEC D).
  loadVoicePack();
  if (phase !== "lobby") return;
  let n = Math.round(typeof msg.in === "number" && isFinite(msg.in) ? msg.in : 3);
  if (n < 1) n = 3;
  showLobbyCountdown(n);
}

function showLobbyCountdown(n) {
  hideLobbyCountdown();
  if (!lobbyCountdown) return;
  lobbyCountdown.classList.remove("hidden");
  lobbyCountdown.textContent = String(n);
  sfxCountdown(n);
  let left = n;
  lobbyCountdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      // El "start" lo manda el server; mientras llega, cerrar la cuenta.
      clearInterval(lobbyCountdownTimer);
      lobbyCountdownTimer = 0;
      lobbyCountdown.textContent = "¡VAMOS!";
    } else {
      lobbyCountdown.textContent = String(left);
      sfxCountdown(left);
    }
  }, 1000);
}

function hideLobbyCountdown() {
  if (lobbyCountdownTimer) {
    clearInterval(lobbyCountdownTimer);
    lobbyCountdownTimer = 0;
  }
  if (lobbyCountdown) {
    lobbyCountdown.classList.add("hidden");
    lobbyCountdown.textContent = "";
  }
}

/* ----------------------------- Copiar link / WhatsApp ----------------------------- */
function copyInvite(feedbackEl) {
  if (!roomCode) return;
  const link = inviteLink();
  const done = () => {
    if (!feedbackEl) return;
    feedbackEl.classList.add("copied");
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => feedbackEl.classList.remove("copied"), 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done, () => {
      if (legacyCopy(link)) done();
    });
  } else if (legacyCopy(link)) {
    done();
  }
}

// Click en el código → copiar link de invitación (v1: location.origin + "?room=CODE").
on(roomCodeLabel, "click", () => {
  if (!roomCode) return;
  const link = location.origin + "?room=" + roomCode;
  const done = () => {
    roomCodeLabel.classList.add("copied");
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => roomCodeLabel.classList.remove("copied"), 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done, () => {
      if (legacyCopy(link)) done();
    });
  } else if (legacyCopy(link)) {
    done();
  }
});

on(btnCopyLink, "click", () => copyInvite(btnCopyLink));

function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (err) {
    ok = false;
  }
  ta.remove();
  return ok;
}

/* ===================== Geometría (= núcleo PoliPhysics) =====================
 * La geometría viene del núcleo compartido (buildArena) para que las colisiones
 * de la extrapolación y el render coincidan exactamente con el server. Acá solo
 * se derivan los VÉRTICES del polígono (para el clip del césped) y el bounding,
 * a partir de las mismas fórmulas del SPEC. arena.goals trae la boca de cada arco
 * (con su equipo) y arena.posts los palos — el render los usa directamente. */
function polygonVerts(n) {
  if (n === 2) {
    return [
      { x: -RECT_W, y: -RECT_H },
      { x: RECT_W, y: -RECT_H },
      { x: RECT_W, y: RECT_H },
      { x: -RECT_W, y: RECT_H },
    ];
  }
  const verts = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    verts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return verts;
}

function vertsBounds(verts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return { minX, maxX, minY, maxY };
}

function buildFieldPath(verts) {
  const p = new Path2D();
  p.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) p.lineTo(verts[i].x, verts[i].y);
  p.closePath();
  return p;
}

/* ================================== Partido ================================== */
// Etiqueta humana de un equipo: nombres de sus USUARIOS ("Leo", "Gonza y Leo").
// v1.3: en duo el equipo tiene 2 cuerpos del MISMO usuario ⇒ un solo nombre.
function teamLabel(team) {
  const list = team && team.users && team.users.length ? team.users : team ? team.members : null;
  if (!list || list.length === 0) return "Equipo";
  return list.map((m) => bodyUserName(m)).join(" y ");
}

function handleStart(msg) {
  loadVoicePack(); // al entrar al juego, una sola vez (cache en memoria, SPEC D)
  const cfg = msg.config;
  if (!cfg || !Array.isArray(cfg.players) || !Array.isArray(cfg.teams)) return;
  if (!PHYS) return; // sin núcleo no hay física (error ya logueado al cargar)
  const n = cfg.teams.length; // n = cantidad de EQUIPOS (v1.1); arco k = equipo k
  if (n < 2) return;
  const stadiumStart = typeof cfg.stadium === "string" ? cfg.stadium : "clasico";
  // Cancha del núcleo (walls/posts/goals/spawns + phys del estadio). MISMA que el
  // server arma con buildArena(n, stadium): la extrapolación corre sobre ella.
  baseArena = PHYS.buildArena(n, stadiumStart);
  const verts = polygonVerts(n);
  const bounds = vertsBounds(verts);

  // v1.3 (SPEC A): cada entrada de players es un CUERPO {id,name,country,team,
  // owner,slot}. En modos no-duo el server manda slot 0 y owner = el usuario
  // (uniforme); los defaults cubren un server viejo sin esos campos.
  const players = cfg.players.map((p) => {
    const info = countryInfo(p.country);
    return {
      id: p.id,
      name: p.name,
      country: p.country,
      team: typeof p.team === "number" ? p.team : 0,
      owner: typeof p.owner === "string" ? p.owner : p.id,
      slot: p.slot === 1 ? 1 : 0,
      c1: info.c1,
      c2: info.c2,
      flag: flagOf(p.country),
    };
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  // USUARIOS: nombre por owner (el del cuerpo slot 0 manda) para relator/labels.
  const ownerNames = new Map();
  for (const p of players) {
    if (!ownerNames.has(p.owner) || p.slot === 0) ownerNames.set(p.owner, p.name);
  }

  const teams = cfg.teams.map((t, idx) => {
    const members = (Array.isArray(t.players) ? t.players : [])
      .map((id) => byId.get(id))
      .filter(Boolean);
    // v1.3: `users` = un cuerpo representante por USUARIO (en duo, los 2
    // cuerpos comparten owner ⇒ una sola bandera/nombre en pills y arcos).
    const users = [];
    const seen = new Set();
    for (const m of members) {
      if (seen.has(m.owner)) continue;
      seen.add(m.owner);
      users.push(m);
    }
    return {
      index: idx,
      members,
      users,
      c1: members[0] ? members[0].c1 : "#9fb0c8",
      c2: members[0] ? members[0].c2 : "#ffffff",
      flags: users.map((m) => m.flag).join(""),
    };
  });

  // Cuerpos PROPIOS (v1.3): por owner; fallback por id para servers sin owner.
  const myBodies = players.filter((p) => p.owner === myId);
  if (!myBodies.length && byId.has(myId)) myBodies.push(byId.get(myId));
  myBodies.sort((a, b) => a.slot - b.slot);

  const mode = typeof cfg.mode === "string" ? cfg.mode : "ffa";
  const stadium = typeof cfg.stadium === "string" ? cfg.stadium : "clasico";
  // Objetivo (SPEC D): del config si viniera; si no, lo último visto en lobby.
  let target = cfg.target === "time" || cfg.target === "goals" ? cfg.target : null;
  let value = target !== null && matchValueOk(target, cfg.value) ? cfg.value : null;
  if (target === null) target = lobby && lobby.target === "time" ? "time" : "goals";
  if (value === null) {
    value =
      lobby && lobby.target === target && matchValueOk(target, lobby.value)
        ? lobby.value
        : matchDefaultValue(target);
  }
  match = {
    mode,
    stadium,
    n,
    players,
    byId,
    teams,
    myTeam: myBodies[0] ? myBodies[0].team : null,
    myBodyIds: new Set(myBodies.map((b) => b.id)), // v1.3: ids de cuerpos propios
    ownerNames,
    target,        // v1.3 (D): "goals" | "time"
    value,         // v1.3 (D): whitelisted
    golden: false, // v1.3 (D): true tras {type:"golden"} (GOL DE ORO)
    // v1.4 E: barrida según la sala (del config si viniera; si no, del último
    // lobby; default true). La extrapolación pasa esto como rules a stepWorld.
    tackles:
      cfg.tackles !== undefined
        ? cfg.tackles !== false
        : lobby
          ? lobby.tackles !== false
          : true,
    arena: baseArena,          // v1.4: cancha del núcleo (walls/posts/goals/spawns)
    goals: baseArena.goals,    // boca de cada arco (cx,cy,nx,ny,dx,dy,team)
    posts: baseArena.posts,    // palos (x,y,goal) — render de postes
    verts: verts,
    bounds: bounds,
    fieldPath: buildFieldPath(verts),
  };
  // v1.4 H: estado autoritativo base para la extrapolación de mundo completo.
  // Se inicializa al primer `state`; hasta entonces null (sin extrapolar).
  baseState = null;
  extWorld = null;
  dragOffset.clear();
  snaps = [];
  resetPrediction();
  snapArrivals = [];
  interpDelay = 100;
  lastPaused = false;
  ringFx = [];
  ballTrail = [];
  confetti = [];
  confettiRainUntil = 0;
  ballSpin = 0;
  ended = false;
  tackleCdUntil = [0, 0];
  kickHoldSources[0].clear();
  kickHoldSources[1].clear();
  lastSentA = { mx: 0, my: 0, kick: false };
  lastSentB = { mx: 0, my: 0, kick: false };
  goalStreak = { team: null, count: 0 };
  feetState.clear();
  dustFx = [];
  shakeUntil = 0;
  lastKickT = -1e9;
  hideLobbyCountdown();
  clearOverlayTimers();
  overlayEl.textContent = "";
  if (endgameActions) endgameActions.classList.add("hidden");
  buildScoreboard();
  phase = "game";
  showScreen("game");
  enterGameDisplay();
  startInputLoop();
  // v1.3: en duo táctil las zonas cubren toda la pantalla ⇒ sin botones ⚽/🦵;
  // reloj visible solo con target=time; hint de teclas 3 s en duo por teclado.
  updateTouchButtonsVisibility(isDuo());
  updateMatchClock(match.target === "time" ? match.value : null);
  if (isDuo() && !IS_TOUCH) showDuoKeysHint();
  else hideDuoKeysHint();

  // La cuenta de 3 ya corrió en el lobby (starting): acá solo el pitazo inicial.
  const d = document.createElement("div");
  d.className = "overlay-text";
  d.textContent = "¡A JUGAR!";
  overlayEl.appendChild(d);
  overlayTimers.push(
    setTimeout(() => {
      overlayEl.textContent = "";
    }, 900)
  );
  commentator("start", {});
}

function handleState(msg) {
  if (!match || phase !== "game") return;
  const t = performance.now();

  // Delay adaptativo (SPEC A, usado solo en modo ext=0): snapInterval medio +
  // jitter de las últimas ~20 llegadas → clamp(media*1.5 + jitter, 50, 160).
  snapArrivals.push(t);
  if (snapArrivals.length > ARRIVALS_WINDOW + 1) snapArrivals.shift();
  if (snapArrivals.length >= 3) {
    let mean = 0;
    const gaps = [];
    for (let i = 1; i < snapArrivals.length; i++) {
      gaps.push(Math.min(SNAP_GAP_CAP, snapArrivals[i] - snapArrivals[i - 1]));
    }
    for (const g of gaps) mean += g;
    mean /= gaps.length;
    let varAcc = 0;
    for (const g of gaps) varAcc += (g - mean) * (g - mean);
    const jitter = Math.sqrt(varAcc / gaps.length);
    interpDelay = Math.min(INTERP_MAX, Math.max(INTERP_MIN, mean * 1.5 + jitter));
  }

  // v1.4 I: state en u/tick, 2 decimales; el server omite campos en 0
  // (stun/kc/slide/ka/kh/lt). El cliente asume 0/false ante un campo ausente.
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const mb = msg.ball || {};
  // Snapshot "fino" para SFX/eventos y para el buffer de interpolación (ext=0).
  const ball = { x: num(mb.x), y: num(mb.y), vx: num(mb.vx), vy: num(mb.vy), lt: mb.lt };
  const pm = new Map();
  if (Array.isArray(msg.players)) {
    for (const p of msg.players) {
      pm.set(p.id, {
        id: p.id,
        x: num(p.x),
        y: num(p.y),
        vx: num(p.vx),
        vy: num(p.vy),
        fx: num(p.fx),
        fy: num(p.fy),
        stun: num(p.stun),     // v1.4: en TICKS restantes
        kc: num(p.kc),         // v1.4: cooldown de kick en TICKS restantes (entero)
        slide: num(p.slide),   // v1.4: en TICKS restantes
        ka: p.ka !== undefined ? !!p.ka : true,  // kickArmed (cuerpo propio)
        kh: !!p.kh,            // kickHeld efectivo (cuerpo propio)
        // iq = último seq de input aplicado por el server al USUARIO propio.
        iq: typeof p.iq === "number" && isFinite(p.iq) ? p.iq : null,
      });
    }
  }

  const paused = !!msg.paused;
  // Eventos `kicked` del server (SPEC I): sfx/anim precisos. Los kicks de cuerpos
  // PROPIOS ya sonaron al disparar localmente; acá solo los ajenos.
  const kickedNow = new Set();
  if (Array.isArray(msg.events)) {
    for (const ev of msg.events) {
      if (ev && ev.type === "kicked" && typeof ev.id === "string") kickedNow.add(ev.id);
    }
  }

  // Detección de eventos comparando con el snapshot anterior (fallback si el
  // server no manda `events`). En v1.4 el cooldown `kc` salta de 0 a 2 ticks al
  // patear: un kc nuevo > 0 con el anterior 0 marca un kick.
  const prev = snaps[snaps.length - 1];
  if (prev) {
    for (const [id, p] of pm) {
      const q = prev.players.get(id);
      if (!q) continue;
      const own = match.myBodyIds ? match.myBodyIds.has(id) : id === myId;
      const kickedEvt = kickedNow.has(id) || (p.kc > 0 && (q.kc || 0) <= 0);
      if (kickedEvt) {
        if (!own) {
          ringFx.push({ x: p.x, y: p.y, t });
          sfxKick();
        }
        // Squash de la pelota si la patada fue cerca de ella (alcance real v1.4).
        const reach = BALL_R + PLAYER_R + KICK_REACH + 8;
        if (Math.hypot(ball.x - p.x, ball.y - p.y) < reach) lastKickT = t;
      }
      const qSlide = q.slide || 0;
      if ((p.slide || 0) > qSlide + 0.5 && !own) sfxTackle(); // arranque del slide
      if (p.stun > q.stun + 0.5) {
        // Barrida que conecta: vibración si se la dieron a un cuerpo mío + relator.
        if (own) vibrate(40);
        const victim = match.byId.get(id);
        let tacklerId = null;
        let bestD = Infinity;
        for (const [oid, op] of pm) {
          if (oid === id || (op.slide || 0) <= 0.5) continue;
          const dd = (op.x - p.x) * (op.x - p.x) + (op.y - p.y) * (op.y - p.y);
          if (dd < bestD) {
            bestD = dd;
            tacklerId = oid;
          }
        }
        const tackler = tacklerId ? match.byId.get(tacklerId) : null;
        commentator("tackle", {
          name: tackler ? bodyUserName(tackler) : "",
          rival: victim ? bodyUserName(victim) : "",
        });
      }
    }
    // Rebote contra pared/poste: la pelota invierte una componente normal. En
    // u/tick una pelota "rápida" arranca en ~3 u/tick (= 180 u/s); umbral 3.
    if (prev.ball) {
      const flippedX = ball.vx * prev.ball.vx < 0;
      const flippedY = ball.vy * prev.ball.vy < 0;
      if ((flippedX || flippedY) && Math.hypot(prev.ball.vx, prev.ball.vy) > 3) {
        sfxBounce();
      }
    }
  }
  snaps.push({ t, ball, players: pm, paused });
  if (snaps.length > 40) snaps.shift();
  if (Array.isArray(msg.scores)) updateScores(msg.scores);

  // v1.3 (SPEC D): reloj mm:ss con state.tl (presente SOLO en target=time).
  if (match.golden || typeof msg.tl === "number") {
    updateMatchClock(typeof msg.tl === "number" && isFinite(msg.tl) ? msg.tl : null);
  }

  // v1.4 H: reemplazar el estado base de la extrapolación por el del server, y
  // reconciliar por disco (offset que decae ~120 ms; snap si error > 60 u).
  rebaseWorld(pm, ball, paused);

  // Feedback del cooldown de kick en el botón táctil (cuerpo A).
  const meA = match.myBodyIds ? firstOwnSnap(pm) : null;
  if (btnKick && meA) btnKick.classList.toggle("cooldown", meA.kc > 0);
}

// Primer snapshot de un cuerpo propio (slot 0 preferido) del Map de estado.
function firstOwnSnap(pm) {
  if (!match || !match.myBodyIds) return null;
  let best = null;
  for (const [id, p] of pm) {
    if (!match.myBodyIds.has(id)) continue;
    const body = match.byId.get(id);
    if (body && body.slot === 0) return p;
    if (!best) best = p;
  }
  return best;
}

function handleGoal(msg) {
  if (!match) return;
  if (Array.isArray(msg.scores)) updateScores(msg.scores);
  clearOverlayTimers();
  overlayEl.textContent = "";

  const scorer = msg.scorerId ? match.byId.get(msg.scorerId) : null;
  // v1.3: el gol se anuncia con el nombre del USUARIO dueño del cuerpo.
  const scorerName = scorer ? bodyUserName(scorer) : "";
  const scorerTeam =
    typeof msg.scorerTeam === "number" ? match.teams[msg.scorerTeam] || null : null;
  const conceded =
    typeof msg.concededTeam === "number" ? match.teams[msg.concededTeam] || null : null;

  const goalText = document.createElement("div");
  goalText.className = "goal-text";
  if (msg.ownGoal) {
    goalText.textContent = "¡GOL EN CONTRA!";
    if (scorer) goalText.style.color = scorer.c1;
    else if (conceded) goalText.style.color = conceded.c1;
  } else if (scorer) {
    goalText.textContent = "¡GOL DE " + scorerName.toUpperCase() + "!";
    goalText.style.color = scorer.c1;
  } else if (scorerTeam) {
    goalText.textContent = "¡GOL DE " + teamLabel(scorerTeam).toUpperCase() + "!";
    goalText.style.color = scorerTeam.c1;
  } else {
    goalText.textContent = "¡GOL!";
  }
  overlayEl.appendChild(goalText);

  const sub = document.createElement("div");
  sub.className = "overlay-sub";
  if (msg.ownGoal) {
    sub.textContent = scorer
      ? scorerName + " la mandó contra su propio arco"
      : conceded
        ? teamLabel(conceded) + " la mandó contra su propio arco"
        : "";
  } else {
    sub.textContent = conceded ? "En el arco de " + teamLabel(conceded) : "";
  }
  overlayEl.appendChild(sub);

  sfxGoal();
  shakeUntil = performance.now() + 200; // screen-shake de gol (4 px, 200 ms)
  const fxTeam = scorerTeam || (scorer ? match.teams[scorer.team] : null) || conceded;
  const colors = scorer
    ? [scorer.c1, scorer.c2]
    : fxTeam
      ? [fxTeam.c1, fxTeam.c2]
      : rainColors;
  confettiBurst(colors);

  // Vibración: gol del equipo propio (SPEC mobile: vibrate(80) en gol propio).
  if (
    match.myTeam !== null &&
    typeof msg.scorerTeam === "number" &&
    msg.scorerTeam === match.myTeam
  ) {
    vibrate(80);
  }

  // Racha de goles del mismo equipo (dato para el relator de la etapa 2).
  if (!msg.ownGoal && typeof msg.scorerTeam === "number") {
    if (goalStreak.team === msg.scorerTeam) goalStreak.count += 1;
    else goalStreak = { team: msg.scorerTeam, count: 1 };
  } else {
    goalStreak = { team: null, count: 0 };
  }
  commentator(msg.ownGoal ? "owngoal" : "goal", {
    name: scorer ? scorerName : scorerTeam ? teamLabel(scorerTeam) : conceded ? teamLabel(conceded) : "",
    streak: goalStreak.count,
  });

  // Si el partido no terminó viene un kickoff: cuenta regresiva en la pausa.
  // v1.3 (D): con target=goals gana el primero en llegar a match.value (config,
  // default WIN_SCORE); con target=time un gol solo termina en GOL DE ORO.
  const goalLimit = typeof match.value === "number" ? match.value : WIN_SCORE;
  const someoneWon =
    match.golden ||
    (match.target !== "time" &&
      Array.isArray(msg.scores) &&
      msg.scores.some((s) => s >= goalLimit));
  if (!someoneWon) {
    overlayTimers.push(
      setTimeout(() => {
        overlayEl.textContent = "";
        showCountdown(["3", "2", "1"], 320);
      }, 1000)
    );
  }
}

function handleKickoff() {
  // Fin de la pausa post-gol: posiciones reseteadas → limpiar buffer para no
  // interpolar el "teletransporte" a los spawns. La predicción también se
  // resetea: el próximo state la re-inicializa desde el spawn (snap sin offset).
  snaps = [];
  resetPrediction();
  lastPaused = false;
  clearOverlayTimers();
  overlayEl.textContent = "";
}

// v1.3 (SPEC D): tiempo agotado con empate en la cima ⇒ GOL DE ORO. Announce
// de 2 s en el #overlay existente + #match-clock pasa a "GOL DE ORO" pulsante.
function handleGolden() {
  if (!match || phase !== "game") return;
  match.golden = true;
  updateMatchClock(null); // el reloj muestra "GOL DE ORO" (tl ya no viaja)
  clearOverlayTimers();
  overlayEl.textContent = "";
  const d = document.createElement("div");
  d.className = "goal-text golden-goal";
  d.style.color = "#f5c542";
  d.textContent = "¡GOL DE ORO!";
  const sub = document.createElement("div");
  sub.className = "overlay-sub";
  sub.textContent = "El próximo gol gana el partido";
  overlayEl.append(d, sub);
  overlayTimers.push(
    setTimeout(() => {
      overlayEl.textContent = "";
    }, 2000)
  );
  sfxCountdown(1); // beep de atención
}

function handleGameover(msg) {
  if (Array.isArray(msg.scores)) updateScores(msg.scores);
  ended = true;
  stopInputLoop();
  clearOverlayTimers();
  overlayEl.textContent = "";

  // v1.3: el reloj/golden se apagan al terminar (el overlay del campeón manda).
  if (match) match.golden = false;
  hideMatchClock();
  hideDuoKeysHint();

  const wt =
    match && typeof msg.winnerTeam === "number" ? match.teams[msg.winnerTeam] || null : null;
  const card = document.createElement("div");
  card.className = "winner-card";
  const flag = document.createElement("div");
  flag.className = "winner-flag";
  flag.textContent = wt && wt.flags ? wt.flags : "🏆";
  const name = document.createElement("div");
  name.className = "winner-name";
  name.textContent = wt ? teamLabel(wt) : "Campeón";
  const sub = document.createElement("div");
  sub.className = "winner-sub";
  // v1.3: "Campeones" si el equipo tiene más de un USUARIO (no cuerpos: en duo
  // un usuario con 2 cuerpos sigue siendo UN campeón).
  const winnerUsers = wt ? (wt.users && wt.users.length ? wt.users.length : wt.members.length) : 1;
  sub.textContent = winnerUsers > 1 ? "¡Campeones del PoliGol!" : "¡Campeón del PoliGol!";
  card.append(flag, name, sub);
  // v1.3 (SPEC D): reason como subtítulo extra cuando aplica.
  if (msg.reason === "golden" || msg.reason === "time") {
    const why = document.createElement("div");
    why.className = "winner-reason overlay-sub";
    why.textContent = msg.reason === "golden" ? "¡Gol de oro!" : "Se terminó el tiempo";
    card.appendChild(why);
  }
  overlayEl.appendChild(card);

  if (endgameActions) endgameActions.classList.remove("hidden");
  btnRematch.classList.toggle("hidden", hostId !== myId);

  rainColors = wt ? [wt.c1, wt.c2, "#f5c542"] : ["#f5c542", "#ffffff"];
  confettiRainUntil = performance.now() + 6500;
  sfxGoal();
  sfxChampion();
  commentator("gameover", { name: wt ? teamLabel(wt) : "" });
}

// v1.1: rematch vuelve AL LOBBY con readies reseteados (el server manda "lobby").
on(btnRematch, "click", () => wsSend({ type: "rematch" }));
on(btnExit, "click", () => goHome(true));

/* ================================= Scoreboard ================================ */
// ffa: un item por jugador (cada jugador es un equipo de 1, como v1).
// 1v1/2v2: dos pills de EQUIPO con las banderas de los integrantes (SPEC v1.1).
// duo (v1.3): una pill por EQUIPO-USUARIO (bandera + nombre del usuario + score;
// los 2 cuerpos del usuario no se duplican: team.users dedupea por owner).
function buildScoreboard() {
  scoreboardEl.textContent = "";
  scoreItems = [];
  const teamMode = match.mode === "1v1" || match.mode === "2v2" || match.mode === "duo";
  for (const team of match.teams) {
    const item = document.createElement("div");
    item.className =
      "score-item" +
      (teamMode ? " team-pill team-" + team.index : "") +
      (team.index === match.myTeam ? " me" : "");
    const flag = document.createElement("span");
    flag.className = "score-flag";
    flag.textContent = team.flags || "🏳️";
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = (team.users && team.users.length ? team.users : team.members)
      .map((m) => bodyUserName(m))
      .join(" + ");
    const val = document.createElement("span");
    val.className = "score-value";
    val.textContent = "0";
    item.append(flag, name, val);
    item.addEventListener("animationend", () => item.classList.remove("bump"));
    scoreboardEl.appendChild(item);
    scoreItems[team.index] = { root: item, valEl: val, value: 0 };
  }
}

// scores: ARRAY de enteros alineado a teams (v1.1).
function updateScores(scores) {
  if (!Array.isArray(scores)) return;
  for (let t = 0; t < scores.length; t++) {
    const it = scoreItems[t];
    if (!it) continue;
    const v = scores[t];
    if (it.value !== v) {
      it.value = v;
      it.valEl.textContent = String(v);
      it.valEl.classList.toggle("negative", v < 0);
      it.root.classList.remove("bump");
      void it.root.offsetWidth; // reinicia la animación
      it.root.classList.add("bump");
    }
  }
}

/* ================================== Overlay ================================== */
function clearOverlayTimers() {
  for (const t of overlayTimers) clearTimeout(t);
  overlayTimers = [];
}

// Recrea el nodo .countdown por cada número para re-disparar la animación CSS.
function showCountdown(nums, stepMs, finale) {
  for (let i = 0; i < nums.length; i++) {
    overlayTimers.push(
      setTimeout(() => {
        overlayEl.textContent = "";
        const d = document.createElement("div");
        d.className = "countdown";
        d.textContent = nums[i];
        overlayEl.appendChild(d);
        sfxCountdown(nums[i]);
      }, i * stepMs)
    );
  }
  overlayTimers.push(
    setTimeout(() => {
      overlayEl.textContent = "";
      if (finale) {
        const d = document.createElement("div");
        d.className = "overlay-text";
        d.textContent = finale;
        overlayEl.appendChild(d);
        overlayTimers.push(setTimeout(() => {
          overlayEl.textContent = "";
        }, 800));
      }
    }, nums.length * stepMs)
  );
}

/* ================== Reloj de partido + hint duo (v1.3, SPEC C/D) ==================
 * #match-clock (mm:ss, visible solo target=time; "GOL DE ORO" dorado pulsante
 * en golden) y #duo-keys-hint (mapeo de teclas duo, 3 s). Si el HTML aún no
 * trae esos nodos, se crean on-demand con un <style> de respaldo mínimo. */
let matchClockEl = $("match-clock");
let duoKeysHintEl = $("duo-keys-hint");
let duoHintTimer = 0;
let v13StyleDone = false;

function injectV13Style() {
  if (v13StyleDone) return;
  v13StyleDone = true;
  const st = document.createElement("style");
  st.textContent =
    "#match-clock{position:absolute;top:calc(64px + env(safe-area-inset-top,0px));" +
    "left:50%;transform:translateX(-50%);z-index:6;pointer-events:none;" +
    "font:800 22px/1 system-ui,sans-serif;letter-spacing:0.08em;color:#fff;" +
    "background:rgba(7,11,22,0.6);border:1px solid rgba(255,255,255,0.18);" +
    "border-radius:999px;padding:6px 16px;text-shadow:0 2px 8px rgba(0,0,0,0.6);}" +
    "#match-clock.golden{color:#f5c542;border-color:rgba(245,197,66,0.6);" +
    "animation:pg-gold 0.85s ease-in-out infinite;}" +
    "@keyframes pg-gold{0%,100%{opacity:1;transform:translateX(-50%) scale(1);}" +
    "50%{opacity:0.7;transform:translateX(-50%) scale(1.08);}}" +
    "#duo-keys-hint{position:fixed;top:22%;left:50%;transform:translateX(-50%);" +
    "z-index:40;pointer-events:none;text-align:center;" +
    "font:600 15px/1.7 system-ui,sans-serif;color:#fff;" +
    "background:rgba(7,11,22,0.82);border:1px solid rgba(255,255,255,0.16);" +
    "border-radius:14px;padding:12px 20px;box-shadow:0 12px 40px rgba(0,0,0,0.5);}";
  document.head.appendChild(st);
}

function ensureMatchClock() {
  if (!matchClockEl) {
    matchClockEl = $("match-clock");
    if (!matchClockEl && screenGame) {
      injectV13Style();
      matchClockEl = document.createElement("div");
      matchClockEl.id = "match-clock";
      matchClockEl.className = "match-clock hidden";
      screenGame.appendChild(matchClockEl);
    }
  }
  return matchClockEl;
}

function fmtClock(secs) {
  const s = Math.max(0, Math.round(secs));
  const mm = String(Math.floor(s / 60));
  const ss = String(s % 60);
  return (mm.length < 2 ? "0" + mm : mm) + ":" + (ss.length < 2 ? "0" + ss : ss);
}

// tl = segundos restantes (o null). En golden el texto fijo "GOL DE ORO" manda.
function updateMatchClock(tl) {
  const golden = !!(match && match.golden);
  if (!golden && (typeof tl !== "number" || !isFinite(tl))) {
    hideMatchClock();
    return;
  }
  const el = ensureMatchClock();
  if (!el) return;
  if (golden) {
    el.textContent = "GOL DE ORO";
    el.classList.add("golden");
  } else {
    el.textContent = fmtClock(tl);
    el.classList.remove("golden");
  }
  el.classList.remove("hidden");
}

function hideMatchClock() {
  if (!matchClockEl) return; // sin nodo no hay nada que ocultar (no crear de más)
  matchClockEl.classList.add("hidden");
  matchClockEl.classList.remove("golden");
  matchClockEl.textContent = "";
}

// Hint de teclas duo: 3 s al entrar a un partido duo con teclado (SPEC C).
function showDuoKeysHint() {
  if (!duoKeysHintEl) {
    duoKeysHintEl = $("duo-keys-hint");
    if (!duoKeysHintEl && screenGame) {
      injectV13Style();
      duoKeysHintEl = document.createElement("div");
      duoKeysHintEl.id = "duo-keys-hint";
      duoKeysHintEl.className = "duo-keys-hint";
      const tk = !match || match.tackles !== false;
      const a = document.createElement("div");
      a.textContent = "① WASD mover · F patear (mantené)" + (tk ? " · G barrer" : "");
      const b = document.createElement("div");
      b.textContent = "② Flechas mover · L patear (mantené)" + (tk ? " · K barrer" : "");
      duoKeysHintEl.append(a, b);
      screenGame.appendChild(duoKeysHintEl);
    }
  }
  if (!duoKeysHintEl) return;
  duoKeysHintEl.classList.remove("hidden");
  clearTimeout(duoHintTimer);
  // 3.6 s: la animación CSS duo-hint (3.4 s, forwards) hace el fade-out sola;
  // re-agregar .hidden recién después evita cortar el fade a mitad de camino.
  duoHintTimer = setTimeout(() => {
    duoHintTimer = 0;
    if (duoKeysHintEl) duoKeysHintEl.classList.add("hidden"); // se oculta solo
  }, 3600);
}

function hideDuoKeysHint() {
  if (duoHintTimer) {
    clearTimeout(duoHintTimer);
    duoHintTimer = 0;
  }
  if (duoKeysHintEl) duoKeysHintEl.classList.add("hidden");
}

// v1.3 (SPEC C): los botones ⚽/🦵 se ocultan SOLO en duo (las dos zonas
// táctiles cubren la pantalla); en los demás modos quedan como v1.2.
// Además de .hidden en cada botón, se togglea .duo-mode en #touch-controls y
// #screen-game (contrato del CSS v1.3: .duo-mode .touch-buttons{display:none}).
function updateTouchButtonsVisibility(duo) {
  // v1.4 E: el botón 🦵 se oculta también si la sala desactivó la barrida.
  const tacklesOn = !match || match.tackles !== false;
  if (btnKick) btnKick.classList.toggle("hidden", !!duo);
  if (btnTackle) btnTackle.classList.toggle("hidden", !!duo || !tacklesOn);
  const touchControls = $("touch-controls");
  if (touchControls) touchControls.classList.toggle("duo-mode", !!duo);
  if (screenGame) screenGame.classList.toggle("duo-mode", !!duo);
  // Clase global para que el CSS oculte leyendas/hints de barrida si tackles=off.
  if (screenGame) screenGame.classList.toggle("no-tackles", !tacklesOn);
}

/* =================================== Toasts ================================== */
function toast(message) {
  const t = document.createElement("div");
  t.className = "toast error";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 350);
  }, 2600);
}

/* =================================== Input =================================== */
// v1.3: los códigos crudos viven en keysDown; el vector se arma por KEYSET.
// No-duo: WASD y flechas juntos (= v1.2). Duo: A = WASD, B = flechas (SPEC C).
const MOVE_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);
const KEYSET_ALL = {
  up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
};
const KEYSET_A = { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] };
const KEYSET_B = { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] };

function keyVec(set) {
  const has = (codes) => {
    for (const c of codes) if (keysDown.has(c)) return true;
    return false;
  };
  let x = 0;
  let y = 0;
  if (has(set.up)) y -= 1;
  if (has(set.down)) y += 1;
  if (has(set.left)) x -= 1;
  if (has(set.right)) x += 1;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { mx: x, my: y };
}

// Input de movimiento actual del cuerpo `slot` (0 = A, 1 = B; B solo en duo).
function currentInputFor(slot) {
  const j = joys[slot];
  if (j.active && j.moved) return { mx: j.mx, my: j.my };
  if (j.active && !isDuo()) return { mx: j.mx, my: j.my };
  if (isDuo()) return keyVec(slot === 1 ? KEYSET_B : KEYSET_A);
  return keyVec(KEYSET_ALL);
}

/* ---------------------- KICK MANTENIDO (SPEC v1.4 I/J) ----------------------
 * El kick pasa a ser ESTADO MANTENIDO (true mientras la tecla/botón/dedo está
 * apretado), no un edge-trigger. Por cuerpo (slot) se mantiene un set de
 * "fuentes" que lo tienen apretado (teclado, botón, zona táctil): el kick está
 * MANTENIDO si hay alguna fuente activa. Esto convive con multitouch (varios
 * dedos) y con teclado+botón a la vez sin contar de menos al soltar uno solo. */
const kickHoldSources = [new Set(), new Set()];

function kickHeldFor(slot) {
  return kickHoldSources[slot === 1 ? 1 : 0].size > 0;
}

// Marca/desmarca una fuente de kick mantenido para un cuerpo y manda input
// inmediato en AMBOS flancos (apretar Y soltar, SPEC v1.4 I). Dispara feedback
// local solo en el flanco de SUBIDA real (cuando arranca a mantener).
function setKickHold(slot, source, held) {
  if (phase !== "game" || ended) return;
  const s = slot === 1 ? 1 : 0;
  const set = kickHoldSources[s];
  const before = set.size > 0;
  if (held) set.add(source);
  else set.delete(source);
  const after = set.size > 0;
  if (before === after) return;     // sin cambio efectivo del estado mantenido
  if (after) localKickFeedback(s);  // flanco de subida: pop/anillo inmediatos
  flushInput(true);                 // input inmediato al apretar Y al soltar
}

// Suelta TODAS las fuentes de kick de un cuerpo (blur, fin de partido, reset).
function releaseAllKick(slot) {
  const s = slot === 1 ? 1 : 0;
  if (kickHoldSources[s].size) {
    kickHoldSources[s].clear();
    flushInput(true);
  }
}

/* ---------------------- Envío de input (SPEC A/B, v1.4 I) ----------------------
 * Único punto de salida de {type:"input", seq, mx, my, kick, tackle[, b]}:
 * - INMEDIATO al cambiar el movimiento, al apretar/soltar kick (mantenido) o al
 *   presionar tackle (edge), con cap de 60 msgs/s; el keepalive 20 Hz reintenta.
 * - kick = ESTADO MANTENIDO (kickHeldFor); tackle = edge (queuedTackle, se
 *   consume al enviarse). seq incremental por conexión (arranca en 1).
 * - duo: UN solo mensaje — campos planos = cuerpo A (slot 0), objeto `b` = cuerpo
 *   B (slot 1), un solo seq. En no-duo no se manda `b`. */
function flushInput(force) {
  if (training) return; // v1.5: el entrenamiento es local, no envía input a la red
  if (phase !== "game" || ended || !ws || ws.readyState !== WebSocket.OPEN) return;
  const duo = isDuo();
  const a = currentInputFor(0);
  const b = duo ? currentInputFor(1) : null;
  const ka = kickHeldFor(0);
  const kb = duo ? kickHeldFor(1) : false;
  const changed =
    a.mx !== lastSentA.mx ||
    a.my !== lastSentA.my ||
    ka !== lastSentA.kick ||
    (duo && (b.mx !== lastSentB.mx || b.my !== lastSentB.my || kb !== lastSentB.kick));
  const hasAct = queuedTackle[0] || (duo && queuedTackle[1]);
  if (!force && !changed && !hasAct) return;
  const now = performance.now();
  if (now - lastInputSendT < INPUT_MIN_GAP_MS) return; // cap 60/s
  inputSeq += 1;
  const msg = {
    type: "input",
    seq: inputSeq,
    mx: a.mx,
    my: a.my,
    kick: ka,                 // ESTADO MANTENIDO (v1.4)
    tackle: queuedTackle[0],  // edge-trigger
  };
  if (duo) msg.b = { mx: b.mx, my: b.my, kick: kb, tackle: queuedTackle[1] };
  ws.send(JSON.stringify(msg));
  queuedTackle[0] = false;
  queuedTackle[1] = false;
  lastSentA.mx = a.mx;
  lastSentA.my = a.my;
  lastSentA.kick = ka;
  if (duo) {
    lastSentB.mx = b.mx;
    lastSentB.my = b.my;
    lastSentB.kick = kb;
  }
  lastInputSendT = now;
}

// Estado predicho/extrapolado más reciente de un cuerpo propio (para gatear el
// feedback): null si todavía no hay base. Lee del extWorld del último frame.
function ownExtState(slot) {
  if (!extWorld || !extWorld.byId || !match || !match.myBodyIds) return null;
  for (const pl of match.players) {
    if (pl.slot !== slot || !match.myBodyIds.has(pl.id)) continue;
    const e = extWorld.byId.get(pl.id);
    if (e) return e;
  }
  return null;
}

// Feedback local INMEDIATO de la patada (SPEC v1.4 J): pop + anillo + squash al
// disparar localmente, sin esperar al server. Se llama en el flanco de subida del
// kick mantenido. El server sigue siendo autoritativo; handleState saltea los
// cuerpos propios para no duplicar el sfx.
function localKickFeedback(slot) {
  const base = baseState ? baseBodyOf(slot) : null;
  if (base && (base.stun > 0 || base.slide > 0)) return; // sin control
  const now = performance.now();
  sfxKick();
  const e = ownExtState(slot) || base;
  if (!e) return;
  ringFx.push({ x: e.x, y: e.y, t: now });
  // Squash de la pelota si está al alcance real del kick (dist < 29 + holgura).
  const bx = extWorld ? extWorld.ball.x : baseState ? baseState.ball.x : null;
  const by = extWorld ? extWorld.ball.y : baseState ? baseState.ball.y : null;
  if (bx !== null && Math.hypot(bx - e.x, by - e.y) <= BALL_R + PLAYER_R + KICK_REACH + 4) {
    lastKickT = now;
  }
}

// Cuerpo del estado base autoritativo por slot (para chequear stun/slide).
function baseBodyOf(slot) {
  if (!baseState) return null;
  for (const pl of match.players) {
    if (pl.slot !== slot || !match.myBodyIds.has(pl.id)) continue;
    for (const b of baseState.bodies) if (b.id === pl.id) return b;
  }
  return null;
}

// Feedback local INMEDIATO de la barrida: slide-whistle + polvito al presionar.
function localTackleFeedback(slot) {
  const now = performance.now();
  if (now < tackleCdUntil[slot]) return; // cooldown visual conocido
  const base = baseBodyOf(slot);
  if (base && (base.stun > 0 || base.slide > 0)) return;
  sfxTackle();
  tackleCdUntil[slot] = now + TACKLE_COOLDOWN_MS;
  const e = ownExtState(slot) || base;
  if (e) {
    const fx = base ? base.fx : 1;
    const fy = base ? base.fy : 0;
    const n = Math.max(2, Math.round(4 * fxMult()));
    for (let i = 0; i < n; i++) {
      dustFx.push({
        x: e.x - fx * 6 + (Math.random() - 0.5) * 8,
        y: e.y - fy * 6 + (Math.random() - 0.5) * 8,
        vx: -fx * (40 + Math.random() * 50) + (Math.random() - 0.5) * 40,
        vy: -fy * (40 + Math.random() * 50) + (Math.random() - 0.5) * 40 - 14,
        r: 2 + Math.random() * 2.6,
        life: 0.45,
        maxLife: 0.45,
      });
    }
  }
}

function pressTackle(slot) {
  if (phase !== "game" || ended || !match || match.tackles === false) return;
  const s = slot === 1 ? 1 : 0;
  localTackleFeedback(s);
  queuedTackle[s] = true;
  flushInput(false);
}

function startInputLoop() {
  stopInputLoop();
  // Keepalive a 20 Hz: manda aunque nada haya cambiado; si hubo un envío hace
  // nada (cambio inmediato), solo flushea lo pendiente sin duplicar tráfico.
  inputTimer = setInterval(() => {
    flushInput(performance.now() - lastInputSendT >= KEEPALIVE_MS - 10);
  }, KEEPALIVE_MS);
}

function stopInputLoop() {
  if (inputTimer) {
    clearInterval(inputTimer);
    inputTimer = 0;
  }
  queuedTackle[0] = false;
  queuedTackle[1] = false;
  kickHoldSources[0].clear();
  kickHoldSources[1].clear();
  keysDown.clear();
  joyReset(0);
  joyReset(1);
}

// Códigos de tecla que MANTIENEN kick por cuerpo (estado mantenido, SPEC v1.4 J).
//   no-duo: Espacio / J ; duo: F (cuerpo A), L (cuerpo B).
const KICK_CODE = "__kick__"; // fuente de kick mantenido por teclado

window.addEventListener("keydown", (e) => {
  if (phase !== "game") return;
  // v1.5: R reinicia la pelota en entrenamiento.
  if (training && (e.code === "KeyR")) {
    e.preventDefault();
    resetTrainingBall(true);
    return;
  }
  if (MOVE_CODES.has(e.code)) {
    keysDown.add(e.code);
    e.preventDefault();
    flushInput(false); // input INMEDIATO al cambiar el movimiento (SPEC A)
    return;
  }
  if (isDuo()) {
    // v1.4 J: cuerpo A = F kick MANTENIDO / G barrer (edge); B = L kick / K barrer.
    if (e.code === "KeyF") {
      e.preventDefault();
      setKickHold(0, KICK_CODE, true);
    } else if (e.code === "KeyL") {
      e.preventDefault();
      setKickHold(1, KICK_CODE, true);
    } else if (e.code === "KeyG") {
      if (e.repeat) return;
      e.preventDefault();
      pressTackle(0);
    } else if (e.code === "KeyK") {
      if (e.repeat) return;
      e.preventDefault();
      pressTackle(1);
    }
  } else if (e.code === "Space" || e.code === "KeyJ") {
    e.preventDefault();
    setKickHold(0, KICK_CODE, true); // kick MANTENIDO mientras esté apretado
  } else if (e.key === "Shift" || e.code === "KeyK") {
    if (e.repeat) return;
    e.preventDefault();
    pressTackle(0);
  }
});

window.addEventListener("keyup", (e) => {
  if (keysDown.delete(e.code)) {
    flushInput(false); // freno/cambio inmediato
    return;
  }
  // Soltar kick mantenido (flanco de bajada → input inmediato, SPEC v1.4 I).
  if (isDuo()) {
    if (e.code === "KeyF") setKickHold(0, KICK_CODE, false);
    else if (e.code === "KeyL") setKickHold(1, KICK_CODE, false);
  } else if (e.code === "Space" || e.code === "KeyJ") {
    setKickHold(0, KICK_CODE, false);
  }
});

window.addEventListener("blur", () => {
  keysDown.clear();
  releaseAllKick(0); // soltar kick mantenido al perder foco
  releaseAllKick(1);
  flushInput(true); // soltar todo: avisar al server ya
});

/* ------------------------------ Joysticks DINÁMICOS ------------------------------ */
// v1.1: el joystick aparece centrado donde toca el dedo (no posición fija) y se
// posiciona con estilos inline (position:fixed + translate(-50%,-50%)) para no
// depender del CSS. v1.3 (SPEC C): en duo la pantalla se parte en DOS ZONAS
// (mitad izquierda = cuerpo A, derecha = cuerpo B) con un joystick INDEPENDIENTE
// por zona (multitouch por touch identifier, un dedo por zona) + gestos:
//   TAP  (< 220 ms y < 12 px)  → patear ese cuerpo (el tap no mueve)
//   DOBLE TAP (≤ 300 ms del 1º) → barrida (el 1º ya pateó: patada y barrida)
// En modos no-duo: una sola zona (mitad izquierda), idéntico a v1.2, sin gestos.

// El visual de la zona B es un CLON de #touch-joystick (se crea on-demand: el
// HTML v1.2 trae uno solo); hereda el CSS del original.
let joyElB = null;
let joyStickB = null;

function ensureJoyElB() {
  if (joyElB || !joystickEl || !joystickEl.parentNode) return;
  joyElB = joystickEl.cloneNode(true);
  joyElB.removeAttribute("id");
  joyElB.classList.add("joystick-b");
  joyElB.classList.remove("active");
  joyElB.style.visibility = "hidden";
  joystickEl.parentNode.appendChild(joyElB);
  joyStickB = joyElB.querySelector(".joystick-stick");
}

function joyEls(zone) {
  if (zone === 1) {
    ensureJoyElB();
    return { el: joyElB, stick: joyStickB };
  }
  return { el: joystickEl, stick: joystickStick };
}

function joyStart(zone, t) {
  const j = joys[zone];
  j.active = true;
  j.id = t.identifier;
  j.ox = t.clientX;
  j.oy = t.clientY;
  j.mx = 0;
  j.my = 0;
  j.moved = false;
  j.startT = performance.now();
  const parts = joyEls(zone);
  if (parts.el) {
    parts.el.classList.add("active");
    parts.el.style.position = "fixed";
    parts.el.style.left = t.clientX + "px";
    parts.el.style.top = t.clientY + "px";
    parts.el.style.transform = "translate(-50%, -50%)";
    parts.el.style.visibility = "visible";
  }
  if (parts.stick) parts.stick.style.transform = "";
  // v1.4 J (duo): el dedo apoyado SIN arrastrar mantiene kick de ese cuerpo. Se
  // suelta al arrastrar (joyMove) o al levantar (joyEnd). En no-duo el kick va
  // por el botón ⚽ (esta zona izquierda solo mueve).
  if (isDuo()) setKickHold(zone, TOUCH_KICK, true);
}

const TOUCH_KICK = "__touch__"; // fuente de kick mantenido por zona táctil

function joyMove(zone, t) {
  const j = joys[zone];
  let dx = t.clientX - j.ox;
  let dy = t.clientY - j.oy;
  const d = Math.hypot(dx, dy);
  // v1.4 J (duo): el dedo arranca como KICK MANTENIDO (sin arrastrar = cargar el
  // disparo). Al superar el umbral de arrastre (12 px) pasa a MOVER y SUELTA el
  // kick mantenido de esa zona. En no-duo responde desde el primer px (v1.2).
  if (isDuo() && !j.moved) {
    if (d < TAP_MOVE_PX) return;
    j.moved = true;
    setKickHold(zone, TOUCH_KICK, false); // arrastrar cancela el kick mantenido
  }
  if (d > JOY_RADIUS) {
    dx *= JOY_RADIUS / d;
    dy *= JOY_RADIUS / d;
  }
  const parts = joyEls(zone);
  if (parts.stick) {
    parts.stick.style.transform =
      "translate(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px)";
  }
  j.mx = dx / JOY_RADIUS;
  j.my = dy / JOY_RADIUS;
  flushInput(false); // input inmediato al mover el stick (cap 60/s adentro)
}

function joyReset(zone) {
  const j = joys[zone];
  j.active = false;
  j.id = null;
  j.mx = 0;
  j.my = 0;
  j.moved = false;
  // Ojo: NO usar joyEls acá (crearía el clon de la zona B sin necesidad).
  const el = zone === 1 ? joyElB : joystickEl;
  const stick = zone === 1 ? joyStickB : joystickStick;
  if (stick) stick.style.transform = "";
  if (el) {
    el.classList.remove("active");
    el.style.visibility = "hidden";
  }
}

window.addEventListener(
  "touchstart",
  (e) => {
    if (phase !== "game" || ended) return;
    const duo = isDuo();
    for (const t of e.changedTouches) {
      const tgt = t.target;
      // No robar toques destinados a botones/links/modal (kick los maneja aparte).
      if (tgt && tgt.closest && tgt.closest("button, a, #options-modal")) continue;
      let zone = 0;
      if (duo) {
        zone = t.clientX < window.innerWidth / 2 ? 0 : 1; // mitades A / B (SPEC C)
      } else if (t.clientX > window.innerWidth / 2) {
        continue; // v1.2: solo mitad izquierda
      }
      if (joys[zone].active) continue; // un dedo por zona
      e.preventDefault();
      joyStart(zone, t);
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  (e) => {
    for (const t of e.changedTouches) {
      for (let z = 0; z < 2; z++) {
        const j = joys[z];
        if (j.active && t.identifier === j.id) {
          e.preventDefault();
          joyMove(z, t);
        }
      }
    }
  },
  { passive: false }
);

function joyEnd(e, cancelled) {
  for (const t of e.changedTouches) {
    for (let z = 0; z < 2; z++) {
      const j = joys[z];
      if (!j.active || t.identifier !== j.id) continue;
      const now = performance.now();
      const wasShortHold = !j.moved && now - j.startT < TAP_MS;
      // v1.4 J (duo): mantener el dedo sin arrastrar = kick mantenido (ya activo
      // desde joyStart); al LEVANTAR se suelta (flanco de bajada). DOBLE TAP
      // mantenido sigue disponible para barrida si la sala la permite.
      if (isDuo()) {
        setKickHold(z, TOUCH_KICK, false); // soltar el kick mantenido de la zona
        if (!cancelled && wasShortHold && match && match.tackles !== false) {
          if (now - j.lastTapT <= DOUBLE_TAP_MS) {
            pressTackle(z);
            j.lastTapT = -1e9; // un tercer tap arranca una secuencia nueva
          } else {
            j.lastTapT = now;
          }
        }
      }
      joyReset(z);
      flushInput(true); // freno/soltado inmediato
    }
  }
}
window.addEventListener("touchend", (e) => joyEnd(e, false));
window.addEventListener("touchcancel", (e) => joyEnd(e, true));

// Botón edge-trigger (barrida): dispara onPress al apretar, nada al soltar.
function bindEdgeButton(btn, onPress) {
  if (!btn) return;
  btn.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      btn.classList.add("pressed");
      onPress();
    },
    { passive: false }
  );
  const release = (e) => {
    if (e.cancelable) e.preventDefault();
    btn.classList.remove("pressed");
  };
  btn.addEventListener("touchend", release);
  btn.addEventListener("touchcancel", release);
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onPress();
  });
}

// Botón de kick MANTENIDO (⚽, SPEC v1.4 J): kick true mientras el dedo está
// sobre el botón; flanco de subida/bajada mandan input inmediato.
const BTN_KICK = "__btnkick__";
function bindKickButton(btn, slot) {
  if (!btn) return;
  const down = (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
    setKickHold(slot, BTN_KICK, true);
  };
  const up = (e) => {
    if (e.cancelable) e.preventDefault();
    btn.classList.remove("pressed");
    setKickHold(slot, BTN_KICK, false);
  };
  btn.addEventListener("touchstart", down, { passive: false });
  btn.addEventListener("touchend", up);
  btn.addEventListener("touchcancel", up);
  btn.addEventListener("mousedown", down);
  btn.addEventListener("mouseup", up);
  btn.addEventListener("mouseleave", up);
}
// Los botones ⚽/🦵 siempre operan el cuerpo A (en duo están ocultos, SPEC J).
bindKickButton(btnKick, 0);
bindEdgeButton(btnTackle, () => pressTackle(0));

/* ==================== Mobile: fullscreen, orientación y vibración ==================== */
function enterGameDisplay() {
  if (!IS_TOUCH) return;
  try {
    const p = document.documentElement.requestFullscreen &&
      document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    /* sin fullscreen: no pasa nada (SPEC) */
  }
  try {
    const o = screen.orientation;
    const p = o && o.lock && o.lock("landscape");
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    /* sin lock: no pasa nada (SPEC) */
  }
}

// Reintento de fullscreen+landscape CON user activation: el auto-arranque llega
// ~3 s después del último ready, así que para la mayoría handleStart corre sin
// gesto reciente y requestFullscreen()/orientation.lock() se rechazan en silencio.
// El primer toque DENTRO del partido (joystick/botones) sí tiene activation
// (pointerdown es activation-triggering; touchstart NO lo es).
document.addEventListener(
  "pointerdown",
  () => {
    if (IS_TOUCH && phase === "game" && !document.fullscreenElement) enterGameDisplay();
  },
  true
);

function exitGameDisplay() {
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (err) {
    /* ignorar */
  }
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      const p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => {});
    }
  } catch (err) {
    /* ignorar */
  }
}

const portraitMq = window.matchMedia ? window.matchMedia("(orientation: portrait)") : null;

// "📱↻ Girá el teléfono": visible SOLO en táctil + portrait + durante el partido.
function updateRotateOverlay() {
  if (!rotateOverlay) return;
  const show = IS_TOUCH && phase === "game" && !!(portraitMq && portraitMq.matches);
  rotateOverlay.classList.toggle("hidden", !show);
}

if (portraitMq) {
  if (portraitMq.addEventListener) portraitMq.addEventListener("change", updateRotateOverlay);
  else if (portraitMq.addListener) portraitMq.addListener(updateRotateOverlay);
}

function vibrate(ms) {
  if (!settings.vibration) return;
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (err) {
    /* ignorar */
  }
}

/* ============================ Sonido (WebAudio) ============================= */
let audioCtx = null;
// GainNode master: TODOS los sfx se rutean por acá. Su .gain refleja el volumen
// de opciones EN VIVO (bajar a 0 silencia también los sonidos ya sonando).
let masterGain = null;

function ensureAudio() {
  if (audioCtx) {
    // iOS/Safari pueden suspender el contexto (interrupciones, cambio de
    // pestaña): reanudarlo en cada gesto para que los sfx no queden mudos.
    if (audioCtx.state === "suspended") audioCtx.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = masterVol();
      masterGain.connect(audioCtx.destination);
      // Clips del pack de voz bajados antes de que existiera el contexto
      // (decodeAudioData lo necesita): decodificarlos ahora (v1.2, SPEC D).
      voicePackDecodePending();
    }
  } catch (err) {
    audioCtx = null;
    masterGain = null;
  }
}
// El AudioContext se crea en el primer gesto del usuario (SPEC).
document.addEventListener("pointerdown", ensureAudio, true);
document.addEventListener("keydown", ensureAudio, true);
document.addEventListener("touchstart", ensureAudio, true);

// Volumen master desde opciones (0..1). Lo aplica masterGain (todos los sfx se
// rutean por él); acá solo se usa para sincronizarlo y para el early-out si es 0.
function masterVol() {
  const s = typeof settings.sound === "number" ? settings.sound : 100;
  return Math.max(0, Math.min(1, s / 100));
}

// Fuente de ruido blanco de `dur` segundos (helper de los sfx).
function noiseBurst(dur) {
  if (!audioCtx) return null;
  const n = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  return src;
}

// SFX v1.1 — patada: "pop" seco y gracioso (subida rápida de tono + click).
// Llamada: handleState al detectar salto de kc en cualquier jugador.
function sfxKick() {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(950, t + 0.03);
  o.frequency.exponentialRampToValueAtTime(260, t + 0.09);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g);
  g.connect(masterGain);
  o.start(t);
  o.stop(t + 0.14);
  // Click de contacto.
  const click = noiseBurst(0.03);
  if (click) {
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(ng);
    ng.connect(masterGain);
    click.start(t);
  }
}

// SFX v1.1 — barrida: slide-whistle descendente + "boing" de resorte.
// Llamada: handleState al detectar arranque de slide en cualquier jugador.
function sfxTackle() {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const t = audioCtx.currentTime;
  // Slide-whistle descendente.
  const w = audioCtx.createOscillator();
  const wg = audioCtx.createGain();
  w.type = "triangle";
  w.frequency.setValueAtTime(1250, t);
  w.frequency.exponentialRampToValueAtTime(320, t + 0.34);
  wg.gain.setValueAtTime(0.22, t);
  wg.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
  w.connect(wg);
  wg.connect(masterGain);
  w.start(t);
  w.stop(t + 0.38);
  // "Boing": portadora grave con vibrato profundo que se va apagando.
  const t1 = t + 0.24;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(170, t1);
  const lfo = audioCtx.createOscillator();
  const lg = audioCtx.createGain();
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(26, t1);
  lfo.frequency.exponentialRampToValueAtTime(9, t1 + 0.5);
  lg.gain.setValueAtTime(95, t1);
  lg.gain.exponentialRampToValueAtTime(4, t1 + 0.5);
  lfo.connect(lg);
  lg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t1);
  g.gain.exponentialRampToValueAtTime(0.32, t1 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t1 + 0.55);
  o.connect(g);
  g.connect(masterGain);
  o.start(t1);
  o.stop(t1 + 0.6);
  lfo.start(t1);
  lfo.stop(t1 + 0.6);
}

// SFX v1.1 — gol: bocina de aire + ovación de la hinchada (ruido filtrado).
// Llamadas: handleGoal y handleGameover.
function sfxGoal() {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const t = audioCtx.currentTime;
  // Bocina: sierras desafinadas + subarmónico, con caída final de tono.
  const horn = audioCtx.createGain();
  horn.gain.setValueAtTime(0.0001, t);
  horn.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
  horn.gain.setValueAtTime(0.3, t + 0.55);
  horn.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1500;
  lp.connect(horn);
  horn.connect(masterGain);
  for (const f of [392, 396, 196]) {
    const o = audioCtx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, t);
    o.frequency.setValueAtTime(f, t + 0.6);
    o.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.9);
    const og = audioCtx.createGain();
    og.gain.value = f < 300 ? 0.5 : 0.33;
    o.connect(og);
    og.connect(lp);
    o.start(t);
    o.stop(t + 0.95);
  }
  // Ovación: ruido con bandpass que crece y se apaga.
  const dur = 2.4;
  const src = noiseBurst(dur);
  if (src) {
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1400, t + 0.7);
    bp.frequency.linearRampToValueAtTime(800, t + dur);
    bp.Q.value = 0.7;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(masterGain);
    src.start(t);
  }
}

// SFX v1.1 — "doink" de rebote en pared, con rate-limit de 90 ms. Cableado en
// handleState (inversión de signo de velocidad de la pelota a velocidad > 180).
function sfxBounce() {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const nowMs = performance.now();
  if (nowMs - lastBounceMs < 90) return;
  lastBounceMs = nowMs;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(430, t);
  o.frequency.exponentialRampToValueAtTime(190, t + 0.08);
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g);
  g.connect(masterGain);
  o.start(t);
  o.stop(t + 0.12);
}

// SFX v1.1 — beep de cuenta regresiva (más agudo y largo en el último número).
// Cableado en showLobbyCountdown (lobby) y showCountdown (kickoff post-gol).
function sfxCountdown(nLeft) {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const n = parseInt(nLeft, 10);
  const last = isFinite(n) && n <= 1;
  const t = audioCtx.currentTime;
  const dur = last ? 0.28 : 0.11;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(last ? 988 : 659, t);
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// SFX v1.1 — fanfarria desafinada estilo kazoo para el campeón (handleGameover).
function sfxChampion() {
  if (!audioCtx || !masterGain || masterVol() <= 0) return;
  const t0 = audioCtx.currentTime + 0.45; // deja sonar primero la bocina del gol
  const notes = [
    [392, 0.0, 0.16],
    [523, 0.18, 0.16],
    [659, 0.36, 0.16],
    [784, 0.54, 0.7],
  ];
  for (const [f, at, dur] of notes) kazooNote(f, t0 + at, dur, dur > 0.5);
}

// Nota "kazoo": dos osciladores desafinados al azar + bandpass zumbón.
function kazooNote(freq, t, dur, wobble) {
  const detune = 1 + (Math.random() * 0.05 - 0.025); // desafinada ±2.5%
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(2400, freq * 2.6);
  bp.Q.value = 1.4;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
  g.gain.setValueAtTime(0.2, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  bp.connect(g);
  g.connect(masterGain);
  const oscs = [];
  for (const mul of [1, 1.012]) {
    const o = audioCtx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq * detune * mul, t);
    o.connect(bp);
    o.start(t);
    o.stop(t + dur + 0.03);
    oscs.push(o);
  }
  if (wobble) {
    const lfo = audioCtx.createOscillator();
    const lg = audioCtx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 7;
    lg.gain.value = freq * 0.02;
    lfo.connect(lg);
    for (const o of oscs) lg.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
  }
}

/* ========================== Relator (speechSynthesis) ========================== */
// RELATOR en español. Voz: es-AR > es-419 > es-MX > es-US > es-ES > cualquier es*.
// Eventos cableados (etapa 1):
//   commentator("start", {})                  ← handleStart
//   commentator("goal", { name, streak })     ← handleGoal (streak ≥ 2 ⇒ racha)
//   commentator("owngoal", { name })          ← handleGoal (gol en contra)
//   commentator("tackle", { name, rival })    ← handleState (stun nuevo; name = el que barre)
//   commentator("gameover", { name })         ← handleGameover (nombres del equipo)
let relatorVoice = null;

function pickRelatorVoice() {
  if (!("speechSynthesis" in window)) return null;
  let voices = [];
  try {
    voices = speechSynthesis.getVoices() || [];
  } catch (err) {
    return null;
  }
  const norm = (l) => (l || "").toLowerCase().replace("_", "-");
  for (const pref of ["es-ar", "es-419", "es-mx", "es-us", "es-es"]) {
    const v = voices.find((vo) => norm(vo.lang) === pref);
    if (v) return v;
  }
  return voices.find((vo) => norm(vo.lang).indexOf("es") === 0) || null;
}

if ("speechSynthesis" in window) {
  relatorVoice = pickRelatorVoice();
  try {
    speechSynthesis.addEventListener("voiceschanged", () => {
      relatorVoice = pickRelatorVoice();
    });
  } catch (err) {
    try {
      speechSynthesis.onvoiceschanged = () => {
        relatorVoice = pickRelatorVoice();
      };
    } catch (err2) {
      /* sin relator */
    }
  }
}

let speakPrio = 0;
let speakUntil = 0;

// No solapar frases: se cancela la anterior; una frase de prioridad menor no
// pisa a una mayor que todavía está sonando (gol/campeón > barrida).
function relatorSay(text, prio, rate, pitch) {
  if (!settings.relator) return;
  if (!("speechSynthesis" in window)) return;
  const nowMs = performance.now();
  // speakUntil/speakPrio también los setea un clip del pack en curso (v1.2):
  // la síntesis no habla encima de un clip de prioridad mayor.
  if (nowMs < speakUntil && prio < speakPrio) return;
  try {
    voiceClipStop(); // no solapar la síntesis con un clip del pack (SPEC D)
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (!relatorVoice) relatorVoice = pickRelatorVoice();
    if (relatorVoice) {
      u.voice = relatorVoice;
      u.lang = relatorVoice.lang;
    } else {
      u.lang = "es-AR";
    }
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    u.onend = () => {
      speakUntil = 0;
    };
    speakPrio = prio;
    speakUntil = nowMs + 700 + text.length * 75; // estimación por si onend no llega
    speechSynthesis.speak(u);
  } catch (err) {
    /* sin relator */
  }
}

function relatorStop() {
  voiceClipStop(); // v1.2: también corta el clip del pack en curso
  speakUntil = 0;
  speakPrio = 0;
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch (err) {
    /* ignorar */
  }
}

function pickPhrase(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function commentator(event, data) {
  if (!settings.relator) return;
  const d = data || {};
  // v1.2 (SPEC D): primero el pack de voz REAL, mapeando los MISMOS eventos del
  // sintético: "gameover" → "win"; un gol con racha ≥ 2 prefiere "streak" y cae
  // a "goal" si el pack no lo trae. Si el pack no cubre el evento (sin manifest,
  // evento ausente o todos sus archivos fallaron) → síntesis SOLO para este.
  const packEvents =
    event === "gameover"
      ? ["win"]
      : event === "goal" && typeof d.streak === "number" && d.streak >= 2
        ? ["streak", "goal"]
        : [event];
  for (const pe of packEvents) {
    if (voicePackSay(pe)) return; // sonando (o descartado por no-solapado)
  }
  const name = typeof d.name === "string" ? d.name : "";
  const rival = typeof d.rival === "string" ? d.rival : "";
  let text = "";
  let prio = 1;
  let rate = 1.05;
  let pitch = 1;
  switch (event) {
    case "start": {
      const arr = ["¡Arranca el partido!", "¡Rueda la pelota!"];
      if (match && match.players.length) {
        // v1.3: nombres de USUARIOS (en duo cada usuario tiene 2 cuerpos).
        const pool = [];
        const seen = new Set();
        for (const p of match.players) {
          const nm = bodyUserName(p);
          if (!nm || seen.has(nm)) continue;
          seen.add(nm);
          pool.push(nm);
        }
        if (pool.length) {
          arr.push("Sale jugando " + pool[Math.floor(Math.random() * pool.length)] + "...");
        }
      }
      text = pickPhrase(arr);
      prio = 2;
      break;
    }
    case "goal": {
      if (!name) return;
      text = pickPhrase([
        "¡GOOOOOL de " + name + "!",
        "¡Golazo de " + name + "!",
        "¡La mandó a guardar " + name + "!",
        "¡Qué definición de " + name + ", no lo puedo creer!",
      ]);
      if (typeof d.streak === "number" && d.streak >= 2) {
        text += " ¡" + name + " está intratable!";
      }
      prio = 3;
      rate = 1.12;
      pitch = 1.1;
      break;
    }
    case "owngoal": {
      if (!name) return;
      text = pickPhrase([
        "¡En contra! ¡Insólito lo de " + name + "!",
        "¡" + name + " le erró al arco... metió un gol en contra!",
      ]);
      prio = 3;
      rate = 1.1;
      break;
    }
    case "tackle": {
      const arr = ["¡Eso es roja, árbitro!"];
      if (name) arr.push("¡Tremenda patada de " + name + "!");
      if (rival) arr.push("¡Le pegó una patada criminal a " + rival + "!");
      text = pickPhrase(arr);
      prio = 1;
      break;
    }
    case "gameover": {
      if (!name) return;
      text = pickPhrase([
        "¡" + name + ", campeón del PoliGol!",
        "¡Se terminó! ¡La copa es de " + name + "!",
      ]);
      prio = 4;
      pitch = 1.08;
      break;
    }
    default:
      return;
  }
  if (text) relatorSay(text, prio, rate, pitch);
}

/* ==================== Relator — packs de voz reales (v1.2, SPEC D) ====================
 * Si existe public/voices/manifest.json el relator usa AUDIO REAL: el manifest
 * se baja UNA sola vez al entrar al juego (404 silencioso → sintético) y cada
 * clip se pre-carga fetch → ArrayBuffer → decodeAudioData → AudioBuffer. La
 * reproducción sale por el masterGain (respeta volumen/mute EN VIVO, como los
 * sfx). Eventos del manifest: start / goal / owngoal / tackle / streak / win.
 * Dentro de un evento se elige un clip AL AZAR (sin repetir el último si hay
 * 2+). No-solapado (SPEC D): si hay un relato sonando (clip o síntesis), el
 * clip nuevo solo lo reemplaza si es de la familia de gol o el campeón
 * ("goal"/"win"; owngoal y streak son variantes del evento de gol) y no pisa
 * uno de prioridad mayor; si no, se DESCARTA sin fallback (ya hay relato).
 * Si el pack no tiene un evento o ninguno de sus archivos cargó/decodificó:
 * fallback al relator speechSynthesis v1.1 SOLO para ese evento. */

const VOICE_EVENTS = ["start", "goal", "owngoal", "tackle", "streak", "win"];
// Eventos que pueden pisar un relato en curso (familia de gol + campeón).
const VOICE_REPLACERS = { goal: true, owngoal: true, streak: true, win: true };
// Prioridades espejo de las del relator sintético (coordinan pack ↔ síntesis).
const VOICE_PRIO = { start: 2, goal: 3, owngoal: 3, streak: 3, tackle: 1, win: 4 };

let voicePackState = "idle"; // "idle" | "loading" | "ready" | "none" (= sintético)
let voicePackName = "";      // manifest.name (para #relator-pack-label)
let voicePackEvents = null;  // { evento: [{ file, raw, buffer, failed }] }
let voiceClipSource = null;  // AudioBufferSourceNode del clip sonando (o null)
let voiceClipUntil = 0;      // performance.now() en que termina el clip en curso
const voiceLastIdx = {};     // último índice elegido por evento (evita repetir)

// Carga única del pack ("al entrar al juego": handleStarting/handleStart la
// llaman; el estado la hace idempotente). Cualquier falla global ⇒ "none".
function loadVoicePack() {
  if (voicePackState !== "idle") return;
  if (typeof fetch !== "function") {
    voicePackState = "none";
    return;
  }
  voicePackState = "loading";
  fetch("voices/manifest.json")
    .then((res) => {
      if (!res.ok) throw new Error("sin manifest"); // 404 silencioso → sintético
      return res.json();
    })
    .then((manifest) => {
      const events =
        manifest &&
        typeof manifest === "object" &&
        manifest.events &&
        typeof manifest.events === "object"
          ? manifest.events
          : null;
      if (!events) throw new Error("manifest inválido");
      voicePackName =
        typeof manifest.name === "string" && manifest.name.trim()
          ? manifest.name.trim().slice(0, 40)
          : "Pack de voz";
      voicePackEvents = {};
      const jobs = [];
      for (const ev of VOICE_EVENTS) {
        const files = Array.isArray(events[ev]) ? events[ev] : [];
        const clips = [];
        for (const file of files) {
          if (typeof file !== "string" || !file) continue;
          const clip = { file, raw: null, buffer: null, failed: false };
          clips.push(clip);
          jobs.push(
            fetch("voices/" + file)
              .then((r) => {
                if (!r.ok) throw new Error("audio " + r.status);
                return r.arrayBuffer();
              })
              .then((raw) => {
                clip.raw = raw;
                return voiceDecodeClip(clip); // decodifica ya si hay AudioContext
              })
              .catch(() => {
                clip.failed = true; // ESTE archivo falla → fallback solo de él
              })
          );
        }
        if (clips.length) voicePackEvents[ev] = clips;
      }
      if (!jobs.length) throw new Error("manifest sin clips");
      return Promise.all(jobs);
    })
    .then(voicePackFinalize)
    .catch(() => {
      // Sin manifest / JSON roto / sin clips: relator sintético, sin ruido.
      voicePackEvents = null;
      voicePackName = "";
      voicePackState = "none";
      updateRelatorPackLabel();
    });
}

// ArrayBuffer → AudioBuffer. Necesita audioCtx: si aún no existe, el raw queda
// guardado y voicePackDecodePending() lo decodifica al crearse el contexto.
function voiceDecodeClip(clip) {
  if (!audioCtx || !clip.raw || clip.buffer || clip.failed) return Promise.resolve();
  const raw = clip.raw;
  clip.raw = null; // decodeAudioData detacha el buffer: una sola chance
  return new Promise((resolve) => {
    const ok = (buf) => {
      if (buf) clip.buffer = buf;
      resolve();
    };
    const fail = () => {
      clip.failed = true;
      resolve();
    };
    try {
      // Forma con callbacks (Safari viejo) + promesa (browsers modernos).
      const p = audioCtx.decodeAudioData(raw, ok, fail);
      if (p && typeof p.then === "function") p.then(ok, fail);
    } catch (err) {
      fail();
    }
  });
}

// Decodifica los clips que quedaron en raw por no haber AudioContext todavía.
// La llama ensureAudio() al crear el contexto (primer gesto del usuario).
function voicePackDecodePending() {
  if (!voicePackEvents || !audioCtx) return;
  const jobs = [];
  for (const ev in voicePackEvents) {
    for (const clip of voicePackEvents[ev]) jobs.push(voiceDecodeClip(clip));
  }
  // Si la carga ya cerró ("ready"), re-evaluar al terminar (raws → buffers o
  // failed). Si sigue "loading", el finalize de loadVoicePack se encarga.
  if (voicePackState === "ready" && jobs.length) {
    Promise.all(jobs).then(voicePackFinalize);
  }
}

// Estado final del pack: "ready" si quedó algún clip usable (decodificado o
// pendiente de decodificar por falta de contexto), "none" si fallaron todos.
function voicePackFinalize() {
  let usable = false;
  if (voicePackEvents) {
    for (const ev in voicePackEvents) {
      for (const clip of voicePackEvents[ev]) {
        if (clip.buffer || clip.raw) usable = true;
      }
    }
  }
  voicePackState = usable ? "ready" : "none";
  updateRelatorPackLabel();
}

// Corta el clip del pack en curso (relatorStop, relatorSay y voicePackSay).
function voiceClipStop() {
  if (voiceClipSource) {
    const src = voiceClipSource;
    voiceClipSource = null; // antes de stop(): que su onended no pise estado ajeno
    try {
      src.stop();
    } catch (err) {
      /* ya parado */
    }
  }
  voiceClipUntil = 0;
}

// #relator-pack-label (opciones, SPEC D/F): nombre del pack o "Voz sintética".
function updateRelatorPackLabel() {
  if (!relatorPackLabel) return;
  relatorPackLabel.textContent =
    voicePackState === "ready" && voicePackName ? voicePackName : "Voz sintética";
}

// Intenta relatar `event` con el pack. true ⇒ el evento quedó CUBIERTO por el
// pack (clip sonando, o descartado por la política de no-solapado: NO hablar
// síntesis encima). false ⇒ usar el fallback sintético para este evento.
function voicePackSay(event) {
  if (voicePackState !== "ready" || !voicePackEvents) return false;
  if (!audioCtx || !masterGain) return false; // sin WebAudio no hay clips
  const all = voicePackEvents[event];
  if (!all || !all.length) return false; // el pack no trae este evento
  const clips = all.filter((c) => c.buffer);
  if (!clips.length) {
    voicePackDecodePending(); // por si quedaron raws sin decodificar
    return false; // (todavía) sin audio usable para este evento → sintético
  }
  const prio = VOICE_PRIO[event] || 1;
  const nowMs = performance.now();
  const sounding = (voiceClipSource && nowMs < voiceClipUntil) || nowMs < speakUntil;
  // No-solapado (SPEC D): solo gol/campeón pisan un relato en curso, y nunca
  // a uno de prioridad mayor (un gol no corta el relato del campeón).
  if (sounding && (!VOICE_REPLACERS[event] || prio < speakPrio)) return true;

  // Clip al azar dentro del evento (sin repetir el último si hay más de uno).
  let idx = Math.floor(Math.random() * clips.length);
  if (clips.length > 1 && idx === voiceLastIdx[event]) idx = (idx + 1) % clips.length;
  voiceLastIdx[event] = idx;
  const buffer = clips[idx].buffer;

  voiceClipStop();
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel(); // corta la síntesis
  } catch (err) {
    /* ignorar */
  }
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(masterGain); // volumen/mute de opciones EN VIVO (SPEC D)
    src.onended = () => {
      if (voiceClipSource === src) {
        voiceClipSource = null;
        voiceClipUntil = 0;
        speakUntil = 0; // libera el "canal" del relator para los que siguen
        speakPrio = 0;
      }
    };
    src.start();
    voiceClipSource = src;
    voiceClipUntil = nowMs + buffer.duration * 1000 + 80;
    speakPrio = prio; // síntesis y próximos clips respetan este relato
    speakUntil = voiceClipUntil;
  } catch (err) {
    voiceClipSource = null;
    voiceClipUntil = 0;
    return false; // no se pudo reproducir → que hable la síntesis
  }
  return true;
}

/* =============== EXTRAPOLACIÓN DE MUNDO COMPLETO (SPEC v1.4 H) ===============
 * El "sin delay" de HaxBall: el cliente clona el ÚLTIMO estado autoritativo y lo
 * simula hacia adelante `ext` ticks con la MISMA física del server (stepWorld del
 * núcleo, mismo orden, mismas fórmulas, mismas constantes). Aplica:
 *   - los inputs REALES de los cuerpos propios → respuesta instantánea, 0 delay;
 *   - el último input conocido de los rivales (se asume que siguen igual);
 *   - la pelota se simula con TODOS (tu kick la mueve YA, localmente).
 * Reconciliación POR DISCO (pelota incluida): al llegar un snapshot se reemplaza
 * el estado base por el del server y la diferencia con lo que se mostraba se
 * absorbe con un offset que decae ~120 ms; si el error es enorme (> 60 u) ⇒ snap.
 * NO se duplica ninguna fórmula: toda la física vive en physics-core.js. */

// Cantidad de ticks de extrapolación (SPEC v1.4 H). settings.extrapolation:
//   0  = "Auto" adaptativo = round(RTT/2 / 16.67) + 1, clamp [1, 12].
//   >0 = ms fijos → round(ms / 16.67), clamp [0, 12] (0 ⇒ ver el pasado interpolado).
function extTicks() {
  const forced = settings.extrapolation;
  if (forced > 0) return Math.max(0, Math.min(EXT_MAX, Math.round(forced / TICK_MS)));
  const auto = Math.round(lastRttMs / 2 / TICK_MS) + 1;
  return Math.max(1, Math.min(EXT_MAX, auto));
}

// Construye el estado base de stepWorld a partir de un snapshot del server. Crea
// los cuerpos con makeBody (todos los campos del modelo v1.4) y los popula con el
// estado autoritativo: pos/vel en u/tick, stun/slide/kickCd en TICKS, kickArmed.
function buildBaseFromSnap(pm, ball) {
  const bodies = [];
  for (const pl of match.players) {
    const sp = pm.get(pl.id);
    const b = PHYS.makeBody({
      id: pl.id, team: pl.team, slot: pl.slot, owner: pl.owner,
      x: sp ? sp.x : 0, y: sp ? sp.y : 0,
      fx: sp ? sp.fx : 0, fy: sp ? sp.fy : 1,
    });
    if (sp) {
      b.vx = sp.vx; b.vy = sp.vy;
      b.fx = sp.fx; b.fy = sp.fy;
      b.stun = sp.stun; b.slide = sp.slide; b.kickCd = sp.kc;
      b.kickArmed = sp.ka; b.kickHeld = sp.kh;
      // Durante un slide el server fija la dirección de barrida = facing.
      b.sdx = sp.fx; b.sdy = sp.fy;
      b.slideHit = {}; b.slideBall = sp.slide <= 0;
    }
    bodies.push(b);
  }
  const ballState = PHYS.makeBall();
  ballState.x = ball.x; ballState.y = ball.y;
  ballState.vx = ball.vx; ballState.vy = ball.vy;
  ballState.lastTouch = ball.lt != null ? ball.lt : null;
  return { bodies: bodies, ball: ballState, rules: { tackles: match.tackles !== false } };
}

// Clon profundo (suficiente para stepWorld) de un estado base por frame.
function cloneState(src) {
  const bodies = [];
  for (const b of src.bodies) {
    bodies.push({
      id: b.id, team: b.team, slot: b.slot, owner: b.owner,
      x: b.x, y: b.y, vx: b.vx, vy: b.vy, fx: b.fx, fy: b.fy,
      kickCd: b.kickCd, kickArmed: b.kickArmed, kickHeld: b.kickHeld,
      stun: b.stun, slide: b.slide, sdx: b.sdx, sdy: b.sdy,
      tackleCd: b.tackleCd,
      slideHit: b.slideHit ? Object.assign({}, b.slideHit) : null,
      slideBall: b.slideBall,
    });
  }
  const ball = {
    x: src.ball.x, y: src.ball.y, vx: src.ball.vx, vy: src.ball.vy,
    lastTouch: src.ball.lastTouch,
  };
  return { bodies: bodies, ball: ball, rules: src.rules };
}

// Mapa de inputs por id para stepWorld (SPEC v1.4 H):
//   - cuerpos PROPIOS: input REAL en vivo (movimiento + kick MANTENIDO) → cero
//     delay, tu kick mueve la pelota YA;
//   - RIVALES: no se conocen sus inputs, así que se asume input NEUTRO (siguen
//     con su velocidad + damping del snapshot). stepWorld cae a ZERO_INPUT para
//     todo id ausente del mapa: la reconciliación corrige el drift por snapshot.
function buildInputsById() {
  const out = {};
  if (ended) return out; // sin control tras gameover: el mundo sigue por inercia
  for (const pl of match.players) {
    if (!match.myBodyIds.has(pl.id)) continue;
    const slot = pl.slot === 1 ? 1 : 0;
    const mv = currentInputFor(slot);
    // tackle es edge (lo consume flushInput→server); en la extrapolación no se
    // re-dispara para no inventar barridas que el server no va a confirmar.
    out[pl.id] = { mx: mv.mx, my: mv.my, kick: kickHeldFor(slot), tackle: false };
  }
  return out;
}

// Al llegar un snapshot: reemplazar el estado base por el del server y reconciliar
// por disco contra lo que se venía mostrando (extWorld). El offset por disco
// (dragOffset) se setea a render_anterior − server_nuevo y luego decae en frame().
function rebaseWorld(pm, ball, paused) {
  lastPaused = paused;
  const prevExt = extWorld; // lo que se mostraba antes de este snapshot
  baseState = buildBaseFromSnap(pm, ball);

  // iq = último seq aplicado por el server (igual en todos los cuerpos propios).
  // No re-simulamos pendientes por seq (la extrapolación parte SIEMPRE del estado
  // server fresco y avanza ext ticks con el input actual): el offset por disco
  // suaviza el salto. Mantenemos la firma del protocolo (iq) por compatibilidad.

  if (!prevExt) {
    dragOffset.clear(); // primer snapshot del partido/kickoff: snap directo
    return;
  }
  // Offset por cuerpo: posición mostrada − nueva posición server (snap si > 60 u).
  for (const b of baseState.bodies) {
    const shown = prevExt.byId ? prevExt.byId.get(b.id) : null;
    setDragOffset(b.id, shown ? shown.x : b.x, shown ? shown.y : b.y, b.x, b.y);
  }
  const shownBall = prevExt.ball;
  setDragOffset(BALL_KEY, shownBall.x, shownBall.y, baseState.ball.x, baseState.ball.y);
}

function setDragOffset(key, shownX, shownY, srvX, srvY) {
  const dx = shownX - srvX;
  const dy = shownY - srvY;
  if (Math.hypot(dx, dy) > CORR_SNAP) {
    dragOffset.delete(key); // error enorme (gol/kickoff/lag spike): snap directo
    return;
  }
  dragOffset.set(key, { dx: dx, dy: dy });
}

// Reset de la extrapolación (start/kickoff/salida): el próximo state re-basea
// limpio, sin offset (snap). Conserva la firma resetPrediction() de v1.2/v1.3.
function resetPrediction() {
  baseState = null;
  extWorld = null;
  dragOffset.clear();
  queuedTackle[0] = false;
  queuedTackle[1] = false;
}

// Avance por frame del rAF: flush de inputs pospuestos + decaimiento del offset.
// La extrapolación en sí se hace en sampleState() (cada frame, sobre el estado
// base fresco) para que SIEMPRE refleje el input más reciente con cero delay.
function updatePrediction(dt) {
  if (!match || phase !== "game") return;
  flushInput(false); // reintento de cambios/acciones que el cap de 60/s pospuso
  // El offset de corrección por disco decae exponencialmente a 0 en ~120 ms.
  const k = Math.exp(-CORR_DECAY * dt);
  for (const [key, off] of dragOffset) {
    off.dx *= k;
    off.dy *= k;
    if (Math.abs(off.dx) < 0.02 && Math.abs(off.dy) < 0.02) dragOffset.delete(key);
  }
}

/* ===== Muestreo del mundo a renderizar: extrapolación (ext>0) o interp (ext=0) =====
 * ext>0: clona el estado base autoritativo y corre stepWorld ext ticks con los
 *        inputs reales (propios) + último input (rivales). Render = extrapolado +
 *        offset de reconciliación por disco. Es el camino normal (HaxBall).
 * ext=0: "ver el pasado interpolado" (suave, con delay) — interpola el buffer de
 *        snapshots como v1.2/v1.3. El usuario lo elige con #opt-extrapolation = 0. */
function sampleState() {
  if (training) return sampleTrainingState(); // v1.5: estado local autoritativo
  const ext = extTicks();
  if (ext > 0 && baseState && PHYS) return sampleExtrapolated(ext);
  return sampleInterpolated();
}

function sampleExtrapolated(ext) {
  const world = cloneState(baseState);
  if (!lastPaused) {
    // El input es el mismo en todos los ticks extrapolados (se asume sostenido).
    const inputs = buildInputsById();
    for (let i = 0; i < ext; i++) {
      PHYS.stepWorld(world, inputs, baseArena, baseArena.phys, world.rules);
    }
  }
  // Guardar el mundo extrapolado SIN offset (es la base para reconciliar el
  // próximo snapshot) y construir el estado de render con el offset por disco.
  const byId = new Map();
  for (const b of world.bodies) byId.set(b.id, b);
  extWorld = { byId: byId, ball: { x: world.ball.x, y: world.ball.y } };

  const players = new Map();
  for (const b of world.bodies) {
    const off = dragOffset.get(b.id);
    players.set(b.id, {
      id: b.id,
      x: b.x + (off ? off.dx : 0),
      y: b.y + (off ? off.dy : 0),
      fx: b.fx, fy: b.fy,
      stun: b.stun, kc: b.kickCd, slide: b.slide,
      ka: b.kickArmed, kh: b.kickHeld,
    });
  }
  const boff = dragOffset.get(BALL_KEY);
  return {
    ball: {
      x: world.ball.x + (boff ? boff.dx : 0),
      y: world.ball.y + (boff ? boff.dy : 0),
      vx: world.ball.vx, vy: world.ball.vy,
    },
    players: players,
    paused: lastPaused,
  };
}

// ext=0: interpolación clásica (pelota + TODOS los cuerpos) interpDelay ms en el
// pasado. Sin extrapolación = sin offset; extWorld se sincroniza con lo mostrado.
function sampleInterpolated() {
  if (!snaps.length) return null;
  const rt = performance.now() - interpDelay;
  let s0 = snaps[0];
  let s1 = snaps[0];
  if (rt >= snaps[snaps.length - 1].t) {
    s0 = s1 = snaps[snaps.length - 1];
  } else {
    for (let i = 1; i < snaps.length; i++) {
      if (snaps[i].t >= rt) {
        s0 = snaps[i - 1];
        s1 = snaps[i];
        break;
      }
    }
  }
  const span = s1.t - s0.t;
  const a = span > 1e-6 ? Math.min(1, Math.max(0, (rt - s0.t) / span)) : 1;
  const L = (u, v) => u + (v - u) * a;

  const players = new Map();
  const byId = new Map();
  for (const [id, p1] of s1.players) {
    const p0 = s0.players.get(id) || p1;
    const x = L(p0.x, p1.x);
    const y = L(p0.y, p1.y);
    players.set(id, {
      id, x: x, y: y,
      fx: L(p0.fx, p1.fx), fy: L(p0.fy, p1.fy),
      stun: p1.stun, kc: p1.kc, slide: p1.slide || 0,
      ka: p1.ka, kh: p1.kh,
    });
    byId.set(id, { x: x, y: y });
  }
  const bx = L(s0.ball.x, s1.ball.x);
  const by = L(s0.ball.y, s1.ball.y);
  extWorld = { byId: byId, ball: { x: bx, y: by } };
  dragOffset.clear(); // sin extrapolación no hay reconciliación que suavizar
  return {
    ball: { x: bx, y: by, vx: L(s0.ball.vx, s1.ball.vx), vy: L(s0.ball.vy, s1.ball.vy) },
    players: players,
    paused: s1.paused,
  };
}

/* ================================== Render ================================== */
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

// Paleta + acentos del estadio actual (v1.1). Se llama una vez por frame desde
// frame(): drawField usa grass1/grass2/stripes/line/mottled; paintBackground usa
// sky/stars/floodlights; frame() usa umbrellas/snow; el polvito usa dust ("r,g,b").
function stadiumTheme() {
  const s = match && match.stadium ? match.stadium : "clasico";
  switch (s) {
    case "noche":
      return {
        id: s, grass1: "#125230", grass2: "#16613a", stripes: true,
        line: "rgba(255,255,255,0.92)",
        sky: ["#060b1c", "#04060f", "#02030a"],
        stars: true, floodlights: true, umbrellas: false, snow: false,
        mottled: false, dust: "150,200,150",
      };
    case "playa":
      return {
        id: s, grass1: "#e3c47c", grass2: "#dcba6b", stripes: false,
        line: "rgba(255,255,255,0.95)",
        sky: ["#ff9d5c", "#d96a63", "#2c2350"],
        stars: false, floodlights: false, umbrellas: true, snow: false,
        mottled: true, dust: "238,212,150",
      };
    case "nieve":
      return {
        id: s, grass1: "#e8eff7", grass2: "#dce7f2", stripes: true,
        line: "rgba(120,150,190,0.85)",
        sky: ["#243450", "#161f38", "#0a1020"],
        stars: false, floodlights: false, umbrellas: false, snow: true,
        mottled: false, dust: "255,255,255",
      };
    default:
      return {
        id: "clasico", grass1: "#1c7a3c", grass2: "#239149", stripes: true,
        line: "rgba(255,255,255,0.92)",
        sky: ["#0e1730", "#0a0f1e", "#070b16"],
        stars: false, floodlights: false, umbrellas: false, snow: false,
        mottled: false, dust: "170,210,150",
      };
  }
}

function paintBackground(W, H, theme, now) {
  const sky = theme.sky;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky[0]);
  g.addColorStop(0.55, sky[1]);
  g.addColorStop(1, sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (theme.stars) drawStars(W, H, now);
  if (theme.floodlights) drawFloodlights(W, H);
  const v = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.22, W / 2, H * 0.46, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// Cielo estrellado del estadio "noche" (posiciones fijas, titilan con el tiempo).
function drawStars(W, H, now) {
  if (!nightStars) {
    nightStars = [];
    for (let i = 0; i < 90; i++) {
      nightStars.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.5 + Math.random() * 1.3,
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 1.2,
      });
    }
  }
  ctx.save();
  ctx.fillStyle = "#ffffff";
  const scale = Math.max(1, W / 900);
  for (const st of nightStars) {
    const tw = 0.5 + 0.5 * Math.sin((now / 650) * st.sp + st.ph);
    ctx.globalAlpha = 0.18 + 0.55 * tw;
    ctx.beginPath();
    ctx.arc(st.x * W, st.y * H, st.r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 4 conos de luz de reflectores desde las esquinas (estadio "noche").
function drawFloodlights(W, H) {
  const cx = W / 2;
  const cy = H * 0.46;
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  ctx.save();
  for (const [px, py] of corners) {
    const dx = cx - px;
    const dy = cy - py;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const spread = 0.3;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const ax = ux * cos - uy * sin;
    const ay = ux * sin + uy * cos;
    const bx = ux * cos + uy * sin;
    const by = -ux * sin + uy * cos;
    const reach = len * 1.15;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, reach);
    grad.addColorStop(0, "rgba(255,246,214,0.28)");
    grad.addColorStop(0.5, "rgba(255,246,214,0.10)");
    grad.addColorStop(1, "rgba(255,246,214,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ax * reach, py + ay * reach);
    ctx.lineTo(px + bx * reach, py + by * reach);
    ctx.closePath();
    ctx.fill();
    // Foco brillante en la esquina.
    const dot = ctx.createRadialGradient(px, py, 0, px, py, 26);
    dot.addColorStop(0, "rgba(255,252,235,0.9)");
    dot.addColorStop(1, "rgba(255,252,235,0)");
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(px, py, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawField(theme) {
  const b = match.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;

  ctx.save();
  ctx.clip(match.fieldPath);
  // Piso base + franjas alternadas (la playa no lleva franjas).
  ctx.fillStyle = theme.grass1;
  ctx.fillRect(b.minX - 10, b.minY - 10, bw + 20, bh + 20);
  if (theme.stripes) {
    ctx.fillStyle = theme.grass2;
    const stripe = 58;
    let i = 0;
    for (let y = b.minY - 10; y < b.maxY + 10; y += stripe, i++) {
      if (i % 2 === 0) ctx.fillRect(b.minX - 10, y, bw + 20, stripe);
    }
  }
  // Arena moteada (playa): manchitas fijas por partido en lugar de franjas.
  if (theme.mottled) drawMottling(b, bw, bh);
  // Sombreado radial sutil del piso.
  const rg = ctx.createRadialGradient(0, 0, 50, 0, 0, Math.max(bw, bh) * 0.72);
  rg.addColorStop(0, "rgba(255,255,255,0.06)");
  rg.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = rg;
  ctx.fillRect(b.minX - 10, b.minY - 10, bw + 20, bh + 20);
  // Círculo central + punto.
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = theme.line;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Línea de borde gruesa semi-brillante.
  ctx.save();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 14;
  ctx.stroke(match.fieldPath);
  ctx.restore();
}

// Moteado de arena del estadio "playa" (se genera una vez por partido).
function drawMottling(b, bw, bh) {
  if (!match.speckles) {
    const arr = [];
    for (let i = 0; i < 150; i++) {
      arr.push({
        x: b.minX + Math.random() * bw,
        y: b.minY + Math.random() * bh,
        r: 2 + Math.random() * 7,
        light: Math.random() < 0.5,
        a: 0.05 + Math.random() * 0.1,
      });
    }
    match.speckles = arr;
  }
  for (const sp of match.speckles) {
    ctx.fillStyle =
      (sp.light ? "rgba(255,240,200," : "rgba(140,110,60,") + sp.a.toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Sombrillas alrededor de la cancha (estadio "playa"), fuera del campo. Usa los
// segmentos de pared del núcleo (arena.walls: cx,cy,dx,dy,nx,ny,half).
function drawUmbrellas() {
  if (!match.umbrellas) {
    const arr = [];
    let i = 0;
    for (const w of match.arena.walls) {
      for (const off of [-0.58, 0.58]) {
        const s = w.half * off;
        arr.push({
          x: w.cx + w.dx * s + w.nx * 54,
          y: w.cy + w.dy * s + w.ny * 54,
          e: i % 2 === 0 ? "⛱️" : "🏖️",
          size: 26 + ((i * 7) % 12),
        });
        i++;
      }
    }
    match.umbrellas = arr;
  }
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const u of match.umbrellas) {
    ctx.font = u.size + "px system-ui, sans-serif";
    ctx.fillText(u.e, u.x, u.y);
  }
  ctx.restore();
}

// Arcos: una boca por equipo, desde la geometría del núcleo (match.goals). Cada
// boca trae sus extremos (ax,ay,bx,by), centro, normal exterior y dirección.
function drawGoals() {
  for (const g of match.goals) {
    const owner = match.teams[g.team]; // el arco k pertenece al EQUIPO k
    if (!owner) continue;
    const x0 = g.ax;
    const y0 = g.ay;
    const x1 = g.bx;
    const y1 = g.by;
    const gw = GOAL_W / 2;

    // Red en cuadrícula detrás de la línea (hacia afuera).
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 1.3;
    const depth = 20;
    const step = 8;
    ctx.beginPath();
    for (let s = -gw; s <= gw + 0.1; s += step) {
      ctx.moveTo(g.cx + g.dx * s, g.cy + g.dy * s);
      ctx.lineTo(g.cx + g.dx * s + g.nx * depth, g.cy + g.dy * s + g.ny * depth);
    }
    for (let d = 0; d <= depth + 0.1; d += step) {
      ctx.moveTo(x0 + g.nx * d, y0 + g.ny * d);
      ctx.lineTo(x1 + g.nx * d, y1 + g.ny * d);
    }
    ctx.stroke();

    // Boca del arco pintada del color c1 del equipo dueño con glow.
    ctx.strokeStyle = owner.c1;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.shadowColor = owner.c1;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();

    // Bandera(s) emoji de los integrantes cerca de su arco (afuera de la cancha).
    ctx.save();
    ctx.font = "28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner.flags, g.cx + g.nx * 38, g.cy + g.ny * 38);
    ctx.restore();
  }
}

// POSTES (SPEC v1.4 F/J): disco claro radio POST_R en cada extremo de la boca.
// La pelota y los jugadores rebotan en ellos ("pegó en el palo").
function drawPosts() {
  ctx.save();
  for (const p of match.posts) {
    // Halo tenue + disco claro con borde, para que se lea como un palo.
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, POST_R);
    g.addColorStop(0, "rgba(255,255,255,0.98)");
    g.addColorStop(1, "rgba(225,232,244,0.92)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, POST_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(40,52,76,0.55)";
    ctx.stroke();
  }
  ctx.restore();
}

// BOTINES animados (v1.1). Se llama desde drawPlayers con el ctx YA trasladado al
// centro del jugador (después de la sombra y antes del cuerpo: los pies quedan
// debajo y asoman hacia adelante). p = estado interpolado {x,y,fx,fy,stun,kc,slide};
// pl = info estática {id,name,country,team,c1,c2,flag}; now = performance.now().
function drawPlayerFeet(p, pl, now) {
  // Zancada por DISTANCIA recorrida: acumulada por jugador en feetState.
  let fs = feetState.get(pl.id);
  if (!fs) {
    fs = { x: p.x, y: p.y, dist: 0, speed: 0, lastNow: now };
    feetState.set(pl.id, fs);
  }
  const dtp = Math.min(0.1, Math.max(0.001, (now - fs.lastNow) / 1000));
  const step = Math.hypot(p.x - fs.x, p.y - fs.y);
  const inst = step / dtp;
  if (inst > 600) {
    // Teletransporte (kickoff/reset): no acumular distancia ni velocidad.
    fs.speed = 0;
  } else {
    fs.dist += step;
    fs.speed += (inst - fs.speed) * Math.min(1, dtp * 12); // suavizado
  }
  fs.x = p.x;
  fs.y = p.y;
  fs.lastNow = now;

  const fa = Math.atan2(p.fy, p.fx);
  const sliding = (p.slide || 0) > 0.02;
  ctx.save();
  ctx.rotate(fa);

  if (sliding) {
    // Estela translúcida de la barrida (detrás del jugador).
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.ellipse(-12, 0, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Polvito: partículas en coords de mundo (se dibujan en updateDust).
    const nDust = Math.max(1, Math.round(2 * fxMult()));
    for (let i = 0; i < nDust; i++) {
      dustFx.push({
        x: p.x - p.fx * (8 + Math.random() * 10) + (Math.random() - 0.5) * 8,
        y: p.y - p.fy * (8 + Math.random() * 10) + (Math.random() - 0.5) * 8,
        vx: -p.fx * (30 + Math.random() * 50) + (Math.random() - 0.5) * 40,
        vy: -p.fy * (30 + Math.random() * 50) + (Math.random() - 0.5) * 40 - 14,
        r: 2 + Math.random() * 2.6,
        life: 0.45,
        maxLife: 0.45,
      });
    }
    if (dustFx.length > 220) dustFx.splice(0, dustFx.length - 220);
  }

  // Botines perpendiculares al facing (±5.5); zancada de ±6 u a lo largo del
  // facing, en contrafase, con fase ∝ distancia recorrida. Quietos si v < 10.
  const amp = sliding || fs.speed < 10 ? 0 : 6 * Math.min(1, fs.speed / 120);
  const phase = fs.dist / 7;
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    let bx;
    let by;
    let rx = 3.6;
    let ry = 2.1;
    if (sliding) {
      // Pose de barrida: ambos botines estirados hacia adelante.
      bx = side === 0 ? 16 : 12;
      by = sgn * 4;
      rx = 5.6;
      ry = 2.3;
    } else {
      bx = 11 + sgn * amp * Math.sin(phase); // contrafase entre pies
      by = sgn * 5.5;
    }
    // Botín oscuro con detalle blanco (cordones).
    ctx.fillStyle = "#22252e";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(bx + rx * 0.25, by - ry * 0.7);
    ctx.lineTo(bx + rx * 0.25, by + ry * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

// Polvito de barrida (coords de mundo). Llamar con la transform de mundo activa.
function updateDust(dt, theme) {
  if (!dustFx.length) return;
  for (let i = dustFx.length - 1; i >= 0; i--) {
    const d = dustFx[i];
    d.life -= dt;
    if (d.life <= 0) {
      dustFx.splice(i, 1);
      continue;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= Math.exp(-3 * dt);
    d.vy *= Math.exp(-3 * dt);
    const k = d.life / d.maxLife;
    ctx.fillStyle = "rgba(" + theme.dust + "," + (0.5 * k).toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * (1 + (1 - k) * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayers(st, now) {
  for (const pl of match.players) {
    const p = st.players.get(pl.id);
    if (!p) continue;
    const stunned = p.stun > 0.01;
    // v1.3: "mío" = cualquier cuerpo cuyo owner sea mi usuario (en duo, 2).
    const mine = pl.owner === myId || pl.id === myId;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Sombra elíptica.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, PLAYER_R * 0.78, PLAYER_R * 1.05, PLAYER_R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Botines debajo del cuerpo (etapa 2 los dibuja de verdad).
    drawPlayerFeet(p, pl, now);

    // Halo distintivo de los cuerpos propios (v1.3, SPEC C): A (slot 0) dorado
    // como en v1.1; B (slot 1) plateado/celeste.
    if (mine) {
      ctx.strokeStyle = pl.slot === 1 ? "rgba(178,212,255,0.92)" : "rgba(245,197,66,0.9)";
      ctx.lineWidth = 2.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 6, now / 600, now / 600 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (stunned) ctx.rotate(Math.sin(now / 90) * 0.2);

    // v1.4 J: indicador de kick ARMADO/cargando. Mientras mantenés kick el cuerpo
    // se oscurece (como HaxBall) y lleva un aro pulsante; en cooldown, un
    // resplandor sutil. Solo en cuerpos propios (la info kh/kc viaja del server o
    // de la extrapolación; para los rivales no se conoce con certeza).
    const charging = mine && !stunned && p.kh;
    const onCd = mine && !stunned && (p.kc || 0) > 0;
    if (charging) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.save();
      ctx.strokeStyle = "rgba(255,236,150," + (0.55 + 0.35 * pulse).toFixed(3) + ")";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 3 + pulse * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (onCd) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Cuña de facing.
    const fa = Math.atan2(p.fy, p.fx);
    ctx.save();
    ctx.rotate(fa);
    ctx.fillStyle = stunned ? "rgba(170,170,170,0.8)" : "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.moveTo(PLAYER_R + 7, 0);
    ctx.lineTo(PLAYER_R - 2, -5);
    ctx.lineTo(PLAYER_R - 2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Cuerpo con gradiente radial c2 → c1 (gris si stunned; oscurecido si carga kick).
    const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, PLAYER_R + 2);
    if (stunned) {
      g.addColorStop(0, "#d4d4d4");
      g.addColorStop(1, "#6f6f6f");
    } else {
      g.addColorStop(0, pl.c2);
      g.addColorStop(0.55, pl.c1);
      g.addColorStop(1, pl.c1);
    }
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Tinte oscuro al cargar el disparo (HaxBall oscurece al jugador con kick).
    if (charging) {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.stroke();

    // Estrellitas orbitando al jugador stunned.
    if (stunned) {
      ctx.fillStyle = "#ffe27a";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < 3; i++) {
        const a = now / 240 + (i * Math.PI * 2) / 3;
        ctx.fillText("★", Math.cos(a) * (PLAYER_R + 8), -PLAYER_R - 6 + Math.sin(a) * 4);
      }
    }
    ctx.restore();

    // Bandera arriba y nombre abajo (sin rotación de stun). v1.3 (SPEC C): el
    // cuerpo B (slot 1) lleva la marca "②" junto al nombre — y aunque los
    // nombres estén apagados, el "②" solo se mantiene para distinguirlo.
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(pl.flag, p.x, p.y - PLAYER_R - 13);
    const label = settings.names
      ? pl.name + (pl.slot === 1 ? " ②" : "")
      : pl.slot === 1
        ? "②"
        : "";
    if (label) {
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = mine
        ? pl.slot === 1
          ? "#cfe2ff"
          : "#ffdf7e"
        : "rgba(255,255,255,0.88)";
      ctx.fillText(label, p.x, p.y + PLAYER_R + 13);
    }
    ctx.restore();
  }
}

function drawPent(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBall(st, dt, now) {
  const b = st.ball;
  const speed = Math.hypot(b.vx, b.vy);
  // speed está en u/tick (v1.4). dt es en segundos: ×60 lo lleva a u/s para que la
  // rotación quede a la misma escala visible que el modelo viejo en u/s.
  ballSpin += (speed * 60 / BALL_R) * dt * 0.35;

  // Estela cuando va rápido. Umbral en u/tick: un disparo arranca a speed 5
  // (KICK_STRENGTH) y "rápido" es ~3 u/tick (= 180 u/s), igual que sfxBounce.
  ballTrail.push({ x: b.x, y: b.y });
  if (ballTrail.length > 14) ballTrail.shift();
  if (speed > 3) {
    ctx.save();
    for (let i = 0; i < ballTrail.length - 1; i++) {
      const a = (i / ballTrail.length) * 0.25;
      ctx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(ballTrail[i].x, ballTrail[i].y, BALL_R * (0.35 + (0.6 * i) / ballTrail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  // Sombra.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + BALL_R * 0.7, BALL_R * 0.95, BALL_R * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(b.x, b.y);
  // Squash de patada: la pelota se estira en la dirección de la velocidad ~160 ms.
  const kickAge = (now - lastKickT) / 160;
  if (kickAge >= 0 && kickAge < 1 && speed > 1) {
    const k = 1 - kickAge;
    const va = Math.atan2(b.vy, b.vx);
    ctx.rotate(va);
    ctx.scale(1 + 0.4 * k, 1 - 0.32 * k);
    ctx.rotate(-va);
  }
  ctx.rotate(ballSpin);
  const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, BALL_R);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#d9dee7");
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(22,30,48,0.55)";
  ctx.stroke();
  // Pentágonos sugeridos.
  ctx.fillStyle = "#222b3d";
  drawPent(0, 0, 3.4);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + Math.PI / 5;
    drawPent(Math.cos(a) * BALL_R * 0.72, Math.sin(a) * BALL_R * 0.72, 2.3);
  }
  ctx.restore();
}

function drawRings(now) {
  for (let i = ringFx.length - 1; i >= 0; i--) {
    const r = ringFx[i];
    const age = (now - r.t) / 300;
    if (age >= 1) {
      ringFx.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 10 + age * 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* ----------------------------- Confetti (pantalla) ----------------------------- */
// settings.fx === "low" reduce la cantidad de partículas a la mitad (SPEC).
function fxMult() {
  return settings.fx === "low" ? 0.5 : 1;
}

function confettiBurst(colors) {
  const cw = canvas.clientWidth || window.innerWidth;
  const ch = canvas.clientHeight || window.innerHeight;
  const count = Math.round(90 * fxMult());
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 140 + Math.random() * 420;
    confetti.push({
      x: cw / 2,
      y: ch * 0.42,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 130,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 10,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 5,
      color: colors[i % colors.length],
      life: 1.6 + Math.random() * 0.9,
    });
  }
}

function updateConfetti(dt, now) {
  if (now < confettiRainUntil && Math.random() < 0.55 * fxMult()) {
    const cw = canvas.clientWidth || window.innerWidth;
    confetti.push({
      x: Math.random() * cw,
      y: -12,
      vx: (Math.random() - 0.5) * 70,
      vy: 70 + Math.random() * 130,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 8,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 5,
      color: rainColors[Math.floor(Math.random() * rainColors.length)],
      life: 6,
    });
  }
  const ch = canvas.clientHeight || window.innerHeight;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.life -= dt;
    c.vy = Math.min(c.vy + 480 * dt, 330);
    c.vx *= Math.exp(-1.1 * dt);
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    if (c.life <= 0 || c.y > ch + 24) {
      confetti.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, c.life));
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
}

/* ------------------------------ Copos de nieve ------------------------------ */
// ~40 copos animados cayendo (20 si settings.fx === "low"), en px CSS de pantalla.
function updateSnow(dt, now) {
  const cw = canvas.clientWidth || window.innerWidth;
  const ch = canvas.clientHeight || window.innerHeight;
  const target = settings.fx === "low" ? 20 : 40;
  while (snowflakes.length < target) {
    snowflakes.push({
      x: Math.random() * cw,
      y: Math.random() * ch,
      spd: 28 + Math.random() * 50,
      sway: 8 + Math.random() * 22,
      ph: Math.random() * Math.PI * 2,
      r: 1.4 + Math.random() * 2.2,
      a: 0.45 + Math.random() * 0.45,
    });
  }
  if (snowflakes.length > target) snowflakes.length = target;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  for (const f of snowflakes) {
    f.y += f.spd * dt;
    f.x += Math.sin(now / 900 + f.ph) * f.sway * dt;
    if (f.y > ch + 4) {
      f.y = -5;
      f.x = Math.random() * cw;
    }
    if (f.x < -6) f.x = cw + 5;
    else if (f.x > cw + 6) f.x = -5;
    ctx.globalAlpha = f.a;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------- Loop rAF --------------------------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrameT) / 1000);
  lastFrameT = now;
  if (phase !== "game" || !match) return;

  // v1.5: en entrenamiento, avanzar la simulación local (60 Hz) antes de render.
  if (training) stepTraining(now);

  // v1.4 H: decae el offset de reconciliación por disco + flush de inputs
  // pospuestos por el cap de 60/s. La extrapolación de mundo se hace en
  // sampleState() (cada frame, sobre el estado base fresco) para 0 delay.
  updatePrediction(dt);

  const dpr = resizeCanvas();
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return;

  const theme = stadiumTheme();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintBackground(W, H, theme, now);

  // Encajar el mundo (bounding + margen 70) centrado, manteniendo aspecto.
  const b = match.bounds;
  const bw = b.maxX - b.minX + WORLD_MARGIN * 2;
  const bh = b.maxY - b.minY + WORLD_MARGIN * 2;
  const s = Math.min(W / bw, H / bh);
  // Screen-shake de gol: 4 px CSS durante 200 ms, decae linealmente.
  let shx = 0;
  let shy = 0;
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 200;
    shx = (Math.random() * 2 - 1) * 4 * k * dpr;
    shy = (Math.random() * 2 - 1) * 4 * k * dpr;
  }
  const ox = W / 2 - s * (b.minX + b.maxX) / 2 + shx;
  const oy = H / 2 - s * (b.minY + b.maxY) / 2 + shy;
  ctx.setTransform(s, 0, 0, s, ox, oy);

  drawField(theme);
  if (theme.umbrellas) drawUmbrellas();
  drawGoals();
  drawPosts(); // v1.4 F: palos (discos claros r8) en los extremos de cada boca
  updateDust(dt, theme); // polvito de barrida, debajo de los jugadores

  const st = sampleState();
  if (st) {
    drawPlayers(st, now);
    if (!st.paused) {
      drawBall(st, dt, now);
    } else {
      ballTrail.length = 0; // la pelota "desaparece" durante la pausa post-gol
    }
  }
  drawRings(now);

  // Confetti y copos en espacio de pantalla (px CSS).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateConfetti(dt, now);
  if (theme.snow) updateSnow(dt, now);

  // Feedback de cooldown de barrida (cuerpo A). En sala sin barrida está oculto.
  if (btnTackle) btnTackle.classList.toggle("cooldown", performance.now() < tackleCdUntil[0]);
  // v1.4 J: el botón ⚽ refleja el kick MANTENIDO del cuerpo A (.kick-armed, CSS).
  if (btnKick) btnKick.classList.toggle("kick-armed", kickHeldFor(0));
}

/* ============================ Modo entrenamiento (v1.5) ============================
 * Modo "solo" 100% client-side: corre el MISMO physics-core localmente a 60 Hz, sin
 * servidor ni latencia (instantáneo, hasta offline). Reusa el pipeline de render
 * (drawField/drawGoals/drawPosts/drawPlayers/drawBall vía sampleState) y de input
 * (currentInputFor/kickHeldFor/queuedTackle). Cancha rectangular (n=2): tu jugador a
 * la izquierda ataca el arco derecho; 0–2 rivales con IA simple lo defienden. */

const TRAIN_BOT_COUNTRIES = ["BR", "DE", "FR"];

function startTraining() {
  if (!PHYS) {
    toast("El motor de física aún no cargó, probá de nuevo");
    return;
  }
  if (training) return;
  const prof = loadProfile();
  const country = selectedCountry || (prof && prof.country) || "AR";
  const name = (nameInput.value.trim() || (prof && prof.name) || "Vos").slice(0, 16);
  myId = "me";
  buildTrainingMatch(name, country, trainingCfg.defenders, trainingCfg.stadium);
  training = {
    state: buildTrainingState(),
    accMs: 0,
    lastNs: null,
    goals: 0,
    paused: false,
    resetAt: 0,
    defenders: trainingCfg.defenders,
    stadium: trainingCfg.stadium,
  };
  // Buffers de red/extrapolación: no se usan en entrenamiento.
  baseState = null;
  extWorld = null;
  dragOffset.clear();
  snaps = [];
  resetPrediction();
  ringFx = [];
  ballTrail = [];
  confetti = [];
  confettiRainUntil = 0;
  ballSpin = 0;
  feetState.clear();
  dustFx = [];
  shakeUntil = 0;
  ended = false;
  queuedTackle[0] = false;
  queuedTackle[1] = false;
  kickHoldSources[0].clear();
  kickHoldSources[1].clear();
  if (scoreboardEl) scoreboardEl.classList.add("hidden");
  const hud = $("training-hud");
  if (hud) hud.classList.remove("hidden");
  syncTrainingHud();
  updateTrainingGoals();
  phase = "game";
  showScreen("game");
  enterGameDisplay();
  startInputLoop(); // inocuo: flushInput corta en entrenamiento
  updateTouchButtonsVisibility(false); // ⚽/🦵 visibles (no-duo)
  hideMatchClock();
  hideDuoKeysHint();
  clearOverlayTimers();
  overlayEl.textContent = "";
  const d = document.createElement("div");
  d.className = "overlay-text";
  d.textContent = "¡A ENTRENAR!";
  overlayEl.appendChild(d);
  overlayTimers.push(
    setTimeout(() => {
      overlayEl.textContent = "";
    }, 900)
  );
}

// Objeto `match` para que el render funcione (bounds/arena/goals/posts/players/byId/
// teams). Jugador = team 0 (izquierda), rivales = team 1 (derecha).
function buildTrainingMatch(name, country, defenders, stadium) {
  const n = 2;
  baseArena = PHYS.buildArena(n, stadium);
  const verts = polygonVerts(n);
  const bounds = vertsBounds(verts);
  const meInfo = countryInfo(country);
  const players = [
    {
      id: "me", name: name, country: country, team: 0, owner: "me", slot: 0,
      c1: meInfo.c1, c2: meInfo.c2, flag: flagOf(country),
    },
  ];
  for (let i = 0; i < defenders; i++) {
    const bc = TRAIN_BOT_COUNTRIES[i % TRAIN_BOT_COUNTRIES.length];
    const bi = countryInfo(bc);
    players.push({
      id: "bot" + i, name: "Coco " + (i + 1), country: bc, team: 1, owner: "bot" + i,
      slot: 0, c1: bi.c1, c2: bi.c2, flag: flagOf(bc),
    });
  }
  const byId = new Map(players.map((p) => [p.id, p]));
  const mkTeam = (idx, members) => ({
    index: idx, members: members, users: members,
    c1: members[0] ? members[0].c1 : "#9fb0c8",
    c2: members[0] ? members[0].c2 : "#ffffff",
    flags: members.map((m) => m.flag).join(""),
  });
  match = {
    mode: "training", stadium: stadium, n: n, players: players, byId: byId,
    teams: [mkTeam(0, [players[0]]), mkTeam(1, players.slice(1))],
    myTeam: 0, myBodyIds: new Set(["me"]),
    ownerNames: new Map([["me", name]]),
    target: "goals", value: 0, golden: false, tackles: true,
    arena: baseArena, goals: baseArena.goals, posts: baseArena.posts,
    verts: verts, bounds: bounds, fieldPath: buildFieldPath(verts),
  };
}

// Estado físico local autoritativo (cuerpos + pelota) en posiciones de saque.
function buildTrainingState() {
  const bodies = [];
  for (const pl of match.players) {
    const sp = trainingSpawn(pl);
    bodies.push(
      PHYS.makeBody({
        id: pl.id, team: pl.team, slot: pl.slot, owner: pl.owner,
        x: sp.x, y: sp.y, fx: sp.fx, fy: sp.fy,
      })
    );
  }
  return { bodies: bodies, ball: PHYS.makeBall(), rules: { tackles: true } };
}

// Saque: jugador a la izquierda mirando al arco derecho; rivales cerca del arco
// derecho (el que el jugador ataca), repartidos en y si son 2.
function trainingSpawn(pl) {
  if (pl.id === "me") return { x: -RECT_W * 0.5, y: 0, fx: 1, fy: 0 };
  const bots = match.players.filter((p) => p.id !== "me");
  const idx = bots.indexOf(pl);
  const y = bots.length <= 1 ? 0 : idx === 0 ? -70 : 70;
  return { x: RECT_W * 0.55, y: y, fx: -1, fy: 0 };
}

// Avance por frame con paso fijo de 60 Hz (acumulador de tiempo real).
function stepTraining(now) {
  const t = training;
  if (t.lastNs == null) {
    t.lastNs = now;
    return;
  }
  let dtMs = now - t.lastNs;
  t.lastNs = now;
  if (dtMs > 250) dtMs = 250; // clamp al volver de una pestaña en 2º plano
  t.accMs += dtMs;
  const TS = 1000 / 60;
  let steps = 0;
  while (t.accMs >= TS && steps < 6) {
    trainingTick();
    t.accMs -= TS;
    steps++;
  }
  if (steps === 6) t.accMs = 0;
}

function trainingTick() {
  const t = training;
  if (t.paused) {
    if (performance.now() >= t.resetAt) {
      doTrainingResetBall();
      t.paused = false;
    }
    return; // física congelada durante el festejo del gol
  }
  const inputs = {};
  const mv = currentInputFor(0);
  inputs.me = { mx: mv.mx, my: mv.my, kick: kickHeldFor(0), tackle: queuedTackle[0] };
  queuedTackle[0] = false; // consumir el edge de barrida (no pasa por flushInput)
  for (const b of t.state.bodies) {
    if (b.owner !== "me") inputs[b.id] = aiInput(b);
  }
  const evs = PHYS.stepWorld(t.state, inputs, match.arena, match.arena.phys, t.state.rules);
  if (evs) {
    for (const e of evs) {
      if (e.type === "kicked" && e.id === "me") trainingKickRing();
    }
  }
  if (PHYS.goalCheck(t.state.ball, match.arena) >= 0) onTrainingGoal();
}

// IA simple del rival: se interpone entre la pelota y su arco (derecha) y despeja
// al contacto. Beatable pero presente. Usa la MISMA física que el jugador.
function aiInput(bot) {
  const ball = training.state.ball;
  const goalX = RECT_W; // arco propio de los rivales (derecha)
  const db = Math.hypot(ball.x - bot.x, ball.y - bot.y);
  // Desafiar la pelota SOLO si está cerca Y en su mitad/centro (no se va a perseguir
  // hasta el área del atacante): ir directo y despejar al contacto.
  if (ball.x > -40 && db < 60) {
    const mx = ball.x - bot.x;
    const my = ball.y - bot.y;
    const l = Math.hypot(mx, my) || 1;
    return { mx: mx / l, my: my / l, kick: db < 32, tackle: false };
  }
  // Si no, mantener posición GOAL-SIDE: a 90u de la pelota HACIA el arco propio
  // (queda entre la pelota y su arco), sin cruzar mucho a la mitad rival.
  let vx = goalX - ball.x;
  let vy = 0 - ball.y;
  const gl = Math.hypot(vx, vy) || 1;
  let tx = ball.x + (vx / gl) * 90;
  const ty = ball.y + (vy / gl) * 90;
  if (tx < -30) tx = -30; // no perseguir hacia la mitad del atacante
  const mx = tx - bot.x;
  const my = ty - bot.y;
  const ml = Math.hypot(mx, my) || 1;
  if (ml < 9) return { mx: 0, my: 0, kick: false, tackle: false };
  return { mx: mx / ml, my: my / ml, kick: false, tackle: false };
}

function trainingKickRing() {
  const me = training.state.bodies.find((b) => b.id === "me");
  if (!me) return;
  ringFx.push({ x: me.x, y: me.y, t: performance.now() });
  lastKickT = performance.now();
}

function onTrainingGoal() {
  const t = training;
  t.goals++;
  updateTrainingGoals();
  t.paused = true;
  t.resetAt = performance.now() + 1100;
  clearOverlayTimers();
  overlayEl.textContent = "";
  const me = match.byId.get("me");
  const goalText = document.createElement("div");
  goalText.className = "goal-text";
  goalText.textContent = "¡GOL!";
  goalText.style.color = me.c1;
  overlayEl.appendChild(goalText);
  overlayTimers.push(
    setTimeout(() => {
      overlayEl.textContent = "";
    }, 1000)
  );
  sfxGoal();
  shakeUntil = performance.now() + 200;
  confettiBurst([me.c1, me.c2]);
  commentator("goal", { name: match.ownerNames.get("me") || "Vos" });
}

// Reset de la pelota al centro + jugadores al saque (post-gol o manual con R).
function doTrainingResetBall() {
  const ball = training.state.ball;
  ball.x = 0;
  ball.y = 0;
  ball.vx = 0;
  ball.vy = 0;
  ball.lastTouch = null;
  for (const b of training.state.bodies) {
    const pl = match.byId.get(b.id);
    const sp = trainingSpawn(pl);
    b.x = sp.x;
    b.y = sp.y;
    b.vx = 0;
    b.vy = 0;
    b.fx = sp.fx;
    b.fy = sp.fy;
    b.kickCd = 0;
    b.kickArmed = true;
    b.stun = 0;
    b.slide = 0;
  }
  ballTrail.length = 0;
}

function resetTrainingBall(manual) {
  if (!training) return;
  training.paused = false;
  doTrainingResetBall();
}

// Estado a renderizar (sampleState lo devuelve cuando training != null): el estado
// local ES autoritativo y sin latencia, así que se dibuja directo.
function sampleTrainingState() {
  const t = training;
  if (!t) return null;
  const players = new Map();
  for (const b of t.state.bodies) {
    players.set(b.id, {
      x: b.x, y: b.y, fx: b.fx, fy: b.fy,
      stun: b.stun, kc: b.kickCd, slide: b.slide,
      ka: b.kickArmed, kh: b.kickHeld,
    });
  }
  return {
    ball: { x: t.state.ball.x, y: t.state.ball.y, vx: t.state.ball.vx, vy: t.state.ball.vy },
    players: players,
    paused: t.paused,
  };
}

function setTrainingDefenders(n) {
  trainingCfg.defenders = Math.max(0, Math.min(2, n | 0));
  syncTrainingHud();
  if (!training) return;
  // Rearmar cancha/estado con la nueva cantidad de rivales, conservando los goles.
  const goals = training.goals;
  const meBody = match.byId.get("me");
  const name = match.ownerNames.get("me") || "Vos";
  const country = meBody ? meBody.country : "AR";
  buildTrainingMatch(name, country, trainingCfg.defenders, training.stadium);
  training.state = buildTrainingState();
  training.defenders = trainingCfg.defenders;
  training.paused = false;
  training.goals = goals;
  ringFx = [];
  ballTrail = [];
  feetState.clear();
  updateTrainingGoals();
}

function updateTrainingGoals() {
  const el = $("th-goals");
  if (el) el.textContent = String(training ? training.goals : 0);
}

function syncTrainingHud() {
  const hud = $("training-hud");
  if (!hud) return;
  for (const b of hud.querySelectorAll(".th-def")) {
    b.classList.toggle("active", +b.dataset.def === trainingCfg.defenders);
  }
}

/* ================================ Inicialización ================================ */
buildCountryGrid();

// v1.5: wiring del modo entrenamiento (botón del home + controles del HUD).
on($("btn-train"), "click", startTraining);
on($("btn-train-exit"), "click", () => goHome(false));
on($("btn-train-reset"), "click", () => resetTrainingBall(true));
{
  const trainHud = $("training-hud");
  if (trainHud) {
    for (const b of trainHud.querySelectorAll(".th-def")) {
      b.addEventListener("click", () => setTrainingDefenders(+b.dataset.def));
    }
  }
  syncTrainingHud();
}

// Precargar perfil (nombre + país) desde localStorage "poligol.profile".
{
  const prof = loadProfile();
  if (prof) {
    if (prof.name && !nameInput.value) nameInput.value = prof.name.slice(0, 16);
    if (prof.country) selectCountry(prof.country);
  }
}

// Default de visibilidad: privada (SPEC) — por si el HTML no marca ninguno.
if (visPrivate && visPublic && !visPrivate.checked && !visPublic.checked) {
  visPrivate.checked = true;
}

// v1.3: opción "duo" en #mode-select si el HTML aún no la trae (el host la
// necesita para elegir el modo; idempotente si el HTML ya la incluye).
if (modeSelect) {
  let hasDuo = false;
  for (let i = 0; i < modeSelect.options.length; i++) {
    if (modeSelect.options[i].value === "duo") {
      hasDuo = true;
      break;
    }
  }
  if (!hasDuo) {
    const opt = document.createElement("option");
    opt.value = "duo";
    opt.textContent = "👥 Dúo (2 cuerpos c/u)";
    modeSelect.appendChild(opt);
  }
}

if (joystickEl) joystickEl.style.visibility = "hidden"; // solo aparece bajo el dedo
syncSettingsUI();
showScreen("home"); // arranca el polling de salas públicas
requestAnimationFrame(frame);
