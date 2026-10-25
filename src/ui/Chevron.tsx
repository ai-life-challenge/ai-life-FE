// 펼침 표시(아래 화살표). 펼쳐지면 위쪽을 보게 뒤집힌다. 서비스 전체에서 같은 아이콘 · 같은 크기를 쓴다
import { LuChevronDown } from 'react-icons/lu'

export function Chevron({ open = false }: { open?: boolean }) {
  return <LuChevronDown aria-hidden size={16} className={`chev ${open ? 'up' : ''}`} />
}
