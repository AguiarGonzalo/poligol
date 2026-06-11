/*
 * PoliGol — servidor autoritativo (v1.1).
 * Node.js (CommonJS): http estático (http + fs + path) + WebSocket ("ws") sobre el
 * mismo server. Salas públicas/privadas con código de 4 letras, lobby con modos
 * (ffa/1v1/2v2), estadios, readies con auto-arranque, partido por EQUIPOS con física
 * a 60 Hz (sub-steps de pelota, dribble assist, slide) y broadcast a 30 Hz, goles,
 * puntajes por equipo, rematch, desconexiones y heartbeat.
 * Implementa el contrato definido en SPEC.md (v1 + bloque v1.1) al pie de la letra.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

/* ========================= Constantes compartidas (SPEC) ========================= */

const R = 380;              // circunradio del polígono (unidades de mundo)
const PLAYER_R = 14;        // radio del jugador
const BALL_R = 10;          // radio de la pelota
const GOAL_W = 112;         // ancho del arco = 4 × diámetro del jugador (4 × 28)
const WIN_SCORE = 3;        // puntaje objetivo
const TICK = 1 / 60;        // física del server a 60 Hz
const SNAP_HZ = 30;         // broadcast de estado a 30 Hz
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
// Movimiento
const ACCEL = 1400;         // u/s² aplicada según input normalizado
const MAX_SPEED = 230;      // u/s velocidad máxima del jugador
const FRICTION = 6;         // damping exponencial jugador: v *= exp(-FRICTION*dt) sin input
// Pelota
const BALL_FRICTION = 0.9;  // damping exponencial pelota: v *= exp(-BALL_FRICTION*dt)
const BALL_MAX_SPEED = 750;
const WALL_BOUNCE = 0.82;   // restitución contra paredes
// Acciones
const KICK_RANGE = 36;      // distancia centro-a-centro máx para patear la pelota
const KICK_POWER = 560;     // velocidad que adquiere la pelota al ser pateada
const KICK_COOLDOWN = 0.35; // s
const TACKLE_RANGE = 42;    // distancia centro-a-centro máx para barrer a un rival
const TACKLE_STUN = 0.9;    // s que el rival queda tirado
const TACKLE_COOLDOWN = 1.6;  // s
const GOAL_PAUSE = 2.0;     // s de pausa tras un gol antes de resetear

/* ============================ Constantes v1.1 (SPEC) ============================= */

// Física v1.1
const BALL_SUBSTEPS = 4;          // sub-pasos de integración de la pelota por tick
const KICK_VEL_FACTOR = 0.45;     // v1.1: patada = KICK_POWER + 0.45 × vel del jugador
const DRIBBLE_RANGE = PLAYER_R + BALL_R + 8; // 32 u — distancia máx del assist
const DRIBBLE_FORCE = 400;        // u/s² hacia el punto de control
const DRIBBLE_AHEAD = 22;         // punto objetivo a 22 u adelante del jugador (facing)
const DRIBBLE_MAX_REL = 260;      // velocidad relativa máx pelota-jugador del assist
const DRIBBLE_MIN_SPEED = 40;     // el assist requiere velocidad del jugador > 40
const SLIDE_DURATION = 0.38;      // s de barrida (slide): vel fija, sin control
const SLIDE_SPEED = 320;          // velocidad fija durante el slide
const SLIDE_KNOCKBACK = 420;      // v1.1: knockback al rival al conectar (pisa 380 de v1)
const SLIDE_BALL_FACTOR = 0.6;    // impulso a la pelota = 0.6 × SLIDE_KNOCKBACK
const BALL_PLAYER_E = 0.4;        // v1.1: restitución pelota-jugador
const BALL_PLAYER_TRANSFER = 0.8; // v1.1: transferencia de la velocidad del jugador

// Lobby / salas v1.1
const MODES = ["ffa", "1v1", "2v2"];
const STADIUMS = ["clasico", "noche", "playa", "nieve"];
const MAX_ROOM_NAME_LEN = 24;     // roomName sanitizado a ≤ 24 chars (SPEC)
const START_COUNTDOWN_S = 3;      // auto-arranque: "starting" y partido 3 s después
const TEAM_SPAWN_DY = 90;         // 2v2: compañeros separados ±90 en y (SPEC)

/* ===================== Constantes propias de esta implementación ================= */

const SPAWN_FACTOR = 0.62;       // spawn del jugador k en 0.62 × M_k (SPEC)
const RECT_W = 480;              // half-extent horizontal para n = 2 (SPEC)
const RECT_H = 290;              // half-extent vertical para n = 2 (SPEC)
const HEARTBEAT_MS = 15000;      // ping cada 15 s (SPEC)
const TICKS_PER_SNAP = Math.round(1 / TICK / SNAP_HZ); // 60/30 = 2 ticks por broadcast
const MAX_NAME_LEN = 16;         // sanitización de nombres (elección libre)
const PORT = process.env.PORT || 3000;

/* ===================== Estadios: multiplicadores de física (SPEC) ================ */

// Constantes efectivas de física para un estadio, según la tabla EXACTA del SPEC:
// clasico/noche sin cambios; playa BALL_FRICTION ×1.8; nieve ACCEL ×0.55,
// FRICTION ×0.45, BALL_FRICTION ×0.5 y WALL_BOUNCE = 0.9 (valor absoluto).
function stadiumPhysics(stadium) {
  const eff = {
    accel: ACCEL,
    friction: FRICTION,
    ballFriction: BALL_FRICTION,
    wallBounce: WALL_BOUNCE,
  };
  if (stadium === "playa") {
    eff.ballFriction = BALL_FRICTION * 1.8;
  } else if (stadium === "nieve") {
    eff.accel = ACCEL * 0.55;
    eff.friction = FRICTION * 0.45;
    eff.ballFriction = BALL_FRICTION * 0.5;
    eff.wallBounce = 0.9;
  }
  return eff;
}

/* ============================== Server http estático ============================== */

const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Método no permitido");
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Solicitud inválida");
    return;
  }
  // Rechazar null bytes y caracteres de control: fs.readFile lanza SINCRÓNICAMENTE
  // ante un path con "\0" y ese throw no capturado tumbaría el proceso (DoS).
  if (/[\u0000-\u001f\u007f]/.test(urlPath)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Solicitud inválida");
    return;
  }
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Prohibido");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  });
});

/* ================================== Utilidades ================================== */

function r2(v) {
  return Math.round(v * 100) / 100;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>&"'`]/g, "") // metacaracteres HTML: defensa en profundidad (se re-broadcastea)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
  return name.length > 0 ? name : null;
}

function cleanCountry(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// roomName: ≤ 24 chars sanitizados; default "Sala de " + nombre del host (SPEC v1.1).
function cleanRoomName(raw, hostName) {
  let name = "";
  if (typeof raw === "string") {
    name = raw
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[<>&"'`]/g, "") // metacaracteres HTML: defensa en profundidad (se re-broadcastea)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ROOM_NAME_LEN);
  }
  if (name.length === 0) {
    name = ("Sala de " + hostName).slice(0, MAX_ROOM_NAME_LEN);
  }
  return name;
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws, message) {
  send(ws, { type: "error", message });
}

/* ==================================== Salas ===================================== */

const rooms = new Map(); // código → room

// Códigos de 4 letras mayúsculas, A-Z sin las ambiguas I y O (SPEC).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function genRoomCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function broadcastLobby(room, notice) {
  const msg = {
    type: "lobby",
    code: room.code,
    roomName: room.roomName,
    visibility: room.visibility,
    mode: room.mode,
    stadium: room.stadium,
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      isHost: i === 0,
      ready: p.ready,
      team: p.team,
    })),
  };
  if (notice) msg.notice = notice;
  broadcast(room, msg);
}

/* ====================== Modos, equipos y auto-arranque (v1.1) ===================== */

// Cupo de la sala según el modo: ffa 2–8, 1v1 exactamente 2, 2v2 exactamente 4.
function modeCapacity(mode) {
  if (mode === "1v1") return 2;
  if (mode === "2v2") return 4;
  return MAX_PLAYERS;
}

function teamCount(room, team) {
  let c = 0;
  for (const p of room.players) {
    if (p.team === team) c++;
  }
  return c;
}

// Reasignación completa (al cambiar de modo): ffa/1v1 cada jugador es un equipo de 1
// (equipo = índice de llegada); 2v2 asignación automática ALTERNADA por orden de llegada.
function assignTeams(room) {
  room.players.forEach((p, i) => {
    p.team = room.mode === "2v2" ? i % 2 : i;
  });
}

// Ajuste incremental (join/leave): en ffa/1v1 se re-indexa (equipo = índice); en 2v2 se
// respetan las elecciones previas (setTeam) y el que no tiene equipo va al de menos gente.
function assignTeamsOnChange(room) {
  if (room.mode !== "2v2") {
    room.players.forEach((p, i) => {
      p.team = i;
    });
    return;
  }
  for (const p of room.players) {
    if (p.team !== 0 && p.team !== 1) {
      const c0 = room.players.filter((q) => q !== p && q.team === 0).length;
      const c1 = room.players.filter((q) => q !== p && q.team === 1).length;
      p.team = c0 <= c1 ? 0 : 1;
    }
  }
}

function resetReadies(room) {
  for (const p of room.players) p.ready = false;
}

// Condiciones de auto-arranque: TODOS ready y cantidad según el modo
// (ffa 2–8, 1v1 = 2, 2v2 = 4 con 2 y 2). (SPEC v1.1)
function readyToStart(room) {
  const cnt = room.players.length;
  if (cnt === 0) return false;
  for (const p of room.players) {
    if (!p.ready) return false;
  }
  if (room.mode === "1v1") return cnt === 2;
  if (room.mode === "2v2") {
    return cnt === 4 && teamCount(room, 0) === 2 && teamCount(room, 1) === 2;
  }
  return cnt >= MIN_PLAYERS && cnt <= MAX_PLAYERS; // ffa
}

// Timer server-side de 3 s: manda "starting" al cumplirse las condiciones y
// "startCancelled" si dejan de cumplirse antes de arrancar (des-ready, leave,
// cambio de modo, o entrada de un jugador nuevo sin ready).
function updateCountdown(room) {
  const ok = room.status === "lobby" && readyToStart(room);
  if (ok && room.countdown === null) {
    broadcast(room, { type: "starting", in: START_COUNTDOWN_S });
    room.countdown = setTimeout(() => {
      room.countdown = null;
      if (room.status === "lobby" && readyToStart(room)) {
        startMatch(room);
      }
    }, START_COUNTDOWN_S * 1000);
  } else if (!ok && room.countdown !== null) {
    clearTimeout(room.countdown);
    room.countdown = null;
    broadcast(room, { type: "startCancelled" });
  }
}

function stopLoop(room) {
  if (room.interval !== null) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function stopCountdown(room) {
  if (room.countdown !== null) {
    clearTimeout(room.countdown);
    room.countdown = null;
  }
}

function destroyRoom(room) {
  stopLoop(room);
  stopCountdown(room);
  room.match = null;
  rooms.delete(room.code);
}

function addPlayerToRoom(room, ws, name, country) {
  const player = {
    id: "p" + room.nextPlayerNum++,
    name,
    country,
    ws,
    ready: false,
    team: null,
  };
  room.players.push(player);
  assignTeamsOnChange(room);
  ws.roomRef = room;
  ws.playerRef = player;
  send(ws, { type: "joined", room: room.code, playerId: player.id, hostId: room.players[0].id });
  broadcastLobby(room);
  // El jugador nuevo entra sin ready: si había countdown, dejan de cumplirse las
  // condiciones de arranque y se cancela (startCancelled).
  updateCountdown(room);
}

function removePlayer(ws) {
  const room = ws.roomRef;
  const player = ws.playerRef;
  if (!room || !player) return;
  ws.roomRef = null;
  ws.playerRef = null;

  const idx = room.players.indexOf(player);
  if (idx !== -1) room.players.splice(idx, 1);

  if (room.players.length === 0) {
    destroyRoom(room);
    return;
  }

  if (room.status === "playing" || room.status === "gameover") {
    // Se aborta el partido: todos vuelven al lobby con aviso (SPEC), readies reseteados.
    stopLoop(room);
    room.match = null;
    room.status = "lobby";
    resetReadies(room);
    assignTeamsOnChange(room);
    broadcastLobby(room, player.name + " se desconectó");
  } else {
    // Si alguien se va durante el countdown se cancela SIEMPRE (SPEC: "Si alguien
    // des-readya o se va antes: startCancelled"), incluso si los que quedan siguen
    // cumpliendo las condiciones (p.ej. ffa de 3 ready → quedan 2 ready: con n
    // distinto cambia la geometría y el countdown debe rearmarse de cero).
    if (room.countdown !== null) {
      clearTimeout(room.countdown);
      room.countdown = null;
      broadcast(room, { type: "startCancelled" });
    }
    assignTeamsOnChange(room);
    broadcastLobby(room);
    // updateCountdown re-evalúa: si las condiciones siguen dadas arma un countdown
    // FRESCO de 3 s (nuevo "starting" para todos).
    updateCountdown(room);
  }
}

/* ============================= Geometría de la cancha ============================ */

/*
 * Cada pared se representa como:
 *   { cx, cy }  — punto central del segmento (para los lados k es M_k)
 *   { dx, dy }  — dirección unitaria a lo largo de la pared
 *   { nx, ny }  — normal unitaria EXTERIOR
 *   half        — semilongitud del segmento
 *   goal        — índice de EQUIPO dueño del arco centrado en (cx, cy), o null (v1.1)
 *
 * Distancia exterior de un punto p: d = (p − c)·n  (d < 0 ⇒ adentro).
 * Proyección sobre la pared (0 en el centro del arco): s = (p − c)·dir.
 */
function buildWalls(n) {
  if (n === 2) {
    return [
      { cx: -RECT_W, cy: 0, dx: 0, dy: 1, nx: -1, ny: 0, half: RECT_H, goal: 0 },
      { cx: RECT_W, cy: 0, dx: 0, dy: 1, nx: 1, ny: 0, half: RECT_H, goal: 1 },
      { cx: 0, cy: -RECT_H, dx: 1, dy: 0, nx: 0, ny: -1, half: RECT_W, goal: null },
      { cx: 0, cy: RECT_H, dx: 1, dy: 0, nx: 0, ny: 1, half: RECT_W, goal: null },
    ];
  }

  const walls = [];
  for (let k = 0; k < n; k++) {
    const a0 = -Math.PI / 2 + (2 * Math.PI * k) / n;
    const a1 = -Math.PI / 2 + (2 * Math.PI * ((k + 1) % n)) / n;
    const ax = R * Math.cos(a0);
    const ay = R * Math.sin(a0);
    const bx = R * Math.cos(a1);
    const by = R * Math.sin(a1);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, by - ay);
    const mlen = Math.hypot(mx, my);
    walls.push({
      cx: mx,
      cy: my,
      dx: (bx - ax) / len,
      dy: (by - ay) / len,
      nx: mx / mlen, // la normal interior es -M/|M| ⇒ la exterior es M/|M|
      ny: my / mlen,
      half: len / 2,
      goal: k,
    });
  }
  return walls;
}

/* =================================== Partido ==================================== */

function startMatch(room) {
  stopLoop(room);
  stopCountdown(room);

  // EQUIPOS (v1.1): el índice del equipo = índice de lado/arco. En ffa/1v1 cada
  // jugador es un equipo de 1 (orden de llegada); en 2v2 son 2 equipos de 2 según
  // la asignación del lobby. n = CANTIDAD DE EQUIPOS (geometría v1 con ese n).
  let teamLists;
  if (room.mode === "2v2") {
    teamLists = [
      room.players.filter((p) => p.team === 0),
      room.players.filter((p) => p.team === 1),
    ];
  } else {
    teamLists = room.players.map((p) => [p]);
  }
  // Normalizar p.team al índice de equipo definitivo del partido.
  teamLists.forEach((members, k) => {
    for (const p of members) p.team = k;
  });

  const n = teamLists.length;
  const walls = buildWalls(n);
  const order = room.players.slice();
  const spawns = new Map(); // playerId → {x, y, fx, fy}
  const bodies = new Map();
  const playerTeam = new Map(); // playerId → índice de equipo
  const scores = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    const goalWall = walls.find((w) => w.goal === k);
    const baseX = SPAWN_FACTOR * goalWall.cx;
    const baseY = SPAWN_FACTOR * goalWall.cy;
    const members = teamLists[k];

    for (let j = 0; j < members.length; j++) {
      // Spawns 2v2: compañeros en el x de spawn v1 y separados ±90 en y (SPEC).
      const dy = members.length === 2 ? (j === 0 ? -TEAM_SPAWN_DY : TEAM_SPAWN_DY) : 0;
      // Facing inicial: hacia el centro (= −normal exterior del arco propio).
      const spawn = { x: baseX, y: baseY + dy, fx: -goalWall.nx, fy: -goalWall.ny };
      const p = members[j];
      spawns.set(p.id, spawn);
      playerTeam.set(p.id, k);
      bodies.set(p.id, {
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        fx: spawn.fx,
        fy: spawn.fy,
        stun: 0,
        kc: 0,
        tc: 0,
        slide: 0,        // s restantes de barrida (0 si no) — va en state (v1.1)
        sdx: 0,          // dirección fija del slide
        sdy: 0,
        slideHit: null,  // Set de ids de rivales ya conectados por este slide
        slideBall: false, // la pelota ya recibió el impulso de este slide
        ix: 0,
        iy: 0,
        wantKick: false,
        wantTackle: false,
      });
    }
  }

  room.match = {
    n,
    order,
    teamLists,
    walls,
    spawns,
    bodies,
    scores,
    playerTeam,
    phys: stadiumPhysics(room.stadium), // multiplicadores del estadio (v1.1)
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    lastTouch: null,
    paused: false,
    pauseLeft: 0,
    winnerTeam: null,
  };
  room.status = "playing";
  room.tickCount = 0;

  broadcast(room, {
    type: "start",
    config: {
      mode: room.mode,
      stadium: room.stadium,
      n, // n === teams.length; el arco k pertenece al equipo k
      teams: teamLists.map((members) => ({ players: members.map((p) => p.id), score: 0 })),
      players: order.map((p) => ({ id: p.id, name: p.name, country: p.country, team: p.team })),
    },
  });

  room.interval = setInterval(() => tickRoom(room), 1000 * TICK);
}

function resetPositions(m) {
  for (const p of m.order) {
    const b = m.bodies.get(p.id);
    const sp = m.spawns.get(p.id);
    b.x = sp.x;
    b.y = sp.y;
    b.vx = 0;
    b.vy = 0;
    b.fx = sp.fx;
    b.fy = sp.fy;
    b.stun = 0;
    b.kc = 0;
    b.tc = 0;
    b.slide = 0;
    b.sdx = 0;
    b.sdy = 0;
    b.slideHit = null;
    b.slideBall = false;
    b.wantKick = false;
    b.wantTackle = false;
  }
  m.ball.x = 0;
  m.ball.y = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.lastTouch = null;
}

function clampBallSpeed(ball) {
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > BALL_MAX_SPEED) {
    const f = BALL_MAX_SPEED / sp;
    ball.vx *= f;
    ball.vy *= f;
  }
}

function doKick(m, playerId, b) {
  b.kc = KICK_COOLDOWN; // el intento siempre dispara el cooldown
  const dist = Math.hypot(m.ball.x - b.x, m.ball.y - b.y);
  if (dist <= KICK_RANGE) {
    m.ball.vx = b.fx * KICK_POWER + KICK_VEL_FACTOR * b.vx;
    m.ball.vy = b.fy * KICK_POWER + KICK_VEL_FACTOR * b.vy;
    clampBallSpeed(m.ball);
    m.lastTouch = playerId;
  }
}

// Barrida v1.1: el que barre entra en "slide" de SLIDE_DURATION s con velocidad fija
// SLIDE_SPEED hacia su facing (sin control de movimiento). Luego corre su cooldown
// normal (tc = SLIDE_DURATION + TACKLE_COOLDOWN: al terminar el slide queda 1.6 s).
function startSlide(b) {
  b.tc = SLIDE_DURATION + TACKLE_COOLDOWN;
  b.slide = SLIDE_DURATION;
  // Dirección fija del slide = facing (guard anti-NaN).
  const fl = Math.hypot(b.fx, b.fy);
  if (fl > 1e-9) {
    b.sdx = b.fx / fl;
    b.sdy = b.fy / fl;
  } else {
    b.sdx = 1;
    b.sdy = 0;
  }
  b.slideHit = new Set();
  b.slideBall = false;
}

// Conexión del slide (se evalúa cada tick mientras dura): cada RIVAL (otro equipo)
// en rango recibe knockback SLIDE_KNOCKBACK + stun TACKLE_STUN una sola vez por
// slide; la pelota en rango sale a 0.6 × SLIDE_KNOCKBACK (una vez por slide).
function slideConnect(m, p, b) {
  const myTeam = m.playerTeam.get(p.id);

  for (const q of m.order) {
    if (q.id === p.id) continue;
    if (m.playerTeam.get(q.id) === myTeam) continue; // los compañeros no se barren
    if (b.slideHit.has(q.id)) continue;
    const qb = m.bodies.get(q.id);
    const dx = qb.x - b.x;
    const dy = qb.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d <= TACKLE_RANGE) {
      let nx;
      let ny;
      if (d > 1e-9) {
        nx = dx / d;
        ny = dy / d;
      } else {
        nx = b.sdx;
        ny = b.sdy;
      }
      qb.vx += nx * SLIDE_KNOCKBACK;
      qb.vy += ny * SLIDE_KNOCKBACK;
      qb.stun = TACKLE_STUN;
      qb.slide = 0; // el stun corta el slide del rival barrido
      b.slideHit.add(q.id);
    }
  }

  if (!b.slideBall) {
    const bdx = m.ball.x - b.x;
    const bdy = m.ball.y - b.y;
    const bd = Math.hypot(bdx, bdy);
    if (bd <= TACKLE_RANGE) {
      let nx;
      let ny;
      if (bd > 1e-9) {
        nx = bdx / bd;
        ny = bdy / bd;
      } else {
        nx = b.sdx;
        ny = b.sdy;
      }
      m.ball.vx += nx * SLIDE_BALL_FACTOR * SLIDE_KNOCKBACK;
      m.ball.vy += ny * SLIDE_BALL_FACTOR * SLIDE_KNOCKBACK;
      clampBallSpeed(m.ball);
      m.lastTouch = p.id;
      b.slideBall = true;
    }
  }
}

function onGoal(room, concededTeam) {
  const m = room.match;
  const lt = m.lastTouch; // playerId del último toque, o null
  const ltTeam = lt !== null && m.playerTeam.has(lt) ? m.playerTeam.get(lt) : null;
  // Gol en contra: el último toque fue de un jugador del equipo que recibe
  // (incluye a un compañero en 2v2): solo resta, nadie suma (SPEC v1.1).
  const ownGoal = ltTeam !== null && ltTeam === concededTeam;
  const scorerTeam = ltTeam !== null && ltTeam !== concededTeam ? ltTeam : null;
  // scorerId = jugador que tocó último la pelota (autor físico del gol); en un gol
  // en contra identifica al que lo metió (scorerTeam queda null: nadie suma).
  const scorerId = ltTeam !== null ? lt : null;

  m.scores[concededTeam] -= 1;
  if (scorerTeam !== null) m.scores[scorerTeam] += 1;

  for (let t = 0; t < m.scores.length; t++) {
    if (m.scores[t] >= WIN_SCORE) m.winnerTeam = t;
  }

  // La pelota desaparece durante la pausa (el cliente la oculta con paused=true).
  m.ball.x = 0;
  m.ball.y = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.lastTouch = null;
  m.paused = true;
  m.pauseLeft = GOAL_PAUSE;

  broadcast(room, {
    type: "goal",
    scorerId,
    scorerTeam,
    concededTeam,
    ownGoal,
    scores: m.scores.slice(),
  });
}

function endPause(room) {
  const m = room.match;
  if (m.winnerTeam !== null) {
    room.status = "gameover";
    m.paused = true;
    broadcastState(room);
    broadcast(room, { type: "gameover", winnerTeam: m.winnerTeam, scores: m.scores.slice() });
    stopLoop(room);
  } else {
    resetPositions(m);
    m.paused = false;
    broadcast(room, { type: "kickoff" });
  }
}

function broadcastState(room) {
  const m = room.match;
  if (!m) return;
  broadcast(room, {
    type: "state",
    ball: { x: r2(m.ball.x), y: r2(m.ball.y), vx: r2(m.ball.vx), vy: r2(m.ball.vy) },
    players: m.order.map((p) => {
      const b = m.bodies.get(p.id);
      return {
        id: p.id,
        x: r2(b.x),
        y: r2(b.y),
        fx: r2(b.fx),
        fy: r2(b.fy),
        stun: r2(b.stun),
        kc: r2(b.kc),
        slide: r2(b.slide),
      };
    }),
    scores: m.scores.slice(),
    paused: m.paused,
  });
}

function tickRoom(room) {
  const m = room.match;
  if (!m || room.status !== "playing") return;
  const dt = TICK;
  const phys = m.phys; // constantes efectivas del estadio (v1.1)

  /* ---- Jugadores: cooldowns, stun, slide, acciones y movimiento (Euler semi-impl.) ---- */
  for (const p of m.order) {
    const b = m.bodies.get(p.id);
    const stunned = b.stun > 0;
    if (stunned) b.stun = Math.max(0, b.stun - dt);
    if (b.kc > 0) b.kc = Math.max(0, b.kc - dt);
    if (b.tc > 0) b.tc = Math.max(0, b.tc - dt);

    // Acciones edge-trigger: se consumen acá respetando cooldowns, stun y slide.
    if (!stunned && b.slide <= 0 && !m.paused) {
      if (b.wantKick && b.kc <= 0) doKick(m, p.id, b);
      if (b.wantTackle && b.tc <= 0) startSlide(b);
    }
    b.wantKick = false;
    b.wantTackle = false;

    // Durante la pausa post-gol la física de los jugadores queda congelada
    // (igual que la pelota); los cooldowns sí siguen corriendo arriba.
    if (!m.paused) {
      if (stunned && b.slide > 0) b.slide = 0; // el stun corta el slide propio

      if (b.slide > 0) {
        // Slide (v1.1): velocidad fija hacia la dirección de barrida, sin control.
        b.vx = b.sdx * SLIDE_SPEED;
        b.vy = b.sdy * SLIDE_SPEED;
        slideConnect(m, p, b);
        b.slide = Math.max(0, b.slide - dt);
      } else {
        const ilen = Math.hypot(b.ix, b.iy);
        if (!stunned && ilen > 1e-9) {
          b.vx += b.ix * phys.accel * dt;
          b.vy += b.iy * phys.accel * dt;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > MAX_SPEED) {
            // Por encima de MAX_SPEED (knockback/slide) la velocidad decae con la
            // fricción del estadio hasta MAX_SPEED en vez de recortarse de golpe.
            const target = Math.max(MAX_SPEED, sp * Math.exp(-phys.friction * dt));
            b.vx *= target / sp;
            b.vy *= target / sp;
          }
        } else {
          const f = Math.exp(-phys.friction * dt);
          b.vx *= f;
          b.vy *= f;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  const list = m.order.map((p) => m.bodies.get(p.id));

  if (!m.paused) {
    /* ---- Colisión círculo-círculo entre jugadores (se empujan) ---- */
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const c = list[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minD = 2 * PLAYER_R;
        if (dist < minD) {
          let nx;
          let ny;
          if (dist > 1e-9) {
            nx = dx / dist;
            ny = dy / dist;
          } else {
            nx = 1;
            ny = 0;
          }
          const push = (minD - dist) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          c.x += nx * push;
          c.y += ny * push;
          // Anular la componente de acercamiento (choque inelástico sobre la normal).
          const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel < 0) {
            a.vx += (nx * rel) / 2;
            a.vy += (ny * rel) / 2;
            c.vx -= (nx * rel) / 2;
            c.vy -= (ny * rel) / 2;
          }
        }
      }
    }

    /* ---- Confinamiento de jugadores: deslizan contra TODAS las paredes (incl. arcos) ---- */
    for (const b of list) {
      for (const w of m.walls) {
        const d = (b.x - w.cx) * w.nx + (b.y - w.cy) * w.ny;
        if (d > -PLAYER_R) {
          b.x -= w.nx * (d + PLAYER_R);
          b.y -= w.ny * (d + PLAYER_R);
          const vn = b.vx * w.nx + b.vy * w.ny;
          if (vn > 0) {
            b.vx -= w.nx * vn;
            b.vy -= w.ny * vn;
          }
        }
      }
    }
  }

  /* ---- Pelota o cuenta regresiva de la pausa post-gol ---- */
  if (m.paused) {
    m.pauseLeft -= dt;
    if (m.pauseLeft <= 0) endPause(room);
  } else {
    const ball = m.ball;

    /* -- Dribble assist (v1.1): pelota a ≤ PLAYER_R+BALL_R+8 del jugador MÁS CERCANO
       a la pelota, con velocidad > 40: fuerza suave de 400 u/s² hacia el punto a 22 u
       adelante del jugador (facing), velocidad relativa máx 260. -- */
    let nearest = null;
    let nearestD = Infinity;
    for (const b of list) {
      const d = Math.hypot(ball.x - b.x, ball.y - b.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = b;
      }
    }
    if (nearest && nearestD <= DRIBBLE_RANGE) {
      const psp = Math.hypot(nearest.vx, nearest.vy);
      if (psp > DRIBBLE_MIN_SPEED) {
        const tx = nearest.x + nearest.fx * DRIBBLE_AHEAD;
        const ty = nearest.y + nearest.fy * DRIBBLE_AHEAD;
        let ax = tx - ball.x;
        let ay = ty - ball.y;
        const al = Math.hypot(ax, ay);
        const rvx0 = ball.vx - nearest.vx;
        const rvy0 = ball.vy - nearest.vy;
        // El assist solo actúa por debajo del tope relativo: nunca frena una patada.
        if (al > 1e-9 && Math.hypot(rvx0, rvy0) < DRIBBLE_MAX_REL) {
          ax /= al;
          ay /= al;
          ball.vx += ax * DRIBBLE_FORCE * dt;
          ball.vy += ay * DRIBBLE_FORCE * dt;
          const rvx = ball.vx - nearest.vx;
          const rvy = ball.vy - nearest.vy;
          const rl = Math.hypot(rvx, rvy);
          if (rl > DRIBBLE_MAX_REL) {
            const s = DRIBBLE_MAX_REL / rl;
            ball.vx = nearest.vx + rvx * s;
            ball.vy = nearest.vy + rvy * s;
          }
        }
      }
    }

    const f = Math.exp(-phys.ballFriction * dt);
    ball.vx *= f;
    ball.vy *= f;
    clampBallSpeed(ball);

    /* -- Sub-steps ×4 (v1.1, anti-tunneling): la pelota integra movimiento y resuelve
       colisiones (jugadores, paredes, gol) en 4 sub-pasos por tick. -- */
    const sdt = dt / BALL_SUBSTEPS;
    let goalScored = false;
    for (let step = 0; step < BALL_SUBSTEPS && !goalScored; step++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // Pelota vs jugadores (v1.1): restitución 0.4 + transferencia 0.8 de la
      // velocidad del jugador. Cada contacto registra lastTouch.
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        const dx = ball.x - b.x;
        const dy = ball.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minD = PLAYER_R + BALL_R;
        if (dist < minD) {
          let nx;
          let ny;
          if (dist > 1e-9) {
            nx = dx / dist;
            ny = dy / dist;
          } else {
            const fl = Math.hypot(b.fx, b.fy);
            if (fl > 1e-9) {
              nx = b.fx / fl;
              ny = b.fy / fl;
            } else {
              nx = 1;
              ny = 0;
            }
          }
          ball.x += nx * (minD - dist);
          ball.y += ny * (minD - dist);
          const tvx = BALL_PLAYER_TRANSFER * b.vx;
          const tvy = BALL_PLAYER_TRANSFER * b.vy;
          const rvn = (ball.vx - tvx) * nx + (ball.vy - tvy) * ny;
          if (rvn < 0) {
            ball.vx -= (1 + BALL_PLAYER_E) * rvn * nx;
            ball.vy -= (1 + BALL_PLAYER_E) * rvn * ny;
          }
          m.lastTouch = m.order[k].id;
        }
      }
      clampBallSpeed(ball);

      // Paredes y detección de gol (arco k = equipo k).
      for (const w of m.walls) {
        const d = (ball.x - w.cx) * w.nx + (ball.y - w.cy) * w.ny;
        const s = (ball.x - w.cx) * w.dx + (ball.y - w.cy) * w.dy;
        if (w.goal !== null && Math.abs(s) <= GOAL_W / 2 - BALL_R) {
          // Boca del arco: la pelota pasa sin rebotar; gol cuando el centro cruza la línea.
          if (d > 0) {
            onGoal(room, w.goal);
            goalScored = true;
            break;
          }
        } else if (d > -BALL_R) {
          ball.x -= w.nx * (d + BALL_R);
          ball.y -= w.ny * (d + BALL_R);
          const vn = ball.vx * w.nx + ball.vy * w.ny;
          if (vn > 0) {
            ball.vx -= (1 + phys.wallBounce) * vn * w.nx;
            ball.vy -= (1 + phys.wallBounce) * vn * w.ny;
          }
        }
      }
    }
  }

  /* ---- Broadcast a 30 Hz (cada 2 ticks) ---- */
  room.tickCount++;
  if (room.status === "playing" && room.tickCount % TICKS_PER_SNAP === 0) {
    broadcastState(room);
  }
}

/* ============================== Protocolo WebSocket ============================== */

const wss = new WebSocket.Server({ server, maxPayload: 4096 });

function handleCreate(ws, msg) {
  if (ws.roomRef) return sendError(ws, "Ya estás en una sala");
  const name = cleanName(msg.name);
  const country = cleanCountry(msg.country);
  if (!name) return sendError(ws, "Nombre inválido");
  if (!country) return sendError(ws, "País inválido");
  // visibility: "public" | "private"; cualquier otra cosa cae en privada (default del cliente).
  const visibility = msg.visibility === "public" ? "public" : "private";
  const roomName = cleanRoomName(msg.roomName, name);

  const room = {
    code: genRoomCode(),
    roomName,
    visibility,
    mode: "ffa", // "ffa" | "1v1" | "2v2"
    stadium: "clasico", // "clasico" | "noche" | "playa" | "nieve"
    players: [],
    nextPlayerNum: 1,
    status: "lobby", // "lobby" | "playing" | "gameover"
    match: null,
    interval: null,
    countdown: null, // timeout del auto-arranque (3 s) o null
    tickCount: 0,
  };
  rooms.set(room.code, room);
  addPlayerToRoom(room, ws, name, country);
}

function handleJoin(ws, msg) {
  if (ws.roomRef) return sendError(ws, "Ya estás en una sala");
  const name = cleanName(msg.name);
  const country = cleanCountry(msg.country);
  if (!name) return sendError(ws, "Nombre inválido");
  if (!country) return sendError(ws, "País inválido");

  const code = typeof msg.room === "string" ? msg.room.trim().toUpperCase() : "";
  if (!/^[A-Z]{4}$/.test(code)) return sendError(ws, "Código inválido");
  const room = rooms.get(code);
  if (!room) return sendError(ws, "Sala no encontrada");
  if (room.status !== "lobby") return sendError(ws, "Partido en curso");
  if (room.players.length >= modeCapacity(room.mode)) return sendError(ws, "Sala llena");

  addPlayerToRoom(room, ws, name, country);
}

// {type:"listRooms"} → {type:"rooms", rooms:[...]}: SOLO salas públicas, no llenas
// y sin partido en curso (SPEC v1.1).
function handleListRooms(ws) {
  const list = [];
  for (const room of rooms.values()) {
    if (room.visibility !== "public") continue;
    if (room.status !== "lobby") continue;
    if (room.players.length >= modeCapacity(room.mode)) continue;
    if (room.players.length === 0) continue;
    list.push({
      code: room.code,
      roomName: room.roomName,
      hostName: room.players[0].name,
      count: room.players.length,
      max: modeCapacity(room.mode),
      mode: room.mode,
      stadium: room.stadium,
    });
  }
  send(ws, { type: "rooms", rooms: list });
}

// {type:"ready", ready:bool} — cada jugador alterna su estado en el lobby.
function handleReady(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (typeof msg.ready !== "boolean") return;
  ws.playerRef.ready = msg.ready;
  broadcastLobby(room);
  updateCountdown(room);
}

// {type:"setMode", mode} — solo host. Cambiar de modo resetea todos los ready y
// reasigna equipos (SPEC v1.1).
function handleSetMode(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (room.players[0] !== ws.playerRef) return sendError(ws, "Solo el host puede cambiar el modo");
  if (!MODES.includes(msg.mode)) return sendError(ws, "Modo inválido");
  if (room.players.length > modeCapacity(msg.mode)) {
    return sendError(ws, "Demasiados jugadores para ese modo");
  }
  if (msg.mode === room.mode) return;
  room.mode = msg.mode;
  resetReadies(room);
  assignTeams(room);
  broadcastLobby(room);
  updateCountdown(room); // cancela el countdown si lo había (readies reseteados)
}

// {type:"setStadium", stadium} — solo host.
function handleSetStadium(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (room.players[0] !== ws.playerRef) {
    return sendError(ws, "Solo el host puede cambiar el estadio");
  }
  if (!STADIUMS.includes(msg.stadium)) return sendError(ws, "Estadio inválido");
  if (msg.stadium === room.stadium) return;
  room.stadium = msg.stadium;
  broadcastLobby(room);
}

// {type:"setTeam", team} — cualquiera, solo en 2v2, con validación de cupo (máx 2).
function handleSetTeam(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (room.mode !== "2v2") return sendError(ws, "Solo se puede cambiar de equipo en 2v2");
  const team = msg.team;
  if (team !== 0 && team !== 1) return sendError(ws, "Equipo inválido");
  if (ws.playerRef.team === team) return;
  if (teamCount(room, team) >= 2) return sendError(ws, "Ese equipo está completo");
  ws.playerRef.team = team;
  broadcastLobby(room);
  updateCountdown(room); // un 2v2 con todos ready puede habilitarse al balancear 2 y 2
}

// rematch (host, tras gameover): vuelve AL LOBBY con readies reseteados (v1.1);
// el partido arranca de nuevo solo por readies (auto-arranque).
function handleRematch(ws) {
  const room = ws.roomRef;
  if (!room || room.status !== "gameover") return;
  if (room.players[0] !== ws.playerRef) return sendError(ws, "Solo el host puede pedir revancha");
  stopLoop(room);
  room.match = null;
  room.status = "lobby";
  resetReadies(room);
  broadcastLobby(room);
}

function handleInput(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "playing" || !room.match || !ws.playerRef) return;
  const b = room.match.bodies.get(ws.playerRef.id);
  if (!b) return;

  // Clampear cada componente a [-1, 1] y normalizar si |v| > 1 (server-side, SPEC).
  let mx = clamp(num(msg.mx), -1, 1);
  let my = clamp(num(msg.my), -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  b.ix = mx;
  b.iy = my;

  // facing = último input de movimiento no nulo (unitario). Durante el slide no hay
  // control: la dirección de barrida quedó fija y el facing no cambia (v1.1).
  const l2 = Math.hypot(mx, my);
  if (l2 > 1e-9 && b.slide <= 0) {
    b.fx = mx / l2;
    b.fy = my / l2;
  }

  // kick/tackle edge-trigger: quedan pendientes hasta el próximo tick, que los consume.
  if (msg.kick === true) b.wantKick = true;
  if (msg.tackle === true) b.wantTackle = true;
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case "create":
      handleCreate(ws, msg);
      break;
    case "join":
      handleJoin(ws, msg);
      break;
    case "listRooms":
      handleListRooms(ws);
      break;
    case "ready":
      handleReady(ws, msg);
      break;
    case "setMode":
      handleSetMode(ws, msg);
      break;
    case "setStadium":
      handleSetStadium(ws, msg);
      break;
    case "setTeam":
      handleSetTeam(ws, msg);
      break;
    case "input":
      handleInput(ws, msg);
      break;
    case "rematch":
      handleRematch(ws);
      break;
    case "leave":
      removePlayer(ws);
      break;
    default:
      break; // tipo desconocido (incl. el viejo "startGame", eliminado en v1.1): ignorar
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.roomRef = null;
  ws.playerRef = null;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("error", () => {
    /* evitar crash por errores de socket; close se encarga de la limpieza */
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error("Error procesando mensaje:", err);
    }
  });

  ws.on("close", () => {
    removePlayer(ws);
  });
});

/* ============== Heartbeat: ping cada 15 s, terminar conexiones muertas ============== */

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_MS);

wss.on("close", () => {
  clearInterval(heartbeat);
});

/* ==================================== Arranque =================================== */

// Defensivo: un throw sincrónico inesperado no debe tumbar todas las salas en curso.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("PoliGol escuchando en http://0.0.0.0:" + PORT);
});
