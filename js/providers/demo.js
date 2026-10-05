// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Demo provider: a fully simulated player (fictional songs, original lyrics, generated artwork)
// so every screen can be tried with no account — and so the app can be tested offline.
import { Provider } from './base.js';
import { parseLrc } from '../lyrics/lrc.js';

const SONGS = [
  {
    id: 'd1', title: 'Neon Orbit', artist: 'Luma Vale', album: 'Night Transit', year: 2021, dur: 192000, hue: [280, 330],
    lyrics: [
      [9, 'City lights are spinning slow tonight'], [15, 'Every window hums a different song'],
      [21, 'I keep circling back to where you are'], [27, 'Like a satellite that knows the way along'],
      [34, 'Oh, we are neon in orbit'], [39, 'Burning bright and never falling down'],
      [45, 'Hold on, the night is ours to keep'], [51, 'Round and round and round'],
      [64, 'Taxi radios and midnight trains'], [70, 'Carry every word I never said'],
      [76, 'Draw a circle with your fingertips'], [82, 'On the glass where all the colors bled'],
      [89, 'Oh, we are neon in orbit'], [94, 'Burning bright and never falling down'],
      [100, 'Hold on, the night is ours to keep'], [106, 'Round and round and round'],
      [118, 'And if the morning finds us'], [124, 'Still spinning in the dark'],
      [130, 'I will trace the way back home'], [136, 'By the glow of your heart'],
      [146, 'Oh, we are neon in orbit'], [151, 'Burning bright and never falling down'],
      [157, 'Hold on, the night is ours to keep'], [163, 'Round and round and round'],
      [172, 'Round and round'], [178, 'Round and round and round'],
    ],
  },
  {
    id: 'd2', title: 'Paper Lanterns', artist: 'The Quiet Tides', album: 'Harbor Lights', year: 2019, dur: 178000, hue: [25, 50],
    lyrics: [
      [7, 'We folded wishes out of paper'], [13, 'Wrote our names along the seams'],
      [19, 'Let them rise above the harbor'], [25, 'Carried off by summer dreams'],
      [32, 'Light it up, let it go'], [37, 'Watch it drift where the warm winds blow'],
      [43, 'Every flame a little promise'], [48, 'Floating over the water below'],
      [60, 'Fishing boats and salted railings'], [66, 'Songs that only sailors know'],
      [72, 'You said some things are meant for holding'], [78, 'Some are meant to let them go'],
      [85, 'Light it up, let it go'], [90, 'Watch it drift where the warm winds blow'],
      [96, 'Every flame a little promise'], [101, 'Floating over the water below'],
      [114, 'And when the sky is full of embers'], [120, 'I will find the one that is ours'],
      [126, 'Hanging low between the rooftops'], [132, 'Shining softer than the stars'],
      [140, 'Light it up, let it go'], [145, 'Watch it drift where the warm winds blow'],
      [151, 'Every flame a little promise'], [157, 'Floating over the water below'],
      [165, 'Floating over the water below'],
    ],
  },
  {
    id: 'd3', title: 'Circuit Heart', artist: 'KAIRO', album: 'Signal / Noise', year: 2023, dur: 210000, hue: [180, 210],
    lyrics: [
      [12, 'Wired up and wide awake'], [16, 'Static running through my veins'],
      [20, 'Every pulse a little louder'], [24, 'Every beat a brand new frame'],
      [29, 'Plug me in'], [31, 'Turn me up'], [33, 'Feel the current'], [35, 'Never stop'],
      [38, 'I got a circuit heart'], [42, 'Beating out of time'], [46, 'Sparks in the dark'], [50, 'Electric by design'],
      [62, 'Zeroes, ones and flashing signals'], [66, 'Morse code on the dancing floor'],
      [70, 'You decode me in a heartbeat'], [74, 'Now I only want some more'],
      [79, 'Plug me in'], [81, 'Turn me up'], [83, 'Feel the current'], [85, 'Never stop'],
      [88, 'I got a circuit heart'], [92, 'Beating out of time'], [96, 'Sparks in the dark'], [100, 'Electric by design'],
      [120, 'System overload'], [126, 'Nowhere left to go'], [132, 'Only you and me'], [138, 'Running on the glow'],
      [150, 'I got a circuit heart'], [154, 'Beating out of time'], [158, 'Sparks in the dark'], [162, 'Electric by design'],
      [170, 'Electric by design'], [180, 'By design'],
    ],
  },
  {
    id: 'd4', title: 'Slow Motion Summer', artist: 'Juniper & June', album: 'Sundial', year: 2018, dur: 185000, hue: [95, 150],
    lyrics: [
      [8, 'Lemonade and faded T-shirts'], [14, 'Bicycles along the shore'],
      [20, 'Afternoons that last forever'], [26, 'We could never ask for more'],
      [33, 'Oh, slow it down, slow it down'], [39, 'Let the golden hour stay'],
      [45, 'In a slow motion summer'], [51, 'I could live in every day'],
      [63, 'Sunburned shoulders, open windows'], [69, 'Radio plays our favorite tune'],
      [75, 'Counting freckles, counting fireflies'], [81, 'Underneath a paper moon'],
      [88, 'Oh, slow it down, slow it down'], [94, 'Let the golden hour stay'],
      [100, 'In a slow motion summer'], [106, 'I could live in every day'],
      [120, 'When September knocks politely'], [126, 'We will pretend we are not home'],
      [132, 'Keep the season in a mason jar'], [138, 'Somewhere only we would know'],
      [146, 'Oh, slow it down, slow it down'], [152, 'Let the golden hour stay'],
      [158, 'In a slow motion summer'], [164, 'I could live in every day'],
    ],
  },
  { id: 'd5', title: 'Northbound', artist: 'Atlas Fields', album: 'Open Roads', year: 2020, dur: 224000, hue: [210, 250], lyrics: null },
  {
    id: 'd6', title: 'Glass Garden', artist: 'Mira Sol', album: 'Greenhouse', year: 2022, dur: 199000, hue: [150, 185],
    lyrics: [
      [10, 'Rain on the roof of a glass garden'], [17, 'Ferns reaching up for the light'],
      [24, 'I planted a word in the quiet'], [31, 'And it blossomed overnight'],
      [39, 'Grow, grow, into the open'], [45, 'Nothing here is ever broken'],
      [51, 'Only waiting to be spoken'], [57, 'Grow, grow'],
      [70, 'Moss on the steps like a letter'], [77, 'Written in patience and time'],
      [84, 'Every seed is a small kind of courage'], [91, 'Every root is a line'],
      [99, 'Grow, grow, into the open'], [105, 'Nothing here is ever broken'],
      [111, 'Only waiting to be spoken'], [117, 'Grow, grow'],
      [135, 'Grow, grow, into the open'], [141, 'Nothing here is ever broken'],
      [147, 'Only waiting to be spoken'], [153, 'Grow'],
    ],
  },
  {
    // Hebrew, to show right-to-left lyrics (one line mixes in an English word on purpose)
    id: 'd7', title: 'אור על המים', artist: 'נועה ים', album: 'גלים', year: 2024, dur: 188000, hue: [195, 235],
    lyrics: [
      [8, 'אורות העיר מסתובבים לאט'], [14, 'כל חלון מזמזם שיר אחר'],
      [20, 'אני חוזר תמיד אלייך'], [26, 'כמו לוויין שמכיר את הדרך'],
      [33, 'הו, אנחנו אור על המים'], [38, 'בוערים ולא נופלים'],
      [44, 'תחזיקי חזק, הלילה שלנו'], [50, 'סביב סביב סביב'],
      [62, 'רדיו במונית ורכבת של חצות'], [68, 'נושאים כל מילה שלא אמרתי'],
      [74, 'ציירי עיגול בקצות האצבעות'], [80, 'על הזכוכית שבה הצבעים נמסו'],
      [87, 'הו, אנחנו אור על המים'], [92, 'בוערים ולא נופלים'],
      [98, 'תחזיקי חזק, הלילה שלנו'], [104, 'סביב סביב סביב'],
      [116, 'ואם הבוקר ימצא אותנו'], [122, 'עדיין מסתובבים בחושך'],
      [128, 'רק עוד summer אחד איתך'], [134, 'לאור הלב שלך'],
      [142, 'הו, אנחנו אור על המים'], [147, 'בוערים ולא נופלים'],
      [153, 'סביב סביב סביב'],
    ],
  },
];

// Fun Facts for the Demo's fictional songs (real songs get theirs from Wikipedia and MusicBrainz).
const FACTS = {
  d1: ['Luma Vale wrote “Neon Orbit” on a night bus that circled the city twice because she fell asleep.',
    'The synth line in the chorus was recorded on a toy keyboard found in a thrift shop for five dollars.',
    '“Night Transit” was recorded almost entirely between midnight and 4 a.m.',
    'The ticking sound in the second verse is a real taxi meter.'],
  d2: ['The Quiet Tides recorded “Paper Lanterns” in a boathouse, and you can hear the water in the quiet parts.',
    'Every member of the band folded a paper lantern for the album cover photo shoot.',
    '“Harbor Lights” was the band’s first album to be pressed on vinyl.'],
  d3: ['KAIRO built the drum sounds on “Circuit Heart” from recordings of an old dial-up modem.',
    '“Plug me in, turn me up” was the first line written — the rest of the song grew around it.',
    '“Signal / Noise” hides a message in Morse code at the end of its last track.'],
  d4: ['Juniper & June recorded “Slow Motion Summer” in a single afternoon, with the windows open.',
    'The bicycle bell in the intro belongs to June’s grandmother.',
    '“Sundial” was mixed outdoors on a porch, which is why it sounds so warm.'],
  d5: ['“Northbound” is an instrumental written for a 1,000-kilometre road trip.',
    'Atlas Fields recorded the guitar in the back of a moving van.'],
  d6: ['Mira Sol wrote “Glass Garden” in a greenhouse during a rainstorm.',
    'The rain at the start of the song was recorded on the greenhouse roof.',
    '“Greenhouse” took three years to finish — about as long as it takes a fern to grow up.'],
  d7: ['נועה ים כתבה את ״אור על המים״ על החוף בתל אביב, בשקיעה.',
    'הצליל שנשמע בפתיחה הוא הקלטה אמיתית של גלים.',
    'השורה ״רק עוד summer אחד איתך״ נכתבה בכוונה בשתי שפות.',
    '״גלים״ הוא אלבום הבכורה של נועה ים.'],
};

const PLAYLISTS = [
  { id: 'p1', name: 'Late Night Drive', ids: ['d1', 'd3', 'd5', 'd6'] },
  { id: 'p2', name: 'Sunny Side', ids: ['d4', 'd2', 'd6'] },
  { id: 'p3', name: 'Everything', ids: SONGS.map((s) => s.id) },
  { id: 'p4', name: 'בעברית · Hebrew', ids: ['d7'] },
];

const DEVICES = [
  { id: 'dev-living', name: 'Living Room', type: 'Speaker' },
  { id: 'dev-kitchen', name: 'Kitchen', type: 'Speaker' },
  { id: 'dev-round', name: 'Round Display', type: 'Computer' },
];

const artCache = new Map();
function makeArt(song) {
  if (artCache.has(song.id)) return artCache.get(song.id);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const [h1, h2] = song.hue;
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, `hsl(${h1} 80% 55%)`);
  grad.addColorStop(1, `hsl(${h2} 70% 22%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  // deterministic shapes
  let seed = [...song.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, 40 + rnd() * 180, 0, Math.PI * 2);
    g.fillStyle = `hsla(${h1 + rnd() * 60} 90% ${40 + rnd() * 30}% / ${0.12 + rnd() * 0.25})`;
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3;
  for (let r = 60; r < 360; r += 46) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = '800 44px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(song.album.toUpperCase(), 256, 470);
  const url = c.toDataURL('image/jpeg', 0.86);
  artCache.set(song.id, url);
  return url;
}

function toTrack(s) {
  return { id: s.id, title: s.title, artist: s.artist, album: s.album, year: s.year, art: makeArt(s), durationMs: s.dur, uri: `demo:${s.id}` };
}

export class DemoProvider extends Provider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, devices: true, shuffle: true, repeat: true });
    this.local = true;
    this.queue = PLAYLISTS[2].ids.slice();
    this.qi = 0;
    this.pos = 0; this.playing = false; this.t0 = 0;
    this.vol = 62; this.shuffle = false; this.repeat = 'off';
    this.device = DEVICES[0];
    this.timer = null;
  }
  isAuthed() { return true; }
  song() { return SONGS.find((s) => s.id === this.queue[this.qi]); }
  _pos() { return this.playing ? this.pos + (performance.now() - this.t0) : this.pos; }
  _emit() {
    const s = this.song();
    this.publish({
      track: toTrack(s), isPlaying: this.playing, progressMs: this._pos(), volume: this.vol,
      device: this.device, shuffle: this.shuffle, repeat: this.repeat, status: 'ok', message: '',
    });
  }
  async start() {
    this.playing = true; this.t0 = performance.now();
    this._emit();
    this.timer = setInterval(() => {
      const s = this.song();
      if (this.playing && this._pos() >= s.dur) this._advance(1, true);
    }, 250);
  }
  stop() { clearInterval(this.timer); this.pos = this._pos(); this.playing = false; }
  async refresh() { this._emit(); }
  _advance(dir, auto = false) {
    if (auto && this.repeat === 'one') { this.pos = 0; this.t0 = performance.now(); this._emit(); return; }
    let i = this.qi + dir;
    if (this.shuffle && dir > 0) i = Math.floor(Math.random() * this.queue.length);
    if (i >= this.queue.length) { if (this.repeat === 'all' || !auto) i = 0; else { this.playing = false; this.pos = 0; this._emit(); return; } }
    if (i < 0) i = this.queue.length - 1;
    this.qi = i; this.pos = 0; this.t0 = performance.now();
    this._emit();
  }
  async play() { if (!this.playing) { this.playing = true; this.t0 = performance.now(); } this._emit(); }
  async pause() { this.pos = this._pos(); this.playing = false; this._emit(); }
  async next() { this._advance(1); }
  async prev() { if (this._pos() > 3000) { this.pos = 0; this.t0 = performance.now(); this._emit(); } else this._advance(-1); }
  async seek(ms) { this.pos = ms; this.t0 = performance.now(); this._emit(); }
  async setVolume(v) { this.vol = v; this._emit(); }
  async setShuffle(on) { this.shuffle = on; this._emit(); }
  async setRepeat(m) { this.repeat = m; this._emit(); }
  async getPlaylists() {
    return PLAYLISTS.map((p) => ({ id: p.id, name: p.name, subtitle: `${p.ids.length} songs`, art: makeArt(SONGS.find((s) => s.id === p.ids[0])) }));
  }
  async playPlaylist(pl) {
    const p = PLAYLISTS.find((x) => x.id === pl.id);
    this.queue = p.ids.slice(); this.qi = 0; this.pos = 0; this.playing = true; this.t0 = performance.now();
    this._emit();
  }
  async search(q) {
    const t = q.trim().toLowerCase();
    await new Promise((r) => setTimeout(r, 150));
    const songs = SONGS.filter((s) => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(t))
      .map((s) => ({ kind: 'track', id: s.id, title: s.title, subtitle: `${s.artist} · ${s.album}`, art: makeArt(s) }));
    const pls = PLAYLISTS.filter((p) => p.name.toLowerCase().includes(t))
      .map((p) => ({ kind: 'playlist', id: p.id, title: p.name, subtitle: 'Playlist', art: makeArt(SONGS.find((s) => s.id === p.ids[0])) }));
    return [...songs, ...pls];
  }
  async playItem(item) {
    if (item.kind === 'playlist') return this.playPlaylist(item);
    const idx = this.queue.indexOf(item.id);
    if (idx >= 0) this.qi = idx; else { this.queue.splice(this.qi + 1, 0, item.id); this.qi++; }
    this.pos = 0; this.playing = true; this.t0 = performance.now();
    this._emit();
  }
  async getDevices() { return DEVICES.map((d) => ({ ...d, active: d.id === this.device.id, volume: this.vol })); }
  async selectDevice(dev) { this.device = DEVICES.find((d) => d.id === dev.id) || this.device; this._emit(); }
  // Video view: a generated colour loop in the song's colours (no network needed).
  async getVideo(track) {
    const s = SONGS.find((x) => x.id === track.id);
    return s ? { type: 'generated', hue: s.hue } : null;
  }
  async getFacts(track) {
    const f = FACTS[track.id];
    if (!f) return null;
    const he = track.id === 'd7';
    return f.map((text) => ({ text, source: he ? 'דמו' : 'Demo', about: track.title, dir: he ? 'rtl' : 'ltr' }));
  }
  async getLyrics(track) {
    const s = SONGS.find((x) => x.id === track.id);
    if (!s) return null;
    if (!s.lyrics) return { synced: false, lines: [], instrumental: true, source: 'Demo' };
    const lrc = s.lyrics.map(([sec, text]) => {
      const m = Math.floor(sec / 60), ss = (sec % 60).toFixed(2).padStart(5, '0');
      return `[${String(m).padStart(2, '0')}:${ss}]${text}`;
    }).join('\n');
    return { ...parseLrc(lrc), source: 'Demo' };
  }
}
