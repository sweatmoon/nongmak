import axios from 'axios'

// 모든 API 호출은 Vite 프록시 /api → localhost:8000 을 통해 처리
const PROXY_BASE = '/api'

export interface ParcelInfo {
  jibun?: string
  area_m2?: number
  jimok?: string
  yongdo?: string
  polygon_wgs84?: number[][]
  polygon_local?: number[][]
  centroid?: { lon: number; lat: number }
  is_mock?: boolean
}

export interface ManualLayout {
  hut_center_wgs84: [number, number]    // [lat, lng]
  septic_center_wgs84: [number, number] // [lat, lng]
  hut_rotation_deg: number
  placement_note?: string
}

export interface OrderRequest {
  product_type: 'BUNDLE' | 'SEPTIC_ONLY'
  region_code: string
  applicant_name: string
  email?: string
  phone?: string
  address: string
  hut_area_m2: number
  hut_w_m: number
  hut_d_m: number
  placement_hint: 'CENTER' | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'
  occupants_regular: number
  occupants_max: number
  toilet_type: 'FLUSH' | 'PORTABLE' | 'HOLDING_TANK'
  treatment_mode: 'SEPTIC_DISCHARGE' | 'INFILTRATION' | 'UNKNOWN'
  notes?: string
  parcel?: ParcelInfo | null
  manual_layout?: ManualLayout | null   // LayoutEditor 배치 결과
}

export interface OrderResponse {
  order_id: string
  ruleset_id: string
  septic_capacity_m3: number
  risk_flags: string[]
  download_url: string
  parcel?: ParcelInfo | null
  revision_count: number
  max_revision: number
}

export interface ReviseRequest {
  hut_area_m2?: number
  hut_w_m?: number
  hut_d_m?: number
  placement_hint?: string
  occupants_regular?: number
  occupants_max?: number
  toilet_type?: string
  treatment_mode?: string
  notes?: string
  parcel?: ParcelInfo | null
}

const api = axios.create({
  baseURL: PROXY_BASE,
  timeout: 60000,
})

export async function createOrder(req: OrderRequest): Promise<OrderResponse> {
  const res = await api.post<OrderResponse>('/orders', req)
  return res.data
}

export async function reviseOrder(orderId: string, req: ReviseRequest): Promise<OrderResponse> {
  const res = await api.post<OrderResponse>(`/orders/${orderId}/revise`, req)
  return res.data
}

export async function fetchParcelByCoord(lon: number, lat: number): Promise<ParcelInfo> {
  // 1차: 브라우저에서 VWorld WFS 직접 호출 (CORS 허용됨)
  try {
    const result = await fetchParcelFromVWorldDirect(lon, lat)
    if (result) return result
  } catch {
    // 직접 호출 실패 시 백엔드 프록시로 fallback
  }
  // 2차: 백엔드 프록시 (배포 환경 / 개발 환경)
  const res = await api.get<ParcelInfo>('/parcel/by-coord', { params: { lon, lat } })
  return res.data
}

/**
 * VWorld WFS API 브라우저 직접 호출
 * - 1차: 브라우저 → VWorld 직접 (CORS 허용 환경)
 * - 2차: 브라우저 → 백엔드 WFS 프록시 → VWorld (샌드박스 등 제한 환경)
 */
export async function fetchParcelFromVWorldDirect(lon: number, lat: number): Promise<ParcelInfo | null> {
  // API 키 획득
  let apiKey: string
  try {
    const keyRes = await api.get<{ key: string }>('/vworld-key')
    apiKey = keyRes.data.key
    if (!apiKey) return null
  } catch {
    return null
  }

  // 1차 시도: 브라우저에서 VWorld WFS 직접 호출
  try {
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: 'lp_pa_cbnd_bubun',
      key: apiKey,
      output: 'application/json',
      srsName: 'EPSG:4326',
      CQL_FILTER: `INTERSECTS(geom,POINT(${lon} ${lat}))`,
      count: '1',
    })

    const resp = await fetch(`https://api.vworld.kr/req/wfs?${params.toString()}`, {
      headers: { 'Referer': 'https://www.vworld.kr' },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) {
      const data = await resp.json()
      const feature = data?.features?.[0]
      if (feature) {
        console.log('[VWorld WFS] 직접 호출 성공, props:', JSON.stringify(feature.properties))
        return parseVWorldFeature(feature)
      }
    }
  } catch (e) {
    console.warn('[VWorld WFS] 직접 호출 실패, 백엔드 프록시로 전환:', e)
  }

  // 2차 시도: 백엔드 WFS 프록시
  try {
    const proxyRes = await api.get<Record<string, unknown>>('/proxy/vworld-wfs', { params: { lon, lat } })
    const feature = proxyRes.data
    if (feature?.geometry) {
      console.log('[VWorld WFS] 백엔드 프록시 성공, props:', JSON.stringify(feature.properties))
      return parseVWorldFeature(feature)
    }
  } catch (e) {
    console.warn('[VWorld WFS] 백엔드 프록시도 실패:', e)
  }

  return null
}

/**
 * PNU 코드(19자리)를 사람이 읽기 쉬운 지번 문자열로 변환
 * PNU: 5자리 법정동코드 + 4자리 리코드 + 1자리 대지구분 + 4자리 본번 + 4자리 부번
 * 예: 3017010900100010000 → "30170-10900-1-0001-0000"
 * 실제 주소 변환은 별도 API가 필요하므로, 여기서는 읽기 쉬운 형태로만 표시
 */
function pnuToJibun(pnu: string): string {
  if (!pnu || pnu.length < 19) return pnu
  // 본번(4자리) + 부번(4자리) 추출
  const bonbun = parseInt(pnu.slice(11, 15), 10)  // 본번
  const bubun = parseInt(pnu.slice(15, 19), 10)   // 부번
  const type = pnu[10] === '1' ? '' : '산'        // 대지구분: 1=일반, 2=산
  if (bubun === 0) return `${type}${bonbun}`
  return `${type}${bonbun}-${bubun}`
}

function parseVWorldFeature(feature: Record<string, unknown>): ParcelInfo {  const props = (feature.properties as Record<string, unknown>) || {}
  const geom = (feature.geometry as Record<string, unknown>) || {}
  const coordsRaw = ((geom.coordinates as unknown[][]) || [[]])[0] as number[][]

  const polygonWgs84 = coordsRaw.map(c => [c[0], c[1]])
  const cx = polygonWgs84.reduce((s, c) => s + c[0], 0) / polygonWgs84.length
  const cy = polygonWgs84.reduce((s, c) => s + c[1], 0) / polygonWgs84.length

  // 로컬 좌표 변환 (m)
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const polygonLocal = polygonWgs84.map(c => [
    toRad(c[0] - cx) * R * Math.cos(toRad(cy)),
    toRad(c[1] - cy) * R,
  ])

  // Shoelace 면적
  let area = 0
  for (let i = 0; i < polygonLocal.length; i++) {
    const j = (i + 1) % polygonLocal.length
    area += polygonLocal[i][0] * polygonLocal[j][1]
    area -= polygonLocal[j][0] * polygonLocal[i][1]
  }
  area = Math.abs(area) / 2

  // 지번 조합: pnu(PNU코드) → 사람이 읽을 수 있는 형태 or addr 필드
  // addr 필드가 있으면 우선 사용, 없으면 PNU 디코딩
  const jibun = (props.addr as string) || pnuToJibun((props.pnu as string) || '') || ''

  return {
    jibun,
    area_m2: Math.round(area * 10) / 10,
    jimok: (props.jimok_nm as string) || '',
    yongdo: (props.prpos_area1_nm as string) || '',
    polygon_wgs84: polygonWgs84,
    polygon_local: polygonLocal.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]),
    centroid: { lon: Math.round(cx * 1e7) / 1e7, lat: Math.round(cy * 1e7) / 1e7 },
    is_mock: false,
  }
}

export async function fetchParcelByAddress(address: string): Promise<ParcelInfo> {
  // 1차: VWorld Geocode → WFS 직접 호출
  try {
    const result = await fetchParcelByAddressDirect(address)
    if (result) return result
  } catch {
    // 직접 호출 실패 시 백엔드 프록시로 fallback
  }
  // 2차: 백엔드 프록시
  const res = await api.get<ParcelInfo>('/parcel/by-address', { params: { address } })
  return res.data
}

async function fetchParcelByAddressDirect(address: string): Promise<ParcelInfo | null> {
  let apiKey: string
  try {
    const keyRes = await api.get<{ key: string }>('/vworld-key')
    apiKey = keyRes.data.key
    if (!apiKey) return null
  } catch {
    return null
  }

  // VWorld Geocode API
  const geoParams = new URLSearchParams({
    service: 'address',
    request: 'getcoord',
    address,
    type: 'parcel',
    key: apiKey,
    refine: 'false',
    simple: 'false',
    format: 'json',
  })
  const geoResp = await fetch(`https://api.vworld.kr/req/address?${geoParams}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!geoResp.ok) return null
  const geoData = await geoResp.json()
  const point = geoData?.response?.result?.point
  if (!point?.x || !point?.y) return null

  return await fetchParcelFromVWorldDirect(parseFloat(point.x), parseFloat(point.y))
}

// 다운로드 URL: Vite 프록시를 통해 /api/orders/{id}/download
export function getDownloadUrl(orderId: string): string {
  return `${PROXY_BASE}/orders/${orderId}/download`
}

export async function checkHealth(): Promise<boolean> {
  try {
    await api.get('/health')
    return true
  } catch {
    return false
  }
}
