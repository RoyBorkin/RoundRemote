// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Most Likely To: shares the prompt page with Never Have I Ever (apps/drinks-never.js).
import { mountPrompt } from './drinks-never.js';

export function mount(el, ctx) { return mountPrompt(el, ctx, 'likely'); }
