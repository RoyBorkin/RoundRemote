// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Roon adapter — uses Roon's official extension API.
// Install once:  npm run roon   (pulls RoonLabs' node-roon-api packages from GitHub)
// Then enable "Round Remote" in Roon → Settings → Extensions.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';
import { dataPath } from '../lib/paths.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = dataPath('roon-state.json');

export function create({ hub, setStatus }) {
  let RoonApi, RoonApiTransport, RoonApiStatus, RoonApiImage, RoonApiBrowse;
  try {
    RoonApi = require('node-roon-api');
    RoonApiTransport = require('node-roon-api-transport');
    RoonApiStatus = require('node-roon-api-status');
    RoonApiImage = require('node-roon-api-image');
    RoonApiBrowse = require('node-roon-api-browse');
  } catch {
    throw Object.assign(new Error('Roon API packages not installed — run: npm run roon'), { code: 'ERR_MODULE_NOT_FOUND' });
  }

  let core = null, transport = null, image = null, browse = null;
  const raw = new Map(); // zone_id -> roon zone

  const toNorm = (z) => {
    const np = z.now_playing;
    const vol = z.outputs?.[0]?.volume;
    let volume = null;
    if (vol && vol.type !== 'incremental' && vol.max > vol.min) volume = Math.round(((vol.value - vol.min) / (vol.max - vol.min)) * 100);
    const t3 = np?.three_line || {};
    return {
      name: z.display_name,
      state: {
        track: np ? {
          id: `${t3.line1 || np.one_line?.line1}|${np.length || 0}`,
          title: t3.line1 || np.one_line?.line1 || '', artist: t3.line2 || '', album: t3.line3 || '',
          durationMs: (np.length || 0) * 1000, art: np.image_key ? `/api/image/roon/${np.image_key}` : '',
        } : null,
        isPlaying: z.state === 'playing' || z.state === 'loading',
        progressMs: (np?.seek_position || 0) * 1000,
        volume, muted: !!vol?.is_muted,
        shuffle: z.settings?.shuffle ?? null,
        repeat: { disabled: 'off', loop: 'all', loop_one: 'one' }[z.settings?.loop] ?? null,
      },
      caps: {
        seek: !!z.is_seek_allowed, next: !!z.is_next_allowed, prev: !!z.is_previous_allowed,
        volume: volume !== null, playlists: true, search: true, shuffle: true, repeat: true,
      },
    };
  };
  const push = (z) => { raw.set(z.zone_id, z); hub.upsert('roon', z.zone_id, toNorm(z)); };

  const roon = new RoonApi({
    extension_id: 'com.roundremote.bridge',
    display_name: 'Round Remote',
    display_version: '2.0.0',
    publisher: 'Round Remote',
    email: 'roundremote@example.invalid',
    website: 'https://github.com/RoyBorkin',
    log_level: 'none',
    core_paired(c) {
      core = c;
      transport = c.services.RoonApiTransport;
      image = c.services.RoonApiImage;
      browse = c.services.RoonApiBrowse;
      setStatus(`paired with ${c.display_name}`);
      log('roon', `paired with ${c.display_name}`);
      transport.subscribe_zones((cmd, data) => {
        if (cmd === 'Subscribed') { (data.zones || []).forEach(push); return; }
        if (cmd !== 'Changed') return;
        (data.zones_added || []).forEach(push);
        (data.zones_changed || []).forEach(push);
        (data.zones_removed || []).forEach((id) => { raw.delete(id); hub.remove('roon', id); });
        for (const s of data.zones_seek_changed || []) {
          const z = hub.get(`roon:${s.zone_id}`);
          if (!z) continue;
          const expected = z.state.progressMs + (z.state.isPlaying ? Date.now() - z.sampledAt : 0);
          const actual = (s.seek_position || 0) * 1000;
          if (Math.abs(expected - actual) > 1500) hub.upsert('roon', s.zone_id, { state: { progressMs: actual } });
        }
      });
    },
    core_unpaired() {
      core = transport = image = browse = null;
      hub.removeAdapterZones('roon');
      setStatus('waiting for Roon Core — enable “Round Remote” in Settings → Extensions');
    },
  });
  // Keep Roon's pairing state out of our config.json.
  roon.load_config = (k) => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))[k]; } catch { return undefined; } };
  roon.save_config = (k, v) => {
    let all = {}; try { all = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    if (v === undefined) delete all[k]; else all[k] = v;
    fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
  };

  const svcStatus = new RoonApiStatus(roon);
  roon.init_services({ required_services: [RoonApiTransport, RoonApiImage, RoonApiBrowse], provided_services: [svcStatus] });

  // ---------- helpers ----------
  const need = () => { if (!transport) throw new Error('Roon Core not paired'); };
  const cb2p = (fn) => new Promise((resolve, reject) => fn((err, ...r) => (err ? reject(new Error(String(err))) : resolve(r.length > 1 ? r : r[0]))));
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  const b = (opts) => cb2p((cb) => browse.browse(opts, cb));
  const l = (opts) => cb2p((cb) => browse.load(opts, cb));

  async function drillToPlay(hierarchy, zone, itemKey) {
    let res = await b({ hierarchy, item_key: itemKey, zone_or_output_id: zone });
    for (let depth = 0; depth < 5; depth++) {
      if (res.action !== 'list') return;
      const list = await l({ hierarchy, offset: 0, count: 100 });
      const items = list.items || [];
      const item = items.find((i) => i.hint === 'action' && /^play now$/i.test(i.title))
        || items.find((i) => i.hint === 'action' && /play/i.test(i.title))
        || items.find((i) => i.hint === 'action_list')
        || items.find((i) => i.hint === 'action');
      if (!item) throw new Error('Nothing playable here');
      res = await b({ hierarchy, item_key: item.item_key, zone_or_output_id: zone });
    }
  }
  const art = (key) => (key ? `/api/image/roon/${key}` : '');

  return {
    id: 'roon',
    async start() {
      setStatus('waiting for Roon Core — enable “Round Remote” in Settings → Extensions');
      svcStatus.set_status('Ready', false);
      roon.start_discovery();
    },
    stop() {},
    async command(zoneId, cmd, value) {
      need();
      const z = raw.get(zoneId);
      if (!z) throw new Error('unknown zone');
      const ctl = (c) => cb2p((cb) => transport.control(z, c, (err) => cb(err)));
      if (cmd === 'play') return ctl('play');
      if (cmd === 'pause') return ctl('pause');
      if (cmd === 'next') return ctl('next');
      if (cmd === 'prev') return ctl('previous');
      if (cmd === 'seek') return cb2p((cb) => transport.seek(z, 'absolute', Math.round(value / 1000), (err) => cb(err)));
      if (cmd === 'shuffle') return cb2p((cb) => transport.change_settings(z, { shuffle: !!value }, (err) => cb(err)));
      if (cmd === 'repeat') return cb2p((cb) => transport.change_settings(z, { loop: { off: 'disabled', all: 'loop', one: 'loop_one' }[value] || 'disabled' }, (err) => cb(err)));
      if (cmd === 'volume') {
        await Promise.all((z.outputs || []).filter((o) => o.volume && o.volume.type !== 'incremental').map((o) => {
          const v = o.volume;
          const target = v.min + ((v.max - v.min) * value) / 100;
          const step = v.step || 1;
          return cb2p((cb) => transport.change_volume(o, 'absolute', Math.round(target / step) * step, (err) => cb(err)));
        }));
      }
    },
    playlists(zoneId) {
      return serial(async () => {
        need();
        await b({ hierarchy: 'playlists', pop_all: true, zone_or_output_id: zoneId });
        const r = await l({ hierarchy: 'playlists', offset: 0, count: 300 });
        return (r.items || []).filter((i) => i.item_key).map((i, idx) => ({
          kind: 'playlist', id: JSON.stringify({ h: 'playlists', title: i.title, idx }),
          name: i.title, title: i.title, subtitle: i.subtitle || '', art: art(i.image_key),
        }));
      });
    },
    search(zoneId, q) {
      return serial(async () => {
        need();
        if (!q.trim()) return [];
        const out = [];
        await b({ hierarchy: 'search', input: q, pop_all: true, zone_or_output_id: zoneId });
        const top = await l({ hierarchy: 'search', offset: 0, count: 20 });
        const cats = (top.items || []).filter((i) => /^(tracks|albums|playlists)$/i.test(i.title));
        for (const cat of cats) {
          await b({ hierarchy: 'search', item_key: cat.item_key, zone_or_output_id: zoneId });
          const r = await l({ hierarchy: 'search', offset: 0, count: cat.title.match(/tracks/i) ? 10 : 4 });
          (r.items || []).forEach((i, idx) => out.push({
            kind: /tracks/i.test(cat.title) ? 'track' : /albums/i.test(cat.title) ? 'album' : 'playlist',
            id: JSON.stringify({ h: 'search', q, cat: cat.title, title: i.title, idx }),
            title: i.title, subtitle: i.subtitle || cat.title, art: art(i.image_key),
          }));
          await b({ hierarchy: 'search', pop_levels: 1, zone_or_output_id: zoneId });
        }
        return out;
      });
    },
    play(zoneId, item) {
      // Item keys are only valid for the current browse session, so replay the path.
      return serial(async () => {
        need();
        const path = JSON.parse(item.id);
        let list;
        if (path.h === 'playlists') {
          await b({ hierarchy: 'playlists', pop_all: true, zone_or_output_id: zoneId });
          list = await l({ hierarchy: 'playlists', offset: 0, count: 300 });
        } else {
          await b({ hierarchy: 'search', input: path.q, pop_all: true, zone_or_output_id: zoneId });
          const top = await l({ hierarchy: 'search', offset: 0, count: 20 });
          const cat = (top.items || []).find((i) => i.title === path.cat);
          if (!cat) throw new Error('Result no longer available');
          await b({ hierarchy: 'search', item_key: cat.item_key, zone_or_output_id: zoneId });
          list = await l({ hierarchy: 'search', offset: 0, count: 50 });
        }
        const items = list.items || [];
        const it = items[path.idx]?.title === path.title ? items[path.idx] : items.find((i) => i.title === path.title);
        if (!it) throw new Error('Item not found');
        await drillToPlay(path.h, zoneId, it.item_key);
      });
    },
    async image(key) {
      if (!image) return null;
      const [contentType, body] = await cb2p((cb) => image.get_image(key, { scale: 'fit', width: 600, height: 600, format: 'image/jpeg' }, cb));
      return { contentType, body };
    },
  };
}
