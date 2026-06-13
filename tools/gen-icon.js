// Genera el ícono de PoliGol como SVG (balón de fútbol sobre fondo de estadio).
// Uso: node tools/gen-icon.js [--maskable] > icon.svg   (luego se rasteriza con qlmanage)
// Sin dependencias. La geometría del balón se computa acá (pentágono central + 5
// alrededor + costuras), así no hay que escribir 30 puntos a mano.

const S = 512;
const maskable = process.argv.includes("--maskable");
const cx = S / 2;
const cy = S / 2;
// En maskable el arte importante va dentro del 80% central (la pelota más chica).
const ballR = maskable ? S * 0.3 : S * 0.345;

const rad = (d) => (d * Math.PI) / 180;
function pentPoints(px, py, r, rotDeg) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const a = rad(rotDeg + i * 72);
    pts.push((px + Math.cos(a) * r).toFixed(2) + "," + (py + Math.sin(a) * r).toFixed(2));
  }
  return pts.join(" ");
}

const black = "#15191f";
const pentagons = [];
// Pentágono central (un vértice apuntando arriba).
pentagons.push(`<polygon points="${pentPoints(cx, cy, ballR * 0.33, -90)}" fill="${black}"/>`);
// 5 pentágonos alrededor, apuntando hacia adentro.
const seams = [];
for (let i = 0; i < 5; i++) {
  const a = -90 + i * 72;
  const px = cx + Math.cos(rad(a)) * ballR * 0.64;
  const py = cy + Math.sin(rad(a)) * ballR * 0.64;
  pentagons.push(`<polygon points="${pentPoints(px, py, ballR * 0.2, a + 180)}" fill="${black}"/>`);
  // Costura: del centro al pentágono exterior.
  const ix = cx + Math.cos(rad(a)) * ballR * 0.3;
  const iy = cy + Math.sin(rad(a)) * ballR * 0.3;
  seams.push(`<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="rgba(0,0,0,0.18)" stroke-width="${(S * 0.01).toFixed(1)}"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16243f"/><stop offset="1" stop-color="#070b16"/>
    </linearGradient>
    <radialGradient id="green" cx="0.25" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#34c759" stop-opacity="0.5"/><stop offset="1" stop-color="#34c759" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gold" cx="0.82" cy="0.9" r="0.75">
      <stop offset="0" stop-color="#f5c542" stop-opacity="0.32"/><stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ball" cx="0.38" cy="0.34" r="0.72">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cdd7e6"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" fill="url(#green)"/>
  <rect width="${S}" height="${S}" fill="url(#gold)"/>
  <circle cx="${cx}" cy="${cy}" r="${ballR.toFixed(1)}" fill="url(#ball)"/>
  ${seams.join("\n  ")}
  ${pentagons.join("\n  ")}
  <circle cx="${cx}" cy="${cy}" r="${ballR.toFixed(1)}" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="${(S * 0.008).toFixed(1)}"/>
</svg>`;

process.stdout.write(svg);
