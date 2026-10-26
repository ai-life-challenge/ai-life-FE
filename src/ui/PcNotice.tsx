// 좁은 화면(모바일)에서는 서비스를 쓸 수 없게 화면 전체를 덮는 안내. 지도와 패널이 PC 화면에 맞춰져 있어서 닫을 수 없다(CSS가 좁을 때만 보이게 한다)
export function PcNotice() {
  return (
    <div className="pc-only no-print" role="alert">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
      </svg>
      <p className="pc-only-title">PC 화면으로 확인해 주세요</p>
      <p className="pc-only-sub">LocalLens는 넓은 화면에서 지도와 함께 볼 수 있게 만들었어요.<br />컴퓨터(노트북)에서 다시 열어 주세요.</p>
    </div>
  )
}
