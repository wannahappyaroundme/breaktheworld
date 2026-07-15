import { GestureMachine, type GestureEvent } from '../combat/gesture'

/** Temporary compatibility type until Game moves to GestureEvent in Task 3. */
export interface PointerHit {
  x: number
  y: number
  phase: 'down' | 'drag'
  id: number
}

export type HitHandler = (hit: PointerHit) => void
export type GestureHandler = (event: GestureEvent) => void

type InputHandlerArgs = [onHit: HitHandler] | [onGesture: GestureHandler, mode: 'gesture']

export function createInputForwarder(onHit: HitHandler): GestureHandler
export function createInputForwarder(
  onGesture: GestureHandler,
  mode: 'gesture'
): GestureHandler
export function createInputForwarder(...args: InputHandlerArgs): GestureHandler {
  if (args.length === 2) return args[0]

  const onHit = args[0]
  return (event) => {
    if (event.type === 'tap' || event.type === 'chargeRelease') {
      onHit({ id: event.id, x: event.x, y: event.y, phase: 'down' })
    } else if (event.type === 'dragStart' || event.type === 'drag') {
      onHit({ id: event.id, x: event.x, y: event.y, phase: 'drag' })
    }
  }
}

/** Maps browser PointerEvents to DOM-free gesture events. */
export class Input {
  private machine = new GestureMachine()
  private onGesture: GestureHandler

  /** Temporary Task 2 compatibility overload; Task 3 removes PointerHit. */
  constructor(el: HTMLElement, onHit: HitHandler)
  constructor(el: HTMLElement, onGesture: GestureHandler, mode: 'gesture')
  constructor(el: HTMLElement, ...args: InputHandlerArgs) {
    this.onGesture =
      args.length === 2
        ? createInputForwarder(args[0], args[1])
        : createInputForwarder(args[0])
    this.attach(el)
  }

  update(nowMs: number): void {
    this.emit(this.machine.update(nowMs))
  }

  cancelAll(): void {
    for (const event of this.machine.cancelAll()) this.onGesture(event)
  }

  private emit(event: GestureEvent | null): void {
    if (event) this.onGesture(event)
  }

  private attach(el: HTMLElement): void {
    const opts: AddEventListenerOptions = { passive: false }

    el.addEventListener(
      'pointerdown',
      (event) => {
        event.preventDefault()
        el.setPointerCapture(event.pointerId)
        this.emit(
          this.machine.begin(
            event.pointerId,
            event.clientX,
            event.clientY,
            event.timeStamp,
            event.isPrimary
          )
        )
      },
      opts
    )

    el.addEventListener(
      'pointermove',
      (event) => {
        event.preventDefault()
        this.emit(
          this.machine.move(event.pointerId, event.clientX, event.clientY, event.timeStamp)
        )
      },
      opts
    )

    el.addEventListener(
      'pointerup',
      (event) => {
        event.preventDefault()
        this.emit(this.machine.end(event.pointerId, event.clientX, event.clientY, event.timeStamp))
      },
      opts
    )

    el.addEventListener(
      'pointercancel',
      (event) => {
        event.preventDefault()
        this.emit(this.machine.cancel(event.pointerId))
      },
      opts
    )

    el.addEventListener('lostpointercapture', (event) => {
      this.emit(this.machine.cancel(event.pointerId))
    })

    el.addEventListener('contextmenu', (event) => event.preventDefault())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelAll()
    })
    window.addEventListener('blur', () => this.cancelAll())
  }
}
