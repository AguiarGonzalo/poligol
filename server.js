/*
 * PoliGol — servidor autoritativo.
 * Node.js (CommonJS): http estático (http + fs + path) + WebSocket ("ws") sobre el
 * mismo server. Salas con código de 4 letras, lobby, partido con física a 60 Hz y
 * broadcast de estado a 30 Hz, goles, puntajes, rematch, desconexiones y heartbeat.
 * Implementa el contrato definido en SPEC.md al pie de la letra.
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
const TACKLE_KNOCKBACK = 380; // impulso al rival barrido
const TACKLE_STUN = 0.9;    // s que el rival queda tirado
const TACKLE_COOLDOWN = 1.6;  // s
const GOAL_PAUSE = 2.0;     // s de pausa tras un gol antes de resetear

/* ===================== Constantes propias de esta implementación ================= */

const LUNGE_IMPULSE = 150;       // mini-lunge del que barre, hacia facing (SPEC)
const KICK_VEL_FACTOR = 0.35;    // 35% de la velocidad del jugador sumada a la patada (SPEC)
const TACKLE_BALL_FACTOR = 0.5;  // impulso a la pelota = 0.5 × TACKLE_KNOCKBACK (SPEC)
const SPAWN_FACTOR = 0.62;       // spawn del jugador k en 0.62 × M_k (SPEC)
const RECT_W = 480;              // half-extent horizontal para n = 2 (SPEC)
const RECT_H = 290;              // half-extent vertical para n = 2 (SPEC)
const BALL_PLAYER_E = 0.2;       // restitución pelota-jugador (elección libre: empuje suave)
const HEARTBEAT_MS = 15000;      // ping cada 15 s (SPEC)
const TICKS_PER_SNAP = Math.round(1 / TICK / SNAP_HZ); // 60/30 = 2 ticks por broadcast
const MAX_NAME_LEN = 16;         // sanitización de nombres (elección libre)
const PORT = process.env.PORT || 3000;

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
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      isHost: i === 0,
    })),
  };
  if (notice) msg.notice = notice;
  broadcast(room, msg);
}

function stopLoop(room) {
  if (room.interval !== null) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function destroyRoom(room) {
  stopLoop(room);
  room.match = null;
  rooms.delete(room.code);
}

function addPlayerToRoom(room, ws, name, country) {
  const player = { id: "p" + room.nextPlayerNum++, name, country, ws };
  room.players.push(player);
  ws.roomRef = room;
  ws.playerRef = player;
  send(ws, { type: "joined", room: room.code, playerId: player.id, hostId: room.players[0].id });
  broadcastLobby(room);
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
    // Se aborta el partido: todos vuelven al lobby con aviso (SPEC).
    stopLoop(room);
    room.match = null;
    room.status = "lobby";
    broadcastLobby(room, player.name + " se desconectó");
  } else {
    broadcastLobby(room);
  }
}

/* ============================= Geometría de la cancha ============================ */

/*
 * Cada pared se representa como:
 *   { cx, cy }  — punto central del segmento (para los lados k es M_k)
 *   { dx, dy }  — dirección unitaria a lo largo de la pared
 *   { nx, ny }  — normal unitaria EXTERIOR
 *   half        — semilongitud del segmento
 *   goal        — índice de jugador dueño del arco centrado en (cx, cy), o null
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

  const n = room.players.length;
  const walls = buildWalls(n);
  const order = room.players.slice(); // índice en este array = índice de lado/arco
  const spawns = [];
  const bodies = new Map();
  const scores = {};

  for (let k = 0; k < n; k++) {
    const goalWall = walls.find((w) => w.goal === k);
    const sx = SPAWN_FACTOR * goalWall.cx;
    const sy = SPAWN_FACTOR * goalWall.cy;
    // Facing inicial: hacia el centro de la cancha (= −normal exterior del arco propio).
    const spawn = { x: sx, y: sy, fx: -goalWall.nx, fy: -goalWall.ny };
    spawns.push(spawn);

    const p = order[k];
    scores[p.id] = 0;
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
      ix: 0,
      iy: 0,
      wantKick: false,
      wantTackle: false,
    });
  }

  room.match = {
    n,
    order,
    walls,
    spawns,
    bodies,
    scores,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    lastTouch: null,
    paused: false,
    pauseLeft: 0,
    winnerId: null,
  };
  room.status = "playing";
  room.tickCount = 0;

  broadcast(room, {
    type: "start",
    config: {
      n,
      players: order.map((p) => ({ id: p.id, name: p.name, country: p.country, score: 0 })),
    },
  });

  room.interval = setInterval(() => tickRoom(room), 1000 * TICK);
}

function resetPositions(m) {
  for (let k = 0; k < m.order.length; k++) {
    const b = m.bodies.get(m.order[k].id);
    const sp = m.spawns[k];
    b.x = sp.x;
    b.y = sp.y;
    b.vx = 0;
    b.vy = 0;
    b.fx = sp.fx;
    b.fy = sp.fy;
    b.stun = 0;
    b.kc = 0;
    b.tc = 0;
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

function doTackle(m, playerId, b) {
  b.tc = TACKLE_COOLDOWN; // el intento siempre dispara el cooldown

  // Mini-lunge del que barre, hacia su facing.
  b.vx += b.fx * LUNGE_IMPULSE;
  b.vy += b.fy * LUNGE_IMPULSE;

  // Rival más cercano dentro de TACKLE_RANGE.
  let target = null;
  let targetDist = Infinity;
  for (const p of m.order) {
    if (p.id === playerId) continue;
    const ob = m.bodies.get(p.id);
    const d = Math.hypot(ob.x - b.x, ob.y - b.y);
    if (d <= TACKLE_RANGE && d < targetDist) {
      target = ob;
      targetDist = d;
    }
  }
  if (target) {
    let nx;
    let ny;
    if (targetDist > 1e-9) {
      nx = (target.x - b.x) / targetDist;
      ny = (target.y - b.y) / targetDist;
    } else {
      nx = b.fx;
      ny = b.fy;
    }
    target.vx += nx * TACKLE_KNOCKBACK;
    target.vy += ny * TACKLE_KNOCKBACK;
    target.stun = TACKLE_STUN;
  }

  // Si la pelota también está en rango, recibe 0.5 × TACKLE_KNOCKBACK.
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
      nx = b.fx;
      ny = b.fy;
    }
    m.ball.vx += nx * TACKLE_BALL_FACTOR * TACKLE_KNOCKBACK;
    m.ball.vy += ny * TACKLE_BALL_FACTOR * TACKLE_KNOCKBACK;
    clampBallSpeed(m.ball);
    m.lastTouch = playerId;
  }
}

function onGoal(room, victimIndex) {
  const m = room.match;
  const victimId = m.order[victimIndex].id;
  const lt = m.lastTouch;
  const scorerId = lt !== null && lt !== victimId ? lt : null;
  const ownGoal = lt === victimId;

  m.scores[victimId] -= 1;
  if (scorerId !== null) m.scores[scorerId] += 1;

  for (const id of Object.keys(m.scores)) {
    if (m.scores[id] >= WIN_SCORE) m.winnerId = id;
  }

  // La pelota desaparece durante la pausa (el cliente la oculta con paused=true).
  m.ball.x = 0;
  m.ball.y = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.lastTouch = null;
  m.paused = true;
  m.pauseLeft = GOAL_PAUSE;

  broadcast(room, { type: "goal", scorerId, victimId, ownGoal, scores: { ...m.scores } });
}

function endPause(room) {
  const m = room.match;
  if (m.winnerId !== null) {
    room.status = "gameover";
    m.paused = true;
    broadcastState(room);
    broadcast(room, { type: "gameover", winnerId: m.winnerId, scores: { ...m.scores } });
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
      };
    }),
    scores: { ...m.scores },
    paused: m.paused,
  });
}

function tickRoom(room) {
  const m = room.match;
  if (!m || room.status !== "playing") return;
  const dt = TICK;

  /* ---- Jugadores: cooldowns, stun, acciones y movimiento (Euler semi-implícito) ---- */
  for (const p of m.order) {
    const b = m.bodies.get(p.id);
    const stunned = b.stun > 0;
    if (stunned) b.stun = Math.max(0, b.stun - dt);
    if (b.kc > 0) b.kc = Math.max(0, b.kc - dt);
    if (b.tc > 0) b.tc = Math.max(0, b.tc - dt);

    // Acciones edge-trigger: se consumen acá respetando cooldowns y stun.
    if (!stunned && !m.paused) {
      if (b.wantKick && b.kc <= 0) doKick(m, p.id, b);
      if (b.wantTackle && b.tc <= 0) doTackle(m, p.id, b);
    }
    b.wantKick = false;
    b.wantTackle = false;

    // Durante la pausa post-gol la física de los jugadores queda congelada
    // (igual que la pelota); los cooldowns sí siguen corriendo arriba.
    if (!m.paused) {
      const ilen = Math.hypot(b.ix, b.iy);
      if (!stunned && ilen > 1e-9) {
        b.vx += b.ix * ACCEL * dt;
        b.vy += b.iy * ACCEL * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) {
          // Por encima de MAX_SPEED (knockback/lunge) la velocidad decae con FRICTION
          // hasta MAX_SPEED en vez de recortarse de golpe.
          const target = Math.max(MAX_SPEED, sp * Math.exp(-FRICTION * dt));
          b.vx *= target / sp;
          b.vy *= target / sp;
        }
      } else {
        const f = Math.exp(-FRICTION * dt);
        b.vx *= f;
        b.vy *= f;
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
    const f = Math.exp(-BALL_FRICTION * dt);
    ball.vx *= f;
    ball.vy *= f;
    clampBallSpeed(ball);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Pelota vs jugadores: la pelota recibe el empuje; cada contacto registra lastTouch.
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
          nx = b.fx;
          ny = b.fy;
        }
        ball.x += nx * (minD - dist);
        ball.y += ny * (minD - dist);
        const rvn = (ball.vx - b.vx) * nx + (ball.vy - b.vy) * ny;
        if (rvn < 0) {
          ball.vx -= (1 + BALL_PLAYER_E) * rvn * nx;
          ball.vy -= (1 + BALL_PLAYER_E) * rvn * ny;
        }
        m.lastTouch = m.order[k].id;
      }
    }
    clampBallSpeed(ball);

    // Paredes y detección de gol.
    for (const w of m.walls) {
      const d = (ball.x - w.cx) * w.nx + (ball.y - w.cy) * w.ny;
      const s = (ball.x - w.cx) * w.dx + (ball.y - w.cy) * w.dy;
      if (w.goal !== null && Math.abs(s) <= GOAL_W / 2 - BALL_R) {
        // Boca del arco: la pelota pasa sin rebotar; gol cuando el centro cruza la línea.
        if (d > 0) {
          onGoal(room, w.goal);
          break;
        }
      } else if (d > -BALL_R) {
        ball.x -= w.nx * (d + BALL_R);
        ball.y -= w.ny * (d + BALL_R);
        const vn = ball.vx * w.nx + ball.vy * w.ny;
        if (vn > 0) {
          ball.vx -= (1 + WALL_BOUNCE) * vn * w.nx;
          ball.vy -= (1 + WALL_BOUNCE) * vn * w.ny;
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

  const room = {
    code: genRoomCode(),
    players: [],
    nextPlayerNum: 1,
    status: "lobby", // "lobby" | "playing" | "gameover"
    match: null,
    interval: null,
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
  if (room.players.length >= MAX_PLAYERS) return sendError(ws, "Sala llena");

  addPlayerToRoom(room, ws, name, country);
}

function handleStartGame(ws) {
  const room = ws.roomRef;
  if (!room) return;
  if (room.status !== "lobby") return sendError(ws, "Partido en curso");
  if (room.players[0] !== ws.playerRef) return sendError(ws, "Solo el host puede empezar el partido");
  if (room.players.length < MIN_PLAYERS) return sendError(ws, "Se necesitan al menos 2 jugadores");
  startMatch(room);
}

function handleRematch(ws) {
  const room = ws.roomRef;
  if (!room || room.status !== "gameover") return;
  if (room.players[0] !== ws.playerRef) return sendError(ws, "Solo el host puede pedir revancha");
  startMatch(room);
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

  // facing = último input de movimiento no nulo (unitario).
  const l2 = Math.hypot(mx, my);
  if (l2 > 1e-9) {
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
    case "startGame":
      handleStartGame(ws);
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
      break; // tipo desconocido: ignorar
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
