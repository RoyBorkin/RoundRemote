// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fake zones for testing the app ↔ bridge path without real devices (RR_MOCK=1).
const TRACKS = [
  { id: 'm1', title: 'Harbor Static', artist: 'Mock Orchestra', album: 'Test Signals', durationMs: 201000 },
  { id: 'm2', title: 'Loopback', artist: 'The Localhosts', album: 'Port 8765', durationMs: 176000 },
  { id: 'm3', title: 'Packet Rain', artist: 'Mock Orchestra', album: 'Test Signals', durationMs: 233000 },
];

export function create({ hub }) {
  const zones = [
    { localId: 'kitchen', name: 'Kitchen (mock)', sourceApp: 'TIDAL', i: 0, pos: 30000, playing: true, vol: 40 },
    { localId: 'study', name: 'Study (mock)', sourceApp: 'Qobuz', i: 1, pos: 0, playing: false, vol: 25 },
  ];
  let timer;
  const push = (z) => hub.upsert('mock', z.localId, {
    name: z.name, sourceApp: z.sourceApp,
    state: { track: TRACKS[z.i], isPlaying: z.playing, progressMs: z.pos, volume: z.vol, shuffle: false, repeat: 'off' },
    caps: { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, shuffle: true, repeat: true },
  });
  const find = (id) => zones.find((z) => z.localId === id);
  return {
    id: 'mock',
    async start() {
      zones.forEach(push);
      let last = Date.now();
      timer = setInterval(() => {
        const now = Date.now(), dt = now - last; last = now;
        for (const z of zones) {
          if (!z.playing) continue;
          z.pos += dt;
          if (z.pos >= TRACKS[z.i].durationMs) { z.i = (z.i + 1) % TRACKS.length; z.pos = 0; push(z); }
        }
      }, 500);
      setInterval(() => zones.forEach(push), 5000);
    },
    stop() { clearInterval(timer); },
    async command(id, cmd, value) {
      const z = find(id); if (!z) return;
      if (cmd === 'play') z.playing = true;
      else if (cmd === 'pause') z.playing = false;
      else if (cmd === 'next') { z.i = (z.i + 1) % TRACKS.length; z.pos = 0; }
      else if (cmd === 'prev') { z.i = (z.i + TRACKS.length - 1) % TRACKS.length; z.pos = 0; }
      else if (cmd === 'seek') z.pos = value;
      else if (cmd === 'volume') z.vol = value;
      push(z);
    },
    async playlists() { return [{ id: 'pl1', name: 'Mock Mix', subtitle: '3 songs', kind: 'playlist' }]; },
    async search(_id, q) { return TRACKS.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())).map((t) => ({ kind: 'track', id: String(TRACKS.indexOf(t)), title: t.title, subtitle: t.artist })); },
    async play(id, item) { const z = find(id); if (item.kind === 'track') { z.i = +item.id; } z.pos = 0; z.playing = true; push(z); },
  };
}
