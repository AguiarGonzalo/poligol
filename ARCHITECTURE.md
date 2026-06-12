# PoliGol — Arquitectura y escalabilidad (v1.2)

## Diseño actual: un solo proceso, todo en memoria

Un único proceso Node sirve `public/` por http y monta WebSocket (`ws`) sobre el
mismo server. Todo el estado (salas, jugadores, partidos) vive en memoria: no hay
base de datos ni estado compartido. Decisiones de la sección E del SPEC v1.2:

- **Loop global**: UN solo `setInterval` a 60 Hz itera las salas en estado
  `playing` (las salas en lobby no se procesan). Broadcast de estado a 30 Hz con
  **un solo `JSON.stringify` por sala** (el mismo string va a los N jugadores).
- **Snapshots compactos**: posiciones/velocidades redondeadas a 1 decimal y campos
  `stun`/`kc`/`slide` omitidos cuando valen 0 (el cliente asume 0 si faltan).
- **Backpressure por conexión**: si `bufferedAmount > 64 KB` se saltea el snapshot
  de esa conexión ese ciclo (no se encola); si supera 512 KB se cierra (zombi).
- **Límites anti-abuso**: máx. conexiones `MAX_CONN` (env, default 4000), máx.
  1000 salas (`"Servidor lleno"` al superar) y rate limit de mensajes por conexión
  (corte real a 90 msg/s: 60/s de input legítimo + pings/ráfagas; el exceso cierra).
- **Observabilidad**: `GET /health` → `{ok, uptime}` (health check de Render) y
  `GET /metrics` → `{rooms, playing, players, tickAvgMs, tickP95Ms, rssMB}` con
  ventana móvil de 10 s.

## Capacidad de un proceso

Meta v1.2: **250 salas × 4 jugadores (1000 conexiones WS)** en un proceso con
**tick medio < 8 ms** y memoria estable. Cómo medir en local:

```bash
PORT=3000 node server.js &
node tools/loadtest.js --url ws://localhost:3000 --rooms 250 --players 4 --minutes 5
curl -s http://localhost:3000/metrics   # durante y al final de la corrida
```

Resultados medidos (Apple Silicon local, Node 22, dos corridas consecutivas de
1 min con `--rooms 250 --players 4`, loopback):

| Métrica                          | Valor medido                                    |
|----------------------------------|-------------------------------------------------|
| Salas × jugadores                | 250 × 4 = **1000 conexiones WS**, 245–250 salas en juego sostenidas |
| `tickAvgMs` / `tickP95Ms`        | **3.5–3.7 ms / 4.2–4.4 ms** bajo carga plena (presupuesto: 8 ms) |
| msgs/s recibidos por los bots    | **~31 300–31 600/s** en régimen (1.70 M mensajes por corrida) |
| RTT p50 / p95 (loopback)         | **0 ms / 5 ms** (27 900 muestras por corrida)   |
| `rssMB` (inicio → fin, estable)  | 51.7 en frío → **180.8** tras la corrida 1 → **187.3** tras la corrida 2 (meseta del heap de V8, plana dentro de cada corrida: sin leak) |
| Errores / cierres inesperados    | **0 / 0** en ambas corridas (exit 0)            |
| Limpieza post-corrida            | `/metrics` vuelve a `rooms:0, playing:0, players:0` |

Criterio de aprobación: `tickAvgMs < 8`, `tickP95Ms` sin picos sostenidos, `rssMB`
sin crecimiento entre el minuto 1 y el final, 0 errores en el resumen del loadtest.
**Resultado: APROBADO** — el tick p95 usa ~55 % del presupuesto con 1000 jugadores;
la meta de la sección E del SPEC v1.2 se cumple con margen en un solo proceso.

## Render: límites del plan free y recomendación

- **Free**: ~0.1 CPU compartida y 512 MB, y la instancia se **duerme** tras ~15 min
  sin tráfico: el primer jugador sufre un cold start de decenas de segundos y
  cualquier partido en curso muere con el proceso. Sirve solo como demo; con 0.1
  CPU el tick a 60 Hz se degrada con pocas decenas de salas activas.
- **Recomendación**: plan **Starter** como mínimo (sin sleep, 0.5 CPU / 512 MB)
  para uso real con decenas de salas. Para la meta de 1000 jugadores simultáneos,
  **Standard** (1 CPU dedicada / 2 GB): el proceso es single-thread, así que más
  vCPUs no ayudan — importa 1 core entero y estable.
- Configurar el health check del servicio a `GET /health` (responde 200 con
  `{ok:true}`) y vigilar `GET /metrics` (alertar si `tickP95Ms` se acerca a 16 ms,
  el presupuesto del tick de 60 Hz).

## Camino horizontal futuro (documentado, NO implementado)

Cuando un proceso no alcance, el juego shardea naturalmente por sala (las salas no
comparten estado entre sí):

1. **Sharding de salas por instancia**: N instancias del mismo `server.js`; cada
   sala vive completa (jugadores + física) en UNA instancia.
2. **Directorio de salas compartido**: un store externo chico (p. ej. Redis) con
   `código → instancia` y los metadatos de la lista pública (`roomName`, host,
   count, mode, stadium). `listRooms`/`subRooms` leen del directorio; cada
   instancia publica los cambios de sus salas.
3. **Sticky por código de sala**: el join rutea la conexión WS a la instancia
   dueña del código (hash/lookup en el directorio, vía load balancer con afinidad
   o redirección del cliente a la URL de la instancia). `create` elige la
   instancia menos cargada y registra el código en el directorio.

Nada de esto se necesita hasta superar de forma sostenida la capacidad medida
arriba; el contrato WS actual no cambia con el sharding.
