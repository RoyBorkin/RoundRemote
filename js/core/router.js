// Minimal screen router: one full-screen view at a time, cross-faded.
const screens = new Map();
let root = null, current = null, currentName = null;

export function initRouter(el) { root = el; }
export function register(name, factory) { screens.set(name, factory); }
export function currentScreen() { return currentName; }

export function go(name, params = {}) {
  const factory = screens.get(name);
  if (!factory) throw new Error(`No screen ${name}`);
  const prev = current;
  const next = factory(params);
  next.el.classList.add('screen', 'entering');
  root.appendChild(next.el);
  current = next; currentName = name;
  requestAnimationFrame(() => requestAnimationFrame(() => next.el.classList.remove('entering')));
  if (prev) {
    prev.el.classList.add('leaving');
    prev.destroy?.();
    setTimeout(() => prev.el.remove(), 320);
  }
  return next;
}
