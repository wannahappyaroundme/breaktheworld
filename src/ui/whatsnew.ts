const ITEMS: { e: string; t: string }[] = [
  { e: '💰', t: '황금 타겟 등장! 가끔 떨어지는 골든 타겟을 부수면 잭팟 🎉' },
  { e: '🌈', t: 'FEVER 모드 — 콤보가 폭주하면 화면이 무지개로 미쳐가요' },
  { e: '📸', t: '공유 카드 — 상단 📸로 내 최고 기록을 친구에게 자랑!' },
  { e: '🌍', t: '무한 연쇄: 세상 → 지구 → 도시가 하늘에서 뚝뚝' },
  { e: '🏆', t: '콤보 신기록 저장 + 갱신하면 축하 폭죽' },
  { e: '🧊', t: '와장창 쾌감 — 히트스톱·유리 반짝임·진동' },
  { e: '☁️', t: '시나모롤·메타몽 새 그림 (예전 버전도 무기로!)' },
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
  }

  /** Show on every load (per user request). */
  maybeShowOnLoad(): void {
    this.open()
  }
}
