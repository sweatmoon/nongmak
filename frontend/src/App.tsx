import React, { useState, useEffect } from 'react'
import { createOrder, getDownloadUrl, checkHealth, OrderRequest, OrderResponse } from './api'

const INITIAL_FORM: OrderRequest = {
  product_type: 'BUNDLE',
  region_code: 'KR-DJ-YS',
  applicant_name: '',
  email: '',
  phone: '',
  address: '',
  hut_area_m2: 18,
  hut_w_m: 3.0,
  hut_d_m: 6.0,
  placement_hint: 'CENTER',
  occupants_regular: 2,
  occupants_max: 4,
  toilet_type: 'FLUSH',
  treatment_mode: 'SEPTIC_DISCHARGE',
  notes: '',
}

const RISK_FLAG_LABELS: Record<string, string> = {
  WATER_AREA_POSSIBLE: '수변구역 가능성',
  TREATMENT_MODE_UNCERTAIN: '처리 방식 미확정',
}

const RISK_FLAG_DESC: Record<string, string> = {
  WATER_AREA_POSSIBLE: '정화조 방류 기준 강화 적용 여부 지자체 확인 필요',
  TREATMENT_MODE_UNCERTAIN: '시공 전 처리 방식 확정 및 업체 협의 필요',
}

type Page = 'form' | 'admin'

export default function App() {
  const [page, setPage] = useState<Page>('form')
  const [form, setForm] = useState<OrderRequest>(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OrderResponse | null>(null)
  const [serverOk, setServerOk] = useState<boolean | null>(null)

  useEffect(() => {
    checkHealth().then(ok => setServerOk(ok))
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : Number(value)) : value,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)

    try {
      const res = await createOrder(form)
      setResult(res)
      // 결과로 스크롤
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axErr = err as { response?: { data?: { detail?: string } } }
        setError(axErr.response?.data?.detail || '서버 오류가 발생했습니다.')
      } else {
        setError('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해주세요.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (page === 'admin') {
    return <AdminPage onBack={() => setPage('form')} />
  }

  return (
    <div>
      {/* 헤더 */}
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <span className="header-icon">🏡</span>
            <div>
              <div className="header-title">농막 도면 생성</div>
              <div className="header-subtitle">농막 및 정화조 설치를 위한 제출용 초안 패키지 자동 생성 시스템</div>
            </div>
            {serverOk !== null && (
              <div style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.85 }}>
                {serverOk
                  ? <span>🟢 서버 연결됨</span>
                  : <span style={{ color: '#FCA5A5' }}>🔴 서버 연결 안됨</span>
                }
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {/* 면책 배너 */}
          <div className="disclaimer-banner">
            <span className="disclaimer-icon">⚠️</span>
            <div className="disclaimer-text">
              본 시스템은 <strong>제출용 초안 자동 생성</strong> 도구입니다.
              최종 제출 전 반드시 <strong>관할 지자체</strong> 및 <strong>등록 시공업체</strong>의 검토가 필요합니다.
              정밀 지적경계 기반 인허가 도면이 아님을 유의하시기 바랍니다.
            </div>
          </div>

          {/* 입력 폼 */}
          <form onSubmit={handleSubmit}>
            {/* 기본 정보 */}
            <div className="card">
              <div className="card-title">
                <span>📋</span> 기본 정보
              </div>

              <div className="form-section-title">상품 및 지역</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="product_type">상품 유형</label>
                  <select id="product_type" name="product_type" value={form.product_type} onChange={handleChange}>
                    <option value="BUNDLE">통합 패키지 (농막 + 정화조)</option>
                    <option value="SEPTIC_ONLY">정화조만</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="region_code">지역 코드</label>
                  <select id="region_code" name="region_code" value={form.region_code} onChange={handleChange}>
                    <option value="KR-DJ-YS">대전광역시 유성구 (기본)</option>
                  </select>
                  <span className="help-text">현재 MVP: 대전 유성구 기준만 지원</span>
                </div>
              </div>

              <div className="form-section-title" style={{ marginTop: '20px' }}>신청인 정보</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="applicant_name">신청인 성명</label>
                  <input
                    id="applicant_name" name="applicant_name" type="text"
                    value={form.applicant_name} onChange={handleChange}
                    placeholder="홍길동" required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email">이메일</label>
                  <input
                    id="email" name="email" type="email"
                    value={form.email} onChange={handleChange}
                    placeholder="example@email.com"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">연락처</label>
                  <input
                    id="phone" name="phone" type="text"
                    value={form.phone} onChange={handleChange}
                    placeholder="010-0000-0000"
                  />
                </div>
                <div className="form-group full">
                  <label className="label-required" htmlFor="address">설치 주소 / 지번</label>
                  <input
                    id="address" name="address" type="text"
                    value={form.address} onChange={handleChange}
                    placeholder="대전광역시 유성구 방동 000번지" required
                  />
                </div>
              </div>
            </div>

            {/* 농막 정보 */}
            <div className="card">
              <div className="card-title">
                <span>🏠</span> 농막 정보
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_area_m2">농막 면적 (㎡)</label>
                  <input
                    id="hut_area_m2" name="hut_area_m2" type="number"
                    value={form.hut_area_m2} onChange={handleChange}
                    min={1} max={33} step={0.5} required
                  />
                  <span className="help-text">최대 33㎡ (농지법 기준)</span>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="placement_hint">배치 방향</label>
                  <select id="placement_hint" name="placement_hint" value={form.placement_hint} onChange={handleChange}>
                    <option value="CENTER">CENTER (중앙)</option>
                    <option value="NORTH">NORTH (북)</option>
                    <option value="SOUTH">SOUTH (남)</option>
                    <option value="EAST">EAST (동)</option>
                    <option value="WEST">WEST (서)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_w_m">농막 가로 (m)</label>
                  <input
                    id="hut_w_m" name="hut_w_m" type="number"
                    value={form.hut_w_m} onChange={handleChange}
                    min={1} max={20} step={0.1} required
                  />
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_d_m">농막 세로 (m)</label>
                  <input
                    id="hut_d_m" name="hut_d_m" type="number"
                    value={form.hut_d_m} onChange={handleChange}
                    min={1} max={20} step={0.1} required
                  />
                </div>
              </div>
            </div>

            {/* 정화조 정보 */}
            <div className="card">
              <div className="card-title">
                <span>🔧</span> 정화조 정보
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="occupants_regular">상시 인원 (명)</label>
                  <input
                    id="occupants_regular" name="occupants_regular" type="number"
                    value={form.occupants_regular} onChange={handleChange}
                    min={1} max={20} required
                  />
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="occupants_max">최대 인원 (명)</label>
                  <input
                    id="occupants_max" name="occupants_max" type="number"
                    value={form.occupants_max} onChange={handleChange}
                    min={1} max={20} required
                  />
                  <span className="help-text">용량 산정 기준 인원</span>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="toilet_type">화장실 유형</label>
                  <select id="toilet_type" name="toilet_type" value={form.toilet_type} onChange={handleChange}>
                    <option value="FLUSH">FLUSH (수세식)</option>
                    <option value="PORTABLE">PORTABLE (이동식)</option>
                    <option value="HOLDING_TANK">HOLDING_TANK (저장조식)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="treatment_mode">처리 방식</label>
                  <select id="treatment_mode" name="treatment_mode" value={form.treatment_mode} onChange={handleChange}>
                    <option value="SEPTIC_DISCHARGE">SEPTIC_DISCHARGE (방류형)</option>
                    <option value="INFILTRATION">INFILTRATION (침투형)</option>
                    <option value="UNKNOWN">UNKNOWN (미확정)</option>
                  </select>
                </div>
                <div className="form-group full">
                  <label htmlFor="notes">비고</label>
                  <textarea
                    id="notes" name="notes"
                    value={form.notes} onChange={handleChange}
                    placeholder="예: 저수지 근처, 수변 인접 등 특이사항을 입력하세요."
                    rows={3}
                  />
                  <span className="help-text">저수지, 수변, 하천 등 키워드 입력 시 리스크 플래그가 자동 설정됩니다.</span>
                </div>
              </div>
            </div>

            {/* 에러 */}
            {error && (
              <div className="error-box">
                <span>⛔</span>
                <div>
                  <strong>오류 발생</strong><br />
                  {error}
                </div>
              </div>
            )}

            {/* 제출 버튼 */}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  패키지 생성 중...
                </>
              ) : (
                <>
                  🗂️ 패키지 생성
                </>
              )}
            </button>
          </form>

          {/* 결과 영역 */}
          {result && (
            <div id="result-section" className="result-section" style={{ marginTop: '32px' }}>
              <div className="card">
                <div className="card-title">
                  <span>✅</span> 패키지 생성 완료
                </div>

                {/* 결과 요약 */}
                <div className="result-grid">
                  <div className="result-item">
                    <div className="result-label">주문번호</div>
                    <div className="result-value" style={{ fontSize: '13px', wordBreak: 'break-all' }}>{result.order_id}</div>
                  </div>
                  <div className="result-item">
                    <div className="result-label">정화조 용량</div>
                    <div className="result-value highlight">{result.septic_capacity_m3} m³</div>
                  </div>
                  <div className="result-item">
                    <div className="result-label">룰셋</div>
                    <div className="result-value" style={{ fontSize: '13px' }}>{result.ruleset_id}</div>
                  </div>
                </div>

                {/* 리스크 플래그 */}
                <div className="risk-flags">
                  <div className="risk-title">리스크 플래그</div>
                  <div className="flag-list">
                    {result.risk_flags.length === 0 ? (
                      <span className="flag-badge-ok">✅ 리스크 없음</span>
                    ) : (
                      result.risk_flags.map(flag => (
                        <div key={flag} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className="flag-badge">
                            ⚠️ {RISK_FLAG_LABELS[flag] || flag}
                          </span>
                          <span style={{ fontSize: '11px', color: '#94A3B8', paddingLeft: '4px' }}>
                            {RISK_FLAG_DESC[flag] || ''}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 다운로드 */}
                <div className="download-area">
                  <div className="download-info">
                    <h4>📦 ZIP 패키지 다운로드</h4>
                    <p>배치도, 배관도, 용량산정서, 신고서 초안, 체크리스트 등 포함</p>
                  </div>
                  <a
                    href={getDownloadUrl(result.order_id)}
                    className="btn-download"
                    download={`농막도면패키지_${result.order_id}.zip`}
                  >
                    ⬇️ ZIP 다운로드
                  </a>
                </div>

                {/* 포함 파일 목록 */}
                <div style={{ marginTop: '16px', padding: '14px 16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748B', marginBottom: '8px' }}>
                    📁 포함 파일
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    {[
                      '01_배치도.pdf',
                      '02_배관도.pdf',
                      '03_용량산정서.pdf',
                      ...(form.product_type === 'BUNDLE' ? ['04_신고서초안_가설건축물.docx'] : []),
                      '05_신고서초안_개인하수처리시설.docx',
                      '06_제출체크리스트.pdf',
                      '07_면책및사용안내.pdf',
                      '08_시공업체전달메모.txt',
                    ].map(f => (
                      <div key={f} style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>{f.endsWith('.pdf') ? '📄' : f.endsWith('.docx') ? '📝' : '📋'}</span>
                        {f}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 다시 생성 버튼 */}
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setResult(null); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px 20px', cursor: 'pointer', fontSize: '13px', color: '#64748B' }}
                  >
                    🔄 새 패키지 생성
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 관리자 링크 */}
          <div className="admin-link">
            <a href="#" onClick={(e) => { e.preventDefault(); setPage('admin') }}>
              관리자 주문 조회
            </a>
          </div>
        </div>
      </main>

      {/* 푸터 */}
      <footer style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0', padding: '20px 0', marginTop: '40px' }}>
        <div className="container" style={{ textAlign: 'center', color: '#94A3B8', fontSize: '12px', lineHeight: '1.8' }}>
          <div><strong>농막 도면 생성</strong> — 제출용 초안 자동 생성 시스템</div>
          <div>※ 본 시스템의 모든 산출물은 제출용 초안이며, 최종 제출 전 관할 지자체 및 등록 시공업체 검토가 필요합니다.</div>
          <div style={{ marginTop: '4px' }}>MVP v1.0 | 대전 유성구 기준 (KR-DJ-YS)</div>
        </div>
      </footer>
    </div>
  )
}

/* ========== 관리자 화면 ========== */
interface AdminOrder {
  order_id: string
  created_at: string
  applicant_name: string
  address: string
  computed_json: { septic_capacity_m3?: number; risk_flags?: string[] } | null
  ruleset_id: string
}

function AdminPage({ onBack }: { onBack: () => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
    fetch(`${API_BASE}/orders`)
      .then(r => r.json())
      .then(data => { setOrders(data.orders || []); setLoading(false) })
      .catch(e => { setError('주문 목록을 불러올 수 없습니다.'); setLoading(false) })
  }, [])

  return (
    <div>
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <button
              onClick={onBack}
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' }}
            >
              ← 돌아가기
            </button>
            <div>
              <div className="header-title">주문 관리 (관리자)</div>
              <div className="header-subtitle">전체 주문 목록 조회</div>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          <div className="card">
            <div className="card-title"><span>📊</span> 주문 목록</div>
            {loading && <div style={{ textAlign: 'center', padding: '30px', color: '#94A3B8' }}>로딩 중...</div>}
            {error && <div className="error-box"><span>⛔</span> {error}</div>}
            {!loading && !error && orders.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94A3B8' }}>주문이 없습니다.</div>
            )}
            {!loading && orders.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>주문번호</th>
                      <th>신청인</th>
                      <th>주소</th>
                      <th>정화조 용량</th>
                      <th>리스크</th>
                      <th>생성일시</th>
                      <th>다운로드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.order_id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{o.order_id}</td>
                        <td>{o.applicant_name}</td>
                        <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.address}</td>
                        <td style={{ textAlign: 'center', fontWeight: '600', color: '#1E40AF' }}>
                          {o.computed_json?.septic_capacity_m3 ?? '-'} m³
                        </td>
                        <td>
                          {(o.computed_json?.risk_flags ?? []).length > 0
                            ? (o.computed_json?.risk_flags ?? []).map(f => (
                              <span key={f} style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', marginRight: '4px' }}>
                                {f}
                              </span>
                            ))
                            : <span style={{ color: '#16A34A', fontSize: '12px' }}>없음</span>
                          }
                        </td>
                        <td style={{ fontSize: '11px', color: '#64748B' }}>{o.created_at?.slice(0, 16).replace('T', ' ')}</td>
                        <td>
                          <a
                            href={`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/orders/${o.order_id}/download`}
                            style={{ color: '#2563EB', fontSize: '12px', textDecoration: 'none' }}
                            download
                          >
                            ⬇️ ZIP
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
