/**
 * LayoutEditor.tsx - Farm cabin/septic tank placement preview editor
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ParcelInfo } from './api'

// Use any type for Leaflet to avoid global Window.L type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyL = any
// Helper to get Leaflet from window without type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getL = (): AnyL => (window as any).L

/* ── Props ───────────────────────────────────────────────────────────────── */
export interface LayoutResult {
  hut_center_wgs84: [number, number]      // [lat, lng]
  septic_center_wgs84: [number, number]
  hut_rotation_deg: number
  placement_note: string
}

interface LayoutEditorProps {
  parcel: ParcelInfo
  hutW: number   // 농막 폭 (m)
  hutD: number   // 농막 깊이 (m)
  onConfirm: (result: LayoutResult) => void
  onCancel: () => void
}

/* ── 유틸 ────────────────────────────────────────────────────────────────── */
function meterToLatDeg(m: number) { return m / 111320 }
function meterToLngDeg(m: number, lat: number) { return m / (111320 * Math.cos(lat * Math.PI / 180)) }

function centroidOf(pts: [number,number][]): [number, number] {
  const n = pts.length
  const sumLat = pts.reduce((s, p) => s + p[0], 0)
  const sumLng = pts.reduce((s, p) => s + p[1], 0)
  return [sumLat / n, sumLng / n]
}

/* ── 컴포넌트 ────────────────────────────────────────────────────────────── */
export default function LayoutEditor({ parcel, hutW, hutD, onConfirm, onCancel }: LayoutEditorProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelPolyRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hutMarkerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const septicMarkerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jibunMarkerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const satelliteLayerRef = useRef<any>(null)

  const [hutPos, setHutPos] = useState<[number, number] | null>(null)
  const [septicPos, setSepticPos] = useState<[number, number] | null>(null)
  const [rotation, setRotation] = useState(0)
  const [ready, setReady] = useState(false)
  const [jibunOn, setJibunOn] = useState(true)
  const [satelliteOn, setSatelliteOn] = useState(false)
  const [cadastralOn, setCadastralOn] = useState(false)
  const [vworldKey, setVworldKey] = useState<string>('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cadastralLayerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseLayerRef = useRef<any>(null)
  // vworldKey ref: 클로저 캡처 문제 방지
  const vworldKeyRef = useRef<string>('')

  // VWorld API 키 로드
  useEffect(() => {
    fetch('/api/vworld-key')
      .then(r => r.json())
      .then(d => {
        const key = d.key || ''
        vworldKeyRef.current = key
        setVworldKey(key)
        // 지도가 이미 준비됐으면 즉시 연속지적도 추가
        if (key && leafletMapRef.current && getL() && !cadastralLayerRef.current) {
          _addCadastralLayerNow(key)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Leaflet 로드 + 지도 초기화 ────────────────────────────────────────── */
  useEffect(() => {
    let mounted = true

    const loadLeaflet = async () => {
      if (!getL()) {
        if (!document.getElementById('leaflet-css')) {
          const link = document.createElement('link')
          link.id = 'leaflet-css'
          link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          document.head.appendChild(link)
        }
        await new Promise<void>((resolve, reject) => {
          if (document.getElementById('leaflet-js')) { resolve(); return }
          const s = document.createElement('script')
          s.id = 'leaflet-js'
          s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
          s.onload = () => resolve()
          s.onerror = () => reject()
          document.head.appendChild(s)
        })
      }
      if (mounted) initMap()
    }

    loadLeaflet()
    return () => { mounted = false }
  }, [])

  /* ── 지도 초기화 ──────────────────────────────────────────────────────── */
  const initMap = () => {
    if (!mapRef.current || !getL()) return
    const L = getL()

    // 폴리곤 좌표 (WGS84: [lat, lng])
    const coords = parcel.polygon_wgs84
    const hasPolygon = coords && coords.length >= 3
    const polygonLls: [number,number][] = hasPolygon
      ? coords!.map(([lng, lat]) => [lat, lng])
      : []

    // 중심점 계산
    const center: [number,number] = polygonLls.length > 0
      ? centroidOf(polygonLls)
      : [parcel.centroid?.lat ?? 36.3748, parcel.centroid?.lon ?? 127.3445]

    // 지도 생성 (주변 지도 표시를 위해 넓은 시야)
    const map = L.map(mapRef.current, {
      center,
      zoom: 17,
      zoomControl: true,
    } as object)

    // OSM 베이스 레이어
    const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 20,
    }).addTo(map)
    baseLayerRef.current = baseLayer
    leafletMapRef.current = map

    // 토지 폴리곤 (경계선만, 색상 없음)
    if (polygonLls.length > 0) {
      const poly = L.polygon(polygonLls, {
        color: '#DC2626',
        weight: 3,
        opacity: 1.0,
        fillColor: '#DC2626',
        fillOpacity: 0.0,    // 색상 레이어 없음
        dashArray: '6, 4',
      })
      poly.addTo(map)
      parcelPolyRef.current = poly

      // 폴리곤에 맞게 줌 (주변 지도가 보이도록 패딩 충분히)
      const bounds = poly.getBounds()
      map.fitBounds([
        [bounds.getSouthWest().lat, bounds.getSouthWest().lng],
        [bounds.getNorthEast().lat, bounds.getNorthEast().lng],
      ], { padding: [60, 60] } as object)
    }

    // 지번 레이블 오버레이 (기본 ON)
    if (parcel.jibun) {
      const icon = L.divIcon({
        html: `<div style="
          background:rgba(220,38,38,0.9);
          color:#fff;
          padding:3px 10px;
          border-radius:4px;
          font-size:12px;
          font-weight:700;
          white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          border:1.5px solid #fff;
          pointer-events:none;
        ">${parcel.jibun}</div>`,
        className: '',
        iconAnchor: [0, 0],
      })
      const jibunMark = L.marker(center, { icon, interactive: false } as object)
      jibunMark.addTo(map)
      jibunMarkerRef.current = jibunMark
    }

    // 초기 농막/정화조 위치 (필지 중앙 기준)
    const latStep = meterToLatDeg(4)
    const lngStep = meterToLngDeg(0, center[0])
    const initHut: [number,number] = [center[0] + latStep, center[1] + lngStep]
    const initSeptic: [number,number] = [center[0] - latStep, center[1] + lngStep]

    // 농막 마커
    const hutIcon = L.divIcon({
      html: buildHutIconHtml(hutW, hutD, rotation),
      className: 'layout-marker',
      iconAnchor: [36, 24],
    })
    const hutMarker = L.marker(initHut, { icon: hutIcon, draggable: true } as object)
    hutMarker.addTo(map)
    hutMarkerRef.current = hutMarker
    setHutPos(initHut)

    // 정화조 마커
    const septicIcon = L.divIcon({
      html: buildSepticIconHtml(),
      className: 'layout-marker',
      iconAnchor: [32, 20],
    })
    const septicMarker = L.marker(initSeptic, { icon: septicIcon, draggable: true } as object)
    septicMarker.addTo(map)
    septicMarkerRef.current = septicMarker
    setSepticPos(initSeptic)

    // 드래그 이벤트
    ;(hutMarker as AnyL).on('drag', () => {
      const ll = hutMarker.getLatLng()
      setHutPos([ll.lat, ll.lng])
    })
    ;(hutMarker as AnyL).on('dragend', () => {
      const ll = hutMarker.getLatLng()
      setHutPos([ll.lat, ll.lng])
    })
    ;(septicMarker as AnyL).on('drag', () => {
      const ll = septicMarker.getLatLng()
      setSepticPos([ll.lat, ll.lng])
    })
    ;(septicMarker as AnyL).on('dragend', () => {
      const ll = septicMarker.getLatLng()
      setSepticPos([ll.lat, ll.lng])
    })

    setReady(true)

    // 지도 크기 재계산 (모달 안에 렌더될 때 필요)
    setTimeout(() => {
      map.invalidateSize()
      // VWorld 키가 이미 로드됐으면 연속지적도 자동 ON
      const key = vworldKeyRef.current
      if (key && !cadastralLayerRef.current) {
        _addCadastralLayerNow(key)
      }
    }, 300)
  }

  /* ── 연속지적도 레이어 추가 (ref 기반) ──────────────────────────────────── */
  function _addCadastralLayerNow(key: string) {
    const map = leafletMapRef.current
    const L = getL()
    if (!map || !L || cadastralLayerRef.current) return
    const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_BUBUN/default/EPSG:900913/{z}/{y}/{x}.png`
    const layer = L.tileLayer(tileUrl, {
      attribution: '© VWorld 연속지적도',
      maxZoom: 19, minZoom: 7,
      tileSize: 256, opacity: 1.0, zIndex: 400,
    })
    layer.addTo(map)
    cadastralLayerRef.current = layer
    setCadastralOn(true)
  }

  /* ── 아이콘 HTML 빌더 ─────────────────────────────────────────────────── */
  function buildHutIconHtml(w: number, d: number, rot: number) {
    return `<div style="
      background:#1E40AF;
      color:#fff;
      padding:5px 10px;
      border-radius:6px;
      font-size:11px;
      font-weight:700;
      white-space:nowrap;
      cursor:move;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      border:2px solid #fff;
      transform:rotate(${rot}deg);
      transform-origin:center;
      min-width:72px;
      text-align:center;
    ">🏠 농막<br><span style="font-size:10px;opacity:0.9;">${w}m × ${d}m</span></div>`
  }

  function buildSepticIconHtml() {
    return `<div style="
      background:#D97706;
      color:#fff;
      padding:5px 10px;
      border-radius:6px;
      font-size:11px;
      font-weight:700;
      white-space:nowrap;
      cursor:move;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      border:2px solid #fff;
      min-width:72px;
      text-align:center;
    ">⚙️ 정화조<br><span style="font-size:10px;opacity:0.9;">2m × 1.5m</span></div>`
  }

  /* ── 농막 회전 변경 시 아이콘 갱신 ───────────────────────────────────── */
  useEffect(() => {
    if (!hutMarkerRef.current || !getL()) return
    const icon = getL().divIcon({
      html: buildHutIconHtml(hutW, hutD, rotation),
      className: 'layout-marker',
      iconAnchor: [36, 24],
    })
    hutMarkerRef.current.setIcon(icon)
  }, [rotation, hutW, hutD])

  /* ── 지번 토글 ────────────────────────────────────────────────────────── */
  const toggleJibun = useCallback(() => {
    if (!leafletMapRef.current || !getL()) return
    if (jibunMarkerRef.current) {
      jibunMarkerRef.current.remove()
      jibunMarkerRef.current = null
      setJibunOn(false)
    } else {
      if (parcel.jibun) {
        const center: [number, number] = parcel.centroid
          ? [parcel.centroid.lat, parcel.centroid.lon]
          : [36.3748, 127.3445]
        const icon = getL().divIcon({
          html: `<div style="
            background:rgba(220,38,38,0.9);
            color:#fff;
            padding:3px 10px;
            border-radius:4px;
            font-size:12px;
            font-weight:700;
            white-space:nowrap;
            box-shadow:0 2px 6px rgba(0,0,0,0.3);
            border:1.5px solid #fff;
            pointer-events:none;
          ">${parcel.jibun}</div>`,
          className: '',
          iconAnchor: [0, 0],
        })
        const marker = getL().marker(center, { icon, interactive: false })
        marker.addTo(leafletMapRef.current)
        jibunMarkerRef.current = marker
        setJibunOn(true)
      }
    }
  }, [parcel])


  /* ── VWorld 지적도 타일 토글 ────────────────────────────────────────────── */
  const toggleCadastral = useCallback(() => {
    if (!leafletMapRef.current || !getL()) return
    if (cadastralLayerRef.current) {
      cadastralLayerRef.current.remove()
      cadastralLayerRef.current = null
      setCadastralOn(false)
    } else {
      const key = vworldKeyRef.current  // ref에서 직접 읽기
      const tileUrl = key
        ? `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_BUBUN/default/EPSG:900913/{z}/{y}/{x}.png`
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      const layer = getL().tileLayer(tileUrl, {
        attribution: key ? '© VWorld 연속지적도' : '© Esri 위성사진',
        maxZoom: 19, minZoom: 7, tileSize: 256, opacity: 1.0, zIndex: 400,
      })
      layer.addTo(leafletMapRef.current)
      cadastralLayerRef.current = layer
      setCadastralOn(true)
    }
  }, [])

  /* ── 위성사진 토글 ───────────────────────────────────────────────────── */
  const toggleSatellite = useCallback(() => {
    if (!leafletMapRef.current || !getL()) return
    if (satelliteLayerRef.current) {
      satelliteLayerRef.current.remove()
      satelliteLayerRef.current = null
      if (baseLayerRef.current) baseLayerRef.current.addTo(leafletMapRef.current)
      setSatelliteOn(false)
    } else {
      baseLayerRef.current?.remove()
      const layer = getL().tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri', maxZoom: 20 }
      )
      layer.addTo(leafletMapRef.current)
      satelliteLayerRef.current = layer
      setSatelliteOn(true)
    }
  }, [])

  /* ── 이격거리 계산 ────────────────────────────────────────────────────── */
  const getDistance = (): number => {
    if (!hutPos || !septicPos) return 0
    const dLat = (hutPos[0] - septicPos[0]) * 111320
    const dLng = (hutPos[1] - septicPos[1]) * 111320 * Math.cos(hutPos[0] * Math.PI / 180)
    return Math.sqrt(dLat * dLat + dLng * dLng)
  }

  const distance = getDistance()
  const distOk = distance >= 2.0

  /* ── 배치 확정 ────────────────────────────────────────────────────────── */
  const handleConfirm = () => {
    if (!hutPos || !septicPos) return
    onConfirm({
      hut_center_wgs84: hutPos,
      septic_center_wgs84: septicPos,
      hut_rotation_deg: rotation,
      placement_note: `농막: ${hutPos[0].toFixed(6)},${hutPos[1].toFixed(6)} / 정화조: ${septicPos[0].toFixed(6)},${septicPos[1].toFixed(6)} / 이격: ${distance.toFixed(1)}m / 농막회전: ${rotation}°`,
    })
  }

  /* ── 렌더 ────────────────────────────────────────────────────────────── */
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '12px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 920,
        maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}>

        {/* ── 헤더 ── */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #1E40AF 0%, #1D4ED8 100%)',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
              🏗️ 농막 · 정화조 배치 미리보기
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 3 }}>
              📍 {parcel.jibun || '선택된 토지'} {parcel.area_m2 ? `· ${parcel.area_m2}㎡` : ''} — 마커를 드래그하여 배치 위치를 조정하세요
            </div>
          </div>
          <button onClick={onCancel} style={{
            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff', fontSize: 18, cursor: 'pointer',
            padding: '4px 10px', borderRadius: 8, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* ── 툴바 ── */}
        <div style={{
          padding: '8px 16px', borderBottom: '1px solid #F1F5F9',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#F8FAFC',
        }}>

          {/* 지번 표시 토글 */}
          <button onClick={toggleJibun} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
            border: jibunOn ? '1.5px solid #DC2626' : '1.5px solid #CBD5E1',
            background: jibunOn ? '#FEF2F2' : '#fff',
            color: jibunOn ? '#DC2626' : '#64748B',
          }}>
            🔢 지번 표시
            <span style={{
              display: 'inline-block', width: 28, height: 15, borderRadius: 8,
              background: jibunOn ? '#DC2626' : '#CBD5E1',
              position: 'relative', transition: 'background 0.2s', marginLeft: 4,
            }}>
              <span style={{
                position: 'absolute', top: 1.5,
                left: jibunOn ? 15 : 2,
                width: 11, height: 11, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
              }} />
            </span>
          </button>

          {/* VWorld 지적도 경계선 토글 */}
          <button onClick={toggleCadastral}
            title="VWorld 연속지적도 경계선 (OSM 위에 오버레이)"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s',
              border: cadastralOn ? '1.5px solid #166534' : '1.5px solid #CBD5E1',
              background: cadastralOn ? '#DCFCE7' : '#fff',
              color: cadastralOn ? '#166534' : '#64748B',
            }}>
            {cadastralOn ? '🗂️ 지적도' : '🗺️ 지적도'}
            <span style={{
              display: 'inline-block', width: 28, height: 15, borderRadius: 8,
              background: cadastralOn ? '#166534' : '#CBD5E1',
              position: 'relative', transition: 'background 0.2s', marginLeft: 4,
            }}>
              <span style={{
                position: 'absolute', top: 1.5,
                left: cadastralOn ? 15 : 2,
                width: 11, height: 11, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
              }} />
            </span>
          </button>

          {/* 위성사진 토글 */}
          <button onClick={toggleSatellite} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
            border: satelliteOn ? '1.5px solid #1D4ED8' : '1.5px solid #CBD5E1',
            background: satelliteOn ? '#EFF6FF' : '#fff',
            color: satelliteOn ? '#1D4ED8' : '#64748B',
          }}>
            {satelliteOn ? '🛰️ 위성' : '🗺️ 지도'}
            <span style={{
              display: 'inline-block', width: 28, height: 15, borderRadius: 8,
              background: satelliteOn ? '#1D4ED8' : '#CBD5E1',
              position: 'relative', transition: 'background 0.2s', marginLeft: 4,
            }}>
              <span style={{
                position: 'absolute', top: 1.5,
                left: satelliteOn ? 15 : 2,
                width: 11, height: 11, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
              }} />
            </span>
          </button>

          {/* 농막 회전 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>🔄 농막 회전</span>
            <input type="range" min={0} max={359} value={rotation}
              onChange={e => setRotation(Number(e.target.value))}
              style={{ width: 90, accentColor: '#1E40AF' }}
            />
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#1E40AF',
              minWidth: 38, background: '#EFF6FF', borderRadius: 4,
              padding: '2px 6px', textAlign: 'center',
            }}>
              {rotation}°
            </span>
          </div>

          {/* 이격거리 */}
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderRadius: 20,
            background: distOk ? '#DCFCE7' : '#FEE2E2',
            border: `1.5px solid ${distOk ? '#16A34A' : '#DC2626'}`,
          }}>
            <span style={{ fontSize: 13 }}>{distOk ? '✅' : '⚠️'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: distOk ? '#15803D' : '#DC2626' }}>
              이격거리 {distance.toFixed(1)}m
              {!distOk && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>(2m 이상 필요)</span>}
            </span>
          </div>
        </div>

        {/* ── 지도 영역 ── */}
        <div style={{ flex: 1, position: 'relative', minHeight: 380 }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 380 }} />

          {/* 로딩 오버레이 */}
          {!ready && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(248,250,252,0.95)',
            }}>
              <div style={{ textAlign: 'center', color: '#64748B' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>지도 불러오는 중...</div>
              </div>
            </div>
          )}

          {/* 사용 안내 레이블 */}
          {ready && (
            <div style={{
              position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              padding: '5px 14px', borderRadius: 20, fontSize: 11,
              pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap',
            }}>
              🏠 농막 · ⚙️ 정화조 마커를 드래그하여 배치를 조정하세요
            </div>
          )}
        </div>

        {/* ── 범례 ── */}
        <div style={{
          padding: '8px 16px', borderTop: '1px solid #F1F5F9',
          background: '#F8FAFC', display: 'flex', gap: 16, flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569' }}>
            <span style={{
              display: 'inline-block', width: 20, height: 3,
              background: '#DC2626', borderRadius: 2, borderTop: '2px dashed #DC2626',
            }} />
            <span>토지 경계</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569' }}>
            <span style={{ width: 12, height: 12, background: '#1E40AF', borderRadius: 2, display: 'inline-block' }} />
            농막 ({hutW}m×{hutD}m)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569' }}>
            <span style={{ width: 12, height: 12, background: '#D97706', borderRadius: 2, display: 'inline-block' }} />
            정화조 (2m×1.5m)
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
            © OpenStreetMap contributors
          </div>
        </div>

        {/* ── 푸터 ── */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#fff',
        }}>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            {hutPos && septicPos
              ? `농막 ${hutPos[0].toFixed(5)}, ${hutPos[1].toFixed(5)}`
              : '위치를 드래그하여 설정하세요'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} style={{
              padding: '9px 22px', borderRadius: 8, border: '1.5px solid #CBD5E1',
              background: '#fff', color: '#64748B', fontWeight: 600,
              cursor: 'pointer', fontSize: 14,
            }}>
              취소
            </button>
            <button
              onClick={handleConfirm}
              disabled={!ready || !distOk}
              style={{
                padding: '9px 26px', borderRadius: 8, border: 'none',
                background: ready && distOk ? '#1E40AF' : '#CBD5E1',
                color: '#fff', fontWeight: 700,
                cursor: ready && distOk ? 'pointer' : 'not-allowed',
                fontSize: 14, transition: 'background 0.2s',
              }}
            >
              ✅ 이 위치로 배치 확정
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
