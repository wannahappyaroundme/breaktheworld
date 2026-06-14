/**
 * Hand-drawn doodle icons for the elemental weapons (the weapon bar).
 * Kawaii flat style: thick dark outline + flat colors, to match the art.
 * Character weapons use their PNG sprite instead (see bar.ts).
 */
const INK = '#211d2b'
const wrap = (inner: string): string =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`

export const weaponIconSVG: Record<string, string> = {
  hammer: wrap(`
    <rect x="13" y="8" width="22" height="11" rx="3" fill="#aeb9cc" stroke-width="3"/>
    <rect x="21" y="17" width="6" height="24" rx="3" fill="#b07b4f" stroke-width="3"/>`),

  fist: wrap(`
    <rect x="11" y="15" width="26" height="21" rx="9" fill="#ffd1a8" stroke-width="3"/>
    <line x1="18" y1="16" x2="18" y2="25" stroke-width="2"/>
    <line x1="24" y1="16" x2="24" y2="25" stroke-width="2"/>
    <line x1="30" y1="16" x2="30" y2="25" stroke-width="2"/>
    <path d="M11 22 q-4 2 -1 7" fill="#ffd1a8" stroke-width="3"/>`),

  glass: wrap(`
    <polygon points="24,5 37,19 31,41 14,35 11,17" fill="#bfe6ff" stroke-width="3"/>
    <polyline points="24,5 22,22 31,27" fill="none" stroke-width="2"/>
    <polyline points="22,22 15,33" fill="none" stroke-width="2"/>`),

  laser: wrap(`
    <line x1="9" y1="39" x2="39" y2="9" stroke="#ff4d6d" stroke-width="9"/>
    <line x1="9" y1="39" x2="39" y2="9" stroke="#fff" stroke-width="3"/>
    <g stroke="#ffd23f" stroke-width="2.5"><line x1="40" y1="4" x2="40" y2="12"/><line x1="36" y1="8" x2="44" y2="8"/></g>`),

  meteor: wrap(`
    <line x1="6" y1="6" x2="19" y2="19" stroke="#ffd23f" stroke-width="3"/>
    <line x1="13" y1="5" x2="24" y2="16" stroke="#ff7a2f" stroke-width="3"/>
    <line x1="5" y1="13" x2="16" y2="24" stroke="#ff7a2f" stroke-width="3"/>
    <circle cx="31" cy="31" r="11" fill="#8f6038" stroke-width="3"/>
    <circle cx="28" cy="29" r="2.5" fill="#5c3d22" stroke="none"/>
    <circle cx="35" cy="33" r="2" fill="#5c3d22" stroke="none"/>`),

  missile: wrap(`
    <path d="M24 5 C31 12 31 28 27 33 L21 33 C17 28 17 12 24 5 Z" fill="#eef2f7" stroke-width="3"/>
    <circle cx="24" cy="16" r="3" fill="#4aa6e0" stroke-width="2"/>
    <path d="M21 31 L15 39 L21 35 Z" fill="#cdd6e3" stroke-width="2"/>
    <path d="M27 31 L33 39 L27 35 Z" fill="#cdd6e3" stroke-width="2"/>
    <path d="M21 34 q3 7 6 0" fill="#ff7a2f" stroke-width="2"/>`),

  bomb: wrap(`
    <circle cx="22" cy="29" r="13" fill="#3a3f4a" stroke-width="3"/>
    <rect x="19" y="11" width="7" height="6" rx="1.5" fill="#5a5f6a" stroke-width="2"/>
    <path d="M24 11 q7 -7 12 -2" fill="none" stroke-width="2.5"/>
    <circle cx="37" cy="8" r="3" fill="#ffd23f" stroke="none"/>
    <circle cx="17" cy="25" r="3" fill="#fff" stroke="none" opacity="0.5"/>`),

  lightning: wrap(`
    <polygon points="27,5 13,27 22,27 17,43 35,19 25,19" fill="#ffd23f" stroke-width="3"/>`),

  flame: wrap(`
    <path d="M24 5 C34 17 34 26 28 32 C32 30 33 26 32 23 C34 33 26 43 18 38 C10 33 13 25 19 22 C16 26 18 30 21 30 C15 21 22 13 24 5 Z" fill="#ff7a2f" stroke-width="2.5"/>
    <path d="M24 19 C28 25 27 31 24 34 C21 31 20 26 24 19 Z" fill="#ffd23f" stroke="none"/>`),

  tornado: wrap(`
    <g fill="#9fb4c9" stroke-width="2.5">
      <ellipse cx="24" cy="10" rx="15" ry="4.5"/>
      <ellipse cx="23" cy="19" rx="11.5" ry="3.6"/>
      <ellipse cx="25" cy="27" rx="8" ry="3"/>
      <ellipse cx="23" cy="34" rx="5" ry="2.4"/>
      <ellipse cx="24" cy="40" rx="2.6" ry="1.8"/>
    </g>`),

  freeze: wrap(`
    <g stroke="#5ab6f0" stroke-width="3">
      <line x1="24" y1="5" x2="24" y2="43"/>
      <line x1="8" y1="14" x2="40" y2="34"/>
      <line x1="40" y1="14" x2="8" y2="34"/>
      <g stroke-width="2.5">
        <path d="M24 10 l-4 -4 M24 10 l4 -4 M24 38 l-4 4 M24 38 l4 4"/>
      </g>
    </g>`),

  blackhole: wrap(`
    <circle cx="24" cy="24" r="13" fill="#191225" stroke-width="3"/>
    <circle cx="24" cy="24" r="5.5" fill="#000" stroke="none"/>
    <path d="M24 9 A15 15 0 0 1 39 24" fill="none" stroke="#b06bff" stroke-width="3"/>
    <path d="M24 39 A15 15 0 0 1 9 24" fill="none" stroke="#7fd0ff" stroke-width="3"/>`),
}
