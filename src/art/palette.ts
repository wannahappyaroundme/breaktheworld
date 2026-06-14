/** Doodle / flash-game palette: black ink outlines + soft pastels. */
export const INK = '#211d2b'

export const C = {
  ink: INK,
  white: '#fffdf6',
  cream: '#fff4d6',
  // earth
  ocean: '#4aa6e0',
  ocean2: '#3b89c4',
  land: '#7cc95a',
  land2: '#5fab3c',
  dirt: '#b07b4f',
  dirt2: '#8f6038',
  // fx
  speed: '#ffd23f',
  fire: '#ff7a2f',
  fireHot: '#ffd23f',
  // characters
  purple: '#9b6cd6',
  purpleDark: '#6f48a8',
  ironRed: '#e23b3b',
  ironGold: '#ffd23f',
  hulkGreen: '#69c14a',
  hulkGreen2: '#4f9c33',
  godzilla: '#5a6a72',
  godzilla2: '#3f4c52',
  saiyan: '#ffcf2e',
  catGray: '#cfcad6',
  dittoPurple: '#c9a3e8',
  poohYellow: '#ffce4a',
  poohRed: '#e23b3b',
  honey: '#ffb43a',
  blush: '#ffb3c0',
  // city
  building: '#b9c4d6',
  building2: '#8fa0bd',
  windowOn: '#ffe48a',
} as const

export type ColorKey = keyof typeof C
