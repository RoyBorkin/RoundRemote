// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Google Home — sends text commands to Google Assistant ("turn off the kitchen lights", "good night",
// "broadcast dinner is ready") with the Google Assistant Service (the same API Home Assistant's
// "Google Assistant SDK" integration uses), so it controls everything in your Google Home. Answers
// come back as text (and, optionally, speech to play on the round screen).
//
// No extra packages: gRPC is spoken directly over Node's http2, with a tiny protobuf encoder/decoder.
//
// Setup (once): a Google Cloud project with the "Google Assistant API" enabled and an OAuth client of
// type "Desktop app" → Client ID + secret (saved from the app, or googlehome.clientId/clientSecret in
// config.json) → open http://localhost:8765/api/adapters/googlehome/signin on the bridge computer.
// Or drop a credentials.json from google-oauthlib-tool into bridge/ as googlehome.json.
//
// Actions: GET status · POST setup {clientId,clientSecret} · GET signin · GET callback · POST signout · POST ask {text,speak,language}
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, '..', 'googlehome.json');
const SCOPE = 'https://www.googleapis.com/auth/assistant-sdk-prototype';

// ---------------------------------------------------------------- tiny protobuf
const varint = (n) => { const out = []; n = BigInt(n); do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const key = (field, wire) => varint((field << 3) | wire);
const pbBytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);
const pbStr = (field, s) => pbBytes(field, Buffer.from(String(s), 'utf8'));
const pbInt = (field, n) => Buffer.concat([key(field, 0), varint(n)]);
/** Decode one message into { field: [values] } (varints as numbers, length-delimited as Buffers). */
export function pbDecode(buf) {
  const out = {};
  let i = 0;
  const rv = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const k = Number(rv()), f = k >> 3, w = k & 7;
    let v;
    if (w === 0) v = Number(rv());
    else if (w === 2) { const n = Number(rv()); v = buf.subarray(i, i + n); i += n; }
    else if (w === 5) { v = buf.readUInt32LE(i); i += 4; }
    else if (w === 1) { v = buf.readBigUInt64LE(i); i += 8; }
    else break;
    (out[f] ||= []).push(v);
  }
  return out;
}
/** AssistRequest { config: AssistConfig { text_query, audio_out_config, dialog_state_in, device_config, screen_out_config } } */
export function encodeAssist({ text, language = 'en-US', deviceId, deviceModelId, conversationState, speak }) {
  const audioOut = Buffer.concat([pbInt(1, speak ? 2 : 1), pbInt(2, 16000), pbInt(3, speak ? 100 : 0)]); // MP3 when speaking, else LINEAR16 at 0 %
  const dialog = Buffer.concat([conversationState ? pbBytes(1, conversationState) : Buffer.alloc(0), pbStr(2, language), pbInt(7, conversationState ? 0 : 1)]);
  const device = Buffer.concat([pbStr(1, deviceId), pbStr(3, deviceModelId)]);
  const screen = pbInt(1, 3); // PLAYING → an HTML answer card
  const config = Buffer.concat([pbBytes(2, audioOut), pbBytes(3, dialog), pbBytes(4, device), pbStr(6, text), pbBytes(8, screen)]);
  return pbBytes(1, config);
}
const grpcFrame = (msg) => { const h = Buffer.alloc(5); h.writeUInt32BE(msg.length, 1); return Buffer.concat([h, msg]); };
function grpcMessages(buf) {
  const out = [];
  let i = 0;
  while (i + 5 <= buf.length) { const n = buf.readUInt32BE(i + 1); if (i + 5 + n > buf.length) break; out.push(buf.subarray(i + 5, i + 5 + n)); i += 5 + n; }
  return out;
}
/** Text from the Assistant's HTML answer card. */
export function htmlText(html = '') {
  const m = html.match(/class="show_text_content"[^>]*>([\s\S]*?)<\/div>/i);
  const src = m ? m[1] : html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  return src.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function create({ cfg = {}, setStatus }) {
  const c = {
    endpoint: 'https://embeddedassistant.googleapis.com', tokenUrl: 'https://oauth2.googleapis.com/token', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    deviceModelId: 'round-remote', deviceId: 'round-remote-1', language: '', ...(cfg.googlehome || {}),
  };
  const port = cfg.port || 8765;
  const load = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
  const save = (s) => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch (e) { log('googlehome', `could not save ${STATE}: ${e.message}`); } };
  let st = load();
  // accept a credentials.json from google-oauthlib-tool as-is
  const creds = () => ({
    clientId: st.clientId || st.client_id || c.clientId || '', clientSecret: st.clientSecret || st.client_secret || c.clientSecret || '',
    refreshToken: st.refreshToken || st.refresh_token || '',
  });
  let access = null, conv = null, convAt = 0, pendingState = null;
  const status = () => setStatus(creds().refreshToken ? `running · signed in${st.account ? ` as ${st.account}` : ''}` : creds().clientId ? 'running · sign in with Google' : 'running · needs a Google OAuth client');

  async function token() {
    if (access && access.exp > Date.now() + 60000) return access.token;
    const { clientId, clientSecret, refreshToken } = creds();
    if (!refreshToken) throw new Error('Not signed in to Google yet — open Google Home setup in the app');
    const r = await fetch(c.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error === 'invalid_grant' ? 'Google sign-in expired — sign in again' : `Google token error: ${j.error_description || j.error || r.status}`);
    access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return access.token;
  }

  function assist(accessToken, body) {
    return new Promise((resolve, reject) => {
      const client = http2.connect(c.endpoint);
      const chunks = [];
      let trailers = {}, headers = {};
      const done = (e, v) => { try { client.close(); } catch {} e ? reject(e) : resolve(v); };
      client.on('error', (e) => done(new Error(`Can't reach Google Assistant: ${e.message}`)));
      const req = client.request({ ':method': 'POST', ':path': '/google.assistant.embedded.v1alpha2.EmbeddedAssistant/Assist',
        'content-type': 'application/grpc', te: 'trailers', authorization: `Bearer ${accessToken}`, 'grpc-timeout': '25S' });
      req.setTimeout(30000, () => { req.close(); done(new Error('Google Assistant took too long')); });
      req.on('response', (h) => { headers = h; });
      req.on('trailers', (t) => { trailers = t; });
      req.on('data', (d) => chunks.push(d));
      req.on('error', (e) => done(e));
      req.on('end', () => {
        const code = Number(trailers['grpc-status'] ?? headers['grpc-status'] ?? 0);
        if (code) { const msg = decodeURIComponent(trailers['grpc-message'] || headers['grpc-message'] || `gRPC error ${code}`); return done(new Error(code === 16 ? 'Google refused the sign-in — sign in again' : code === 7 ? `Google said no: ${msg}` : msg)); }
        done(null, grpcMessages(Buffer.concat(chunks)));
      });
      req.end(grpcFrame(body));
    });
  }

  const html = (title, text) => ({ __html: `<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:18px system-ui;background:#0b0b0d;color:#eee;display:grid;place-items:center;height:90vh;text-align:center"><div><h2>${title}</h2><p>${text}</p></div>` });

  const actions = {
    async status() { const k = creds(); return { signedIn: !!k.refreshToken, hasClient: !!(k.clientId && k.clientSecret), clientId: k.clientId, account: st.account || '' }; },
    async setup({ clientId, clientSecret }) {
      if (!clientId || (!clientSecret && !creds().clientSecret)) throw new Error('Enter the Client ID and Client secret');
      st = { ...st, clientId: clientId.trim(), ...(clientSecret ? { clientSecret: clientSecret.trim() } : {}) };
      delete st.client_id; delete st.client_secret;
      save(st); status();
      return { ok: true };
    },
    async signin(_q, { req }) {
      const host = String(req.headers.host || '');
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
        return html('Open this on the bridge computer', `Google only returns to <b>localhost</b> for desktop sign-ins. On the computer running the bridge, open <a style="color:#8ab4f8" href="http://localhost:${port}/api/adapters/googlehome/signin">http://localhost:${port}/api/adapters/googlehome/signin</a>.`);
      }
      const { clientId } = creds();
      if (!clientId) return html('No Google client yet', 'Add the Client ID and secret in the app first (Home → Google Home → Set up).');
      pendingState = crypto.randomBytes(12).toString('hex');
      const redirect = `http://${host}/api/adapters/googlehome/callback`;
      return { __redirect: `${c.authUrl}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: `${SCOPE} openid email`, access_type: 'offline', prompt: 'consent', state: pendingState })}` };
    },
    async callback(q, { req }) {
      if (q.error) return html('Sign-in cancelled', String(q.error));
      if (!q.code || !pendingState || q.state !== pendingState) return html('Sign-in failed', 'Start again from the app.');
      pendingState = null;
      const { clientId, clientSecret } = creds();
      const r = await fetch(c.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: q.code, client_id: clientId, client_secret: clientSecret, redirect_uri: `http://${req.headers.host}/api/adapters/googlehome/callback`, grant_type: 'authorization_code' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.refresh_token) return html('Sign-in failed', j.error_description || j.error || 'Google didn’t return a refresh token.');
      let account = '';
      try { account = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()).email || ''; } catch {}
      st = { ...st, refreshToken: j.refresh_token, account };
      delete st.refresh_token;
      save(st); access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
      status(); log('googlehome', `signed in${account ? ` as ${account}` : ''}`);
      return html('Signed in ✓', `Google Home is ready${account ? ` for ${account}` : ''}. You can close this tab and go back to the round screen.`);
    },
    async signout() { st = { ...st }; delete st.refreshToken; delete st.refresh_token; delete st.account; access = null; save(st); status(); return { ok: true }; },
    async ask({ text, speak = false, language }) {
      if (!text || !String(text).trim()) throw new Error('Nothing to send');
      const tok = await token();
      if (Date.now() - convAt > 5 * 60000) conv = null;   // follow-up questions keep the conversation for a few minutes
      const msgs = await assist(tok, encodeAssist({ text: String(text).trim(), language: c.language || language || 'en-US', deviceId: c.deviceId, deviceModelId: c.deviceModelId, conversationState: conv, speak }));
      let reply = '', htmlOut = '';
      const audio = [];
      for (const m of msgs) {
        const r = pbDecode(m);
        for (const ao of r[3] || []) for (const d of pbDecode(ao)[1] || []) audio.push(d);
        for (const so of r[4] || []) { const s = pbDecode(so); if (s[2]?.[0]) htmlOut += s[2][0].toString('utf8'); }
        for (const ds of r[5] || []) {
          const d = pbDecode(ds);
          if (d[1]?.[0]?.length) reply = d[1][0].toString('utf8');
          if (d[2]?.[0]?.length) { conv = Buffer.from(d[2][0]); convAt = Date.now(); }
        }
      }
      const text2 = reply || htmlText(htmlOut);
      log('googlehome', `“${text}” → ${text2.slice(0, 80) || '(no text)'}`);
      return { text: text2, audio: speak && audio.length ? Buffer.concat(audio).toString('base64') : undefined };
    },
  };

  return {
    id: 'googlehome',
    actions,
    async start() { status(); },
    stop() {},
  };
}
