/**
 * MapSelector.tsx
 * 카카오 지도 + VWorld 지적도 polygon 오버레이
 * 토지 선택 팝업 컴포넌트
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ParcelInfo, fetchParcelByCoord } from './api'

/* ── 카카오 Maps 타입 선언 ────────────────────────────────────────────────── */
declare global {
  interface Window {
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
  address: string
  jibunAddress: string
  roadAddress: string
  zonecode: string
}

/* ── Props ────────────────────────────────────────────────────────────────── */
interface MapSelectorProps {
  onSelect: (parcel: ParcelInfo, address: string) => void
  onClose: () => void
  initialAddress?: string
}

/* ── 컴포넌트 ──────────────────────────────────────────────────────────────── */
export default function MapSelector({ onSelect, onClose, initialAddress }: MapSelectorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<KakaoMap | null>(null)
  const markerRef = useRef<KakaoMarker | null>(null)
  const polygonRef = useRef<KakaoPolygon | null>(null)
  const hutPolyRef = useRef<KakaoPolyline | null>(null)
  const septicPolyRef = useRef<KakaoPolyline | null>(null)
  const overlayRef = useRef<KakaoOverlay | null>(null)

  const [searchQuery, setSearchQuery] = useState(initialAddress || '')
  const [parcel, setParcel] = useState<ParcelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [showAddrSearch, setShowAddrSearch] = useState(false)
  const addrEmbedRef = useRef<HTMLDivElement>(null)

  // ── 지도 초기화 ────────────────────────────────────────────────────────────
  useEffect(() => {
    function initMap() {
      if (!mapContainerRef.current || !window.kakao?.maps) return
      const center = new window.kakao.maps.LatLng(36.3748, 127.3445) // 대전 유성구 중심
      const map = new window.kakao.maps.Map(mapContainerRef.current, {
        center,
        level: 5,
      })
      mapRef.current = map
      setMapReady(true)

      // 지도 클릭 이벤트 → 필지 조회
      window.kakao.maps.event.addListener(map, 'click', async (mouseEvent: { latLng: KakaoLatLng }) => {
        const latlng = mouseEvent.latLng
        await loadParcel(latlng.getLng(), latlng.getLat())
      })
    }

    if (window.kakao?.maps) {
      window.kakao.maps.load(initMap)
    } else {
      // SDK 로드 대기
      const timer = setInterval(() => {
        if (window.kakao?.maps) {
          clearInterval(timer)
          window.kakao.maps.load(initMap)
        }
      }, 300)
      return () => clearInterval(timer)
    }
  }, [])

  // ── 초기 주소 자동 검색 ────────────────────────────────────────────────────
  useEffect(() => {
    if (mapReady && initialAddress) {
      searchAddress(initialAddress)
    }
  }, [mapReady])

  // ── 필지 조회 ──────────────────────────────────────────────────────────────
  const loadParcel = useCallback(async (lon: number, lat: number) => {
    if (!mapRef.current) return
    setLoading(true)
    setError(null)

    // 마커 이동
    const ll = new window.kakao.maps.LatLng(lat, lon)
    if (!markerRef.current) {
      markerRef.current = new window.kakao.maps.Marker({ position: ll, map: mapRef.current })
    } else {
      markerRef.current.setPosition(ll)
      markerRef.current.setMap(mapRef.current)
    }

    try {
      const data = await fetchParcelByCoord(lon, lat)
      setParcel(data)
      drawParcelPolygon(data)
    } catch {
      setError('필지 정보를 조회할 수 없습니다. 다른 위치를 선택해보세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── polygon 그리기 ────────────────────────────────────────────────────────
  const drawParcelPolygon = (p: ParcelInfo) => {
    if (!mapRef.current || !window.kakao?.maps) return
    const coords = p.polygon_wgs84
    if (!coords || coords.length < 3) return

    // 기존 polygon 제거
    polygonRef.current?.setMap(null)
    overlayRef.current?.setMap(null)

    const path = coords.map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng))
    const polygon = new window.kakao.maps.Polygon({
      path,
      strokeWeight: 2.5,
      strokeColor: '#166534',
      strokeOpacity: 0.9,
      fillColor: '#DCFCE7',
      fillOpacity: 0.4,
    })
    polygon.setMap(mapRef.current)
    polygonRef.current = polygon

    // centroid 오버레이
    if (p.centroid) {
      const cl = new window.kakao.maps.LatLng(p.centroid.lat, p.centroid.lon)
      const content = `<div style="
        background:rgba(22,101,52,0.85);color:#fff;
        padding:3px 8px;border-radius:4px;font-size:11px;
        white-space:nowrap;font-family:sans-serif;
      ">${p.jibun || '필지'}</div>`
      const overlay = new window.kakao.maps.CustomOverlay({
        position: cl,
        content,
        yAnchor: 1.5,
      })
      overlay.setMap(mapRef.current)
      overlayRef.current = overlay
      mapRef.current.panTo(cl)
    }
  }

  // ── 주소 검색 (카카오 Geocoder) ───────────────────────────────────────────
  const searchAddress = (query: string) => {
    if (!query.trim() || !window.kakao?.maps?.services) return
    const geocoder = new window.kakao.maps.services.Geocoder()
    geocoder.addressSearch(query, async (results, status) => {
      if (status === window.kakao.maps.services.Status.OK && results[0]) {
        const r = results[0]
        const lon = parseFloat(r.x)
        const lat = parseFloat(r.y)
        mapRef.current?.setCenter(new window.kakao.maps.LatLng(lat, lon))
        mapRef.current?.setLevel(4)
        await loadParcel(lon, lat)
      } else {
        setError('주소를 찾을 수 없습니다. 다른 주소를 입력해보세요.')
      }
    })
  }

  // ── Daum 주소검색 팝업 embed ───────────────────────────────────────────────
  useEffect(() => {
    if (!showAddrSearch || !addrEmbedRef.current || !window.daum) return
    const timer = setTimeout(() => {
      if (!addrEmbedRef.current) return
      try {
        const postcode = new window.daum.Postcode({
          oncomplete: (data) => {
            const addr = data.jibunAddress || data.address
            setSearchQuery(addr)
            setShowAddrSearch(false)
            searchAddress(addr)
          },
          onclose: () => setShowAddrSearch(false),
          width: '100%',
          height: '100%',
        })
        postcode.embed(addrEmbedRef.current)
      } catch {
        setShowAddrSearch(false)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [showAddrSearch])

  // ── 확인 버튼 ──────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!parcel) return
    const addr = parcel.jibun || searchQuery || ''
    onSelect(parcel, addr)
  }

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
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
                지도를 클릭하거나 주소를 검색하여 필지를 선택하세요
              </div>
            </div>
          </div>
          <button className="map-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="map-modal-body">
          {/* 주소 검색바 */}
          <div className="map-search-bar">
            <input
              type="text"
              className="map-search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="주소 또는 지번을 입력하세요 (예: 대전 유성구 방동 436)"
              onKeyDown={e => e.key === 'Enter' && searchAddress(searchQuery)}
            />
            <button className="map-search-btn" onClick={() => searchAddress(searchQuery)}>
              검색
            </button>
            <button className="map-postcode-btn" onClick={() => setShowAddrSearch(v => !v)}>
              📮 우편번호
            </button>
          </div>

          {/* 우편번호 검색 embed */}
          {showAddrSearch && (
            <div className="map-postcode-embed">
              {window.daum
                ? <div ref={addrEmbedRef} style={{ width: '100%', height: '100%' }} />
                : <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8' }}>주소검색 서비스 로딩 중...</div>
              }
            </div>
          )}

          {/* 지도 영역 */}
          <div className="map-container-wrap">
            <div ref={mapContainerRef} className="map-canvas" />

            {/* 로딩 오버레이 */}
            {loading && (
              <div className="map-loading-overlay">
                <div className="map-loading-spinner" />
                <span>필지 정보 조회 중...</span>
              </div>
            )}

            {/* 지도 미로드 안내 */}
            {!mapReady && !loading && (
              <div className="map-loading-overlay">
                <div className="map-loading-spinner" />
                <span>지도 로딩 중...</span>
              </div>
            )}

            {/* 사용 안내 */}
            {mapReady && !parcel && !loading && (
              <div className="map-hint-overlay">
                🖱️ 지도를 클릭하면 해당 위치의 필지를 선택합니다
              </div>
            )}
          </div>

          {/* 오류 */}
          {error && (
            <div className="map-error-box">
              ⚠️ {error}
            </div>
          )}

          {/* 선택된 필지 정보 */}
          {parcel && (
            <div className="map-parcel-info">
              <div className="map-parcel-title">
                <span>📍</span>
                <span>선택된 토지</span>
                {parcel.is_mock && (
                  <span className="map-mock-badge">샘플 데이터</span>
                )}
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

        {/* 푸터 액션 */}
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
