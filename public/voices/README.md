# 🎙️ Packs de voz del relator — PoliGol

PoliGol trae un relator sintético (la voz del navegador). Si querés un relator
con **audio real** —tu propia voz, la de un amigo, lo que grabes— podés armar un
"pack de voz" poniendo archivos de audio en esta carpeta (`public/voices/`)
junto con un `manifest.json`. No hace falta tocar código.

## Cómo funciona

- Al entrar a un partido, el juego busca `voices/manifest.json` **una sola vez**
  (si no existe, sigue con la voz sintética, sin errores).
- Cada evento del partido tiene una lista de clips; el juego **elige uno al
  azar** cada vez (sin repetir el último si hay dos o más).
- Si el pack **no trae un evento** (o ninguno de sus archivos se pudo cargar),
  ese evento lo sigue relatando la voz sintética. El resto usa tus audios.
- Los clips **no se solapan**: si hay uno sonando, uno nuevo solo lo interrumpe
  si es un gol o el grito de campeón.
- El volumen lo controla el slider de sonido de Opciones (mute incluido), igual
  que los efectos del juego. En Opciones, bajo "Relator", vas a ver el nombre
  de tu pack cuando está activo.

## Paso a paso

1. Grabá tus clips (cortos: **1 a 4 segundos** anda perfecto) y guardalos en
   esta carpeta. Podés usar subcarpetas si querés (ej. `goles/gol1.mp3`).
2. Creá un archivo `manifest.json` en esta misma carpeta (ejemplo completo
   abajo). Las rutas son **relativas a `public/voices/`**.
3. Recargá la página y jugá un partido. Listo.

## Formatos de audio

Cualquier formato que decodifique el navegador vía WebAudio:

| Formato | Recomendación |
|---------|---------------|
| `.mp3`  | ✅ El más seguro (anda en todos los navegadores) |
| `.m4a` / `.aac` | ✅ Anda en todos los navegadores modernos |
| `.wav`  | ✅ Universal, pero archivos grandes |
| `.ogg`  | ⚠️ Anda en Chrome/Firefox; en Safari viejo puede fallar |

Consejos: volumen parejo entre clips (normalizá), sin silencios largos al
principio, mono y 96–128 kbps alcanzan de sobra.

## Eventos disponibles

| Evento    | Cuándo suena |
|-----------|--------------|
| `start`   | Al arrancar el partido (pitazo inicial) |
| `goal`    | Gol normal |
| `owngoal` | Gol en contra |
| `tackle`  | Una barrida que conecta a un rival |
| `streak`  | Gol de alguien que viene de meter el anterior (racha de 2+). Si no lo incluís, suena un clip de `goal` |
| `win`     | Fin del partido (campeón) |

Todos los eventos son **opcionales**: incluí los que tengas grabados.

## `manifest.json` de ejemplo (completo)

```json
{
  "name": "Mi relator",
  "events": {
    "start":   ["start1.mp3", "start2.mp3"],
    "goal":    ["gol1.mp3", "gol2.mp3", "gol3.mp3"],
    "owngoal": ["encontra1.mp3"],
    "tackle":  ["patada1.mp3"],
    "streak":  ["intratable1.mp3"],
    "win":     ["campeon1.mp3"]
  }
}
```

- `name`: el nombre que se muestra en Opciones.
- `events`: por cada evento, un array con uno o más archivos de audio.
- Los nombres de archivo son libres (los del ejemplo son solo una sugerencia).

## Probarlo rápido

1. Poné `manifest.json` y los audios en esta carpeta.
2. `npm start` y abrí `http://localhost:3000`.
3. En Opciones, verificá que el Relator esté activado y que abajo aparezca el
   nombre de tu pack (aparece al entrar al primer partido).
4. Jugá un partido (necesitás 2 jugadores: abrí una segunda pestaña) y meté un
   gol: tiene que sonar tu clip. Si un archivo está mal nombrado o no
   decodifica, ese evento cae a la voz sintética — revisá la consola de red
   (404) y los nombres del manifest.

## ⚠️ Derechos de autor

Usá **solamente audio propio o con licencia que te permita usarlo**: tu voz,
grabaciones de amigos (con su permiso) o bancos de sonido con licencia libre.
**No subas ni distribuyas audio de relatores reales, transmisiones de TV/radio
ni voces de videojuegos comerciales (PES/FIFA, etc.)**: es material con
copyright y distribuirlo puede traerte problemas legales, además de que no está
permitido en despliegues públicos de PoliGol.

> Nota: esta carpeta está en `.gitignore` (salvo este README), así que tus
> audios quedan locales y no se suben al repositorio por accidente.
