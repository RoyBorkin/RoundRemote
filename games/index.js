// The Games category: every game, in the order they sit on the Games ring.
// Each game lives in its own file in this folder and is only loaded when you open it.
// (Names are our own; several games are round takes on well-known arcade classics.)

import { rhythmById, loadRhythmGame } from '../rhythm/index.js';

// tiny helpers to write 24×24 icon paths
const c = (x, y, r, hole = false) => `M${x - r} ${y}a${r} ${r} 0 1 ${hole ? 0 : 1} ${2 * r} 0a${r} ${r} 0 1 ${hole ? 0 : 1} ${-2 * r} 0z`;

export const GAMES = [
  { id: 'grow', file: './grow.js', name: 'Grow', color: '#ff5fa2', blurb: 'Hold to grow the bubble — as big as you dare, without touching anything.',
    icon: c(12, 12, 10) + c(12, 12, 8, true) + c(12, 12, 5) },
  { id: 'marbles', file: './marbles.js', name: 'Marble Chain', color: '#ffb020', blurb: 'Shoot marbles into the rolling chain. Three of a colour pop. A new track every level.',
    icon: c(6, 16, 3) + c(10.5, 9.5, 3) + c(17, 7, 3) + c(18, 17, 2.4) },
  { id: 'perfect', file: './perfect.js', name: 'Perfect Circle', color: '#22d3ee', blurb: 'Draw a circle in one go. How perfect is it?',
    icon: c(12, 12, 9) + c(12, 12, 7, true) + c(19.5, 5.5, 2.2) },
  { id: 'invaders', file: './invaders.js', name: 'Ring Invaders', color: '#8bff6a', blurb: 'Fly around the rim and stop the invasion coming out of the core.',
    icon: 'M8 4h2v2H8zM14 4h2v2h-2zM6 6h12v2h2v6h-2v-2H6v2H4V8h2zM8 9v2h2V9zm6 0v2h2V9zM6 14h2v2H6zm10 0h2v2h-2zM9 16h6v2H9z' },
  { id: 'pong', file: './pong.js', name: 'Circle Pong', color: '#4d9bff', blurb: 'Keep the ball inside the circle with your paddle.',
    icon: 'M4.2 15.5A9 9 0 0 0 19.8 15.5l-1.7-1A7 7 0 0 1 5.9 14.5z' + c(12, 8, 2.6) },
  { id: 'tictactoe', file: './tictactoe.js', name: 'Tic Tac Toe', color: '#ff6a5c', blurb: 'Three in a row — against a friend or the computer.',
    icon: 'M8 3h2v18H8zM14 3h2v18h-2zM3 8h18v2H3zM3 14h18v2H3z' },
  { id: 'stack', file: './stack.js', name: 'Stack', color: '#ffd23f', blurb: 'Tap to drop each block right on top. Build the tallest tower.',
    icon: 'M4 17h16v4H4zM5 12h14v4H5zM7 7h10v4H7zM8 2h8v4H8z' },
  { id: '2048', file: './g2048.js', name: '2048', color: '#ff9f43', blurb: 'Swipe to slide the tiles. Join the numbers to reach 2048.',
    icon: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z' },
  { id: 'connect4', file: './connect4.js', name: 'Four in a Row', color: '#ff4d6d', blurb: 'Drop discs, line up four — against a friend or the computer.',
    icon: 'M3 3h18v18H3z' + c(7.5, 8, 2, true) + c(12, 8, 2, true) + c(16.5, 8, 2, true) + c(7.5, 16, 2, true) + c(12, 16, 2, true) + c(16.5, 16, 2, true) },
  { id: 'floppy', file: './floppy.js', name: 'Floppy Bird', color: '#6ee7b7', blurb: 'Tap to flap through the gaps.',
    icon: 'M10 6c4 0 8 2.5 8 6.5S14.5 19 10 19 3 16.5 3 12.5 6 6 10 6zm3 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM18 12l4 1-4 1.5z' },
  { id: 'running', file: './running.js', name: 'Running Circle', color: '#a78bfa', blurb: 'Your ball runs around the ring. Tap to jump to the other side of the line.',
    icon: c(12, 12, 9) + c(12, 12, 7.5, true) + c(12, 4.3, 2.6) },
  { id: 'hit', file: './hit.js', name: 'Hit Circle', color: '#f472b6', blurb: 'Tap each circle the moment its ring closes in. Fast reflexes!',
    icon: c(12, 12, 10) + c(12, 12, 8.5, true) + c(12, 12, 5) },
  { id: 'mines', file: './mines.js', name: 'Minesweeper', color: '#60a5fa', blurb: 'A round minefield. Clear every safe cell.',
    icon: 'M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z' + c(12, 12, 6) },
  { id: 'dino', file: './dino.js', name: 'Dino Run', color: '#e2e8f0', blurb: 'Jump the cacti, duck the birds. How far can you run?',
    icon: 'M13 3h7v5h-3v1h2v2h-3v3l-3 3v4h-2v-3H9v3H7v-4L3 13V9h2v2l2 2h2l2-2V4z' },
  { id: 'bubbles', file: './bubbles.js', name: 'Bubble Shooter', color: '#38bdf8', blurb: 'Shoot from the rim into the bubble core. Match three to pop.',
    icon: c(12, 12, 3.4) + c(6.5, 9, 3) + c(17.5, 9, 3) + c(9, 17.5, 3) + c(16, 17, 3) },
  { id: 'jetpack', file: './jetpack.js', name: 'Jetpack Dash', color: '#fb923c', blurb: 'Hold to fly, let go to drop. Dodge zappers and missiles, grab coins.',
    icon: 'M12 2c3 2 5 6 5 10l2 3v3l-3-1-1 2H9l-1-2-3 1v-3l2-3c0-4 2-8 5-10z' + c(12, 10, 2, true) },
  { id: 'temple', file: './temple.js', name: 'Temple Dash', color: '#eab308', blurb: 'Run the ancient path. Swipe to turn, jump and slide.',
    icon: 'M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z' },
  { id: 'subway', file: './subway.js', name: 'Rail Rush', color: '#34d399', blurb: 'Dash along the tracks. Swipe to switch lanes, jump and roll.',
    icon: 'M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z' },
  { id: 'bricks', file: './bricks.js', name: 'Bricks Breaker', color: '#f97316', blurb: 'Aim and fire a volley of balls at numbered bricks before they reach the core.',
    icon: 'M3 3h5v5H3zM10 3h5v5h-5zM17 3h4v5h-4zM3 10h5v5H3zM17 10h4v5h-4z' + c(12, 18.5, 2.2) + c(7, 19.5, 1.4) },
  { id: 'blocks', file: './blocks.js', name: 'Block Destroyer', color: '#c084fc', blurb: 'Bounce the ball off your paddle on the rim and break every block. Catch the power-ups.',
    icon: 'M7 4h10v3H7zM4 9h7v3H4zM13 9h7v3h-7zM8 14h8v3H8z' + c(12, 20.2, 1.8) },
  { id: 'rushhour', file: './rushhour.js', name: 'Rush Hour', color: '#ef4444', blurb: 'Slide the cars and trucks to get the red car out. 40+ puzzles, easy to expert.',
    icon: 'M3 9h12v6H3zM17 3h4v12h-4zM9 17h12v4H9z' + c(6, 12, 1.2, true) },
  { id: 'flow', file: './flow.js', name: 'Pipe Link', color: '#2dd4bf', blurb: 'Join each pair of matching dots with a pipe. Fill every cell — no crossing.',
    icon: c(5, 5, 2.6) + c(19, 19, 2.6) + 'M4 4h2.5v9.5H18V21h-2.5v-5H4z' },
  { id: 'hop', file: './hop.js', name: 'Sketch Jump', color: '#a3e635', blurb: 'Bounce up from ledge to ledge. Tilt left and right — don\'t fall!',
    icon: 'M3 20h7v2H3zM14 14h7v2h-7zM5 8h7v2H5z' + c(16.5, 6.5, 3.2) },
  { id: 'zoo', file: './zoo.js', name: 'Zoo Splash', color: '#22c55e', blurb: 'Flick your animals and knock the other team off the island into the sea.',
    icon: 'M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z' + c(8.5, 10, 2.2) + c(15, 14, 2.2) },
  { id: 'rps', file: './rps.js', name: 'RPS Battle', color: '#84cc16', blurb: 'Rock, paper, scissors armies. Find and capture the hidden flag — mind the trap!',
    icon: 'M3 3h8v8H3zM13 13h8v8h-8z' + c(17, 7, 4) + c(7, 17, 4) },
  { id: 'orbits', file: './orbits.js', name: 'Orbits', color: '#818cf8', blurb: 'Fling planets into orbit around black holes — or launch from orbit to orbit and hit the targets.',
    icon: c(12, 12, 3.2) + 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14z' + c(19.5, 7.5, 2.4) },
  { id: 'rope', file: './rope.js', name: 'Rope Snip', color: '#fb7185', blurb: 'Cut the ropes to swing the sweet into the hungry critter. Grab all three stars.',
    icon: 'M11 1h2v10h-2z' + c(12, 14.5, 4) + 'M17 18l4-4 1 1-4 4zM2 15l1-1 4 4-1 1z' },
];

// The Rhythm category's games (rhythm/index.js) run in the same shell: found here too, loaded from rhythm/.
export const gameById = (id) => GAMES.find((g) => g.id === id) || rhythmById(id) || null;

/** Load a game's module (its default export: modes, scoring, how-to and create()). */
export async function loadGame(id) {
  if (!GAMES.some((g) => g.id === id) && rhythmById(id)) return loadRhythmGame(id);
  const meta = gameById(id);
  if (!meta) throw new Error(`No game “${id}”`);
  const mod = await import(meta.file);
  return { ...meta, ...mod.default, id: meta.id, name: meta.name, color: meta.color, icon: meta.icon };
}

export const iconSvg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
