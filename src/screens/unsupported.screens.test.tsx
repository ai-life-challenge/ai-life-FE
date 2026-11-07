// @vitest-environment jsdom
// 서버 장애 때 지원하지 않는 지역의 안내: 지역 선택 목록, 지도에서 고른 경우, 주소로 바로 연 경우
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MapRef } from 'react-map-gl/maplibre'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { RegionRoute } from '../RegionRoute'
import type { SnapshotManifest } from '../api/snapshot'
import { state } from '../api/testRegion'
import type { RegionItem } from '../api/types'
import { useStore } from '../store'
import { Select } from './Select'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
const initial = useStore.getState()
const item: RegionItem = { code: '99999', name: '예시군', sido: '예시도', tier: 'auto', villages: 6, center: [128, 35], shrinkingArea: false, erVulnerable: false }
const snapshot = { capturedAt: '2026-11-06', origin: 'x', complete: false, totalRegions: 2, regions: [item], unsupported: [{ code: '88888', name: '보류군', sido: '예시도' }], defaultState: state() } as unknown as SnapshotManifest
let box: HTMLDivElement, root: Root
const healthy = () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
beforeEach(() => {
  vi.stubGlobal('fetch', healthy())
  useStore.setState(initial, true)
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => { await act(async () => root.unmount()); box.remove(); vi.unstubAllGlobals(); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }) })
const outage = () => useStore.setState({ regions: [item], listSource: 'snapshot', snapshot, state: state(), defaults: state(), loadList: async () => {} })

test('전체 장애: 지역 선택에 보류 지역을 지원하지 않는 지역으로 따로 보여 주고, 고르면 넘어간다', async () => {
  outage()
  const pick = vi.fn()
  await act(async () => root.render(<MemoryRouter><Select mapRef={createRef<MapRef>()} blocked={null} pick={pick} picked={null} /></MemoryRouter>))
  expect(box.querySelector('.estimate-note')!.textContent).toContain('나머지 1개 지역은 서버 장애 중에는 지원하지 않고')
  const held = box.querySelector('.region-held')!
  expect(held.textContent).toContain('서버 장애 중 지원하지 않는 지역')
  await act(async () => (held.querySelector('button') as HTMLButtonElement).click())
  expect(pick).toHaveBeenCalledWith('88888')
})
test('지도에서 보류 지역을 누르면 준비 안 됨이 아니라 장애 중 미지원으로 알린다', async () => {
  outage()
  await act(async () => root.render(<MemoryRouter><Select mapRef={createRef<MapRef>()} blocked="보류군" pick={() => {}} picked={null} /></MemoryRouter>))
  expect(box.querySelector('.toast-inline')!.textContent).toContain('서버 장애 중에는 지원하지 않아요')
  expect(box.querySelector('.toast-inline')!.textContent).not.toContain('아직 준비되지 않았어요')
})
test('서버 정상: 지원하지 않는 지역 안내가 없다', async () => {
  useStore.setState({ regions: [item, { ...item, code: '88888', name: '보류군' }], listSource: 'server', state: state(), loadList: async () => {} })
  await act(async () => root.render(<MemoryRouter><Select mapRef={createRef<MapRef>()} blocked={null} pick={() => {}} picked={null} /></MemoryRouter>))
  expect(box.querySelector('.region-held')).toBeNull()
  expect(box.querySelector('.estimate-note')).toBeNull()
})
test('공유 링크로 보류 지역을 열면 지역 선택으로 말없이 보내지 않고 이유를 알린다', async () => {
  outage()
  useStore.setState({ loadRegion: async () => {} })
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/r/88888']}>
      <Routes>
        <Route path="/start" element={<p>지역 선택 화면</p>} />
        <Route path="/r/:code" element={<RegionRoute><p>자료 화면</p></RegionRoute>} />
      </Routes>
    </MemoryRouter>,
  ))
  expect(box.textContent).toContain('보류군은(는) 지금 지원하지 않아요')
  expect(box.textContent).toContain('서버가 돌아오면')
  expect(box.textContent).not.toContain('지역 선택 화면')
  expect(box.textContent).not.toContain('자료 화면')
})
