#!/usr/bin/env node
// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Create an Apple Music developer token (JWT, ES256) from your MusicKit private key.
//   node tools/apple-token.js <TEAM_ID> <KEY_ID> <path/to/AuthKey_KEYID.p8> [days=150]
// Paste the output into Round Remote → Settings → Apple developer token,
// or put teamId/keyId/privateKeyPath in bridge/config.json and the bridge signs it for you.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [teamId, keyId, keyPath, days = '150'] = process.argv.slice(2);
if (!teamId || !keyId || !keyPath) {
  console.error('usage: node tools/apple-token.js <TEAM_ID> <KEY_ID> <AuthKey.p8> [days<=180]');
  process.exit(1);
}
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64({ alg: 'ES256', kid: keyId })}.${b64({ iss: teamId, iat: now, exp: now + Math.min(180, +days) * 86400 })}`;
const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: fs.readFileSync(keyPath, 'utf8'), dsaEncoding: 'ieee-p1363' });
console.log(`${unsigned}.${sig.toString('base64url')}`);
