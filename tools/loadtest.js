#!/usr/bin/env node
/*
 * PoliGol — herramienta de carga (SPEC v1.2, sección E.6).
 *
 * Uso:
 *   node tools/loadtest.js --url ws://localhost:3000 --rooms 250 --players 4 --minutes 5
 *
 * Cada sala: un bot hace create (privada) y al recibir su código entran los joins;
 * todos mandan ready y el server auto-arranca (countdown de 3 s). Los bots mandan
 * input a 20 Hz con movimiento pseudoaleatorio DETERMINISTA (mulberry32, semilla por
 * índice global de bot) y patean (kick:true) al estar cerca de la pelota; cada 2 s
 * mandan {type:"ping", t} y miden RTT con el pong. Tras un gameover el host pide
 * rematch y todos se re-readyan (la sala queda activa toda la corrida).
 *
 * Imprime cada 10 s: salas activas, msgs/s recibidos, RTT p50/p95 (ventana de 10 s);
 * al final, un resumen. NO se incluye en el deploy (tools/ está fuera de public/).
 */

"use strict";

const WebSocket = require("ws");

/* ================================ Parámetros ===================================== */

const INPUT_HZ = 20;          // inputs por segundo por bot (SPEC E.6)
const PING_INTERVAL_MS = 2000; // ping de RTT cada 2 s (como el cliente real)
const REPORT_MS = 10000;      // reporte cada 10 s (SPEC E.6)
const KICK_DIST = 60;         // distancia a la pelota a la que el bot "patea"
const ROOM_STAGGER_MS = 25;   // separación entre lanzamientos de salas (anti-estampida)
const JOIN_STAGGER_MS = 15;   // separación entre joins dentro de una sala
const READY_DEBOUNCE_MS = 250; // no re-mandar ready más seguido que esto

/* ================================ Argumentos ===================================== */

function usageAndExit(message) {
  if (message) console.error("Error: " + message);
  console.error(
    "Uso: node tools/loadtest.js --url ws://host:puerto --rooms N --players 4 --minutes M"
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = { url: "ws://localhost:3000", rooms: 10, players: 4, minutes: 1 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case "--url":
        args.url = String(val);
        i++;
        break;
      case "--rooms":
        args.rooms = parseInt(val, 10);
        i++;
        break;
      case "--players":
        args.players = parseInt(val, 10);
        i++;
        break;
      case "--minutes":
        args.minutes = parseFloat(val);
        i++;
        break;
      default:
        usageAndExit("argumento desconocido: " + key);
    }
  }
  if (!/^wss?:\/\//.test(args.url)) usageAndExit("--url debe ser ws:// o wss://");
  if (!Number.isInteger(args.rooms) || args.rooms < 1) usageAndExit("--rooms inválido");
  if (!Number.isInteger(args.players) || args.players < 2 || args.players > 8) {
    usageAndExit("--players debe estar entre 2 y 8");
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) usageAndExit("--minutes inválido");
  return args;
}

/* ============================ PRNG determinista ================================== */

// mulberry32: PRNG de 32 bits, rápido y determinista por semilla (semilla = índice
// global del bot ⇒ misma corrida, mismos movimientos).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================ Estadísticas =================================== */

const stats = {
  msgs: 0,             // mensajes recibidos del server (todos los bots)
  lastMsgs: 0,         // corte del reporte anterior (para msgs/s)
  errors: 0,           // errores de ws + mensajes {type:"error"} del server
  unexpectedCloses: 0, // cierres fuera del shutdown
  rtts: [],            // TODAS las muestras de RTT (resumen final)
  rttWindow: [],       // {t, rtt} de los últimos 10 s (reporte periódico)
};

let errLogged = 0;
function logErr(text) {
  stats.errors++;
  if (errLogged < 20) {
    errLogged++;
    console.error("  [err] " + text);
  }
}

function pct(sortedVals, p) {
  if (sortedVals.length === 0) return 0;
  const idx = Math.min(sortedVals.length - 1, Math.max(0, Math.ceil(p * sortedVals.length) - 1));
  return sortedVals[idx];
}

/* ==================================== Bots ======================================= */

let shuttingDown = false;

class Bot {
  constructor(globalIndex, room, isHost) {
    this.idx = globalIndex;
    this.room = room;
    this.isHost = isHost;
    this.rand = mulberry32(0x9e3779b9 ^ Math.imul(globalIndex + 1, 2654435761));
    this.ws = null;
    this.id = null;          // playerId asignado por el server
    this.seq = 0;            // seq incremental de input (v1.2 A)
    this.playing = false;
    this.me = { x: 0, y: 0 };
    this.ball = { x: 0, y: 0 };
    this.dir = { mx: 1, my: 0 };
    this.dirLeft = 0;        // s hasta el próximo cambio de dirección
    this.lastReadySent = 0;
    this.timers = [];
  }

  connect() {
    if (shuttingDown) return;
    const ws = new WebSocket(this.room.args.url, { perMessageDeflate: false });
    this.ws = ws;

    ws.on("open", () => {
      if (this.isHost) {
        this.send({
          type: "create",
          name: "Bot" + this.idx,
          country: "AR",
          visibility: "private",
          roomName: "Load " + this.room.index,
        });
      } else {
        this.send({ type: "join", name: "Bot" + this.idx, country: "AR", room: this.room.code });
      }
      this.timers.push(setInterval(() => this.tickInput(), 1000 / INPUT_HZ));
      this.timers.push(
        setInterval(() => this.send({ type: "ping", t: Date.now() }), PING_INTERVAL_MS)
      );
    });

    ws.on("message", (data) => this.onMessage(data));

    ws.on("error", (err) => {
      logErr("ws bot " + this.idx + ": " + err.message);
    });

    ws.on("close", () => {
      this.stopTimers();
      if (!shuttingDown) {
        stats.unexpectedCloses++;
        if (this.isHost) this.room.playing = false;
      }
    });
  }

  onMessage(data) {
    stats.msgs++;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return;
    }
    switch (msg.type) {
      case "joined":
        this.id = msg.playerId;
        if (this.isHost) this.room.onHostJoined(msg.room);
        this.sendReady();
        break;
      case "lobby": {
        // Tras rematch/abort los readies vuelven a false: re-readyar (con debounce;
        // converge porque el lobby siguiente ya muestra ready:true).
        const self = Array.isArray(msg.players)
          ? msg.players.find((p) => p && p.id === this.id)
          : null;
        if (self && self.ready === false) this.sendReady();
        if (this.isHost) this.room.playing = false;
        break;
      }
      case "start":
        this.playing = true;
        if (this.isHost) this.room.playing = true;
        break;
      case "state": {
        if (msg.ball) {
          this.ball.x = Number(msg.ball.x) || 0;
          this.ball.y = Number(msg.ball.y) || 0;
        }
        const me = Array.isArray(msg.players)
          ? msg.players.find((p) => p && p.id === this.id)
          : null;
        if (me) {
          this.me.x = Number(me.x) || 0;
          this.me.y = Number(me.y) || 0;
        }
        break;
      }
      case "gameover":
        this.playing = false;
        if (this.isHost) {
          this.room.playing = false;
          // Revancha para que la sala siga generando carga toda la corrida.
          this.timers.push(setTimeout(() => this.send({ type: "rematch" }), 400));
        }
        break;
      case "pong":
        if (typeof msg.t === "number") {
          const rtt = Date.now() - msg.t;
          stats.rtts.push(rtt);
          stats.rttWindow.push({ t: Date.now(), rtt });
        }
        break;
      case "error":
        logErr("server → bot " + this.idx + ": " + msg.message);
        break;
      default:
        break; // goal/kickoff/starting/startCancelled/rooms: solo cuentan como msgs
    }
  }

  sendReady() {
    const now = Date.now();
    if (now - this.lastReadySent < READY_DEBOUNCE_MS) return;
    this.lastReadySent = now;
    this.send({ type: "ready", ready: true });
  }

  // Movimiento pseudoaleatorio determinista a 20 Hz: cada 0.3–1.5 s elige rumbo
  // nuevo (60% de las veces persigue la pelota con jitter — garantiza patadas);
  // kick:true cuando la pelota está cerca (el cooldown lo aplica el server).
  tickInput() {
    if (!this.playing) return;
    this.dirLeft -= 1 / INPUT_HZ;
    if (this.dirLeft <= 0) {
      this.dirLeft = 0.3 + this.rand() * 1.2;
      if (this.rand() < 0.6) {
        const dx = this.ball.x - this.me.x;
        const dy = this.ball.y - this.me.y;
        const d = Math.hypot(dx, dy) || 1;
        const mx = dx / d + (this.rand() - 0.5) * 0.6;
        const my = dy / d + (this.rand() - 0.5) * 0.6;
        const l = Math.hypot(mx, my) || 1;
        this.dir.mx = mx / l;
        this.dir.my = my / l;
      } else {
        const ang = this.rand() * Math.PI * 2;
        this.dir.mx = Math.cos(ang);
        this.dir.my = Math.sin(ang);
      }
    }
    const near = Math.hypot(this.ball.x - this.me.x, this.ball.y - this.me.y) <= KICK_DIST;
    this.send({
      type: "input",
      seq: ++this.seq,
      mx: this.dir.mx,
      my: this.dir.my,
      kick: near,
      tackle: false,
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  stopTimers() {
    for (const t of this.timers) clearInterval(t); // clearInterval limpia también timeouts
    this.timers.length = 0;
  }

  stop() {
    this.stopTimers();
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      try {
        this.ws.close();
      } catch (err) {
        /* ignorar: shutdown */
      }
    }
  }
}

class RoomCtl {
  constructor(index, args) {
    this.index = index;
    this.args = args;
    this.code = null;
    this.playing = false; // true entre "start" y "gameover"/"lobby" (lo marca el host)
    this.bots = [];
  }

  launch() {
    const host = new Bot(this.index * this.args.players, this, true);
    this.bots.push(host);
    host.connect();
  }

  onHostJoined(code) {
    this.code = code;
    for (let j = 1; j < this.args.players; j++) {
      const bot = new Bot(this.index * this.args.players + j, this, false);
      this.bots.push(bot);
      setTimeout(() => bot.connect(), j * JOIN_STAGGER_MS);
    }
  }
}

/* ==================================== Main ======================================= */

const args = parseArgs(process.argv);
console.log(
  "PoliGol loadtest → " +
    args.url +
    " | " +
    args.rooms +
    " salas × " +
    args.players +
    " bots (" +
    args.rooms * args.players +
    " conexiones) | " +
    args.minutes +
    " min"
);

const roomCtls = [];
for (let r = 0; r < args.rooms; r++) {
  const ctl = new RoomCtl(r, args);
  roomCtls.push(ctl);
  setTimeout(() => ctl.launch(), r * ROOM_STAGGER_MS);
}

const t0 = Date.now();

function report() {
  const now = Date.now();
  while (stats.rttWindow.length > 0 && stats.rttWindow[0].t < now - REPORT_MS) {
    stats.rttWindow.shift();
  }
  const win = stats.rttWindow.map((s) => s.rtt).sort((a, b) => a - b);
  const active = roomCtls.reduce((acc, c) => acc + (c.playing ? 1 : 0), 0);
  const rate = Math.round(((stats.msgs - stats.lastMsgs) * 1000) / REPORT_MS);
  stats.lastMsgs = stats.msgs;
  console.log(
    "[" +
      Math.round((now - t0) / 1000) +
      "s] salas activas " +
      active +
      "/" +
      args.rooms +
      " | msgs/s recibidos " +
      rate +
      " | RTT p50 " +
      pct(win, 0.5) +
      " ms · p95 " +
      pct(win, 0.95) +
      " ms | errores " +
      stats.errors
  );
}

const reporter = setInterval(report, REPORT_MS);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(reporter);
  for (const ctl of roomCtls) {
    for (const bot of ctl.bots) bot.stop();
  }
  const elapsed = (Date.now() - t0) / 1000;
  const all = stats.rtts.slice().sort((a, b) => a - b);
  console.log("--- RESUMEN ---");
  console.log(
    "duración " +
      Math.round(elapsed) +
      " s | msgs recibidos " +
      stats.msgs +
      " (" +
      Math.round(stats.msgs / Math.max(1, elapsed)) +
      "/s promedio)"
  );
  console.log(
    "RTT: " +
      all.length +
      " muestras | p50 " +
      pct(all, 0.5) +
      " ms | p95 " +
      pct(all, 0.95) +
      " ms"
  );
  console.log(
    "errores " + stats.errors + " | cierres inesperados " + stats.unexpectedCloses
  );
  // Margen para que los close frames salgan antes de terminar el proceso.
  setTimeout(() => process.exit(stats.errors > 0 ? 1 : 0), 500);
}

setTimeout(shutdown, args.minutes * 60 * 1000);
process.on("SIGINT", shutdown);
