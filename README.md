# ⚽ PoliGol

Fútbol multijugador online en cancha poligonal: un arco por jugador.
3 jugadores → triángulo, 4 → cuadrado, 5 → pentágono… hasta 8.
Metés un gol: **+1**. Te meten un gol: **−1**. El primero que llega a **3** gana.

**Novedades v1.1**: modos **1v1 / 2v2 / todos contra todos**, salas **públicas** (se
entra desde la lista, sin código) o privadas, sistema de **ready** con cuenta regresiva,
**4 estadios** con física propia (¡la nieve resbala!), botines animados, relator en
español, sonidos graciosos, pantalla de opciones, invitación por **WhatsApp** y soporte
completo para celular apaisado (joystick + botones). Detalle en el
[CHANGELOG](CHANGELOG.md).

## Jugar online (deploy gratis)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AguiarGonzalo/poligol)

Un click en el botón, iniciás sesión en Render (sirve la cuenta de GitHub o Google),
**Apply** y en ~2 minutos tenés tu URL pública (`https://poligol-XXXX.onrender.com`)
para compartir con quien quieras. El [render.yaml](render.yaml) configura todo solo.

> Plan gratis de Render: si nadie entra por 15 minutos el server se duerme;
> el primero en volver espera ~1 minuto mientras despierta.

## Cómo correrlo local

```bash
git clone https://github.com/AguiarGonzalo/poligol.git
cd poligol
npm install      # solo la primera vez
npm start        # servidor en http://localhost:3000
```

## Cómo jugar con amigos

1. Poné tu nombre, elegí tu selección, nombrá tu sala y elegí si es **pública**
   (cualquiera la ve en la lista y entra sin código) o **privada**.
2. Invitá: botón de **WhatsApp** en la sala de espera, o copiá el link, o pasá el
   código de 4 letras.
3. El host elige **modo** (todos contra todos / 1v1 / 2v2) y **estadio** (Clásico,
   Noche, Playa, Nieve — cambian la física).
4. Cuando todos marcan **¡Estoy listo!**, el partido arranca solo (cuenta de 3).

### Para jugar por internet (no solo en tu casa)

- **Misma red (LAN):** tus amigos entran a `http://TU-IP-LOCAL:3000`
  (la ves con `ipconfig getifaddr en0`).
- **Internet:** la opción más fácil es un túnel:
  ```bash
  npx localtunnel --port 3000
  # o, si tenés ngrok: ngrok http 3000
  ```
  y compartís la URL que te da. También podés deployar la carpeta en cualquier
  hosting Node (Railway, Render, Fly.io) — el server usa `process.env.PORT`.

## Controles

| Acción | Teclado | Celular |
|--------|---------|---------|
| Moverse | WASD o flechas | Joystick (zona izquierda) |
| Patear | Espacio o J | Botón ⚽ |
| Barrida | Shift o K | Botón 🦵 |

La barrida deja tirado al rival ~1 segundo (cooldown 1.6 s). Si te metés un gol
en contra, solo restás vos: nadie suma.

## Cómo funciona

- `server.js` — Node.js + WebSocket (`ws`). Física autoritativa a 60 Hz,
  broadcast a 30 Hz. Salas con código, lobby, goles, puntajes y revancha.
- `public/` — cliente vanilla JS: render en canvas con interpolación de 100 ms,
  banderas emoji, confetti, sonidos sintetizados con WebAudio.
- `SPEC.md` — el contrato técnico completo (protocolo, geometría, constantes).
