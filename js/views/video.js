// View 4: Video — like the classic Info view, but the background is a video.
//  • YouTube / YouTube Music: the song's own video (the provider's player sits behind).
//  • Every other service: the song's official music video, found on YouTube (needs a free
//    YouTube Data API key), played muted and kept in sync with the song.
//  • Demo: a generated animated loop.
// Spotify Canvas and Apple Music motion artwork aren't available to third-party apps
// through the official APIs, so the music video is used instead.
import { h, clear } from '../ui/dom.js';
import { createInfoView } from './info.js';
import { loadIframeApi, findMusicVideo, canSearch } from '../core/youtube.js';

export function createVideoView({ player }) {
  const layer = h('div.vid-layer');
  const shade = h('div.vid-shade');
  const note = h('div.vid-note');
  const info = createInfoView();
  const el = h('div.view.view-video', layer, shade, info.el, note);
  let key = null, bg = null, gen = null, lastSync = 0, destroyed = false;

  function reset() {
    try { bg?.yp?.destroy(); } catch {}
    bg = null;
    if (gen) { cancelAnimationFrame(gen.raf); gen = null; }
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
    const k = track ? `${track.id}|${track.title}` : null;
    if (k === key) return;
    key = k;
    reset();
    if (!track) return;
    const prov = player.provider;
    if (prov?.videoHost) { el.classList.add('host-video', 'has-video'); return; }
    let own = null;
    try { own = await prov?.getVideo?.(track); } catch {}
    if (key !== k || destroyed) return;
    if (own?.type === 'generated') return startGenerated(own);
    if (own?.type === 'youtube') return startYouTube(own.id, k);
    if (!canSearch()) { artFallback(track, 'Add a YouTube API key in Settings to show music videos'); return; }
    let id = null;
    try { id = await findMusicVideo(track); } catch (e) { if (key === k) artFallback(track, e.userMessage || 'Video search failed'); return; }
    if (key !== k || destroyed) return;
    if (id) startYouTube(id, k);
    else artFallback(track, 'No music video found for this song');
  }

  async function startYouTube(id, k) {
    let YT;
    try { YT = await loadIframeApi(); } catch { artFallback(player.state.track, 'YouTube is unreachable'); return; }
    if (key !== k || destroyed) return;
    const inner = h('div');
    layer.append(h('div.vid-yt', inner));
    const start = Math.floor(player.position() / 1000);
    const yp = new YT.Player(inner, {
      videoId: id, width: '100%', height: '100%',
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1,
        playsinline: 1, rel: 0, loop: 1, playlist: id, start, origin: location.origin,
      },
      events: {
        onReady: (e) => { if (!bg) return; e.target.mute(); bg.ready = true; if (player.state.isPlaying) e.target.playVideo(); },
        onStateChange: (e) => { if (e.data === 1) el.classList.add('has-video'); },
        onError: () => { if (key === k) artFallback(player.state.track, 'This music video can’t be embedded'); },
      },
    });
    bg = { yp, ready: false };
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

  return {
    el,
    update(s) { info.update(s); load(s.track); },
    tick(pos, s) {
      if (!bg?.ready) return;
      const now = performance.now();
      if (now - lastSync < 500) return;
      lastSync = now;
      const yp = bg.yp;
      try {
        const ps = yp.getPlayerState();
        if (s.isPlaying && ps !== 1 && ps !== 3) yp.playVideo();
        if (!s.isPlaying && ps === 1) yp.pauseVideo();
        const dur = yp.getDuration() || 0;
        const target = dur > 0 ? (pos / 1000) % dur : pos / 1000;
        if (Math.abs(yp.getCurrentTime() - target) > 2.5) yp.seekTo(target, true);
      } catch {}
    },
    destroy() { destroyed = true; reset(); info.destroy(); },
  };
}
