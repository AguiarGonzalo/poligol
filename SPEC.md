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

---

# v1.1 — CAMBIOS (este bloque PISA al contrato v1 donde lo contradiga)

## Concepto clave: EQUIPOS

Todo el puntaje pasa a ser por EQUIPO. `teams` es un array; su índice (`team`) identifica
al equipo y al arco que defiende. **La geometría de v1 no cambia, pero `n` ahora es la
CANTIDAD DE EQUIPOS** (no de jugadores): n=2 → rectángulo, n≥3 → polígono regular.

- Modo `ffa` (todos contra todos): cada jugador es un equipo de 1. 2–8 jugadores.
- Modo `1v1`: exactamente 2 jugadores, un equipo cada uno, rectángulo.
- Modo `2v2`: exactamente 4 jugadores, 2 equipos de 2, rectángulo. Asignación automática
  alternada por orden de llegada; un jugador puede cambiar de equipo con `setTeam` si hay
  lugar (máx 2 por equipo). Spawns 2v2: compañeros en el x de spawn v1 y separados ±90 en y.
- `scores` pasa a ser un ARRAY de enteros alineado a `teams` (reemplaza el objeto por
  playerId). Reglas idénticas: +1 al equipo que mete, −1 al que recibe; gol en contra solo
  resta. Gana el primer EQUIPO que llega a WIN_SCORE (3). Si un compañero mete gol en el
  arco propio es gol en contra (solo resta al equipo).

## Salas públicas/privadas + READY

- `create` ahora es `{type:"create", name, country, visibility:"public"|"private", roomName}`
  — roomName ≤ 24 chars (sanitizar), default `"Sala de " + name`.
- `{type:"listRooms"}` (solo tiene sentido en home) → respuesta
  `{type:"rooms", rooms:[{code,roomName,hostName,count,max,mode,stadium}]}` — SOLO salas
  públicas, no llenas y no en partido. El cliente la pide al mostrar el home y cada 3 s
  mientras el home esté visible.
- Unirse a una sala pública = mismo `join` de v1 con el `code` que vino en la lista.
- `{type:"ready", ready:bool}` — cada jugador alterna su estado. `{type:"setMode", mode}`
  y `{type:"setStadium", stadium}` solo host. `{type:"setTeam", team}` cualquiera (validar
  cupo, solo en 2v2). Cambiar de modo resetea todos los ready y reasigna equipos.
- `lobby` pasa a ser `{type:"lobby", code, roomName, visibility, mode, stadium,
  players:[{id,name,country,isHost,ready,team}], notice?}`.
- **Auto-arranque**: cuando TODOS están ready y la cantidad cumple el modo (ffa 2–8,
  1v1 = 2, 2v2 = 4 con 2 y 2), el server manda `{type:"starting", in:3}` y arranca el
  partido 3 s después. Si alguien des-readya o se va antes: `{type:"startCancelled"}`.
  El botón "Empezar" del host de v1 DESAPARECE: se arranca solo por readies.
  `rematch` (host) tras gameover sigue igual pero vuelve AL LOBBY con readies reseteados
  (no arranca partido directo).

## Estadios

`stadium: "clasico"|"noche"|"playa"|"nieve"`. El server aplica multiplicadores de física:

| stadium | modificadores server |
|---------|---------------------|
| clasico | ninguno |
| noche   | ninguno (solo visual) |
| playa   | BALL_FRICTION ×1.8 (la arena frena la pelota) |
| nieve   | ACCEL ×0.55, FRICTION ×0.45, BALL_FRICTION ×0.5, WALL_BOUNCE 0.9 (resbaladizo) |

## Física v1.1 (server) — LO MÁS IMPORTANTE DEL JUEGO

- **Sub-steps**: la pelota integra su movimiento en 4 sub-pasos por tick (anti-tunneling).
- **Dribble assist**: si la pelota está a ≤ PLAYER_R+BALL_R+8 del jugador, él es el jugador
  MÁS CERCANO a la pelota y su velocidad > 40: fuerza suave de 400 u/s² sobre la pelota
  hacia el punto a 22 u adelante del jugador (dirección facing), velocidad relativa máx 260.
  Hace que llevar la pelota se sienta natural pero siga siendo robable.
- **Patada**: pelota sale a KICK_POWER (560) + 0.45 × velocidad del jugador.
- **Barrida**: el que barre entra en "slide" de 0.38 s (velocidad fija 320 hacia su facing,
  sin control de movimiento durante el slide), luego su cooldown normal. Si conecta a un
  rival en rango durante el slide: knockback 420 + stun 0.9 s; pelota en rango sale a 0.6×.
  El campo `slide` (s restantes, 0 si no) se agrega a cada jugador en `state`.
- **Rebote pelota-jugador**: restitución 0.4 + transferencia 0.8 de la velocidad del jugador.
- Guards anti-NaN en TODA normalización de vectores.

## Mensajes v1.1 (resumen de cambios)

```js
// C→S nuevos/cambiados:
{type:"create", name, country, visibility, roomName}
{type:"listRooms"}  {type:"ready", ready}  {type:"setMode", mode}
{type:"setStadium", stadium}  {type:"setTeam", team}
// S→C nuevos/cambiados:
{type:"rooms", rooms:[...]}
{type:"lobby", code, roomName, visibility, mode, stadium, players:[{id,name,country,isHost,ready,team}], notice?}
{type:"starting", in:3}   {type:"startCancelled"}
{type:"start", config:{mode, stadium, n, teams:[{players:["p1"], score:0}], players:[{id,name,country,team}]}}
   // n === teams.length; arco k pertenece al equipo k
{type:"state", ball, players:[{id,x,y,fx,fy,stun,kc,slide}], scores:[0,0], paused}
{type:"goal", scorerId|null, scorerTeam|null, concededTeam, ownGoal, scores}
{type:"gameover", winnerTeam, scores}
```

## Cliente — DOM NUEVO (IDs OBLIGATORIOS, se suman a los de v1)

- **Home**: lista de salas públicas `#rooms-list` (cada sala: nombre, host, jugadores
  count/max, modo, estadio, botón unirse; si está vacía, mensaje "No hay salas públicas —
  creá la tuya"), botón refrescar `#btn-refresh-rooms`, input `#room-name-input`
  (nombre de sala), radios `#vis-public` / `#vis-private` (default privada), botón
  engranaje `#btn-options` (también accesible desde lobby y juego).
- **Lobby**: `#lobby-room-name`, badge `#lobby-visibility-badge` ("Pública"/"Privada"),
  `#mode-select` y `#stadium-select` (selects; deshabilitados si no sos host; cambios del
  host se reflejan a todos vía lobby), `#teams-panel` (visible solo 1v1/2v2: dos columnas
  con los jugadores de cada equipo y botón `#btn-swap-team` "Cambiar de equipo"),
  botón grande toggle `#btn-ready` ("¡ESTOY LISTO! ✅" / "Esperá... ❌"), indicador ready
  por jugador en `#players-list` (clase `.ready` + ✅), `#btn-whatsapp` (estilo WhatsApp
  verde, ícono 📱; `href = "https://wa.me/?text=" + encodeURIComponent("⚽ ¡Sumate a mi
  partido de PoliGol! " + location.origin + "/?room=" + code)`, target="_blank"),
  `#btn-copy-link` (copia el mismo link), `#lobby-countdown` (muestra 3..2..1 con
  `starting`, se oculta con `startCancelled`).
- **Opciones**: modal `#options-modal` (abre/cierra con `.hidden`): volumen `#opt-sound`
  (range 0–100), relator `#opt-relator` (checkbox), efectos `#opt-fx` (select low/high —
  low reduce partículas/copos a la mitad), vibración `#opt-vibration` (checkbox, solo
  móvil), nombres visibles `#opt-names` (checkbox), botón `#btn-options-close`.
  Persistir en localStorage `"poligol.settings"`; nombre y país del jugador en
  `"poligol.profile"` (precargar al volver a entrar).
- **Juego**: `#rotate-overlay` ("📱↻ Girá el teléfono" — visible SOLO en táctil con
  orientación portrait durante el partido), engranaje flotante `#btn-game-options`.

## Render v1.1

- **BOTINES (pies)**: cada jugador tiene 2 botines (elipses ~7×4, color oscuro con detalle
  blanco tipo botín) colocados perpendiculares a su facing, que alternan zancada con fase
  proporcional a la DISTANCIA recorrida (oscilan ±6 u a lo largo del facing, en
  contrafase). Quietos y simétricos si velocidad < 10. El cuerpo (círculo) se dibuja
  ENCIMA, los botines asoman hacia ADELANTE: tiene que leerse clarísimo hacia dónde corre
  cada jugador. Durante `slide`: ambos botines estirados hacia adelante (barrida).
- **Estadios (paletas)**: clasico = v1 (día); noche = césped oscuro, cielo con estrellas,
  4 conos de luz de reflectores desde las esquinas; playa = arena (sin franjas, moteado),
  sombrillas ⛱️🏖️ alrededor de la cancha; nieve = campo blanco-azulado con franjas sutiles
  y ~40 copos animados cayendo (20 si fx=low).
- **Mobile apaisado 100%**: al entrar al partido en táctil: `requestFullscreen()` +
  `screen.orientation.lock("landscape")` en try/catch (si falla, no pasa nada). Si queda
  en portrait → mostrar `#rotate-overlay`. Joystick DINÁMICO: aparece centrado donde el
  dedo toca la mitad izquierda de la pantalla (no posición fija), botones ⚽ (grande) y 🦵
  a la derecha. `navigator.vibrate(80)` en gol propio y 40 en barrida recibida (si opción
  activa). Meta viewport con `viewport-fit=cover`; usar safe-areas.

## Audio v1.1 — SFX graciosos + RELATOR

- **SFX (WebAudio synth, graciosos)**: patada "pop" seco, barrida slide-whistle
  descendente + "boing" de resorte, gol bocina de aire + ovación, rebote en pared "doink",
  beeps de cuenta regresiva, fanfarria desafinada estilo kazoo para el campeón. Todos
  respetan el volumen master de opciones.
- **RELATOR en español (speechSynthesis)**: módulo comentarista. Elegir voz:
  es-AR > es-419 > es-MX > es-US > es-ES > cualquier `es*`. No solapar frases (cancel del
  utterance anterior). Frases AL AZAR por evento, con onda de relator argentino:
  inicio: "¡Arranca el partido!", "¡Rueda la pelota!", "Sale jugando {nombre}..."
  gol: "¡GOOOOOL de {nombre}!", "¡Golazo de {nombre}!", "¡La mandó a guardar {nombre}!",
       "¡Qué definición de {nombre}, no lo puedo creer!"
  en contra: "¡En contra! ¡Insólito lo de {nombre}!", "¡{nombre} le erró al arco... metió
       un gol en contra!"
  barrida que conecta: "¡Tremenda patada de {nombre}!", "¡Le pegó una patada criminal a
       {rival}!", "¡Eso es roja, árbitro!"
  racha (2+ goles seguidos del mismo): "¡{nombre} está intratable!"
  gameover: "¡{nombre}, campeón del PoliGol!", "¡Se terminó! ¡La copa es de {nombre}!"
  Toggle en opciones (default ON). En 2v2 usar el nombre del jugador que metió el gol.

## Notas

- El scoreboard en ffa muestra por jugador como v1; en 1v1/2v2 muestra DOS pills grandes
  de equipo (banderas de los integrantes + score del equipo).
- Persistir y restaurar perfil/settings NO debe romper si localStorage está deshabilitado
  (try/catch).
- Compatibilidad con clientes v1.0: NO se mantiene (mismo deploy actualiza ambos lados).
