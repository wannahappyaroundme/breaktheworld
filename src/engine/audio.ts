/**
 * Procedural sound effects via Web Audio — no asset files, no licensing.
 * Mobile browsers require a user gesture to start audio, so unlock() must be
 * called from the first touch. Everything routes through a master gain that
 * the mute toggle controls.
 */
export type Sfx =
  | 'boom'
  | 'bigboom'
  | 'glass'
  | 'thud'
  | 'snap'
  | 'zap'
  | 'whoosh'
  | 'freeze'
  | 'squash'
  | 'energy'
  | 'sizzle'
  | 'goo'

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  muted = false

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    // 1s of white noise we can reuse
    const len = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02)
    }
    return this.muted
  }

  private now(): number {
    return this.ctx!.currentTime
  }

  private noise(dur: number, gainVal: number, filter?: { type: BiquadFilterType; freq: number; q?: number }): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const g = this.ctx.createGain()
    const t = this.now()
    g.gain.setValueAtTime(gainVal, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    let node: AudioNode = src
    if (filter) {
      const f = this.ctx.createBiquadFilter()
      f.type = filter.type
      f.frequency.value = filter.freq
      if (filter.q) f.Q.value = filter.q
      src.connect(f)
      node = f
    }
    node.connect(g)
    g.connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gainVal: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    const t = this.now() + delay
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(gainVal, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  play(name: Sfx): void {
    if (this.muted || !this.ctx) return
    switch (name) {
      case 'boom':
        this.tone('sine', 160, 40, 0.5, 0.8)
        this.noise(0.4, 0.7, { type: 'lowpass', freq: 900 })
        break
      case 'bigboom':
        this.tone('sine', 200, 30, 0.9, 1.0)
        this.tone('sine', 90, 25, 1.0, 0.7)
        this.noise(0.7, 0.9, { type: 'lowpass', freq: 1400 })
        break
      case 'glass':
        for (let i = 0; i < 5; i++) {
          const d = i * 0.012
          window.setTimeout(() => this.noise(0.08, 0.4, { type: 'highpass', freq: 3500 + i * 600 }), d * 1000)
        }
        this.tone('triangle', 2600, 1800, 0.12, 0.18)
        break
      case 'thud':
        this.tone('sine', 120, 50, 0.22, 0.8)
        this.noise(0.16, 0.5, { type: 'lowpass', freq: 600 })
        break
      case 'snap':
        this.noise(0.05, 0.6, { type: 'bandpass', freq: 2200, q: 2 })
        this.tone('sine', 110, 50, 0.5, 0.5, 0.04)
        this.noise(0.5, 0.25, { type: 'lowpass', freq: 400 })
        break
      case 'zap':
        this.tone('sawtooth', 1400, 200, 0.18, 0.4)
        this.noise(0.14, 0.4, { type: 'highpass', freq: 2000 })
        break
      case 'whoosh':
        this.noise(0.32, 0.45, { type: 'bandpass', freq: 900, q: 0.7 })
        break
      case 'freeze':
        this.tone('sine', 3000, 5200, 0.4, 0.18)
        this.noise(0.3, 0.18, { type: 'highpass', freq: 5000 })
        break
      case 'squash':
        this.tone('sine', 400, 70, 0.3, 0.6)
        this.noise(0.18, 0.4, { type: 'lowpass', freq: 500 })
        break
      case 'energy':
        this.tone('sawtooth', 120, 900, 0.6, 0.35)
        this.tone('sine', 240, 1800, 0.6, 0.25)
        break
      case 'sizzle':
        this.noise(0.5, 0.3, { type: 'highpass', freq: 2600 })
        break
      case 'goo':
        this.tone('sine', 500, 90, 0.4, 0.5)
        this.tone('triangle', 250, 60, 0.35, 0.3, 0.05)
        break
    }
  }
}
