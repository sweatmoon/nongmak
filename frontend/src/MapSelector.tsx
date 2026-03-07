/**
 * MapSelector.tsx
 * 카카오 지도 + VWorld 지적도 polygon 오버레이
 * 카카오 SDK 실패 시 → Leaflet(OSM) 폴백
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

/* ── Leaflet 타입 (폴백용 최소 정의) ─────────────────────────────────────── */
interface LeafletLatLng { lat: number; lng: number }
interface LeafletMap {
  setView(ll: [number, number], zoom: number): void
  on(ev: string, cb: (e: { latlng: LeafletLatLng }) => void): void
  panTo(ll: [number, number]): void
}
interface LeafletLayer { addTo(m: LeafletMap): LeafletLayer; remove(): void }
interface LeafletStatic {
  map(el: HTMLElement, opts: object): LeafletMap
  tileLayer(url: string, opts: object): LeafletLayer
  marker(ll: [number, number], opts?: object): LeafletLayer
  polygon(lls: [number, number][], opts: object): LeafletLayer
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
    s.src = src
    s.id = id
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load: ${src}`))
    document.head.appendChild(s)
  })
}

async function ensureLeaflet(): Promise<boolean> {
  if (window.L) return true
  // Leaflet CSS
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link')
    link.id = 'leaflet-css'
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
  }
  try {
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js')
    return !!window.L
  } catch {
    return false
  }
}

/* ── 컴포넌트 ──────────────────────────────────────────────────────────────── */
type MapEngine = 'kakao' | 'leaflet' | 'loading' | 'failed'

export default function MapSelector({ onSelect, onClose, initialAddress }: MapSelectorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Kakao 참조
  const kakaoMapRef = useRef<KakaoMap | null>(null)
  const kakaoMarkerRef = useRef<KakaoMarker | null>(null)
  const kakaoPolygonRef = useRef<KakaoPolygon | null>(null)
  const kakaoOverlayRef = useRef<KakaoOverlay | null>(null)

  // Leaflet 참조
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const leafletLayersRef = useRef<LeafletLayer[]>([])
  const leafletBaseRef = useRef<LeafletLayer | null>(null)
  const cadastralLayerRef = useRef<LeafletLayer | null>(null)
  const jibunLayerRef = useRef<LeafletLayer | null>(null)  // 지번 오버레이
  const jibunFallbackRef = useRef<LeafletLayer | null>(null) // 지번 폴백 마커

  const [mapEngine, setMapEngine] = useState<MapEngine>('loading')
  const [searchQuery, setSearchQuery] = useState(initialAddress || '')
  const [parcel, setParcel] = useState<ParcelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddrSearch, setShowAddrSearch] = useState(false)
  const [cadastralOn, setCadastralOn] = useState(false)
  const [jibunOn, setJibunOn] = useState(true)            // 지번 표시 토글 (기본 ON)
  const [vworldReady, setVworldReady] = useState<boolean | null>(null)
  const [vworldKey, setVworldKey] = useState<string>('')
  const [dismissKakaoBanner, setDismissKakaoBanner] = useState(false)
  const addrEmbedRef = useRef<HTMLDivElement>(null)
  const initDoneRef = useRef(false)

  // VWorld API 키 획득 → 브라우저 직접 WMTS 호출로 상태 확인
  useEffect(() => {
    fetch('/api/vworld-key')
      .then(r => r.json())
      .then(d => {
        const key = d.key || ''
        setVworldKey(key)
        if (!key) { setVworldReady(false); return }
        // 브라우저에서 직접 VWorld 타일 1장 요청해 키 활성 여부 확인
        const testUrl = `https://api.vworld.kr/req/wmts/1.0.0/${key}/LP_PA_CBND_BUBUN/default/EPSG:900913/10/420/868.png`
        fetch(testUrl, { mode: 'no-cors' })
          .then(() => setVworldReady(true))
          .catch(() => setVworldReady(true)) // no-cors면 opaque → 성공으로 간주
      })
      .catch(() => {
        // /api/vworld-key 실패 시 백엔드 status 체크 fallback
        fetch('/api/proxy/vworld-status')
          .then(r => r.json())
          .then(d => setVworldReady(d.status === 'active'))
          .catch(() => setVworldReady(false))
      })
  }, [])


  // 필지 선택 시 지번 마커는 drawParcelPolygon 내에서 처리
  // (이 useEffect는 더 이상 필요하지 않음)

  /* ── 지번 오버레이 ON (내부 헬퍼) ─────────────────────────────────────── */
  const enableJibunLayer = useCallback(() => {
    if (!leafletMapRef.current || !window.L) return
    // 이미 있으면 제거 후 재생성 (중복 방지)
    if (jibunLayerRef.current) {
      jibunLayerRef.current.remove()
      jibunLayerRef.current = null
    }
    if (vworldReady && vworldKey) {
      // VWorld WMTS 직접 URL (브라우저 → api.vworld.kr 직접 호출, CORS 허용)
      const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/LP_PA_CBND_JIBUN/default/EPSG:900913/{z}/{y}/{x}.png`
      const jibunLayer = window.L.tileLayer(
        tileUrl,
        {
          attribution: '© VWorld 지번',
          maxZoom: 19, minZoom: 14,  // 줌 14+ 에서만 표시 (가독성 확보)
          tileSize: 256,
          opacity: 1.0,
          zIndex: 450,  // 지적도 레이어보다 위
        } as object
      )
      jibunLayer.addTo(leafletMapRef.current)
      jibunLayerRef.current = jibunLayer
      setJibunOn(true)
    }
  }, [vworldReady, vworldKey])


  /* ── 카카오 지도 초기화 ────────────────────────────────────────────────── */
  const initKakaoMap = useCallback(() => {
    if (!mapContainerRef.current) {
      console.error('[Kakao] mapContainerRef가 null!')
      return
    }
    if (!window.kakao?.maps?.Map) {
      console.error('[Kakao] kakao.maps.Map 없음!')
      return
    }
    try {
      const center = new window.kakao.maps.LatLng(36.3748, 127.3445)
      const map = new window.kakao.maps.Map(mapContainerRef.current, { center, level: 5 })
      kakaoMapRef.current = map
      setMapEngine('kakao')
      console.log('[Kakao] 지도 초기화 성공!')

      window.kakao.maps.event.addListener(map, 'click', async (e: unknown) => {
        const ev = e as { latLng: KakaoLatLng }
        await loadParcel(ev.latLng.getLng(), ev.latLng.getLat())
      })

      if (initialAddress) searchAddressKakao(initialAddress)
    } catch (err) {
      console.error('[Kakao] initMap 오류:', err)
      initLeafletMap()
    }
  }, [])

  /* ── Leaflet 지도 초기화 ───────────────────────────────────────────────── */
  const initLeafletMap = useCallback(async () => {
    const ok = await ensureLeaflet()
    if (!ok || !mapContainerRef.current || !window.L) {
      setMapEngine('failed')
      return
    }
    try {
      mapContainerRef.current.innerHTML = ''
      const map = window.L.map(mapContainerRef.current, { center: [36.3748, 127.3445], zoom: 16 } as object)

      // 베이스 레이어: OSM
      const baseLayer = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        opacity: 1,
      }).addTo(map)
      leafletBaseRef.current = baseLayer

      leafletMapRef.current = map
      setMapEngine('leaflet')

      map.on('click', async (e: { latlng: LeafletLatLng }) => {
        await loadParcel(e.latlng.lng, e.latlng.lat)
      })

      // 지도 초기화 후 VWorld가 이미 준비된 상태라면 즉시 지번 레이어 ON
      // (vworldReady는 비동기로 세팅되므로, 이미 세팅된 경우 처리)
      setTimeout(() => {
        if (vworldReady === true && jibunLayerRef.current === null) {
          enableJibunLayer()
        }
      }, 300)
    } catch (err) {
      console.error('[Leaflet] initMap 오류:', err)
      setMapEngine('failed')
    }
  }, [vworldReady, enableJibunLayer])

  /* ── 지적도 토글 (OSM 배경 유지 + VWorld 오버레이 ON/OFF) ──────────────── */
  const toggleCadastral = useCallback(() => {
    if (!leafletMapRef.current || !window.L) return

    if (cadastralLayerRef.current) {
      // 끄기 → VWorld 지적도 레이어 제거 (OSM 배경은 항상 유지)
      cadastralLayerRef.current.remove()
      cadastralLayerRef.current = null
      setCadastralOn(false)
    } else {
      if (vworldReady && vworldKey) {
        // ✅ VWorld 활성화: 브라우저 직접 WMTS URL 사용 (백엔드 프록시 불필요)
        // LP_PA_CBND_BUBUN: 연속지적도 경계선 레이어 (배경 투명)
        const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/LP_PA_CBND_BUBUN/default/EPSG:900913/{z}/{y}/{x}.png`
        const overlayLayer = window.L.tileLayer(
          tileUrl,
          {
            attribution: '© VWorld 연속지적도',
            maxZoom: 19, minZoom: 7,
            tileSize: 256,
            opacity: 1.0,   // 완전 불투명 (배경은 OSM이 담당)
            zIndex: 400,    // OSM 위에 표시
          } as object
        )
        overlayLayer.addTo(leafletMapRef.current)
        cadastralLayerRef.current = overlayLayer
        setCadastralOn(true)
      } else {
        // ⏳ VWorld 키 없음: Esri 위성사진으로 대체
        const overlayLayer = window.L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: '© Esri 위성사진',
            maxZoom: 19,
            zIndex: 400,
          } as object
        )
        overlayLayer.addTo(leafletMapRef.current)
        cadastralLayerRef.current = overlayLayer
        setCadastralOn(true)
      }
    }
  }, [vworldReady, vworldKey])

  // VWorld 준비 완료 시 지번 레이어 자동 활성화
  useEffect(() => {
    if (vworldReady === true && leafletMapRef.current && window.L) {
      // 지번 레이어가 아직 없고 jibunOn 상태면 자동 생성
      if (!jibunLayerRef.current && jibunOn) {
        enableJibunLayer()
      }
    }
  }, [vworldReady, jibunOn, enableJibunLayer])

  /* ── 지번 오버레이 토글 ─────────────────────────────────────────────────── */
  const toggleJibun = useCallback(() => {
    if (!leafletMapRef.current || !window.L) return

    if (jibunLayerRef.current) {
      // 끄기
      jibunLayerRef.current.remove()
      jibunLayerRef.current = null
      if (jibunFallbackRef.current) {
        jibunFallbackRef.current.remove()
        jibunFallbackRef.current = null
      }
      setJibunOn(false)
    } else {
      if (vworldReady) {
        enableJibunLayer()
      } else {
        // VWorld 미활성화 시 → 선택된 필지 centroid에 지번 라벨 표시
        if (parcel?.jibun && parcel?.centroid) {
          const { lat, lon } = parcel.centroid
          const icon = (window.L as unknown as {
            divIcon: (o: object) => object
          }).divIcon({
            html: `<div style="background:rgba(255,255,255,0.92);border:1.5px solid #166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;color:#166534;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.15);">${parcel.jibun}</div>`,
            className: '',
            iconAnchor: [0, 0],
          })
          const marker = window.L.marker([lat, lon], { icon } as object)
          marker.addTo(leafletMapRef.current)
          jibunFallbackRef.current = marker
          setJibunOn(true)
        }
      }
    }
  }, [vworldReady, parcel, enableJibunLayer])

  /* ── 지도 엔진 선택 useEffect ──────────────────────────────────────────── */
  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true

    const tryInit = () => {
      // DOM ref가 아직 없으면 패스
      if (!mapContainerRef.current) return false

      // 에러 발생 시 바로 Leaflet
      if (window.__kakaoMapsError) {
        console.warn('[Map] 카카오 SDK onerror → Leaflet 폴백')
        initLeafletMap()
        return true
      }

      // __kakaoMapsReady 플래그 또는 kakao.maps.Map 직접 확인
      const kakaoOk = window.__kakaoMapsReady && window.kakao?.maps?.Map
      if (kakaoOk) {
        console.log('[Map] 카카오 SDK 준비 완료 → initKakaoMap')
        initKakaoMap()
        return true
      }

      return false
    }

    // 즉시 1회 시도
    if (tryInit()) return

    // 최대 6초 대기 (100ms 간격)
    let waited = 0
    const timer = setInterval(() => {
      waited += 100
      if (tryInit()) {
        clearInterval(timer)
        return
      }
      if (waited >= 6000) {
        clearInterval(timer)
        console.warn('[Map] 6초 타임아웃 → Leaflet 폴백')
        initLeafletMap()
      }
    }, 100)

    return () => clearInterval(timer)
  }, [initKakaoMap, initLeafletMap])

  /* ── 필지 조회 ─────────────────────────────────────────────────────────── */
  const loadParcel = useCallback(async (lon: number, lat: number) => {
    setLoading(true)
    setError(null)

    // 마커 표시
    if (mapEngine === 'kakao' && kakaoMapRef.current && window.kakao?.maps) {
      const ll = new window.kakao.maps.LatLng(lat, lon)
      if (!kakaoMarkerRef.current) {
        kakaoMarkerRef.current = new window.kakao.maps.Marker({ position: ll, map: kakaoMapRef.current })
      } else {
        kakaoMarkerRef.current.setPosition(ll)
        kakaoMarkerRef.current.setMap(kakaoMapRef.current)
      }
    }

    try {
      const data = await fetchParcelByCoord(lon, lat)
      setParcel(data)
      drawParcelPolygon(data, lon, lat)
    } catch {
      setError('필지 정보를 조회할 수 없습니다. 다른 위치를 선택해보세요.')
    } finally {
      setLoading(false)
    }
  }, [mapEngine])

  /* ── polygon 그리기 ─────────────────────────────────────────────────────── */
  const drawParcelPolygon = (p: ParcelInfo, clickLon: number, clickLat: number) => {
    const coords = p.polygon_wgs84
    const hasPolygon = coords && coords.length >= 3

    if (mapEngine === 'kakao' || kakaoMapRef.current) {
      // 카카오
      if (!kakaoMapRef.current || !window.kakao?.maps) return
      kakaoPolygonRef.current?.setMap(null)
      kakaoOverlayRef.current?.setMap(null)

      if (hasPolygon) {
        const path = coords!.map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng))
        const polygon = new window.kakao.maps.Polygon({
          path,
          strokeWeight: 2.5, strokeColor: '#166534', strokeOpacity: 0.9,
          fillColor: '#DCFCE7', fillOpacity: 0.0,
        })
        polygon.setMap(kakaoMapRef.current)
        kakaoPolygonRef.current = polygon
      }

      if (p.centroid) {
        const cl = new window.kakao.maps.LatLng(p.centroid.lat, p.centroid.lon)
        const overlay = new window.kakao.maps.CustomOverlay({
          position: cl,
          content: `<div style="background:rgba(22,101,52,0.85);color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;white-space:nowrap;">${p.jibun || '필지'}</div>`,
          yAnchor: 1.5,
        })
        overlay.setMap(kakaoMapRef.current)
        kakaoOverlayRef.current = overlay
        kakaoMapRef.current.panTo(cl)
      }
      return
    }

    if (leafletMapRef.current && window.L) {
      // Leaflet 기존 레이어 제거
      leafletLayersRef.current.forEach(l => l.remove())
      leafletLayersRef.current = []

      const L = window.L
      const centerLat = p.centroid?.lat ?? clickLat
      const centerLon = p.centroid?.lon ?? clickLon

      if (hasPolygon) {
        const lls = coords!.map(([lng, lat]) => [lat, lng] as [number, number])
        const poly = L.polygon(lls, {
          color: '#166534', weight: 2.5, opacity: 0.9,
          fillColor: '#DCFCE7', fillOpacity: 0.0,
        }).addTo(leafletMapRef.current)
        leafletLayersRef.current.push(poly)
      }

      // 지번 표시 마커 (항상 표시)
      if (p.jibun && p.centroid) {
        const centerLat2 = p.centroid.lat
        const centerLon2 = p.centroid.lon
        const icon = (window.L as unknown as { divIcon: (o: object) => object }).divIcon({
          html: `<div style="background:rgba(255,255,255,0.95);border:1.5px solid #166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;color:#166534;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.15);">${p.jibun}</div>`,
          className: '',
          iconAnchor: [0, 0],
        })
        const jibunMarker = (window.L as unknown as { marker: (ll: [number,number], opts?: object) => LeafletLayer }).marker([centerLat2, centerLon2], { icon } as object)
        jibunMarker.addTo(leafletMapRef.current)
        leafletLayersRef.current.push(jibunMarker)
      }

      // 마커
      const marker = L.marker([centerLat, centerLon], {} as object).addTo(leafletMapRef.current)
      leafletLayersRef.current.push(marker)
      leafletMapRef.current.panTo([centerLat, centerLon])
    }
  }

  /* ── 카카오 주소 검색 ──────────────────────────────────────────────────── */
  const searchAddressKakao = (query: string) => {
    if (!query.trim() || !window.kakao?.maps?.services) return
    const geocoder = new window.kakao.maps.services.Geocoder()
    geocoder.addressSearch(query, async (results, status) => {
      if (status === window.kakao.maps.services.Status.OK && results[0]) {
        const r = results[0]
        const lon = parseFloat(r.x), lat = parseFloat(r.y)
        kakaoMapRef.current?.setCenter(new window.kakao.maps.LatLng(lat, lon))
        kakaoMapRef.current?.setLevel(4)
        await loadParcel(lon, lat)
      } else {
        setError('주소를 찾을 수 없습니다.')
      }
    })
  }

  /* ── Leaflet 주소 검색 (Nominatim geocoder) ────────────────────────────── */
  const searchAddressNominatim = async (query: string) => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ko`
      )
      const data = await res.json()
      if (data[0]) {
        const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon)
        leafletMapRef.current?.setView([lat, lon], 16)
        await loadParcel(lon, lat)
      } else {
        setError('주소를 찾을 수 없습니다.')
      }
    } catch {
      setError('주소 검색에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    if (mapEngine === 'kakao') searchAddressKakao(searchQuery)
    else searchAddressNominatim(searchQuery)
  }

  /* ── Daum Postcode embed ───────────────────────────────────────────────── */
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
            handleSearch()
          },
          onclose: () => setShowAddrSearch(false),
          width: '100%', height: '100%',
        }).embed(addrEmbedRef.current)
      } catch { setShowAddrSearch(false) }
    }, 100)
    return () => clearTimeout(timer)
  }, [showAddrSearch])

  /* ── 확인 ─────────────────────────────────────────────────────────────── */
  const handleConfirm = () => {
    if (!parcel) return
    onSelect(parcel, parcel.jibun || searchQuery || '')
  }

  /* ── 렌더 ─────────────────────────────────────────────────────────────── */
  const engineLabel = mapEngine === 'kakao'
    ? '카카오 지도'
    : mapEngine === 'leaflet'
    ? 'OpenStreetMap (대안)'
    : mapEngine === 'loading'
    ? '지도 로딩 중...'
    : '지도 로드 실패'

  return (
    <div className="map-modal-overlay" onClick={onClose}>
      <div className="map-modal" onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="map-modal-header">
          <div className="map-modal-title">
            <span>🗺️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>지도에서 토지 선택</div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '1px' }}>
                {engineLabel} · 지도 클릭 또는 주소 검색으로 필지 선택
              </div>
            </div>
          </div>
          <button className="map-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="map-modal-body">
          {/* 검색바 */}
          <div className="map-search-bar">
            <input
              type="text"
              className="map-search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="주소 또는 지번 입력 (예: 대전 유성구 방동 436)"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className="map-search-btn" onClick={handleSearch}>검색</button>
            {mapEngine === 'kakao' && (
              <button className="map-postcode-btn" onClick={() => setShowAddrSearch(v => !v)}>
                📮 우편번호
              </button>
            )}
          </div>

          {/* 지적도/지번 토글 버튼 (Leaflet 모드에서만 표시) */}
          {mapEngine === 'leaflet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0', flexWrap: 'wrap' }}>

              {/* ── 위성사진 토글 ── */}
              <button
                onClick={toggleCadastral}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', borderRadius: 6, fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  border: cadastralOn ? '1.5px solid #1D4ED8' : '1.5px solid #CBD5E1',
                  background: cadastralOn ? '#EFF6FF' : '#F8FAFC',
                  color: cadastralOn ? '#1D4ED8' : '#64748B',
                }}
              >
                <span style={{ fontSize: 13 }}>🛰️</span>
                {vworldReady ? '연속지적도' : '위성사진'}
                <span style={{
                  display: 'inline-block', width: 28, height: 15, borderRadius: 8,
                  background: cadastralOn ? '#1D4ED8' : '#CBD5E1',
                  position: 'relative', transition: 'background 0.2s', marginLeft: 2,
                }}>
                  <span style={{
                    position: 'absolute', top: 1.5,
                    left: cadastralOn ? 15 : 2,
                    width: 11, height: 11, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                  }} />
                </span>
              </button>

              {/* ── 지번 토글 (VWorld 활성 시에만 활성 스타일) ── */}
              <button
                onClick={toggleJibun}
                title="지번 표시 (VWorld WMTS · 줌 14 이상에서 자동 표시)"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', borderRadius: 6, fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  border: (jibunOn && vworldReady) ? '1.5px solid #92400E' : '1.5px solid #CBD5E1',
                  background: (jibunOn && vworldReady) ? '#FEF3C7' : '#F8FAFC',
                  color: (jibunOn && vworldReady) ? '#92400E' : '#64748B',
                  opacity: vworldReady === null ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 13 }}>🔢</span>
                지번
                <span style={{
                  display: 'inline-block', width: 28, height: 15, borderRadius: 8,
                  background: (jibunOn && vworldReady) ? '#D97706' : '#CBD5E1',
                  position: 'relative', transition: 'background 0.2s', marginLeft: 2,
                }}>
                  <span style={{
                    position: 'absolute', top: 1.5,
                    left: jibunOn ? 15 : 2,
                    width: 11, height: 11, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                  }} />
                </span>
              </button>

              {/* 상태 텍스트 — VWorld 준비 전에는 숨김 */}
              {vworldReady === null && (
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>지적도 로딩 중…</span>
              )}
              {vworldReady === false && cadastralOn && (
                <span style={{ fontSize: '11px', color: '#1D4ED8' }}>🛰️ Esri 위성</span>
              )}
              {vworldReady === true && cadastralOn && (
                <span style={{ fontSize: '11px', color: '#166534' }}>🗂️ VWorld 지적도</span>
              )}
              {vworldReady === true && jibunOn && (
                <span style={{ fontSize: '11px', color: '#92400E' }}>· 지번 줌14+</span>
              )}
            </div>
          )}

          {/* 카카오 SDK 실패 안내 (닫기 가능) */}
          {mapEngine === 'leaflet' && !dismissKakaoBanner && (
            <div style={{
              background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 6,
              padding: '6px 10px', fontSize: '11px', color: '#7B5700', margin: '2px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>⚠️ 카카오 SDK 미연결 → OpenStreetMap 사용 중 (지도 클릭으로 필지 선택 가능)</span>
              <button
                onClick={() => setDismissKakaoBanner(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7B5700', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
              >✕</button>
            </div>
          )}
          {mapEngine === 'failed' && (
            <div style={{
              background: '#FEE2E2', border: '1px solid #F87171', borderRadius: 6,
              padding: '8px 12px', fontSize: '12px', color: '#991B1B', margin: '4px 0',
            }}>
              ❌ 지도를 불러올 수 없습니다. 인터넷 연결을 확인해주세요.
            </div>
          )}

          {/* Daum 주소검색 embed */}
          {showAddrSearch && (
            <div className="map-postcode-embed">
              {window.daum
                ? <div ref={addrEmbedRef} style={{ width: '100%', height: '100%' }} />
                : <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8' }}>주소검색 서비스 로딩 중...</div>
              }
            </div>
          )}

          {/* 지도 캔버스 */}
          <div className="map-container-wrap">
            <div ref={mapContainerRef} className="map-canvas" />

            {/* 로딩 오버레이 */}
            {(loading || mapEngine === 'loading') && (
              <div className="map-loading-overlay">
                <div className="map-loading-spinner" />
                <span>{loading ? '필지 정보 조회 중...' : '지도 로딩 중...'}</span>
              </div>
            )}

            {/* 사용 안내 */}
            {(mapEngine === 'kakao' || mapEngine === 'leaflet') && !parcel && !loading && (
              <div className="map-hint-overlay">
                🖱️ 지도를 클릭하면 해당 위치의 필지를 선택합니다
              </div>
            )}
          </div>

          {/* 오류 */}
          {error && (
            <div className="map-error-box">⚠️ {error}</div>
          )}

          {/* 선택된 필지 정보 */}
          {parcel && (
            <div className="map-parcel-info">
              <div className="map-parcel-title">
                <span>📍</span>
                <span>선택된 토지</span>
                {parcel.is_mock && <span className="map-mock-badge">샘플 데이터</span>}
              </div>
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
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="map-modal-footer">
          <button className="map-btn-cancel" onClick={onClose}>취소</button>
          <button
            className="map-btn-confirm"
            onClick={handleConfirm}
            disabled={!parcel}
          >
            {parcel ? '✅ 이 토지 선택' : '토지를 선택해주세요'}
          </button>
        </div>
      </div>
    </div>
  )
}
