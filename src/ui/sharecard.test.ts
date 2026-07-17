import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHARE_CARD_LAYOUT, renderCard, shareCard } from './sharecard'

function canvasHarness() {
  const texts: string[] = []
  const strokeRect = vi.fn()
  const context = {
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    restore: vi.fn(),
    strokeText: vi.fn(),
    fillText: (text: string) => texts.push(text),
    strokeRect,
    textAlign: '',
    lineJoin: '',
    font: '',
    strokeStyle: '',
    lineWidth: 0,
    fillStyle: '',
  }
  const canvas: {
    width: number
    height: number
    getContext: () => typeof context
    toBlob: (callback: (blob: Blob | null) => void) => void
  } = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback) => callback(new Blob(['image'], { type: 'image/png' })),
  }
  return { canvas, context, texts, strokeRect }
}

let harness: ReturnType<typeof canvasHarness>
let anchor: { click: ReturnType<typeof vi.fn>; href: string; download: string }

beforeEach(() => {
  harness = canvasHarness()
  anchor = { click: vi.fn(), href: '', download: '' }
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => {
      if (tag === 'canvas') return harness.canvas
      return anchor
    }),
  })
  vi.stubGlobal('File', class FakeFile extends Blob {
    constructor(parts: BlobPart[], readonly name: string, options?: FilePropertyBag) {
      super(parts, options)
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('share card', () => {
  it('renders the selected title, Korean record copy, and restrained stamp frame', () => {
    renderCard({
      best: 42,
      total: 8,
      url: 'https://example.com/game',
      title: '산산조각',
      unlockedTitleIds: ['hits_1000'],
      frameId: 'electric_night',
      recordBookThemeId: 'electric_night',
      level: 10,
    })

    expect(harness.texts).toContain('산산조각')
    expect(harness.texts).toContain('🔥 최고 연속 42')
    expect(harness.texts.join(' ')).not.toContain('최고 콤보')
    expect(harness.strokeRect).toHaveBeenCalledOnce()
    expect(harness.context.strokeStyle).toBe('#61d4ff')
    const innerTop = SHARE_CARD_LAYOUT.frame.y + SHARE_CARD_LAYOUT.frame.lineWidth / 2
    const innerBottom = (
      SHARE_CARD_LAYOUT.frame.y
      + SHARE_CARD_LAYOUT.frame.size
      - SHARE_CARD_LAYOUT.frame.lineWidth / 2
    )
    expect(SHARE_CARD_LAYOUT.titleY - 44).toBeGreaterThan(innerTop + 16)
    expect(SHARE_CARD_LAYOUT.urlY + 12).toBeLessThan(innerBottom - 16)
  })

  it('falls back safely for locked or unknown cosmetics without changing record stats', () => {
    renderCard({
      best: 42,
      total: 8,
      url: 'https://example.com/game',
      title: 'unknown title',
      unlockedTitleIds: ['hits_1000'],
      frameId: 'electric_night',
      recordBookThemeId: 'unknown',
      level: 1,
    })

    expect(harness.strokeRect).not.toHaveBeenCalled()
    expect(harness.texts).not.toContain('unknown title')
    expect(harness.texts).toContain('🔥 최고 연속 42')
    expect(harness.texts).toContain('💥 지금까지 8개 부숨')
  })

  it('rejects locked and non-title rewards while preserving a legacy selected title', () => {
    renderCard({
      best: 9, total: 2, url: 'https://example.com/game',
      title: '산산조각', unlockedTitleIds: [],
      frameId: 'default', recordBookThemeId: 'default', level: 20,
    })
    expect(harness.texts).not.toContain('산산조각')

    harness.texts.length = 0
    renderCard({
      best: 9, total: 2, url: 'https://example.com/game',
      title: '첫 와장창', unlockedTitleIds: ['first_destroy'],
      frameId: 'default', recordBookThemeId: 'default', level: 20,
    })
    expect(harness.texts).toContain('첫 와장창')

    harness.texts.length = 0
    renderCard({
      best: 9, total: 2, url: 'https://example.com/game',
      title: '첫 금', unlockedTitleIds: ['first_hit'],
      frameId: 'default', recordBookThemeId: 'default', level: 20,
    })
    expect(harness.texts).not.toContain('첫 금')
  })

  it('returns native success so gameplay can emit SHARE_COMPLETED truthfully', async () => {
    const share = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })

    const result = await shareCard({
      best: 7,
      total: 3,
      url: 'https://example.com/game',
      title: null,
      unlockedTitleIds: [],
      frameId: 'default', recordBookThemeId: 'default', level: 1,
    }, vi.fn())

    expect(result).toEqual({ ok: true, method: 'native' })
    expect(share).toHaveBeenCalledOnce()
  })

  it('returns quietly when the user cancels native sharing', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: vi.fn(async () => { throw cancelled }),
    })
    const toast = vi.fn()

    const result = await shareCard({
      best: 7,
      total: 3,
      url: 'https://example.com/game',
      title: null,
      unlockedTitleIds: [],
      frameId: 'default', recordBookThemeId: 'default', level: 1,
    }, toast)

    expect(result).toEqual({ ok: false, method: 'none' })
    expect(toast).not.toHaveBeenCalled()
  })

  it('returns a positive next action when card creation is unavailable', async () => {
    harness.canvas.toBlob = (callback: (blob: Blob | null) => void) => callback(null)
    vi.stubGlobal('navigator', {})
    const toast = vi.fn()

    const result = await shareCard({
      best: 0,
      total: 0,
      url: 'https://example.com/game',
      title: null,
      unlockedTitleIds: [],
      frameId: 'default', recordBookThemeId: 'default', level: 1,
    }, toast)

    expect(result).toEqual({ ok: false, method: 'none' })
    expect(toast).toHaveBeenCalledOnce()
    expect(toast.mock.calls[0][0]).toContain('다시')
    expect(toast.mock.calls[0][0]).not.toContain('실패')
    expect(toast.mock.calls[0][0]).not.toContain('—')
  })

  it('converts file construction errors into a handled positive result', async () => {
    vi.stubGlobal('File', class BrokenFile {
      constructor() { throw new Error('files unavailable') }
    })
    vi.stubGlobal('navigator', {})
    const toast = vi.fn()

    await expect(shareCard({
      best: 1,
      total: 1,
      url: 'https://example.com/game',
      title: null,
      unlockedTitleIds: [],
      frameId: 'default', recordBookThemeId: 'default', level: 1,
    }, toast)).resolves.toEqual({ ok: false, method: 'none' })
    expect(toast.mock.calls[0][0]).toContain('다시')
  })

  it.each([
    ['copies the link', true, '🖼️ 이미지 저장 + 링크 복사됨!'],
    ['keeps the saved image when copy is unavailable', false, '🖼️ 이미지 저장됨!'],
  ] as const)('downloads the rendered image, %s, and cleans its object URL', async (
    _label,
    clipboardAvailable,
    expectedToast
  ) => {
    vi.useFakeTimers()
    const writeText = clipboardAvailable
      ? vi.fn(async () => undefined)
      : vi.fn(async () => { throw new Error('clipboard unavailable') })
    const createObjectURL = vi.fn(() => 'blob:share-card')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('navigator', { canShare: () => false, clipboard: { writeText } })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const toast = vi.fn()

    const result = await shareCard({
      best: 12,
      total: 4,
      url: 'https://example.com/game',
      title: '산산조각',
      unlockedTitleIds: ['hits_1000'],
      frameId: 'first_crack', recordBookThemeId: 'default', level: 5,
    }, toast)

    expect(result).toEqual({ ok: true, method: 'download' })
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.download).toBe('breaktheworld.png')
    expect(anchor.href).toBe('blob:share-card')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('https://example.com/game')
    expect(toast).toHaveBeenCalledWith(expectedToast)
    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:share-card')
    vi.useRealTimers()
  })
})
