// 레포트 문단 자동 저장. 화면·서버와 떨어진 순수 로직이라 가짜 send로 테스트한다(autosave.test.ts).
// - 입력을 멈추고 delay(ms) 뒤, 또는 편집기를 떠날 때(flush) 저장한다
// - 한 번에 요청 하나만 보낸다. 보내는 동안 바뀐 글은 그 요청이 끝난 뒤 이어서 보낸다(응답 순서가 뒤집히지 않는다)
// - 서버가 받은 글(confirmed)과 화면 글(local)이 같으면 보내지 않는다. 실패하면 화면 글을 그대로 두고 다시 보낼 수 있다
import type { SectionKey } from '../../api/types'

export type SectionValue = string | null // null: 고친 글을 버리고 서버 초안으로 되돌린다
export type Changes = Partial<Record<SectionKey, SectionValue>>
export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' } // 입력을 멈추면 곧 보낸다
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid'; key: SectionKey; message: string } // 서버가 받지 않을 글(빈 문단 · 글자 수 초과). 고칠 때까지 보내지 않는다

export interface AutosaveDeps {
  send: (changes: Changes) => Promise<void> // 실패하면 화면에 보여 줄 message를 가진 오류를 던진다
  validate?: (key: SectionKey, value: SectionValue) => string | null
  delay?: number
}

export class Autosave {
  private confirmed = new Map<SectionKey, SectionValue>()
  private local = new Map<SectionKey, SectionValue>()
  private inflight: Map<SectionKey, SectionValue> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private error: string | null = null
  private saved = false
  private listeners = new Set<() => void>()
  private snap: SaveStatus = { kind: 'idle' }
  private disposed = false
  private sending: Promise<void> = Promise.resolve() // 보내는 중인 요청(성공·실패와 상관없이 끝나면 풀린다)
  private deps: AutosaveDeps

  constructor(deps: AutosaveDeps) {
    this.deps = deps
  }

  // 서버가 지금 가진 글(편집기가 서버 글을 다시 읽은 뒤의 마크다운). 아직 안 보낸 글이 있으면 건드리지 않는다
  base(key: SectionKey, value: SectionValue) {
    if (this.isDirty(key)) return
    this.confirmed.set(key, value)
    this.local.set(key, value)
  }

  edit(key: SectionKey, value: SectionValue) {
    this.local.set(key, value)
    this.schedule()
    this.emit()
  }

  // 다시 보내기 전 시간을 기다리지 않고 바로 보낸다(편집기를 떠날 때 · 되돌리기 · 다시 시도)
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.inflight || this.disposed) return this.emit()
    const send = new Map<SectionKey, SectionValue>()
    for (const k of this.dirtyKeys()) if (!this.invalidOf(k)) send.set(k, this.local.get(k) ?? null)
    if (!send.size) return this.emit()
    this.inflight = send
    this.emit()
    this.sending = this.deps.send(Object.fromEntries(send)).then(
      () => {
        for (const [k, v] of send) this.confirmed.set(k, v)
        this.inflight = null
        this.error = null
        this.saved = true
        this.emit()
        if (!this.timer && this.dirtyKeys().some((k) => !this.invalidOf(k))) this.flush() // 보내는 동안 더 고친 글
      },
      (e: unknown) => {
        this.inflight = null
        this.error = (e as { message?: string })?.message || '저장하지 못했어요.'
        this.emit()
      },
    )
  }

  // 고친 글을 버리고 서버 초안으로 되돌린다. 보내는 중인 요청이 있으면 그것이 끝난 뒤 보낸다.
  // 서버가 받지 못하면 고친 글을 그대로 되살리고 오류를 던진다(되돌리기가 남아 있다가 나중에 저절로 보내지지 않게)
  async revert(key: SectionKey) {
    const before = this.local.get(key)
    this.local.set(key, null)
    this.emit()
    while (this.inflight) await this.sending
    this.flush()
    await this.sending
    if (this.confirmed.has(key) && this.confirmed.get(key) === null) return
    if (this.local.get(key) === null) {
      if (before === undefined) this.local.delete(key)
      else this.local.set(key, before)
      this.emit()
    }
    throw new Error(this.error ?? '되돌리지 못했어요.')
  }

  // 서버가 가진 값을 아직 모르면(confirmed 없음) 다르다고 본다. 되살린 '초안으로(null)' 글도 보내야 하기 때문이다
  isDirty(key: SectionKey) {
    return this.local.has(key) && this.local.get(key) !== this.confirmed.get(key)
  }
  // 서버에 아직 없는 글이 있는가(보내는 중 포함). 페이지를 떠날 때 묻는 데 쓴다
  hasUnsaved() {
    return [...this.local.keys()].some((k) => this.isDirty(k))
  }
  // 아직 서버에 없는 글: 새로고침해도 이어 쓸 수 있게 브라우저에 따로 둔다
  unsaved(): Changes {
    return Object.fromEntries([...this.local.keys()].filter((k) => this.isDirty(k)).map((k) => [k, this.local.get(k) ?? null]))
  }
  valueOf(key: SectionKey) {
    return this.local.get(key)
  }

  status = () => this.snap
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.listeners.clear()
  }

  // 보내야 할 글: 보내는 중인 글이 있으면 그것과, 없으면 서버가 받은 글과 비교한다
  private dirtyKeys() {
    return [...this.local.keys()].filter((k) => {
      const remote = this.inflight?.has(k) ? this.inflight.get(k) : this.confirmed.get(k)
      return this.local.get(k) !== remote
    })
  }
  private invalidOf(key: SectionKey) {
    return this.deps.validate?.(key, this.local.get(key) ?? null) ?? null
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, this.deps.delay ?? 700)
  }
  private emit() {
    const unsaved = [...this.local.keys()].filter((k) => this.isDirty(k))
    const bad = unsaved.map((k) => [k, this.invalidOf(k)] as const).find(([, m]) => m)
    const next: SaveStatus = this.inflight
      ? { kind: 'saving' }
      : bad ? { kind: 'invalid', key: bad[0], message: bad[1]! }
        : this.error && unsaved.length ? { kind: 'error', message: this.error }
          : unsaved.length ? { kind: 'pending' }
            : this.saved ? { kind: 'saved' } : { kind: 'idle' }
    if (JSON.stringify(next) !== JSON.stringify(this.snap)) this.snap = next
    this.listeners.forEach((fn) => fn())
  }
}
