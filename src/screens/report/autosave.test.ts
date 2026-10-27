import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Autosave, type Changes } from './autosave'
import { validateSection } from './sectionRules'

// 응답을 손으로 끝내는 가짜 서버
function fakeServer() {
  const calls: { changes: Changes; resolve: () => void; reject: (e: Error) => void }[] = []
  const send = (changes: Changes) => new Promise<void>((resolve, reject) => { calls.push({ changes, resolve, reject }) })
  return { calls, send }
}
const tick = () => Promise.resolve().then(() => Promise.resolve())

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('입력을 멈추고 기다린 뒤 한 번만 보낸다. 마지막 글을 보낸다', () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send, delay: 600 })
  a.base('현황', '처음')
  a.edit('현황', '처음 가')
  vi.advanceTimersByTime(300)
  a.edit('현황', '처음 가나')
  vi.advanceTimersByTime(300)
  a.edit('현황', '처음 가나다')
  expect(srv.calls).toHaveLength(0)
  expect(a.status()).toEqual({ kind: 'pending' })
  vi.advanceTimersByTime(600)
  expect(srv.calls.map((c) => c.changes)).toEqual([{ 현황: '처음 가나다' }])
  expect(a.status()).toEqual({ kind: 'saving' })
})

test('글이 바뀌지 않았으면 보내지 않는다(고쳤다가 원래대로 되돌린 경우 포함)', () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', '처음')
  a.edit('현황', '처음!')
  a.edit('현황', '처음')
  a.flush()
  expect(srv.calls).toHaveLength(0)
  expect(a.hasUnsaved()).toBe(false)
  expect(a.status()).toEqual({ kind: 'idle' })
})

test('보내는 중에 더 고치면 앞 요청이 끝난 뒤 최신 글만 이어서 보낸다(요청이 겹치지 않는다)', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send, delay: 500 })
  a.base('현황', 'A'); a.base('권고', 'X')
  a.edit('현황', 'A1')
  a.flush()
  a.edit('현황', 'A2')
  a.edit('권고', 'X1')
  a.flush() // 앞 요청이 아직 안 끝났다: 보내지 않는다
  expect(srv.calls).toHaveLength(1)
  srv.calls[0].resolve()
  await tick()
  expect(srv.calls).toHaveLength(2)
  expect(srv.calls[1].changes).toEqual({ 현황: 'A2', 권고: 'X1' })
  srv.calls[1].resolve()
  await tick()
  expect(a.status()).toEqual({ kind: 'saved' })
  expect(a.hasUnsaved()).toBe(false)
})

test('보내는 중에 원래 글로 되돌리면, 앞 요청이 끝난 뒤 되돌린 글을 다시 보낸다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', 'A')
  a.edit('현황', 'AB')
  a.flush()
  a.edit('현황', 'A')
  srv.calls[0].resolve()
  await tick()
  expect(srv.calls).toHaveLength(1) // 입력을 멈추길 기다리는 중
  vi.advanceTimersByTime(700)
  expect(srv.calls[1]?.changes).toEqual({ 현황: 'A' })
})

test('저장에 실패하면 글을 그대로 들고 있다가 다시 시도하면 보낸다. 서버가 받기 전에는 저장됨이라 하지 않는다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', 'A')
  a.edit('현황', 'A 고침')
  a.flush()
  srv.calls[0].reject(new Error('서버에 연결하지 못했어요.'))
  await tick()
  expect(a.status()).toEqual({ kind: 'error', message: '서버에 연결하지 못했어요.' })
  expect(a.hasUnsaved()).toBe(true)
  expect(a.unsaved()).toEqual({ 현황: 'A 고침' })
  expect(a.valueOf('현황')).toBe('A 고침')
  // 실패한 뒤에도 계속 고칠 수 있고, 다시 시도하면 최신 글을 보낸다
  a.edit('현황', 'A 고침 더')
  expect(a.status().kind).toBe('error')
  a.flush()
  expect(srv.calls[1].changes).toEqual({ 현황: 'A 고침 더' })
  srv.calls[1].resolve()
  await tick()
  expect(a.status()).toEqual({ kind: 'saved' })
})

test('서버가 받지 않을 글(빈 문단 · 1,500자 초과)은 보내지 않고 알린다. 다른 문단은 그대로 저장한다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send, validate: validateSection })
  a.base('현황', 'A'); a.base('권고', 'B')
  a.edit('현황', '  ')
  a.edit('권고', 'B 고침')
  a.flush()
  expect(srv.calls.map((c) => c.changes)).toEqual([{ 권고: 'B 고침' }])
  srv.calls[0].resolve()
  await tick()
  expect(a.status()).toMatchObject({ kind: 'invalid', key: '현황' })
  a.edit('현황', '가'.repeat(1501))
  expect(a.status()).toMatchObject({ kind: 'invalid', message: expect.stringContaining('1,501자') })
  a.edit('현황', '가'.repeat(1500))
  a.flush()
  expect(srv.calls[1].changes).toEqual({ 현황: '가'.repeat(1500) })
})

test('되돌리기: 서버가 받으면 초안 상태가 되고, 보내는 중인 요청이 있으면 끝난 뒤 보낸다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', '고친 글')
  a.edit('현황', '고친 글 더')
  a.flush()
  const done = a.revert('현황')
  expect(srv.calls).toHaveLength(1) // 앞 요청이 끝나기를 기다린다
  srv.calls[0].resolve()
  await tick(); await tick()
  expect(srv.calls[1].changes).toEqual({ 현황: null })
  srv.calls[1].resolve()
  await done
  expect(a.hasUnsaved()).toBe(false)
})

test('되돌리기에 실패하면 고친 글(아직 안 보낸 글 포함)을 되살리고, 되돌리기를 나중에 다시 보내지 않는다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', '고친 글')
  a.edit('현황', '고친 글 입력 중')
  const done = a.revert('현황')
  srv.calls[0].reject(new Error('서버에 연결하지 못했어요.'))
  await expect(done).rejects.toThrow('서버에 연결하지 못했어요.')
  expect(a.valueOf('현황')).toBe('고친 글 입력 중')
  expect(a.unsaved()).toEqual({ 현황: '고친 글 입력 중' })
  a.flush()
  expect(srv.calls[1].changes).toEqual({ 현황: '고친 글 입력 중' })
})

test('서버 글을 다시 읽어도(base) 아직 안 보낸 글을 덮지 않는다', () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', 'A')
  a.edit('현황', 'A 입력 중')
  a.base('현황', '서버 새 글')
  expect(a.valueOf('현황')).toBe('A 입력 중')
  a.flush()
  expect(srv.calls[0].changes).toEqual({ 현황: 'A 입력 중' })
})

test('원래 글과 같아져 초안으로(null) 바꾸면: 서버가 고친 글을 갖고 있을 때만 보낸다', async () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.base('현황', null) // 고친 글 없음(초안 그대로)
  a.edit('현황', '초안.') // 마침표 추가
  a.edit('현황', null) // 다시 지워 초안과 같아짐: 저장 전이면 보낼 것이 없다
  a.flush()
  expect(srv.calls).toHaveLength(0)
  a.edit('현황', '초안.')
  a.flush()
  srv.calls[0].resolve()
  await tick()
  a.edit('현황', null) // 저장된 뒤에 지우면 초안으로 되돌리는 null을 보낸다
  a.flush()
  expect(srv.calls[1].changes).toEqual({ 현황: null })
})

test('새로고침으로 되살린 초안으로(null) 글은 서버 값을 읽기 전이어도 지워지지 않고 보낸다', () => {
  const srv = fakeServer()
  const a = new Autosave({ send: srv.send })
  a.edit('현황', null) // 브라우저에 남은 글
  a.base('현황', '고친 글') // 편집기가 서버 글(고친 글)을 읽음
  expect(a.valueOf('현황')).toBeNull()
  a.flush()
  expect(srv.calls[0].changes).toEqual({ 현황: null })
})
