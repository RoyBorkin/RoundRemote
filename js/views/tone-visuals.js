// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The eight Tone Visual renderers. Each one is make(host, env) → { frame(F, t), resize(w, h), colors(env), destroy() }
// where F is the sound-feature frame from core/sound.js and env = { accent:[r,g,b], palette:[[r,g,b]…], art, lite }.
//
//   ferro     Ferrofluid     – black magnetic liquid in a glowing lamp: spikes rise with the bass,
//                              the fluid pulls together when it's loud and breaks into droplets when quiet
//   sphere    Liquid Sphere  – a 3D sphere whose surface is pushed out by noise driven by the music (WebGL)
//   bars      Spectrum Bars  – thin grey frequency bars on black with a faint reflection
//   ripple    Dot Ripple     – a 3D disc of dots; every beat sends a ripple out from the centre
//   cymatics  Cymatics       – sand on a vibrating plate collects on the nodal lines (Chladni figures);
//                              the figure changes with the sound
//   halo      Halo           – spectrum bars in a ring around the album art, with beat ripples and sparks
//   aurora    Aurora         – flowing colour smoke mixed from the album art's own colours (WebGL)
//   scope     Oscilloscope   – a glowing phosphor trace of the waveform with persistence
import { h } from '../ui/dom.js';
import { clamp } from '../core/util.js';
import { BANDS, WAVE } from '../core/sound.js';

const TAU = Math.PI * 2;
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function layer(host, cls, lite) {
  const c = h(`canvas.tv-layer${cls ? `.${cls}` : ''}`);
  host.appendChild(c);
  const g = c.getContext('2d');
  const o = { c, g, w: 0, h: 0, dpr: 1 };
  o.size = (w, hh) => {
    o.dpr = lite ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    c.width = Math.max(2, Math.round(w * o.dpr)); c.height = Math.max(2, Math.round(hh * o.dpr));
    o.w = c.width; o.h = c.height;
  };
  return o;
}

// Minimal full-screen fragment shader runner.
function glLayer(host, frag, scale) {
  const c = h('canvas.tv-layer.tv-gl');
  host.appendChild(c);
  let gl = null;
  try { gl = c.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }); } catch {}
  if (!gl) { c.remove(); return null; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pg = gl.createProgram();
  try {
    gl.attachShader(pg, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(pg);
    if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pg));
  } catch (e) { console.warn('Tone Visual shader:', e.message); c.remove(); return null; }
  gl.useProgram(pg);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pg, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  const u = (n) => (n in U ? U[n] : (U[n] = gl.getUniformLocation(pg, n)));
  return {
    c,
    set1(n, v) { gl.uniform1f(u(n), v); },
    set2(n, a, b) { gl.uniform2f(u(n), a, b); },
    set3(n, v) { gl.uniform3f(u(n), v[0] / 255, v[1] / 255, v[2] / 255); },
    draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); },
    size(w, hh) { c.width = Math.max(2, Math.round(w * scale)); c.height = Math.max(2, Math.round(hh * scale)); gl.viewport(0, 0, c.width, c.height); this.set2('uRes', c.width, c.height); },
    destroy() { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {} c.remove(); },
  };
}
const GLSL_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uT, uBass, uMid, uTre, uPulse, uLevel, uEnergy;
float h2(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float n2(vec2 x){ vec2 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
float h3(vec3 p){ p = fract(p*.3183099+.1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
`;
function setAudio(L, F, t) {
  L.set1('uT', t); L.set1('uBass', F.bass); L.set1('uMid', F.mid); L.set1('uTre', F.treble);
  L.set1('uPulse', F.pulse); L.set1('uLevel', F.level); L.set1('uEnergy', F.energy);
}
// light smoothing helper for arrays of values (fast attack, slower release)
function follow(arr, target, up, down) { for (let i = 0; i < arr.length; i++) { const v = target(i); arr[i] += (v - arr[i]) * (v > arr[i] ? up : down); } }

// =====================================================================================
// 1 · FERROFLUID
// =====================================================================================
function ferro(host, env) {
  const lamp = h('div.tv-lamp');
  host.appendChild(lamp);
  const goo = layer(host, 'tv-goo', true);
  const top = layer(host, '', env.lite);
  const SP = 26;
  const spikes = new Float32Array(SP);
  const drops = Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * TAU, sp: 0.25 + Math.random() * 0.3, k: 0.7 + Math.random() * 0.6 }));
  let S = 0, gather = 0.5, rot = 0, lastT = 0;
  return {
    resize(w, hh) {
      goo.size(w * 0.5, hh * 0.5); // the goo is blurred anyway, so half resolution is plenty
      top.size(w, hh);
      S = Math.min(w, hh);
      goo.c.style.filter = env.lite ? 'none' : `blur(${(S * 0.016).toFixed(1)}px) contrast(28)`;
    },
    colors() {},
    frame(F, t) {
      const dt = Math.min(0.1, t - lastT || 0.016); lastT = t;
      gather += (clamp(F.energy * 0.8 + F.level * 1.1 + F.pulse * 0.4, 0, 1) - gather) * Math.min(1, dt * 1.6);
      rot += dt * (0.05 + F.mid * 0.25);
      // --- goo layer (half-res): body lobes + droplets, white background
      const g = goo.g, gw = goo.w, gh = goo.h, gs = Math.min(gw, gh), gcx = gw / 2, gcy = gh / 2;
      g.fillStyle = '#fff'; g.fillRect(0, 0, gw, gh);
      g.fillStyle = '#000';
      const R = gs * (0.1 + 0.045 * gather + 0.03 * F.bass + 0.02 * F.pulse);
      g.beginPath(); g.arc(gcx, gcy, R, 0, TAU); g.fill();
      for (let k = 0; k < 3; k++) { // wobbling lobes keep the body organic
        const a = t * (0.4 + k * 0.17) + k * 2.1, d = R * (0.28 + 0.12 * Math.sin(t * 0.7 + k));
        g.beginPath(); g.arc(gcx + Math.cos(a) * d, gcy + Math.sin(a) * d, R * (0.72 - k * 0.08), 0, TAU); g.fill();
      }
      drops.forEach((d, i) => {
        d.a += dt * d.sp * (0.4 + F.level);
        const far = 1 - gather;
        const dist = R * 0.6 + gs * (0.04 + 0.22 * far * (0.6 + 0.4 * Math.sin(t * 0.5 + i * 1.7)));
        const r = gs * 0.034 * d.k * (0.6 + 0.6 * far);
        g.beginPath(); g.arc(gcx + Math.cos(d.a) * dist, gcy + Math.sin(d.a) * dist * 0.92, r, 0, TAU); g.fill();
      });
      // --- crisp spikes + highlights at full resolution
      const o = top.g, w = top.w, hh = top.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
      o.clearRect(0, 0, w, hh);
      const Rb = s * (0.1 + 0.045 * gather + 0.03 * F.bass + 0.02 * F.pulse);
      const amp = s * (0.015 + 0.2 * F.bass * (0.4 + 0.6 * gather) + 0.09 * F.pulse);
      follow(spikes, (i) => {
        const k = i < SP / 2 ? i : SP - 1 - i; // mirror so the crown looks balanced
        return 0.35 + 0.65 * F.spectrum[2 + Math.floor((k / (SP / 2)) * 30)];
      }, 0.45, 0.08);
      o.fillStyle = '#050505';
      const pw = (TAU / SP) * 0.42;
      const P = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      for (let i = 0; i < SP; i++) {
        const a = rot + (i / SP) * TAU;
        const L = amp * spikes[i];
        if (L < s * 0.008) continue;
        const r0 = Rb * 0.9;
        const [lx, ly] = P(r0, a - pw), [rx, ry] = P(r0, a + pw), [tx, ty] = P(Rb + L, a);
        const [c1x, c1y] = P(Rb + L * 0.18, a - pw * 0.28), [c2x, c2y] = P(Rb + L * 0.18, a + pw * 0.28);
        o.beginPath(); o.moveTo(lx, ly); o.quadraticCurveTo(c1x, c1y, tx, ty); o.quadraticCurveTo(c2x, c2y, rx, ry); o.closePath(); o.fill();
      }
      // glossy highlight on the body
      const hx = cx - Rb * 0.35, hy = cy - Rb * 0.4;
      const hg = o.createRadialGradient(hx, hy, 0, hx, hy, Rb * 0.5);
      hg.addColorStop(0, 'rgba(255,255,255,.55)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = hg; o.beginPath(); o.ellipse(hx, hy, Rb * 0.42, Rb * 0.26, -0.6, 0, TAU); o.fill();
    },
    destroy() { lamp.remove(); goo.c.remove(); top.c.remove(); },
  };
}

// =====================================================================================
// 2 · LIQUID SPHERE (WebGL, 2D fallback)
// =====================================================================================
const SPHERE_FRAG = `${GLSL_HEAD}
uniform vec3 uA, uB;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float disp(vec3 p){
  return (n3(p*1.9 + vec3(0., uT*.35, 0.)) - .5) * (.1 + .42*uBass)
       + (n3(p*5.2 - vec3(uT*.55)) - .5) * (.05 + .2*uTre + .08*uMid);
}
float map(vec3 p){
  p.xz = rot(uT*.23) * p.xz; p.yz = rot(.35) * p.yz;
  return (length(p) - (.9 + .12*uPulse + .08*uLevel) - disp(p)) * .5;
}
void main(){
  vec2 uv = (gl_FragCoord.xy*2. - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0., 0., 3.3), rd = normalize(vec3(uv, -2.1));
  float glow = smoothstep(1.35, .1, length(uv));
  vec3 col = mix(vec3(.012), uA*.22, glow*glow) * (.7 + .6*uEnergy);
  float b = dot(ro, rd), c = dot(ro, ro) - 1.75*1.75, disc = b*b - c;
  if (disc > 0.) {
    float t = -b - sqrt(disc), tmax = -b + sqrt(disc);
    bool hit = false; float d = 1.;
    for (int i = 0; i < 56; i++) {
      d = map(ro + rd*t);
      if (d < .0015) { hit = true; break; }
      t += d; if (t > tmax) break;
    }
    if (!hit && d < .02 && t < tmax) hit = true; // grazing rays at the silhouette
    if (hit) {
      vec3 p = ro + rd*t;
      const vec2 k = vec2(1., -1.); float e = .008;
      vec3 n = normalize(k.xyy*map(p + k.xyy*e) + k.yyx*map(p + k.yyx*e) + k.yxy*map(p + k.yxy*e) + k.xxx*map(p + k.xxx*e));
      vec3 L = normalize(vec3(.55, .75, .65)), v = -rd;
      float dif = max(dot(n, L), 0.);
      float spec = pow(max(dot(reflect(-L, n), v), 0.), 36.);
      float fr = pow(1. - max(dot(n, v), 0.), 3.);
      float cav = clamp(length(p)*1.05 - .55, 0., 1.);
      vec3 base = mix(uA*.35, uB, cav);
      col = base*(.12 + .95*dif) + spec*vec3(1., .96, .88) + fr*uB*.55;
    }
  }
  gl_FragColor = vec4(pow(col, vec3(.4545)), 1.);
}`;
function sphere(host, env) {
  const L = glLayer(host, SPHERE_FRAG, env.lite ? 0.34 : 0.55);
  if (!L) return sphere2d(host, env);
  let A = [240, 150, 40], B = [255, 214, 120];
  const colors = (e) => {
    const a = e.accent || [240, 150, 40];
    A = a; B = mix(a, [255, 236, 190], 0.55);
  };
  colors(env);
  return {
    resize(w, hh) { L.size(w, hh); },
    colors,
    frame(F, t) { setAudio(L, F, t); L.set3('uA', A); L.set3('uB', B); L.draw(); },
    destroy() { L.destroy(); },
  };
}
function sphere2d(host, env) {
  const c = layer(host, '', env.lite);
  let A = env.accent || [240, 150, 40];
  return {
    resize(w, hh) { c.size(w, hh); }, colors(e) { A = e.accent || A; },
    frame(F, t) {
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
      g.fillStyle = '#030303'; g.fillRect(0, 0, w, hh);
      const R = s * (0.27 + 0.03 * F.pulse);
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * TAU;
        const r = R * (1 + 0.1 * F.bass * Math.sin(a * 5 + t * 1.3) + 0.05 * F.treble * Math.sin(a * 13 - t * 2.1) + 0.03 * Math.sin(a * 3 + t * 0.7));
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      const gr = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.1);
      gr.addColorStop(0, '#fff6dc'); gr.addColorStop(0.35, rgb(mix(A, [255, 230, 170], 0.5))); gr.addColorStop(1, rgb(mix(A, [0, 0, 0], 0.7)));
      g.fillStyle = gr; g.fill();
    },
    destroy() { c.c.remove(); },
  };
}

// =====================================================================================
// 3 · SPECTRUM BARS
// =====================================================================================
function bars(host, env) {
  const c = layer(host, '', env.lite);
  const N = 48;
  const v = new Float32Array(N), peak = new Float32Array(N);
  let A = env.accent || [180, 190, 200];
  return {
    resize(w, hh) { c.size(w, hh); }, colors(e) { A = e.accent || A; },
    frame(F) {
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
      g.fillStyle = '#000'; g.fillRect(0, 0, w, hh);
      follow(v, (i) => { const x = 2 + (i / (N - 1)) * (BANDS - 6); const i0 = Math.floor(x), f = x - i0; return F.spectrum[i0] * (1 - f) + F.spectrum[i0 + 1] * f; }, 0.55, 0.12);
      const span = s * 0.8, step = span / N, bw = step * 0.44, x0 = cx - span / 2 + (step - bw) / 2;
      const base = cy + s * 0.07, H = s * 0.34;
      for (let i = 0; i < N; i++) {
        const bh = Math.max(s * 0.004, v[i] ** 1.25 * H);
        peak[i] = Math.max(peak[i] - s * 0.0009, bh);
        const x = x0 + i * step;
        g.fillStyle = '#7d828a';
        g.fillRect(x, base - bh, bw, bh);
        g.fillStyle = 'rgba(125,130,138,.16)'; // reflection
        g.fillRect(x, base + s * 0.006, bw, bh * 0.38);
        g.fillStyle = rgb(mix(A, [255, 255, 255], 0.3), 0.8);
        g.fillRect(x, base - peak[i] - s * 0.009, bw, s * 0.004);
      }
    },
    destroy() { c.c.remove(); },
  };
}

// =====================================================================================
// 4 · DOT RIPPLE
// =====================================================================================
function ripple(host, env) {
  const c = layer(host, '', env.lite);
  const RINGS = env.lite ? 16 : 26;
  const pts = [];
  for (let i = 1; i <= RINGS; i++) {
    const n = Math.max(6, Math.round(i * 6.4));
    for (let j = 0; j < n; j++) pts.push({ ring: i, r: i / RINGS, a: (j / n) * TAU + (i % 2 ? Math.PI / n : 0) });
  }
  const HIST = 512;
  const hist = new Float32Array(HIST);
  let head = 0, acc = 0, lastT = 0, A = env.accent || [200, 220, 255];
  const LAG = 3; // samples (at 60 Hz) per ring → ripple speed
  const buckets = Array.from({ length: 10 }, () => []);
  return {
    resize(w, hh) { c.size(w, hh); }, colors(e) { A = e.accent || A; },
    frame(F, t) {
      const dt = Math.min(0.1, t - lastT || 0.016); lastT = t;
      acc += dt;
      const drive = F.bass * 0.55 + F.pulse * 0.6;
      while (acc >= 1 / 60) { acc -= 1 / 60; head = (head + 1) % HIST; hist[head] = drive; }
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2 - s * 0.02;
      g.fillStyle = '#000'; g.fillRect(0, 0, w, hh);
      const R = s * 0.43, el = 0.6, sinE = Math.sin(el), cosE = Math.cos(el), rot = t * 0.08;
      // soft glow under the disc
      const gg = g.createRadialGradient(cx, cy + R * 0.25, 0, cx, cy + R * 0.25, R * 1.1);
      gg.addColorStop(0, rgb(mix(A, [255, 255, 255], 0.6), 0.1 + 0.18 * F.level)); gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg; g.fillRect(0, 0, w, hh);
      buckets.forEach((b) => { b.length = 0; });
      const ringH = new Float32Array(RINGS + 1);
      for (let i = 1; i <= RINGS; i++) ringH[i] = hist[(head - i * LAG + HIST * 4) % HIST] * (1 - (i / RINGS) * 0.55);
      for (const p of pts) {
        const a = p.a + rot;
        const band = F.spectrum[Math.min(BANDS - 1, 4 + Math.floor(p.r * 50))];
        const y = ringH[p.ring] * 0.34 + band * 0.07 * Math.sin(a * 4 - t * 1.5) * p.r + F.treble * 0.04 * Math.sin(a * 9 + t * 3) * p.r;
        const x = Math.cos(a) * p.r, z = Math.sin(a) * p.r;
        const per = 1 / (1 - 0.28 * z * cosE);
        const sx = cx + x * R * per, sy = cy + R * per * (z * sinE - y * cosE);
        const br = clamp(0.25 + y * 2.4 + 0.25 * (z + 1) * 0.5, 0.08, 1);
        buckets[Math.min(9, Math.floor(br * 10))].push(sx, sy, (0.9 + 1.3 * per + br) * (s / 720));
      }
      buckets.forEach((b, k) => {
        if (!b.length) return;
        g.fillStyle = `rgba(255,255,255,${(0.12 + k * 0.095).toFixed(3)})`;
        for (let i = 0; i < b.length; i += 3) g.fillRect(b[i] - b[i + 2] / 2, b[i + 1] - b[i + 2] / 2, b[i + 2], b[i + 2]);
      });
    },
    destroy() { c.c.remove(); },
  };
}

// =====================================================================================
// 5 · CYMATICS (Chladni plate)
// =====================================================================================
const MODES = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7], [1, 6], [4, 7], [5, 6], [5, 7], [3, 8], [6, 7], [5, 8]];
function cymatics(host, env) {
  const plate = layer(host, '', true);
  const c = layer(host, '', env.lite);
  const N = env.lite ? 2200 : 5200;
  const px = new Float32Array(N), py = new Float32Array(N);
  const spawn = (i) => { const r = Math.sqrt(Math.random()) * 0.98, a = Math.random() * TAU; px[i] = Math.cos(a) * r; py[i] = Math.sin(a) * r; };
  for (let i = 0; i < N; i++) spawn(i);
  let mode = 2, sign = -1, rot45 = false, since = 0, lastT = 0, hz = 1033;
  function drawPlate() {
    const g = plate.g, w = plate.w, hh = plate.h, s = Math.min(w, hh);
    const gr = g.createRadialGradient(w * 0.45, hh * 0.4, 0, w / 2, hh / 2, s * 0.72);
    gr.addColorStop(0, '#2a2d31'); gr.addColorStop(0.6, '#16181b'); gr.addColorStop(1, '#0b0c0e');
    g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    g.globalAlpha = 0.05; // faint brushed-metal speckle
    for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; g.fillRect(Math.random() * w, Math.random() * hh, 1, 1); }
    g.globalAlpha = 1;
  }
  return {
    resize(w, hh) { plate.size(w, hh); c.size(w, hh); drawPlate(); },
    colors() {},
    frame(F, t) {
      const dt = Math.min(0.1, t - lastT || 0.016); lastT = t;
      since += dt;
      // choose the figure from the sound's brightness + pitch; hold each for a while so the sand can settle
      const want = (Math.floor(clamp((F.centroid - 0.12) / 0.4, 0, 0.999) * 6) + F.note) % MODES.length;
      if (want !== mode && since > 3.2 && F.level > 0.05) {
        mode = want; since = 0; sign = F.note % 2 ? 1 : -1; rot45 = F.note % 5 === 0;
        const [n0, m0] = MODES[mode]; hz = Math.round(180 + (n0 * n0 + m0 * m0) * 62 + F.note * 7);
      }
      const [n, m] = MODES[mode];
      const pn = Math.PI * n, pm = Math.PI * m;
      const vib = clamp(F.level * 1.3 + F.pulse * 0.7, 0, 1.6);
      const k = (0.006 * vib * Math.min(3, dt * 60)) / (pn + pm);
      const jit = 0.022 * vib;
      const cr = Math.SQRT1_2;
      for (let i = 0; i < N; i++) {
        let x = px[i], y = py[i];
        let u = x, v = y;
        if (rot45) { u = (x - y) * cr; v = (x + y) * cr; }
        const cnu = Math.cos(pn * u), cmv = Math.cos(pm * v), cmu = Math.cos(pm * u), cnv = Math.cos(pn * v);
        const f = cnu * cmv + sign * cmu * cnv;
        const fu = -pn * Math.sin(pn * u) * cmv - sign * pm * Math.sin(pm * u) * cnv;
        const fv = -pm * cnu * Math.sin(pm * v) - sign * pn * cmu * Math.sin(pn * v);
        let du = -f * fu * k, dv = -f * fv * k;
        if (rot45) { const dx = (du + dv) * cr, dy = (dv - du) * cr; du = dx; dv = dy; }
        const a = Math.abs(f);
        x += du + (Math.random() - 0.5) * a * jit;
        y += dv + (Math.random() - 0.5) * a * jit;
        if (x * x + y * y > 0.985) spawn(i); else { px[i] = x; py[i] = y; }
      }
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2, R = s * 0.5;
      g.clearRect(0, 0, w, hh);
      g.fillStyle = 'rgba(236,233,224,.88)';
      const sz = Math.max(1, s / 520);
      for (let i = 0; i < N; i++) g.fillRect(cx + px[i] * R, cy + py[i] * R, sz, sz);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.font = `600 ${Math.round(s * 0.024)}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(`${hz} Hz`, cx, cy + s * 0.41);
    },
    destroy() { plate.c.remove(); c.c.remove(); },
  };
}

// =====================================================================================
// 6 · HALO (suggested)
// =====================================================================================
function halo(host, env) {
  const c = layer(host, '', env.lite);
  const K = 60; // bars per half
  const v = new Float32Array(K);
  let A = env.accent || [120, 180, 255], P = env.palette || [A];
  let img = null, imgUrl = null;
  const rings = [], sparks = [];
  const loadArt = (url) => {
    if (url === imgUrl) return;
    imgUrl = url; img = null;
    if (!url) return;
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { if (imgUrl === url) img = im; };
    im.src = url;
  };
  loadArt(env.art);
  let lastT = 0;
  return {
    resize(w, hh) { c.size(w, hh); },
    colors(e) { A = e.accent || A; P = e.palette?.length ? e.palette : [A]; loadArt(e.art); },
    frame(F, t) {
      const dt = Math.min(0.1, t - lastT || 0.016); lastT = t;
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
      g.fillStyle = '#050507'; g.fillRect(0, 0, w, hh);
      const bg = g.createRadialGradient(cx, cy, s * 0.1, cx, cy, s * 0.55);
      bg.addColorStop(0, rgb(A, 0.14 + 0.2 * F.level)); bg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bg; g.fillRect(0, 0, w, hh);
      const Ra = s * 0.2 * (1 + 0.07 * F.pulse + 0.03 * F.bass);
      follow(v, (i) => F.spectrum[2 + Math.floor((i / K) * 54)], 0.6, 0.14);
      const lw = ((TAU * (Ra + s * 0.03)) / (K * 2)) * 0.5;
      g.lineCap = 'round'; g.lineWidth = lw;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < K; i++) {
          const a = -Math.PI / 2 + side * ((i + 0.5) / K) * Math.PI;
          const len = s * 0.012 + v[i] ** 1.2 * s * 0.19;
          const r0 = Ra + s * 0.028;
          const col = P[Math.floor((i / K) * P.length) % P.length] || A;
          g.strokeStyle = rgb(mix(col, [255, 255, 255], 0.25 + 0.35 * v[i]), 0.55 + 0.45 * v[i]);
          g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); g.stroke();
        }
      }
      if (F.beat) {
        rings.push({ r: Ra, a: 0.8 });
        for (let i = 0; i < 14; i++) { const a = Math.random() * TAU; sparks.push({ x: cx + Math.cos(a) * Ra, y: cy + Math.sin(a) * Ra, vx: Math.cos(a), vy: Math.sin(a), sp: s * (0.15 + Math.random() * 0.35), life: 1 }); }
      }
      g.lineWidth = s * 0.004;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.r += dt * s * 0.35; r.a -= dt * 0.9;
        if (r.a <= 0) { rings.splice(i, 1); continue; }
        g.strokeStyle = rgb(A, r.a * 0.6); g.beginPath(); g.arc(cx, cy, r.r, 0, TAU); g.stroke();
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.x += p.vx * p.sp * dt; p.y += p.vy * p.sp * dt; p.life -= dt * 1.3;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        g.fillStyle = rgb(mix(A, [255, 255, 255], 0.6), p.life); g.fillRect(p.x, p.y, s * 0.005, s * 0.005);
      }
      // the artwork
      g.save(); g.beginPath(); g.arc(cx, cy, Ra, 0, TAU); g.clip();
      if (img) g.drawImage(img, cx - Ra, cy - Ra, Ra * 2, Ra * 2);
      else { const ag = g.createLinearGradient(cx - Ra, cy - Ra, cx + Ra, cy + Ra); ag.addColorStop(0, rgb(A)); ag.addColorStop(1, rgb(mix(A, [0, 0, 0], 0.6))); g.fillStyle = ag; g.fillRect(cx - Ra, cy - Ra, Ra * 2, Ra * 2); }
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = s * 0.003; g.beginPath(); g.arc(cx, cy, Ra, 0, TAU); g.stroke();
    },
    destroy() { c.c.remove(); },
  };
}

// =====================================================================================
// 7 · AURORA (suggested) — WebGL, 2D fallback
// =====================================================================================
const AURORA_FRAG = `${GLSL_HEAD}
uniform vec3 uC0, uC1, uC2, uC3;
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*n2(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
void main(){
  vec2 uv = (gl_FragCoord.xy*2. - uRes) / min(uRes.x, uRes.y);
  float t = uT*.06;
  vec2 p = uv*(1.25 - .15*uBass);
  vec2 q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.2*q + vec2(1.7, 9.2) + t*1.7 + .5*uBass), fbm(p + 3.2*q + vec2(8.3, 2.8) - t*1.3));
  float f = fbm(p + 3.5*r);
  vec3 col = mix(uC0, uC1, smoothstep(.15, .85, f));
  col = mix(col, uC2, smoothstep(.35, 1., length(q)) * .85);
  col = mix(col, uC3, smoothstep(.45, .95, r.x) * .7);
  float lum = .28 + .55*uLevel + .45*uPulse + .25*uEnergy;
  col *= lum * (.55 + f*f*1.6);
  col += uTre * .12 * n2(uv*38. + uT*4.) * col;
  col *= smoothstep(1.45, .55, length(uv));
  gl_FragColor = vec4(pow(clamp(col, 0., 1.), vec3(.85)), 1.);
}`;
const DEF_PAL = [[40, 90, 255], [255, 60, 150], [30, 220, 190], [255, 190, 60]];
function aurora(host, env) {
  const L = glLayer(host, AURORA_FRAG, env.lite ? 0.3 : 0.5);
  let pal = DEF_PAL;
  const colors = (e) => {
    const p = (e.palette || []).map((c) => mix(c, [255, 255, 255], 0.08));
    while (p.length < 4) p.push(p.length ? mix(p[p.length - 1], DEF_PAL[p.length], 0.5) : (e.accent || DEF_PAL[0]));
    pal = p;
  };
  colors(env);
  if (!L) return aurora2d(host, () => pal);
  return {
    resize(w, hh) { L.size(w, hh); }, colors,
    frame(F, t) { setAudio(L, F, t); L.set3('uC0', pal[0]); L.set3('uC1', pal[1]); L.set3('uC2', pal[2]); L.set3('uC3', pal[3]); L.draw(); },
    destroy() { L.destroy(); },
  };
}
function aurora2d(host, pal) {
  const c = layer(host, '', true);
  return {
    resize(w, hh) { c.size(w, hh); }, colors() {},
    frame(F, t) {
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, w, hh);
      g.globalCompositeOperation = 'lighter';
      pal().forEach((col, i) => {
        const x = w / 2 + Math.cos(t * 0.13 + i * 1.7) * s * 0.22, y = hh / 2 + Math.sin(t * 0.11 + i * 2.3) * s * 0.22;
        const r = s * (0.35 + 0.12 * F.bass);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgb(col, 0.35 + 0.4 * F.level)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, hh);
      });
      g.globalCompositeOperation = 'source-over';
    },
    destroy() { c.c.remove(); },
  };
}

// =====================================================================================
// 8 · OSCILLOSCOPE (suggested)
// =====================================================================================
const LISSA = [[1, 2], [2, 3], [3, 4], [1, 3], [3, 5], [2, 5], [4, 5], [1, 1], [3, 2], [5, 6], [2, 1], [5, 4]];
function scope(host, env) {
  let curRatio = LISSA[0], phase = 0;
  const grid = layer(host, '', true);
  const c = layer(host, 'tv-scope', env.lite);
  const PH = '57,255,156';
  function drawGrid() {
    const g = grid.g, w = grid.w, hh = grid.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
    g.fillStyle = '#010604'; g.fillRect(0, 0, w, hh);
    g.strokeStyle = `rgba(${PH},.1)`; g.lineWidth = Math.max(1, s / 720);
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, (s * 0.46 * i) / 4, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - s * 0.46, cy); g.lineTo(cx + s * 0.46, cy); g.moveTo(cx, cy - s * 0.46); g.lineTo(cx, cy + s * 0.46); g.stroke();
    g.fillStyle = `rgba(${PH},.16)`;
    for (let i = -10; i <= 10; i++) if (i) { g.fillRect(cx + (i * s * 0.046) - 1, cy - s * 0.008, 2, s * 0.016); g.fillRect(cx - s * 0.008, cy + (i * s * 0.046) - 1, s * 0.016, 2); }
  }
  return {
    resize(w, hh) { grid.size(w, hh); c.size(w, hh); drawGrid(); },
    colors() {},
    frame(F) {
      const g = c.g, w = c.w, hh = c.h, s = Math.min(w, hh), cx = w / 2, cy = hh / 2;
      // phosphor persistence: fade what was drawn before instead of clearing it
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, 0, w, hh);
      g.globalCompositeOperation = 'lighter';
      const W = F.wave;
      const R = s * 0.34 * (0.55 + 0.6 * clamp(F.level * 1.4, 0, 1));
      // live mic: phase portrait of the real waveform (x = now, y = a moment later);
      // simulated: a clean Lissajous figure whose ratio follows the bass note, wobbled by the sound
      const ratio = LISSA[F.note % LISSA.length];
      if (ratio !== curRatio) { curRatio = ratio; }
      phase += 0.012 + F.mid * 0.03;
      const path = () => {
        g.beginPath();
        const n = F.live ? WAVE : 720;
        for (let i = 0; i <= n; i++) {
          let x, y;
          if (F.live) { const k = i % WAVE; x = W[k]; y = W[(k + 14) % WAVE]; }
          else {
            const u = (i / n) * TAU, wob = 1 + 0.06 * F.treble * Math.sin(u * 23 + phase * 7) + 0.18 * F.pulse * Math.sin(u * 2);
            x = Math.sin(curRatio[0] * u + phase) * wob * 0.9; y = Math.sin(curRatio[1] * u) * wob * 0.9;
          }
          g[i ? 'lineTo' : 'moveTo'](cx + x * R, cy - y * R);
        }
      };
      path();
      g.lineJoin = 'round';
      g.strokeStyle = `rgba(${PH},.07)`; g.lineWidth = s * 0.02; g.stroke();
      g.strokeStyle = `rgba(${PH},.22)`; g.lineWidth = s * 0.008; g.stroke();
      g.strokeStyle = 'rgba(210,255,230,.85)'; g.lineWidth = Math.max(1, s * 0.0024); g.stroke();
      // a faint circular trace of the same waveform around the edge
      g.beginPath();
      for (let i = 0; i <= WAVE; i++) {
        const k = i % WAVE, a = (i / WAVE) * TAU - Math.PI / 2, r = s * 0.43 + W[k] * s * 0.025;
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.strokeStyle = `rgba(${PH},.35)`; g.lineWidth = Math.max(1, s * 0.002); g.stroke();
      g.globalCompositeOperation = 'source-over';
    },
    destroy() { grid.c.remove(); c.c.remove(); },
  };
}

export const TONE_RENDERERS = { ferro, sphere, bars, ripple, cymatics, halo, aurora, scope };
export const TONE_VARIANTS = [
  { id: 'ferro', name: 'Ferrofluid' },
  { id: 'sphere', name: 'Liquid Sphere' },
  { id: 'bars', name: 'Spectrum Bars' },
  { id: 'ripple', name: 'Dot Ripple' },
  { id: 'cymatics', name: 'Cymatics' },
  { id: 'halo', name: 'Halo' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'scope', name: 'Oscilloscope' },
];
