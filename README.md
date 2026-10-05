# 지도학생 상담 예약 및 관리 시스템 (Student Advisory Scheduling Platform)

대학교 교수가 매 학기 지도학생들과 진행하는 1:1 심층 상담 일정을 체계적이고 효율적으로 관리하기 위한 풀스택 웹 애플리케이션입니다.

---

## 1. 프로젝트 목적 및 핵심 가치
- **학기별 지도학생 전용 상담 관리**: 활성화된 학기(예: 2026학년도 2학기)에 사전 등록된 지도학생 학번만 상담을 신청할 수 있습니다.
- **수업 및 개인 일정 충돌 방지**: 교수의 정규 수업 시간 및 등록된 개인 일정(학과 회의, 외부 학회 등) 시간은 자동으로 예약 불가 처리됩니다.
- **연속 2슬롯(60분) 예약 보장**: 30분 단위 그리드 상에서 학생 상담은 항상 1시간(60분 = 30분 슬롯 2개 연속)을 차지하며, 두 슬롯 모두 비어 있어야만 예약이 성립됩니다.
- **동시 예약 경합(Race Condition) 방지**: Cloud Firestore Transaction을 기반으로 30분 단위의 `deterministic slot lock`을 원자적으로 획득하여 두 학생이 거의 동시에 같은 시간을 예약하더라도 정확히 한 명만 성공합니다.
- **철저한 개인정보 보호**: 학생용 공개 뷰에서는 다른 학생의 이름, 학번, 연락처는 물론 교수의 개인 일정 제목이나 메모가 절대 노출되지 않으며 오직 '예약 불가' 상태만 제공됩니다.
- **교수 개인 일정 추가 시 기존 상담 자동 취소 및 이력 보존**: 교수가 긴급한 개인 일정을 추가할 때 겹치는 상담이 있으면 경고 모달을 띄우고, 승인 시 상담 데이터를 삭제하지 않고 `canceled` 상태(취소 사유 및 학생 연락처 유지)로 변경합니다.

---

## 2. 기술 스택
- **프런트엔드**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Canvas-Confetti
- **백엔드 & 데이터베이스**: Firebase Authentication (Google 로그인), Cloud Firestore (Asia-Northeast3 서울 리전), Node.js / Express
- **검증 & 시간 유틸리티**: Zod (서버/클라이언트 스키마 검증), `date-fns` & 커스텀 KST(Asia/Seoul) Interval Collision Engine

---

## 3. 주요 Firestore 데이터 구조
- `semesterSettings/{semesterId}`: 년도, 학기, 시작일, 종료일, 운영 시작/종료 시간, 활성화 여부
- `students/{semesterId_studentId}`: 학기별 등록 지도학생 학번, 이름, 활성화 여부
- `classSchedules/{scheduleId}`: 학기별 수업 요일, 과목명, 시작/종료시간, 적용 기간
- `personalSchedules/{scheduleId}`: 교수 개인 일정 일자, 시작/종료시간, 비공개 제목 및 메모
- `appointments/{appointmentId}`: 상담 예약 내역 (이름, 학번, 전화번호, 일시, 상태, 취소사유, 확인코드)
- `slotLocks/{date_time}`: 30분 단위 슬롯 잠금 문서 (원자적 선점 및 실시간 잔여 슬롯 계산용)
- `adminUsers/{uid}`: 관리자 권한 사용자 목록

---

## 4. 환경 변수 설정 (.env.example)
```env
# Google AI Studio / Firebase 환경
GEMINI_API_KEY=""
APP_URL=""
```
`firebase-applet-config.json`에 Firebase 설정(API Key, ProjectId, AppId, FirestoreDatabaseId)이 자동으로 연동되어 있습니다.

---

## 5. 실행 및 테스트 방법
```bash
# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build

# 예약 충돌 및 슬롯 알고리즘 단위 테스트 실행
npx tsx src/test-cases.ts
```

---

## 6. 운영 전 점검해야 할 보안 설정
1. **Firestore Security Rules**: 비인가 사용자의 appointments / personalSchedules / students 전체 컬렉션 직접 읽기 및 열람이 차단되어 있습니다.
2. **학생 학번 enumeration 방지**: 전체 학번 목록을 클라이언트 브라우저로 전송하지 않으며, 단건 검증을 수행합니다.
3. **교수 개인일정 비공개**: 개인 일정의 상세 제목과 메모는 교수 로그인 상태에서만 표시됩니다.
