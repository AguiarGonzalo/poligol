# Changelog

Todos los cambios notables de PoliGol se documentan acá.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/) y el proyecto usa
versionado semántico.

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
