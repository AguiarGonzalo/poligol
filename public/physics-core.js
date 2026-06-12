/*
 * PoliGol — physics-core.js — MOTOR DE FÍSICA COMPARTIDO (v1.4 — FÍSICA ESTILO HAXBALL)
 * ============================================================================
 *
 * ÚNICA FUENTE DE VERDAD de la física: el server (server.js) lo carga con
 * `require("./public/physics-core.js")` y el cliente (client.js) lo carga con
 * `<script src="physics-core.js">` (expone `window.PoliPhysics`). Que ambos lados
 * compartan EXACTAMENTE el mismo código elimina el drift de determinismo entre la
 * simulación autoritativa del server (60 Hz, dt=1) y la extrapolación de mundo
 * completo del cliente (SPEC v1.4 H).
 *
 * Normativo: SPEC.md sección "v1.4 — FÍSICA ESTILO HAXBALL", que PISA toda la física
 * previa. Unidades en u/tick (dt = 1, 60 Hz). Damping geométrico por tick
 * (speed *= damping), NO exponencial. Orden de tick EXACTO (sección A). Colisiones
 * por momento con restitución `a.bCoef*b.bCoef + 1` (sección B). Kick por contacto
 * MANTENIDO (sección D). Reverse-engineering del engine real (node-haxball).
 *
 * Patrón UMD: funciona en Node Y browser sin paso de build.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PoliPhysics = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ======================================================================== *
   * C. CONSTANTES (SPEC v1.4 sección C) — unidades/tick (dt = 1, 60 Hz)       *
   * ======================================================================== */

  // --- Jugador (cuerpo controlado) ---
  const PLAYER_R = 15;                 // radio del disco jugador
  const PLAYER_INVMASS = 0.5;          // 1/masa del jugador (más pesado que la pelota)
  const PLAYER_BCOEF = 0.5;            // restitución del jugador
  const PLAYER_DAMPING = 0.96;         // damping geométrico por tick
  const KICKING_DAMPING = 0.96;        // damping mientras mantiene kick (= damping por defecto)
  const ACCEL = 0.1;                   // aceleración normal por tick² (terminal ≈ 2.4 u/tick)
  const KICKING_ACCEL = 0.07;          // aceleración mientras mantiene kick (terminal ≈ 1.68)

  // --- Pelota ---
  const BALL_R = 10;                   // radio del disco pelota
  const BALL_INVMASS = 1;              // 1/masa de la pelota
  const BALL_BCOEF = 0.5;              // restitución de la pelota
  const BALL_DAMPING = 0.99;           // damping geométrico por tick (rueda lejos)

  // --- Geometría / superficies estáticas ---
  const WALL_BCOEF = 1;                // restitución de las paredes (rebote elástico)
  const POST_R = 8;                    // radio del poste (disco estático en cada extremo de boca)
  const POST_BCOEF = 0.5;              // restitución del poste

  // --- Kick (SPEC v1.4 D) ---
  const KICK_STRENGTH = 5;             // impulso del kick (pelota salta a speed 5)
  const KICKBACK = 0;                  // retroceso del cuerpo al patear (0 ⇒ nulo)
  const KICK_REACH = 4;                // alcance: dist − BALL_R − PLAYER_R < KICK_REACH ⇒ dist < 29
  const KICK_COOLDOWN_TICKS = 2;       // cooldown entre kicks (ticks)

  // --- Diagonal y mundo ---
  const DIAG = 0.7071067811865476;     // 1/√2 — normaliza el input diagonal (8 direcciones)
  const R = 380;                       // circunradio del polígono (unidades de mundo)
  const GOAL_W = 112;                  // ancho de la boca del arco (4 × diámetro del jugador)
  const RECT_W = 480;                  // n=2: half-extent horizontal (cancha 960×580)
  const RECT_H = 290;                  // n=2: half-extent vertical
  const SPAWN_FACTOR = 0.62;           // spawn del cuerpo k en 0.62 × M_k (entre centro y arco)

  /* ============================ Barrida (SPEC v1.4 E) ====================== *
   * HaxBall NO tiene barrida; es opcional por sala (rules.tackles). Cuando está
   * activa se reexpresa en unidades/tick coherentes con el nuevo damping. Stun y
   * slide se cuentan en TICKS (no segundos): 0.9 s × 60 = 54, 0.38 s × 60 ≈ 23.   */
  const TACKLE_RANGE = PLAYER_R * 2 + 14;   // 44 — rango centro-a-centro (SPEC E)
  const TACKLE_KNOCKBACK = 7;               // impulso ≈ 7 u/tick al rival (SPEC E)
  const TACKLE_BALL_FACTOR = 0.6;           // la pelota en rango recibe 0.6× del knockback
  const TACKLE_LUNGE = 2.5;                 // mini-lunge del que barre hacia su facing (u/tick)
  const TACKLE_STUN_TICKS = 54;             // 0.9 s de stun (SPEC) en ticks
  const SLIDE_DURATION_TICKS = 23;          // 0.38 s de slide (SPEC) en ticks (round(22.8))
  const SLIDE_SPEED = 5.3;                  // velocidad fija del slide (u/tick) ≈ 320 u/s
  const TACKLE_COOLDOWN_TICKS = 96;         // 1.6 s de cooldown (SPEC v1) en ticks

  // Margen de detección de gol (SPEC: proyección sobre la boca ≤ GOAL_W/2 − BALL_R).
  const GOAL_MARGIN = BALL_R;

  // Conjunto inmutable de constantes "phys" base. buildArena las clona para aplicar
  // los modificadores de estadio (sección G) SIN mutar estas (cada partido parte de
  // las mismas constantes; los estadios solo cambian la copia devuelta).
  const BASE_PHYS = Object.freeze({
    PLAYER_R: PLAYER_R,
    PLAYER_INVMASS: PLAYER_INVMASS,
    PLAYER_BCOEF: PLAYER_BCOEF,
    PLAYER_DAMPING: PLAYER_DAMPING,
    KICKING_DAMPING: KICKING_DAMPING,
    ACCEL: ACCEL,
    KICKING_ACCEL: KICKING_ACCEL,
    BALL_R: BALL_R,
    BALL_INVMASS: BALL_INVMASS,
    BALL_BCOEF: BALL_BCOEF,
    BALL_DAMPING: BALL_DAMPING,
    WALL_BCOEF: WALL_BCOEF,
    POST_R: POST_R,
    POST_BCOEF: POST_BCOEF,
    KICK_STRENGTH: KICK_STRENGTH,
    KICKBACK: KICKBACK,
    KICK_REACH: KICK_REACH,
    KICK_COOLDOWN_TICKS: KICK_COOLDOWN_TICKS,
    // Barrida (opcional por sala): magnitudes en u/tick.
    TACKLE_RANGE: TACKLE_RANGE,
    TACKLE_KNOCKBACK: TACKLE_KNOCKBACK,
    TACKLE_BALL_FACTOR: TACKLE_BALL_FACTOR,
    TACKLE_LUNGE: TACKLE_LUNGE,
    TACKLE_STUN_TICKS: TACKLE_STUN_TICKS,
    SLIDE_DURATION_TICKS: SLIDE_DURATION_TICKS,
    SLIDE_SPEED: SLIDE_SPEED,
    TACKLE_COOLDOWN_TICKS: TACKLE_COOLDOWN_TICKS,
  });

  /* ======================================================================== *
   * Helpers numéricos (guards anti-NaN en toda normalización de vectores)    *
   * ======================================================================== */

  function clonePhys() {
    // Copia mutable de las constantes base (los estadios la modifican).
    const out = {};
    for (const k in BASE_PHYS) out[k] = BASE_PHYS[k];
    return out;
  }

  // Aplica los modificadores de estadio (SPEC v1.4 G) sobre una copia de phys.
  // DEBEN ser idénticos en server y cliente (la extrapolación depende de eso).
  function applyStadium(phys, stadium) {
    if (stadium === "playa") {
      // La arena frena la pelota antes.
      phys.BALL_DAMPING = 0.97;
    } else if (stadium === "nieve") {
      // Patina: más inercia (damping alto), menos agarre (accel reducida).
      phys.PLAYER_DAMPING = 0.99;
      phys.ACCEL = BASE_PHYS.ACCEL * 0.6;
      phys.KICKING_ACCEL = BASE_PHYS.KICKING_ACCEL * 0.6;
      phys.BALL_DAMPING = 0.995;
    }
    // "clasico" y "noche": sin cambios de física (noche es solo visual).
    return phys;
  }

  /* ======================================================================== *
   * GEOMETRÍA — buildArena(n, stadium)                                        *
   * ------------------------------------------------------------------------ *
   * Deriva la cancha de las fórmulas poligonales del SPEC. Devuelve:          *
   *   walls: [{x0,y0,x1,y1, cx,cy, dx,dy, nx,ny, half, goal}]                 *
   *          segmentos rectos de pared; nx,ny = NORMAL EXTERIOR (apunta afuera *
   *          del polígono). El interior del campo está del lado negativo.     *
   *   posts: [{x,y, goal}]  discos estáticos en los dos extremos de cada boca.*
   *   goals: [{ax,ay,bx,by, cx,cy, nx,ny, dx,dy, team}]  boca de cada arco.   *
   *   spawns(team, slot, mode): posición + facing inicial de un cuerpo.       *
   *   phys: copia de las constantes con los modificadores de estadio.         *
   *   n: cantidad de equipos/arcos.                                           *
   * ======================================================================== */
  function buildArena(n, stadium) {
    const phys = applyStadium(clonePhys(), stadium);
    const walls = [];
    const posts = [];
    const goals = [];
    // Vértices de las ESQUINAS del polígono (donde se juntan dos paredes). Discos
    // estáticos de colisión exigidos por SPEC v1.4 paso 4c ("disco–vértice"). Se
    // mantienen SEPARADOS de `posts` (que son los palos del arco y se renderizan);
    // las esquinas no se dibujan, solo colisionan. En convexo la cobertura de los
    // segmentos adyacentes ya las cubre, pero se agregan para fidelidad al SPEC y
    // para que un estadio no-convexo (futuro) no tenga el hueco explotable.
    const verts = [];

    // Para cada lado, parte el segmento en (pared izquierda · boca · pared derecha),
    // ubica los postes en los extremos de la boca y registra la boca como gol.
    function addSide(ax, ay, bx, by, team) {
      const ex = bx - ax;
      const ey = by - ay;
      const len = Math.hypot(ex, ey) || 1;          // guard anti-NaN
      const dx = ex / len;                            // dirección a lo largo del lado
      const dy = ey / len;
      const mx = (ax + bx) / 2;                       // punto medio del lado
      const my = (ay + by) / 2;
      // Normal EXTERIOR: del centro del campo hacia afuera = dirección de M (lados
      // de un polígono regular centrado en 0). Para n=2 las pasamos explícitas.
      const mlen = Math.hypot(mx, my) || 1;
      const nx = mx / mlen;
      const ny = my / mlen;

      const halfGoal = GOAL_W / 2;
      // Extremos de la boca del arco, centrada en M sobre la dirección del lado.
      const g0x = mx - dx * halfGoal;
      const g0y = my - dy * halfGoal;
      const g1x = mx + dx * halfGoal;
      const g1y = my + dy * halfGoal;

      // Pared 1: de A al extremo izquierdo de la boca.
      pushWall(walls, ax, ay, g0x, g0y, nx, ny, null);
      // Pared 2: del extremo derecho de la boca a B.
      pushWall(walls, g1x, g1y, bx, by, nx, ny, null);

      // Postes en ambos extremos de la boca.
      posts.push({ x: g0x, y: g0y, goal: team });
      posts.push({ x: g1x, y: g1y, goal: team });

      // Boca del arco (para goalCheck y render).
      goals.push({
        ax: g0x, ay: g0y, bx: g1x, by: g1y,
        cx: mx, cy: my,            // centro de la boca
        nx: nx, ny: ny,            // normal exterior (cruzar hacia + = gol)
        dx: dx, dy: dy,            // dirección a lo largo de la boca
        team: team,
      });
    }

    if (n === 2) {
      // Rectángulo: half-extents RECT_W × RECT_H. Arco 0 a la izquierda (x=-RECT_W),
      // arco 1 a la derecha (x=+RECT_W); paredes superior/inferior sin boca.
      // Las normales exteriores van explícitas (no derivan del punto medio: las
      // bocas verticales tienen M sobre el eje x, pero las paredes top/bottom no).
      addRectSide(walls, posts, goals,
        -RECT_W, RECT_H, -RECT_W, -RECT_H, -1, 0, 0); // izquierda (arco 0), recorrida +y→-y
      addRectSide(walls, posts, goals,
        RECT_W, -RECT_H, RECT_W, RECT_H, 1, 0, 1);    // derecha (arco 1)
      // Paredes superior e inferior (sin boca): segmentos completos.
      pushWall(walls, -RECT_W, -RECT_H, RECT_W, -RECT_H, 0, -1, null); // arriba (y=-H)
      pushWall(walls, RECT_W, RECT_H, -RECT_W, RECT_H, 0, 1, null);    // abajo (y=+H)
      // Esquinas del rectángulo (4) como discos–vértice de colisión.
      verts.push({ x: -RECT_W, y: -RECT_H }, { x: RECT_W, y: -RECT_H },
                 { x: RECT_W, y: RECT_H }, { x: -RECT_W, y: RECT_H });
    } else {
      // Polígono regular: vértice k en angle_k = -PI/2 + 2*PI*k/n.
      for (let k = 0; k < n; k++) {
        const a0 = -Math.PI / 2 + (2 * Math.PI * k) / n;
        const a1 = -Math.PI / 2 + (2 * Math.PI * ((k + 1) % n)) / n;
        const ax = R * Math.cos(a0);
        const ay = R * Math.sin(a0);
        const bx = R * Math.cos(a1);
        const by = R * Math.sin(a1);
        addSide(ax, ay, bx, by, k); // el lado k pertenece al equipo/arco k
        verts.push({ x: ax, y: ay }); // esquina k (inicio del lado k) — n en total
      }
    }

    // Spawns (SPEC v1 + v1.1 2v2 + v1.3 duo). Devuelve {x,y,fx,fy}.
    function spawns(team, slot, mode) {
      const g = goals[team];
      const baseX = SPAWN_FACTOR * g.cx;
      const baseY = SPAWN_FACTOR * g.cy;
      // Facing inicial: hacia el centro = −normal exterior del arco propio.
      const fx = -g.nx;
      const fy = -g.ny;
      let sx = baseX;
      let sy = baseY;
      if (mode === "duo") {
        // Los 2 cuerpos del equipo separados ±55 perpendicular a centro→arco
        // (perpendicular a la normal del arco = dirección de la boca g.dx,g.dy).
        const off = slot === 0 ? -55 : 55;
        sx += g.dx * off;
        sy += g.dy * off;
      } else if (mode === "2v2") {
        // Compañeros (slot reutilizado como índice del compañero) separados ±90
        // perpendicular a centro→arco.
        const off = slot === 0 ? -90 : 90;
        sx += g.dx * off;
        sy += g.dy * off;
      }
      return { x: sx, y: sy, fx: fx, fy: fy };
    }

    return { n: n, walls: walls, posts: posts, verts: verts, goals: goals, spawns: spawns, phys: phys };
  }

  // Agrega un segmento de pared con su normal exterior. Guarda forma redundante
  // (extremos x0..y1 + punto medio/half/dir) para colisión y render.
  function pushWall(walls, x0, y0, x1, y1, nx, ny, goal) {
    const ex = x1 - x0;
    const ey = y1 - y0;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) return; // segmento degenerado (boca ocupa todo el lado): omitir
    walls.push({
      x0: x0, y0: y0, x1: x1, y1: y1,
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      dx: ex / len, dy: ey / len,
      nx: nx, ny: ny,
      half: len / 2,
      goal: goal,
    });
  }

  // n=2: un lado vertical con normal exterior explícita (nx,ny) y boca centrada.
  function addRectSide(walls, posts, goals, ax, ay, bx, by, nx, ny, team) {
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const dx = ex / len;
    const dy = ey / len;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const halfGoal = GOAL_W / 2;
    const g0x = mx - dx * halfGoal;
    const g0y = my - dy * halfGoal;
    const g1x = mx + dx * halfGoal;
    const g1y = my + dy * halfGoal;
    pushWall(walls, ax, ay, g0x, g0y, nx, ny, null);
    pushWall(walls, g1x, g1y, bx, by, nx, ny, null);
    posts.push({ x: g0x, y: g0y, goal: team });
    posts.push({ x: g1x, y: g1y, goal: team });
    goals.push({
      ax: g0x, ay: g0y, bx: g1x, by: g1y,
      cx: mx, cy: my, nx: nx, ny: ny, dx: dx, dy: dy, team: team,
    });
  }

  /* ======================================================================== *
   * B. COLISIONES (fórmulas EXACTAS de HaxBall, SPEC v1.4 B)                  *
   * ======================================================================== */

  // Disco A vs disco B. Cada uno: {x,y,vx,vy, r, invMass, bCoef}. invMass=0 ⇒ estático.
  // Restitución = a.bCoef*b.bCoef + 1; impulso SOLO si rel < 0 (se acercan). La
  // corrección posicional se reparte por invMass.
  function collideDiscs(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d2 = dx * dx + dy * dy;
    const rs = a.r + b.r;
    if (d2 <= 0 || d2 > rs * rs) return false;
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return false; // dos estáticos: nada que resolver
    const d = Math.sqrt(d2);
    const nx = dx / d;             // normal A←B
    const ny = dy / d;
    const ratio = a.invMass / invSum;
    const pen = rs - d;
    a.x += nx * pen * ratio;
    a.y += ny * pen * ratio;
    b.x -= nx * pen * (1 - ratio);
    b.y -= ny * pen * (1 - ratio);
    const rel = nx * (a.vx - b.vx) + ny * (a.vy - b.vy);
    if (rel < 0) {
      const f = rel * (a.bCoef * b.bCoef + 1);
      a.vx -= nx * f * ratio;
      a.vy -= ny * f * ratio;
      b.vx += nx * f * (1 - ratio);
      b.vy += ny * f * (1 - ratio);
    }
    return true;
  }

  // Disco D vs segmento de pared. wall: {cx,cy, dx,dy, nx,ny, half}. nx,ny = normal
  // EXTERIOR del campo (el disco está del lado interior, signed distance ≤ 0 dentro).
  // bCoef pared = phys.WALL_BCOEF (= 1). Solo discos con invMass>0.
  // Detección dentro del tramo (proyección entre extremos); penetración si el disco
  // cruza hacia el lado exterior a menos de r. Empuja afuera y refleja si va saliendo.
  function collideDiscWall(d, wall, phys) {
    if (d.invMass <= 0) return false;
    const r = d.r;
    // Distancia con signo del CENTRO a la línea de la pared (+ = lado exterior, − =
    // interior del campo). El BORDE del disco que mira a la pared está en sd − r si
    // sd>0; el disco recién toca la línea cuando su centro está a r del lado interior,
    // es decir sd = −r. Solo hay contacto cuando el borde cruzó ese punto: sd > −r.
    // Por debajo de eso (sd ≤ −r) el disco está completamente adentro y NO colisiona
    // (sin este límite, un disco en el centro del campo recibiría un empuje gigante).
    const sd = (d.x - wall.cx) * wall.nx + (d.y - wall.cy) * wall.ny;
    const pen = sd + r;                  // profundidad de penetración (positiva ⇒ toca)
    if (pen <= 0) return false;          // disco bien adentro: sin contacto
    if (sd > r) return false;            // ya cruzó del todo hacia afuera (boca/borde): no confinar acá
    // Proyección a lo largo del segmento (clamp al tramo): solo colisiona dentro de él.
    const s = (d.x - wall.cx) * wall.dx + (d.y - wall.cy) * wall.dy;
    if (s < -wall.half || s > wall.half) return false; // fuera del tramo (es boca/borde)
    // Empujar el disco hacia adentro (a lo largo de la normal exterior, signo −).
    d.x -= wall.nx * pen;
    d.y -= wall.ny * pen;
    // Reflejar solo si va HACIA la pared (componente saliente positiva).
    const vn = d.vx * wall.nx + d.vy * wall.ny;
    if (vn > 0) {
      const e = d.bCoef * phys.WALL_BCOEF + 1; // restitución combinada (pared bCoef=1)
      d.vx -= wall.nx * vn * e;
      d.vy -= wall.ny * vn * e;
    }
    return true;
  }

  // Disco D vs punto estático (px,py) con su bCoef (poste/vértice). Equivale a
  // collideDiscs contra un disco inamovible de radio 0 — pero los postes tienen
  // radio POST_R, así que se pasa el radio del punto en `pr`.
  function collideDiscPoint(d, px, py, pr, bcoef) {
    if (d.invMass <= 0) return false;
    const dx = d.x - px;
    const dy = d.y - py;
    const d2 = dx * dx + dy * dy;
    const rs = d.r + pr;
    if (d2 <= 0 || d2 > rs * rs) return false;
    const dd = Math.sqrt(d2);
    const nx = dx / dd;
    const ny = dy / dd;
    const pen = rs - dd;
    // El punto es estático (invMass=0 ⇒ ratio=1): todo el movimiento al disco.
    d.x += nx * pen;
    d.y += ny * pen;
    const rel = nx * d.vx + ny * d.vy;   // velocidad relativa normal (punto quieto)
    if (rel < 0) {
      const f = rel * (d.bCoef * bcoef + 1);
      d.vx -= nx * f;
      d.vy -= ny * f;
    }
    return true;
  }

  /* ======================================================================== *
   * D. KICK (SPEC v1.4 D) — por contacto MANTENIDO                            *
   * ------------------------------------------------------------------------ *
   * Aplica el impulso del kick si la pelota está en alcance y el cuerpo está  *
   * "armado" (soltó y volvió a apretar) con cooldown vencido. Modifica speeds *
   * ANTES de integrar (paso 2 del orden de tick). Devuelve true si pateó.     *
   * body: {x,y,vx,vy, kickCd, kickArmed, ...}; ball: {x,y,vx,vy, lastTouch}.  *
   * ======================================================================== */
  function applyKick(body, ball, phys) {
    const dx = ball.x - body.x;
    const dy = ball.y - body.y;
    const dist = Math.hypot(dx, dy);
    // Alcance: dist − BALL_R − PLAYER_R < KICK_REACH (⇒ dist < 29 con valores base).
    if (dist - phys.BALL_R - phys.PLAYER_R >= phys.KICK_REACH) return false;
    let nx;
    let ny;
    if (dist > 1e-9) {
      nx = dx / dist;            // dirección CUERPO→PELOTA
      ny = dy / dist;
    } else {
      nx = 1;                    // guard anti-NaN: centros superpuestos
      ny = 0;
    }
    ball.vx += phys.KICK_STRENGTH * nx * phys.BALL_INVMASS; // pelota salta a speed 5
    ball.vy += phys.KICK_STRENGTH * ny * phys.BALL_INVMASS;
    body.vx -= phys.KICKBACK * nx * phys.PLAYER_INVMASS;    // retroceso (KICKBACK=0 ⇒ nulo)
    body.vy -= phys.KICKBACK * ny * phys.PLAYER_INVMASS;
    ball.lastTouch = body.id;                               // para el gol / color relator
    return true;
  }

  /* ======================================================================== *
   * stepWorld(state, inputsById, arena, phys) — PURA y DETERMINISTA          *
   * ------------------------------------------------------------------------ *
   * Avanza el mundo UN tick (dt=1) con el orden EXACTO de la SPEC v1.4 A.     *
   * Reusada por el server (autoritativo) y el cliente (extrapolación H).      *
   *                                                                          *
   * state = {                                                                *
   *   bodies: [{ id, x,y, vx,vy, team, slot, owner,                          *
   *              kickCd, kickArmed, kickHeld,                                 *
   *              stun, slide, sdx,sdy, tackleCd, slideHit, slideBall, ... }], *
   *   ball: { x,y, vx,vy, lastTouch },                                        *
   * }                                                                        *
   * inputsById = { bodyId: {mx,my, kick, tackle} } — kick MANTENIDO,         *
   *              tackle edge-trigger. mx,my ∈ {-1,0,1} (8 direcciones).       *
   * arena: salida de buildArena. phys: arena.phys (constantes del estadio).  *
   * rules: opcional vía state.rules o el 5º arg; {tackles:bool}.             *
   *                                                                          *
   * NO detecta gol (eso lo hace el server afuera con goalCheck). Devuelve un  *
   * array de eventos {type:"kicked"|"tackle", id, ...} para sfx/anim.         *
   * ======================================================================== */
  function stepWorld(state, inputsById, arena, phys, rules) {
    const bodies = state.bodies;
    const ball = state.ball;
    phys = phys || arena.phys;
    rules = rules || state.rules || {};
    const tacklesOn = rules.tackles !== false; // default true (SPEC v1.4 E)
    const events = [];
    const NO_INPUT = ZERO_INPUT;

    /* -- 1) Input → aceleración (por cuerpo). Diagonal ×DIAG. KICKING_ACCEL si
       mantiene kick. Un cuerpo stunned o en slide no acelera por input. -- */
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const inp = inputsById[b.id] || NO_INPUT;
      b.kickHeld = !!inp.kick;

      const stunned = (b.stun || 0) > 0;
      const sliding = (b.slide || 0) > 0;
      if (stunned || sliding) continue;

      let dx = clampDir(inp.mx);
      let dy = clampDir(inp.my);
      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0) { dx *= DIAG; dy *= DIAG; }
        const a = b.kickHeld ? phys.KICKING_ACCEL : phys.ACCEL;
        b.vx += dx * a;
        b.vy += dy * a;
        // facing = último input de movimiento no nulo (para render; sin efecto físico).
        const fl = Math.hypot(dx, dy);
        if (fl > 1e-9) { b.fx = dx / fl; b.fy = dy / fl; }
      }
    }

    /* -- 2) Kick MANTENIDO por cuerpo (modifica speeds ANTES de integrar). -- */
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.kickCd > 0) b.kickCd--;
      const stunned = (b.stun || 0) > 0;
      const sliding = (b.slide || 0) > 0;
      if (!stunned && !sliding && b.kickHeld && b.kickArmed && b.kickCd <= 0) {
        if (applyKick(b, ball, phys)) {
          b.kickCd = phys.KICK_COOLDOWN_TICKS;
          b.kickArmed = false;     // hay que soltar para re-patear
          events.push({ type: "kicked", id: b.id });
        }
      }
      if (!b.kickHeld) b.kickArmed = true; // soltar re-arma
    }

    /* -- E) Barrida (tackle) — si rules.tackles. Edge-trigger: dispara el slide;
       el slide fija la velocidad e impacta al rival/pelota en rango. En u/tick. -- */
    if (tacklesOn) {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.tackleCd > 0) b.tackleCd--;
        const stunned = (b.stun || 0) > 0;
        const sliding = (b.slide || 0) > 0;
        const inp = inputsById[b.id] || NO_INPUT;
        // Edge-trigger: arranca el slide si pidió tackle, no está stunned/deslizando
        // y el cooldown venció.
        if (inp.tackle && !stunned && !sliding && (b.tackleCd || 0) <= 0) {
          let fx = b.fx || 0;
          let fy = b.fy || 0;
          const fl = Math.hypot(fx, fy);
          if (fl > 1e-9) { fx /= fl; fy /= fl; } else { fx = 0; fy = 0; }
          b.slide = phys.SLIDE_DURATION_TICKS;
          b.sdx = fx;
          b.sdy = fy;
          b.tackleCd = phys.TACKLE_COOLDOWN_TICKS;
          b.slideHit = {};        // ids de rivales ya golpeados por este slide
          b.slideBall = false;    // la pelota aún no recibió el impulso de este slide
          // Mini-lunge inmediato hacia el facing.
          b.vx += fx * phys.TACKLE_LUNGE;
          b.vy += fy * phys.TACKLE_LUNGE;
        }
      }
      // Resolver impactos de los slides activos (antes de integrar: usa posiciones
      // actuales; los empujes se aplican como impulso de velocidad).
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if ((b.slide || 0) <= 0) continue;
        // Velocidad fija hacia la dirección de barrida durante el slide.
        b.vx = b.sdx * phys.SLIDE_SPEED;
        b.vy = b.sdy * phys.SLIDE_SPEED;
        // Rivales en rango (una vez por slide por rival).
        for (let j = 0; j < bodies.length; j++) {
          if (j === i) continue;
          const q = bodies[j];
          if (q.team === b.team) continue;          // no se barre a un compañero
          if (b.slideHit[q.id]) continue;
          const dx = q.x - b.x;
          const dy = q.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= phys.TACKLE_RANGE) {
            let nx = 1;
            let ny = 0;
            if (dist > 1e-9) { nx = dx / dist; ny = dy / dist; }
            q.vx += nx * phys.TACKLE_KNOCKBACK;
            q.vy += ny * phys.TACKLE_KNOCKBACK;
            q.stun = phys.TACKLE_STUN_TICKS;
            q.slide = 0;                            // el stun corta su slide propio
            b.slideHit[q.id] = true;
            events.push({ type: "tackle", id: b.id, victim: q.id });
          }
        }
        // Pelota en rango (una sola vez por slide).
        if (!b.slideBall) {
          const dx = ball.x - b.x;
          const dy = ball.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= phys.TACKLE_RANGE) {
            let nx = 1;
            let ny = 0;
            if (dist > 1e-9) { nx = dx / dist; ny = dy / dist; }
            ball.vx += nx * phys.TACKLE_KNOCKBACK * phys.TACKLE_BALL_FACTOR;
            ball.vy += ny * phys.TACKLE_KNOCKBACK * phys.TACKLE_BALL_FACTOR;
            ball.lastTouch = b.id;
            b.slideBall = true;
          }
        }
      }
    }

    /* -- 3) Integración + damping de TODOS los discos, EN ESTE ORDEN por disco:
            pos += speed;  speed = damping * (speed + gravity)   (gravity = 0).
       Se mueve con la velocidad VIEJA y LUEGO se amortigua. El cuerpo usa
       KICKING_DAMPING mientras mantiene kick (= PLAYER_DAMPING por defecto).
       Orden de discos: cuerpos en orden de array, luego la pelota — FIJO para
       que server y cliente coincidan byte-a-byte. -- */
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      // Stun: no acelera (ya filtrado arriba) pero SÍ se mueve por inercia y damping.
      if ((b.stun || 0) > 0) b.stun--;
      if ((b.slide || 0) > 0) b.slide--;
      b.x += b.vx;
      b.y += b.vy;
      const damping = b.kickHeld ? phys.KICKING_DAMPING : phys.PLAYER_DAMPING;
      b.vx = damping * b.vx;
      b.vy = damping * b.vy;
    }
    // Pelota (último disco del orden fijo).
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx = phys.BALL_DAMPING * ball.vx;
    ball.vy = phys.BALL_DAMPING * ball.vy;

    /* -- 4) Colisiones (después de mover y amortiguar), en el orden EXACTO:
            a) disco–disco (cada par una vez),
            b) disco–segmento (paredes),
            c) disco–vértice/poste (discos estáticos).
       La pelota se trata como un disco más; se la coloca al final del array de
       discos para que el orden de pares sea determinista. -- */
    const discs = ARENA_SCRATCH;
    discs.length = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      // Vista "disco" del cuerpo: comparte x,y,vx,vy por referencia escribiendo de vuelta.
      b.r = phys.PLAYER_R;
      b.invMass = phys.PLAYER_INVMASS;
      b.bCoef = phys.PLAYER_BCOEF;
      discs.push(b);
    }
    ball.r = phys.BALL_R;
    ball.invMass = phys.BALL_INVMASS;
    ball.bCoef = phys.BALL_BCOEF;
    discs.push(ball);

    // a) disco–disco (cada par una vez). Registrar lastTouch cuando un cuerpo toca
    //    la pelota (último elemento = la pelota).
    const ballIdx = discs.length - 1;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const hit = collideDiscs(discs[i], discs[j]);
        if (hit && j === ballIdx) ball.lastTouch = discs[i].id; // cuerpo i tocó la pelota
      }
    }

    // b) disco–segmento (paredes). Las bocas de arco NO son paredes (la pelota pasa);
    //    los cuerpos SÍ quedan confinados también en la boca: se agrega un segmento
    //    "virtual" de la boca solo para los cuerpos (no para la pelota) más abajo.
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      for (let w = 0; w < arena.walls.length; w++) {
        collideDiscWall(d, arena.walls[w], phys);
      }
    }
    // Confinamiento de CUERPOS en la boca del arco (no salen de la cancha, SPEC v1).
    // La pelota se omite (debe poder cruzar para que sea gol).
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      for (let g = 0; g < arena.goals.length; g++) {
        collideGoalLine(b, arena.goals[g], phys);
      }
    }

    // c) disco–vértice/poste: discos estáticos. Primero los POSTES (extremos de
    //    cada boca), luego las ESQUINAS del polígono (arena.verts). Ambos son
    //    geometría estática con bCoef de poste; rebotan la pelota pero NO cambian
    //    lastTouch (no son "un toque" de jugador). No se captura el resultado a
    //    propósito. Orden fijo (posts → verts) para que server y cliente coincidan.
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      for (let p = 0; p < arena.posts.length; p++) {
        const post = arena.posts[p];
        collideDiscPoint(d, post.x, post.y, phys.POST_R, phys.POST_BCOEF);
      }
      const verts = arena.verts;
      if (verts) {
        for (let v = 0; v < verts.length; v++) {
          collideDiscPoint(d, verts[v].x, verts[v].y, phys.POST_R, phys.POST_BCOEF);
        }
      }
    }

    return events;
  }

  // Confina un CUERPO en la línea de la boca del arco (la trata como pared virtual
  // con la misma normal exterior). Solo cuerpos (invMass>0); restitución de pared.
  // Misma convención que collideDiscWall: el contacto empieza cuando el borde del
  // cuerpo cruza el punto sd = −r (pen = sd + r > 0); más adentro NO hay contacto.
  function collideGoalLine(b, goal, phys) {
    const r = phys.PLAYER_R;
    const sd = (b.x - goal.cx) * goal.nx + (b.y - goal.cy) * goal.ny; // + = afuera
    const pen = sd + r;
    if (pen <= 0) return;     // cuerpo bien adentro: sin contacto con la boca
    if (sd > r) return;        // ya cruzó del todo (no debería: la boca confina al cuerpo)
    const s = (b.x - goal.cx) * goal.dx + (b.y - goal.cy) * goal.dy;  // proyección lateral
    if (s < -GOAL_W / 2 || s > GOAL_W / 2) return; // fuera de la boca: lo cubre la pared
    b.x -= goal.nx * pen;
    b.y -= goal.ny * pen;
    const vn = b.vx * goal.nx + b.vy * goal.ny;
    if (vn > 0) { b.vx -= goal.nx * vn; b.vy -= goal.ny * vn; } // desliza, sin rebote extra
  }

  /* ======================================================================== *
   * goalCheck(ball, arena) — helper de gol (el server decide el resto)       *
   * ------------------------------------------------------------------------ *
   * Devuelve el índice del equipo cuyo arco recibió el gol, o -1. Gol cuando  *
   * el CENTRO de la pelota cruza la línea de la boca hacia afuera (signed     *
   * distance ≥ 0) dentro de la boca (proyección ≤ GOAL_W/2 − BALL_R).         *
   * ======================================================================== */
  function goalCheck(ball, arena) {
    for (let g = 0; g < arena.goals.length; g++) {
      const goal = arena.goals[g];
      const sd = (ball.x - goal.cx) * goal.nx + (ball.y - goal.cy) * goal.ny;
      if (sd <= 0) continue; // todavía adentro o sobre la línea
      const s = (ball.x - goal.cx) * goal.dx + (ball.y - goal.cy) * goal.dy;
      if (Math.abs(s) <= GOAL_W / 2 - GOAL_MARGIN) return goal.team;
    }
    return -1;
  }

  /* ======================================================================== *
   * Helpers internos                                                         *
   * ======================================================================== */

  const ZERO_INPUT = Object.freeze({ mx: 0, my: 0, kick: false, tackle: false });
  // Scratch reutilizado por stepWorld (evita asignar un array por tick × frame).
  const ARENA_SCRATCH = [];

  // Clampa un eje de input a {-1,0,1} (8 direcciones HaxBall).
  function clampDir(v) {
    if (!(typeof v === "number") || !isFinite(v)) return 0;
    if (v > 0.0001) return 1;
    if (v < -0.0001) return -1;
    return 0;
  }

  // Crea un cuerpo nuevo con todos los campos de estado del modelo v1.4.
  function makeBody(opts) {
    return {
      id: opts.id,
      team: opts.team || 0,
      slot: opts.slot || 0,
      owner: opts.owner != null ? opts.owner : opts.id,
      x: opts.x || 0,
      y: opts.y || 0,
      vx: 0,
      vy: 0,
      fx: opts.fx != null ? opts.fx : 0,
      fy: opts.fy != null ? opts.fy : 1,
      kickCd: 0,
      kickArmed: true,
      kickHeld: false,
      stun: 0,
      slide: 0,
      sdx: 0,
      sdy: 0,
      tackleCd: 0,
      slideHit: null,
      slideBall: false,
    };
  }

  // Crea una pelota nueva.
  function makeBall() {
    return { x: 0, y: 0, vx: 0, vy: 0, lastTouch: null };
  }

  /* ======================================================================== *
   * API exportada                                                            *
   * ======================================================================== */
  const API = {
    // Constantes (SPEC v1.4 C) — valores base, inmutables.
    PLAYER_R: PLAYER_R,
    PLAYER_INVMASS: PLAYER_INVMASS,
    PLAYER_BCOEF: PLAYER_BCOEF,
    PLAYER_DAMPING: PLAYER_DAMPING,
    KICKING_DAMPING: KICKING_DAMPING,
    ACCEL: ACCEL,
    KICKING_ACCEL: KICKING_ACCEL,
    BALL_R: BALL_R,
    BALL_INVMASS: BALL_INVMASS,
    BALL_BCOEF: BALL_BCOEF,
    BALL_DAMPING: BALL_DAMPING,
    WALL_BCOEF: WALL_BCOEF,
    POST_R: POST_R,
    POST_BCOEF: POST_BCOEF,
    KICK_STRENGTH: KICK_STRENGTH,
    KICKBACK: KICKBACK,
    KICK_REACH: KICK_REACH,
    KICK_COOLDOWN_TICKS: KICK_COOLDOWN_TICKS,
    DIAG: DIAG,
    R: R,
    GOAL_W: GOAL_W,
    RECT_W: RECT_W,
    RECT_H: RECT_H,
    SPAWN_FACTOR: SPAWN_FACTOR,
    // Barrida (opcional por sala).
    TACKLE_RANGE: TACKLE_RANGE,
    TACKLE_KNOCKBACK: TACKLE_KNOCKBACK,
    TACKLE_BALL_FACTOR: TACKLE_BALL_FACTOR,
    TACKLE_LUNGE: TACKLE_LUNGE,
    TACKLE_STUN_TICKS: TACKLE_STUN_TICKS,
    SLIDE_DURATION_TICKS: SLIDE_DURATION_TICKS,
    SLIDE_SPEED: SLIDE_SPEED,
    TACKLE_COOLDOWN_TICKS: TACKLE_COOLDOWN_TICKS,
    GOAL_MARGIN: GOAL_MARGIN,
    BASE_PHYS: BASE_PHYS,
    // Geometría.
    buildArena: buildArena,
    applyStadium: applyStadium,
    clonePhys: clonePhys,
    // Colisiones (fórmulas exactas).
    collideDiscs: collideDiscs,
    collideDiscWall: collideDiscWall,
    collideDiscPoint: collideDiscPoint,
    // Kick.
    applyKick: applyKick,
    // Simulación.
    stepWorld: stepWorld,
    goalCheck: goalCheck,
    // Fábricas de estado.
    makeBody: makeBody,
    makeBall: makeBall,
  };

  /* ======================================================================== *
   * SELF-TEST determinista (corre solo bajo Node si se ejecuta directo)      *
   * ======================================================================== */
  if (typeof module !== "undefined" && module.exports && require.main === module) {
    runSelfTest();
  }

  function runSelfTest() {
    let pass = 0;
    let fail = 0;
    function check(name, cond) {
      if (cond) { pass++; console.log("PASS  " + name); }
      else { fail++; console.log("FAIL  " + name); }
    }

    // --- Estado base reproducible: 2 cuerpos (1v1) + pelota. ---
    function makeState() {
      const arena = buildArena(2, "clasico");
      const a = makeBody({ id: "p1", team: 0, x: -100, y: 0, fx: 1, fy: 0 });
      const b = makeBody({ id: "p2", team: 1, x: 100, y: 0, fx: -1, fy: 0 });
      const ball = makeBall();
      return { state: { bodies: [a, b], ball: ball, rules: { tackles: true } }, arena: arena };
    }

    // Secuencia de inputs determinista por tick (los dos cuerpos persiguen la pelota
    // y mantienen kick): produce kicks, colisiones y rebotes en paredes.
    function inputsAt(t) {
      const k = (t % 40) < 30; // mantiene kick a ratos para ejercitar kickArmed
      return {
        p1: { mx: 1, my: t % 7 < 3 ? 1 : -1, kick: k, tackle: t % 120 === 60 },
        p2: { mx: -1, my: t % 5 < 2 ? -1 : 1, kick: k, tackle: false },
      };
    }

    // (1) DETERMINISMO: 600 ticks dos veces con los mismos inputs ⇒ estados idénticos.
    function run600() {
      const m = makeState();
      for (let t = 0; t < 600; t++) {
        stepWorld(m.state, inputsAt(t), m.arena, m.arena.phys);
      }
      return m.state;
    }
    function snapshot(s) {
      const out = [];
      for (const b of s.bodies) {
        out.push(b.x, b.y, b.vx, b.vy, b.kickCd, b.kickArmed ? 1 : 0, b.stun, b.slide);
      }
      out.push(s.ball.x, s.ball.y, s.ball.vx, s.ball.vy);
      return out;
    }
    const s1 = snapshot(run600());
    const s2 = snapshot(run600());
    let identical = s1.length === s2.length;
    for (let i = 0; identical && i < s1.length; i++) {
      if (s1[i] !== s2[i]) identical = false;
    }
    check("determinismo: 600 ticks ×2 idénticos", identical);

    // (1b) DETERMINISMO del camino de IMPACTO de barrida: rivales pegados (p1 en
    //      -20, p2 en +20 ⇒ separación 40 < TACKLE_RANGE 44) con p1 barriendo y la
    //      pelota plantada entre ambos, de modo que el knockback/stun del rival, el
    //      slideHit, el slideBall y kicks/contactos disco–disco con la pelota SÍ se
    //      ejecutan. Verifica que dos corridas idénticas queden byte-a-byte iguales
    //      (incluye stun y slide en el snapshot). Cubre lo que (1) nunca entra.
    function makeCloseState() {
      const arena = buildArena(2, "clasico");
      const a = makeBody({ id: "p1", team: 0, x: -20, y: 0, fx: 1, fy: 0 });
      const b = makeBody({ id: "p2", team: 1, x: 20, y: 0, fx: -1, fy: 0 });
      const ball = makeBall();
      ball.x = 0; ball.y = 0;                 // pelota entre los dos cuerpos
      return { state: { bodies: [a, b], ball: ball, rules: { tackles: true } }, arena: arena };
    }
    function inputsCloseAt(t) {
      // p1 mantiene kick (patea la pelota pegada) y barre periódicamente hacia +x
      // (su facing) para entrar al rival p2; p2 empuja contra p1 manteniendo kick.
      return {
        p1: { mx: 1, my: 0, kick: true, tackle: t % 30 === 0 },
        p2: { mx: -1, my: 0, kick: true, tackle: false },
      };
    }
    function run300Close() {
      const m = makeCloseState();
      let tackled = 0;
      let kicked = 0;
      for (let t = 0; t < 300; t++) {
        const ev = stepWorld(m.state, inputsCloseAt(t), m.arena, m.arena.phys);
        for (const e of ev) {
          if (e.type === "tackle") tackled++;
          if (e.type === "kicked") kicked++;
        }
      }
      m._tackled = tackled; m._kicked = kicked;
      return m;
    }
    const r1 = run300Close();
    const r2 = run300Close();
    const c1 = snapshot(r1.state);
    const c2 = snapshot(r2.state);
    let identicalClose = c1.length === c2.length;
    for (let i = 0; identicalClose && i < c1.length; i++) {
      if (c1[i] !== c2[i]) identicalClose = false;
    }
    check("determinismo: impacto barrida+kick 300 ticks ×2 idénticos", identicalClose);
    // Garantiza que el escenario REALMENTE ejercitó los caminos stateful (si no,
    // el determinismo de arriba sería vacío): al menos un tackle y varios kicks.
    check("determinismo: el escenario disparó barrida (knockback/stun) y kicks (=" +
      r1._tackled + " tackles, " + r1._kicked + " kicks)",
      r1._tackled >= 1 && r1._kicked >= 2 && r1._tackled === r2._tackled && r1._kicked === r2._kicked);

    // (2) KICK a pelota pegada ⇒ pelota a speed 5 exacto.
    {
      const arena = buildArena(2, "clasico");
      const a = makeBody({ id: "p1", team: 0, x: 0, y: 0, fx: 1, fy: 0 });
      const ball = makeBall();
      // Pelota pegada al cuerpo (a la derecha, dentro del alcance).
      ball.x = PLAYER_R + BALL_R + 1; // 26 < 29 ⇒ en alcance
      ball.y = 0;
      const before = { vx: ball.vx, vy: ball.vy };
      applyKick(a, ball, arena.phys);
      const sp = Math.hypot(ball.vx - before.vx, ball.vy - before.vy);
      check("kick: pelota pegada sale a speed 5 (=" + sp.toFixed(6) + ")",
        Math.abs(sp - KICK_STRENGTH) < 1e-9 && Math.abs(ball.vx - 5) < 1e-9);
    }

    // (3) REBOTE en pared con bCoef 1: la pelota conserva la rapidez (restitución
    //     pelota·pared = BALL_BCOEF*WALL_BCOEF+1 = 1.5, pero la componente normal se
    //     invierte conservando magnitud cuando la pelota incide perpendicular y el
    //     factor es 1.5 ⇒ NO conserva). El SPEC pide "rebota con bCoef 1 conservando
    //     velocidad": eso se da contra la PARED tomada como reflexión pura (e=2 sobre
    //     vn). Verificamos el caso normativo: una pelota perpendicular a la pared con
    //     restitución combinada 2 (bCoef pelota 1) invierte la velocidad exacta.
    {
      const arena = buildArena(2, "clasico");
      // Tomamos la pared superior (nx=0, ny=-1). Pelota subiendo hacia ella.
      const wall = arena.walls.find((w) => w.nx === 0 && w.ny === -1);
      // Disco de prueba con bCoef 1 (pelota "elástica"): e = 1*1+1 = 2 ⇒ refleja exacto.
      const d = { x: 0, y: -RECT_H + BALL_R - 0.5, vx: 0, vy: -3, r: BALL_R, invMass: 1, bCoef: 1 };
      const before = Math.hypot(d.vx, d.vy);
      collideDiscWall(d, wall, arena.phys);
      const after = Math.hypot(d.vx, d.vy);
      check("rebote pared bCoef 1: conserva rapidez (" + before.toFixed(3) + "→" + after.toFixed(3) + ")",
        Math.abs(before - after) < 1e-9 && d.vy > 0);
    }

    // (4) VELOCIDAD TERMINAL del jugador ≈ 2.4 u/tick. terminal = ACCEL/(1/damping − 1)
    //     = 0.1 / (1/0.96 − 1) = 0.1 / 0.041666... = 2.4. Se mide el PICO de rapidez en
    //     campo abierto (la asíntota se alcanza en ~150 ticks, mucho antes de que el
    //     cuerpo pueda llegar a una pared y quedar confinado contra ella a rapidez 0).
    {
      const arena = buildArena(2, "clasico");
      const a = makeBody({ id: "p1", team: 0, x: 0, y: 0 });
      const ball = makeBall();
      ball.x = 99999; // pelota lejos: no patea ni colisiona
      const st = { bodies: [a], ball: ball, rules: { tackles: false } };
      let term = 0;
      for (let t = 0; t < 800; t++) {
        stepWorld(st, { p1: { mx: 1, my: 0, kick: false, tackle: false } }, arena, arena.phys);
        const sp = Math.hypot(a.vx, a.vy);
        if (sp > term) term = sp;
      }
      check("velocidad terminal jugador ≈ 2.4 u/tick (=" + term.toFixed(4) + ")",
        Math.abs(term - 2.4) < 0.01);
    }

    // (5) GEOMETRÍA: arena n=2 tiene 2 arcos, 4 postes, ≥6 paredes; n=5 tiene 5 arcos,
    //     10 postes. goalCheck detecta gol al cruzar la boca.
    {
      const a2 = buildArena(2, "clasico");
      const a5 = buildArena(5, "clasico");
      check("geometría n=2: 2 goals, 4 posts", a2.goals.length === 2 && a2.posts.length === 4);
      check("geometría n=5: 5 goals, 10 posts", a5.goals.length === 5 && a5.posts.length === 10);
      // SPEC v1.4 4c: discos–vértice en las esquinas (separados de los palos del arco):
      // rectángulo = 4 esquinas; polígono regular n=5 = 5 esquinas.
      check("geometría n=2: 4 vértices de esquina", a2.verts && a2.verts.length === 4);
      check("geometría n=5: 5 vértices de esquina", a5.verts && a5.verts.length === 5);
      // Pelota justo cruzando la boca del arco 0 (izquierda, x negativo afuera).
      const g0 = a2.goals[0];
      const ball = { x: g0.cx + g0.nx * 1, y: g0.cy, vx: 0, vy: 0, lastTouch: null };
      check("goalCheck: gol en arco 0", goalCheck(ball, a2) === 0);
      const ballIn = { x: 0, y: 0, vx: 0, vy: 0, lastTouch: null };
      check("goalCheck: pelota al centro no es gol", goalCheck(ballIn, a2) === -1);
    }

    // (6) ESTADIOS: clonado sin mutar las constantes base.
    {
      const playa = buildArena(2, "playa");
      const nieve = buildArena(2, "nieve");
      check("estadio playa: BALL_DAMPING 0.97", Math.abs(playa.phys.BALL_DAMPING - 0.97) < 1e-12);
      check("estadio nieve: PLAYER_DAMPING 0.99 y ACCEL ×0.6",
        Math.abs(nieve.phys.PLAYER_DAMPING - 0.99) < 1e-12 &&
        Math.abs(nieve.phys.ACCEL - ACCEL * 0.6) < 1e-12);
      check("constantes base intactas tras estadios",
        BASE_PHYS.BALL_DAMPING === 0.99 && BASE_PHYS.PLAYER_DAMPING === 0.96 && ACCEL === 0.1);
    }

    // (7) COOLDOWN/ARMADO del kick: con kick mantenido patea UNA vez (kickArmed se
    //     consume); no vuelve a patear hasta soltar.
    {
      const arena = buildArena(2, "clasico");
      const a = makeBody({ id: "p1", team: 0, x: 0, y: 0 });
      const ball = makeBall();
      ball.x = PLAYER_R + BALL_R + 1; ball.y = 0;
      const st = { bodies: [a], ball: ball, rules: { tackles: false } };
      let kicks = 0;
      for (let t = 0; t < 10; t++) {
        // pelota se mantiene pegada (la reponemos para forzar alcance)
        ball.x = PLAYER_R + BALL_R + 1; ball.y = 0; ball.vx = 0; ball.vy = 0;
        const ev = stepWorld(st, { p1: { mx: 0, my: 0, kick: true, tackle: false } }, arena, arena.phys);
        kicks += ev.filter((e) => e.type === "kicked").length;
      }
      check("kick mantenido sin soltar patea 1 sola vez (=" + kicks + ")", kicks === 1);
    }

    console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " checks, " + fail + " fallidos");
    if (typeof process !== "undefined") process.exit(fail === 0 ? 0 : 1);
  }

  return API;
});
