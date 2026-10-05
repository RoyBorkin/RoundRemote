// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Module worker around analyzePCM (see analyzeInWorker in rhythm/analyzer.js).
// Protocol: worker → { type: 'ready' } once loaded; main → { type: 'analyze', samples, sampleRate, key, source };
// worker → { type: 'progress', p } … then { type: 'done', analysis } or { type: 'error', message }.
import { analyzePCM } from './analyzer.js';

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type !== 'analyze') return;
  try {
    let last = -1;
    const analysis = analyzePCM(m.samples, m.sampleRate, {
      key: m.key, source: m.source,
      onProgress: (p) => { if (p - last >= 0.02 || p >= 1) { last = p; self.postMessage({ type: 'progress', p }); } },
    });
    self.postMessage({ type: 'done', analysis });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
self.postMessage({ type: 'ready' });
