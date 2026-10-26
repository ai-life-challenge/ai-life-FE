// LocalLens 로고: 글자는 HTML 텍스트, 'Local'의 o 자리만 보라 위치 핀(ui/PinIcon.tsx)으로 바꾼다(L + 핀 + calLens).
// 이미지가 아니라서 어느 화면 크기 · 해상도에서도 선명하다. 크기는 글자 크기(em)를 따라가서 font-size만 바꾸면 비율이 그대로다.
// 스크린리더에는 role="img" + aria-label로 'LocalLens' 한 번만 읽힌다(글자 조각과 핀은 읽지 않는다)
import { PinIcon } from './PinIcon'

export function Logo() {
  return (
    <span className="brand" role="img" aria-label="LocalLens">
      L<PinIcon className="brand-pin" />calLens
    </span>
  )
}
