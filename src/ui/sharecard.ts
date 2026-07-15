import { getImage } from '../art/assets'

export interface ShareStats {
  best: number
  total: number
  url: string
  title: string | null
  stampFrame: boolean
}

export type ShareResult =
  | { ok: true; method: 'native' | 'download' }
  | { ok: false; method: 'none' }

export const SHARE_CARD_LAYOUT = {
  size: 1080,
  titleY: 80,
  mainTitleY: 220,
  challengeY: 980,
  urlY: 1040,
  frame: { x: 6, y: 6, size: 1068, lineWidth: 4 },
} as const

/** Draw the 1080² brag card to a canvas. */
export function renderCard(s: ShareStats): HTMLCanvasElement {
  const W = SHARE_CARD_LAYOUT.size
  const H = SHARE_CARD_LAYOUT.size
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!

  // background
  const g = ctx.createRadialGradient(W * 0.42, H * 0.34, 80, W * 0.5, H * 0.5, W * 0.85)
  g.addColorStop(0, '#202c5c')
  g.addColorStop(1, '#0d1326')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  for (const [x, y, r] of [
    [120, 150, 5],
    [900, 190, 6],
    [980, 820, 5],
    [160, 920, 4],
    [540, 110, 4],
    [860, 560, 4],
  ]) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // characters
  const earth = getImage('earth')
  const cinna = getImage('cinnamoroll')
  if (earth) ctx.drawImage(earth, 110, 360, 380, 380)
  if (cinna) {
    ctx.save()
    ctx.translate(610, 320)
    ctx.rotate(0.22)
    ctx.drawImage(cinna, -200, -200, 400, 400)
    ctx.restore()
  }

  // title
  ctx.textAlign = 'center'
  ctx.lineJoin = 'round'
  ctx.font = '900 132px "Apple SD Gothic Neo","Noto Sans KR",sans-serif'
  ctx.strokeStyle = '#211d2b'
  ctx.lineWidth = 22
  ctx.strokeText('세상 부수기', W / 2, SHARE_CARD_LAYOUT.mainTitleY)
  ctx.fillStyle = '#ffd23f'
  ctx.fillText('세상 부수기', W / 2, SHARE_CARD_LAYOUT.mainTitleY)

  if (s.title) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 44px "Apple SD Gothic Neo","Noto Sans KR",sans-serif'
    ctx.fillText(s.title, W / 2, SHARE_CARD_LAYOUT.titleY)
  }

  // stats
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 70px sans-serif'
  ctx.fillText(`🔥 최고 연속 ${s.best}`, W / 2, 850)
  ctx.fillStyle = '#cdd6e3'
  ctx.font = '700 46px sans-serif'
  ctx.fillText(`💥 지금까지 ${s.total}개 부숨`, W / 2, 922)
  ctx.fillStyle = '#ffd23f'
  ctx.font = '800 42px sans-serif'
  ctx.fillText('내 기록 깰 수 있어? 👀', W / 2, SHARE_CARD_LAYOUT.challengeY)
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 32px sans-serif'
  ctx.fillText(s.url.replace(/^https?:\/\//, ''), W / 2, SHARE_CARD_LAYOUT.urlY)
  if (s.stampFrame) {
    const frame = SHARE_CARD_LAYOUT.frame
    ctx.strokeStyle = '#ffd23f'
    ctx.lineWidth = frame.lineWidth
    ctx.strokeRect(frame.x, frame.y, frame.size, frame.size)
  }
  return c
}

/** Compose the brag card and share it (native share, else save + copy URL). */
export async function shareCard(
  s: ShareStats,
  onToast: (msg: string) => void
): Promise<ShareResult> {
  let blob: Blob | null = null
  try {
    const c = renderCard(s)
    blob = await new Promise<Blob | null>((resolve) => {
      c.toBlob((result) => resolve(result), 'image/png')
    })
  } catch {
    blob = null
  }
  if (!blob) {
    onToast('잠시 뒤 공유 버튼을 다시 눌러보세요.')
    return { ok: false, method: 'none' }
  }
  let file: File
  try {
    file = new File([blob], 'breaktheworld.png', { type: 'image/png' })
  } catch {
    onToast('잠시 뒤 공유 버튼을 다시 눌러보세요.')
    return { ok: false, method: 'none' }
  }
  const text = `내 최고 연속 ${s.best}! 깰 수 있어? ${s.url}`

  const navAny = navigator as unknown as {
    canShare?: (d: { files: File[] }) => boolean
    share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>
  }
  if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
    try {
      await navAny.share({ files: [file], title: '세상 부수기', text })
      return { ok: true, method: 'native' }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, method: 'none' }
      }
      // A platform share error may still use the image-save fallback below.
    }
  }
  // fallback: download image + copy URL
  let imageUrl = ''
  try {
    const a = document.createElement('a')
    imageUrl = URL.createObjectURL(blob)
    a.href = imageUrl
    a.download = 'breaktheworld.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(imageUrl), 4000)
  } catch {
    onToast('잠시 뒤 공유 버튼을 다시 눌러보세요.')
    return { ok: false, method: 'none' }
  }
  try {
    await navigator.clipboard.writeText(s.url)
    onToast('🖼️ 이미지 저장 + 링크 복사됨!')
  } catch {
    onToast('🖼️ 이미지 저장됨!')
  }
  return { ok: true, method: 'download' }
}
