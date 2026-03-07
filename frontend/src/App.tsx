import React, { useState, useEffect, useRef } from 'react'
import { createOrder, getDownloadUrl, checkHealth, OrderRequest, OrderResponse } from './api'

/* ────────────── 타입 ────────────── */
type Page = 'landing' | 'form' | 'admin'

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

/* ────────────── 카카오 주소검색 타입 ────────────── */
declare global {
  interface Window {
    daum: {
      Postcode: new (config: {
        oncomplete: (data: DaumAddress) => void
        onclose?: () => void
        width?: string
        height?: string
      }) => { open: () => void; embed: (el: HTMLElement) => void }
    }
  }
}
interface DaumAddress {
  address: string
  addressType: string
  bname: string
  buildingName: string
  jibunAddress: string
  roadAddress: string
  zonecode: string
  sido: string
  sigungu: string
}

/* ══════════════════════════════════════
   메인 앱
══════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState<Page>('landing')
  const [form, setForm] = useState<OrderRequest>(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OrderResponse | null>(null)

  if (page === 'landing') return <LandingPage onStart={() => setPage('form')} onAdmin={() => setPage('admin')} />
  if (page === 'admin') return <AdminPage onBack={() => setPage('landing')} />

  return (
    <FormPage
      form={form} setForm={setForm}
      loading={loading} setLoading={setLoading}
      error={error} setError={setError}
      result={result} setResult={setResult}
      onBack={() => { setResult(null); setError(null); setPage('landing') }}
      onAdmin={() => setPage('admin')}
    />
  )
}

/* ══════════════════════════════════════
   랜딩 페이지
══════════════════════════════════════ */
function LandingPage({ onStart, onAdmin }: { onStart: () => void; onAdmin: () => void }) {
  const features = [
    { icon: '🗺️', title: '배치도 자동 생성', desc: '농막 및 정화조 위치를 개념도로 자동 시각화' },
    { icon: '🔧', title: '배관도 자동 생성', desc: '화장실→정화조→방류 흐름을 도식으로 생성' },
    { icon: '📐', title: '용량 자동 산정', desc: '인원 수 기반 정화조 권장 용량 자동 계산' },
    { icon: '📝', title: '신고서 초안 생성', desc: '가설건축물 + 개인하수처리시설 신고서 초안' },
    { icon: '✅', title: '체크리스트 제공', desc: '제출 필요 서류 및 확인 항목 정리' },
    { icon: '📦', title: 'ZIP 일괄 다운로드', desc: '모든 서류를 한 번에 ZIP으로 다운로드' },
  ]

  const steps = [
    { num: '01', title: '정보 입력', desc: '신청인 정보, 농막 규격, 정화조 조건을 입력합니다.' },
    { num: '02', title: '자동 생성', desc: '규칙 기반 알고리즘이 용량을 산정하고 도면을 생성합니다.' },
    { num: '03', title: 'ZIP 다운로드', desc: '8종 서류가 담긴 ZIP 패키지를 즉시 다운로드합니다.' },
    { num: '04', title: '검토 후 제출', desc: '지자체 및 시공업체 검토 후 최종 제출합니다.' },
  ]

  return (
    <div className="landing">
      {/* ── 네비 ── */}
      <nav className="land-nav">
        <div className="land-nav-inner">
          <div className="land-logo">🏡 농막 도면 생성</div>
          <div className="land-nav-links">
            <button className="land-nav-btn" onClick={onAdmin}>관리자</button>
            <button className="land-nav-cta" onClick={onStart}>패키지 생성 시작 →</button>
          </div>
        </div>
      </nav>

      {/* ── 히어로 ── */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-badge">🇰🇷 대전 유성구 기준 MVP</div>
          <h1 className="hero-title">
            농막 설치 서류,<br />
            <span className="hero-accent">5분 만에 자동 생성</span>
          </h1>
          <p className="hero-desc">
            농막(가설건축물) + 정화조(개인하수처리시설) 설치에 필요한<br />
            제출용 초안 패키지를 자동으로 생성해드립니다.
          </p>
          <div className="hero-actions">
            <button className="btn-hero-primary" onClick={onStart}>
              🗂️ 무료로 패키지 생성하기
            </button>
            <a className="btn-hero-secondary" href="#how">이용 방법 보기 ↓</a>
          </div>
          <div className="hero-disclaimer">
            ⚠️ 본 서비스는 제출용 초안 생성 도구입니다. 최종 제출 전 관할 지자체 및 등록 시공업체 검토가 필요합니다.
          </div>
        </div>
        <div className="hero-visual">
          <div className="doc-stack">
            {['01_배치도.pdf','02_배관도.pdf','03_용량산정서.pdf','04_신고서초안.docx','06_체크리스트.pdf'].map((f, i) => (
              <div key={f} className="doc-card" style={{ transform: `rotate(${(i - 2) * 3}deg)`, zIndex: 5 - i }}>
                <span className="doc-icon">{f.endsWith('.pdf') ? '📄' : '📝'}</span>
                <span className="doc-name">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 기능 카드 ── */}
      <section className="section-features">
        <div className="section-inner">
          <div className="section-label">포함 산출물</div>
          <h2 className="section-title">한 번에 8종 서류 자동 생성</h2>
          <div className="features-grid">
            {features.map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 이용 방법 ── */}
      <section className="section-steps" id="how">
        <div className="section-inner">
          <div className="section-label">이용 방법</div>
          <h2 className="section-title">4단계로 끝나는 간단한 과정</h2>
          <div className="steps-grid">
            {steps.map(s => (
              <div key={s.num} className="step-card">
                <div className="step-num">{s.num}</div>
                <div className="step-title">{s.title}</div>
                <div className="step-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 규칙 정보 ── */}
      <section className="section-rules">
        <div className="section-inner">
          <div className="section-label">계산 기준</div>
          <h2 className="section-title">규칙 기반 자동 산정</h2>
          <div className="rules-grid">
            <div className="rules-card">
              <h3 className="rules-card-title">정화조 용량 기준</h3>
              <table className="rules-table">
                <thead><tr><th>최대 인원</th><th>권장 용량</th></tr></thead>
                <tbody>
                  <tr><td>2명 이하</td><td>1.0 m³</td></tr>
                  <tr><td>5명 이하</td><td>2.0 m³</td></tr>
                  <tr><td>8명 이하</td><td>3.0 m³</td></tr>
                  <tr><td>9명 이상</td><td>4.0 m³</td></tr>
                </tbody>
              </table>
            </div>
            <div className="rules-card">
              <h3 className="rules-card-title">이격거리 기준</h3>
              <table className="rules-table">
                <thead><tr><th>기준</th><th>최소 거리</th></tr></thead>
                <tbody>
                  <tr><td>인접 경계선</td><td>1.0 m 이상</td></tr>
                  <tr><td>우물/지하수</td><td>20.0 m 이상</td></tr>
                  <tr><td>수체(하천/저수지)</td><td>10.0 m 이상</td></tr>
                </tbody>
              </table>
            </div>
            <div className="rules-card">
              <h3 className="rules-card-title">리스크 자동 감지</h3>
              <div className="risk-item">
                <span className="risk-flag">WATER_AREA_POSSIBLE</span>
                <span className="risk-cond">비고에 "저수지", "수변", "하천" 포함 시</span>
              </div>
              <div className="risk-item">
                <span className="risk-flag">TREATMENT_MODE_UNCERTAIN</span>
                <span className="risk-cond">수세식 화장실 + 처리방식 미확정 시</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA 배너 ── */}
      <section className="section-cta">
        <div className="section-inner cta-inner">
          <h2 className="cta-title">지금 바로 초안 패키지를 생성하세요</h2>
          <p className="cta-desc">몇 가지 정보만 입력하면 PDF/DOCX 8종 패키지를 즉시 다운로드할 수 있습니다.</p>
          <button className="btn-hero-primary" onClick={onStart}>
            🗂️ 패키지 생성 시작하기 →
          </button>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className="land-footer">
        <div className="section-inner">
          <div className="footer-logo">🏡 농막 도면 생성</div>
          <div className="footer-disclaimer">
            본 서비스의 모든 산출물은 제출용 초안이며, 최종 제출 전 관할 지자체 및 등록 시공업체의 검토가 반드시 필요합니다.<br />
            승인·허가를 보장하지 않습니다. MVP v1.0 | 대전 유성구 기준 (KR-DJ-YS)
          </div>
          <div className="footer-links">
            <button onClick={onAdmin} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '12px' }}>관리자 대시보드</button>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ══════════════════════════════════════
   주소 검색 컴포넌트 (카카오 Daum 우편번호)
══════════════════════════════════════ */
function AddressSearch({ value, onChange }: { value: string; onChange: (addr: string, jibun: string) => void }) {
  const [showModal, setShowModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const embedRef = useRef<HTMLDivElement>(null)
  const postcodeRef = useRef<InstanceType<typeof window.daum.Postcode> | null>(null)

  // 모달 열릴 때 카카오 우편번호 embed
  useEffect(() => {
    if (!showModal) return
    const timer = setTimeout(() => {
      if (!embedRef.current || !window.daum) return
      try {
        postcodeRef.current = new window.daum.Postcode({
          oncomplete: (data: DaumAddress) => {
            // 지번주소 우선, 없으면 도로명주소
            const addr = data.jibunAddress || data.address
            const road = data.roadAddress
            onChange(addr, road)
            setShowModal(false)
          },
          onclose: () => setShowModal(false),
          width: '100%',
          height: '100%',
        })
        postcodeRef.current.embed(embedRef.current)
      } catch (e) {
        console.warn('카카오 주소 API 로드 실패', e)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [showModal])

  return (
    <>
      <div className="addr-input-wrap">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value, '')}
          placeholder="주소 검색 버튼을 눌러 지번/도로명 주소를 선택하세요"
          className="addr-input"
          readOnly={false}
        />
        <button type="button" className="addr-search-btn" onClick={() => setShowModal(true)}>
          🔍 주소 검색
        </button>
      </div>

      {showModal && (
        <div className="addr-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="addr-modal" onClick={e => e.stopPropagation()}>
            <div className="addr-modal-header">
              <span className="addr-modal-title">📍 주소 검색</span>
              <button className="addr-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="addr-modal-desc">
              도로명 또는 지번 주소를 검색하여 선택하세요.<br />
              지번주소가 자동으로 입력됩니다.
            </div>
            {window.daum ? (
              <div ref={embedRef} className="addr-embed" />
            ) : (
              <div className="addr-fallback">
                <p>주소 검색 서비스를 불러오는 중입니다...</p>
                <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '8px' }}>
                  로드에 실패한 경우 직접 주소를 입력해 주세요.
                </p>
                <button
                  className="btn-primary"
                  style={{ marginTop: '12px', width: 'auto', padding: '8px 20px' }}
                  onClick={() => setShowModal(false)}
                >
                  직접 입력하기
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ══════════════════════════════════════
   신청서 작성 페이지
══════════════════════════════════════ */
interface FormPageProps {
  form: OrderRequest
  setForm: React.Dispatch<React.SetStateAction<OrderRequest>>
  loading: boolean
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  error: string | null
  setError: React.Dispatch<React.SetStateAction<string | null>>
  result: OrderResponse | null
  setResult: React.Dispatch<React.SetStateAction<OrderResponse | null>>
  onBack: () => void
  onAdmin: () => void
}

function FormPage({ form, setForm, loading, setLoading, error, setError, result, setResult, onBack, onAdmin }: FormPageProps) {

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : Number(value)) : value,
    }))
  }

  function handleAddressChange(addr: string, _road: string) {
    setForm(prev => ({ ...prev, address: addr }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setResult(null); setLoading(true)
    try {
      const res = await createOrder(form)
      setResult(res)
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axErr = err as { response?: { data?: { detail?: string } } }
        setError(axErr.response?.data?.detail || '서버 오류가 발생했습니다.')
      } else {
        setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* 헤더 */}
      <header className="form-header">
        <div className="container">
          <div className="form-header-inner">
            <button className="back-btn" onClick={onBack}>← 홈으로</button>
            <div className="form-header-title">
              <span className="form-header-icon">🏡</span>
              <div>
                <div className="form-header-name">농막 도면 생성</div>
                <div className="form-header-sub">제출용 초안 패키지 자동 생성</div>
              </div>
            </div>
            <button className="admin-small-btn" onClick={onAdmin}>관리자</button>
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
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* ─── 기본 정보 ─── */}
            <div className="card">
              <div className="card-title"><span>📋</span> 기본 정보</div>
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
                  <label htmlFor="region_code">지역 기준</label>
                  <select id="region_code" name="region_code" value={form.region_code} onChange={handleChange}>
                    <option value="KR-DJ-YS">대전광역시 유성구</option>
                  </select>
                  <span className="help-text">MVP: 대전 유성구 기준 룰셋 적용</span>
                </div>
              </div>

              <div className="form-section-title" style={{ marginTop: '20px' }}>신청인 정보</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="applicant_name">신청인 성명</label>
                  <input id="applicant_name" name="applicant_name" type="text"
                    value={form.applicant_name} onChange={handleChange} placeholder="홍길동" required />
                </div>
                <div className="form-group">
                  <label htmlFor="email">이메일</label>
                  <input id="email" name="email" type="email"
                    value={form.email} onChange={handleChange} placeholder="example@email.com" />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">연락처</label>
                  <input id="phone" name="phone" type="text"
                    value={form.phone} onChange={handleChange} placeholder="010-0000-0000" />
                </div>
              </div>

              {/* 주소 검색 */}
              <div className="form-group full" style={{ marginTop: '16px' }}>
                <label className="label-required">설치 주소 / 지번</label>
                <AddressSearch value={form.address} onChange={handleAddressChange} />
                <span className="help-text">🔍 주소 검색 버튼을 눌러 지번 또는 도로명 주소를 검색하세요</span>
              </div>
            </div>

            {/* ─── 농막 정보 ─── */}
            <div className="card">
              <div className="card-title"><span>🏠</span> 농막 정보</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_area_m2">농막 면적 (㎡)</label>
                  <input id="hut_area_m2" name="hut_area_m2" type="number"
                    value={form.hut_area_m2} onChange={handleChange} min={1} max={33} step={0.5} required />
                  <span className="help-text">최대 33㎡ (농지법 기준)</span>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="placement_hint">배치 방향</label>
                  <select id="placement_hint" name="placement_hint" value={form.placement_hint} onChange={handleChange}>
                    <option value="CENTER">CENTER (중앙)</option>
                    <option value="NORTH">NORTH (북쪽)</option>
                    <option value="SOUTH">SOUTH (남쪽)</option>
                    <option value="EAST">EAST (동쪽)</option>
                    <option value="WEST">WEST (서쪽)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_w_m">농막 가로 (m)</label>
                  <input id="hut_w_m" name="hut_w_m" type="number"
                    value={form.hut_w_m} onChange={handleChange} min={1} max={20} step={0.1} required />
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="hut_d_m">농막 세로 (m)</label>
                  <input id="hut_d_m" name="hut_d_m" type="number"
                    value={form.hut_d_m} onChange={handleChange} min={1} max={20} step={0.1} required />
                </div>
              </div>
            </div>

            {/* ─── 정화조 정보 ─── */}
            <div className="card">
              <div className="card-title"><span>🔧</span> 정화조 정보</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-required" htmlFor="occupants_regular">상시 인원 (명)</label>
                  <input id="occupants_regular" name="occupants_regular" type="number"
                    value={form.occupants_regular} onChange={handleChange} min={1} max={20} required />
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="occupants_max">최대 인원 (명)</label>
                  <input id="occupants_max" name="occupants_max" type="number"
                    value={form.occupants_max} onChange={handleChange} min={1} max={20} required />
                  <span className="help-text">용량 산정 기준 인원</span>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="toilet_type">화장실 유형</label>
                  <select id="toilet_type" name="toilet_type" value={form.toilet_type} onChange={handleChange}>
                    <option value="FLUSH">수세식 (FLUSH)</option>
                    <option value="PORTABLE">이동식 (PORTABLE)</option>
                    <option value="HOLDING_TANK">저장조식 (HOLDING_TANK)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="label-required" htmlFor="treatment_mode">처리 방식</label>
                  <select id="treatment_mode" name="treatment_mode" value={form.treatment_mode} onChange={handleChange}>
                    <option value="SEPTIC_DISCHARGE">방류형 (SEPTIC_DISCHARGE)</option>
                    <option value="INFILTRATION">침투형 (INFILTRATION)</option>
                    <option value="UNKNOWN">미확정 (UNKNOWN)</option>
                  </select>
                </div>
                <div className="form-group full">
                  <label htmlFor="notes">비고</label>
                  <textarea id="notes" name="notes" value={form.notes} onChange={handleChange}
                    placeholder="예: 저수지 근처, 수변 인접, 하천변 등 특이사항을 입력하세요." rows={3} />
                  <span className="help-text">⚠️ "저수지", "수변", "하천" 키워드 포함 시 리스크 플래그가 자동 설정됩니다.</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="error-box">
                <span>⛔</span>
                <div><strong>오류 발생</strong><br />{error}</div>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> 패키지 생성 중...</> : <>🗂️ 패키지 생성</>}
            </button>
          </form>

          {/* ─── 결과 ─── */}
          {result && (
            <div id="result-section" className="result-section" style={{ marginTop: '32px' }}>
              <div className="card">
                <div className="card-title"><span>✅</span> 패키지 생성 완료</div>
                <div className="result-grid">
                  <div className="result-item">
                    <div className="result-label">주문번호</div>
                    <div className="result-value" style={{ fontSize: '12px', wordBreak: 'break-all' }}>{result.order_id}</div>
                  </div>
                  <div className="result-item">
                    <div className="result-label">정화조 용량</div>
                    <div className="result-value highlight">{result.septic_capacity_m3} m³</div>
                  </div>
                  <div className="result-item">
                    <div className="result-label">룰셋</div>
                    <div className="result-value" style={{ fontSize: '12px' }}>{result.ruleset_id}</div>
                  </div>
                </div>

                <div className="risk-flags">
                  <div className="risk-title">리스크 플래그</div>
                  <div className="flag-list">
                    {result.risk_flags.length === 0
                      ? <span className="flag-badge-ok">✅ 리스크 없음</span>
                      : result.risk_flags.map(flag => (
                        <div key={flag} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className="flag-badge">⚠️ {RISK_FLAG_LABELS[flag] || flag}</span>
                          <span style={{ fontSize: '11px', color: '#94A3B8', paddingLeft: '4px' }}>{RISK_FLAG_DESC[flag]}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>

                <div className="download-area">
                  <div className="download-info">
                    <h4>📦 ZIP 패키지 다운로드</h4>
                    <p>배치도, 배관도, 용량산정서, 신고서 초안, 체크리스트 포함</p>
                  </div>
                  <a href={getDownloadUrl(result.order_id)} className="btn-download"
                    download={`농막도면패키지_${result.order_id}.zip`}>
                    ⬇️ ZIP 다운로드
                  </a>
                </div>

                <div style={{ marginTop: '16px', padding: '14px 16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748B', marginBottom: '8px' }}>📁 포함 파일</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    {['01_배치도.pdf','02_배관도.pdf','03_용량산정서.pdf',
                      ...(form.product_type === 'BUNDLE' ? ['04_신고서초안_가설건축물.docx'] : []),
                      '05_신고서초안_개인하수처리시설.docx','06_제출체크리스트.pdf','07_면책및사용안내.pdf','08_시공업체전달메모.txt'
                    ].map(f => (
                      <div key={f} style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>{f.endsWith('.pdf') ? '📄' : f.endsWith('.docx') ? '📝' : '📋'}</span>{f}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <button type="button" onClick={() => { setResult(null); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px 20px', cursor: 'pointer', fontSize: '13px', color: '#64748B' }}>
                    🔄 새 패키지 생성
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="admin-link">
            <a href="#" onClick={(e) => { e.preventDefault(); onAdmin() }}>관리자 주문 조회</a>
          </div>
        </div>
      </main>

      <footer style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0', padding: '20px 0', marginTop: '40px' }}>
        <div className="container" style={{ textAlign: 'center', color: '#94A3B8', fontSize: '12px', lineHeight: '1.8' }}>
          <div><strong>농막 도면 생성</strong> — 제출용 초안 자동 생성 시스템</div>
          <div>※ 모든 산출물은 초안이며, 최종 제출 전 관할 지자체 및 등록 시공업체 검토가 필요합니다.</div>
        </div>
      </footer>
    </div>
  )
}

/* ══════════════════════════════════════
   관리자 화면
══════════════════════════════════════ */
interface AdminOrder {
  order_id: string; created_at: string; applicant_name: string; address: string
  computed_json: { septic_capacity_m3?: number; risk_flags?: string[] } | null
  ruleset_id: string
}

function AdminPage({ onBack }: { onBack: () => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 관리자 API도 Vite 프록시 통해 호출
  const PROXY_BASE = '/api'

  useEffect(() => {
    fetch(`${PROXY_BASE}/orders`).then(r => r.json())
      .then(data => { setOrders(data.orders || []); setLoading(false) })
      .catch(() => { setError('주문 목록을 불러올 수 없습니다.'); setLoading(false) })
  }, [])

  return (
    <div>
      <header className="form-header">
        <div className="container">
          <div className="form-header-inner">
            <button className="back-btn" onClick={onBack}>← 홈으로</button>
            <div className="form-header-title">
              <span className="form-header-icon">📊</span>
              <div>
                <div className="form-header-name">주문 관리</div>
                <div className="form-header-sub">관리자 대시보드</div>
              </div>
            </div>
            <div />
          </div>
        </div>
      </header>
      <main className="main">
        <div className="container">
          <div className="card">
            <div className="card-title"><span>📋</span> 전체 주문 목록</div>
            {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>로딩 중...</div>}
            {error && <div className="error-box"><span>⛔</span>{error}</div>}
            {!loading && !error && orders.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>주문이 없습니다.</div>
            )}
            {!loading && orders.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>주문번호</th><th>신청인</th><th>주소</th><th>정화조 용량</th><th>리스크</th><th>생성일시</th><th>다운로드</th></tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.order_id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{o.order_id}</td>
                        <td>{o.applicant_name}</td>
                        <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.address}</td>
                        <td style={{ textAlign: 'center', fontWeight: '600', color: '#1E40AF' }}>{o.computed_json?.septic_capacity_m3 ?? '-'} m³</td>
                        <td>
                          {(o.computed_json?.risk_flags ?? []).length > 0
                            ? (o.computed_json?.risk_flags ?? []).map(f => (
                              <span key={f} style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', marginRight: '4px' }}>{f}</span>
                            ))
                            : <span style={{ color: '#16A34A', fontSize: '12px' }}>없음</span>
                          }
                        </td>
                        <td style={{ fontSize: '11px', color: '#64748B' }}>{o.created_at?.slice(0, 16).replace('T', ' ')}</td>
                        <td>
                          <a href={`${PROXY_BASE}/orders/${o.order_id}/download`} style={{ color: '#2563EB', fontSize: '12px', textDecoration: 'none' }} download>⬇️ ZIP</a>
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
