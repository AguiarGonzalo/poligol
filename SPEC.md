# PoliGol — Especificación técnica (CONTRATO entre módulos)

Juego web de fútbol multijugador online en tiempo real. Cada jugador elige una selección
(país + bandera), entra a una sala de espera, y al iniciar el partido se dibuja una cancha
poligonal con **un arco por jugador** (3 jugadores = triángulo, 4 = cuadrado, ... hasta 8).
La pelota cae en el medio. Metés un gol: +1 punto. Te meten un gol: −1 punto.
Gana el primero que llega a **3 puntos**.

Este documento es el ÚNICO contrato. Server y cliente se escriben por separado y DEBEN
respetar exactamente los nombres de mensajes, campos, constantes, fórmulas y IDs de DOM
definidos acá. No inventar campos ni renombrar nada.

## Archivos

```
poligol/
  package.json        — name "poligol", script "start": "node server.js", dep: "ws": "^8.18.0"
  server.js           — Node.js (CommonJS). http estático + WebSocket (ws). Lógica autoritativa.
  public/index.html   — Pantallas: home, lobby, juego. Carga style.css y client.js.
  public/style.css    — Estética completa.
  public/client.js    — Conexión WS, render canvas, input teclado + táctil. Vanilla JS, sin deps.
```

El server sirve `public/` por http (sin Express: usar `http` + `fs` + `path`, con MIME types
correctos para .html/.css/.js) y monta `ws` sobre el mismo server http. Puerto:
`process.env.PORT || 3000`. Escuchar en `0.0.0.0`.

## Constantes compartidas (mismos valores en server y cliente)

```js
const R = 380;              // circunradio del polígono (unidades de mundo)
const PLAYER_R = 14;        // radio del jugador
const BALL_R = 10;          // radio de la pelota
const GOAL_W = 112;         // ancho del arco = 4 × diámetro del jugador (4 × 28)
const WIN_SCORE = 3;        // puntaje objetivo
const TICK = 1/60;          // física del server a 60 Hz
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
const TACKLE_STUN = 0.9;    // s que el rival queda tirado (no puede moverse ni accionar)
const TACKLE_COOLDOWN = 1.6;  // s
const GOAL_PAUSE = 2.0;     // s de pausa tras un gol antes de resetear
```

## Geometría de la cancha

Coordenadas de mundo centradas en (0,0). `n` = cantidad de jugadores al iniciar el partido
(fijo durante todo el partido).

**n ≥ 3 (polígono regular):**
- Vértice k (k = 0..n−1): `angle_k = -PI/2 + 2*PI*k/n`, `V_k = (R*cos(angle_k), R*sin(angle_k))`.
- Lado k: segmento de `V_k` a `V_{k+1 mod n}`. El lado k pertenece al jugador con índice k
  (índice = posición en el array `players` enviado en el mensaje `start`).
- Punto medio del lado: `M_k = (V_k + V_{k+1})/2`. Normal interior: `-M_k/|M_k|` (apunta al centro).
- **Arco k**: segmento de ancho `GOAL_W` centrado en `M_k` sobre la dirección del lado.
  El resto del lado es pared sólida.

**n = 2 (rectángulo):** half-extents W=480, H=290 (cancha de 960×580). Arco del jugador 0
centrado en la pared `x=-480`, arco del jugador 1 en `x=+480`, ambos verticales de ancho
`GOAL_W`. Las 4 paredes rebotan salvo las bocas de arco.

**Spawns:** jugador k aparece en `0.62 * M_k` (entre el centro y su arco), para n=2:
`(∓0.62*480, 0)` (jugador 0 a la izquierda). Pelota siempre en (0,0) con velocidad 0.

**Colisiones:**
- Jugadores: confinados dentro del polígono (deslizan contra paredes, también en la boca del
  arco: el jugador NO sale de la cancha). Colisión círculo-círculo entre jugadores (se empujan).
- Pelota: rebota en paredes con `WALL_BOUNCE`. Pelota vs jugador: colisión círculo-círculo,
  la pelota recibe el empuje (el jugador "lleva" la pelota empujándola). Cada contacto o
  patada registra `lastTouch = playerId`.
- **Gol:** el centro de la pelota cruza la línea del lado k dentro del segmento del arco
  (proyección sobre el lado a distancia ≤ GOAL_W/2 − un margen de BALL_R del centro del arco)
  hacia afuera del polígono. Al detectar gol la pelota desaparece (estado `paused`).

## Reglas

- Gol en el arco del jugador `victim`: `score[victim] -= 1`. Si `lastTouch` existe y
  `lastTouch !== victim`: `score[lastTouch] += 1` (gol en contra: solo resta, nadie suma).
- Los puntajes pueden ser negativos.
- Tras un gol: `GOAL_PAUSE` segundos de pausa (server manda evento `goal`), luego todos los
  jugadores vuelven a su spawn, pelota al centro, evento `kickoff`, sigue el juego.
- Si `score[alguien] >= WIN_SCORE` tras un gol: en vez de kickoff, evento `gameover`.
- Tras `gameover`, el host puede mandar `rematch`: resetea puntajes y posiciones y arranca
  de nuevo (evento `start` de vuelta a todos).
- Si un jugador se desconecta DURANTE el partido: el partido se aborta, todos vuelven al
  lobby (evento `lobby` con campo extra `notice: "Nombre se desconectó"`).
- Patada (kick): si la pelota está a ≤ KICK_RANGE del centro del jugador, la pelota sale a
  `KICK_POWER` en la dirección de apuntado del jugador (`facing` = último input de movimiento
  no nulo; si nunca se movió, hacia el centro de la cancha) + 35% de la velocidad del jugador.
- Barrida (tackle): afecta al rival más cercano a ≤ TACKLE_RANGE: knockback TACKLE_KNOCKBACK
  en dirección jugador→rival, stun TACKLE_STUN. Si la pelota también está en rango recibe un
  impulso de 0.5×TACKLE_KNOCKBACK. El que barre hace un mini-lunge (impulso 150 hacia facing).
  Un jugador stunned no puede moverse, patear ni barrer.

## Salas

- Sala identificada por código de 4 letras mayúsculas (sin 0/O/1/I ambiguos, usar A-Z sin O e I).
- `create` crea sala y te hace host. `join` con código te suma si la sala existe, no está
  llena (MAX_PLAYERS) y no hay partido en curso (si hay partido: error "Partido en curso").
- El host (primer jugador; si se va, hereda el siguiente en orden de llegada) es el único
  que puede mandar `startGame` (requiere ≥ MIN_PLAYERS) y `rematch`.
- País: string código ISO-2 mayúsculas (ej. "AR"). Dos jugadores PUEDEN elegir el mismo país.

## Protocolo WebSocket (JSON, un objeto por mensaje, campo `type`)

### Cliente → Server

```js
{type:"create", name:"Gonza", country:"AR"}
{type:"join",   name:"Leo",   country:"BR", room:"KQXZ"}
{type:"startGame"}                       // solo host, desde lobby
{type:"input", mx:0.7, my:-0.7, kick:true, tackle:false}
   // mx,my ∈ [-1,1] vector de movimiento (el server lo clampa y normaliza si |v|>1).
   // kick/tackle: true en el mensaje donde se presionó (edge-trigger). El server los
   // consume respetando cooldowns. El cliente manda input a ~30 Hz mientras juega
   // (y siempre inmediatamente cuando kick/tackle pasan a true).
{type:"rematch"}                         // solo host, tras gameover
{type:"leave"}                           // volver al home (el server lo saca de la sala)
```

### Server → Cliente

```js
{type:"joined", room:"KQXZ", playerId:"p3", hostId:"p1"}   // respuesta a create/join exitoso
{type:"error", message:"Sala no encontrada"}               // create/join/start inválido
{type:"lobby", players:[{id,name,country,isHost}], notice} // cada cambio en el lobby; notice opcional
{type:"start", config:{
   n: 3,
   players:[{id,name,country,score:0}],   // índice en este array = índice de lado/arco
   // geometría implícita: el cliente la deriva de n con las fórmulas de arriba
}}
{type:"state", ball:{x,y,vx,vy}, players:[{id,x,y,fx,fy,stun,kc}], scores:{p1:0,p2:-1}, paused:false}
   // 30 Hz. fx,fy = facing unitario. stun = s restantes (0 si no). kc = cooldown de kick
   // restante en s (para feedback visual). paused=true durante GOAL_PAUSE y tras gameover.
{type:"goal", scorerId:"p2"|null, victimId:"p1", ownGoal:false, scores:{...}}
{type:"kickoff"}                                            // fin de la pausa post-gol
{type:"gameover", winnerId:"p2", scores:{...}}
{type:"lobby", ...}                                         // también al abortar partido
```

IDs de jugador: `"p" + contador incremental` por sala. El server NUNCA confía en el cliente:
valida turnos de host, clampa inputs, aplica cooldowns server-side.

## Cliente — pantallas y DOM (IDs OBLIGATORIOS)

Tres pantallas como `<section>` dentro de `<main>`, se muestran/ocultan con la clase `hidden`:

- `#screen-home`: título del juego ("⚽ PoliGol"), input `#name-input` (placeholder "Tu nombre"),
  grilla de selecciones `#country-grid` (el cliente la puebla desde su lista COUNTRIES),
  botón `#btn-create` ("Crear sala"), input `#room-input` (4 letras, uppercase automático) +
  botón `#btn-join` ("Unirse"). Validación: nombre no vacío y país elegido.
- `#screen-lobby`: código de sala grande `#room-code-label` (clickeable → copia el link
  `location.origin + "?room=CODE"` al portapapeles), lista `#players-list` (bandera, nombre,
  badge "HOST"), botón `#btn-start` ("¡Empezar partido!") visible solo para el host y
  habilitado con ≥2 jugadores, botón `#btn-leave` ("Salir"). Si la URL tiene `?room=CODE`,
  el home pre-carga el código en `#room-input`.
- `#screen-game`: `<canvas id="game-canvas">` fullscreen, scoreboard `#scoreboard` (overlay
  superior: por jugador bandera + nombre corto + puntaje, resaltar al propio), controles
  táctiles `#touch-controls` con joystick `#touch-joystick` (zona izquierda) y botones
  `#btn-kick` ("⚽") y `#btn-tackle` ("🦵") (zona derecha) — visibles solo en pantallas táctiles
  (`@media (pointer: coarse)`), overlay central `#overlay` para mensajes (GOL, cuenta de
  kickoff, ganador) y botones de fin de partido `#btn-rematch` (solo host) y `#btn-exit`.

**COUNTRIES (en client.js):** lista de 24+ selecciones: code ISO-2, nombre en español, y
colores de camiseta `{c1, c2}` (primario/secundario, hex). Incluir al menos: AR, BR, UY, CL,
CO, MX, US, ES, FR, DE, IT, PT, GB (Inglaterra→usar "GB"), NL, BE, HR, JP, KR, SA, MA, NG,
SN, AU, CA. Bandera emoji derivada del código: convertir cada letra a Regional Indicator
(`String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)`).

**Input teclado:** WASD y flechas = mover. `Espacio` o `J` = patear. `Shift` o `K` = barrer.
**Input táctil:** joystick virtual (touch en mitad izquierda) → mx,my; botones kick/tackle.

**Render (canvas 2D, debe verse HERMOSO):**
- Loop con `requestAnimationFrame`. Canvas a `devicePixelRatio`. Escala: encajar el mundo
  (bounding del polígono + margen 70) centrado en la pantalla, manteniendo aspecto.
- Interpolación: bufferear los 2 últimos snapshots y renderizar 100 ms en el pasado,
  interpolando linealmente posiciones de pelota y jugadores (NUNCA dibujar el snapshot crudo).
- Fondo: gradiente oscuro de estadio con viñeta. Cancha: césped verde con franjas
  (clipear el polígono, franjas perpendiculares alternando dos verdes), borde de línea blanca
  gruesa semi-brillante, círculo central + punto central.
- Arcos: la boca del arco se pinta del color `c1` del dueño con glow (shadowBlur), red en
  zigzag o cuadrícula detrás de la línea, y la bandera emoji del dueño cerca de su arco.
- Jugadores: círculo con gradiente radial usando c1/c2 de su país, borde blanco, sombra
  elíptica debajo, bandera emoji pequeña encima y nombre debajo (el propio jugador con un
  anillo/halo distintivo). Stunned: jugador gris/rotado con estrellitas. Kick: anillo de
  onda expansiva breve. Facing: pequeña cuña/dirección visible.
- Pelota: blanca con pentágonos sugeridos (o gradiente + costuras), sombra, leve rotación
  según velocidad, trail/estela cuando va rápido.
- Efectos: al gol, partículas/confetti del color del que metió el gol + texto "¡GOL DE X!"
  enorme con animación; cuenta regresiva "3,2,1" en kickoff; al gameover, lluvia de confetti
  y overlay con bandera y nombre del campeón.
- Sonido (WebAudio sintetizado, sin archivos): blip al patear, golpe seco en barrida,
  "crowd cheer" sintético (ruido filtrado) al gol. Crear el AudioContext en el primer gesto
  del usuario. Todo opcional pero deseable.

**Estética general (style.css):** look premium tipo juego .io moderno: fondo oscuro
(#0a0f1e aprox), tipografía system-ui bold, acentos en verde césped y dorado, botones con
gradiente y hover con elevación, tarjetas con blur/glassmorphism, la grilla de países con
banderas grandes y selección con anillo dorado animado. Responsive (mobile-first para los
controles táctiles). Sin dependencias externas (NO Google Fonts, NO CDNs).

## Notas de implementación server

- Game loop por sala: `setInterval` a 60 Hz solo mientras la sala está en partido; broadcast
  cada 2 ticks (30 Hz). Limpiar intervalos al terminar/abortar.
- Física con integración Euler semi-implícita y los dampings exponenciales especificados.
- Validar todos los mensajes (try/catch en JSON.parse, chequear tipos y rangos).
- Heartbeat: `ws.ping()` cada 15 s, terminar conexiones que no respondan (patrón estándar de ws).
- Salas vacías se eliminan.
```
