// 서비스 모양의 확인 창(브라우저 기본 confirm 대신). 되돌릴 수 없는 일을 하기 전에 묻는다.
// 열리면 '취소'에 포커스를 두고 Tab이 창 안에서만 돈다. Esc · 바깥 누르기 · 취소로 닫고, 닫으면 연 버튼으로 포커스를 돌려준다.
// 열려 있는 동안 뒤 화면은 스크롤되지 않는다. 확인 작업이 도는 동안(busy)에는 닫히지 않고 버튼도 한 번만 눌린다
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

export function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, busy, error, onConfirm, onClose, fallbackFocus }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  busyLabel: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
  fallbackFocus?: () => HTMLElement | null // 연 버튼이 사라졌을 때(예: 되돌린 뒤) 포커스를 둘 곳
}) {
  const titleId = useId()
  const bodyId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  const fallback = useRef(fallbackFocus)
  useEffect(() => { close.current = onClose; fallback.current = fallbackFocus })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    // 뒤 화면 스크롤 막기(스크롤 막대가 사라져 화면이 옆으로 밀리지 않게 그 폭만큼 채운다)
    const html = document.documentElement
    const prev = { overflow: html.style.overflow, pad: document.body.style.paddingRight }
    const bar = window.innerWidth - html.clientWidth
    html.style.overflow = 'hidden'
    if (bar > 0) document.body.style.paddingRight = `${bar}px`
    return () => {
      html.style.overflow = prev.overflow
      document.body.style.paddingRight = prev.pad
      if (opener?.isConnected) opener.focus()
      else fallback.current?.()?.focus()
    }
  }, [open])
  // 작업이 끝나면(실패해서 창이 남아 있으면) 버튼이 다시 눌릴 수 있으니 포커스를 창 안으로 되돌린다
  useEffect(() => {
    if (open && !busy && !boxRef.current?.contains(document.activeElement)) cancelRef.current?.focus()
  }, [open, busy])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) close.current(); return }
    if (e.key !== 'Tab') return
    const items = [...(boxRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (!items.length) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="modal-layer no-print" onKeyDown={onKeyDown}>
          <motion.div className="scrim modal-scrim" onClick={() => { if (!busy) onClose() }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} />
          <motion.div
            ref={boxRef}
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            aria-busy={busy}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <h2 id={titleId}>{title}</h2>
            <div id={bodyId} className="confirm-body">{children}</div>
            {error && <p className="confirm-err" role="alert">{error}</p>}
            <div className="confirm-actions">
              <button ref={cancelRef} type="button" className="ghost" onClick={onClose} disabled={busy}>취소</button>
              <button type="button" className="danger" onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
