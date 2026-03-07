# 농막 도면 생성

> 농막 및 정화조 설치를 위한 **제출용 초안 패키지** 자동 생성 시스템

---

## ⚠️ 중요 면책 고지

> 본 시스템은 **제출용 초안 자동 생성 시스템**입니다.  
> 정밀 GIS/지적경계 기반 인허가 도면이 아닙니다.  
> 최종 제출 전 반드시 **관할 지자체** 및 **등록 시공업체**의 검토가 필요합니다.

---

## 📌 시스템 개요

| 항목 | 내용 |
|------|------|
| 시스템명 | 농막 도면 생성 |
| 버전 | MVP v1.0 |
| 지역 기준 | 대전광역시 유성구 (KR-DJ-YS) |
| 목적 | 농막 + 정화조 설치 제출용 초안 패키지 자동 생성 |

---

## 🏗️ 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | React 18 + Vite + TypeScript |
| 백엔드 | FastAPI + Python 3 |
| DB | SQLite |
| PDF 생성 | ReportLab |
| DOCX 생성 | python-docx |
| 서비스 관리 | PM2 |

---

## 📁 폴더 구조

```
webapp/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 메인 앱
│   │   ├── config.py            # 설정
│   │   ├── db.py                # SQLite DB 관리
│   │   ├── models.py            # Pydantic 모델
│   │   ├── rules.py             # 용량산정/리스크 계산 로직
│   │   └── generators/
│   │       ├── site_plan.py     # PDF 생성 (배치도/배관도/용량산정서/체크리스트/면책)
│   │       ├── forms.py         # DOCX 생성 (신고서 초안)
│   │       └── package.py      # ZIP 패키지 생성
│   ├── data/
│   │   └── rulesets/
│   │       └── KR-DJ-YS.v1.json  # 대전 유성구 룰셋
│   ├── out/                     # 생성된 ZIP 파일 저장 디렉토리
│   ├── ecosystem.config.cjs     # PM2 설정
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx              # 메인 화면 + 관리자 화면
    │   ├── api.ts               # API 클라이언트
    │   ├── main.tsx             # 진입점
    │   └── styles.css           # 스타일
    ├── index.html
    ├── vite.config.ts
    ├── package.json
    └── .env.example
```

---

## 🚀 로컬 실행 방법

### 1. 사전 요구사항
- Python 3.10+
- Node.js 18+

### 2. 백엔드 실행
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. 프론트엔드 실행
```bash
cd frontend
cp .env.example .env
# .env 파일에서 VITE_API_BASE=http://localhost:8000 확인
npm install
npm run dev
```

### 4. 브라우저 접속
- 프론트엔드: http://localhost:5173
- API 문서: http://localhost:8000/docs
- 헬스체크: http://localhost:8000/health

### PM2로 실행 (프로덕션 환경)
```bash
# 백엔드
cd backend && pm2 start ecosystem.config.cjs

# 프론트엔드
cd frontend && pm2 start "npm run dev" --name agri-frontend

# 상태 확인
pm2 list
pm2 logs --nostream
```

---

## 🧪 테스트 방법

### 샘플 테스트 데이터 (API 직접 호출)
```bash
curl -X POST http://localhost:8000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "product_type": "BUNDLE",
    "region_code": "KR-DJ-YS",
    "applicant_name": "홍길동",
    "email": "test@example.com",
    "phone": "010-0000-0000",
    "address": "대전광역시 유성구 방동저수지 인근(예시)",
    "hut_area_m2": 18,
    "hut_w_m": 3.0,
    "hut_d_m": 6.0,
    "placement_hint": "CENTER",
    "occupants_regular": 2,
    "occupants_max": 4,
    "toilet_type": "FLUSH",
    "treatment_mode": "SEPTIC_DISCHARGE",
    "notes": "저수지 근처"
  }'
```

### 성공 조건 확인
| 항목 | 기대값 | 확인 방법 |
|------|--------|-----------|
| 정화조 용량 | 2.0 m³ | API 응답 `septic_capacity_m3` |
| 리스크 플래그 | WATER_AREA_POSSIBLE | API 응답 `risk_flags` |
| ZIP 파일 생성 | ✅ | `backend/out/` 디렉토리 확인 |
| 다운로드 | ✅ | `GET /orders/{order_id}/download` |

---

## 📦 생성 산출물 (ZIP 패키지 구성)

| 파일명 | 설명 | 상품유형 |
|--------|------|----------|
| `01_배치도.pdf` | 농막/정화조 위치 배치도 | 모든 상품 |
| `02_배관도.pdf` | 배관 흐름 개념도 | 모든 상품 |
| `03_용량산정서.pdf` | 정화조 용량 산정 결과 | 모든 상품 |
| `04_신고서초안_가설건축물.docx` | 가설건축물 축조 신고서 초안 | BUNDLE만 |
| `05_신고서초안_개인하수처리시설.docx` | 개인하수처리시설 설치 신고서 초안 | 모든 상품 |
| `06_제출체크리스트.pdf` | 제출 서류 체크리스트 | 모든 상품 |
| `07_면책및사용안내.pdf` | 면책 및 사용 안내 | 모든 상품 |
| `08_시공업체전달메모.txt` | 시공업체 전달용 메모 | 모든 상품 |

---

## 🔧 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 |
| POST | `/orders` | 주문 생성 + 패키지 생성 |
| GET | `/orders/{order_id}/download` | ZIP 다운로드 |
| GET | `/orders/{order_id}` | 주문 상세 조회 |
| GET | `/orders` | 주문 목록 조회 (관리자) |

---

## 📐 규칙 및 계산 로직

### 정화조 용량 계산 (대전 유성구 기준)
| 최대 인원 | 권장 용량 |
|-----------|-----------|
| 2명 이하  | 1.0 m³    |
| 5명 이하  | 2.0 m³    |
| 8명 이하  | 3.0 m³    |
| 9명 이상  | 4.0 m³    |

### 이격거리 기준
| 구분 | 최소 이격거리 |
|------|--------------|
| 인접 경계선 | 1.0 m 이상 |
| 우물/지하수 취수구 | 20.0 m 이상 |
| 수체(하천/저수지) | 10.0 m 이상 |

### 리스크 플래그 자동 감지
| 플래그 | 조건 |
|--------|------|
| `WATER_AREA_POSSIBLE` | 비고(notes)에 "저수지", "수변", "하천" 등 포함 |
| `TREATMENT_MODE_UNCERTAIN` | 화장실=FLUSH + 처리방식=UNKNOWN |

---

## 📋 입력 항목 명세

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `product_type` | BUNDLE / SEPTIC_ONLY | ✅ | 상품 유형 |
| `region_code` | string | ✅ | 지역 코드 (KR-DJ-YS) |
| `applicant_name` | string | ✅ | 신청인 성명 |
| `email` | string | - | 이메일 |
| `phone` | string | - | 연락처 |
| `address` | string | ✅ | 설치 주소/지번 |
| `hut_area_m2` | float (1~33) | ✅ | 농막 면적 (㎡) |
| `hut_w_m` | float | ✅ | 농막 가로 (m) |
| `hut_d_m` | float | ✅ | 농막 세로 (m) |
| `placement_hint` | CENTER/N/S/E/W | ✅ | 배치 방향 |
| `occupants_regular` | int | ✅ | 상시 인원 |
| `occupants_max` | int | ✅ | 최대 인원 |
| `toilet_type` | FLUSH/PORTABLE/HOLDING_TANK | ✅ | 화장실 유형 |
| `treatment_mode` | SEPTIC_DISCHARGE/INFILTRATION/UNKNOWN | ✅ | 처리 방식 |
| `notes` | string | - | 비고 |

---

## 🗺️ 향후 개발 계획

### 2순위
- [ ] DXF 파일 생성 (ezdxf)
- [ ] 관리자 대시보드 개선

### 3순위
- [ ] 결제 연동
- [ ] 로그인/회원가입
- [ ] 다중 지역 룰셋 확장 (타 시군구)

---

## 📝 데이터 아키텍처

- **SQLite DB**: `backend/orders.db`
  - orders 테이블: 주문 정보, 입력값, 계산값, ZIP 경로 저장
- **파일 저장**: `backend/out/{order_id}.zip`
- **룰셋**: `backend/data/rulesets/KR-DJ-YS.v1.json`

---

*농막 도면 생성 MVP v1.0 | 대전 유성구 기준 | 제출용 초안 자동 생성 시스템*
