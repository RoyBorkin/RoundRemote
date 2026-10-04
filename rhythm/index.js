// The Rhythm category: its six music games, in the order they sit on the Rhythm ring.
// They run in the games shell (route 'game' with { id }); games/index.js finds them through rhythmById /
// loadRhythmGame, and their quit / back buttons return to the Rhythm screen (home: 'rhythm').
// needsSong: the game plays along with the song on the remote (and gets its top 5 per song + difficulty).

// tiny helper for 24×24 icon paths: a circle (or a hole in the shape around it)
const c = (x, y, r, hole = false) => `M${x - r} ${y}a${r} ${r} 0 1 ${hole ? 0 : 1} ${2 * r} 0a${r} ${r} 0 1 ${hole ? 0 : 1} ${-2 * r} 0z`;

export const RHYTHM = [
  { id: 'hits', file: './hits.js', name: 'Hitster', color: '#ffb020', home: 'rhythm', needsSong: false,
    blurb: 'Hear a hit, guess its year and slot it into your timeline. Get the order right to grow your line. In English or Hebrew.',
    icon: 'M2 19h20v2H2zM2.5 10h5v7.5h-5zM16.5 10h5v7.5h-5zM9.5 2.5h5v7h-5zM9.5 11.5h5L12 15z' },
  { id: 'frets', file: './frets.js', name: 'Fret Fire', color: '#ff4d4d', home: 'rhythm', needsSong: true,
    blurb: 'Notes race down the fretboard to your song. Strike them on the line and hold the long ones.',
    icon: 'M9.2 2h1.6L6.4 22H4z' + 'M13.2 2h1.6L20 22h-2.4z' + c(12, 17.5, 3) + c(12, 8, 1.6) },
  { id: 'tiles', file: './tiles.js', name: 'Rhythm Rush', color: '#4d9bff', home: 'rhythm', needsSong: true,
    blurb: 'Tiles fall in time with the music. Tap each one as it lands — and don’t let a single one slip by.',
    icon: 'M3 3h4.4v8H3zM9.8 9h4.4v8H9.8zM16.6 5h4.4v8h-4.4zM3 14h4.4v7H3z' },
  { id: 'chrono', file: './chrono.js', name: 'Chrono Ring', color: '#b57bff', home: 'rhythm', needsSong: true,
    blurb: 'Notes fly out from the centre — tap the ring where they land, right on the beat.',
    icon: c(12, 12, 10) + c(12, 12, 8, true) + 'M11 4.8h2v7.9h-2z' + c(12, 12, 1.9) + c(18.2, 16.4, 2.2) },
  { id: 'circles', file: './circles.js', name: 'Beat Circles', color: '#ff5fa2', home: 'rhythm', needsSong: true,
    blurb: 'Circles pop up all over the screen. Tap each one just as its closing ring meets it.',
    icon: c(9, 10, 7) + c(9, 10, 5.9, true) + c(9, 10, 3.6) + c(17.5, 17, 4) },
  { id: 'spin', file: './spin.js', name: 'Spin Beat', color: '#2ee6d6', home: 'rhythm', needsSong: true,
    blurb: 'Turn the wheel to catch notes flying in from every side, right on the beat of the song.',
    icon: c(12, 12, 3.6) + 'M12 2.6a9.4 9.4 0 0 1 8.7 5.8l1.8-.8-1 5-4.3-2.7 1.7-.7A7.2 7.2 0 0 0 12 4.8z'
      + 'M12 21.4a9.4 9.4 0 0 1-8.7-5.8l-1.8.8 1-5 4.3 2.7-1.7.7A7.2 7.2 0 0 0 12 19.2z' },
];

export const rhythmById = (id) => RHYTHM.find((g) => g.id === id) || null;

/**
 * Load a rhythm game's module (paths are relative to this folder). Games that play along with a song get
 * their top 5 per song: keyExtra() adds the song to the score key and keyLabel() names it on the chart.
 */
export async function loadRhythmGame(id) {
  const meta = rhythmById(id);
  if (!meta) throw new Error(`No game “${id}”`);
  const mod = await import(meta.file);
  // copy property descriptors, not values: a game may define howTo / modes / unit as getters (Hitster's follow its language)
  const def = Object.defineProperties({ ...meta }, Object.getOwnPropertyDescriptors(mod.default));
  Object.assign(def, { id: meta.id, name: meta.name, color: meta.color, icon: meta.icon, home: 'rhythm' });
  if (meta.needsSong && !def.keyExtra) {
    const S = await import('./session.js');
    const song = () => S.activeSong() || S.currentSong();
    def.keyExtra = () => { const s = song(); return s ? [s.key] : []; };
    def.keyLabel ||= () => song()?.title || '';
  }
  return def;
}
