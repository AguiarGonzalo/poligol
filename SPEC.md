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

---

# v1.2 — CAMBIOS (este bloque PISA a v1 y v1.1 donde los contradiga)

Objetivos: jugabilidad responsiva (netcode con predicción), salas públicas confiables
(push del server), packs de voz reales para el relator, y arquitectura que aguante
1000 jugadores simultáneos (≈250 salas) en un solo proceso.

## A. NETCODE — predicción + reconciliación (LO MÁS IMPORTANTE)

Problema v1.1: input batched a 30 Hz + tick server + broadcast + 100 ms de interpolación
+ RTT a Render ⇒ ~300-400 ms percibidos. Solución estándar:

### Protocolo
- `input` gana `seq` (entero incremental por conexión, arranca en 1):
  `{type:"input", seq, mx, my, kick, tackle}`. El cliente lo manda INMEDIATAMENTE al
  cambiar el vector de movimiento o al presionar kick/tackle (cap 60 msgs/s) y además
  un keepalive a 20 Hz mientras juega. El server guarda por jugador `lastSeq` (último
  input aplicado; ignora seq ≤ lastSeq y seq no numérico).
- `state`: cada jugador gana `iq` = lastSeq aplicado (para reconciliación del propio).
  Posiciones y velocidades REDONDEADAS a 1 decimal (Math.round(v*10)/10) para achicar
  el JSON (~35% menos bytes).
- Ping: `{type:"ping", t}` (cliente, t = performance.now()) → `{type:"pong", t}` (eco).
  Cliente lo manda cada 2 s; muestra RTT en un indicador (#ping-indicator) con color
  (verde <80 ms, amarillo <180, rojo ≥180).

### Cliente — predicción del PROPIO jugador
- Mantener `pendingInputs` = [{seq, mx, my, dt}] desde el último acked.
- Simulación local del propio jugador IDÉNTICA al server (función compartida copiada:
  ACCEL/FRICTION/MAX_SPEED + confinamiento a la cancha + stun/slide bloquean control),
  corriendo en el rAF con dt real.
- Al llegar `state`: tomar pos/vel del server del propio jugador + su `iq`, descartar
  pendientes con seq ≤ iq, re-simular los pendientes desde ese estado → posición
  predicha. El RENDER del propio jugador usa SIEMPRE la predicción.
- Suavizado de corrección: la diferencia entre predicción nueva y render anterior se
  absorbe con un offset que decae a 0 en ~120 ms (lerp exponencial); si la diferencia
  es > 80 u, snap directo.
- La PELOTA y los RIVALES siguen interpolados (sin predicción), pero con DELAY
  ADAPTATIVO: interpDelay = clamp(snapInterval*1.5 + jitter, 50, 160) ms, recalculado
  con las últimas ~20 llegadas de snapshots (jitter = desvío estándar). Reemplaza el
  100 ms fijo.
- Feedback inmediato local al patear/barrer: animación + SFX al presionar (sin esperar
  al server).

### Server — kick buffer y stun de barrida
- KICK BUFFER: si llega kick y la pelota está fuera de rango, recordar la intención
  160 ms; ejecutarla en el primer tick en que la pelota entre en rango (respetando
  cooldown). Evita el "apreté y no pateó" con latencia.

## B. GAME FEEL — retune (cambios a la tabla de constantes compartidas)

```js
const ACCEL = 1600;        // antes 1400 — más respuesta
const FRICTION = 7.5;      // antes 6 — frena antes, menos "patinada"
const KICK_RANGE = 44;     // antes 36 — más fácil conectar la patada
// El resto de constantes v1/v1.1 quedan igual.
```

- **DRIBBLE ASSIST arreglado** (bug v1.1: al correr hacia una pelota libre, el assist
  la empujaba en tu facing = se escapaba). Nueva condición — aplica SOLO si TODAS:
  (a) pelota a ≤ PLAYER_R+BALL_R+8 del jugador, (b) es el jugador más cercano,
  (c) |vel jugador| > 40, (d) **|vBall − vPlayer| < 140** (pelota "controlada", moviéndose
  con el jugador — NO cuando le estás llegando a una pelota quieta o que viene de frente).
  Fuerza 320 u/s² (antes 400) hacia el punto a 22 u delante del facing; cap velocidad
  relativa 240. Resultado: la pelota quieta SE QUEDA QUIETA hasta que la tocás; una vez
  en control, te acompaña al pie.

## C. SALAS PÚBLICAS — push del server (fix del bug "no se ve la sala")

- Causa raíz v1.1: el cliente dependía de polling cada 3 s con guard de document.hidden
  (que bloqueaba hasta el botón refrescar) y sin reacción a visibilitychange.
- **Nuevo: suscripción.** `{type:"subRooms", on:true|false}` (cliente). El server
  mantiene un Set de conexiones suscriptas y les PUSHEA `{type:"rooms", rooms:[...]}`
  (mismo formato v1.1) inmediatamente al suscribirse y cada vez que cambia algo que
  afecte la lista (sala creada/borrada, join/leave, cambio de modo/estadio/visibilidad/
  status). Coalescing: máximo un push cada 250 ms por cambio múltiple.
- Cliente: `subRooms on` al mostrar el home, `off` al salir. `listRooms` SIGUE
  funcionando (compat + botón refrescar manual, que ahora NO chequea document.hidden).
  En `visibilitychange` a visible estando en home: re-suscribir + pedir lista.
- La PROPIA sala pública del usuario aparece en la lista de otros — y si el usuario
  está en el home con una sala creada en otra pestaña, la ve como cualquier otra.

## D. RELATOR — packs de voz REALES (+ fallback sintético)

NO se incluye audio con derechos (voces de PES/broadcasters = copyright). En su lugar:
- **Sistema de packs**: si existe `public/voices/manifest.json`, el cliente lo carga
  (fetch al entrar al juego, cache en memoria) y usa audio real. Formato:
  ```json
  { "name": "Mi relator", "events": {
      "start":   ["start1.mp3", "start2.mp3"],
      "goal":    ["gol1.mp3", "gol2.mp3", "gol3.mp3"],
      "owngoal": ["encontra1.mp3"],
      "tackle":  ["patada1.mp3"],
      "streak":  ["intratable1.mp3"],
      "win":     ["campeon1.mp3"]
  }}
  ```
  Rutas relativas a `public/voices/`. Reproducción: elegir al azar dentro del evento,
  por el masterGain de WebAudio (respeta volumen/mute), sin solapar (si hay uno sonando,
  el nuevo solo lo reemplaza si el evento es "goal"/"win"). Si falta el manifest o un
  archivo falla → fallback al relator speechSynthesis v1.1 frase a frase.
- `voices/` se agrega a .gitignore SALVO `voices/README.md` (instrucciones para que el
  usuario ponga sus propios audios, cómo nombrarlos y el manifest de ejemplo).
- En opciones, bajo el toggle Relator, mostrar el nombre del pack activo si hay
  (`#relator-pack-label`, texto chico) o "Voz sintética".

## E. ESCALABILIDAD — 1000 jugadores simultáneos en un proceso

Meta medible: 250 salas × 4 jugadores (1000 conexiones WS) en un solo proceso Node con
tick medio < 8 ms y sin crecimiento de memoria. Cambios server:

1. **Snapshots compactos**: redondeo a 1 decimal (ya en A), y NO enviar campos nulos
   (stun/kc/slide solo si > 0 — el cliente asume 0 si faltan).
2. **Backpressure**: si `ws.bufferedAmount > 64 KB`, saltear el snapshot de ESA conexión
   este ciclo (no acumular); si supera 512 KB, cerrar la conexión (cliente zombi).
3. **Loops eficientes**: un solo `setInterval` GLOBAL de 60 Hz que itera las salas en
   estado "playing" (en vez de un interval por sala — menos timers, mismo contrato);
   salas en lobby no se procesan. `JSON.stringify` del snapshot UNA vez por sala
   (broadcast del mismo string a los N jugadores).
4. **Métricas**: `GET /health` → `{ok:true, uptime}` (para el health check de Render) y
   `GET /metrics` → `{rooms, playing, players, tickAvgMs, tickP95Ms, rssMB}` calculadas
   con ventana móvil de 10 s.
5. **Límites anti-abuso**: máx 4000 conexiones (configurable env MAX_CONN), máx 1000
   salas; al superar: error "Servidor lleno". Rate limit de mensajes por conexión
   (60/s; exceso → cerrar).
6. **Herramienta de carga**: `tools/loadtest.js` (Node, usa ws): argumentos
   `--url --rooms N --players 4 --minutes M`; cada sala: create + joins + ready,
   y bots que mandan input a 20 Hz con movimiento pseudoaleatorio determinista
   (semilla por índice) y patean al estar cerca; mide e imprime cada 10 s: salas
   activas, msgs/s recibidos, RTT p50/p95 de pings, y al final un resumen. NO se
   incluye en el deploy (carpeta tools/ fuera de public/).
7. **ARCHITECTURE.md**: documento corto: capacidad de un proceso (números del loadtest
   local), límites del plan free de Render (0.1 CPU, sleep), recomendación de plan, y
   el camino horizontal futuro (sharding de salas por instancia + directorio de salas
   compartido + sticky por código — NO implementarlo ahora, solo documentado).

## F. UI nueva (IDs OBLIGATORIOS)

- `#ping-indicator`: pill chiquita esquina inferior derecha del juego (RTT en ms +
  puntito de color). Clases `.ping-good/.ping-mid/.ping-bad`.
- `#relator-pack-label`: línea bajo la fila Relator del modal de opciones.
- Fila de visibilidad del home: agregar subtítulo fijo chico bajo el segmented
  ("Pública: aparece en la lista para cualquiera · Privada: solo con el código").
- En la tarjeta de la PROPIA sala en #rooms-list (si pasara a verse), badge "Tu sala".

## Notas de compatibilidad

- `input` sin `seq` (cliente viejo) → el server lo aplica igual con seq=lastSeq+1.
- `listRooms` se mantiene. `state` con campos ausentes = 0 (cliente nuevo lo asume).
- Constantes nuevas (ACCEL/FRICTION/KICK_RANGE) deben quedar IDÉNTICAS en server.js y
  client.js (la predicción depende de eso).

---

# v1.3 — CAMBIOS (este bloque PISA a v1, v1.1 y v1.2 donde los contradiga)

Dos features: **modo DÚO** (un usuario maneja 2 jugadores con dos joysticks) y
**objetivo de partido configurable** (a X goles o a X minutos, con gol de oro).

## A. Concepto: USUARIOS vs CUERPOS

Hasta v1.2, 1 usuario = 1 jugador físico. Desde v1.3 un usuario puede controlar
1 o 2 "cuerpos" (jugadores físicos). El lobby siempre lista USUARIOS. La física,
colisiones, botines, stun, etc. operan sobre CUERPOS sin cambios.

- Modos existentes (ffa/1v1/2v2): 1 cuerpo por usuario, todo igual que v1.2.
- **Modo nuevo `duo`**: 2–4 usuarios, cada usuario es UN EQUIPO con DOS cuerpos.
  Cantidad de arcos n = cantidad de usuarios (2 → rectángulo, 3 → triángulo,
  4 → cuadrado — misma geometría de siempre con n = equipos). Capacidad de sala
  en duo: 4 usuarios máx (8 cuerpos = MAX_PLAYERS). setTeam deshabilitado
  (cada usuario ES su equipo); #teams-panel oculto en duo.
- IDs: los cuerpos usan ids únicos propios. En `start`, cada cuerpo declara:
  `{id, name, country, team, owner, slot}` — owner = id de usuario (el playerId
  de `joined`), slot = 0 (cuerpo A) | 1 (cuerpo B). En modos no-duo: slot 0 y
  owner = el propio usuario, SIEMPRE presentes (uniforme).
- Spawns duo: los 2 cuerpos del equipo k en el spawn v1 de su lado, separados
  ±55 perpendicular a la dirección centro→arco.
- Puntaje por EQUIPO igual que v1.2 (scores array). lastTouch = cuerpo; el gol
  suma al EQUIPO del cuerpo que tocó último (gol en contra de tu propio equipo
  solo resta, aunque lo meta tu cuerpo B).

## B. Protocolo input DUO (compatible)

`{type:"input", seq, mx, my, kick, tackle, b:{mx, my, kick, tackle}}`
- En duo: los campos planos controlan el cuerpo slot 0; el objeto `b` (opcional,
  mismas validaciones/clamps) controla el slot 1. Sin `b` → el cuerpo B mantiene
  su último input de movimiento = 0 (quieto), sin acciones.
- En modos no-duo el server IGNORA `b`.
- UN solo `seq` por mensaje cubre ambos cuerpos; `iq` viaja en AMBOS cuerpos
  propios con el mismo valor. Cooldowns/kick-buffer/facing/stun por cuerpo.
- Predicción v1.2 extendida: el cliente simula y reconcilia LOS DOS cuerpos
  propios (pendingInputs guarda a y b por entrada); pelota y rivales interpolados
  igual. El render de AMBOS cuerpos propios usa la predicción.

## C. Controles DUO

**Táctil (lo pedido por el usuario):** la pantalla se parte en DOS ZONAS (mitad
izquierda = cuerpo A, mitad derecha = cuerpo B). En cada zona, un joystick
dinámico independiente (aparece donde toca el dedo, igual que v1.2, uno por zona,
multitouch simultáneo con touch identifiers):
- **Mantener y arrastrar** = mover ese cuerpo.
- **TAP** (touchstart→touchend con duración < 220 ms Y desplazamiento total
  < 12 px) = PATEAR con ese cuerpo. Es exactamente "levanto el dedo y aprieto de
  nuevo → patea": el tap no mueve, patea.
- **DOBLE TAP** (segundo tap ≤ 300 ms después del primero) = BARRIDA de ese
  cuerpo (el primer tap ya habrá pateado; está bien — patada y luego barrida).
- En duo táctil los botones ⚽/🦵 se OCULTAN (las zonas cubren todo).
- En los modos no-duo, el joystick y botones v1.2 quedan IGUALES.

**Teclado:** cuerpo A = WASD + `F` patear + `G` barrer; cuerpo B = flechas +
`L` patear + `K` barrer. Al entrar a un partido duo por teclado, mostrar 3 s un
hint overlay con el mapeo (#duo-keys-hint, se oculta solo).

**Identificación visual:** el halo del cuerpo propio v1.1 se mantiene en A
(dorado) y B lleva halo plateado/celeste + marca "②" junto al nombre. Etiqueta
de nombre en ambos cuerpos (B con "②").

## D. Objetivo de partido configurable (host)

- `{type:"setMatch", target:"goals"|"time", value}` — solo host, solo lobby.
  Whitelist: goals → value ∈ {1,3,5,10} (default 3); time → value ∈ {120,180,
  300,600} segundos. Cambiarlo NO resetea readies. Inválido → error.
- `lobby` gana campos `target` y `value`. `rooms` (cards) también, y el cliente
  muestra chip ("a 3 goles" / "5 min").
- **target=goals**: gana el primer equipo en llegar a `value` (igual que siempre
  pero configurable).
- **target=time**: el state gana `tl` = segundos restantes (entero, redondeo
  techo, presente SOLO en target=time). El reloj corre únicamente con la pelota
  en juego (no durante GOAL_PAUSE ni countdown). Al llegar a 0:
  - Si hay un único líder → `gameover` normal (winnerTeam = líder).
  - Si hay empate en la cima → `{type:"golden"}` (broadcast) y sigue el juego en
    **GOL DE ORO**: el próximo gol de CUALQUIER equipo termina el partido al
    instante (gameover tras el evento goal). En golden, `tl` se omite.
- `gameover` gana campo `reason`: "goals" | "time" | "golden".
- UI lobby: junto a modo/estadio, dos selects del host: `#match-target-select`
  (Goles | Tiempo) y `#match-value-select` (opciones según target: 1/3/5/10
  goles ó 2/3/5/10 min). No-host: deshabilitados, muestran el valor actual.
- UI juego: `#match-clock` (mm:ss, visible solo target=time, arriba centro bajo
  el scoreboard; en gol de oro muestra "GOL DE ORO" en dorado pulsante).
  El overlay de gol de oro usa el #overlay existente para anunciarlo (2 s).

## E. Detalles server

- `modeCapacity("duo")` = 4 (usuarios). Mínimo para arrancar: 2 usuarios, todos
  ready (sistema v1.1 sin cambios).
- Crear cuerpos al armar el partido (start), no en el lobby. Desconexión de un
  usuario en partido: aborta como siempre (sus 2 cuerpos desaparecen).
- Rate limit y validaciones: `b` con los mismos clamps que los campos planos;
  mensajes input siguen contando 1 para el rate limit.
- El relator y los SFX tratan cada gol por el nombre del USUARIO dueño del
  cuerpo que metió el gol.
- /metrics: `players` cuenta CONEXIONES (usuarios), agregar `bodies` (cuerpos en
  juego).

## F. Reglas de compatibilidad

- Cliente v1.2 contra server v1.3: funciona en modos no-duo (b ignorado, target
  default goals/3, tl ausente). No se exige más que eso.
- TODO lo demás de v1.2 (predicción, push de salas, packs de voz, métricas,
  loadtest) queda intacto. tools/loadtest.js: agregar flag opcional `--duo`
  (las salas se crean en modo duo con inputs dobles) sin romper el modo default.

---

# v1.4 — FÍSICA ESTILO HAXBALL (PISA toda la física previa de v1/v1.1/v1.2/v1.3)

Objetivo: replicar la jugabilidad de HaxBall (haxball.com) — competitiva, pesada/precisa,
sin delay. Se reemplaza el modelo de física entero por el de HaxBall (motor de discos a
60 Hz con dt=1, colisiones por momento, kick por contacto). Se conserva TODO lo demás de
v1.3: geometría poligonal (n = equipos), modos ffa/1v1/2v2/duo, objetivo goles/tiempo,
estadios, salas, relator, métricas. Fuente: reverse-engineering del engine
(wxyz-abcd/node-haxball src/api.js). Esta sección es NORMATIVA y EXACTA.

## A. Unidades y orden de tick (CAMBIO FUNDAMENTAL)

- La simulación corre a **60 Hz con paso fijo dt = 1** (NO en segundos). Las velocidades
  se expresan en **unidades de mundo por TICK** (no por segundo). speed = 1 ⇒ 1 unidad/tick
  ⇒ 60 u/s. Se elimina la integración exponencial (`exp(-FRICTION*dt)`) de versiones
  previas: el damping ahora es geométrico por tick (`speed *= damping`).
- El mundo conserva las coordenadas actuales (circunradio R = 380, etc.). Las constantes de
  HaxBall son compatibles de escala (su cancha ≈ 740×340 ≈ la nuestra; radios casi iguales).
- **Orden EXACTO por tick del servidor** (autoritativo):
  1. **Input de jugadores → aceleración**: para cada cuerpo controlado, agregar a su speed
     el vector de input × aceleración (ver C). Diagonales normalizadas ×(1/√2).
  2. **Kick**: para cada cuerpo con kick "mantenido", si la pelota está en alcance y el
     cooldown venció, aplicar impulso (ver D). El kick modifica speeds ANTES de integrar.
  3. **Integración + damping de TODOS los discos, en un solo paso, en este orden por disco**:
        `pos.x += speed.x;  pos.y += speed.y;`
        `speed.x = damping * (speed.x + gravity.x);  speed.y = damping * (speed.y + gravity.y);`
     (gravity = 0 en PoliGol). El damping del cuerpo usa `kickingDamping` mientras mantiene
     kick (igual a damping por defecto). Es decir: se mueve con la velocidad vieja y LUEGO
     se amortigua.
  4. **Colisiones** (después de mover y amortiguar), en este orden:
     a) disco–disco (cada par una vez), b) disco–segmento (paredes), c) disco–vértice
     (esquinas/postes como vértices o discos estáticos). Ver B.
  5. Detección de gol / pelota afuera (igual que antes: centro de la pelota cruza el segmento
     del arco hacia afuera). Reloj de tiempo (v1.3) descuenta 1/60 s por tick en juego.

## B. Colisiones (fórmulas EXACTAS de HaxBall)

Restitución combinada SIEMPRE = `a.bCoef * b.bCoef + 1` (producto + 1). El impulso se
aplica SOLO si la velocidad relativa normal es negativa (se están acercando). La corrección
posicional se reparte por invMass. Un disco con invMass = 0 es inamovible (no colisiona con
geometría estática; sí frena a otros discos).

**Disco A vs disco B** (ambos con invMass; si uno es estático su invMass = 0):
```
dx = A.x - B.x;  dy = A.y - B.y;  d2 = dx*dx + dy*dy;  rs = A.r + B.r
if (0 < d2 && d2 <= rs*rs) {
  d = sqrt(d2);  nx = dx/d;  ny = dy/d;             // normal A←B
  ratio = A.invMass / (A.invMass + B.invMass);      // si suma 0, no resolver
  pen = rs - d;
  A.x += nx*pen*ratio;  A.y += ny*pen*ratio;
  B.x -= nx*pen*(1-ratio);  B.y -= ny*pen*(1-ratio);
  rel = nx*(A.vx-B.vx) + ny*(A.vy-B.vy);
  if (rel < 0) {
    f = rel * (A.bCoef*B.bCoef + 1);
    A.vx -= nx*f*ratio;        A.vy -= ny*f*ratio;
    B.vx += nx*f*(1-ratio);    B.vy += ny*f*(1-ratio);
  }
}
```

**Disco vs segmento de pared** (segmento recto entre dos puntos P0,P1; bCoef pared = 1).
Solo discos con invMass>0. Detectar dentro del tramo (proyección entre P0 y P1), normal del
segmento, profundidad T = r − distancia con signo; si penetra (T>0): empujar el disco fuera
por la normal y, si va hacia la pared (vel·normal < 0), reflejar:
```
vn = nx*v.x + ny*v.y;
if (vn < 0) { vn *= (disc.bCoef * 1 + 1); v.x -= nx*vn; v.y -= ny*vn; }  // bCoef pared = 1
```
Las paredes del polígono son segmentos rectos entre vértices del lado (excluyendo la boca
del arco). El caso n=2 (rectángulo) idem con sus 4 paredes y las bocas.

**Vértice / poste** (punto estático con bCoef): igual que disco–disco con el vértice
inamovible (solo se mueve el disco). Usar para las esquinas del polígono y para los POSTES
del arco (ver F).

## C. Movimiento del jugador (EXACTO)

- Constantes (unidades/tick):
  ```
  PLAYER_R = 15;  PLAYER_INVMASS = 0.5;  PLAYER_BCOEF = 0.5;
  PLAYER_DAMPING = 0.96;  KICKING_DAMPING = 0.96;
  ACCEL = 0.1;            // aceleración normal por tick²
  KICKING_ACCEL = 0.07;   // mientras mantiene kick
  BALL_R = 10;  BALL_INVMASS = 1;  BALL_BCOEF = 0.5;  BALL_DAMPING = 0.99;
  WALL_BCOEF = 1;  POST_R = 8;  POST_BCOEF = 0.5;
  KICK_STRENGTH = 5;  KICKBACK = 0;  KICK_REACH = 4;  // alcance = PLAYER_R+BALL_R+4 = 29
  KICK_COOLDOWN_TICKS = 2;
  DIAG = 0.7071067811865476; // 1/√2
  ```
- Input → dirección {dx,dy} ∈ {-1,0,1}² (8 direcciones). Si dx≠0 && dy≠0: `dx*=DIAG; dy*=DIAG`.
  `speed += dir * (kickHeld ? KICKING_ACCEL : ACCEL)`.
- Velocidad terminal resultante ≈ 2.4 u/tick (144 u/s) normal, 1.68 u/tick (100.8 u/s) con
  kick. El jugador tiene INERCIA real (se desliza un poco), pero el control es firme: este
  "peso" es el feel de HaxBall. NO hay tope duro de velocidad (lo limita el damping).
- Se ELIMINA por completo el "dribble assist" de v1.2/v1.3. La gambeta es 100% física:
  empujás la pelota con el cuerpo (colisión con restitución) y la acomodás con toques de kick.

## D. KICK estilo HaxBall (reemplaza el kick direccional previo — LO MÁS IMPORTANTE)

El kick deja de ser un botón direccional (ya no usa `facing` ni KICK_POWER/KICK_RANGE viejos).

- **Input `kick` pasa a ser un ESTADO MANTENIDO** (true mientras la tecla/botón está
  apretado), no un edge-trigger. (Tackle sigue siendo edge-trigger, ver E.)
- Por cuerpo el server mantiene: `kickHeld` (del input), `kickCd` (cooldown en ticks),
  `kickArmed` (bool: hay que SOLTAR y volver a apretar entre kicks).
- Cada tick (paso 2 del orden A), para cada cuerpo:
  ```
  if (kickCd > 0) kickCd--;
  if (kickHeld && kickArmed && kickCd <= 0) {
    // ¿pelota en alcance?
    dx = ball.x - body.x;  dy = ball.y - body.y;  dist = hypot(dx,dy);
    if (dist - BALL_R - PLAYER_R < KICK_REACH) {     // dist < 29
      nx = dx/dist; ny = dy/dist;                     // dirección CUERPO→PELOTA
      ball.vx += KICK_STRENGTH * nx * BALL_INVMASS;   // impulso 5 (pelota salta a speed 5)
      ball.vy += KICK_STRENGTH * ny * BALL_INVMASS;
      body.vx -= KICKBACK * nx * PLAYER_INVMASS;      // retroceso (KICKBACK=0 ⇒ nulo)
      body.vy -= KICKBACK * ny * PLAYER_INVMASS;
      ball.lastTouch = body;                           // para el gol
      kickCd = KICK_COOLDOWN_TICKS;  kickArmed = false; // hay que soltar para re-patear
      emitKickEvent(body);                             // para sfx/anim cliente
    }
  }
  if (!kickHeld) kickArmed = true;                      // soltar re-arma
  ```
- Apuntás moviendo el cuerpo: la pelota sale en la línea de tu centro al de la pelota.
  Mantené kick apretado mientras te acercás y dispara solo al tocarla. Toques sucesivos
  (soltar+apretar) permiten conducir/amagar.
- Mientras `kickHeld`, el jugador usa `KICKING_ACCEL` (0.07) en vez de ACCEL (más lento al
  cargar el disparo) y un tinte visual distinto (indicador de "armado", como HaxBall).

## E. Barrida (tackle) — opción de sala

- HaxBall NO tiene barrida. Para no perder la feature, es **configurable por el host**:
  `{type:"setRules", tackles:bool}` (solo host, lobby; default `true`). Se agrega a `lobby`
  y a las cards de `rooms` (`tackles`). Toggle UI `#rule-tackles` (checkbox; junto a
  modo/estadio/objetivo). Con `tackles:false` el juego es "HaxBall puro".
- Si está activa, la barrida se reexpresa en unidades/tick del nuevo modelo: edge-trigger,
  rango PLAYER_R*2+14, knockback como impulso (≈7 u/tick) al rival, stun 0.9 s, slide del
  que barre 0.38 s. Mantener el comportamiento de v1.3 pero con magnitudes en u/tick
  coherentes con el nuevo damping.

## F. Geometría: postes de arco (detalle HaxBall)

- En cada extremo de la boca de cada arco, agregar un **poste**: disco estático
  (invMass = 0, radius = POST_R = 8, bCoef = POST_BCOEF = 0.5). La pelota y los jugadores
  rebotan en el poste (clásico "pegó en el palo"). Cliente: dibujar los postes (circulito
  claro) en los extremos del arco.
- Las paredes del lado (a ambos lados de la boca) son segmentos con WALL_BCOEF = 1.
- El gol se detecta igual que antes (centro de pelota cruza el segmento de la boca hacia
  afuera), PERO ahora puede pegar en el poste y volver. Mantener el margen de detección.

## G. Estadios re-expresados al modelo HaxBall (multiplicadores sobre damping/accel)

| stadium | efecto (sobre las constantes del nuevo modelo) |
|---------|-----------------------------------------------|
| clasico | sin cambios |
| noche   | sin cambios (solo visual) |
| playa   | BALL_DAMPING 0.99 → 0.97 (la arena frena la pelota antes) |
| nieve   | PLAYER_DAMPING 0.96 → 0.99 y ACCEL/KICKING_ACCEL ×0.6 (patina: más inercia, menos
            agarre); BALL_DAMPING 0.99 → 0.995 |

Aplicar como multiplicadores/reemplazos al armar el partido, reseteados entre partidos.
DEBEN ser idénticos en server y cliente (la predicción depende de eso).

## H. Netcode: extrapolación de mundo completo (el "sin delay" de HaxBall)

HaxBall logra el feel clonando el estado autoritativo y simulándolo hacia adelante. Se
extiende la predicción v1.2 (que solo predecía el cuerpo propio) a **mundo completo**:

- El server sigue siendo autoritativo a 60 Hz y manda snapshots a 30 Hz (state) con TODOS
  los discos (cuerpos + pelota) en unidades/tick, redondeados a 2 decimales (más precisión
  que el 1 decimal de v1.2: las velocidades chicas por tick lo necesitan), `iq` por cuerpo
  propio, y campos en 0 omitidos.
- **Cliente** mantiene una copia del último snapshot autoritativo y, cada frame de render,
  **simula el mundo entero hacia adelante** con EXACTAMENTE la misma física (mismo orden,
  mismas fórmulas, mismas constantes que el server) por la cantidad de ticks =
  `extrapolación` (ver abajo), aplicando:
  - sus PROPIOS inputs reales (cuerpo[s] propio[s]) → respuesta instantánea, cero delay;
  - para los rivales: mantener su último input conocido (se asume que siguen igual);
  - la pelota se simula con todos: tu kick mueve la pelota AL INSTANTE localmente.
- **Cantidad de extrapolación**: adaptativa = `round(RTT/2 / 16.67) + 1` ticks, clamp [1, 12]
  (≈ medio RTT, tope 200 ms como HaxBall). Configurable en opciones
  (`#opt-extrapolation`, slider 0–200 ms, default "Auto"). 0 = sin extrapolar (ver el pasado
  interpolado, suave pero con delay); más = más responsivo y más "snap" cuando falla.
- **Reconciliación / anti-snap**: al llegar un snapshot nuevo, reemplazar el estado base por
  el del server; la diferencia entre lo que se mostraba y la nueva predicción se absorbe con
  un offset visual que decae ~120 ms (como v1.2) POR DISCO (pelota incluida); si el error es
  enorme (> 60 u) se hace snap directo. Esto evita el temblor pero mantiene la respuesta.
- La simulación del cliente DEBE ser determinista y byte-compatible con el server: mismo
  orden de discos, mismas operaciones, `Math.fround` opcional no requerido (un solo cliente
  no necesita bit-perfect cross-client, solo coherencia con el server vía reconciliación).
- Implementación: factorizar la física en una función pura `stepWorld(state, inputsById,
  rules)` reusable por server (autoritativo) y cliente (extrapolación). Mantener el costo
  acotado (un puñado de discos por partido; extrapolar ≤12 ticks por frame es trivial).

## I. Protocolo (cambios v1.4)

- `input`: `kick` y `b.kick` pasan a ser ESTADO MANTENIDO (true mientras apretado). Se
  agrega que el cliente mande input inmediato también al SOLTAR kick (flanco de bajada).
  `tackle`/`b.tackle` siguen edge-trigger.
- `{type:"setRules", tackles:bool}` (host, lobby). `lobby` y `rooms` ganan `tackles`.
- `state`: velocidades en u/tick, 2 decimales. Se agrega por disco propio `ka` (kickArmed,
  bool) y `kh` (kickHeld efectivo) para feedback; `kc` ahora en TICKS restantes de cooldown
  (entero). La pelota lleva además `lt` (id del cuerpo de lastTouch) opcional para color del
  relator. Campos en 0 omitidos.
- Eventos `kick` por cuerpo (server→cliente, opcional, para sfx/anim precisos):
  `{type:"kicked", id:"p1a"}`. El cliente igual hace feedback local inmediato.
- Todo lo demás del protocolo v1.3 intacto.

## J. Cliente — render y controles (cambios v1.4)

- **Indicador de kick armado**: el cuerpo propio cambia de aspecto (aro/tinte) mientras
  mantenés kick (como HaxBall, que oscurece al jugador). Mostrar también un sutil resplandor
  cuando el kick está en cooldown.
- **Postes**: dibujar los dos postes de cada arco (discos claros radio 8).
- **Controles** (el kick ahora es "mantener"):
  - Teclado no-duo: mantener `Espacio`/`J` = kick mantenido (mientras esté apretado).
    Tackle (si la sala lo permite): `Shift`/`K` edge.
  - Teclado duo: A mantener `F` = kick A; B mantener `L` = kick B; tackle A=`G`, B=`K` (edge).
  - Táctil no-duo: botón ⚽ = kick mantenido (mientras el dedo está sobre el botón). Botón 🦵
    tackle (si permitido).
  - Táctil duo: en cada zona, **mantener apretado el dedo (sin arrastrar) = kick mantenido**
    de ese cuerpo (encaja con HaxBall: tocás y mantenés para cargar/disparar al tocar la
    pelota). Arrastrar = mover. Esto reemplaza el "tap=patear" de v1.3 por algo más fiel:
    un toque corto sin mover = un pulso de kick (mantener mientras el dedo esté abajo).
    Doble-tap mantenido sigue disponible para tackle si la sala lo permite.
- Opciones: `#opt-extrapolation` (slider Auto/0–200 ms). Si `tackles:false`, ocultar
  controles/leyendas de barrida.
- El relator y los sfx siguen por cuerpo/usuario. El "pop" del kick suena con el evento
  local inmediato.

## K. Compatibilidad y migración

- Esta versión cambia la SENSACIÓN del juego a propósito (es el pedido). No se mantiene
  compat de física con clientes viejos (mismo deploy actualiza ambos lados).
- tools/loadtest.js: los bots deben mandar `kick` como estado mantenido (mantener apretado
  al acercarse a la pelota) para ejercitar el nuevo camino.
- Mantener /health, /metrics (+bodies), salas públicas por push, packs de voz, predicción
  reconciliada (ahora de mundo completo), modos y objetivo de partido.

---

# v1.6 — UX/UI, consistencia, relator y mobile (cambios SOLO de cliente; sin cambios de protocolo)

Repaso de menús y consistencia. No toca server.js ni el protocolo WS; es index.html +
style.css + client.js.

## A. Home con pestañas de acción

El home agrupa las acciones en un segmented `#tab-create` / `#tab-join` / `#tab-train`
(name="home-action"). Identidad arriba (nombre + país, siempre necesarios). Solo se muestra
el panel de la acción elegida (`#panel-create` / `#panel-join` / `#panel-train`; los otros con
`.hidden`):
- Crear: `#room-name-input` + visibilidad (`#vis-public`/`#vis-private`) + `#btn-create`.
- Unirse: `#room-input` + `#btn-join` (la lista de salas públicas sigue siendo el otro camino).
- Entrenar: blurb + `#btn-train`.
Esto saca de contexto los campos de "crear sala" cuando querés unirte/entrenar y acorta el
home en mobile. `activeHomeTab()` / `setHomeTab(tab)` togglean los paneles; Enter en el nombre
dispara la acción de la pestaña activa.

## B. Relator: SIN voz sintética (se eliminó speechSynthesis)

Se eliminó por completo el relator de voz sintética (sonaba robótico). `commentator()` solo
reproduce si hay un PACK DE VOZ REAL cargado (`voicePackState === "ready"`); sin pack: silencio
(los SFX de WebAudio siguen igual). Se borraron `relatorSay`/`pickRelatorVoice` y la init de
speechSynthesis. La fila Relator del modal de opciones (`#relator-setting`) solo se muestra si
hay pack (con su nombre); sin pack queda oculta. El sistema de packs (`public/voices/` +
manifest.json) queda intacto para quien quiera poner voces reales/licenciadas propias.

## C. Entrenamiento en dúo

El modo entrenamiento (client-side) soporta controlar 1 o 2 cuerpos. Selector en el HUD
(`.th-bodies` data-bodies 1|2). En dúo el `match.mode` del entrenamiento pasa a `"duo"`
(⇒ `isDuo()` ⇒ doble joystick/teclas A·B, halos A dorado / B "②", ⚽/🦵 ocultos), con 2 cuerpos
propios `me_a`/`me_b` (owner "me", slots 0/1). `buildTrainingMatch(name,country,defenders,
stadium,duo)`, `trainingTick` arma inputs por slot para cada cuerpo propio, `rebuildTraining()`
rearma conservando goles. Bug corregido: `onTrainingGoal` ya no asume un cuerpo con id "me"
(en dúo son me_a/me_b).

## D. Consistencia y mobile

- Lobby: toggle de barrida con label a la izquierda y switch a la derecha (consistente con el
  modal); opción de modo "🎮 Dúo (2 c/u)" (sin truncar); botón WhatsApp "💬 WhatsApp".
- Opciones: "⚡ Respuesta" (antes "Predicción ≈ ½ RTT") con texto "Automática (recomendada)".
- Mobile: el home más corto por las pestañas; HUD de entrenamiento compacto en landscape
  (`@media (max-height:460px)` oculta la ayuda); todo verificado en preview mobile/landscape.
