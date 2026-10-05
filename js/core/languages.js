// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Subtitle languages: name (in its own language + English), ISO 639-1 (Plex) and ISO 639-2 (Jellyfin).
export const SUB_LANGS = [
  { id: 'en', iso3: 'eng', name: 'English' }, { id: 'he', iso3: 'heb', name: 'עברית', en: 'Hebrew' },
  { id: 'es', iso3: 'spa', name: 'Español', en: 'Spanish' }, { id: 'fr', iso3: 'fre', name: 'Français', en: 'French' },
  { id: 'de', iso3: 'ger', name: 'Deutsch', en: 'German' }, { id: 'it', iso3: 'ita', name: 'Italiano', en: 'Italian' },
  { id: 'pt', iso3: 'por', name: 'Português', en: 'Portuguese' }, { id: 'ru', iso3: 'rus', name: 'Русский', en: 'Russian' },
  { id: 'ar', iso3: 'ara', name: 'العربية', en: 'Arabic' }, { id: 'nl', iso3: 'dut', name: 'Nederlands', en: 'Dutch' },
  { id: 'sv', iso3: 'swe', name: 'Svenska', en: 'Swedish' }, { id: 'da', iso3: 'dan', name: 'Dansk', en: 'Danish' },
  { id: 'no', iso3: 'nor', name: 'Norsk', en: 'Norwegian' }, { id: 'fi', iso3: 'fin', name: 'Suomi', en: 'Finnish' },
  { id: 'pl', iso3: 'pol', name: 'Polski', en: 'Polish' }, { id: 'tr', iso3: 'tur', name: 'Türkçe', en: 'Turkish' },
  { id: 'el', iso3: 'gre', name: 'Ελληνικά', en: 'Greek' }, { id: 'ro', iso3: 'rum', name: 'Română', en: 'Romanian' },
  { id: 'hu', iso3: 'hun', name: 'Magyar', en: 'Hungarian' }, { id: 'cs', iso3: 'cze', name: 'Čeština', en: 'Czech' },
  { id: 'uk', iso3: 'ukr', name: 'Українська', en: 'Ukrainian' }, { id: 'fa', iso3: 'per', name: 'فارسی', en: 'Persian' },
  { id: 'hi', iso3: 'hin', name: 'हिन्दी', en: 'Hindi' }, { id: 'ja', iso3: 'jpn', name: '日本語', en: 'Japanese' },
  { id: 'ko', iso3: 'kor', name: '한국어', en: 'Korean' }, { id: 'zh', iso3: 'chi', name: '中文', en: 'Chinese' },
  { id: 'th', iso3: 'tha', name: 'ไทย', en: 'Thai' }, { id: 'id', iso3: 'ind', name: 'Bahasa Indonesia', en: 'Indonesian' },
];
export const langById = (id) => SUB_LANGS.find((l) => l.id === id) || SUB_LANGS[0];
/** Preferred subtitle languages: the saved ones, else the browser's language + English. */
export function preferredSubLangs(saved) {
  if (saved?.length) return saved;
  const b = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return [...new Set([SUB_LANGS.some((l) => l.id === b) ? b : 'en', 'en'])];
}
