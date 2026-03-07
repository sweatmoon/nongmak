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
  const res = await api.get<ParcelInfo>('/parcel/by-coord', { params: { lon, lat } })
  return res.data
}

export async function fetchParcelByAddress(address: string): Promise<ParcelInfo> {
  const res = await api.get<ParcelInfo>('/parcel/by-address', { params: { address } })
  return res.data
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
