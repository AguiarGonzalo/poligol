# Changelog

Todos los cambios notables de PoliGol se documentan acá.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/) y el proyecto usa
versionado semántico.

## [1.8.0] — 2026-06-13

Inglés + español (i18n).

### Agregado
- **El juego está en dos idiomas: Español e Inglés.** Cada botón, opción, etiqueta,
  cartel y mensaje está traducido (menú, lobby, opciones, modales, overlays de gol/
  campeón, toasts y hasta los errores del servidor).
- **Selector de idioma 🌐 ES / EN** en Opciones y arriba del popup de perfil. El
  idioma se guarda en el dispositivo y por defecto toma el del navegador (si está en
  español arranca en ES, si no en EN). Se puede cambiar en cualquier momento y la
  interfaz se re-traduce al instante.

## [1.7.1] — 2026-06-12

App instalable (PWA).

### Agregado
- **PoliGol se puede instalar como app**: desde el navegador (📲 "Agregar a pantalla
  de inicio" en iPhone, o "Instalar app" en Chrome/Android) queda con su **ícono
  propio** y abre **a pantalla completa, sin barras del navegador** — como una app
  nativa. Resuelve el caso de Safari iPhone donde el botón de pantalla completa no
  tenía efecto.
- Íconos del juego (balón de PoliGol) en 192/512 + maskable + apple-touch.
- Manifest (`manifest.webmanifest`) y service worker (`sw.js`, network-first):
  el contenido se mantiene fresco mientras hay conexión y el juego abre **offline**
  una vez visitado.

## [1.7.0] — 2026-06-12

Se siente un juego de verdad, no una página web.

### Cambiado
- **Menú principal de juego**: ahora es logo + 3 botones grandes (**Crear sala /
  Unirse / Entrenar**) + la ⚙️ arriba a la derecha. Limpio y directo, como un juego.
- **Perfil de una sola vez**: la primera vez aparece un popup pidiendo nombre +
  selección. Se **guarda en el dispositivo** y no te lo vuelve a pedir nunca. Se
  cambia desde la ⚙️ (Editar) o tocando tu chip arriba a la izquierda.
- **Crear / Unirse** son ventanas (modales): "Crear sala" abre nombre + visibilidad;
  "Unirse" abre la lista de salas públicas + el campo de código.
- **Sin scroll de página**: el juego no se desliza arriba/abajo como una web — quedó
  bloqueado (sin rebote ni "pull to refresh"). Cada pantalla que no entra scrollea
  internamente.

### Agregado
- **Pantalla completa**: nuevo toggle "🖥️ Pantalla completa" en Opciones (funciona en
  compu y celular) — además del automático al entrar a jugar en el teléfono.
- **Menú de entrenamiento dentro de la ⚙️**: en el entrenamiento ya no hay una barra
  fija ocupando la pantalla. Queda solo el marcador (un chip chico arriba) y los
  controles (rivales, 1/2 jugadores, reiniciar la pelota, salir) se abren desde la
  ruedita.

## [1.6.0] — 2026-06-12

Repaso de menús, consistencia y mobile.

### Cambiado
- **Home con pestañas**: "¿Qué querés hacer?" → Crear / Unirse / Entrenar. Solo se
  muestran los campos de la acción elegida (el nombre de sala y la visibilidad ya no
  aparecen cuando solo querés unirte o entrenar). Mucho más corto y claro en celular.
- **Opciones más simples**: "Predicción (≈ ½ RTT)" pasó a "⚡ Respuesta · Automática
  (recomendada)".
- **Lobby más consistente**: el interruptor de Barrida ahora tiene el texto a la
  izquierda y el switch a la derecha (igual que el resto); el modo "Dúo" ya no se
  corta; botón de WhatsApp más prolijo.

### Sacado
- **Relator de voz sintética**: sonaba robótico, lo eliminamos. El relator ahora solo
  suena si instalás un **pack de voz real** en `public/voices/` (instrucciones en el
  repo) — por ejemplo grabaciones propias o con licencia. No podemos incluir voces de
  relatores conocidos (Macaya Márquez, etc.) porque son material con derechos de autor.
  Los efectos de sonido (pelota, gol) siguen igual.

### Agregado
- **Entrenamiento en dúo**: en el modo Entrenar podés controlar **2 jugadores** a la
  vez (selector "Controlás 1 / 2" en el HUD), igual que el modo Dúo online — para
  practicar el doble control solo.

### Arreglado
- Un gol en el entrenamiento en dúo rompía el festejo (no existía un cuerpo "me").
- Todo verificado en celular (vertical y apaisado) y en todos los modos.

## [1.5.0] — 2026-06-12

Modo Entrenamiento (jugar solo).

### Agregado
- **🎯 Entrenar solo**: botón en el inicio que te mete a una cancha al instante,
  sin esperar a nadie. Perfecto para agarrarle la mano a la física de HaxBall
  (el kick mantenido, la gambeta con el cuerpo, los rebotes en el palo).
- Corre **100% en tu navegador** con el mismo motor de física del juego online:
  arranca al toque, sin latencia y hasta sin conexión.
- **Rivales con IA** opcionales (0, 1 o 2): defienden su arco posicionándose entre
  la pelota y el palo, para practicar gambeta y definición bajo presión. Se
  agregan/sacan en caliente desde el HUD.
- **Contador de goles**, botón **↺ Pelota** y tecla **R** para reiniciar la pelota
  al centro cuando quieras. Festejo de gol con cartel, sonido y confeti.
- Funciona con teclado y en celular apaisado (mismo control que el online: mantené
  para patear, apuntás moviendo el cuerpo).

## [1.4.0] — 2026-06-12

Física estilo HaxBall. Reescritura completa del motor para que el juego se sienta
competitivo y sin delay, como [HaxBall](https://www.haxball.com).

### Cambiado — el juego se siente totalmente distinto
- **Motor de discos a 60 Hz con momento real** (reverse-engineering del engine de
  HaxBall): jugadores y pelota tienen masa, inercia y rebote físico. El jugador
  "pesa" y se desliza un poco — premia anticipar y posicionarse, no apretar rápido.
- **El kick ahora es como HaxBall**: en vez de un botón direccional, **mantenés
  apretado patear** y la pelota sale disparada en la dirección *tu cuerpo → la
  pelota* en el instante que la tocás. Apuntás moviendo el cuerpo. Hay que soltar y
  volver a apretar para patear de nuevo (cooldown). Es mucho más habilidoso.
- **La gambeta es 100% física**: empujás la pelota con el cuerpo y la acomodás con
  toques. Se eliminó la "asistencia de dribbling" anterior (la que te alejaba la
  pelota y hacía imposible embocarla).
- **Postes en los arcos**: discos sólidos en los extremos de cada arco — la pelota
  y los jugadores rebotan ("pegó en el palo y salió").
- Constantes fieles a HaxBall: jugador radio 15 / damping 0.96 / aceleración 0.1,
  pelota damping 0.99, restitución de choques `a·b + 1`, paredes que conservan la
  velocidad. Velocidad terminal ~2.4 u/tick.

### Agregado
- **Netcode de extrapolación de mundo completo** para el "sin delay": el cliente
  corre exactamente la misma física que el servidor hacia adelante, así tu jugador
  y tus disparos responden al instante; el servidor sigue siendo autoritativo y
  reconcilia suavemente. Slider de extrapolación en Opciones (Auto / 0–200 ms).
- **Barridas configurables por sala** (`setRules`): el host las puede apagar para
  un juego "HaxBall puro" (sin barridas), o dejarlas. Chip "Puro" en las salas.
- Indicador visual de "kick armado" (el jugador se oscurece mientras mantenés
  patear, como en HaxBall).

### Arquitectura
- **`public/physics-core.js`**: el motor de física vive en un único módulo UMD
  compartido — el servidor lo importa y el cliente lo carga. Una sola fuente de
  verdad ⇒ la predicción del cliente es idéntica a la simulación del servidor (cero
  drift de determinismo). Verificado byte-idéntico en 4 estadios, 300+ ticks.
- Estadios re-expresados en el nuevo modelo (la nieve patina de verdad: más
  inercia, menos agarre; la playa frena la pelota).
- 1000 jugadores simultáneos siguen entrando: tick p95 4.6 ms (250 salas / load
  test), sin leaks.

## [1.3.0] — 2026-06-12

Modo Dúo y partidos configurables.

### Agregado
- **Modo Dúo 🎮**: cada usuario controla **2 jugadores** a la vez. En el celular,
  la pantalla se parte en dos zonas con un joystick dinámico cada una (izquierda =
  jugador A, derecha = B): mantenés y arrastrás para moverte, **tap corto para
  patear** (soltás y tocás de nuevo = patada) y doble tap para la barrida. En
  teclado: WASD + F/G para A, flechas + L/K para B (con cartel de ayuda al entrar).
  De 2 a 4 usuarios (hasta 8 jugadores en cancha); cada usuario defiende su arco.
  Tu jugador A lleva halo dorado y el B halo celeste con "②".
- **Partido a goles o por tiempo** (lo configura el dueño de la sala, junto al modo
  y el estadio): a 1/3/5/10 goles, o 2/3/5/10 minutos con **reloj en pantalla**
  que corre solo con la pelota en juego. Si el tiempo termina empatado: **GOL DE
  ORO** — el próximo gol gana, con el reloj pulsando en dorado.
- La lista de salas públicas y el lobby muestran el objetivo del partido
  ("a 5 goles" / "3 min").
- La predicción local de v1.2 ahora corre para los dos cuerpos propios en Dúo, y
  el feedback de patada/barrida es por cuerpo.
- `/metrics` reporta también `bodies` (jugadores físicos en cancha).
- `tools/loadtest.js --duo` para cargar el server con salas en modo Dúo.

### Corregido
- `KICK_COOLDOWN` no estaba definido en el cliente (error latente de v1.2 al
  patear con la pelota en rango).

## [1.2.0] — 2026-06-12

La actualización de la jugabilidad y la escala.

### Arreglado
- **"Imposible embocarle a la pelota"**: el dribble assist de v1.1 empujaba la pelota
  en la dirección de tu carrera cuando eras el jugador más cercano — al correr hacia
  una pelota libre, ¡el assist te la alejaba! Ahora el assist solo actúa cuando la
  pelota ya está controlada (moviéndose con vos) y una pelota en reposo no recibe
  fuerza hasta que la tocás de verdad.
- **"No se ve la sala pública desde otra pestaña"**: la lista dependía de un polling
  que se bloqueaba con la pestaña en segundo plano (incluso el botón refrescar).
  Ahora el servidor **pushea** la lista a todos los que están en el inicio, al
  instante y sin polling. El botón refrescar funciona siempre, y tu propia sala
  aparece con el badge "Tu sala".
- El loop de física corría a ~56 Hz reales por truncamiento del timer de Node;
  ahora usa un acumulador de tiempo real y sostiene 60 Hz exactos (verificado:
  30.02 snapshots/s).

### Jugabilidad (netcode)
- **Predicción local con reconciliación**: tu jugador responde al instante al
  apretar (sin esperar el viaje al servidor); el servidor sigue siendo autoritativo
  y las correcciones se suavizan en ~120 ms. Adiós al delay percibido.
- Input enviado inmediatamente al cambiar (no más espera del tick de 30 Hz),
  interpolación adaptativa según el jitter real de la conexión (50–160 ms en vez
  de 100 fijos), y **kick buffer** de 160 ms: si apretás patear justo antes de
  llegar a la pelota, la patada sale igual.
- Feedback inmediato local de patada/barrida (sonido y animación al apretar).
- Más respuesta: aceleración 1400→1600, frenado 6→7.5 (menos "patinada"),
  rango de patada 36→44.
- **Indicador de ping** en el partido (verde/amarillo/rojo).

### Relator con voces reales (packs)
- Si ponés audios en `public/voices/` con un `manifest.json` (instrucciones en
  `public/voices/README.md`), el relator usa **audio real** — elegido al azar por
  evento (gol, en contra, patada, racha, campeón) con fallback a la voz sintética.
  No incluimos voces de PES/broadcasters por derechos de autor: el pack es tuyo
  (grabate vos, o usá audio con licencia).

### Escalabilidad — 1000 jugadores simultáneos verificados
- Un solo loop global de 60 Hz para todas las salas, snapshots compactos (campos
  en cero se omiten, 1 decimal), un solo stringify por sala, backpressure por
  conexión (cliente lento no frena a los demás; zombi se desconecta), límites
  anti-abuso (conexiones máximas, 1000 salas, rate limit por conexión).
- `GET /health` y `GET /metrics` (salas, jugadores, tick promedio/p95, memoria).
- **Load test reproducible** (`tools/loadtest.js`): 250 salas × 4 bots = 1000
  conexiones jugando de verdad → tick p95 **3.95 ms** (presupuesto: 8), ~30k
  msgs/s, RTT p95 5 ms, 0 errores, memoria estable. Detalle en `ARCHITECTURE.md`
  (incluye el camino a escalar horizontal y qué plan de hosting hace falta).

## [1.1.0] — 2026-06-12

La actualización del juego: modos de equipo, salas públicas y mucho jugo.

### Agregado
- **Modos de juego**: todos contra todos (2–8), **1 vs 1** y **2 vs 2** con equipos,
  panel de equipos en el lobby con cambio de lado, scoreboard por equipo y puntaje
  compartido. El host elige el modo.
- **Salas públicas o privadas**: al crear una sala elegís visibilidad y nombre. Las
  públicas aparecen en una lista en la pantalla de inicio (host, jugadores, modo y
  estadio) y se entra con un click, sin código.
- **Sistema de READY**: el partido arranca solo cuando TODOS los jugadores marcan
  "¡Estoy listo!", con cuenta regresiva de 3 s (se cancela si alguien se baja o entra
  alguien nuevo).
- **4 estadios** elegidos por el host, con física propia: Clásico, Noche (reflectores
  y estrellas), Playa (la arena frena la pelota) y Nieve (resbaladizo, con copos).
- **Botines**: cada jugador tiene 2 pies con zancada animada por distancia recorrida —
  se lee clarísimo hacia dónde corre cada uno — y pose de barrida con polvito.
- **Física v1.1**: sub-steps anti-tunneling de la pelota, dribble asistido (llevás la
  pelota pegada al pie pero te la pueden robar), patadas que heredan tu velocidad,
  barrida con deslizamiento real de 0.38 s, rebotes pelota-jugador más vivos.
- **Relator en español** (voz del sistema vía speechSynthesis) con frases de relator
  argentino: "¡GOOOOOL de…!", "¡Tremenda patada!", "¡Está intratable!" — apagable.
- **Sonidos graciosos** sintetizados: slide-whistle + boing en la barrida, bocina de
  aire + ovación en el gol, doink de rebote, fanfarria kazoo del campeón.
- **Pantalla de opciones** (desde inicio, lobby y partido): volumen master en vivo,
  relator, calidad de efectos, vibración (móvil) y nombres visibles. Se guardan en el
  navegador, igual que tu nombre y selección.
- **Invitación por WhatsApp**: botón en el lobby que abre WhatsApp con el link de la
  sala listo para mandar (+ botón copiar link).
- **Mobile apaisado 100%**: joystick dinámico (aparece donde apoyás el dedo, zona
  izquierda), botones ⚽ y 🦵 a la derecha, fullscreen + bloqueo de orientación
  apaisada, aviso "girá el teléfono" y vibración en goles y barridas.

### Cambiado
- La revancha ahora vuelve a la sala de espera (con readies reseteados) en vez de
  arrancar el partido de una.
- El botón "Empezar partido" del host se reemplazó por el sistema de ready.

### Corregido
- El countdown no se cancelaba si un jugador se iba durante la cuenta (el partido
  podía arrancar con otra cantidad de arcos a la esperada).
- Sanitización de nombres de sala/jugador (defensa contra HTML malicioso).
- Mute y apagado del relator ahora aplican también al sonido que está sonando.
- Fullscreen/orientación en móvil se reintenta en el primer toque dentro del partido.
- La lista de salas públicas ya no parpadea al refrescarse cada 3 s.

## [1.0.0] — 2026-06-11

Primera versión jugable. 🎉

### Agregado
- **Salas online** con código de 4 letras y link de invitación copiable
  (`?room=CODE` precarga el código).
- **Sala de espera**: cada jugador elige nombre y selección entre 24 países
  (bandera emoji + colores de camiseta propios); el primero en entrar es host
  y puede arrancar el partido con 2 a 8 jugadores.
- **Cancha poligonal**: un arco por jugador — 3 jugadores forman un triángulo,
  4 un cuadrado, 5 un pentágono… hasta 8 (octágono). Con 2 jugadores la cancha
  es rectangular clásica. Cada arco mide 4 veces el diámetro del jugador y se
  pinta con el color y la bandera de su dueño.
- **Reglas**: la pelota cae en el centro; gol = **+1** para el autor y **−1**
  para el que lo recibe (el gol en contra solo resta). Gana el primero que
  llega a **3 puntos**. Tras cada gol: pausa, festejo y saque del medio con
  cuenta regresiva. Revancha al terminar.
- **Acciones**: moverse, patear (con cooldown) y barrida que deja tirado al
  rival ~0.9 s (cooldown 1.6 s).
- **Controles**: teclado (WASD/flechas + Espacio/J + Shift/K) y táctiles en
  celular (joystick virtual + botones ⚽/🦵).
- **Servidor autoritativo** en Node.js + `ws`: física a 60 Hz, broadcast a
  30 Hz, validación de todos los mensajes, cooldowns server-side, heartbeat,
  transferencia de host y aborto limpio del partido si alguien se desconecta.
- **Cliente** en vanilla JS: render canvas con interpolación de 100 ms,
  césped a franjas, arcos con glow y red, estela de pelota, partículas de gol,
  confetti de campeón y sonidos sintetizados con WebAudio.

### Seguridad
- Rechazo de paths con bytes de control en el server HTTP (un `GET /%00`
  tumbaba el proceso entero — encontrado por revisión adversarial antes del
  lanzamiento).
