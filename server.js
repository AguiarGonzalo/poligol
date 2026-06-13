/*
 * PoliGol — servidor autoritativo (v1.4 — FÍSICA ESTILO HAXBALL).
 * Node.js (CommonJS): http estático (http + fs + path) + WebSocket ("ws") sobre el
 * mismo server. Salas públicas/privadas con código de 4 letras, lobby con modos
 * (ffa/1v1/2v2/duo), estadios, readies con auto-arranque, partido por EQUIPOS y
 * broadcast a 30 Hz, goles, puntajes por equipo, rematch, desconexiones y heartbeat.
 * v1.2 (secciones A/B/C del SPEC): netcode con `seq` por input + `iq` por cuerpo en
 * state (reconciliación), ping/pong de aplicación y suscripción `subRooms` con push
 * coalesced de la lista de salas públicas.
 * v1.2 (sección E — escalabilidad): snapshots compactos (campos en 0 ausentes),
 * backpressure por conexión (64 KB saltea snapshot / 512 KB cierra), UN interval
 * global a 60 Hz para todas las salas en juego (un solo stringify por sala por
 * broadcast), GET /health y /metrics (ventana móvil de 10 s), y límites anti-abuso
 * (MAX_CONN, máx 1000 salas, rate limit de mensajes por conexión).
 * v1.3 (secciones A/B/D/E del SPEC): separación USUARIOS (conexiones, lobby, equipos)
 * vs CUERPOS (jugadores físicos, creados en start con owner/slot SIEMPRE presentes);
 * modo "duo" (2–4 usuarios, cada usuario es un equipo con DOS cuerpos: los campos
 * planos del input controlan el slot 0 y el objeto `b` opcional el slot 1, con un
 * solo seq por mensaje e iq duplicado en ambos cuerpos propios); objetivo de partido
 * configurable con setMatch (target "goals"|"time" + whitelist de values), reloj `tl`
 * en state (solo target=time, corre solo con pelota en juego), GOL DE ORO al empatar
 * y campo reason ("goals"|"time"|"golden") en gameover; /metrics gana `bodies`.
 * v1.4 (FÍSICA ESTILO HAXBALL — PISA toda la física previa): el motor de física es
 * AHORA el núcleo compartido public/physics-core.js (úsado por server y cliente sin
 * redefinir nada). El loop global de 60 Hz llama `stepWorld(state, inputs, arena,
 * arena.phys, rules)` por sala en juego y luego `goalCheck`. dt=1, u/tick, damping
 * geométrico, colisiones por momento (restitución a.bCoef*b.bCoef+1), kick por
 * contacto MANTENIDO (estado, no edge), postes de arco, estadios re-expresados.
 * INPUT v1.4: kick y b.kick son ESTADO MANTENIDO (true mientras apretado, mandado
 * también al soltar); tackle/b.tackle siguen edge-trigger. setRules{tackles} (host,
 * lobby; default true) en lobby y rooms; barrida solo si rules.tackles. state v1.4:
 * velocidades u/tick a 2 decimales, ka (kickArmed) y kc (cooldown en TICKS) por
 * cuerpo propio, ball.lt (lastTouch) opcional; evento {type:"kicked", id} al patear.
 * Implementa SPEC.md (v1 + v1.1 + v1.2 + v1.3 + v1.4) al pie de la letra.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

// v1.4: NÚCLEO COMPARTIDO de física (HaxBall). Misma fuente de verdad que el cliente
// (public/physics-core.js, cargado allá con <script>). Ruta relativa desde server.js.
const Phys = require("./public/physics-core.js");

/* ========================= Constantes compartidas (SPEC) ========================= */

const WIN_SCORE = 3;        // puntaje objetivo (default del objetivo "goals")
const TICK = 1 / 60;        // física del server a 60 Hz (dt=1 dentro del núcleo)
const SNAP_HZ = 30;         // broadcast de estado a 30 Hz
const MAX_PLAYERS = 8;      // cuerpos máximos en un partido
const MIN_PLAYERS = 2;
const GOAL_PAUSE = 2.0;     // s de pausa tras un gol antes de resetear

// v1.4: TODAS las constantes de física y geometría (radios, masas, damping, kick,
// barrida, circunradio, ancho de arco, spawns) viven en el núcleo (Phys.*) y el server
// NO redefine ninguna. La geometría se obtiene de Phys.buildArena() por partido; la
// simulación, de Phys.stepWorld()/Phys.goalCheck(). El server solo conserva constantes
// de protocolo/sala/escalabilidad (abajo).

/* ============================ Constantes v1.2 (SPEC) ============================= */

// v1.4: el KICK BUFFER de v1.2 (recordar la intención de patear fuera de rango) ya no
// aplica — el kick es por contacto MANTENIDO (mantenés apretado y dispara al tocar la
// pelota), así que el "apreté y no pateó" desaparece sin buffer.
const ROOMS_PUSH_MS = 250;        // coalescing del push de salas a suscriptos (sección C)

// Escalabilidad (sección E)
const BP_SKIP_BYTES = 64 * 1024;   // E.2: bufferedAmount > 64 KB ⇒ saltear el snapshot de esa conexión
const BP_CLOSE_BYTES = 512 * 1024; // E.2: bufferedAmount > 512 KB ⇒ cerrar la conexión (cliente zombi)
const MAX_ROOMS = 1000;            // E.5: máximo de salas simultáneas
// E.5: máximo de conexiones WS (configurable por env MAX_CONN, default 4000).
const MAX_CONN = (() => {
  const v = parseInt(process.env.MAX_CONN, 10);
  return Number.isFinite(v) && v > 0 ? v : 4000;
})();
// E.5: rate limit de mensajes por conexión. El contrato dice 60/s de tráfico
// legítimo (input inmediato con cap 60/s), pero a eso se le suman pings de RTT,
// keepalives y ráfagas de borde de ventana: el techo de CORTE real es 90/s para
// no desconectar jamás a un jugador válido. El exceso cierra la conexión.
const RATE_LIMIT_MAX = 90;         // mensajes por ventana
const RATE_LIMIT_WINDOW_MS = 1000; // ventana del rate limit
const METRICS_WINDOW_MS = 10000;   // E.4: ventana móvil de las métricas de tick (10 s)

/* ============================ Constantes v1.3 (SPEC) ============================= */

// USUARIOS vs CUERPOS (sección A): en modo "duo" cada usuario controla 2 cuerpos.
const DUO_BODIES = 2;            // cuerpos por usuario en duo (slots 0 y 1)
const DUO_CAPACITY = 4;          // duo: 4 usuarios máx (8 cuerpos = MAX_PLAYERS)
// Spawns (duo ±55, 2v2 ±90, factor 0.62) los resuelve arena.spawns() del núcleo.
// Objetivo de partido configurable (sección D, setMatch solo host): whitelist EXACTA.
const MATCH_GOALS_VALUES = [1, 3, 5, 10];       // target "goals" (default 3 = WIN_SCORE)
const MATCH_TIME_VALUES = [120, 180, 300, 600]; // target "time", en segundos

// Lobby / salas v1.1 (+ "duo" v1.3)
const MODES = ["ffa", "1v1", "2v2", "duo"];
const STADIUMS = ["clasico", "noche", "playa", "nieve"];
const MAX_ROOM_NAME_LEN = 24;     // roomName sanitizado a ≤ 24 chars (SPEC)
const START_COUNTDOWN_S = 3;      // auto-arranque: "starting" y partido 3 s después

/* ===================== Constantes propias de esta implementación ================= */

const HEARTBEAT_MS = 15000;      // ping cada 15 s (SPEC)
const TICKS_PER_SNAP = Math.round(1 / TICK / SNAP_HZ); // 60/30 = 2 ticks por broadcast
const MAX_NAME_LEN = 16;         // sanitización de nombres (elección libre)
const PORT = process.env.PORT || 3000;

// v1.4: la física de estadio (multiplicadores sobre damping/accel del modelo HaxBall)
// la aplica el núcleo en buildArena(n, stadium) → arena.phys. El server NO redefine
// física: usa arena.phys tal cual en cada stepWorld.

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
  ".webmanifest": "application/manifest+json; charset=utf-8",
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
  // v1.2 E.4: endpoints de observabilidad. /health para el health check de Render;
  // /metrics con ventana móvil de 10 s de duraciones del tick global.
  if (urlPath === "/health" || urlPath === "/metrics") {
    const body = JSON.stringify(
      urlPath === "/health" ? { ok: true, uptime: Math.round(process.uptime()) } : buildMetrics()
    );
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
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

// v1.4 I: posiciones y velocidades del state a 2 decimales (las velocidades chicas en
// u/tick necesitan esta precisión para la extrapolación de mundo completo del cliente).
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
    target: room.target, // objetivo de partido (v1.3 D): "goals" | "time"
    value: room.value,   // goles objetivo o segundos, según target
    tackles: room.tackles, // v1.4 E: barrida on/off (host, default true)
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

// Cupo de la sala según el modo (en USUARIOS): ffa 2–8, 1v1 exactamente 2,
// 2v2 exactamente 4, duo 2–4 (v1.3: 4 usuarios = 8 cuerpos = MAX_PLAYERS).
function modeCapacity(mode) {
  if (mode === "1v1") return 2;
  if (mode === "2v2") return 4;
  if (mode === "duo") return DUO_CAPACITY;
  return MAX_PLAYERS;
}

function teamCount(room, team) {
  let c = 0;
  for (const p of room.players) {
    if (p.team === team) c++;
  }
  return c;
}

// Reasignación completa (al cambiar de modo): ffa/1v1/duo cada USUARIO es un equipo
// (equipo = índice de llegada; en duo cada usuario ES su equipo y setTeam se rechaza);
// 2v2 asignación automática ALTERNADA por orden de llegada.
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
  if (room.mode === "duo") return cnt >= MIN_PLAYERS && cnt <= DUO_CAPACITY; // 2–4 usuarios (v1.3 E)
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

function stopCountdown(room) {
  if (room.countdown !== null) {
    clearTimeout(room.countdown);
    room.countdown = null;
  }
}

function destroyRoom(room) {
  stopCountdown(room);
  room.match = null;
  rooms.delete(room.code);
  notifyRoomsChanged(); // sala borrada: sale de la lista de públicas (v1.2 C)
}

function addPlayerToRoom(room, ws, name, country) {
  const player = {
    id: "p" + room.nextPlayerNum++,
    name,
    country,
    ws,
    ready: false,
    team: null,
    lastSeq: 0, // v1.2: último seq de input aplicado (se expone como iq en state)
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
  notifyRoomsChanged(); // sala creada o join: cambia count/fullness en la lista (v1.2 C)
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
    // Se aborta el partido: todos vuelven al lobby con aviso (SPEC), readies
    // reseteados. status → "lobby" la saca del loop global de ticks (v1.2 E.3).
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
  // Leave/desconexión: cambia count, fullness o status (partido abortado → lobby
  // vuelve a ser joineable). El caso "sala vacía" lo notifica destroyRoom.
  notifyRoomsChanged();
}

/* ============================= Geometría de la cancha ============================ */

// v1.4: la geometría (paredes como segmentos, POSTES de arco, bocas, spawns y la
// física de estadio) la construye el núcleo con Phys.buildArena(n, stadium). El server
// NO redefine geometría ni física: usa arena.* y arena.phys tal cual en stepWorld y
// goalCheck. (La vieja buildWalls — paredes-lado completas sin postes — se eliminó.)

/* =================================== Partido ==================================== */

function startMatch(room) {
  stopCountdown(room);

  // EQUIPOS (v1.1/v1.3): el índice del equipo = índice de lado/arco. En ffa/1v1
  // cada usuario es un equipo de 1 (orden de llegada); en 2v2 son 2 equipos de 2
  // según la asignación del lobby; en duo cada USUARIO es un equipo con DOS cuerpos
  // (v1.3 A). n = CANTIDAD DE EQUIPOS (geometría v1 con ese n).
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
  // v1.4: arena del NÚCLEO (paredes-segmento, POSTES, bocas, spawns y phys del estadio).
  const arena = Phys.buildArena(n, room.stadium);
  // CUERPOS (v1.3 A/E): se crean ACÁ, al armar el partido (no en el lobby). 1 por
  // usuario en ffa/1v1/2v2 (id del cuerpo = id de usuario: compat de ids con v1.3) o
  // 2 por usuario en duo (ids únicos propios "p3a"/"p3b", slots 0 y 1). owner y slot
  // van SIEMPRE en start (uniforme). state.players = este array de cuerpos.
  const perUser = room.mode === "duo" ? DUO_BODIES : 1;
  const bodies = [];              // todos los cuerpos (orden: equipo, usuario, slot)
  const bodyById = new Map();     // bodyId → cuerpo (lastTouch / goles)
  const bodiesByUser = new Map(); // userId → [cuerpo slot 0, (cuerpo slot 1)]
  const scores = new Array(n).fill(0);
  // v1.4: el slot del núcleo codifica el offset de spawn. En no-duo 2v2 los dos
  // compañeros usan slot=0/1 para separarse ±90; en duo cada cuerpo usa su slot real.
  const spawnMode = room.mode; // "ffa" | "1v1" | "2v2" | "duo"

  for (let k = 0; k < n; k++) {
    const members = teamLists[k];

    for (let j = 0; j < members.length; j++) {
      const p = members[j];
      const userBodies = [];
      bodiesByUser.set(p.id, userBodies);

      for (let slot = 0; slot < perUser; slot++) {
        // El núcleo resuelve spawn + facing inicial según el modo. En 2v2 el offset
        // ±90 lo selecciona el índice de compañero (j); en duo lo selecciona el slot.
        const spawnSlot = spawnMode === "2v2" ? j : slot;
        const sp = arena.spawns(k, spawnSlot, spawnMode);
        // Cuerpo del NÚCLEO (todos los campos de estado v1.4: kickCd/kickArmed/kickHeld,
        // stun/slide/sdx/sdy/tackleCd/slideHit/slideBall). makeBody NO redefine física.
        const body = Phys.makeBody({
          id: perUser === DUO_BODIES ? p.id + (slot === 0 ? "a" : "b") : p.id,
          team: k,
          slot,          // 0 (cuerpo A) | 1 (cuerpo B)
          owner: p.id,   // id del USUARIO dueño (el playerId de `joined`)
          x: sp.x,
          y: sp.y,
          fx: sp.fx,
          fy: sp.fy,
        });
        // Metadatos del server (no los toca el núcleo): usuario, nombre, país, spawn.
        body.ownerRef = p;   // iq del state = ownerRef.lastSeq
        body.name = p.name;
        body.country = p.country;
        body.spawn = { x: sp.x, y: sp.y, fx: sp.fx, fy: sp.fy };
        // Input MANTENIDO por cuerpo (v1.4 I): movimiento + kick (held) + tackle (edge).
        // Lo setea handleInput; lo lee tickRoom para armar inputsById de stepWorld.
        body.inMx = 0;
        body.inMy = 0;
        body.inKick = false;
        body.inTackle = false;
        bodies.push(body);
        bodyById.set(body.id, body);
        userBodies.push(body);
      }
    }
  }

  const ball = Phys.makeBall();

  room.match = {
    n,
    arena,                 // v1.4: geometría + phys del estadio (del núcleo)
    bodies,
    bodyById,
    bodiesByUser,
    scores,
    rules: { tackles: room.tackles !== false }, // v1.4 E: barrida on/off (snapshot del lobby)
    ball,
    paused: false,
    pauseLeft: 0,
    winnerTeam: null,
    // Objetivo del partido (v1.3 D): snapshot del lobby, fijo durante el partido.
    target: room.target,
    value: room.value,
    timeLeft: room.target === "time" ? room.value : 0, // s restantes (float interno)
    golden: false,   // true = GOL DE ORO (empate en la cima al agotarse el tiempo)
    endReason: null, // "goals" | "time" | "golden" → campo reason del gameover
  };
  room.status = "playing";
  room.tickCount = 0;

  broadcast(room, {
    type: "start",
    config: {
      mode: room.mode,
      stadium: room.stadium,
      n, // n === teams.length; el arco k pertenece al equipo k
      target: room.target, // objetivo del partido (v1.3 D): "goals" | "time"
      value: room.value,   // goles objetivo o segundos según target
      tackles: room.tackles !== false, // v1.4 E: barrida on/off (snapshot del lobby)
      // teams.players y players listan CUERPOS (v1.3 A): en no-duo coinciden 1:1
      // con los usuarios (id = playerId, slot 0, owner = el propio usuario).
      teams: teamLists.map((members) => ({
        players: members.flatMap((p) => bodiesByUser.get(p.id).map((b) => b.id)),
        score: 0,
      })),
      players: bodies.map((b) => ({
        id: b.id,
        name: b.name,
        country: b.country,
        team: b.team,
        owner: b.owner,
        slot: b.slot,
      })),
    },
  });

  // v1.2 E.3: no hay interval por sala — el loop GLOBAL de 60 Hz tickea todas las
  // salas con status === "playing" (esta ya quedó en "playing" arriba).
  notifyRoomsChanged(); // status → "playing": la sala sale de la lista de públicas (v1.2 C)
}

function resetPositions(m) {
  for (const b of m.bodies) {
    const sp = b.spawn;
    b.x = sp.x;
    b.y = sp.y;
    b.vx = 0;
    b.vy = 0;
    b.fx = sp.fx;
    b.fy = sp.fy;
    // v1.4: estado del modelo HaxBall (núcleo). kickArmed parte en true (re-armado).
    b.kickCd = 0;
    b.kickArmed = true;
    b.kickHeld = false;
    b.stun = 0;
    b.slide = 0;
    b.sdx = 0;
    b.sdy = 0;
    b.tackleCd = 0;
    b.slideHit = null;
    b.slideBall = false;
    // Input mantenido por cuerpo (lo aplica handleInput; lo limpia el reset).
    b.inMx = 0;
    b.inMy = 0;
    b.inKick = false;
    b.inTackle = false;
  }
  m.ball.x = 0;
  m.ball.y = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.ball.lastTouch = null;
}

// v1.4: el kick (por contacto MANTENIDO), la barrida (opcional por sala) y todas las
// colisiones las resuelve el núcleo dentro de stepWorld. El server NO redefine física:
// tryKick/startSlide/slideConnect/clampBallSpeed se eliminaron.

function onGoal(room, concededTeam) {
  const m = room.match;
  const lt = m.ball.lastTouch; // id del CUERPO del último toque, o null (v1.3 A / v1.4)
  const ltBody = lt !== null ? m.bodyById.get(lt) : null;
  const ltTeam = ltBody ? ltBody.team : null;
  // Gol en contra: el último toque fue de un cuerpo del EQUIPO que recibe (incluye
  // a un compañero en 2v2 y al cuerpo B del propio usuario en duo): solo resta,
  // nadie suma (SPEC v1.1/v1.3 — el gol suma al EQUIPO del dueño del cuerpo).
  const ownGoal = ltTeam !== null && ltTeam === concededTeam;
  const scorerTeam = ltTeam !== null && ltTeam !== concededTeam ? ltTeam : null;
  // scorerId = cuerpo que tocó último la pelota (autor físico del gol); en un gol
  // en contra identifica al que lo metió (scorerTeam queda null: nadie suma).
  const scorerId = ltTeam !== null ? lt : null;

  m.scores[concededTeam] -= 1;
  if (scorerTeam !== null) m.scores[scorerTeam] += 1;

  // target=goals (v1.3 D): gana el primer equipo en llegar a `value` (default 3).
  // En target=time los goles no terminan el partido (lo termina el reloj o el oro).
  if (m.target === "goals") {
    for (let t = 0; t < m.scores.length; t++) {
      if (m.scores[t] >= m.value) {
        m.winnerTeam = t;
        m.endReason = "goals";
      }
    }
  }

  // La pelota desaparece durante la pausa (el cliente la oculta con paused=true).
  m.ball.x = 0;
  m.ball.y = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.ball.lastTouch = null;
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

  // GOL DE ORO (v1.3 D): el próximo gol de CUALQUIER equipo termina el partido AL
  // INSTANTE (gameover inmediatamente después del evento goal, sin GOAL_PAUSE ni
  // kickoff). Ganador: el líder tras el gol; si el gol no dejó un líder único (gol
  // en contra con 3+ equipos empatados en la cima), desempate determinista: el
  // equipo que metió el gol si está en la cima, si no el líder de menor índice.
  if (m.golden) {
    let max = -Infinity;
    for (const s of m.scores) {
      if (s > max) max = s;
    }
    let winner = m.scores.indexOf(max);
    if (scorerTeam !== null && m.scores[scorerTeam] === max) winner = scorerTeam;
    m.winnerTeam = winner;
    endMatch(room, "golden");
  }
}

// Final del partido (v1.3 D: reason = "goals" | "time" | "golden"). El pase de
// status a "gameover" saca a la sala del loop global de ticks (v1.2 E.3).
function endMatch(room, reason) {
  const m = room.match;
  room.status = "gameover";
  m.paused = true;
  m.endReason = reason;
  broadcastState(room);
  broadcast(room, {
    type: "gameover",
    winnerTeam: m.winnerTeam,
    scores: m.scores.slice(),
    reason,
  });
}

// target=time (v1.3 D): el reloj llegó a 0 con la pelota en juego. Líder único →
// gameover normal (reason "time"); empate en la cima → {type:"golden"} (broadcast)
// y el juego SIGUE en GOL DE ORO (tl se omite del state desde acá).
function timeUp(room) {
  const m = room.match;
  let max = -Infinity;
  for (const s of m.scores) {
    if (s > max) max = s;
  }
  const leaders = [];
  for (let t = 0; t < m.scores.length; t++) {
    if (m.scores[t] === max) leaders.push(t);
  }
  if (leaders.length === 1) {
    m.winnerTeam = leaders[0];
    endMatch(room, "time");
  } else {
    m.golden = true;
    broadcast(room, { type: "golden" });
  }
}

function endPause(room) {
  const m = room.match;
  if (m.winnerTeam !== null) {
    endMatch(room, m.endReason || "goals");
  } else {
    resetPositions(m);
    m.paused = false;
    broadcast(room, { type: "kickoff" });
  }
}

// v1.2 A: posiciones y velocidades a 1 decimal (snapshot ~35% más chico). Cada
// jugador expone vx/vy e iq (= lastSeq de input aplicado): el cliente reconcilia su
// predicción con pos/vel del server + iq y re-simula sus inputs pendientes.
// v1.2 E.1: snapshot compacto — stun/kc/slide se OMITEN si valen 0 (el cliente
// asume 0 si faltan, contrato "campos ausentes = 0").
// v1.2 E.2/E.3: UN solo JSON.stringify por sala (el mismo string va a los N
// jugadores) y backpressure por conexión: bufferedAmount > 64 KB saltea el snapshot
// de ese ciclo (no se acumula); > 512 KB cierra la conexión (cliente zombi).
function broadcastState(room) {
  const m = room.match;
  if (!m) return;
  // v1.3 A/B: state.players = CUERPOS. iq = lastSeq del USUARIO dueño: en duo viaja
  // el MISMO valor en ambos cuerpos propios (un solo seq por mensaje de input).
  // v1.4 I: velocidades en u/tick a 2 decimales (las velocidades chicas por tick lo
  // necesitan para la extrapolación de mundo completo del cliente). ka (kickArmed,
  // bool) y kh (kickHeld efectivo) van por cuerpo para el feedback de "armado"; kc es
  // AHORA el cooldown en TICKS restantes (entero). stun/slide en TICKS. Campos en 0
  // (o false) se OMITEN (el cliente asume 0/false si faltan).
  const players = [];
  for (const b of m.bodies) {
    const o = {
      id: b.id,
      x: r2(b.x),
      y: r2(b.y),
      vx: r2(b.vx),
      vy: r2(b.vy),
      fx: r2(b.fx),
      fy: r2(b.fy),
      iq: b.ownerRef.lastSeq,
    };
    if (b.stun > 0) o.stun = b.stun;           // ticks restantes de stun
    if (b.kickCd > 0) o.kc = b.kickCd;         // ticks restantes de cooldown (v1.4)
    if (b.slide > 0) o.slide = b.slide;        // ticks restantes de barrida
    if (b.kickArmed) o.ka = 1;                  // armado (puede patear al tocar)
    if (b.kickHeld) o.kh = 1;                   // kick mantenido efectivo (tinte visual)
    players.push(o);
  }
  const ball = { x: r2(m.ball.x), y: r2(m.ball.y), vx: r2(m.ball.vx), vy: r2(m.ball.vy) };
  // v1.4 I: lt = id del cuerpo del último toque (color del relator), opcional.
  if (m.ball.lastTouch != null) ball.lt = m.ball.lastTouch;
  const snap = {
    type: "state",
    ball,
    players,
    scores: m.scores.slice(),
    paused: m.paused,
  };
  // v1.3 D: tl = segundos restantes (entero, redondeo TECHO), presente SOLO en
  // target=time; en GOL DE ORO se omite.
  if (m.target === "time" && !m.golden) snap.tl = Math.ceil(m.timeLeft);
  const data = JSON.stringify(snap);
  for (const p of room.players) {
    const ws = p.ws;
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.bufferedAmount > BP_CLOSE_BYTES) {
      // Zombi: ni el snapshot salteado le alcanza. terminate() emite "close" de
      // forma asíncrona (la limpieza de removePlayer NO corre dentro de este loop).
      ws.terminate();
      continue;
    }
    if (ws.bufferedAmount > BP_SKIP_BYTES) continue; // saltear este ciclo
    ws.send(data);
  }
}

// Mapa de inputs reutilizado por tick (evita asignar un objeto por sala por tick).
// stepWorld lee inputsById[body.id] = {mx,my,kick,tackle}; lo poblamos por cuerpo
// desde su input MANTENIDO (mx/my/kick mantenido; tackle edge — ver handleInput).
const TICK_INPUTS = Object.create(null);

function tickRoom(room) {
  const m = room.match;
  if (!m || room.status !== "playing") return;
  const dt = TICK; // 1/60 s real para el reloj de tiempo (v1.3 D); la física usa dt=1.

  /* ---- Pausa post-gol: la física queda congelada (igual que v1.3); solo corre la
     cuenta regresiva. Los inputs mantenidos se preservan en cada cuerpo. ---- */
  if (m.paused) {
    m.pauseLeft -= dt;
    if (m.pauseLeft <= 0) endPause(room);
  } else {
    /* ---- v1.4: UN paso del NÚCLEO HaxBall. stepWorld(state, inputsById, arena, phys,
       rules) resuelve TODO: input→aceleración, kick MANTENIDO por contacto, barrida
       (si rules.tackles), integración+damping (dt=1), colisiones (discos, paredes,
       postes) y confinamiento. Pura/determinista: misma fórmula que la extrapolación
       del cliente. Devuelve eventos {type:"kicked"|"tackle", id, victim?}. ---- */
    // Poblar inputsById desde el input mantenido de cada cuerpo. tackle es un PULSO:
    // se consume este tick y se baja (edge-trigger), igual que en el cliente.
    for (const k in TICK_INPUTS) delete TICK_INPUTS[k];
    for (const b of m.bodies) {
      TICK_INPUTS[b.id] = {
        mx: b.inMx,
        my: b.inMy,
        kick: b.inKick,        // MANTENIDO (true mientras apretado)
        tackle: b.inTackle,    // edge: lo dispara este tick
      };
      b.inTackle = false;      // consumir el pulso de tackle (edge-trigger)
    }

    // state que espera stepWorld: {bodies, ball, rules}. m ya tiene esos campos.
    const events = Phys.stepWorld(m, TICK_INPUTS, m.arena, m.arena.phys, m.rules);

    // Eventos del tick → cliente (sfx/anim precisos). {type:"kicked", id} al patear
    // (v1.4 I). Los de "tackle" no requieren mensaje propio (el cliente los infiere).
    if (events.length > 0) {
      for (let e = 0; e < events.length; e++) {
        if (events[e].type === "kicked") {
          broadcast(room, { type: "kicked", id: events[e].id });
        }
      }
    }

    // Detección de gol (el server decide el resto): el centro de la pelota cruzó la
    // boca de algún arco hacia afuera. goalCheck devuelve el equipo que recibió, o -1.
    const conceded = Phys.goalCheck(m.ball, m.arena);
    if (conceded >= 0) onGoal(room, conceded);
  }

  /* ---- Reloj de partido (v1.3 D, target=time): corre ÚNICAMENTE con la pelota en
     juego (no durante GOAL_PAUSE — si este mismo tick hubo gol, m.paused ya es true
     y el reloj no avanza). En GOL DE ORO ya no hay reloj. ---- */
  if (room.status === "playing" && m.target === "time" && !m.golden && !m.paused) {
    m.timeLeft -= dt;
    if (m.timeLeft <= 0) {
      m.timeLeft = 0;
      timeUp(room); // líder único → gameover "time"; empate → golden
    }
  }

  /* ---- Broadcast a 30 Hz (cada 2 ticks) ---- */
  room.tickCount++;
  if (room.status === "playing" && room.tickCount % TICKS_PER_SNAP === 0) {
    broadcastState(room);
  }
}

/* ==================== Loop global de 60 Hz (v1.2 — sección E.3) =================== */

/*
 * UN solo setInterval para TODO el proceso (en vez de un interval por sala): cada
 * tick itera las salas y procesa SOLO las que están en "playing" (las salas en
 * lobby/gameover no se tocan; salir de "playing" las saca solas del loop). Menos
 * timers activos con muchas salas, mismo contrato (60 Hz física, 30 Hz broadcast,
 * dt fijo = TICK). La duración de cada tick global se registra para /metrics.
 * Borrar salas del Map durante la iteración es seguro (semántica de Map en JS), y
 * tickRoom nunca destruye salas sincrónicamente (terminate() emite close async).
 */
/*
 * Acumulador de tiempo real: setInterval con delay fraccionario (16.667 ms) se
 * trunca a 16 ms en Node y además acumula drift por el re-armado del timer (medido:
 * ~56 Hz reales). En su lugar, un timer corto (8 ms) acumula el tiempo transcurrido
 * con hrtime y ejecuta UN tick fijo de TICK por cada 16.667 ms acumulados, con tope
 * de catch-up por iteración (pausas largas de GC/CPU no generan ráfagas infinitas:
 * la deuda excedente se descarta y el juego "pierde" ese tiempo en vez de acelerarse).
 */
const TICK_MS = 1000 * TICK;
const MAX_CATCHUP_TICKS = 4;
let lastLoopNs = process.hrtime.bigint();
let tickDebtMs = 0;

setInterval(() => {
  const nowNs = process.hrtime.bigint();
  tickDebtMs += Number(nowNs - lastLoopNs) / 1e6;
  lastLoopNs = nowNs;
  let ticks = 0;
  while (tickDebtMs >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
    const t0 = process.hrtime.bigint();
    for (const room of rooms.values()) {
      if (room.status === "playing") tickRoom(room);
    }
    recordTickSample(Number(process.hrtime.bigint() - t0) / 1e6);
    tickDebtMs -= TICK_MS;
    ticks += 1;
  }
  if (ticks === MAX_CATCHUP_TICKS && tickDebtMs >= TICK_MS) tickDebtMs = 0;
}, 8);

/* ======================== Métricas (v1.2 — sección E.4) ========================== */

// Ventana móvil de 10 s de duraciones (ms) del tick global: a 60 Hz son ≤ ~600
// muestras, así que prune con shift() y sort() bajo demanda son triviales.
const tickSamples = []; // { t: Date.now(), ms } — push al final, prune del frente

function pruneTickSamples(now) {
  const cutoff = now - METRICS_WINDOW_MS;
  while (tickSamples.length > 0 && tickSamples[0].t < cutoff) tickSamples.shift();
}

function recordTickSample(ms) {
  const now = Date.now();
  tickSamples.push({ t: now, ms });
  pruneTickSamples(now);
}

// GET /metrics → {rooms, playing, players, bodies, tickAvgMs, tickP95Ms, rssMB}
// (SPEC E.4 + v1.3 E: players cuenta CONEXIONES (usuarios) y bodies los CUERPOS
// en juego — en duo cada usuario aporta 2).
function buildMetrics() {
  pruneTickSamples(Date.now());
  let playing = 0;
  let bodies = 0;
  for (const room of rooms.values()) {
    if (room.status === "playing") {
      playing++;
      if (room.match) bodies += room.match.bodies.length;
    }
  }
  let tickAvgMs = 0;
  let tickP95Ms = 0;
  if (tickSamples.length > 0) {
    const vals = tickSamples.map((s) => s.ms).sort((a, b) => a - b);
    let sum = 0;
    for (const v of vals) sum += v;
    tickAvgMs = sum / vals.length;
    tickP95Ms = vals[Math.min(vals.length - 1, Math.max(0, Math.ceil(0.95 * vals.length) - 1))];
  }
  return {
    rooms: rooms.size,
    playing,
    players: wss.clients.size, // conexiones WS = usuarios (v1.3 E)
    bodies,
    tickAvgMs: Math.round(tickAvgMs * 1000) / 1000,
    tickP95Ms: Math.round(tickP95Ms * 1000) / 1000,
    rssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
  };
}

/* ============================== Protocolo WebSocket ============================== */

const wss = new WebSocket.Server({ server, maxPayload: 4096 });

function handleCreate(ws, msg) {
  if (ws.roomRef) return sendError(ws, "Ya estás en una sala");
  if (rooms.size >= MAX_ROOMS) return sendError(ws, "Servidor lleno"); // v1.2 E.5
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
    mode: "ffa", // "ffa" | "1v1" | "2v2" | "duo"
    stadium: "clasico", // "clasico" | "noche" | "playa" | "nieve"
    target: "goals", // objetivo de partido (v1.3 D): "goals" | "time"
    value: WIN_SCORE, // goles objetivo (default 3) o segundos según target
    tackles: true,   // v1.4 E: barrida activa (default true; host la togglea con setRules)
    players: [],
    nextPlayerNum: 1,
    status: "lobby", // "lobby" | "playing" | "gameover"
    match: null,
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

// Lista de salas públicas: SOLO públicas, no llenas y sin partido en curso (SPEC v1.1).
function buildRoomsList() {
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
      target: room.target, // v1.3 D: las cards muestran el objetivo ("a 3 goles" / "5 min")
      value: room.value,
      tackles: room.tackles, // v1.4 E: las cards muestran si la barrida está activa
    });
  }
  return list;
}

// {type:"listRooms"} → {type:"rooms", rooms:[...]} — se mantiene en v1.2 (compat +
// botón refrescar manual del cliente).
function handleListRooms(ws) {
  send(ws, { type: "rooms", rooms: buildRoomsList() });
}

/* ============== Suscripción a la lista de salas públicas (v1.2 — sección C) ============== */

// Conexiones suscriptas con {type:"subRooms", on:true}: reciben {type:"rooms", ...}
// (mismo formato v1.1) inmediatamente al suscribirse y un PUSH ante cada cambio que
// afecte la lista (sala creada/borrada, join/leave, cambio de modo/estadio/status),
// coalesced a máximo un push cada ROOMS_PUSH_MS (250 ms).
const roomSubs = new Set();
let roomsPushTimer = null; // timeout del push agendado, o null
let roomsPushedAt = 0;     // Date.now() del último push (para el coalescing)

function pushRooms() {
  if (roomSubs.size === 0) return;
  roomsPushedAt = Date.now();
  const data = JSON.stringify({ type: "rooms", rooms: buildRoomsList() });
  for (const ws of roomSubs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      roomSubs.delete(ws); // conexión muerta: limpiar (borrar durante for-of es seguro en Set)
    }
  }
}

// Notificar un cambio que afecta la lista: push inmediato si el último fue hace
// ≥ 250 ms; si no, UN solo timer agrupa todos los cambios del intervalo en un push.
function notifyRoomsChanged() {
  if (roomSubs.size === 0 || roomsPushTimer !== null) return;
  const wait = roomsPushedAt + ROOMS_PUSH_MS - Date.now();
  if (wait <= 0) {
    pushRooms();
  } else {
    roomsPushTimer = setTimeout(() => {
      roomsPushTimer = null;
      pushRooms();
    }, wait);
  }
}

// {type:"subRooms", on:true|false} (cliente: on al mostrar el home, off al salir).
function handleSubRooms(ws, msg) {
  if (msg.on === true) {
    roomSubs.add(ws);
    // Push inmediato a ESTA conexión al suscribirse (SPEC v1.2 C).
    send(ws, { type: "rooms", rooms: buildRoomsList() });
  } else if (msg.on === false) {
    roomSubs.delete(ws);
  }
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
  notifyRoomsChanged(); // el modo (y su cupo máximo) se muestran en la lista (v1.2 C)
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
  notifyRoomsChanged(); // el estadio se muestra en la lista de salas (v1.2 C)
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

// {type:"setMatch", target, value} — solo host, solo lobby (v1.3 D). Whitelist
// EXACTA: goals → {1,3,5,10}; time → {120,180,300,600} segundos. Cambiarlo NO
// resetea los readies (a diferencia de setMode). Inválido → error.
function handleSetMatch(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (room.players[0] !== ws.playerRef) {
    return sendError(ws, "Solo el host puede cambiar el objetivo");
  }
  const target = msg.target;
  if (target !== "goals" && target !== "time") return sendError(ws, "Objetivo inválido");
  const allowed = target === "goals" ? MATCH_GOALS_VALUES : MATCH_TIME_VALUES;
  if (!allowed.includes(msg.value)) return sendError(ws, "Objetivo inválido");
  if (room.target === target && room.value === msg.value) return;
  room.target = target;
  room.value = msg.value;
  broadcastLobby(room); // los readies quedan como estaban (SPEC v1.3 D)
  notifyRoomsChanged(); // target/value se muestran en las cards de salas (v1.3 D)
}

// {type:"setRules", tackles:bool} — solo host, solo lobby (v1.4 E). Activa/desactiva
// la barrida (default true). Con tackles:false el juego es "HaxBall puro". NO resetea
// readies. Se refleja en lobby y en las cards de salas (rooms).
function handleSetRules(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "lobby" || !ws.playerRef) return;
  if (room.players[0] !== ws.playerRef) {
    return sendError(ws, "Solo el host puede cambiar las reglas");
  }
  if (typeof msg.tackles !== "boolean") return sendError(ws, "Regla inválida");
  if (room.tackles === msg.tackles) return;
  room.tackles = msg.tackles;
  broadcastLobby(room); // los readies quedan como estaban (SPEC v1.4 E)
  notifyRoomsChanged(); // tackles se muestra en las cards de salas (v1.4 E)
}

// rematch (host, tras gameover): vuelve AL LOBBY con readies reseteados (v1.1);
// el partido arranca de nuevo solo por readies (auto-arranque).
function handleRematch(ws) {
  const room = ws.roomRef;
  if (!room || room.status !== "gameover") return;
  if (room.players[0] !== ws.playerRef) return sendError(ws, "Solo el host puede pedir revancha");
  room.match = null;
  room.status = "lobby";
  resetReadies(room);
  broadcastLobby(room);
  notifyRoomsChanged(); // gameover → lobby: la sala vuelve a la lista de públicas (v1.2 C)
}

// Aplica un paquete de input (los campos planos o el objeto `b` de duo, con las
// MISMAS validaciones/clamps — v1.3 B) a UN cuerpo. v1.4 I: kick es ESTADO MANTENIDO
// (se setea Y se baja con cada input, no es edge), tackle sigue edge-trigger.
function applyBodyInput(b, src) {
  // Clampear cada componente a [-1, 1] y normalizar si |v| > 1 (server-side, SPEC).
  // El núcleo discretiza a 8 direcciones (clampDir) dentro de stepWorld; acá guardamos
  // el vector de movimiento MANTENIDO tal cual (la última intención del cliente).
  let mx = clamp(num(src.mx), -1, 1);
  let my = clamp(num(src.my), -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  b.inMx = mx;
  b.inMy = my;

  // kick: estado MANTENIDO (v1.4 D/I). true mientras el cliente lo reporta apretado;
  // al soltar manda input con kick:false y acá baja. El núcleo re-arma al soltar.
  b.inKick = src.kick === true;

  // tackle: edge-trigger (v1.4 E). Solo se SETEA en true; el tick lo consume y baja.
  // No se limpia acá (un input con tackle:false no debe borrar un pulso pendiente).
  if (src.tackle === true) b.inTackle = true;
}

// Limpia el input MANTENIDO de un cuerpo cuyo input no vino en el mensaje (en duo,
// cuerpo B sin `b`): queda quieto y suelta el kick (v1.3 B + v1.4 I).
function clearBodyInput(b) {
  b.inMx = 0;
  b.inMy = 0;
  b.inKick = false;
  // El tackle pendiente (si lo hubiera) se respeta hasta que el tick lo consuma.
}

function handleInput(ws, msg) {
  const room = ws.roomRef;
  if (!room || room.status !== "playing" || !room.match || !ws.playerRef) return;
  const player = ws.playerRef;
  const userBodies = room.match.bodiesByUser.get(player.id);
  if (!userBodies) return;

  // seq (v1.2 A): entero incremental por conexión (arranca en 1). Ignorar seq no
  // numérico y seq ≤ lastSeq (input viejo/reordenado). Compat clientes sin seq:
  // se aplica igual con seq = lastSeq + 1 (SPEC v1.2, notas de compatibilidad).
  // v1.3 B: UN solo seq por mensaje cubre AMBOS cuerpos del usuario.
  if (msg.seq === undefined) {
    player.lastSeq += 1;
  } else {
    if (typeof msg.seq !== "number" || !Number.isFinite(msg.seq)) return;
    const seq = Math.floor(msg.seq);
    if (seq <= player.lastSeq) return;
    player.lastSeq = seq;
  }

  // Campos planos → cuerpo slot 0. En duo, el objeto `b` (opcional, mismos clamps)
  // controla el slot 1; SIN `b` el cuerpo B queda con movimiento 0 (quieto) y suelta
  // el kick (v1.3 B + v1.4 I). En modos no-duo el server IGNORA `b` (un solo cuerpo).
  applyBodyInput(userBodies[0], msg);
  if (userBodies.length === DUO_BODIES) {
    if (msg.b && typeof msg.b === "object") {
      applyBodyInput(userBodies[1], msg.b);
    } else {
      clearBodyInput(userBodies[1]);
    }
  }
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
    case "subRooms":
      handleSubRooms(ws, msg);
      break;
    case "ping":
      // {type:"ping", t} → {type:"pong", t}: eco de t para que el cliente mida RTT
      // (v1.2 A). Validar que t sea un número (no eco de payloads arbitrarios).
      if (typeof msg.t === "number" && Number.isFinite(msg.t)) {
        send(ws, { type: "pong", t: msg.t });
      }
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
    case "setMatch":
      handleSetMatch(ws, msg);
      break;
    case "setRules":
      handleSetRules(ws, msg);
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
  ws.rlCount = 0;           // rate limit (v1.2 E.5): mensajes en la ventana actual
  ws.rlStart = Date.now();  // inicio de la ventana del rate limit

  ws.on("error", () => {
    /* evitar crash por errores de socket; close se encarga de la limpieza */
  });

  // v1.2 E.5: límite de conexiones (wss.clients ya incluye a ésta). El error viaja
  // antes del close frame; el cliente ve "Servidor lleno".
  if (wss.clients.size > MAX_CONN) {
    sendError(ws, "Servidor lleno");
    ws.close(1013, "Servidor lleno"); // 1013 = try again later
    return;
  }

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    // v1.2 E.5: rate limit por conexión ANTES de parsear (lo más barato posible).
    // Ventana fija de 1 s; al superar RATE_LIMIT_MAX se corta con terminate()
    // (con un flooder no tiene sentido esperar el handshake de close).
    const now = Date.now();
    if (now - ws.rlStart >= RATE_LIMIT_WINDOW_MS) {
      ws.rlStart = now;
      ws.rlCount = 0;
    }
    if (++ws.rlCount > RATE_LIMIT_MAX) {
      ws.terminate();
      return;
    }

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
    roomSubs.delete(ws); // baja de la suscripción a la lista de salas (v1.2 C)
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
