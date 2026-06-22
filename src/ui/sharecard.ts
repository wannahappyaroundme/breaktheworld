import { getImage } from '../art/assets'

export interface ShareStats {
  best: number
  total: number
  url: string
}

/** Draw the 1080² brag card to a canvas. */
export function renderCard(s: ShareStats): HTMLCanvasElement {
  const W = 1080
  const H = 1080
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
  ctx.strokeText('세상 부수기', W / 2, 200)
  ctx.fillStyle = '#ffd23f'
  ctx.fillText('세상 부수기', W / 2, 200)

  // stats
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 70px sans-serif'
  ctx.fillText(`🔥 최고 콤보 ${s.best}`, W / 2, 850)
  ctx.fillStyle = '#cdd6e3'
  ctx.font = '700 46px sans-serif'
  ctx.fillText(`💥 지금까지 ${s.total}개 부숨`, W / 2, 922)
  ctx.fillStyle = '#ffd23f'
  ctx.font = '800 42px sans-serif'
  ctx.fillText('내 기록 깰 수 있어? 👀', W / 2, 1000)
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 32px sans-serif'
  ctx.fillText(s.url.replace(/^https?:\/\//, ''), W / 2, 1046)
  return c
}

/** Compose the brag card and share it (native share, else save + copy URL). */
export async function shareCard(s: ShareStats, onToast: (msg: string) => void): Promise<void> {
  const c = renderCard(s)
  const blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'))
  if (!blob) {
    onToast('카드 생성 실패 😢')
    return
  }
  const file = new File([blob], 'breaktheworld.png', { type: 'image/png' })
  const text = `내 최고 콤보 ${s.best}! 깰 수 있어? ${s.url}`

  const navAny = navigator as unknown as {
    canShare?: (d: { files: File[] }) => boolean
    share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>
  }
  if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
    try {
      await navAny.share({ files: [file], title: '세상 부수기', text })
      return
    } catch {
      /* user cancelled — fall through to save */
    }
  }
  // fallback: download image + copy URL
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'breaktheworld.png'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  try {
    await navigator.clipboard.writeText(s.url)
    onToast('🖼️ 이미지 저장 + 링크 복사됨!')
  } catch {
    onToast('🖼️ 이미지 저장됨!')
  }
}
