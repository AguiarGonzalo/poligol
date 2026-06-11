"use strict";

/* ============================================================
 * PoliGol — cliente (vanilla JS, sin dependencias).
 * Conexión WebSocket, pantallas home/lobby/juego, render canvas
 * con interpolación (100 ms en el pasado), input teclado + táctil
 * y sonido WebAudio sintetizado. Implementa el contrato de SPEC.md.
 * ============================================================ */

/* ================= Constantes compartidas (SPEC, = server.js) ================= */
const R = 380;              // circunradio del polígono (unidades de mundo)
const PLAYER_R = 14;        // radio del jugador
const BALL_R = 10;          // radio de la pelota
const GOAL_W = 112;         // ancho del arco
const WIN_SCORE = 3;        // puntaje objetivo
const MIN_PLAYERS = 2;
const RECT_W = 480;         // half-extent horizontal para n = 2
const RECT_H = 290;         // half-extent vertical para n = 2
const TACKLE_COOLDOWN = 1.6; // s — solo para feedback visual del botón táctil

/* ======================= Constantes propias del cliente ======================= */
const WORLD_MARGIN = 70;    // margen alrededor del bounding del polígono (SPEC render)
const INTERP_DELAY = 100;   // ms: se renderiza 100 ms en el pasado (SPEC)
const INPUT_HZ = 30;        // envío de input a ~30 Hz (SPEC)
const JOY_RADIUS = 38;      // px de recorrido máximo del stick del joystick

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

const screenHome = $("screen-home");
const screenLobby = $("screen-lobby");
const screenGame = $("screen-game");
const nameInput = $("name-input");
const countryGrid = $("country-grid");
const btnCreate = $("btn-create");
const roomInput = $("room-input");
const btnJoin = $("btn-join");
const roomCodeLabel = $("room-code-label");
const playersList = $("players-list");
const btnStart = $("btn-start");
const btnLeave = $("btn-leave");
const canvas = $("game-canvas");
const scoreboardEl = $("scoreboard");
const overlayEl = $("overlay");
const btnRematch = $("btn-rematch");
const btnExit = $("btn-exit");
const joystickEl = $("touch-joystick");
const joystickStick = joystickEl.querySelector(".joystick-stick");
const btnKick = $("btn-kick");
const btnTackle = $("btn-tackle");
const endgameActions = document.querySelector(".endgame-actions");
const lobbyCard = document.querySelector(".lobby-card");
const lobbyActions = document.querySelector(".lobby-actions");
const ctx = canvas.getContext("2d");

/* ================================== Estado ================================== */
let ws = null;
let wsQueue = [];
let myId = null;
let hostId = null;
let roomCode = null;
let selectedCountry = null;
let phase = "home";        // "home" | "lobby" | "game"
let ended = false;         // true tras gameover (hasta rematch / salir)

let match = null;          // { n, players, byId, walls, verts, bounds, fieldPath }
let snaps = [];            // buffer de snapshots {t, ball, players(Map), paused}
let scoreItems = {};       // id → {root, valEl, value}
let overlayTimers = [];
let copiedTimer = 0;
let inputTimer = 0;
let tackleCdUntil = 0;

// Efectos visuales
let ringFx = [];                // ondas expansivas de patada (coords de mundo)
let confetti = [];              // confetti (coords de pantalla, px CSS)
let ballTrail = [];
let ballSpin = 0;
let confettiRainUntil = 0;
let rainColors = ["#f5c542", "#ffffff"];
let lastFrameT = performance.now();

const keys = new Set();
const joy = { active: false, id: null, mx: 0, my: 0 };

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
    if (phase !== "home") {
      toast("Se perdió la conexión con el servidor");
      goHome(false);
    } else if (wsQueue.length > 0) {
      // La conexión falló con mensajes pendientes (create/join): avisar.
      toast("No se pudo conectar al servidor");
    }
    // Nunca dejar mensajes viejos encolados para una conexión futura.
    wsQueue = [];
  };
  ws.onerror = () => {};
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
  }
  wsQueue.push({ type: msg.type, data });
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    connectWs();
  }
}

/* ============================ Despacho de mensajes ============================ */
function handleMessage(msg) {
  switch (msg.type) {
    case "joined":
      myId = msg.playerId;
      hostId = msg.hostId;
      roomCode = msg.room;
      match = null;
      ended = false;
      phase = "lobby";
      roomCodeLabel.textContent = roomCode;
      playersList.textContent = "";
      showScreen("lobby");
      break;
    case "error":
      toast(typeof msg.message === "string" ? msg.message : "Error");
      break;
    case "lobby":
      handleLobby(msg);
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

/* ================================= Pantallas ================================= */
function showScreen(name) {
  screenHome.classList.toggle("hidden", name !== "home");
  screenLobby.classList.toggle("hidden", name !== "lobby");
  screenGame.classList.toggle("hidden", name !== "game");
}

function goHome(sendLeave) {
  if (sendLeave && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave" }));
  }
  stopInputLoop();
  clearOverlayTimers();
  overlayEl.textContent = "";
  endgameActions.classList.add("hidden");
  match = null;
  snaps = [];
  confetti = [];
  confettiRainUntil = 0;
  ended = false;
  roomCode = null;
  phase = "home";
  showScreen("home");
}

/* =================================== Home =================================== */
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
    btn.addEventListener("click", () => {
      selectedCountry = c.code;
      for (const el of countryGrid.children) {
        const isSel = el === btn;
        el.classList.toggle("selected", isSel);
        el.setAttribute("aria-selected", isSel ? "true" : "false");
      }
    });
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

btnCreate.addEventListener("click", () => {
  const v = validateHome(false);
  if (!v) return;
  wsSend({ type: "create", name: v.name, country: v.country });
});

btnJoin.addEventListener("click", () => {
  const v = validateHome(true);
  if (!v) return;
  wsSend({ type: "join", name: v.name, country: v.country, room: v.room });
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
});
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnJoin.click();
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnCreate.click();
});

// ?room=CODE en la URL → precargar el código en el home (SPEC).
{
  const urlRoom = new URLSearchParams(location.search).get("room");
  if (urlRoom) roomInput.value = urlRoom.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

/* =================================== Lobby =================================== */
function handleLobby(msg) {
  // Broadcast tardío tras "Salir": si ya no pertenecemos a una sala, ignorarlo
  // (la pertenencia la definen "joined"/goHome, no un mensaje en vuelo).
  if (phase === "home" || !roomCode) return;
  if (phase === "game") {
    // Partido abortado (o sala vuelta al lobby): salir del juego.
    stopInputLoop();
    clearOverlayTimers();
    overlayEl.textContent = "";
    endgameActions.classList.add("hidden");
    match = null;
    snaps = [];
    confetti = [];
    confettiRainUntil = 0;
    ended = false;
  }
  phase = "lobby";
  showScreen("lobby");
  renderLobby(Array.isArray(msg.players) ? msg.players : [], msg.notice);
}

function renderLobby(players, notice) {
  roomCodeLabel.textContent = roomCode || "····";
  playersList.textContent = "";
  const host = players.find((p) => p.isHost);
  hostId = host ? host.id : null;

  for (const p of players) {
    const li = document.createElement("li");
    li.className = "player-item" + (p.id === myId ? " me" : "");
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
    playersList.appendChild(li);
  }

  // Botón de empezar: visible solo para el host, habilitado con ≥ MIN_PLAYERS.
  const meHost = hostId === myId;
  btnStart.classList.toggle("hidden", !meHost);
  btnStart.disabled = players.length < MIN_PLAYERS;

  const old = lobbyCard.querySelector(".lobby-notice");
  if (old) old.remove();
  if (notice) {
    const div = document.createElement("div");
    div.className = "lobby-notice";
    div.textContent = notice;
    lobbyCard.insertBefore(div, lobbyActions);
  }
}

btnStart.addEventListener("click", () => wsSend({ type: "startGame" }));
btnLeave.addEventListener("click", () => goHome(true));

// Click en el código → copiar link de invitación al portapapeles.
roomCodeLabel.addEventListener("click", () => {
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
function handleStart(msg) {
  const cfg = msg.config;
  if (!cfg || !Array.isArray(cfg.players)) return;
  const geo = buildGeometry(cfg.n);
  const players = cfg.players.map((p, i) => {
    const info = countryInfo(p.country);
    return {
      id: p.id,
      name: p.name,
      country: p.country,
      index: i,
      c1: info.c1,
      c2: info.c2,
      flag: flagOf(p.country),
    };
  });
  match = {
    n: cfg.n,
    players,
    byId: new Map(players.map((p) => [p.id, p])),
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
  clearOverlayTimers();
  overlayEl.textContent = "";
  endgameActions.classList.add("hidden");
  buildScoreboard();
  phase = "game";
  showScreen("game");
  startInputLoop();
  showCountdown(["3", "2", "1"], 380, "¡A JUGAR!");
}

function handleState(msg) {
  if (!match || phase !== "game") return;
  const t = performance.now();
  const pm = new Map();
  if (Array.isArray(msg.players)) {
    for (const p of msg.players) pm.set(p.id, p);
  }
  // Detección de eventos (patada / stun) comparando con el snapshot anterior.
  const prev = snaps[snaps.length - 1];
  if (prev) {
    for (const [id, p] of pm) {
      const q = prev.players.get(id);
      if (!q) continue;
      if (p.kc > q.kc + 0.05) {
        ringFx.push({ x: p.x, y: p.y, t });
        sfxKick();
      }
      if (p.stun > q.stun + 0.05) sfxTackle();
    }
  }
  snaps.push({ t, ball: msg.ball, players: pm, paused: !!msg.paused });
  if (snaps.length > 40) snaps.shift();
  if (msg.scores) updateScores(msg.scores);

  const me = pm.get(myId);
  if (me) btnKick.classList.toggle("cooldown", me.kc > 0.02);
}

function handleGoal(msg) {
  if (!match) return;
  if (msg.scores) updateScores(msg.scores);
  clearOverlayTimers();
  overlayEl.textContent = "";

  const scorer = msg.scorerId ? match.byId.get(msg.scorerId) : null;
  const victim = match.byId.get(msg.victimId);

  const goalText = document.createElement("div");
  goalText.className = "goal-text";
  if (scorer) {
    goalText.textContent = "¡GOL DE " + scorer.name.toUpperCase() + "!";
    goalText.style.color = scorer.c1;
  } else {
    goalText.textContent = "¡GOL EN CONTRA!";
    if (victim) goalText.style.color = victim.c1;
  }
  overlayEl.appendChild(goalText);

  const sub = document.createElement("div");
  sub.className = "overlay-sub";
  sub.textContent = msg.ownGoal && victim
    ? victim.name + " la mandó contra su propio arco"
    : victim
      ? "En el arco de " + victim.name
      : "";
  overlayEl.appendChild(sub);

  sfxGoal();
  const colors = scorer ? [scorer.c1, scorer.c2] : victim ? [victim.c1, victim.c2] : rainColors;
  confettiBurst(colors);

  // Si nadie llegó a WIN_SCORE viene un kickoff: cuenta regresiva durante la pausa.
  const someoneWon = Object.values(msg.scores || {}).some((s) => s >= WIN_SCORE);
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
  if (msg.scores) updateScores(msg.scores);
  ended = true;
  stopInputLoop();
  clearOverlayTimers();
  overlayEl.textContent = "";

  const w = match ? match.byId.get(msg.winnerId) : null;
  const card = document.createElement("div");
  card.className = "winner-card";
  const flag = document.createElement("div");
  flag.className = "winner-flag";
  flag.textContent = w ? w.flag : "🏆";
  const name = document.createElement("div");
  name.className = "winner-name";
  name.textContent = w ? w.name : "Campeón";
  const sub = document.createElement("div");
  sub.className = "winner-sub";
  sub.textContent = "¡Campeón del PoliGol!";
  card.append(flag, name, sub);
  overlayEl.appendChild(card);

  endgameActions.classList.remove("hidden");
  btnRematch.classList.toggle("hidden", hostId !== myId);

  rainColors = w ? [w.c1, w.c2, "#f5c542"] : ["#f5c542", "#ffffff"];
  confettiRainUntil = performance.now() + 6500;
  sfxGoal();
}

btnRematch.addEventListener("click", () => wsSend({ type: "rematch" }));
btnExit.addEventListener("click", () => goHome(true));

/* ================================= Scoreboard ================================ */
function buildScoreboard() {
  scoreboardEl.textContent = "";
  scoreItems = {};
  for (const pl of match.players) {
    const item = document.createElement("div");
    item.className = "score-item" + (pl.id === myId ? " me" : "");
    const flag = document.createElement("span");
    flag.className = "score-flag";
    flag.textContent = pl.flag;
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = pl.name;
    const val = document.createElement("span");
    val.className = "score-value";
    val.textContent = "0";
    item.append(flag, name, val);
    item.addEventListener("animationend", () => item.classList.remove("bump"));
    scoreboardEl.appendChild(item);
    scoreItems[pl.id] = { root: item, valEl: val, value: 0 };
  }
}

function updateScores(scores) {
  for (const id of Object.keys(scores)) {
    const it = scoreItems[id];
    if (!it) continue;
    const v = scores[id];
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

/* ------------------------------ Input táctil ------------------------------ */
function joyReset() {
  joy.active = false;
  joy.id = null;
  joy.mx = 0;
  joy.my = 0;
  joystickStick.style.transform = "";
  joystickEl.classList.remove("active");
}

function joyMove(touch) {
  const r = joystickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let dx = touch.clientX - cx;
  let dy = touch.clientY - cy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_RADIUS) {
    dx *= JOY_RADIUS / d;
    dy *= JOY_RADIUS / d;
  }
  joystickStick.style.transform = "translate(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px)";
  joy.mx = dx / JOY_RADIUS;
  joy.my = dy / JOY_RADIUS;
}

joystickEl.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (joy.active) return;
    const t = e.changedTouches[0];
    joy.active = true;
    joy.id = t.identifier;
    joystickEl.classList.add("active");
    joyMove(t);
  },
  { passive: false }
);

joystickEl.addEventListener(
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
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      joyReset();
      sendInput(false, false); // freno inmediato
    }
  }
}
joystickEl.addEventListener("touchend", joyEnd);
joystickEl.addEventListener("touchcancel", joyEnd);

function bindTouchButton(btn, onPress) {
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

/* ============================ Sonido (WebAudio) ============================= */
let audioCtx = null;

function ensureAudio() {
  if (audioCtx) {
    // iOS/Safari pueden suspender el contexto (interrupciones, cambio de
    // pestaña): reanudarlo en cada gesto para que los sfx no queden mudos.
    if (audioCtx.state === "suspended") audioCtx.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  } catch (err) {
    audioCtx = null;
  }
}
// El AudioContext se crea en el primer gesto del usuario (SPEC).
document.addEventListener("pointerdown", ensureAudio, true);
document.addEventListener("keydown", ensureAudio, true);
document.addEventListener("touchstart", ensureAudio, true);

function sfxKick() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.09);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.13);
}

function sfxTackle() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.2);

  // Golpecito de ruido corto.
  const dur = 0.07;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const ng = audioCtx.createGain();
  ng.gain.value = 0.18;
  src.connect(ng);
  ng.connect(audioCtx.destination);
  src.start(t);
}

function sfxGoal() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const dur = 1.5;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 900;
  f.Q.value = 0.8;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.45, t + 0.2);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(audioCtx.destination);
  src.start(t);
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

function paintBackground(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0e1730");
  g.addColorStop(0.55, "#0a0f1e");
  g.addColorStop(1, "#070b16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.22, W / 2, H * 0.46, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawField() {
  const b = match.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;

  ctx.save();
  ctx.clip(match.fieldPath);
  // Césped base + franjas alternadas.
  ctx.fillStyle = "#1c7a3c";
  ctx.fillRect(b.minX - 10, b.minY - 10, bw + 20, bh + 20);
  ctx.fillStyle = "#239149";
  const stripe = 58;
  let i = 0;
  for (let y = b.minY - 10; y < b.maxY + 10; y += stripe, i++) {
    if (i % 2 === 0) ctx.fillRect(b.minX - 10, y, bw + 20, stripe);
  }
  // Sombreado radial sutil del césped.
  const rg = ctx.createRadialGradient(0, 0, 50, 0, 0, Math.max(bw, bh) * 0.72);
  rg.addColorStop(0, "rgba(255,255,255,0.06)");
  rg.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = rg;
  ctx.fillRect(b.minX - 10, b.minY - 10, bw + 20, bh + 20);
  // Círculo central + punto.
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Línea de borde blanca gruesa semi-brillante.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 14;
  ctx.stroke(match.fieldPath);
  ctx.restore();
}

function drawGoals() {
  const gw = GOAL_W / 2;
  for (const w of match.walls) {
    if (w.goal === null) continue;
    const owner = match.players[w.goal];
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

    // Boca del arco pintada del color c1 del dueño con glow.
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

    // Bandera emoji del dueño cerca de su arco (afuera de la cancha).
    ctx.save();
    ctx.font = "28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner.flag, w.cx + w.nx * 38, w.cy + w.ny * 38);
    ctx.restore();
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
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = pl.id === myId ? "#ffdf7e" : "rgba(255,255,255,0.88)";
    ctx.fillText(pl.name, p.x, p.y + PLAYER_R + 13);
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

function drawBall(st, dt) {
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
function confettiBurst(colors) {
  const cw = canvas.clientWidth || window.innerWidth;
  const ch = canvas.clientHeight || window.innerHeight;
  for (let i = 0; i < 90; i++) {
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
  if (now < confettiRainUntil && Math.random() < 0.55) {
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

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintBackground(W, H);

  // Encajar el mundo (bounding + margen 70) centrado, manteniendo aspecto.
  const b = match.bounds;
  const bw = b.maxX - b.minX + WORLD_MARGIN * 2;
  const bh = b.maxY - b.minY + WORLD_MARGIN * 2;
  const s = Math.min(W / bw, H / bh);
  const ox = W / 2 - s * (b.minX + b.maxX) / 2;
  const oy = H / 2 - s * (b.minY + b.maxY) / 2;
  ctx.setTransform(s, 0, 0, s, ox, oy);

  drawField();
  drawGoals();

  const st = sampleState();
  if (st) {
    drawPlayers(st, now);
    if (!st.paused) {
      drawBall(st, dt);
    } else {
      ballTrail.length = 0; // la pelota "desaparece" durante la pausa post-gol
    }
  }
  drawRings(now);

  // Confetti en espacio de pantalla (px CSS).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateConfetti(dt, now);

  // Feedback de cooldown de barrida (la de patada llega en el estado: kc).
  btnTackle.classList.toggle("cooldown", performance.now() < tackleCdUntil);
}

/* ================================ Inicialización ================================ */
buildCountryGrid();
showScreen("home");
requestAnimationFrame(frame);
