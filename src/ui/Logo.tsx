// LocalLens 로고: 글자는 HTML 텍스트, 'Local'의 o 자리만 보라 위치 핀 SVG로 바꾼다(L + 핀 + calLens).
// 이미지가 아니라서 어느 화면 크기 · 해상도에서도 선명하다. 크기는 글자 크기(em)를 따라가서 font-size만 바꾸면 비율이 그대로다.
// 스크린리더에는 role="img" + aria-label로 'LocalLens' 한 번만 읽힌다(글자 조각과 핀은 읽지 않는다)
export function Logo() {
  return (
    <span className="brand" role="img" aria-label="LocalLens">
      L
      <svg className="brand-pin" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="#9b3fe8" fillRule="evenodd" clipRule="evenodd"
          d="M4.7 9.03c0 4.03 4.78 13.16 7.3 13.16s7.3-9.13 7.3-13.16a7.3 7.3 0 0 0-14.6 0m7.3 2.93a3.43 3.43 0 1 1 0-6.86a3.43 3.43 0 0 1 0 6.86" />
        <path fill="none" stroke="#9b3fe8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
          d="M14.54 20.37c-1.06 1.3-1.59 1.95-2.54 1.95s-1.48-.66-2.54-1.96c-2.2-2.7-5.03-6.98-5.03-11.07a7.57 7.57 0 1 1 15.14 0c0 4.12-2.83 8.38-5.03 11.08" />
        <circle cx="12" cy="8.98" r="3.59" fill="none" stroke="#9b3fe8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" transform="rotate(90 12 8.98)" />
      </svg>
      calLens
    </span>
  )
}
