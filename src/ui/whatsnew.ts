const VERSION = 'upgrade-2026-06'
const SEEN_KEY = 'btw.seenVersion'

const ITEMS: { e: string; t: string }[] = [
  { e: '🌍', t: '무한 연쇄! 세상 → 지구 → 도시가 하늘에서 뚝뚝 떨어져요' },
  { e: '🏆', t: '콤보 신기록 저장 + 상단 표시, 갱신하면 축하 폭죽!' },
  { e: '🧊', t: '와장창 쾌감 업 — 히트스톱·유리 반짝임·진동' },
  { e: '💥', t: '파괴할 때 “와장창!” 팝업 + 콤보 등급(GREAT/SUPER…)' },
  { e: '💛', t: '캐릭터 시그니처 이모지 파편 ☁️🐾🍯 + 등장 그림자' },
  { e: '☁️', t: '시나모롤·메타몽 새 그림 (예전 버전도 무기로 남겼어요)' },
]

/** Small centered "what's new" modal. Auto-shows once per version; reopenable. */
export class WhatsNew {
  private backdrop: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div')
    this.backdrop.className = 'modal-backdrop'
    this.backdrop.innerHTML = `
      <div class="whatsnew" role="dialog" aria-modal="true">
        <h2>✨ 업데이트 안내</h2>
        <div class="sub">세상 부수기가 더 통쾌해졌어요!</div>
        <ul>
          ${ITEMS.map((i) => `<li><span class="e">${i.e}</span><span>${i.t}</span></li>`).join('')}
        </ul>
        <button class="ok-btn" type="button">부수러 가기 💥</button>
      </div>`
    parent.appendChild(this.backdrop)

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close()
    })
    this.backdrop.querySelector('.ok-btn')!.addEventListener('click', () => this.close())
    // taps on the modal must not fall through to the canvas
    this.backdrop.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  }

  open(): void {
    this.backdrop.classList.add('show')
  }

  close(): void {
    this.backdrop.classList.remove('show')
    localStorage.setItem(SEEN_KEY, VERSION)
  }

  /** Show automatically the first time a user opens this version. */
  maybeShowOnLoad(): void {
    if (localStorage.getItem(SEEN_KEY) !== VERSION) this.open()
  }
}
