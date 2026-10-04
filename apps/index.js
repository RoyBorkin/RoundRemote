// The Apps category: handy tools for the round display. Each app lives in its own file in this folder and is
// only loaded when you open it. (Icons are 24×24 SVG paths.)
//
// An app file (apps/<file>.js) default-exports:
//   {
//     create(el, app) { …build the UI inside `el` (a round 1:1 box)…; return { destroy() {}, back() {} } }
//   }
//   back() is optional: return true if the app handled Back itself (e.g. it closed a sub-page), false/undefined → leave the app.
// `app` (see apps/shell.js): { id, meta, el, store, player, go, toast, editText, openPanel, sfx, vibrate, h, icon, iconBtn,
//   setTitle(text), back(), onKey(fn(e)) → off, every(ms, fn) → off (cleared on exit), raf(fn(dt, t)) → off, data(key, init) / save(key, value) }
const c = (x, y, r, hole = false) => `M${x - r} ${y}a${r} ${r} 0 1 ${hole ? 0 : 1} ${2 * r} 0a${r} ${r} 0 1 ${hole ? 0 : 1} ${-2 * r} 0z`;

export const APPS = [
  { id: 'clock', file: './clock.js', name: 'Clock', color: '#60a5fa', blurb: 'Analog and digital clocks, world times and alarms that play your music.',
    icon: c(12, 12, 10) + c(12, 12, 8.2, true) + 'M11.1 6h1.8v6.2l4 2.4-.9 1.5-4.9-2.9z' },
  { id: 'calc', file: './calc.js', name: 'Calculator', color: '#f59e0b', blurb: 'A round calculator — everyday maths, percentages and a tip splitter.',
    icon: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm1 2.5v4h10v-4zM7 11v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zM7 15v2h2v-2zm4 0v2h2v-2zm4 0v5h2v-5zM7 19v1.5h6V19z' },
  { id: 'timer', file: './timer.js', name: 'Timer', color: '#34d399', blurb: 'Stopwatch, countdown timer and an hourglass. When time is up, your music plays.',
    icon: 'M9 1h6v2H9zM12 4a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-1 2h2v5h-2zM18.5 4.1l1.4 1.4-1.6 1.6-1.4-1.4z' },
  { id: 'bottle', file: './bottle.js', name: 'Truth or Dare', color: '#f472b6', blurb: 'Spin the bottle — just spin, or play truth or dare with your own tasks.',
    icon: 'M10 2h4v3l1.5 2.5V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V7.5L10 5zm-.5 9v6h5v-6z' },
  { id: 'tasks', file: './tasks.js', name: 'Tasks', color: '#a78bfa', blurb: 'Truths, dares and tasks for your games — players add their own by scanning a QR code.',
    icon: 'M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z' },
  { id: 'random', file: './random.js', name: 'Randomizer', color: '#22d3ee', blurb: 'Random numbers, colours, letters, who goes first, yes / no and more.',
    icon: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' + c(8, 8, 1.6, true) + c(16, 16, 1.6, true) + c(12, 12, 1.6, true) },
  { id: 'boardgames', file: './boardgames.js', name: 'Board Games', color: '#ef4444', blurb: 'Dice, coin flip, score keeper, companions for favourite board games and their rules.',
    icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' + c(8, 8, 1.6, true) + c(16, 8, 1.6, true) + c(8, 16, 1.6, true) + c(16, 16, 1.6, true) + c(12, 12, 1.6, true) },
];

export const appById = (id) => APPS.find((a) => a.id === id) || null;
export async function loadApp(id) {
  const meta = appById(id);
  if (!meta) throw new Error(`No app “${id}”`);
  const mod = await import(meta.file);
  return { meta, def: mod.default };
}
