import axios from 'axios'

// 모든 API 호출은 Vite 프록시 /api → localhost:8000 을 통해 처리
// VITE_API_BASE 환경변수가 있어도 프록시로 통일 (CORS 우회)
const PROXY_BASE = '/api'

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
}

export interface OrderResponse {
  order_id: string
  ruleset_id: string
  septic_capacity_m3: number
  risk_flags: string[]
  download_url: string
}

const api = axios.create({
  baseURL: PROXY_BASE,
  timeout: 60000,
})

export async function createOrder(req: OrderRequest): Promise<OrderResponse> {
  const res = await api.post<OrderResponse>('/orders', req)
  return res.data
}

// 다운로드 URL: Vite 프록시를 통해 /api/orders/{id}/download → localhost:8000/orders/{id}/download
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
