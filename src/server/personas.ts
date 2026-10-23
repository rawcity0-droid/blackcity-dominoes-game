// Computer player personas: a real-sounding name and a face (a photo in public/faces, or a built avatar code).

import { fallbackAvatar } from './avatar.js';

export const NAMES = [
  'Ace', 'Duke', 'Queenie', 'Jax', 'Sage', 'Dottie', 'Blaze', 'Nova', 'Otis', 'Big Mike', 'Lil Tone', 'Peanut',
  'Smoke', 'Slim', 'Cash', 'Showtime', 'Bishop', 'Mookie', 'Boogie', 'Pooh', 'Scoop', 'Juice', 'Cookie', 'Shorty',
  'Tito', 'Rico', 'Deuce', 'Biscuit', 'Rell', 'Tay', 'Nene', 'Keke', 'Mama Jo', 'Auntie Em', 'Big Cuz', 'Zeke',
  'Flip', 'Lucky', 'Sweets', 'Hollis', 'Moe', 'Chilly', 'Pinky', 'Wavy', 'Big Sis', 'Lil Ray', 'CJ', 'June',
  'Rocco', 'Tre', 'OG Ray', 'Nikki B', 'Uncle Bones', 'Mister Six', 'Double Dee',
];

/** Players that come with a picture (public/faces/<face>.jpg), same people and pictures as the spades game. */
export const FACE_PLAYERS: { name: string; face: string }[] = [
  { name: 'Marcus', face: 'marcus' }, { name: 'Tasha', face: 'tasha' }, { name: 'Luis', face: 'luis' },
  { name: 'Keisha', face: 'keisha' }, { name: 'Big Jerome', face: 'jerome' }, { name: 'Mari', face: 'mari' },
  { name: 'Dre', face: 'dre' }, { name: 'Miss Pearl', face: 'pearl' }, { name: 'Cooper', face: 'cooper' }, { name: 'Kim', face: 'kim' },
  { name: 'Lowrider Lou', face: 'lowrider' }, { name: 'King Bones', face: 'crown' }, { name: 'Midnight Moe', face: 'muscle' },
  { name: 'Fresh Kicks', face: 'kicks' }, { name: 'Brick', face: 'pitbull' }, { name: 'Big Cat Leo', face: 'lion' },
  { name: 'Red Hood Rome', face: 'anime2' }, { name: 'Whiskers', face: 'cat' }, { name: 'Buckets', face: 'hoops' },
  { name: 'Spray Can Sam', face: 'graffiti' }, { name: 'Lone Wolf', face: 'wolf' }, { name: 'Granny Hands', face: 'granny' },
  { name: 'Boombox Benny', face: 'boombox' }, { name: 'Purple Rain', face: 'anime1' }, { name: 'Chopper Chuck', face: 'chopper' },
  { name: 'B Nasty', face: 'bnasty' }, { name: 'Raw 1', face: 'raw1' },
];

export interface Persona { name: string; face: string }

/** About 60% of computer players get a picture, the rest a built face that always matches their name. */
export function pickPersona(used: Set<string>, rng: () => number = Math.random): Persona {
  const faces = FACE_PLAYERS.filter((f) => !used.has(f.name));
  if (faces.length && rng() < 0.6) return faces[Math.floor(rng() * faces.length)];
  const free = NAMES.filter((n) => !used.has(n));
  const name = free.length ? free[Math.floor(rng() * free.length)] : `Player ${used.size + 1}`;
  return { name, face: fallbackAvatar(name) };
}
