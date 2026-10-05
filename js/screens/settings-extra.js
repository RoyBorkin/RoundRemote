// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Modules that register their own settings pages (see settings-registry.js). One import per line; settings.js imports this file.
import './users.js';   // Plex users · Jellyfin users · Spotify accounts (who's watching / listening)
import './settings-startup.js';   // Startup animation (logo splash) · Mouse pointer
import './setup-remote.js';   // Set up from phone or computer (pair a phone: QR + code; js/core/remote-setup.js)
import './settings-diagnostics.js';   // Profiles & about → Diagnostics (bridge report /api/diag + QR to /diag)
import './settings-server.js';   // Connection → Server: this Pi's own bridge or a Round Remote server (companion mode, js/core/companion.js)
