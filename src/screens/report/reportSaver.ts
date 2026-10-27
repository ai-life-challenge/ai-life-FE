// 레포트 화면의 자동 저장을 store(서버 저장)와 브라우저 보관에 잇는다.
// 서버는 문서를 따로 보관하지 않고 요청마다 state로 레포트를 다시 만든다. 그래서 서버가 받아 준 문단(state.report.sections)과
// 아직 서버에 못 보낸 글을 지역마다 이 브라우저(localStorage)에 두고, 새로고침하면 되살려 다시 보낸다.
import type { SectionKey } from '../../api/types'
import { errText, useStore } from '../../store'
import { Autosave, type Changes, type SectionValue } from './autosave'
import { validateSection } from './sectionRules'

type Stored = { sections: Changes; drafts: Changes }
const storeKey = (code: string) => `locallens:report:v1:${code}`

// undefined: 브라우저 보관을 쓸 수 없다(사생활 보호 창 등) · null: 보관한 글이 없다
export function readStored(code: string): Stored | null | undefined {
  try {
    const raw = localStorage.getItem(storeKey(code))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    return { sections: v.sections ?? {}, drafts: v.drafts ?? {} }
  } catch { return undefined }
}
function writeStored(code: string, v: Stored) {
  try {
    if (!Object.keys(v.sections).length && !Object.keys(v.drafts).length) localStorage.removeItem(storeKey(code))
    else localStorage.setItem(storeKey(code), JSON.stringify(v))
  } catch { /* 보관하지 못해도 서버 저장은 그대로 한다 */ }
}

const overrides = (sections: Changes): Changes => Object.fromEntries(Object.entries(sections).filter(([, v]) => v != null))

// 지역마다 하나. 화면을 떠났다 돌아와도(보내는 중이어도) 같은 것을 쓴다
let current: { code: string; saver: Autosave; restored: boolean } | null = null
export function saverFor(code: string): Autosave {
  if (current?.code === code) return current.saver
  current?.saver.dispose()
  const saver = new Autosave({
    delay: 700,
    validate: validateSection,
    send: (changes) => useStore.getState().saveSections(code, changes).catch((e: unknown) => { throw new Error(errText(e)) }),
  })
  saver.subscribe(() => {
    const st = useStore.getState()
    if (st.code === code && st.state) writeStored(code, { sections: overrides(st.state.report.sections), drafts: saver.unsaved() })
  })
  current = { code, saver, restored: false }
  return saver
}

// 보관한 글을 되살린다(지역마다 한 번): 서버가 받아 준 문단은 state에, 못 보낸 글은 편집기 글로 넣고 다시 보낸다.
// 보관한 글이 없으면 다른 지역에서 고친 문단이 섞이지 않게 비운다
export function restoreReport(code: string) {
  const saver = saverFor(code)
  if (!current || current.restored) return
  current.restored = true
  const stored = readStored(code)
  if (stored === undefined) return
  const sections = stored?.sections ?? {}
  useStore.getState().patch((s) => (JSON.stringify(overrides(s.report.sections)) === JSON.stringify(sections) ? s : { ...s, report: { ...s.report, sections } }))
  for (const [k, v] of Object.entries(stored?.drafts ?? {}) as [SectionKey, SectionValue][]) saver.edit(k, v)
}
