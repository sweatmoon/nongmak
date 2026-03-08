/**
 * MapSelector.tsx
 * VWorld 연속지적도 기반 필지 선택 컴포넌트
 *
 * 원칙:
 * 1. 지도 로드 즉시 연속지적도(LP_PA_CBND_BUBUN) + 지번(LP_PA_CBND_JIBUN) 자동 ON
 * 2. 주소 검색 = 지도 위치 이동만 (필지 자동 선택 X)
 * 3. 사용자가 지도에서 직접 클릭한 필지 polygon = 실제 농막 설치 대상 토지
 *
 * 타이밍 해결:
 * - vworldKey를 useRef로도 관리 → 클로저 캡처 문제 없음
 * - 지도 초기화 완료 직후 레이어 추가 (setTimeout 0ms)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ParcelInfo, fetchParcelByCoord } from './api'

/* ── 카카오 Maps 타입 ──────────────────────────────────────────────────────── */
declare global {
  interface Window {
    __kakaoMapsReady: boolean
    __kakaoMapsError: boolean
    kakao: {
      maps: {
        load: (cb: () => void) => void
        LatLng: new (lat: number, lng: number) => KakaoLatLng
        Map: new (el: HTMLElement, opts: object) => KakaoMap
        Marker: new (opts: object) => KakaoMarker
        Polyline: new (opts: object) => KakaoPolyline
        Polygon: new (opts: object) => KakaoPolygon
        CustomOverlay: new (opts: object) => KakaoOverlay
        event: {
          addListener: (target: object, type: string, cb: (...a: unknown[]) => void) => void
          removeListener: (target: object, type: string, cb: (...a: unknown[]) => void) => void
        }
        services: {
          Geocoder: new () => KakaoGeocoder
          Status: { OK: string }
        }
        MapTypeId: { HYBRID: string; ROADMAP: string }
      }
    }
    daum: {
      Postcode: new (opts: {
        oncomplete: (data: DaumPostcodeResult) => void
        onclose?: () => void
        width?: string
        height?: string
      }) => { open: () => void; embed: (el: HTMLElement) => void }
    }
    __kakaoSdkStatus?: string
    L?: LeafletStatic
  }
}

interface KakaoLatLng { getLat(): number; getLng(): number }
interface KakaoMap {
  setCenter(ll: KakaoLatLng): void
  getCenter(): KakaoLatLng
  setLevel(n: number): void
  panTo(ll: KakaoLatLng): void
}
interface KakaoMarker { setMap(m: KakaoMap | null): void; setPosition(ll: KakaoLatLng): void }
interface KakaoPolyline { setMap(m: KakaoMap | null): void }
interface KakaoPolygon { setMap(m: KakaoMap | null): void }
interface KakaoOverlay { setMap(m: KakaoMap | null): void }
interface KakaoGeocoder {
  addressSearch(addr: string, cb: (result: KakaoGeoResult[], status: string) => void): void
}
interface KakaoGeoResult { x: string; y: string; address_name: string }
interface DaumPostcodeResult {
  address: string; jibunAddress: string; roadAddress: string; zonecode: string
}

/* ── Leaflet 타입 ─────────────────────────────────────────────────────────── */
interface LeafletLatLng { lat: number; lng: number }
interface LeafletMap {
  setView(ll: [number, number], zoom: number): void
  on(ev: string, cb: (e: { latlng: LeafletLatLng }) => void): void
  panTo(ll: [number, number]): void
  fitBounds(bounds: [[number,number],[number,number]], opts?: object): void
  getZoom(): number
  setZoom(z: number): void
  invalidateSize(): void
}
interface LeafletLayer { addTo(m: LeafletMap): LeafletLayer; remove(): void; on(event: string, fn: () => void): LeafletLayer }
interface LeafletStatic {
  map(el: HTMLElement, opts: object): LeafletMap
  tileLayer(url: string, opts: object): LeafletLayer
  marker(ll: [number, number], opts?: object): LeafletLayer
  polygon(lls: [number, number][], opts: object): LeafletLayer & {
    getBounds(): { getSouthWest(): LeafletLatLng; getNorthEast(): LeafletLatLng }
  }
  divIcon(opts: object): object
  DomUtil: { create(tag: string, cls: string): HTMLElement }
}

/* ── Props ────────────────────────────────────────────────────────────────── */
interface MapSelectorProps {
  onSelect: (parcel: ParcelInfo, address: string) => void
  onClose: () => void
  initialAddress?: string
}

/* ── SDK 로드 유틸 ─────────────────────────────────────────────────────────── */
function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.id = id
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load: ${src}`))
    document.head.appendChild(s)
  })
}

async function ensureLeaflet(): Promise<boolean> {
  if (window.L) return true
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link')
    link.id = 'leaflet-css'; link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
  }
  try {
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js')
    return !!window.L
  } catch { return false }
}

/* ── 컴포넌트 ──────────────────────────────────────────────────────────────── */
type MapEngine = 'kakao' | 'leaflet' | 'loading' | 'failed'

export default function MapSelector({ onSelect, onClose, initialAddress }: MapSelectorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Kakao 참조
  const kakaoMapRef = useRef<KakaoMap | null>(null)
  const kakaoPolygonRef = useRef<KakaoPolygon | null>(null)
  const kakaoOverlayRef = useRef<KakaoOverlay | null>(null)

  // Leaflet 참조
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const leafletParcelLayersRef = useRef<LeafletLayer[]>([])
  const cadastralLayerRef = useRef<LeafletLayer | null>(null)
  const jibunLayerRef = useRef<LeafletLayer | null>(null)

  // vworldKey를 ref로도 관리 → useCallback 클로저 캡처 문제 해결
  const vworldKeyRef = useRef<string>('')

  const [mapEngine, setMapEngine] = useState<MapEngine>('loading')
  const [searchQuery, setSearchQuery] = useState(initialAddress || '')
  const [parcel, setParcel] = useState<ParcelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddrSearch, setShowAddrSearch] = useState(false)
  const [cadastralOn, setCadastralOn] = useState(false)
  const [jibunOn, setJibunOn] = useState(false)
  const [vworldKey, setVworldKey] = useState<string>('')
  const [vworldReady, setVworldReady] = useState<boolean | null>(null)
  const [dismissBanner, setDismissBanner] = useState(false)
  const [tileStatus, setTileStatus] = useState<'unknown' | 'ok' | 'fail'>('unknown')
  const addrEmbedRef = useRef<HTMLDivElement>(null)
  const initDoneRef = useRef(false)

  /* ── VWorld API 키 로드 ─────────────────────────────────────────────────── */
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE || '/api'
    fetch(`${apiBase}/vworld-key`)
      .then(r => r.json())
      .then(d => {
        const key = d.key || ''
        vworldKeyRef.current = key   // ← ref 즉시 업데이트
        setVworldKey(key)
        setVworldReady(!!key)
        // 이미 지도가 준비됐다면 즉시 레이어 추가
        if (key && leafletMapRef.current && window.L) {
          _addLayersNow(key)
        }
      })
      .catch(() => {
        setVworldReady(false)
        // VWorld 없으면 Esri 위성으로 폴백
        if (leafletMapRef.current && window.L) {
          _addEsriFallback()
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 레이어 추가 (ref 기반, 클로저 안전) ────────────────────────────────── */
  // VWorld WMTS 타일은 반드시 브라우저(한국 IP)에서 직접 호출해야 합니다.
  // 해외 서버(Railway/Render)를 통한 프록시는 VWorld IP 차단으로 동작하지 않습니다.
  // Leaflet TileLayer는 <img> 태그로 타일을 로드하므로 ERR_BLOCKED_BY_ORB가 발생하지 않습니다.
  function _addLayersNow(key: string) {
    const map = leafletMapRef.current
    const L = window.L
    if (!map || !L) return

    // 연속지적도 (브라우저에서 VWorld 직접 호출)
    if (!cadastralLayerRef.current) {
      const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_BUBUN/default/EPSG:900913/{z}/{y}/{x}.png`
      const layer = L.tileLayer(url, {
        attribution: '© VWorld 연속지적도',
        maxZoom: 19, minZoom: 7,
        tileSize: 256, opacity: 1.0, zIndex: 400,
      } as object)

      // 타일 로드 성공/실패 감지 (Leaflet 이벤트 기반 - ORB 없음)
      let loadedCount = 0
      layer.on('tileload', () => {
        if (loadedCount === 0) {
          loadedCount++
          setTileStatus('ok')
        }
      })
      layer.on('tileerror', () => {
        setTileStatus('fail')
      })

      layer.addTo(map)
      cadastralLayerRef.current = layer
      setCadastralOn(true)
    }

    // 지번 레이어 (브라우저에서 VWorld 직접 호출)
    if (!jibunLayerRef.current) {
      const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_JIBUN/default/EPSG:900913/{z}/{y}/{x}.png`
      const layer = L.tileLayer(url, {
        attribution: '© VWorld 지번',
        maxZoom: 19, minZoom: 14,
        tileSize: 256, opacity: 1.0, zIndex: 450,
      } as object)
      layer.addTo(map)
      jibunLayerRef.current = layer
      setJibunOn(true)
    }
  }

  // _testTileLoad: new Image()로 VWorld를 직접 호출하면 ERR_BLOCKED_BY_ORB 발생
  // Leaflet tileload/tileerror 이벤트로 대체했으므로 이 함수는 더 이상 사용하지 않음
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _testTileLoad(_key: string) { /* deprecated */ }

  function _addEsriFallback() {
    const map = leafletMapRef.current
    const L = window.L
    if (!map || !L || cadastralLayerRef.current) return
    const layer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri 위성사진', maxZoom: 19, zIndex: 400 } as object
    )
    layer.addTo(map)
    cadastralLayerRef.current = layer
    setCadastralOn(true)
  }

  /* ── 연속지적도 토글 ─────────────────────────────────────────────────────── */
  const toggleCadastral = useCallback(() => {
    const map = leafletMapRef.current
    const L = window.L
    if (!map || !L) return

    if (cadastralLayerRef.current) {
      cadastralLayerRef.current.remove()
      cadastralLayerRef.current = null
      setCadastralOn(false)
    } else {
      const key = vworldKeyRef.current  // ref에서 직접 읽기
      if (key) {
        const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_BUBUN/default/EPSG:900913/{z}/{y}/{x}.png`
        const layer = L.tileLayer(url, {
          attribution: '© VWorld 연속지적도',
          maxZoom: 19, minZoom: 7,
          tileSize: 256, opacity: 1.0, zIndex: 400,
        } as object)
        let loadedCount = 0
        layer.on('tileload', () => { if (loadedCount === 0) { loadedCount++; setTileStatus('ok') } })
        layer.on('tileerror', () => setTileStatus('fail'))
        layer.addTo(map)
        cadastralLayerRef.current = layer
        setCadastralOn(true)
      } else {
        _addEsriFallback()
      }
    }
  }, [])

  /* ── 지번 토글 ──────────────────────────────────────────────────────────── */
  const toggleJibun = useCallback(() => {
    const map = leafletMapRef.current
    const L = window.L
    if (!map || !L) return

    if (jibunLayerRef.current) {
      jibunLayerRef.current.remove()
      jibunLayerRef.current = null
      setJibunOn(false)
    } else {
      const key = vworldKeyRef.current
      if (!key) return
      const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_JIBUN/default/EPSG:900913/{z}/{y}/{x}.png`
      const layer = L.tileLayer(url, {
        attribution: '© VWorld 지번',
        maxZoom: 19, minZoom: 14,
        tileSize: 256, opacity: 1.0, zIndex: 450,
      } as object)
      layer.addTo(map)
      jibunLayerRef.current = layer
      setJibunOn(true)
    }
  }, [])

  /* ── 카카오 지도 초기화 ─────────────────────────────────────────────────── */
  const initKakaoMap = useCallback(() => {
    if (!mapContainerRef.current || !window.kakao?.maps?.Map) return
    try {
      const center = new window.kakao.maps.LatLng(36.3748, 127.3445)
      const map = new window.kakao.maps.Map(mapContainerRef.current, { center, level: 4 })
      kakaoMapRef.current = map
      setMapEngine('kakao')

      window.kakao.maps.event.addListener(map, 'click', async (e: unknown) => {
        const ev = e as { latLng: KakaoLatLng }
        await loadParcel(ev.latLng.getLng(), ev.latLng.getLat())
      })

      if (initialAddress) moveToAddressKakao(initialAddress)
    } catch {
      initLeafletMap()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Leaflet 지도 초기화 ────────────────────────────────────────────────── */
  const initLeafletMap = useCallback(async () => {
    const ok = await ensureLeaflet()
    if (!ok || !mapContainerRef.current || !window.L) { setMapEngine('failed'); return }

    try {
      mapContainerRef.current.innerHTML = ''
      const L = window.L
      const map = L.map(mapContainerRef.current, {
        center: [36.3748, 127.3445], zoom: 16,
      } as object)

      // ── 베이스 레이어: OSM ──
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      } as object).addTo(map)

      leafletMapRef.current = map
      setMapEngine('leaflet')

      // ── 지도 초기화 직후 VWorld 레이어 추가 ──
      // vworldKeyRef가 이미 채워져 있으면 즉시, 아니면 fetch 완료 후 자동 실행
      setTimeout(() => {
        const key = vworldKeyRef.current
        if (key) {
          _addLayersNow(key)
        }
        // key가 없으면 fetch 완료 시 _addLayersNow or _addEsriFallback 호출됨
      }, 100)

      // 클릭 → 필지 조회
      map.on('click', async (e: { latlng: LeafletLatLng }) => {
        await loadParcel(e.latlng.lng, e.latlng.lat)
      })

      // initialAddress가 있으면 위치 이동만
      if (initialAddress) await moveToAddressNominatim(initialAddress, false)

    } catch { setMapEngine('failed') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 주소 → 지도 이동 (카카오) ─────────────────────────────────────────── */
  const moveToAddressKakao = (query: string) => {
    if (!query.trim() || !window.kakao?.maps?.services) return
    const geocoder = new window.kakao.maps.services.Geocoder()
    geocoder.addressSearch(query, (results, status) => {
      if (status === window.kakao.maps.services.Status.OK && results[0]) {
        const lon = parseFloat(results[0].x), lat = parseFloat(results[0].y)
        kakaoMapRef.current?.setCenter(new window.kakao.maps.LatLng(lat, lon))
        kakaoMapRef.current?.setLevel(3)
      } else {
        setError('주소를 찾을 수 없습니다. 지도에서 직접 클릭하여 필지를 선택해주세요.')
      }
    })
  }

  /* ── 주소 → 지도 이동 (Nominatim) ──────────────────────────────────────── */
  const moveToAddressNominatim = async (query: string, autoSelect = false) => {
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ko`
      )
      const data = await res.json()
      if (data[0]) {
        const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon)
        leafletMapRef.current?.setView([lat, lon], 17)
        if (autoSelect) await loadParcel(lon, lat)
      } else {
        setError('주소를 찾을 수 없습니다. 지도에서 직접 클릭하여 필지를 선택해주세요.')
      }
    } catch {
      setError('주소 검색에 실패했습니다.')
    } finally { setLoading(false) }
  }

  /* ── 검색 핸들러 ────────────────────────────────────────────────────────── */
  const handleSearch = () => {
    setError(null)
    if (mapEngine === 'kakao') moveToAddressKakao(searchQuery)
    else moveToAddressNominatim(searchQuery, false)
  }

  /* ── 필지 조회 (클릭 시 호출) ───────────────────────────────────────────── */
  const loadParcel = useCallback(async (lon: number, lat: number) => {
    setLoading(true); setError(null)
    try {
      const data = await fetchParcelByCoord(lon, lat)
      setParcel(data)
      drawParcelPolygon(data, lon, lat)
    } catch {
      setError('필지 정보를 조회할 수 없습니다. 다른 위치를 클릭해보세요.')
    } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEngine])

  /* ── 선택된 필지 polygon 그리기 ─────────────────────────────────────────── */
  const drawParcelPolygon = (p: ParcelInfo, clickLon: number, clickLat: number) => {
    const coords = p.polygon_wgs84
    const hasPolygon = coords && coords.length >= 3

    // 카카오 모드
    if (kakaoMapRef.current && window.kakao?.maps) {
      kakaoPolygonRef.current?.setMap(null)
      kakaoOverlayRef.current?.setMap(null)

      if (hasPolygon) {
        const path = coords!.map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng))
        const polygon = new window.kakao.maps.Polygon({
          path,
          strokeWeight: 3, strokeColor: '#DC2626', strokeOpacity: 1.0,
          fillColor: '#FEF2F2', fillOpacity: 0.25,
        })
        polygon.setMap(kakaoMapRef.current)
        kakaoPolygonRef.current = polygon
      }
      if (p.centroid) {
        const cl = new window.kakao.maps.LatLng(p.centroid.lat, p.centroid.lon)
        const overlay = new window.kakao.maps.CustomOverlay({
          position: cl,
          content: `<div style="background:rgba(220,38,38,0.9);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">✅ ${p.jibun || '선택된 필지'}</div>`,
          yAnchor: 1.5,
        })
        overlay.setMap(kakaoMapRef.current)
        kakaoOverlayRef.current = overlay
        kakaoMapRef.current.panTo(cl)
      }
      return
    }

    // Leaflet 모드
    if (leafletMapRef.current && window.L) {
      leafletParcelLayersRef.current.forEach(l => l.remove())
      leafletParcelLayersRef.current = []

      const L = window.L
      const centerLat = p.centroid?.lat ?? clickLat
      const centerLon = p.centroid?.lon ?? clickLon

      if (hasPolygon) {
        const lls = coords!.map(([lng, lat]) => [lat, lng] as [number, number])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const poly = (L.polygon(lls, {
          color: '#DC2626', weight: 3, opacity: 1.0,
          fillColor: '#FEF2F2', fillOpacity: 0.3,
        }) as any)
        poly.addTo(leafletMapRef.current)
        leafletParcelLayersRef.current.push(poly)

        const bounds = poly.getBounds()
        leafletMapRef.current.fitBounds(
          [[bounds.getSouthWest().lat, bounds.getSouthWest().lng],
           [bounds.getNorthEast().lat, bounds.getNorthEast().lng]],
          { padding: [40, 40] } as object
        )
      }

      if (p.jibun && p.centroid) {
        const icon = (window.L as unknown as { divIcon: (o: object) => object }).divIcon({
          html: `<div style="
            background:rgba(220,38,38,0.92);color:#fff;
            padding:5px 12px;border-radius:6px;font-size:12px;font-weight:700;
            white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid #fff;
          ">✅ ${p.jibun}</div>`,
          className: '',
          iconAnchor: [0, 0],
        })
        const jibunMarker = (window.L as unknown as {
          marker: (ll: [number,number], opts?: object) => LeafletLayer
        }).marker([p.centroid.lat, p.centroid.lon], { icon } as object)
        jibunMarker.addTo(leafletMapRef.current)
        leafletParcelLayersRef.current.push(jibunMarker)
      } else if (!hasPolygon) {
        const marker = L.marker([centerLat, centerLon], {} as object).addTo(leafletMapRef.current)
        leafletParcelLayersRef.current.push(marker)
        leafletMapRef.current.panTo([centerLat, centerLon])
      }
    }
  }

  /* ── 지도 엔진 선택 ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true

    const tryInit = () => {
      if (!mapContainerRef.current) return false
      if (window.__kakaoMapsError) { initLeafletMap(); return true }
      if (window.__kakaoMapsReady && window.kakao?.maps?.Map) {
        initKakaoMap(); return true
      }
      return false
    }

    if (tryInit()) return
    let waited = 0
    const timer = setInterval(() => {
      waited += 100
      if (tryInit()) { clearInterval(timer); return }
      if (waited >= 6000) { clearInterval(timer); initLeafletMap() }
    }, 100)
    return () => clearInterval(timer)
  }, [initKakaoMap, initLeafletMap])

  /* ── Daum Postcode embed ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!showAddrSearch || !addrEmbedRef.current || !window.daum) return
    const timer = setTimeout(() => {
      if (!addrEmbedRef.current) return
      try {
        new window.daum.Postcode({
          oncomplete: (data) => {
            const addr = data.jibunAddress || data.address
            setSearchQuery(addr)
            setShowAddrSearch(false)
            if (mapEngine === 'kakao') moveToAddressKakao(addr)
            else moveToAddressNominatim(addr, false)
          },
          onclose: () => setShowAddrSearch(false),
          width: '100%', height: '100%',
        }).embed(addrEmbedRef.current)
      } catch { setShowAddrSearch(false) }
    }, 100)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddrSearch])

  /* ── 확인 ───────────────────────────────────────────────────────────────── */
  const handleConfirm = () => {
    if (!parcel) return
    onSelect(parcel, parcel.jibun || searchQuery || '')
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────────── */
  const engineLabel = mapEngine === 'kakao' ? '카카오 지도'
    : mapEngine === 'leaflet' ? 'OpenStreetMap'
    : mapEngine === 'loading' ? '지도 로딩 중...'
    : '지도 로드 실패'

  return (
    <div className="map-modal-overlay" onClick={onClose}>
      <div className="map-modal" onClick={e => e.stopPropagation()}>

        {/* ── 헤더 ── */}
        <div className="map-modal-header">
          <div className="map-modal-title">
            <span>🗺️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>지도에서 토지 선택</div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '1px' }}>
                {engineLabel} · VWorld 연속지적도 오버레이
              </div>
            </div>
          </div>
          <button className="map-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="map-modal-body">

          {/* ── 핵심 안내 배너 ── */}
          <div style={{
            background: 'linear-gradient(135deg, #1E40AF 0%, #1D4ED8 100%)',
            borderRadius: 8, padding: '10px 14px', margin: '0 0 6px 0', color: '#fff',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>📌 이용 방법</div>
            <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.92 }}>
              1. 주소를 검색하면 <strong>지도 위치가 이동</strong>합니다 (필지 자동 선택 ✕)<br />
              2. <strong>연속지적도 경계</strong>를 확인하면서 설치 대상 토지를 찾으세요<br />
              3. 설치할 <strong>필지를 직접 클릭</strong>하면 그 polygon이 실제 대지 경계가 됩니다
            </div>
          </div>

          {/* ── 검색바 ── */}
          <div className="map-search-bar">
            <input
              type="text"
              className="map-search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="주소 또는 지번 입력 → 검색하면 지도 위치만 이동"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className="map-search-btn" onClick={handleSearch}>지도 이동</button>
            {mapEngine === 'kakao' && (
              <button className="map-postcode-btn" onClick={() => setShowAddrSearch(v => !v)}>
                📮 우편번호
              </button>
            )}
          </div>

          {/* ── Leaflet 레이어 컨트롤 ── */}
          {mapEngine === 'leaflet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0', flexWrap: 'wrap' }}>

              {/* 연속지적도 토글 */}
              <button
                onClick={toggleCadastral}
                title="연속지적도 (VWorld LP_PA_CBND_BUBUN)"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', borderRadius: 6, fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  border: cadastralOn ? '1.5px solid #166534' : '1.5px solid #CBD5E1',
                  background: cadastralOn ? '#DCFCE7' : '#F8FAFC',
                  color: cadastralOn ? '#166534' : '#64748B',
                }}
              >
                <span style={{ fontSize: 13 }}>🗂️</span>
                연속지적도
                <span style={{
                  display: 'inline-block', width: 28, height: 15, borderRadius: 8,
                  background: cadastralOn ? '#166534' : '#CBD5E1',
                  position: 'relative', transition: 'background 0.2s', marginLeft: 2,
                }}>
                  <span style={{
                    position: 'absolute', top: 1.5, width: 11, height: 11, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                    left: cadastralOn ? 15 : 2,
                  }} />
                </span>
              </button>

              {/* 지번 토글 */}
              <button
                onClick={toggleJibun}
                title="지번 표시 (줌 14 이상)"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', borderRadius: 6, fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  border: jibunOn ? '1.5px solid #92400E' : '1.5px solid #CBD5E1',
                  background: jibunOn ? '#FEF3C7' : '#F8FAFC',
                  color: jibunOn ? '#92400E' : '#64748B',
                  opacity: !vworldKey ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 13 }}>🔢</span>
                지번
                <span style={{
                  display: 'inline-block', width: 28, height: 15, borderRadius: 8,
                  background: jibunOn ? '#D97706' : '#CBD5E1',
                  position: 'relative', transition: 'background 0.2s', marginLeft: 2,
                }}>
                  <span style={{
                    position: 'absolute', top: 1.5, width: 11, height: 11, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                    left: jibunOn ? 15 : 2,
                  }} />
                </span>
              </button>

              {/* VWorld 상태 */}
              {vworldReady === null && (
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>⏳ VWorld 연결 중…</span>
              )}
              {vworldReady === true && tileStatus === 'ok' && (
                <span style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>
                  ✅ VWorld 연속지적도 표시 중
                </span>
              )}
              {vworldReady === true && tileStatus === 'fail' && (
                <span style={{ fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>
                  ⚠️ VWorld 타일 로드 실패 — <a
                    href="https://api.vworld.kr/console/apikey/list"
                    target="_blank" rel="noreferrer"
                    style={{ color: '#DC2626', textDecoration: 'underline' }}
                  >API 콘솔</a>에서 서비스 URL 등록 확인 필요
                </span>
              )}
              {vworldReady === true && tileStatus === 'unknown' && (
                <span style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>
                  ✅ VWorld 연속지적도 연결됨
                </span>
              )}
              {vworldReady === false && (
                <span style={{ fontSize: '11px', color: '#DC2626' }}>
                  ⚠️ VWorld 미연결 (Esri 위성으로 대체)
                </span>
              )}
            </div>
          )}

          {/* ── OSM 폴백 배너 ── */}
          {mapEngine === 'leaflet' && !dismissBanner && (
            <div style={{
              background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 6,
              padding: '5px 10px', fontSize: '11px', color: '#7B5700', margin: '2px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>💡 카카오 지도 미연결 → OpenStreetMap + VWorld 연속지적도 오버레이 사용 중</span>
              <button onClick={() => setDismissBanner(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7B5700', fontSize: 14 }}>✕</button>
            </div>
          )}

          {/* ── VWorld 타일 실패 안내 배너 ── */}
          {tileStatus === 'fail' && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
              padding: '8px 12px', fontSize: '11px', color: '#991B1B', margin: '2px 0', lineHeight: 1.7,
            }}>
              <strong>⚠️ VWorld 연속지적도 타일이 로드되지 않습니다.</strong><br />
              해결 방법: <a href="https://api.vworld.kr/console/apikey/list" target="_blank" rel="noreferrer"
                style={{ color: '#1D4ED8', fontWeight: 700, textDecoration: 'underline' }}>
                VWorld API 콘솔
              </a>에서 API키 설정 → <strong>서비스 URL</strong>에 현재 주소를 추가해야 합니다.<br />
              현재 페이지 주소: <code style={{ background: '#FEE2E2', padding: '1px 4px', borderRadius: 3 }}>{window.location.origin}</code>
            </div>
          )}
          {mapEngine === 'failed' && (
            <div style={{ background: '#FEE2E2', border: '1px solid #F87171', borderRadius: 6,
              padding: '8px 12px', fontSize: '12px', color: '#991B1B', margin: '4px 0' }}>
              ❌ 지도를 불러올 수 없습니다.
            </div>
          )}

          {/* Daum 주소검색 */}
          {showAddrSearch && (
            <div className="map-postcode-embed">
              {window.daum
                ? <div ref={addrEmbedRef} style={{ width: '100%', height: '100%' }} />
                : <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8' }}>주소검색 로딩 중...</div>
              }
            </div>
          )}

          {/* ── 지도 캔버스 ── */}
          <div className="map-container-wrap">
            <div ref={mapContainerRef} className="map-canvas" />

            {/* 로딩 오버레이 */}
            {(loading || mapEngine === 'loading') && (
              <div className="map-loading-overlay">
                <div className="map-loading-spinner" />
                <span>{loading ? '필지 정보 조회 중...' : '지도 로딩 중...'}</span>
              </div>
            )}

            {/* 클릭 안내 */}
            {(mapEngine === 'kakao' || mapEngine === 'leaflet') && !parcel && !loading && (
              <div className="map-hint-overlay">
                🖱️ 설치할 토지의 필지 경계를 클릭하여 선택하세요
              </div>
            )}

            {/* 선택 완료 표시 */}
            {parcel && !loading && (
              <div style={{
                position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(22,101,52,0.9)', color: '#fff',
                padding: '5px 14px', borderRadius: 20, fontSize: '11px', fontWeight: 700,
                pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap',
              }}>
                ✅ 필지 선택됨 — 아래 정보 확인 후 "이 토지 선택" 클릭
              </div>
            )}
          </div>

          {error && <div className="map-error-box">⚠️ {error}</div>}

          {/* ── 선택된 필지 정보 ── */}
          {parcel && (
            <div className="map-parcel-info">
              <div className="map-parcel-title">
                <span>📍</span>
                <span>선택된 토지 (농막 설치 대상 필지)</span>
                {parcel.is_mock && (
                  <span className="map-mock-badge">⚠️ 샘플 데이터</span>
                )}
              </div>
              {parcel.is_mock && (
                <div style={{
                  background: '#FEF9C3', border: '1px solid #FDE047',
                  borderRadius: 6, padding: '6px 10px', margin: '4px 0',
                  fontSize: '11px', color: '#713F12', lineHeight: 1.5,
                }}>
                  ⚠️ VWorld API에서 실제 필지 데이터를 가져오지 못해 샘플 필지가 표시됩니다.<br />
                  실제 서비스 환경(한국 IP)에서는 클릭한 위치의 정확한 필지 polygon이 반환됩니다.
                </div>
              )}
              <div className="map-parcel-grid">
                <div className="map-parcel-item">
                  <span className="map-parcel-label">지번</span>
                  <span className="map-parcel-value">{parcel.jibun || '-'}</span>
                </div>
                <div className="map-parcel-item">
                  <span className="map-parcel-label">면적</span>
                  <span className="map-parcel-value">{parcel.area_m2 ? `${parcel.area_m2} ㎡` : '-'}</span>
                </div>
                <div className="map-parcel-item">
                  <span className="map-parcel-label">지목</span>
                  <span className="map-parcel-value">{parcel.jimok || '-'}</span>
                </div>
                <div className="map-parcel-item">
                  <span className="map-parcel-label">용도지역</span>
                  <span className="map-parcel-value">{parcel.yongdo || '-'}</span>
                </div>
                {parcel.polygon_wgs84 && parcel.polygon_wgs84.length > 0 && (
                  <div className="map-parcel-item" style={{ gridColumn: '1/-1' }}>
                    <span className="map-parcel-label">경계</span>
                    <span className="map-parcel-value" style={{ color: '#166534', fontWeight: 700 }}>
                      ✅ Polygon {parcel.polygon_wgs84.length}개 좌표 — 실제 배치도 기준으로 사용
                    </span>
                  </div>
                )}
              </div>
              <div style={{
                marginTop: 6, padding: '6px 10px',
                background: '#F0FDF4', borderRadius: 6,
                fontSize: '11px', color: '#166534', lineHeight: 1.5,
              }}>
                📌 <strong>선택한 필지의 경계가 실제 배치도 생성 기준이 됩니다.</strong><br />
                농막과 정화조는 이 polygon 내부에 자동 배치됩니다.
              </div>
            </div>
          )}
        </div>

        {/* ── 푸터 ── */}
        <div className="map-modal-footer">
          <button className="map-btn-cancel" onClick={onClose}>취소</button>
          <button
            className="map-btn-confirm"
            onClick={handleConfirm}
            disabled={!parcel}
          >
            {parcel ? '✅ 이 토지 선택 (배치도 기준으로 사용)' : '필지를 클릭하여 선택해주세요'}
          </button>
        </div>
      </div>
    </div>
  )
}
