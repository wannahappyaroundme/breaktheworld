/**
 * Optional drop-in image assets. Put transparent PNGs in `public/assets/`
 * (e.g. earth.png, cinnamoroll.png) and they auto-replace the procedural art.
 * Missing files silently fall back to the hand-drawn doodle versions.
 */
export type AssetName =
  | 'earth'
  | 'city'
  | 'word'
  | 'cinnamoroll'
  | 'thanos'
  | 'ironman'
  | 'hulk'
  | 'godzilla'
  | 'dragonball'
  | 'cat'
  | 'ditto'
  | 'pooh'

const FILES: Record<AssetName, string> = {
  earth: 'earth.png',
  city: 'city.png',
  word: 'word.png',
  cinnamoroll: 'cinnamoroll.png',
  thanos: 'thanos.png',
  ironman: 'ironman.png',
  hulk: 'hulk.png',
  godzilla: 'godzilla.png',
  dragonball: 'dragonball.png',
  cat: 'cat.png',
  ditto: 'ditto.png',
  pooh: 'pooh.png',
}

const images = new Map<AssetName, HTMLImageElement>()

export function getImage(name: AssetName): HTMLImageElement | null {
  return images.get(name) ?? null
}

/** Try to load every known asset; resolves once all attempts settle. */
export function preloadAssets(base: string): Promise<void> {
  const names = Object.keys(FILES) as AssetName[]
  return Promise.all(
    names.map(
      (n) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            if (img.naturalWidth > 0) images.set(n, img)
            resolve()
          }
          img.onerror = () => resolve()
          img.src = `${base}assets/${FILES[n]}`
        })
    )
  ).then(() => undefined)
}

/** Draw an image scaled to fit inside (w,h), centered, preserving aspect. */
export function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
): void {
  const ar = img.naturalWidth / img.naturalHeight
  let dw = w
  let dh = w / ar
  if (dh > h) {
    dh = h
    dw = h * ar
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** Draw an image centered on (cx,cy) with height≈s, preserving aspect. */
export function drawImageCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  s: number
): void {
  const ar = img.naturalWidth / img.naturalHeight
  const dh = s
  const dw = s * ar
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
}
