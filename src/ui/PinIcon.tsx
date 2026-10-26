// LocalLens 브랜드 아이콘: 보라 위치 핀(색 · 경로는 ui/pin.ts). 로고(ui/Logo.tsx)의 o 자리에 쓰고, 파비콘(public/favicon.svg)도 같은 모양이다
import { PIN_COLOR, PIN_PATHS } from './pin'

// 장식용이라 스크린리더에서는 읽지 않는다. 이름은 감싸는 쪽(로고 등)이 준다
export function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill={PIN_COLOR} fillRule="evenodd" clipRule="evenodd" d={PIN_PATHS.fill} />
      <path fill="none" stroke={PIN_COLOR} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={PIN_PATHS.outline} />
      <circle cx="12" cy="8.98" r="3.59" fill="none" stroke={PIN_COLOR} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" transform="rotate(90 12 8.98)" />
    </svg>
  )
}
