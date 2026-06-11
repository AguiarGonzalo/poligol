# Changelog

Todos los cambios notables de PoliGol se documentan acá.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/) y el proyecto usa
versionado semántico.

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
