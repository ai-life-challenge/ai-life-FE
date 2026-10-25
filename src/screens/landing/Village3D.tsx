// 랜딩의 3D 장면: 창녕군 마을 집계 칸을 막대로 세운다. 스크롤하는 만큼(v3d.p) 막대가 솟고, 군 평균 한 색에서 칸마다 제 색으로 바뀌고, 카메라가 돈다.
// 막대 높이 = 칸 안에서 병원에 닿지 못하는 사람 비율. three.js가 무거워서 이 파일은 따로 불러온다(React.lazy).
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { v3d } from './progress'

export interface Bar { x: number; z: number; rate: number; color: string }
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)

export default function Village3D({ bars, size, avg }: { bars: Bar[]; size: number; avg: string }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 38, position: [0, size, size] }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[size, size * 1.5, size * 0.6]} intensity={1.2} />
      <Bars bars={bars} size={size} avg={avg} />
    </Canvas>
  )
}

function Bars({ bars, size, avg }: { bars: Bar[]; size: number; avg: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { camera, invalidate } = useThree()
  useEffect(() => { v3d.listeners.add(invalidate); return () => { v3d.listeners.delete(invalidate) } }, [invalidate])
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), a: new THREE.Color(avg), c: new THREE.Color(), out: new THREE.Color() }), [avg])
  const colors = useMemo(() => bars.map((b) => new THREE.Color(b.color)), [bars])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const p = v3d.p
    const rise = ease(p / 0.55) // 앞쪽 55% 동안 막대가 솟는다
    const tint = ease((p - 0.35) / 0.4) // 그다음 평균색 → 칸마다 제 색
    bars.forEach((b, i) => {
      const h = 0.12 + b.rate * size * 0.14 * rise
      tmp.o.position.set(b.x, h / 2, b.z)
      tmp.o.scale.set(0.84, h, 0.84)
      tmp.o.updateMatrix()
      m.setMatrixAt(i, tmp.o.matrix)
      m.setColorAt(i, tmp.out.lerpColors(tmp.a, colors[i], tint))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    // 카메라: 위에서 내려다보다가 비스듬히 돌아 들어간다
    const ang = -0.9 + p * 1.6
    const r = size * (1.55 - p * 0.3)
    camera.position.set(Math.sin(ang) * r, size * (1.35 - p * 0.7), Math.cos(ang) * r)
    camera.lookAt(0, size * 0.04, 0)
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, bars.length]} key={bars.length}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} />
    </instancedMesh>
  )
}
