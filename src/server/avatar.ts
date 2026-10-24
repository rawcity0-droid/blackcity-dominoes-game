// Player avatars: a preset picture from public/faces, or a custom face built in the Play window.
// A custom face is a short code: "c" + one base-36 digit per part (see AVATAR_PARTS). public/avatar.js draws it.

/** Preset pictures any player may pick. Only graphics, never a photo of a person or a named computer player's face. */
export const PRESET_AVATARS = ['aces', 'boombox', 'cat', 'chopper', 'crown', 'graffiti', 'hoops', 'kicks', 'lion', 'lowrider', 'muscle', 'pitbull', 'wolf'] as const;

/** How many choices each part of a custom face has, in code order. Keep in step with PARTS in public/avatar.js. */
export const AVATAR_PARTS: [string, number][] = [
  ['skin', 12], ['shape', 3], ['hair', 16], ['hairColor', 9], ['brows', 4], ['eyes', 5], ['nose', 3],
  ['mouth', 6], ['facial', 6], ['glasses', 5], ['hat', 5], ['jewelry', 5], ['shirt', 10], ['bg', 10],
];
const CODE_LEN = 1 + AVATAR_PARTS.length;

/** The face id if it is a known preset or a well-formed custom code; anything else gives undefined. */
export function validAvatar(v: unknown): string | undefined {
  if (validPhoto(v)) return v as string;
  if (typeof v !== 'string' || v.length > CODE_LEN) return undefined;
  if ((PRESET_AVATARS as readonly string[]).includes(v)) return v;
  if (v.length !== CODE_LEN || v[0] !== 'c' || !/^c[0-9a-z]+$/.test(v)) return undefined;
  for (let i = 0; i < AVATAR_PARTS.length; i++) if (parseInt(v[i + 1], 36) >= AVATAR_PARTS[i][1]) return undefined;
  return v;
}

/** A custom face that is always the same for the same seed (a player id or a name). */
export function fallbackAvatar(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let code = 'c';
  for (const [, n] of AVATAR_PARTS) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    code += (h % n).toString(36);
  }
  return code;
}

/** Longest photo accepted, in characters of the data URL (about 30 KB of picture). */
export const MAX_PHOTO_CHARS = 40_000;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a player's own display picture: a small base64 JPEG, PNG or WebP data URL. */
export function validPhoto(v: unknown): boolean {
  return typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(v);
}
