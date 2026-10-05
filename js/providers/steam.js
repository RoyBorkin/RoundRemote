// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Steam (Home → Steam): profile and status, the game being played now, recently played games, the current
// game's achievements and friends online — from the Steam Web API through the bridge (bridge/adapters/steam.js
// keeps the API key). Launching a game / Big Picture opens Steam on the computer running the bridge.
import { BridgeConsoleService } from './playstation.js';

export class SteamService extends BridgeConsoleService {
  constructor(meta) { super(meta, 'steam'); }
  launch(appid) { return this.api('launch', { method: 'POST', json: { appid } }); }
  bigPicture() { return this.api('bigpicture', { method: 'POST', json: {} }); }
}
