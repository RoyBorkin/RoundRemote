// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Pull a lively accent colour out of album artwork (falls back silently if the image
// server doesn't allow CORS reads).
const cache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}

export function accentFromImage(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (v) => { cache.set(url, v); resolve(v); };
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const N = 28;
        const c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        // Bucket hues, weight by saturation * mid-lightness, pick the heaviest bucket.
        const buckets = new Array(24).fill(0).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          const w = s * s * (1 - Math.abs(l - 0.55) * 1.6);
          if (w <= 0.02) continue;
          const bk = buckets[Math.floor(h / 15) % 24];
          bk.w += w; bk.r += d[i] * w; bk.g += d[i + 1] * w; bk.b += d[i + 2] * w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        if (best.w < 0.5) return done(null);
        let [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
        s = Math.max(0.5, Math.min(0.95, s)); l = Math.max(0.55, Math.min(0.7, l));
        done(`hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`);
      } catch { done(null); }
    };
    img.src = url;
  });
}

// A small palette (up to 4 lively colours, as [r,g,b]) from album artwork, for visualisers.
const pcache = new Map();
export function paletteFromImage(url) {
  if (!url) return Promise.resolve(null);
  if (pcache.has(url)) return Promise.resolve(pcache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (v) => { pcache.set(url, v); resolve(v); };
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const N = 24;
        const c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const buckets = new Array(12).fill(0).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          const w = 0.15 + s * (1 - Math.abs(l - 0.5) * 1.4);
          if (w <= 0.05) continue;
          const bk = buckets[Math.floor(h / 30) % 12];
          bk.w += w; bk.r += d[i] * w; bk.g += d[i + 1] * w; bk.b += d[i + 2] * w;
        }
        const top = buckets.filter((b) => b.w > 1).sort((a, b) => b.w - a.w).slice(0, 4)
          .map((b) => [b.r / b.w, b.g / b.w, b.b / b.w].map(Math.round));
        done(top.length ? top : null);
      } catch { done(null); }
    };
    img.src = url;
  });
}
