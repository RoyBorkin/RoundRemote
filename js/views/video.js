// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// View 4: Video — like the classic Info view, but the background is a video.
//  • YouTube / YouTube Music: the song's own video (the provider's player sits behind).
//  • Every other service: the song's official music video, found on YouTube (needs a free
//    YouTube Data API key), played muted and kept in sync with the song.
//  • Demo: a generated animated loop.
//  • Slideshow (option): photos of the artist and album from Wikipedia, Wikimedia Commons and
//    Deezer, crossfading with a slow Ken Burns zoom, instead of a video.
// The music video search prefers real clips (then live performances) and skips "still picture"
// uploads. YouTube's suggestion screens are avoided: the last 20 s of a video are never played
// (it loops before them) and the video fades out while the song is paused.
// Spotify Canvas and Apple Music motion artwork aren't available to third-party apps
// through the official APIs, so the music video is used instead.
import { h, clear } from '../ui/dom.js';
import { createInfoView } from './info.js';
import { loadIframeApi, findMusicVideo, canSearch } from '../core/youtube.js';
import { songPhotos } from '../core/songinfo.js';
import { store } from '../core/store.js';
import { fmtTime } from '../core/util.js';
import { dirOf } from '../lyrics/bidi.js';

/** The video kinds the user picked (older setups had a single clip/live choice). */
export function videoKinds() {
  const k = store.get('videoKinds');
  if (Array.isArray(k) && k.length) return k;
  return store.get('videoPrefer') === 'live' ? ['live', 'clip'] : ['clip', 'live'];
}

export function createVideoView({ player }) {
  const layer = h('div.vid-layer');
  const shade = h('div.vid-shade');
  const note = h('div.vid-note');
  const info = createInfoView();
  // song info shown over the video while the controls are hidden (option "Show song info when the controls hide")
  const hTitle = h('div.vh-title'), hSub = h('div.vh-sub'), hLeft = h('span.vh-left'), hBar = h('i.vh-bar');
  const hud = h('div.vid-hud', hTitle, hSub, h('div.vh-foot', hLeft, h('div.vh-track', hBar)));
  const el = h('div.view.view-video', layer, shade, info.el, hud, note);
  let hudKey = null, hudLeft = '';
  function paintHud(t) {
    const k = t ? `${t.id}|${t.title}` : null;
    if (k === hudKey) return;
    hudKey = k;
    hTitle.textContent = t?.title || ''; hTitle.dir = dirOf(hTitle.textContent);
    hSub.dir = dirOf(`${t?.title || ''} ${t?.artist || ''}`);
    hSub.replaceChildren(...[t?.artist, t?.album].filter(Boolean).flatMap((x, i) => (i ? [h('span.vh-dot', '·'), h('span', { dir: dirOf(x) }, x)] : [h('span', { dir: dirOf(x) }, x)])));
  }
  let key = null, bg = null, gen = null, slides = null, lastSync = 0, destroyed = false;
  const END_SKIP = 20; // seconds at the end of a video that are never shown (end screens / suggestions)

  function reset() {
    try { bg?.yp?.destroy(); } catch {}
    bg = null;
    if (gen) { cancelAnimationFrame(gen.raf); gen = null; }
    if (slides) { clearInterval(slides.timer); slides = null; }
    clear(layer);
    note.textContent = '';
    el.classList.remove('host-video', 'has-video');
  }
  function artFallback(track, msg = '') {
    reset();
    if (track?.art) layer.append(h('div.vid-art', { style: { backgroundImage: `url("${track.art}")` } }));
    note.textContent = msg;
  }

  async function load(track) {
    const mode = store.get('videoMode') || 'video';
    const kinds = videoKinds();
    const preferClip = store.get('videoPreferClip') !== false;
    const k = track ? `${track.id}|${track.title}|${mode}|${kinds.join(',')}|${preferClip}` : null;
    if (k === key) return;
    key = k;
    reset();
    if (!track) return;
    const prov = player.provider;
    if (mode === 'slides') return startSlides(track, k);
    if (prov?.videoHost) { el.classList.add('host-video', 'has-video'); return; }
    let own = null;
    try { own = await prov?.getVideo?.(track); } catch {}
    if (key !== k || destroyed) return;
    if (own?.type === 'generated') return startGenerated(own);
    if (own?.type === 'youtube') return startYouTube(own.id, k);
    if (!canSearch()) { artFallback(track, 'Add a YouTube API key in Settings to show music videos'); return; }
    let id = null;
    try { id = await findMusicVideo(track, { kinds, preferClip }); } catch (e) { if (key === k) artFallback(track, e.userMessage || 'Video search failed'); return; }
    if (key !== k || destroyed) return;
    if (id) startYouTube(id, k);
    else artFallback(track, 'No video of the chosen types found for this song');
  }

  async function startYouTube(id, k) {
    let YT;
    try { YT = await loadIframeApi(); } catch { artFallback(player.state.track, 'YouTube is unreachable'); return; }
    if (key !== k || destroyed) return;
    const inner = h('div');
    // the blurred cover sits under the video and shows through while it's faded out (paused)
    if (player.state.track?.art) layer.append(h('div.vid-art', { style: { backgroundImage: `url("${player.state.track.art}")` } }));
    layer.append(h('div.vid-yt', inner));
    const start = Math.floor(player.position() / 1000);
    const yp = new YT.Player(inner, {
      videoId: id, width: '100%', height: '100%',
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1,
        playsinline: 1, rel: 0, start, origin: location.origin,
      },
      events: {
        onReady: (e) => { if (!bg) return; e.target.mute(); bg.ready = true; if (player.state.isPlaying) e.target.playVideo(); },
        onStateChange: (e) => {
          if (e.data === 1) el.classList.add('has-video');
          if (e.data === 0) { try { e.target.seekTo(0, true); e.target.playVideo(); } catch {} } // never sit on the end screen
        },
        onError: () => { if (key === k) artFallback(player.state.track, 'This music video can’t be embedded'); },
      },
    });
    bg = { yp, ready: false };
  }

  // Slideshow: photos related to the song, crossfading with a Ken Burns zoom.
  async function startSlides(track, k) {
    el.classList.add('has-video', 'slides');
    const a = h('div.vid-slide'), b = h('div.vid-slide');
    const credit = h('div.vid-credit');
    layer.append(a, b, credit);
    let photos = track.art ? [{ url: track.art, credit: 'Album art' }] : [];
    const show = (i) => {
      const p = photos[i % photos.length];
      if (!p) return;
      const [front, back] = slides.flip ? [a, b] : [b, a];
      slides.flip = !slides.flip;
      const img = new Image();
      img.onload = () => {
        if (!slides) return;
        back.style.backgroundImage = `url("${p.url}")`;
        back.style.setProperty('--kx', `${(Math.random() * 8 - 4).toFixed(1)}%`);
        back.style.setProperty('--ky', `${(Math.random() * 8 - 4).toFixed(1)}%`);
        back.classList.remove('on'); void back.offsetWidth; back.classList.add('on');
        front.classList.remove('on');
        credit.textContent = p.credit || '';
      };
      img.onerror = () => { photos = photos.filter((x) => x !== p); };
      img.src = p.url;
    };
    slides = { flip: false, i: 0, timer: 0 };
    show(0);
    try {
      const more = await songPhotos(track);
      if (key !== k || destroyed || !slides) return;
      if (more.length) photos = more;
    } catch {}
    if (photos.length < 2) note.textContent = 'Only the album cover was found for this song';
    slides.timer = setInterval(() => { if (player.state.isPlaying && photos.length > 1) show(++slides.i); }, 7000);
  }

  // Demo: a procedural colour loop drawn on a small canvas.
  function startGenerated({ hue = [280, 330] }) {
    const c = h('canvas.vid-canvas', { width: 240, height: 240 });
    layer.append(c);
    el.classList.add('has-video');
    const g = c.getContext('2d');
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const playing = player.state.isPlaying;
      gen.phase += playing ? 0.016 : 0.002;
      const p = gen.phase;
      g.fillStyle = `hsl(${hue[1]} 60% 12%)`; g.fillRect(0, 0, 240, 240);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const a = p * (0.6 + i * 0.13) + i * 1.7;
        const x = 120 + Math.cos(a) * (50 + i * 10), y = 120 + Math.sin(a * 1.3) * (50 + i * 8);
        const r = 70 + 25 * Math.sin(p * 2 + i);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        const hh = hue[0] + ((hue[1] - hue[0]) * i) / 5 + 20 * Math.sin(t * 0.3 + i);
        grd.addColorStop(0, `hsla(${hh} 90% 60% / .55)`); grd.addColorStop(1, `hsla(${hh} 90% 50% / 0)`);
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      gen.raf = requestAnimationFrame(draw);
    };
    gen = { phase: 0, raf: 0 };
    draw();
  }

  const reload = () => { key = null; load(player.state.track); };
  const offs = [store.on('change:videoMode', reload), store.on('change:videoKinds', reload), store.on('change:videoPreferClip', reload)];

  return {
    el,
    update(s) { info.update(s); paintHud(s.track); load(s.track); layer.classList.toggle('paused', !s.isPlaying); },
    tick(pos, s) {
      const d = s?.track?.durationMs || 0;
      const left = d ? `−${fmtTime(Math.max(0, d - pos))}` : '';
      if (left !== hudLeft) { hudLeft = left; hLeft.textContent = left; }
      if (d) hBar.style.transform = `scaleX(${Math.min(1, pos / d).toFixed(4)})`;
      if (!bg?.ready) return;
      const now = performance.now();
      if (now - lastSync < 400) return;
      lastSync = now;
      const yp = bg.yp;
      try {
        const ps = yp.getPlayerState();
        if (s.isPlaying && ps !== 1 && ps !== 3) yp.playVideo();
        if (!s.isPlaying && ps === 1) yp.pauseVideo();
        layer.classList.toggle('paused', !s.isPlaying); // YouTube shows "More videos" on pause — hide it
        const dur = yp.getDuration() || 0;
        const usable = dur > 60 ? dur - END_SKIP : dur;   // stop short of the end screen
        const target = usable > 0 ? (pos / 1000) % usable : pos / 1000;
        const cur = yp.getCurrentTime();
        if (Math.abs(cur - target) > 2.5 || (usable > 0 && cur > usable)) yp.seekTo(target, true);
      } catch {}
    },
    destroy() { destroyed = true; reset(); info.destroy(); offs.forEach((f) => f()); },
  };
}
