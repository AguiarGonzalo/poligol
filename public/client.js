"use strict";

/* ============================================================
 * PoliGol — cliente v1.1 (vanilla JS, sin dependencias).
 * ETAPA 1: lógica y flujo. Conexión WebSocket, pantallas
 * home/lobby/juego, salas públicas (listRooms + polling), lobby v2
 * (ready / modo / estadio / equipos / countdown), scoreboard por
 * EQUIPO, perfil y settings en localStorage, joystick dinámico,
 * fullscreen+landscape en móvil y vibración.
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
 * ============================================================ */

/* ================= Constantes compartidas (SPEC, = server.js) ================= */
const R = 380;              // circunradio del polígono (unidades de mundo)
const PLAYER_R = 14;        // radio del jugador
const BALL_R = 10;          // radio de la pelota
const GOAL_W = 112;         // ancho del arco
const WIN_SCORE = 3;        // puntaje objetivo
const RECT_W = 480;         // half-extent horizontal para n = 2
const RECT_H = 290;         // half-extent vertical para n = 2
const TACKLE_COOLDOWN = 1.6; // s — solo para feedback visual del botón táctil

/* ======================= Constantes propias del cliente ======================= */
const WORLD_MARGIN = 70;    // margen alrededor del bounding del polígono (SPEC render)
const INTERP_DELAY = 100;   // ms: se renderiza 100 ms en el pasado (SPEC)
const INPUT_HZ = 30;        // envío de input a ~30 Hz (SPEC)
const JOY_RADIUS = 38;      // px de recorrido máximo del stick del joystick
const ROOMS_POLL_MS = 3000; // polling de listRooms mientras el home está visible (SPEC)
const ROOM_NAME_MAX = 24;   // largo máximo del nombre de sala (SPEC)
const PROFILE_KEY = "poligol.profile";   // localStorage: { name, country }
const SETTINGS_KEY = "poligol.settings"; // localStorage: { sound, relator, fx, vibration, names }

const MODE_LABELS = { ffa: "Todos contra todos", "1v1": "1 vs 1", "2v2": "2 vs 2" };
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
// Opciones
const optionsModal = $("options-modal");           // v1.1
const optSound = $("opt-sound");                   // v1.1 (range 0–100)
const optRelator = $("opt-relator");               // v1.1 (checkbox)
const optFx = $("opt-fx");                         // v1.1 (select low/high)
const optVibration = $("opt-vibration");           // v1.1 (checkbox)
const optNames = $("opt-names");                   // v1.1 (checkbox)
const btnOptionsClose = $("btn-options-close");    // v1.1
// Contenedores v1 (pueden cambiar en el HTML v1.1: usar con guardas)
const endgameActions = document.querySelector(".endgame-actions");
const lobbyCard = document.querySelector(".lobby-card");
const lobbyActions = document.querySelector(".lobby-actions");
const ctx = canvas.getContext("2d");

/* =========================== Settings (poligol.settings) =========================== */
const DEFAULT_SETTINGS = { sound: 100, relator: true, fx: "high", vibration: true, names: true };

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
let inputTimer = 0;
let tackleCdUntil = 0;
let roomsPollTimer = 0;    // polling de listRooms (solo home visible)
let lobbyCountdownTimer = 0;
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

const keys = new Set();
// Joystick DINÁMICO: ox,oy = punto de pantalla donde apoyó el dedo.
const joy = { active: false, id: null, ox: 0, oy: 0, mx: 0, my: 0 };

const IS_TOUCH =
  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
  "ontouchstart" in window;

/* ================================ WebSocket ================================= */
function wsUrl() {
  return (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
}

function connectWs() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    for (const item of wsQueue) ws.send(item.data);
    wsQueue = [];
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
    const hadJoinIntent = wsQueue.some((i) => i.type === "create" || i.type === "join");
    // Nunca dejar mensajes viejos encolados para una conexión futura.
    wsQueue = [];
    if (phase !== "home") {
      toast("Se perdió la conexión con el servidor");
      goHome(false);
    } else if (hadJoinIntent) {
      // La conexión falló con un create/join pendiente: avisar. (El polling de
      // salas reintenta solo en el próximo tick, sin toast.)
      toast("No se pudo conectar al servidor");
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
    case "gameover":
      handleGameover(msg);
      break;
    default:
      break;
  }
}

function handleJoined(msg) {
  myId = msg.playerId;
  hostId = msg.hostId;
  roomCode = msg.room;
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
  // Polling de salas públicas SOLO mientras el home está visible (SPEC).
  if (name === "home") startRoomsPolling();
  else stopRoomsPolling();
  updateRotateOverlay();
}

function goHome(sendLeave) {
  if (sendLeave && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave" }));
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
function requestRooms() {
  if (phase !== "home") return;
  if (document.hidden) return; // pestaña oculta: no gastar red, reintenta el próximo tick
  wsSend({ type: "listRooms" });
}

function startRoomsPolling() {
  stopRoomsPolling();
  requestRooms();
  roomsPollTimer = setInterval(requestRooms, ROOMS_POLL_MS);
}

function stopRoomsPolling() {
  if (roomsPollTimer) {
    clearInterval(roomsPollTimer);
    roomsPollTimer = 0;
  }
}

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
    list.map((r) => [r.code, r.roomName, r.hostName, r.count, r.max, r.mode, r.stadium])
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
    ended = false;
  }
  phase = "lobby";
  lobby = {
    code: typeof msg.code === "string" ? msg.code : roomCode,
    roomName: typeof msg.roomName === "string" ? msg.roomName : "",
    visibility: msg.visibility === "public" ? "public" : "private",
    mode: typeof msg.mode === "string" ? msg.mode : "ffa",
    stadium: typeof msg.stadium === "string" ? msg.stadium : "clasico",
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

on(btnLeave, "click", () => goHome(true));

/* -------------------- Countdown de auto-arranque (#lobby-countdown) -------------------- */
function handleStarting(msg) {
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

/* ============================ Geometría (= server) ============================ */
function buildGeometry(n) {
  let verts;
  let walls;
  if (n === 2) {
    verts = [
      { x: -RECT_W, y: -RECT_H },
      { x: RECT_W, y: -RECT_H },
      { x: RECT_W, y: RECT_H },
      { x: -RECT_W, y: RECT_H },
    ];
    walls = [
      { cx: -RECT_W, cy: 0, dx: 0, dy: 1, nx: -1, ny: 0, half: RECT_H, goal: 0 },
      { cx: RECT_W, cy: 0, dx: 0, dy: 1, nx: 1, ny: 0, half: RECT_H, goal: 1 },
      { cx: 0, cy: -RECT_H, dx: 1, dy: 0, nx: 0, ny: -1, half: RECT_W, goal: null },
      { cx: 0, cy: RECT_H, dx: 1, dy: 0, nx: 0, ny: 1, half: RECT_W, goal: null },
    ];
  } else {
    verts = [];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
      verts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
    }
    walls = [];
    for (let k = 0; k < n; k++) {
      const a = verts[k];
      const b = verts[(k + 1) % n];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ml = Math.hypot(mx, my);
      walls.push({
        cx: mx,
        cy: my,
        dx: (b.x - a.x) / len,
        dy: (b.y - a.y) / len,
        nx: mx / ml,
        ny: my / ml,
        half: len / 2,
        goal: k,
      });
    }
  }
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
  return { verts, walls, bounds: { minX, maxX, minY, maxY } };
}

function buildFieldPath(verts) {
  const p = new Path2D();
  p.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) p.lineTo(verts[i].x, verts[i].y);
  p.closePath();
  return p;
}

/* ================================== Partido ================================== */
// Etiqueta humana de un equipo: nombres de sus integrantes ("Leo", "Gonza y Leo").
function teamLabel(team) {
  if (!team || team.members.length === 0) return "Equipo";
  return team.members.map((m) => m.name).join(" y ");
}

function handleStart(msg) {
  const cfg = msg.config;
  if (!cfg || !Array.isArray(cfg.players) || !Array.isArray(cfg.teams)) return;
  const n = cfg.teams.length; // n = cantidad de EQUIPOS (v1.1); arco k = equipo k
  if (n < 2) return;
  const geo = buildGeometry(n);

  const players = cfg.players.map((p) => {
    const info = countryInfo(p.country);
    return {
      id: p.id,
      name: p.name,
      country: p.country,
      team: typeof p.team === "number" ? p.team : 0,
      c1: info.c1,
      c2: info.c2,
      flag: flagOf(p.country),
    };
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  const teams = cfg.teams.map((t, idx) => {
    const members = (Array.isArray(t.players) ? t.players : [])
      .map((id) => byId.get(id))
      .filter(Boolean);
    return {
      index: idx,
      members,
      c1: members[0] ? members[0].c1 : "#9fb0c8",
      c2: members[0] ? members[0].c2 : "#ffffff",
      flags: members.map((m) => m.flag).join(""),
    };
  });

  const me = byId.get(myId);
  match = {
    mode: typeof cfg.mode === "string" ? cfg.mode : "ffa",
    stadium: typeof cfg.stadium === "string" ? cfg.stadium : "clasico",
    n,
    players,
    byId,
    teams,
    myTeam: me ? me.team : null,
    walls: geo.walls,
    verts: geo.verts,
    bounds: geo.bounds,
    fieldPath: buildFieldPath(geo.verts),
  };
  snaps = [];
  ringFx = [];
  ballTrail = [];
  confetti = [];
  confettiRainUntil = 0;
  ballSpin = 0;
  ended = false;
  tackleCdUntil = 0;
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
  const pm = new Map();
  if (Array.isArray(msg.players)) {
    for (const p of msg.players) pm.set(p.id, p);
  }
  // Detección de eventos (patada / barrida / stun) comparando con el snapshot anterior.
  const prev = snaps[snaps.length - 1];
  if (prev) {
    for (const [id, p] of pm) {
      const q = prev.players.get(id);
      if (!q) continue;
      if (p.kc > q.kc + 0.05) {
        ringFx.push({ x: p.x, y: p.y, t });
        sfxKick();
        // Squash de la pelota solo si la patada fue cerca de ella.
        if (msg.ball && Math.hypot(msg.ball.x - p.x, msg.ball.y - p.y) < 70) {
          lastKickT = t;
        }
      }
      const qSlide = q.slide || 0;
      if ((p.slide || 0) > qSlide + 0.05) sfxTackle(); // arranque del slide
      if (p.stun > q.stun + 0.05) {
        // Barrida que conecta: vibración si me la dieron a mí + relator.
        if (id === myId) vibrate(40);
        const victim = match.byId.get(id);
        // El que barre: el jugador en slide más cercano a la víctima.
        let tacklerId = null;
        let bestD = Infinity;
        for (const [oid, op] of pm) {
          if (oid === id || (op.slide || 0) <= 0.02) continue;
          const dd = (op.x - p.x) * (op.x - p.x) + (op.y - p.y) * (op.y - p.y);
          if (dd < bestD) {
            bestD = dd;
            tacklerId = oid;
          }
        }
        const tackler = tacklerId ? match.byId.get(tacklerId) : null;
        commentator("tackle", {
          name: tackler ? tackler.name : "",
          rival: victim ? victim.name : "",
        });
      }
    }
    // Rebote contra pared (sfxBounce tiene su propio rate-limit de 90 ms).
    if (msg.ball && prev.ball) {
      const flippedX = msg.ball.vx * prev.ball.vx < 0;
      const flippedY = msg.ball.vy * prev.ball.vy < 0;
      if ((flippedX || flippedY) && Math.hypot(prev.ball.vx, prev.ball.vy) > 180) {
        sfxBounce();
      }
    }
  }
  snaps.push({ t, ball: msg.ball, players: pm, paused: !!msg.paused });
  if (snaps.length > 40) snaps.shift();
  if (Array.isArray(msg.scores)) updateScores(msg.scores);

  const me = pm.get(myId);
  if (me && btnKick) btnKick.classList.toggle("cooldown", me.kc > 0.02);
}

function handleGoal(msg) {
  if (!match) return;
  if (Array.isArray(msg.scores)) updateScores(msg.scores);
  clearOverlayTimers();
  overlayEl.textContent = "";

  const scorer = msg.scorerId ? match.byId.get(msg.scorerId) : null;
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
    goalText.textContent = "¡GOL DE " + scorer.name.toUpperCase() + "!";
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
      ? scorer.name + " la mandó contra su propio arco"
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
    name: scorer ? scorer.name : scorerTeam ? teamLabel(scorerTeam) : conceded ? teamLabel(conceded) : "",
    streak: goalStreak.count,
  });

  // Si ningún equipo llegó a WIN_SCORE viene un kickoff: cuenta regresiva en la pausa.
  const someoneWon = Array.isArray(msg.scores) && msg.scores.some((s) => s >= WIN_SCORE);
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
  // interpolar el "teletransporte" a los spawns.
  snaps = [];
  clearOverlayTimers();
  overlayEl.textContent = "";
}

function handleGameover(msg) {
  if (Array.isArray(msg.scores)) updateScores(msg.scores);
  ended = true;
  stopInputLoop();
  clearOverlayTimers();
  overlayEl.textContent = "";

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
  sub.textContent =
    wt && wt.members.length > 1 ? "¡Campeones del PoliGol!" : "¡Campeón del PoliGol!";
  card.append(flag, name, sub);
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
function buildScoreboard() {
  scoreboardEl.textContent = "";
  scoreItems = [];
  const teamMode = match.mode === "1v1" || match.mode === "2v2";
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
    name.textContent = team.members.map((m) => m.name).join(" + ");
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
const KEYMAP = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

function currentInput() {
  if (joy.active) return { mx: joy.mx, my: joy.my };
  let x = 0;
  let y = 0;
  if (keys.has("up")) y -= 1;
  if (keys.has("down")) y += 1;
  if (keys.has("left")) x -= 1;
  if (keys.has("right")) x += 1;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { mx: x, my: y };
}

// kick/tackle son edge-trigger: true solo en el mensaje del momento de presión.
function sendInput(kick, tackle) {
  if (phase !== "game" || ended || !ws || ws.readyState !== WebSocket.OPEN) return;
  const v = currentInput();
  ws.send(JSON.stringify({ type: "input", mx: v.mx, my: v.my, kick: !!kick, tackle: !!tackle }));
}

function pressKick() {
  sendInput(true, false);
}

function pressTackle() {
  sendInput(false, true);
  tackleCdUntil = performance.now() + TACKLE_COOLDOWN * 1000;
}

function startInputLoop() {
  stopInputLoop();
  inputTimer = setInterval(() => sendInput(false, false), Math.round(1000 / INPUT_HZ));
}

function stopInputLoop() {
  if (inputTimer) {
    clearInterval(inputTimer);
    inputTimer = 0;
  }
  keys.clear();
  joyReset();
}

window.addEventListener("keydown", (e) => {
  if (phase !== "game") return;
  const dir = KEYMAP[e.code];
  if (dir) {
    keys.add(dir);
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "KeyJ") {
    e.preventDefault();
    pressKick();
  } else if (e.key === "Shift" || e.code === "KeyK") {
    e.preventDefault();
    pressTackle();
  }
});

window.addEventListener("keyup", (e) => {
  const dir = KEYMAP[e.code];
  if (dir) keys.delete(dir);
});

window.addEventListener("blur", () => keys.clear());

/* ------------------------------ Joystick DINÁMICO ------------------------------ */
// v1.1: el joystick aparece centrado donde el dedo toca la MITAD IZQUIERDA de la
// pantalla durante el partido (no posición fija). Se posiciona con estilos inline
// (position:fixed + translate(-50%,-50%)) para no depender del CSS.
function joyStart(t) {
  joy.active = true;
  joy.id = t.identifier;
  joy.ox = t.clientX;
  joy.oy = t.clientY;
  joy.mx = 0;
  joy.my = 0;
  if (joystickEl) {
    joystickEl.classList.add("active");
    joystickEl.style.position = "fixed";
    joystickEl.style.left = t.clientX + "px";
    joystickEl.style.top = t.clientY + "px";
    joystickEl.style.transform = "translate(-50%, -50%)";
    joystickEl.style.visibility = "visible";
  }
  if (joystickStick) joystickStick.style.transform = "";
}

function joyMove(t) {
  let dx = t.clientX - joy.ox;
  let dy = t.clientY - joy.oy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_RADIUS) {
    dx *= JOY_RADIUS / d;
    dy *= JOY_RADIUS / d;
  }
  if (joystickStick) {
    joystickStick.style.transform =
      "translate(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px)";
  }
  joy.mx = dx / JOY_RADIUS;
  joy.my = dy / JOY_RADIUS;
}

function joyReset() {
  joy.active = false;
  joy.id = null;
  joy.mx = 0;
  joy.my = 0;
  if (joystickStick) joystickStick.style.transform = "";
  if (joystickEl) {
    joystickEl.classList.remove("active");
    joystickEl.style.visibility = "hidden";
  }
}

window.addEventListener(
  "touchstart",
  (e) => {
    if (phase !== "game" || ended) return;
    for (const t of e.changedTouches) {
      if (joy.active) break;
      if (t.clientX > window.innerWidth / 2) continue; // solo mitad izquierda
      const tgt = t.target;
      // No robar toques destinados a botones/links/modal (kick los maneja aparte).
      if (tgt && tgt.closest && tgt.closest("button, a, #options-modal")) continue;
      e.preventDefault();
      joyStart(t);
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (!joy.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        e.preventDefault();
        joyMove(t);
      }
    }
  },
  { passive: false }
);

function joyEnd(e) {
  if (!joy.active) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      joyReset();
      sendInput(false, false); // freno inmediato
    }
  }
}
window.addEventListener("touchend", joyEnd);
window.addEventListener("touchcancel", joyEnd);

function bindTouchButton(btn, onPress) {
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
  // Fallback para dispositivos con mouse que muestren los controles.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onPress();
  });
}
bindTouchButton(btnKick, pressKick);
bindTouchButton(btnTackle, pressTackle);

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
  if (nowMs < speakUntil && prio < speakPrio) return;
  try {
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
        const someone = match.players[Math.floor(Math.random() * match.players.length)];
        arr.push("Sale jugando " + someone.name + "...");
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

/* ============================ Interpolación (100 ms) ============================ */
function sampleState() {
  if (!snaps.length) return null;
  const rt = performance.now() - INTERP_DELAY;
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
  for (const [id, p1] of s1.players) {
    const p0 = s0.players.get(id) || p1;
    players.set(id, {
      id,
      x: L(p0.x, p1.x),
      y: L(p0.y, p1.y),
      fx: L(p0.fx, p1.fx),
      fy: L(p0.fy, p1.fy),
      stun: p1.stun,
      kc: p1.kc,
      slide: p1.slide || 0, // v1.1: s restantes de barrida (0 si no)
    });
  }
  return {
    ball: {
      x: L(s0.ball.x, s1.ball.x),
      y: L(s0.ball.y, s1.ball.y),
      vx: L(s0.ball.vx, s1.ball.vx),
      vy: L(s0.ball.vy, s1.ball.vy),
    },
    players,
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

// Sombrillas alrededor de la cancha (estadio "playa"), fuera del campo.
function drawUmbrellas() {
  if (!match.umbrellas) {
    const arr = [];
    let i = 0;
    for (const w of match.walls) {
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

function drawGoals() {
  const gw = GOAL_W / 2;
  for (const w of match.walls) {
    if (w.goal === null) continue;
    const owner = match.teams[w.goal]; // v1.1: el arco k pertenece al EQUIPO k
    if (!owner) continue;
    const x0 = w.cx - w.dx * gw;
    const y0 = w.cy - w.dy * gw;
    const x1 = w.cx + w.dx * gw;
    const y1 = w.cy + w.dy * gw;

    // Red en cuadrícula detrás de la línea (hacia afuera).
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 1.3;
    const depth = 20;
    const step = 8;
    ctx.beginPath();
    for (let s = -gw; s <= gw + 0.1; s += step) {
      ctx.moveTo(w.cx + w.dx * s, w.cy + w.dy * s);
      ctx.lineTo(w.cx + w.dx * s + w.nx * depth, w.cy + w.dy * s + w.ny * depth);
    }
    for (let d = 0; d <= depth + 0.1; d += step) {
      ctx.moveTo(x0 + w.nx * d, y0 + w.ny * d);
      ctx.lineTo(x1 + w.nx * d, y1 + w.ny * d);
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
    ctx.fillText(owner.flags, w.cx + w.nx * 38, w.cy + w.ny * 38);
    ctx.restore();
  }
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

    ctx.save();
    ctx.translate(p.x, p.y);

    // Sombra elíptica.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, PLAYER_R * 0.78, PLAYER_R * 1.05, PLAYER_R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Botines debajo del cuerpo (etapa 2 los dibuja de verdad).
    drawPlayerFeet(p, pl, now);

    // Halo distintivo del propio jugador.
    if (pl.id === myId) {
      ctx.strokeStyle = "rgba(245,197,66,0.9)";
      ctx.lineWidth = 2.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 6, now / 600, now / 600 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (stunned) ctx.rotate(Math.sin(now / 90) * 0.2);

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

    // Cuerpo con gradiente radial c2 → c1 (gris si está stunned).
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

    // Bandera arriba y nombre abajo (sin rotación de stun).
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(pl.flag, p.x, p.y - PLAYER_R - 13);
    if (settings.names) {
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = pl.id === myId ? "#ffdf7e" : "rgba(255,255,255,0.88)";
      ctx.fillText(pl.name, p.x, p.y + PLAYER_R + 13);
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
  ballSpin += (speed / BALL_R) * dt * 0.35;

  // Estela cuando va rápido.
  ballTrail.push({ x: b.x, y: b.y });
  if (ballTrail.length > 14) ballTrail.shift();
  if (speed > 240) {
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

  // Feedback de cooldown de barrida (la de patada llega en el estado: kc).
  if (btnTackle) btnTackle.classList.toggle("cooldown", performance.now() < tackleCdUntil);
}

/* ================================ Inicialización ================================ */
buildCountryGrid();

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

if (joystickEl) joystickEl.style.visibility = "hidden"; // solo aparece bajo el dedo
syncSettingsUI();
showScreen("home"); // arranca el polling de salas públicas
requestAnimationFrame(frame);
