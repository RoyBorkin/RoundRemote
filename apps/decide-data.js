// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Decide — the built-in idea lists: movies & shows, things to do (EN + HE), places to go, video games
// (Steam app ids, so they can be launched on the bridge computer), and dishes by cuisine (EN + HE names).
// Rows are compact strings / arrays; decide-sources.js turns them into items.

// ---------------------------------------------------------------- icons (24×24 paths, even-odd)
const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0z`;
const rr = (x, y, w, hh, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hh - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
export const GLYPH = {
  film: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6zm0 4v4h2v-4zm0 6v2h2v-2zm12-10v2h2V6zm0 4v4h2v-4zm0 6v2h2v-2zM9 6v12h6V6z',
  tv: 'M3 5h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v1.5H7V20h3v-2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v9h16V7z',
  sparkle: 'M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2zM19 15l1 2.6 2.5 1-2.5 1L19 22l-1-2.4-2.5-1 2.5-1z',
  dice: rr(3, 3, 18, 18, 3.4) + c(7.8, 7.8, 1.7) + c(12, 12, 1.7) + c(16.2, 16.2, 1.7),
  pin: 'M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7z' + c(12, 9, 2.6),
  pad: 'M7 6h10a5 5 0 0 1 4.9 6l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 15H9.4l-1.8 2.5A2.6 2.6 0 0 1 3 16.4L2.1 12A5 5 0 0 1 7 6zm0 3v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9z' + c(16, 10, 1.1) + c(18.2, 12.4, 1.1),
  fork: 'M6 2h1.5v6H9V2h1.5v6H12V2h1.5v7a3.5 3.5 0 0 1-2.8 3.4V22H8.3v-9.6A3.5 3.5 0 0 1 5.5 9V2zM17 2c2 0 3 2.5 3 6v5h-2v9h-2.5V2z',
  heart: 'M12 21l-1.4-1.3C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z',
  heartO: 'M12 21l-1.4-1.3C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6zm0-2.7c4.7-4.3 8-7.2 8-10.2 0-2-1.5-3.5-3.5-3.5-1.5 0-3 1-3.6 2.4h-1.8C10.5 5.6 9 4.6 7.5 4.6 5.5 4.6 4 6.1 4 8.1c0 3 3.3 5.9 8 10.2z',
  tune: 'M3 17v2h6v-2zM3 5v2h10V5zm10 16v-2h8v-2h-8v-2h-2v6zM7 9v2H3v2h4v2h2V9zm14 4v-2H11v2zm-6-4h2V7h4V5h-4V3h-2z',
  hist: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
  again: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  gift: 'M3 8h18v4H3zM4.5 12h15v9h-15zM11 8h2v13h-2zM12 8C10 4 6.5 3.5 6.5 5.8 6.5 7.6 9.5 8 12 8zm0 0c2-4 5.5-4.5 5.5-2.2C17.5 7.6 14.5 8 12 8z',
  play: 'M8 5v14l11-7z',
  qr: 'M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z',
  book: 'M12 6.1C10.2 4.8 7.7 4 5 4c-1 0-2 .1-3 .4v14.4c1-.3 2-.4 3-.4 2.7 0 5.2.75 7 2 1.8-1.25 4.3-2 7-2 1 0 2 .1 3 .4V4.4C21 4.1 20 4 19 4c-1.4 0-4.7.3-7 2.1zM11 7.9v10.6c-1.8-.8-3.8-1.2-6-1.2-.35 0-.7 0-1 .05V6.05C4.35 6 4.7 6 5 6c2.2 0 4.3.65 6 1.9zm2 0C14.7 6.65 16.8 6 19 6c.3 0 .65 0 1 .05v11.3c-.3-.05-.65-.05-1-.05-2.2 0-4.2.4-6 1.2z',
  meeple: 'M12 2.2a3.2 3.2 0 0 1 3.2 3.2c0 .9-.35 1.65-.9 2.2 3 .45 6.2 1.5 7.2 2.8.6.95-.6 1.95-2.8 2.15l-2.3.25 3 6.6c.3.6 0 1.1-.65 1.1H15.3L12 16.4l-3.3 4.1H5.25c-.65 0-.95-.5-.65-1.1l3-6.6-2.3-.25C3.1 12.35 1.9 11.35 2.5 10.4c1-1.3 4.2-2.35 7.2-2.8-.55-.55-.9-1.3-.9-2.2A3.2 3.2 0 0 1 12 2.2z',
  cards: rr(8, 2.5, 12, 18, 2) + 'M11 8.5h6v6h-6z' + 'M6.6 5.2l.4 13.4L3.3 18a1.2 1.2 0 0 1-1-1.4L4.6 6.2a1.2 1.2 0 0 1 1.4-1z',
  party: 'M3 21l5-14 9 9zm3.4-3.4l4.3-1.5-2.8-2.8zM14 2h2v3h-2zM19 7h3v2h-3zM16.5 4.1l1.4 1.4-2.1 2.1-1.4-1.4zM17 12c1.5-.8 3-.6 4 .4l-1.4 1.4c-.4-.4-1.1-.5-1.8-.1z',
  note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
  bottle: 'M10 2h4v3l1.5 2.5V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V7.5L10 5zm-.5 9v6h5v-6z',
  // moods / places / food
  moon: 'M12.3 2a8 8 0 1 0 9.7 9.7A9.5 9.5 0 0 1 12.3 2z',
  run: c(14, 4, 2) + 'M9.8 8.2l3.6-1 3 3.6 3.1.9-.5 1.9-3.8-1.1-1.4-1.6-1 3.6 2.7 2.4V22h-2v-4.4l-3-2.5L10.5 22H8.4l2.6-11.6-1.6.5v3.2h-2V9.6z',
  people: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  brush: 'M20.7 3.3a1 1 0 0 0-1.4 0L10 12.6l1.4 1.4 9.3-9.3a1 1 0 0 0 0-1.4zM7.5 14C5.6 14 4 15.6 4 17.5c0 1.3-1.2 2-2 2 1 1.4 2.8 2.5 5 2.5a4.5 4.5 0 0 0 4.5-4.5c0-.3 0-.5-.1-.8z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  tree: 'M12 2l5 7h-2.5l4 5.5H15l3.5 4.5H13v3h-2v-3H5.5L9 14.5H5.5l4-5.5H7z',
  cup: 'M3 6h14v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6zm14 1.5h1.5a3 3 0 0 1 0 6H17v-2h1.5a1 1 0 0 0 0-2H17zM2 20h17v2H2zM7 1.5c1 1 1 2 0 3l-1.2-.8c.4-.5.4-.9 0-1.4zm4 0c1 1 1 2 0 3l-1.2-.8c.4-.5.4-.9 0-1.4z',
  columns: 'M12 2l10 5v2H2V7zM4 10.5h3v7H4zm6.5 0h3v7h-3zm6.5 0h3v7h-3zM2 19h20v3H2z',
  wave: 'M2 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v2c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2zm0-5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v2c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2zM17 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  bag: 'M5 7h14l1 15H4zm3 0a4 4 0 0 1 8 0h-2a2 2 0 0 0-4 0zm-1 3v2h2v-2zm8 0v2h2v-2z',
  mountain: 'M14 5l8 14H2L9 8l3 4.2zM9 11.5L5.4 17h7.2z',
  house: 'M12 3l10 9h-3v9h-5v-6h-4v6H5v-9H2z',
  cart: 'M3 3h3l.7 3H21l-2.4 8H8.3l.5 2H19v2H7.2L4.5 5H3zm5 17a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm9 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  paw: c(6, 9, 2) + c(10, 5.5, 2) + c(14, 5.5, 2) + c(18, 9, 2) + 'M12 11c3 0 6 4.5 6 7.2 0 1.7-1.3 2.8-3 2.8-1.2 0-2-.6-3-.6s-1.8.6-3 .6c-1.7 0-3-1.1-3-2.8C6 15.5 9 11 12 11z',
  flower: c(12, 6, 3.2) + c(17.2, 9.8, 3.2) + c(15.2, 16, 3.2) + c(8.8, 16, 3.2) + c(6.8, 9.8, 3.2) + c(12, 11.5, 2.4),
  sun: c(12, 12, 4.5) + 'M11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  drop: 'M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2z',
  pins: c(12, 4, 2.2) + 'M9.8 7h4.4c.6 2-1 4 0 6.5 1 2.6.6 5.5-.6 8.5h-3.2c-1.2-3-1.6-5.9-.6-8.5 1-2.5-.6-4.5 0-6.5z',
  lock: 'M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h8V8a4 4 0 1 0-8 0zm3 4v4h2v-4z',
  image: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v10.5l4.5-4.5 3 3 4-5 4.5 5.5V6zM8 7.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
  glass: 'M5 2h14l-1 7a6 6 0 0 1-5 5.9V20h4v2H7v-2h4v-5.1A6 6 0 0 1 6 9zm1.9 2l.5 3h9.2l.5-3z',
  cone: 'M7 9a5 5 0 0 1 10 0h.5L12 23 6.5 9z',
  ball: c(12, 12, 10) + 'M12 4.5l3.5 2.5-1.3 4h-4.4L8.5 7zM6.7 13l2 1.4L8 18.5a8 8 0 0 1-3.4-3.8zm10.6 0l2.1 1.7a8 8 0 0 1-3.4 3.8l-.7-4.1z',
  wheel: c(12, 12, 10) + c(12, 12, 8) + 'M11 4h2v16h-2zM4 11h16v2H4z',
  spa: 'M12 4c2 2.2 3 4.6 3 7.2 0 2.4-1 4.3-3 5.8-2-1.5-3-3.4-3-5.8C9 8.6 10 6.2 12 4zM2 10c3.2-.1 6 1.3 7.6 4.3 1 1.9 1.4 3.9 1.3 5.7C6.5 19.7 2.3 16.3 2 10zm20 0c-.3 6.3-4.5 9.7-8.9 10 0-1.8.3-3.8 1.3-5.7 1.6-3 4.4-4.4 7.6-4.3z',
  tent: 'M12 2l1.2 1.6L22 20v2H2v-2l8.8-16.4zM12 9.5L8 20h8z',
  bus: 'M5 3h14a2 2 0 0 1 2 2v13a2 2 0 0 1-1 1.7V22h-3v-2H7v2H4v-2.3A2 2 0 0 1 3 18V5a2 2 0 0 1 2-2zm0 3v6h14V6zm1.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm11 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  bulb: 'M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2zM9 18.5h6V20a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z',
  mic: rr(8.5, 2, 7, 12, 3.5) + 'M5 10h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V20h3v2H8v-2h3v-3.1A7 7 0 0 1 5 10z',
  bowl: 'M2 11h20a10 10 0 0 1-6 9.2V22H8v-1.8A10 10 0 0 1 2 11zM8 3c1 1.2 1 2.4 0 3.6l1.2.9c1.4-1.7 1.4-3.6 0-5.4zm4 0c1 1.2 1 2.4 0 3.6l1.2.9c1.4-1.7 1.4-3.6 0-5.4zm4 0c1 1.2 1 2.4 0 3.6l1.2.9c1.4-1.7 1.4-3.6 0-5.4z',
  pizza: 'M12 2C7.7 2 4.1 3.6 2 5.7L12 22 22 5.7C19.9 3.6 16.3 2 12 2zm0 2c3.3 0 6.1 1.1 7.6 2.3l-.9 1.5A13.6 13.6 0 0 0 12 6c-2.5 0-4.8.6-6.7 1.8l-.9-1.5C5.9 5.1 8.7 4 12 4z' + c(9.5, 10, 1.4) + c(14, 12.5, 1.4) + c(11.5, 15.8, 1.2),
  leaf: 'M20 3C10 3 4 8 4 15c0 1.6.4 3.2 1.1 4.6L3 21.7 4.3 23l2.1-2.1A8.2 8.2 0 0 0 10 22c7 0 11-6 11-14 0-1.7-.3-3.4-1-5zm-9.5 15.2L9 16.7c2.6-3.6 5.4-6 8.6-7.6l.7 1.2c-3 1.5-5.7 3.9-7.8 7.9z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6z',
  flame: 'M12 2c1 3.5 6 6 6 11.5A6 6 0 0 1 6 13.5C6 10 8 8.5 9 6.5c.5 2 1.4 3 2.5 3.5C11 7.5 11.2 4.5 12 2z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 3h2v5.4l4 2.4-1 1.7-5-3z',
};

// ---------------------------------------------------------------- movies & shows (fallback ideas)
// [title, year, 'm'ovie | 's'how, genres, minutes (movie length or a typical episode)]
export const WATCH = [
  ['The Shawshank Redemption', 1994, 'm', 'drama', 142], ['The Godfather', 1972, 'm', 'crime,drama', 175], ['The Dark Knight', 2008, 'm', 'action,crime', 152],
  ['Pulp Fiction', 1994, 'm', 'crime,comedy', 154], ['Forrest Gump', 1994, 'm', 'drama,romance', 142], ['Inception', 2010, 'm', 'scifi,action', 148],
  ['The Matrix', 1999, 'm', 'scifi,action', 136], ['Interstellar', 2014, 'm', 'scifi,drama', 169], ['Spirited Away', 2001, 'm', 'animation,fantasy,family', 125],
  ['Toy Story', 1995, 'm', 'animation,family,comedy', 81], ['Back to the Future', 1985, 'm', 'scifi,comedy,adventure', 116], ['Jurassic Park', 1993, 'm', 'adventure,scifi', 127],
  ['The Lord of the Rings: The Fellowship of the Ring', 2001, 'm', 'fantasy,adventure', 178], ['Star Wars', 1977, 'm', 'scifi,adventure', 121],
  ['Raiders of the Lost Ark', 1981, 'm', 'adventure,action', 115], ['Alien', 1979, 'm', 'scifi,horror', 117], ['The Silence of the Lambs', 1991, 'm', 'thriller,crime', 118],
  ['Se7en', 1995, 'm', 'thriller,crime', 127], ['Fight Club', 1999, 'm', 'drama,thriller', 139], ['Gladiator', 2000, 'm', 'action,drama', 155],
  ['Titanic', 1997, 'm', 'romance,drama', 194], ['The Lion King', 1994, 'm', 'animation,family', 88], ['Finding Nemo', 2003, 'm', 'animation,family,comedy', 100],
  ['Up', 2009, 'm', 'animation,family,comedy', 96], ['Inside Out', 2015, 'm', 'animation,family,comedy', 95], ['Coco', 2017, 'm', 'animation,family,musical', 105],
  ['Shrek', 2001, 'm', 'animation,comedy,family', 90], ['Paddington 2', 2017, 'm', 'family,comedy', 103], ['The Grand Budapest Hotel', 2014, 'm', 'comedy', 99],
  ['Groundhog Day', 1993, 'm', 'comedy,romance,fantasy', 101], ['Superbad', 2007, 'm', 'comedy', 113], ['The Big Lebowski', 1998, 'm', 'comedy,crime', 117],
  ['Mean Girls', 2004, 'm', 'comedy', 97], ['Knives Out', 2019, 'm', 'mystery,comedy,crime', 130], ['Get Out', 2017, 'm', 'horror,thriller', 104],
  ['The Shining', 1980, 'm', 'horror', 146], ['A Quiet Place', 2018, 'm', 'horror,scifi', 90], ['Hereditary', 2018, 'm', 'horror', 127],
  ['Mad Max: Fury Road', 2015, 'm', 'action,scifi', 120], ['John Wick', 2014, 'm', 'action,thriller', 101], ['Die Hard', 1988, 'm', 'action,thriller', 132],
  ['Top Gun: Maverick', 2022, 'm', 'action,drama', 131], ['Mission: Impossible – Fallout', 2018, 'm', 'action,thriller', 147],
  ['Everything Everywhere All at Once', 2022, 'm', 'scifi,comedy,action', 139], ['Parasite', 2019, 'm', 'thriller,drama', 132], ['La La Land', 2016, 'm', 'musical,romance', 128],
  ['The Notebook', 2004, 'm', 'romance,drama', 123], ['Pride & Prejudice', 2005, 'm', 'romance,drama', 129], ['Amélie', 2001, 'm', 'romance,comedy', 122],
  ['When Harry Met Sally…', 1989, 'm', 'romance,comedy', 95], ['Notting Hill', 1999, 'm', 'romance,comedy', 124], ['Arrival', 2016, 'm', 'scifi,drama', 116],
  ['Blade Runner 2049', 2017, 'm', 'scifi,thriller', 164], ['Dune', 2021, 'm', 'scifi,adventure', 155], ['Avatar', 2009, 'm', 'scifi,adventure', 162],
  ['Avengers: Endgame', 2019, 'm', 'action,scifi,adventure', 181], ['Spider-Man: Into the Spider-Verse', 2018, 'm', 'animation,action,family', 117],
  ['Guardians of the Galaxy', 2014, 'm', 'action,scifi,comedy', 121], ['Harry Potter and the Philosopher’s Stone', 2001, 'm', 'fantasy,family,adventure', 152],
  ['The Princess Bride', 1987, 'm', 'fantasy,comedy,romance', 98], ['Pan’s Labyrinth', 2006, 'm', 'fantasy,drama', 118], ['The Social Network', 2010, 'm', 'drama', 120],
  ['Whiplash', 2014, 'm', 'drama,musical', 107], ['The Truman Show', 1998, 'm', 'comedy,drama', 103], ['Good Will Hunting', 1997, 'm', 'drama', 126],
  ['Oppenheimer', 2023, 'm', 'drama', 180], ['Barbie', 2023, 'm', 'comedy,fantasy', 114], ['Free Solo', 2018, 'm', 'doc', 100],
  ['My Octopus Teacher', 2020, 'm', 'doc', 85], ['Won’t You Be My Neighbor?', 2018, 'm', 'doc', 94], ['The Incredibles', 2004, 'm', 'animation,action,family', 115],
  ['Ratatouille', 2007, 'm', 'animation,family,comedy', 111], ['WALL·E', 2008, 'm', 'animation,scifi,family', 98], ['My Neighbor Totoro', 1988, 'm', 'animation,family,fantasy', 86],
  ['Ocean’s Eleven', 2001, 'm', 'crime,comedy,thriller', 116], ['Heat', 1995, 'm', 'crime,action', 170], ['Gone Girl', 2014, 'm', 'thriller,mystery', 149],
  ['Prisoners', 2013, 'm', 'thriller,mystery', 153], ['The Martian', 2015, 'm', 'scifi,adventure', 144], ['Edge of Tomorrow', 2014, 'm', 'scifi,action', 113],
  ['Hot Fuzz', 2007, 'm', 'comedy,action', 121], ['Shaun of the Dead', 2004, 'm', 'comedy,horror', 99], ['Home Alone', 1990, 'm', 'comedy,family', 103],
  ['The Intouchables', 2011, 'm', 'comedy,drama', 112], ['Bohemian Rhapsody', 2018, 'm', 'drama,musical', 134], ['The Sound of Music', 1965, 'm', 'musical,family', 172],
  ['Mamma Mia!', 2008, 'm', 'musical,comedy', 108], ['Frozen', 2013, 'm', 'animation,musical,family', 102], ['Encanto', 2021, 'm', 'animation,musical,family', 102],
  ['Zootopia', 2016, 'm', 'animation,comedy,family', 108],
  // shows
  ['Breaking Bad', 2008, 's', 'crime,drama,thriller', 49], ['Game of Thrones', 2011, 's', 'fantasy,drama', 57], ['The Office', 2005, 's', 'comedy', 22],
  ['Friends', 1994, 's', 'comedy,romance', 22], ['Stranger Things', 2016, 's', 'scifi,horror', 51], ['The Crown', 2016, 's', 'drama', 58],
  ['Seinfeld', 1989, 's', 'comedy', 22], ['The Sopranos', 1999, 's', 'crime,drama', 55], ['The Wire', 2002, 's', 'crime,drama', 59],
  ['Sherlock', 2010, 's', 'mystery,crime', 88], ['Ted Lasso', 2020, 's', 'comedy,drama', 35], ['Brooklyn Nine-Nine', 2013, 's', 'comedy,crime', 22],
  ['Parks and Recreation', 2009, 's', 'comedy', 22], ['The Mandalorian', 2019, 's', 'scifi,adventure,action', 40], ['Succession', 2018, 's', 'drama', 60],
  ['Fleabag', 2016, 's', 'comedy,drama', 27], ['Chernobyl', 2019, 's', 'drama', 65], ['Planet Earth II', 2016, 's', 'doc,family', 50],
  ['Our Planet', 2019, 's', 'doc,family', 50], ['Black Mirror', 2011, 's', 'scifi,thriller', 60], ['The Last of Us', 2023, 's', 'drama,horror', 55],
  ['Severance', 2022, 's', 'scifi,thriller,mystery', 50], ['The Bear', 2022, 's', 'comedy,drama', 30], ['Wednesday', 2022, 's', 'comedy,mystery,fantasy', 50],
  ['Squid Game', 2021, 's', 'thriller,drama', 55], ['Money Heist', 2017, 's', 'crime,thriller', 50], ['Dark', 2017, 's', 'scifi,mystery', 55],
  ['Fauda', 2015, 's', 'action,thriller', 45], ['Shtisel', 2013, 's', 'drama', 45], ['The Simpsons', 1989, 's', 'animation,comedy,family', 22],
  ['Rick and Morty', 2013, 's', 'animation,comedy,scifi', 22], ['Avatar: The Last Airbender', 2005, 's', 'animation,fantasy,family', 23], ['Bluey', 2018, 's', 'animation,family,comedy', 7],
  ['Arcane', 2021, 's', 'animation,fantasy,action', 40], ['Only Murders in the Building', 2021, 's', 'comedy,mystery', 33], ['The Good Place', 2016, 's', 'comedy,fantasy', 22],
  ['Schitt’s Creek', 2015, 's', 'comedy', 22], ['How I Met Your Mother', 2005, 's', 'comedy,romance', 22], ['Modern Family', 2009, 's', 'comedy,family', 22],
  ['The Big Bang Theory', 2007, 's', 'comedy', 21], ['Better Call Saul', 2015, 's', 'crime,drama', 50], ['Band of Brothers', 2001, 's', 'drama,action', 60],
  ['The Witcher', 2019, 's', 'fantasy,action', 60], ['House of the Dragon', 2022, 's', 'fantasy,drama', 60], ['The Queen’s Gambit', 2020, 's', 'drama', 55],
  ['Bridgerton', 2020, 's', 'romance,drama', 60], ['Peaky Blinders', 2013, 's', 'crime,drama', 58], ['Mindhunter', 2017, 's', 'crime,thriller', 55],
  ['Lost', 2004, 's', 'mystery,adventure', 44], ['Doctor Who', 2005, 's', 'scifi,adventure,family', 45],
];
export const GENRES = [['action', 'Action'], ['adventure', 'Adventure'], ['animation', 'Animation'], ['comedy', 'Comedy'], ['crime', 'Crime'], ['doc', 'Documentary'],
  ['drama', 'Drama'], ['family', 'Family'], ['fantasy', 'Fantasy'], ['horror', 'Horror'], ['musical', 'Music'], ['mystery', 'Mystery'], ['romance', 'Romance'],
  ['scifi', 'Sci-fi'], ['thriller', 'Thriller']];
/** Map a library's genre names (any language the server speaks English in) to ours. */
export const GENRE_RE = [['action', /action|war|western|martial/i], ['adventure', /adventure/i], ['animation', /anim|anime|cartoon/i], ['comedy', /comed|sitcom|humou?r/i],
  ['crime', /crime|heist|gangster|police/i], ['doc', /documentar|biograph|history|nature|reality/i], ['drama', /drama/i], ['family', /family|kids|children/i],
  ['fantasy', /fantasy|magic|fairy/i], ['horror', /horror|slasher|zombie/i], ['musical', /music|musical|concert/i], ['mystery', /myster|detective|suspense/i],
  ['romance', /romanc|love/i], ['scifi', /sci-?fi|science fiction|space/i], ['thriller', /thriller|noir/i]];

// ---------------------------------------------------------------- things to do
// 'text|moods|where|who|minutes|cost'  moods: c chill · a active · s social · r creative · p productive
// where: i indoors · o outdoors · b either · who: 1 alone · 2 with others · b either · cost: 0 free · 1 cheap · 2 a treat
export const DO_EN = `Take a long bath with music|c|i|1|45|0
Read a chapter of a book|c|i|1|30|0
Watch the sunset|c|o|b|30|0
Make hot chocolate and listen to a whole album|c|i|b|45|0
Take a 20-minute power nap|c|i|1|20|0
Do a 10-minute guided meditation|c|i|1|10|0
Lie in the park and watch the clouds|c|o|b|30|0
Listen to a podcast episode|c|b|1|45|0
Do a jigsaw puzzle|c,r|i|b|90|0
Have a tea tasting with three different teas|c|i|b|30|1
Stretch or do gentle yoga for 15 minutes|c,a|i|1|15|0
Stargaze and spot three constellations|c|o|b|45|0
Re-watch a comfort movie|c|i|b|120|0
Light a candle and journal about your week|c,r|i|1|20|0
Go for a slow walk without your phone|c,a|o|1|30|0
Build a cosy blanket fort|c,r|i|b|30|0
Sit in a café and people-watch|c|o|b|45|1
Listen to rain sounds and doodle|c,r|i|1|20|0
Have a spa evening: face mask and foot soak|c|i|1|60|1
Flip through old photo albums|c|i|b|30|0
Do a crossword or a sudoku|c|i|1|20|0
Water and pamper your plants|c,p|i|1|15|0
Make a new playlist for the season|c,r|i|1|30|0
Sit on the balcony with a cold drink|c|o|b|30|0
Try the 4-7-8 breathing exercise|c|i|1|5|0
Watch a nature documentary|c|i|b|60|0
Bake something simple just for the smell|c,r|i|b|60|1
Read a magazine instead of a screen|c|i|1|30|1
Visit a pond and watch the ducks|c|o|b|30|0
Have a lazy indoor picnic on the floor|c,s|i|2|60|1
Go for a run|a|o|1|30|0
Ride a bike around the neighbourhood|a|o|b|60|0
Do a 20-minute home workout|a|i|1|20|0
Dance like nobody’s watching to five songs|a|i|b|20|0
Go for a swim|a|o|b|60|1
Play frisbee or catch in the park|a,s|o|2|45|0
Try a hiking trail you’ve never walked|a|o|b|180|0
Go bowling|a,s|i|2|90|2
Try bouldering at a climbing gym|a|i|b|120|2
Jump rope for 10 minutes|a|o|1|10|0
Shoot some hoops at a public court|a,s|o|b|60|0
Go roller-skating or rollerblading|a|o|b|60|1
Walk to a part of town you’ve never been to|a|o|b|90|0
Do a plank challenge|a|i|b|10|0
Play table tennis|a,s|b|2|45|0
Take a dance class|a,s|i|b|60|2
Go for a sunrise walk|a,c|o|1|45|0
Go kayaking or paddleboarding|a|o|b|120|2
Play a round of mini golf|a,s|o|2|60|1
Try a yoga video you’ve never done|a,c|i|1|30|0
Play football with friends|a,s|o|2|90|0
Bounce around a trampoline park|a,s|i|b|60|2
Climb 20 floors of stairs|a|i|1|15|0
Take a long beach walk|a,c|o|b|60|0
Play tennis or padel|a,s|o|2|60|1
Do an outdoor bodyweight workout|a|o|1|30|0
Cycle to a café in the next town|a|o|b|120|1
Play Twister|a,s|i|2|20|0
Do a neighbourhood scavenger hunt|a,s,r|o|2|60|0
Go ice-skating|a,s|i|b|90|2
Host a board game night|s|i|2|180|1
Call a friend you haven’t talked to in a while|s|i|1|30|0
Cook dinner together|s,r|i|2|90|1
Have a karaoke night|s|i|2|120|0
Invite the neighbours over for coffee|s|i|2|60|1
Go to a pub quiz|s|i|2|120|1
Have a picnic with friends|s,c|o|2|120|1
Have a movie marathon with friends|s,c|i|2|240|0
Write a letter or postcard to someone|s,r|i|1|20|1
Plan a surprise for someone you love|s,r|b|1|45|1
Host a potluck dinner|s|i|2|180|1
Go to a live music gig|s|i|2|180|2
Play charades|s|i|2|45|0
Video-call family|s|i|1|30|0
Visit a grandparent or an older relative|s|b|2|90|0
Join a local meetup or club|s|b|2|120|1
Have a barbecue|s|o|2|180|2
Play truth or dare|s|i|2|45|0
Organise a clothes swap|s,p|i|2|120|0
Go to a comedy show|s|i|2|120|2
Have a pizza-and-games night|s|i|2|180|1
Teach someone a skill you know|s,p|b|2|60|0
Volunteer for a few hours|s,p|b|b|180|0
Host a themed dinner party|s,r|i|2|240|2
Go out for dessert|s|o|2|60|1
Play cards with the family|s|i|2|60|0
Start a photo-of-the-day challenge in the group chat|s,r|i|1|10|0
Make a trivia quiz for your friends|s,r|i|1|60|0
Walk and talk with a friend|s,a|o|2|60|0
Have a sleepover with snacks and films|s,c|i|2|480|1
Draw the view from your window|r|i|1|30|0
Write a short story in 30 minutes|r|i|1|30|0
Learn a song on an instrument|r|i|1|60|0
Bake bread from scratch|r,p|i|b|240|1
Try watercolour painting|r,c|i|1|60|1
Make a collage from old magazines|r|i|b|60|0
Take a themed photo walk (red things, doors, shadows…)|r,a|o|b|60|0
Build something with LEGO|r,c|i|b|60|0
Write a poem|r|i|1|20|0
Make a stop-motion video|r|i|b|90|0
Cook a recipe from a country you’ve never visited|r|i|b|90|1
Learn origami — fold a crane|r,c|i|b|20|0
Redecorate a corner of your room|r,p|i|1|90|1
Make pizza from scratch|r,s|i|b|90|1
Start a doodle diary|r|i|1|20|0
Try hand lettering|r|i|1|45|1
Make a playlist for someone|r,s|i|1|30|0
Try air-dry clay or pottery|r|i|b|90|1
Make homemade ice lollies|r|i|b|60|1
Make a beat in a free music app|r|i|1|60|0
Knit, crochet or embroider something small|r,c|i|1|60|1
Design a board game with your own rules|r,s|i|b|120|0
Paint rocks and hide them around town|r,a|b|b|60|1
Write a song with silly lyrics|r,s|i|b|45|0
Make a family recipe book|r,p|i|b|120|0
Draw with chalk on the pavement|r|o|b|45|1
Learn a card magic trick|r,s|i|1|30|0
Make candles or soap|r|i|b|120|2
Plant a herb garden|r,p|b|b|60|1
Make a vision board|r,p|i|1|60|0
Declutter one drawer|p|i|1|15|0
Plan meals for the week|p|i|1|30|0
Learn 20 words in a new language|p|i|1|20|0
Clean out your phone’s photos|p,c|i|1|30|0
Do a 25-minute focus sprint on something you’ve put off|p|i|1|25|0
Fix something that’s been broken for ages|p|i|1|60|1
Take a lesson of a free online course|p|i|1|60|0
Get your inbox to zero|p|i|1|45|0
Wash the car|p,a|o|b|45|1
Rearrange the furniture|p,r|i|b|90|0
Make a budget for the month|p|i|1|45|0
Deep-clean the kitchen|p,a|i|b|90|0
Donate clothes you don’t wear|p|i|1|60|0
Batch-cook lunches for the week|p|i|b|120|1
Update your CV or portfolio|p|i|1|60|0
Back up your computer and phone|p|i|1|30|0
Practise touch-typing for 15 minutes|p|i|1|15|0
Sort your bookshelf by colour|p,r|i|1|45|0
Write your goals for the next three months|p|i|1|30|0
Learn three new keyboard shortcuts|p|i|1|10|0
Tidy the garden or the balcony|p,a|o|b|60|0
Sort out the spice cupboard|p|i|1|20|0
Read about a topic you know nothing about|p,c|i|1|30|0
Do a language app lesson|p|i|1|15|0
Clean and organise your desk|p|i|1|20|0
Tune up your bike|p|o|1|45|1
Write thank-you notes|p,s|i|1|30|0
Make a reading list for the year|p,c|i|1|20|0
Unsubscribe from newsletters you never read|p|i|1|15|0
Watch a TED talk and take notes|p|i|1|20|0`;
export const DO_HE = `לצאת להליכה על הטיילת|a,c|o|b|60|0
לעשות פיקניק בפארק|s,c|o|2|120|1
לשחק שש-בש עם חבר|s,c|b|2|30|0
להכין שקשוקה לכולם|r,s|i|2|30|1
ללכת לים לראות שקיעה|c|o|b|60|0
לקפוץ לשוק ולקנות פירות עונה|a,s|o|b|60|1
לאפות חלה|r,p|i|b|180|1
לשחק מטקות בחוף|a,s|o|2|60|0
ללכת קטע קצר בשביל ישראל|a|o|b|240|0
לבקר את סבא וסבתא|s|b|2|120|0
להזמין חברים לערב משחקי קופסה|s|i|2|180|1
לקרוא ספר בערסל|c|o|1|60|0
ללמוד שיר חדש בגיטרה|r|i|1|60|0
לעשות סדר בארון הבגדים|p|i|1|60|0
לרכוב על אופניים בפארק|a|o|b|90|0
לצפות בסרט ישראלי קלאסי|c|i|b|120|0
לעשות על האש|s|o|2|180|2
לשחק כדורגל בשכונה|a,s|o|2|60|0
לכתוב מכתב לחבר רחוק|s,r|i|1|30|0
להתנדב בבנק המזון|s,p|b|2|180|0
לבשל ארוחת שישי|r,p|i|b|180|1
לעשות יוגה במרפסת|a,c|o|1|30|0
לבקר במוזיאון|c,r|i|b|150|2
לטבול במעיין|a,c|o|b|180|0
לעשות ערב קריוקי|s|i|2|120|0
לצייר את הנוף מהחלון|r|i|1|45|0
לנקות את המטבח לעומק|p|i|b|90|0
להכין תפריט ורשימת קניות לשבוע|p|i|1|30|0
לשחק טאקי עם המשפחה|s|i|2|30|0
לשבת בבית קפה עם ספר|c|o|1|60|1
ללמוד 20 מילים בשפה חדשה|p|i|1|20|0
לשתול עשבי תיבול באדנית|r,p|b|1|45|1
לרוץ 5 ק״מ|a|o|1|35|0
להרכיב פאזל של 1000 חלקים|c,r|i|b|180|0
לסדר את התמונות בטלפון|p|i|1|30|0
לזרוק לסל במגרש השכונתי|a,s|o|b|60|0
לבקר בשוק הפשפשים|s,c|o|b|120|1
להכין גלידה ביתית|r|i|b|60|1
לעשות מסיבת פיג׳מות עם סרטים|s,c|i|2|240|1
להתקשר לחבר שלא דיברתם איתו מזמן|s|i|1|30|0
לטפס על מצדה בזריחה|a|o|b|300|1
לעשות סדנת קרמיקה|r|i|b|120|2
לנגן ולשיר ביחד|s,r|i|2|60|0
לשחק כדורעף בחוף|a,s|o|2|60|0
לכתוב יומן על השבוע|c,r|i|1|20|0
לעשות אימון כושר בבית|a|i|1|30|0
לבנות מבצר שמיכות|r,c|i|b|30|0
לאפות עוגיות ולחלק לשכנים|r,s|i|b|90|1
לצאת לסיור אוכל בשכונה|s|o|2|120|2
לראות כוכבים במדבר|c|o|b|180|0
ללמוד טריק קסמים|r|i|1|30|0
לתקן משהו שהתקלקל בבית|p|i|1|60|1
לעשות חידון משפחתי|s|i|2|45|0
לעשות מדיטציה של 10 דקות|c|i|1|10|0
ללכת לסרט בקולנוע|s,c|i|b|150|2
לטייל בעיר העתיקה|a,s|o|b|180|0
לסדר את מדף הספרים|p|i|1|45|0
לעשות מסיבת ריקודים בסלון|a,s|i|2|45|0
לכתוב רשימת יעדים לחודש הבא|p|i|1|20|0
לבשל מתכון של סבתא|r,s|i|b|90|1`;
export const MOODS = [['c', 'Chill', 'moon', '#818cf8'], ['a', 'Active', 'run', '#22c55e'], ['s', 'Social', 'people', '#f472b6'], ['r', 'Creative', 'brush', '#f59e0b'], ['p', 'Productive', 'check', '#06b6d4']];

// ---------------------------------------------------------------- places to go
// [title, maps search ('' = none), moods, budget 0-2, distance 1 walk · 2 short drive · 3 day trip, i/o/b, glyph, tip]
// moods: r relax · f fun · a active · c culture · d food & drink · s friends
export const GO = [
  ['A park', 'park', 'r,a', 0, 1, 'o', 'tree', 'Bring a blanket, a snack and a book.'],
  ['A café', 'cafe', 'r,d', 1, 1, 'i', 'cup', 'Order something you’ve never tried.'],
  ['A museum', 'museum', 'c', 1, 2, 'i', 'columns', 'Pick one room and really look.'],
  ['The beach', 'beach', 'r,a', 0, 2, 'o', 'wave', 'Sunscreen, water and a frisbee.'],
  ['The cinema', 'cinema', 'f', 2, 2, 'i', 'film', 'Choose the film by its poster alone.'],
  ['A shopping mall', 'shopping mall', 'f', 1, 2, 'i', 'bag', 'Window-shopping only — challenge accepted?'],
  ['A hiking trail', 'hiking trail', 'a', 0, 3, 'o', 'mountain', 'Start early and pack plenty of water.'],
  ['A restaurant you’ve never tried', 'restaurant', 'd,s', 2, 2, 'i', 'fork', 'Order the chef’s special.'],
  ['A friend’s house', '', 's,f', 0, 2, 'i', 'house', 'Text first — and bring dessert.'],
  ['A bookshop', 'bookstore', 'c,r', 1, 1, 'i', 'book', 'Buy the book with the best cover.'],
  ['The library', 'library', 'c,r', 0, 1, 'i', 'book', 'Read the first page of five random books.'],
  ['A farmers’ market', 'farmers market', 'd,f', 1, 2, 'o', 'cart', 'Taste one thing you can’t name.'],
  ['The zoo', 'zoo', 'f', 2, 2, 'o', 'paw', 'Find a new favourite animal.'],
  ['An aquarium', 'aquarium', 'f,c', 2, 2, 'i', 'wave', 'Catch the feeding times.'],
  ['A botanical garden', 'botanical garden', 'r,c', 1, 2, 'o', 'flower', 'Find the oldest tree there.'],
  ['A lookout point', 'scenic viewpoint', 'r', 0, 2, 'o', 'sun', 'Best at golden hour.'],
  ['A waterfall or a spring', 'waterfall', 'a,r', 0, 3, 'o', 'drop', 'Pack a towel and good shoes.'],
  ['A bowling alley', 'bowling alley', 'f,s', 2, 2, 'i', 'pins', 'Loser buys the milkshakes.'],
  ['An escape room', 'escape room', 'f,s', 2, 2, 'i', 'lock', 'Book ahead; 4–6 players is ideal.'],
  ['An arcade', 'arcade', 'f', 1, 2, 'i', 'pad', 'Set a budget of tokens first.'],
  ['An art gallery', 'art gallery', 'c', 0, 2, 'i', 'image', 'Pick the one piece you’d take home.'],
  ['A swimming pool', 'swimming pool', 'a,r', 1, 1, 'b', 'wave', 'Ten lengths, then the jacuzzi.'],
  ['A cosy bar', 'bar', 's,d', 2, 1, 'i', 'glass', 'Try the house cocktail.'],
  ['An ice-cream shop', 'ice cream', 'd,f', 1, 1, 'i', 'cone', 'Two scoops, two flavours you’ve never had.'],
  ['A bakery', 'bakery', 'd', 1, 1, 'i', 'fork', 'Get whatever just came out of the oven.'],
  ['A climbing gym', 'climbing gym', 'a', 2, 2, 'i', 'mountain', 'Start on the easy colours.'],
  ['A theme park', 'amusement park', 'f', 2, 3, 'o', 'wheel', 'Go on a weekday to skip the queues.'],
  ['A historic site', 'historic site', 'c', 1, 3, 'o', 'columns', 'Join the free guided tour.'],
  ['A lake or a river', 'lake', 'r,a', 0, 2, 'o', 'wave', 'Skip stones — beat your record.'],
  ['A theatre show', 'theater', 'c,s', 2, 2, 'i', 'star', 'Last-minute tickets are often cheaper.'],
  ['A live music venue', 'live music', 's,f', 2, 2, 'i', 'note', 'Go for the band you don’t know.'],
  ['A sports match', 'stadium', 'f,s', 2, 2, 'o', 'ball', 'Wear the colours, learn one chant.'],
  ['A spa', 'spa', 'r', 2, 2, 'i', 'spa', 'Phone in a locker. All of it.'],
  ['A flea market', 'flea market', 'f,c', 1, 2, 'o', 'bag', 'Haggle for one weird treasure.'],
  ['A brunch spot', 'brunch', 'd,s', 2, 1, 'i', 'cup', 'Order to share.'],
  ['A playground', 'playground', 'f,a', 0, 1, 'o', 'star', 'The swings are still the best.'],
  ['A nature reserve', 'nature reserve', 'a,r', 0, 3, 'o', 'tree', 'Bring binoculars for the birds.'],
  ['Street food', 'street food', 'd', 1, 2, 'o', 'fork', 'Follow the longest local queue.'],
  ['A karaoke bar', 'karaoke', 'f,s', 2, 2, 'i', 'mic', 'Everyone sings one song. No excuses.'],
  ['A rooftop', 'rooftop bar', 's,r', 2, 2, 'o', 'sun', 'Time it for the sunset.'],
  ['A campsite', 'campground', 'a,r', 1, 3, 'o', 'tent', 'Marshmallows are not optional.'],
  ['A brewery or a winery', 'winery', 'd,s', 2, 3, 'i', 'glass', 'Book the tasting — and a driver.'],
  ['A science museum', 'science museum', 'c,f', 2, 2, 'i', 'bulb', 'Press every button.'],
  ['A planetarium', 'planetarium', 'c', 2, 3, 'i', 'star', 'Sit in the middle row.'],
  ['The end of a bus line', '', 'f,a', 1, 2, 'o', 'bus', 'Ride to the last stop and explore.'],
];
export const GO_MOODS = [['r', 'Relax'], ['f', 'Fun'], ['a', 'Active'], ['c', 'Culture'], ['d', 'Food & drink'], ['s', 'Friends']];

// ---------------------------------------------------------------- video games
// [Steam app id, name, modes (s solo · c co-op · v versus), typical session minutes, moods]
// moods: chill · action · story · brainy · creative · scary
export const VGAMES = [
  [413150, 'Stardew Valley', 's,c', 45, 'chill,creative'], [1145360, 'Hades', 's', 30, 'action'], [1145350, 'Hades II', 's', 30, 'action'],
  [504230, 'Celeste', 's', 30, 'action,brainy'], [367520, 'Hollow Knight', 's', 60, 'action,story'], [105600, 'Terraria', 's,c', 90, 'creative,action'],
  [620, 'Portal 2', 's,c', 45, 'brainy,story'], [220, 'Half-Life 2', 's', 60, 'action,story'], [730, 'Counter-Strike 2', 'v', 45, 'action'],
  [570, 'Dota 2', 'v', 45, 'action,brainy'], [440, 'Team Fortress 2', 'v', 30, 'action'], [252950, 'Rocket League', 's,v,c', 15, 'action'],
  [945360, 'Among Us', 'v', 20, 'brainy'], [1097150, 'Fall Guys', 'v', 15, 'action,chill'], [1086940, 'Baldur’s Gate 3', 's,c', 120, 'story,brainy'],
  [292030, 'The Witcher 3: Wild Hunt', 's', 120, 'story,action'], [1245620, 'Elden Ring', 's,c', 90, 'action'], [1091500, 'Cyberpunk 2077', 's', 120, 'story,action'],
  [1174180, 'Red Dead Redemption 2', 's', 120, 'story,chill'], [271590, 'Grand Theft Auto V', 's,v', 90, 'action'], [892970, 'Valheim', 's,c', 120, 'creative,action'],
  [548430, 'Deep Rock Galactic', 'c', 45, 'action'], [1426210, 'It Takes Two', 'c', 60, 'story,brainy'], [728880, 'Overcooked! 2', 'c', 30, 'chill,action'],
  [255710, 'Cities: Skylines', 's', 120, 'creative,chill'], [289070, 'Sid Meier’s Civilization VI', 's,v', 180, 'brainy'], [646570, 'Slay the Spire', 's', 45, 'brainy'],
  [1794680, 'Vampire Survivors', 's,c', 30, 'action,chill'], [588650, 'Dead Cells', 's', 30, 'action'], [632470, 'Disco Elysium', 's', 90, 'story,brainy'],
  [1966720, 'Lethal Company', 'c', 45, 'scary,action'], [553850, 'Helldivers 2', 'c', 45, 'action'], [427520, 'Factorio', 's,c', 180, 'brainy,creative'],
  [294100, 'RimWorld', 's', 120, 'brainy,story'], [264710, 'Subnautica', 's', 90, 'story,scary'], [275850, 'No Man’s Sky', 's,c', 90, 'chill,creative'],
  [227300, 'Euro Truck Simulator 2', 's', 60, 'chill'], [1172470, 'Apex Legends', 'v', 30, 'action'], [550, 'Left 4 Dead 2', 'c', 45, 'action,scary'],
  [1135690, 'Unpacking', 's', 30, 'chill,brainy'], [837470, 'Untitled Goose Game', 's,c', 30, 'chill'], [304430, 'INSIDE', 's', 60, 'story,scary'],
  [753640, 'Outer Wilds', 's', 60, 'story,brainy'], [582010, 'Monster Hunter: World', 's,c', 60, 'action'], [814380, 'Sekiro: Shadows Die Twice', 's', 60, 'action'],
  [489830, 'The Elder Scrolls V: Skyrim Special Edition', 's', 120, 'story,action'], [377160, 'Fallout 4', 's', 120, 'story,action'], [2379780, 'Balatro', 's', 30, 'brainy,chill'],
  [268910, 'Cuphead', 's,c', 30, 'action'], [1057090, 'Ori and the Will of the Wisps', 's', 60, 'story,action'], [1332010, 'Stray', 's', 60, 'story,chill'],
  [1003590, 'Tetris Effect: Connected', 's,c,v', 20, 'chill,brainy'], [431240, 'Golf With Your Friends', 'v', 30, 'chill'], [739630, 'Phasmophobia', 'c', 45, 'scary'],
  [1172620, 'Sea of Thieves', 'c', 90, 'action,chill'], [1551360, 'Forza Horizon 5', 's,v', 45, 'action,chill'], [990080, 'Hogwarts Legacy', 's', 90, 'story'],
  [526870, 'Satisfactory', 's,c', 120, 'creative,brainy'], [1868140, 'Dave the Diver', 's', 45, 'chill,story'], [1055540, 'A Short Hike', 's', 30, 'chill'],
  [322330, 'Don’t Starve Together', 'c', 60, 'brainy,scary'], [972660, 'Spiritfarer', 's,c', 60, 'chill,story'], [1290000, 'PowerWash Simulator', 's,c', 30, 'chill'],
  [291550, 'Brawlhalla', 'v', 15, 'action'], [976730, 'Halo: The Master Chief Collection', 's,c,v', 60, 'action,story'], [2358720, 'Black Myth: Wukong', 's', 90, 'action'],
];
export const VMOODS = [['chill', 'Chill'], ['action', 'Action'], ['story', 'Story'], ['brainy', 'Brainy'], ['creative', 'Creative'], ['scary', 'Scary']];

// ---------------------------------------------------------------- food
// cuisine: [id, name, Hebrew name, colour]
export const CUISINES = [
  ['israeli', 'Israeli', 'ישראלי', '#0ea5e9'], ['italian', 'Italian', 'איטלקי', '#22c55e'], ['japanese', 'Japanese', 'יפני', '#ef4444'],
  ['chinese', 'Chinese', 'סיני', '#dc2626'], ['indian', 'Indian', 'הודי', '#f59e0b'], ['mexican', 'Mexican', 'מקסיקני', '#16a34a'],
  ['thai', 'Thai', 'תאילנדי', '#a855f7'], ['american', 'American', 'אמריקאי', '#3b82f6'], ['french', 'French', 'צרפתי', '#6366f1'],
  ['greek', 'Greek', 'יווני', '#0284c7'], ['korean', 'Korean', 'קוריאני', '#e11d48'], ['vietnamese', 'Vietnamese', 'וייטנאמי', '#eab308'],
  ['spanish', 'Spanish', 'ספרדי', '#f97316'], ['turkish', 'Turkish', 'טורקי', '#b91c1c'], ['moroccan', 'Moroccan', 'מרוקאי', '#d97706'],
];
// 'dish|cuisine|ways|tags|Hebrew name'  ways: c cook · o order in · g go out · tags: q quick · h healthy · f comfort · v vegetarian
export const DISHES = `Shakshuka|israeli|c,g|q,h,v|שקשוקה
Falafel in pita|israeli|o,g|v|פלאפל בפיתה
Hummus with warm pita|israeli|c,g|v,h|חומוס
Sabich|israeli|c,g|v|סביח
Shawarma in laffa|israeli|o,g|f|שווארמה בלאפה
Schnitzel and mashed potatoes|israeli|c|f|שניצל ופירה
Jerusalem mixed grill|israeli|g|f|מעורב ירושלמי
Israeli salad|israeli|c|q,h,v|סלט ישראלי
Majadra with yoghurt|israeli|c|v,h,f|מג׳דרה
Burekas|israeli|o,g|v,f,q|בורקס
Jachnun|israeli|c,g|v,f|ג׳חנון
Malawach|israeli|c|v,f,q|מלאווח
Kubbeh soup|israeli|c,g|f|מרק קובה
Ptitim with chicken|israeli|c|q,f|פתיתים עם עוף
Chicken soup|israeli|c|f,h|מרק עוף
Stuffed peppers|israeli|c|f|פלפלים ממולאים
Kebab on the grill|israeli|c,g|f|קבב
Hamin|israeli|c|f|חמין
Chraime fish|israeli|c|h|חריימה
Israeli tost|israeli|c,g|q,v|טוסט
Labneh and za’atar pita|israeli|c|q,v,h|לאבנה וזעתר
Arayes|israeli|c,g|f|עראייס
Sambusak|israeli|g|v,f|סמבוסק
Margherita pizza|italian|c,o,g|f,v|פיצה מרגריטה
Spaghetti carbonara|italian|c,g|q,f|ספגטי קרבונרה
Lasagne|italian|c,o|f|לזניה
Mushroom risotto|italian|c,g|v,f|ריזוטו פטריות
Pesto pasta|italian|c|q,v|פסטה פסטו
Caprese salad|italian|c|q,h,v|סלט קפרזה
Minestrone|italian|c|h,v|מינסטרונה
Gnocchi in tomato sauce|italian|c,g|v,f|ניוקי ברוטב עגבניות
Penne arrabbiata|italian|c|q,v|פנה ארביאטה
Sushi|japanese|o,g|h|סושי
Ramen|japanese|o,g|f|ראמן
Teriyaki chicken and rice|japanese|c|q|עוף טריאקי
Okonomiyaki|japanese|c,g|f|אוקונומיאקי
Gyoza|japanese|c,o|f|גיוזה
Katsu curry|japanese|c,o|f|קארי קאטסו
Udon noodle soup|japanese|c,g|f|מרק אודון
Kung pao chicken|chinese|c,o|q|עוף קונג פאו
Dumplings|chinese|o,g|f|כופתאות
Sweet and sour chicken|chinese|o|f|עוף חמוץ מתוק
Egg fried rice|chinese|c|q,f,v|אורז מטוגן
Chow mein|chinese|c,o|q|צ׳או מיין
Peking duck|chinese|g|f|ברווז פקיני
Hot pot|chinese|g|f,h|הוט פוט
Butter chicken|indian|c,o|f|באטר צ׳יקן
Chana masala|indian|c|v,h|צ׳נה מסאלה
Palak paneer|indian|c,o|v|פלאק פניר
Biryani|indian|o,g|f|ביריאני
Dal and rice|indian|c|v,h,f|דאל ואורז
Masala dosa|indian|g|v|מסאלה דוסה
Chicken tikka masala|indian|o|f|טיקה מסאלה
Samosas|indian|o|v,f|סמוסות
Tacos|mexican|c,o,g|q|טאקו
Burrito bowl|mexican|c,o|h|קערת בוריטו
Cheese quesadillas|mexican|c|q,v,f|קסדיה
Enchiladas|mexican|c|f|אנצ׳ילדות
Loaded nachos|mexican|c,o|f,v|נאצ׳וס
Guacamole and chips|mexican|c|q,v|גוואקמולי
Chilli con carne|mexican|c|f|צ׳ילי קון קרנה
Fajitas|mexican|c,g|q|פחיטס
Pad thai|thai|c,o,g|q|פאד תאי
Green curry|thai|c,o|f|קארי ירוק
Tom yum soup|thai|c,o|h|מרק טום יאם
Massaman curry|thai|o|f|קארי מסמן
Papaya salad|thai|g|h,v|סלט פפאיה
Pad kra pao|thai|c|q|פאד קרפאו
Burger and fries|american|c,o,g|f|המבורגר וצ׳יפס
BBQ ribs|american|g|f|צלעות ברביקיו
Mac and cheese|american|c|f,v,q|מק אנד צ׳יז
Buffalo wings|american|o,g|f|כנפיים
Pancakes|american|c|f,v,q|פנקייק
Hot dogs|american|c|q,f|נקניקיות
Caesar salad|american|c,g|q,h|סלט קיסר
Poke bowl|american|o,g|h|פוקה
Grilled cheese and tomato soup|american|c|q,f,v|גבינה צלויה ומרק עגבניות
Fried chicken|american|o|f|עוף מטוגן
Croque monsieur|french|c,g|q,f|קרוק מסייה
Quiche|french|c|f,v|קיש
Ratatouille|french|c|v,h|רטטוי
Steak frites|french|g|f|סטייק וצ׳יפס
French onion soup|french|c,g|f|מרק בצל
Crêpes|french|c,g|q,v,f|קרפים
Salade niçoise|french|c|h|סלט ניסואז
Gyros|greek|o,g|f|גירוס
Greek salad|greek|c|q,h,v|סלט יווני
Moussaka|greek|c,g|f|מוסקה
Spanakopita|greek|c|v|ספנקופיטה
Souvlaki|greek|c,g|h|סובלקי
Bibimbap|korean|c,g|h,v|ביבימבאפ
Korean fried chicken|korean|o,g|f|עוף קוריאני מטוגן
Kimchi fried rice|korean|c|q,f|אורז מטוגן עם קימצ׳י
Korean barbecue|korean|g|f|ברביקיו קוריאני
Japchae|korean|c|v|ג׳אפצ׳ה
Pho|vietnamese|o,g|h,f|פו
Bánh mì|vietnamese|o,g|q|באן מי
Fresh spring rolls|vietnamese|c|h,v,q|ספרינג רולס טריים
Bún chả|vietnamese|g|h|בון צ׳ה
Paella|spanish|c,g|f|פאייה
A tapas evening|spanish|g|f|ערב טאפאס
Tortilla española|spanish|c|v,f|טורטייה ספרדית
Gazpacho|spanish|c|h,v,q|גספצ׳ו
Lahmacun|turkish|o,g|q|לחמג׳ון
Döner kebab|turkish|o,g|f|דונר קבב
Menemen|turkish|c|q,v|מנמן
Pide|turkish|g|f|פידה
Chicken tagine|moroccan|c,g|h|טאג׳ין עוף
Vegetable couscous|moroccan|c|v,h|קוסקוס ירקות
Harira soup|moroccan|c|h,f|מרק חרירה`;
export const EAT_WAYS = [['c', 'Cook'], ['o', 'Order in'], ['g', 'Go out']];
export const EAT_TAGS = [['q', 'Quick'], ['h', 'Healthy'], ['f', 'Comfort'], ['v', 'Vegetarian']];
