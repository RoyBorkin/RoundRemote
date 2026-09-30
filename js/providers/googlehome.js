// Google Home: Google Assistant text commands (through the bridge, signed in to your Google account) —
// "turn off the kitchen lights", routines like "good night", broadcasts — plus your Google/Nest speakers
// and displays, which the bridge already sees as Cast devices. Google offers no web API that lists and
// controls every Google Home device directly, so commands go through the Assistant like on a speaker.
import { Emitter } from '../core/util.js';
import { store } from '../core/store.js';
import { bridgeFetch } from './bridge.js';

export class GoogleHomeService extends Emitter {
  constructor(meta) { super(); Object.assign(this, meta); }
  setupHint() { return ''; }
  isAuthed() { return true; }   // the screen itself walks through the Google sign-in when needed
  signOut() { return bridgeFetch('/api/adapters/googlehome/signout', { method: 'POST', json: {} }); }
  status() { return bridgeFetch('/api/adapters/googlehome/status'); }
  ask(text) {
    return bridgeFetch('/api/adapters/googlehome/ask', {
      method: 'POST', timeout: 30000,
      json: { text, speak: store.get('ghSpeak') !== false, language: store.get('ghLanguage') || navigator.language || 'en-US' },
    });
  }
}
