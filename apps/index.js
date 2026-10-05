// © 2026 Roy Borkin. All rights reserved. See LICENSE.
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
  { id: 'tasks', file: './tasks.js', name: 'Task manager', color: '#a78bfa', blurb: 'All the games’ truths, dares, tasks and questions in one place — players add their own by QR code.',
    icon: 'M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z' },
  { id: 'random', file: './random.js', name: 'Randomizer', color: '#22d3ee', blurb: 'Random numbers, colours, letters, who goes first, yes / no and more.',
    icon: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' + c(8, 8, 1.6, true) + c(16, 16, 1.6, true) + c(12, 12, 1.6, true) },
  { id: 'boardgames', file: './boardgames.js', name: 'Board Games', color: '#ef4444', blurb: 'Dice, coin flip, score keeper, companions for favourite board games and their rules.',
    icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' + c(8, 8, 1.6, true) + c(16, 8, 1.6, true) + c(8, 16, 1.6, true) + c(16, 16, 1.6, true) + c(12, 12, 1.6, true) },
  { id: 'decide', file: './decide.js', name: 'Decide', color: '#14b8a6', blurb: 'Can’t choose? What to watch, do, play, eat, where to go — spin and go.',
    icon: c(12, 12, 10) + c(12, 12, 8.2, true) + 'M12 4l2.2 7.8L12 13l-2.2-1.2z' + c(12, 12, 1.6) },
  { id: 'wishlist', file: './wishlist.js', name: 'Wish Lists', color: '#ec4899', blurb: 'Games, movies, shows and books you want — saved from your libraries.',
    icon: 'M12 21l-1.4-1.3C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z' },
  { id: 'playtime', file: './playtime.js', name: 'Play Time', color: '#ef4444', blurb: 'The “I played too much” timer — a gaming time budget with friendly warnings.',
    icon: 'M7 6h10a5 5 0 0 1 4.9 6l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 15H9.4l-1.8 2.5A2.6 2.6 0 0 1 3 16.4L2.1 12A5 5 0 0 1 7 6zm0 3v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9z' },
  { id: 'books', file: './books.js', name: 'Bookmarks', color: '#8b5cf6', blurb: 'Where you stopped in every book — page, progress and reading reminders.',
    icon: 'M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z' },
  { id: 'collection', file: './collection.js', name: 'Collection', color: '#0ea5e9', blurb: 'Your shelves: video games, board games, books, vinyl, CDs, DVD & Blu-ray — scan, sync and browse them.',
    icon: 'M3 4h4v16H3zm5 2h4v14H8zm5-3h3v17h-3zm4.2 2.3l2.9-.8 3.6 13.6-2.9.8z' },
  { id: 'plants', file: './plants.js', name: 'Plants & Pets', color: '#22c55e', blurb: 'Watering, feeding, walks and medicine — reminders for everyone you look after.',
    icon: 'M12 22v-8M12 14c0-4 3-7 8-7 0 5-3 7-8 7zm0-2C12 8 9.5 5 4 5c0 5 3 7 8 7z' },
  { id: 'focus', file: './focus.js', name: 'Focus', color: '#f43f5e', blurb: 'Pomodoro focus timer — work and break cycles with lights and music.',
    icon: 'M12 5a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM11 2h2v3h-2zm0 7h2v4.5l3 1.8-1 1.7-4-2.4z' },
  { id: 'djqueue', file: './djqueue.js', name: 'Party DJ', color: '#a855f7', blurb: 'Guests scan a QR code to request songs and vote — the queue plays on your music service.',
    icon: 'M9 3h12v12.5A3.5 3.5 0 1 1 18 12V7h-7v10.5A3.5 3.5 0 1 1 9 14z' },
  { id: 'movienight', file: './movienight.js', name: 'Movie Night', color: '#eab308', blurb: 'Pick three, everyone votes on their phone, lights dim and the movie starts.',
    icon: 'M4 6h16v12H4zm2 2v8h12V8zM2 4h2v16H2zm18 0h2v16h-2zM10 9.5l5 2.5-5 2.5z' },
  { id: 'countdown', file: './countdown.js', name: 'Countdowns', color: '#f59e0b', blurb: 'Days until birthdays, holidays, trips and anything you’re looking forward to.',
    icon: 'M5 4h2V2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 6v10h14V10zm3 2h3v3H8z' },
  { id: 'noise', file: './noise.js', name: 'Sleep Sounds', color: '#6366f1', blurb: 'White, pink and brown noise, rain, waves, fan and more — with a sleep timer.',
    icon: 'M3 10h2v4H3zm4-4h2v12H7zm4-3h2v18h-2zm4 5h2v8h-2zm4 2h2v4h-2z' },
];

// Apps that sit on the Games ring instead (games/index.js lists them after the party games: Truth or Dare, Drinking
// Games, Trivia Night): they open in the app screen like any app, and Back returns to the Games ring (`home`).
export const GAME_APPS = [
  { id: 'bottle', file: './bottle.js', name: 'Truth or Dare', color: '#f472b6', home: 'games', blurb: 'Spin the bottle — just spin, or play truth or dare with your own tasks.',
    icon: 'M10 2h4v3l1.5 2.5V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V7.5L10 5zm-.5 9v6h5v-6z' },
  { id: 'drinks', file: './drinks.js', name: 'Drinking Games', color: '#f97316', adult: true, home: 'games', blurb: 'Six party drinking games — 18+, play responsibly (any drink works).',
    icon: 'M5 3h14l-1.6 16.2A2 2 0 0 1 15.4 21H8.6a2 2 0 0 1-2-1.8zm2.2 2l.5 5h8.6l.5-5z' },
  { id: 'trivia', file: './trivia.js', name: 'Trivia Night', color: '#3b82f6', home: 'games', blurb: 'Quiz night with phone buzzers, teams and categories — English and Hebrew.',
    icon: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 14v2h2v-2zm1-10a4 4 0 0 0-4 4h2a2 2 0 1 1 3 1.7c-1.2.7-2 1.5-2 3.3h2c0-1 .4-1.4 1.3-2A4 4 0 0 0 12 6z' },
];

export const appById = (id) => APPS.find((a) => a.id === id) || GAME_APPS.find((a) => a.id === id) || null;
export async function loadApp(id) {
  const meta = appById(id);
  if (!meta) throw new Error(`No app “${id}”`);
  const mod = await import(meta.file);
  return { meta, def: mod.default };
}
