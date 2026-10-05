-- ============================================================================
-- 데이터사이언스학과 박성우 교수 · 학기별 상담 신청 플랫폼
-- Supabase PostgreSQL Schema, RLS Policies & Atomic Transaction RPC Functions
-- 사용 방법: Supabase Dashboard -> SQL Editor 에 전체 내용을 붙여넣고 실행(Run)하세요.
-- ============================================================================

-- 1. 학기 설정 테이블 (semester_settings)
CREATE TABLE IF NOT EXISTS public.semester_settings (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  semester SMALLINT NOT NULL CHECK (semester IN (1, 2)),
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  day_start TEXT NOT NULL DEFAULT '09:00',
  day_end TEXT NOT NULL DEFAULT '18:00',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  appointment_minutes INTEGER NOT NULL DEFAULT 60,
  google_form_url TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 교수 수업 일정 테이블 (class_schedules)
CREATE TABLE IF NOT EXISTS public.class_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id TEXT NOT NULL REFERENCES public.semester_settings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  weekday TEXT NOT NULL CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. 교수 개인 일정 테이블 (personal_schedules - 학생 비공개)
CREATE TABLE IF NOT EXISTS public.personal_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id TEXT NOT NULL REFERENCES public.semester_settings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. 30분 단위 슬롯 잠금 테이블 (slot_locks - 학생 개인정보 없음, 동시성 제어용)
CREATE TABLE IF NOT EXISTS public.slot_locks (
  id TEXT PRIMARY KEY, -- 형식: "YYYY-MM-DD_HH:mm"
  slot_key TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('appointment', 'personal', 'class')),
  semester_id TEXT NOT NULL REFERENCES public.semester_settings(id) ON DELETE CASCADE,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. 지도학생 명단 테이블 (students - 전체 목록 학생 비공개)
CREATE TABLE IF NOT EXISTS public.students (
  id TEXT PRIMARY KEY, -- 형식: "${semesterId}_${studentId}"
  semester_id TEXT NOT NULL REFERENCES public.semester_settings(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  first_semester_in_person BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (semester_id, student_id)
);

-- 6. 상담 신청 내역 테이블 (appointments - 학생 개인정보 보호)
CREATE TABLE IF NOT EXISTS public.appointments (
  appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id TEXT NOT NULL REFERENCES public.semester_settings(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  consultation_type TEXT NOT NULL DEFAULT 'in_person' CHECK (consultation_type IN ('in_person', 'online')),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'canceled')),
  confirmation_code TEXT,
  cancellation_reason TEXT CHECK (cancellation_reason IN ('professor_schedule_conflict', 'class_schedule_change', 'manual_admin_cancel', 'student_cancel')),
  canceled_by TEXT CHECK (canceled_by IN ('admin', 'system', 'student')),
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. 교수 관리자 계정 테이블 (admin_users)
CREATE TABLE IF NOT EXISTS public.admin_users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT DEFAULT '교수',
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. 수업 일정 + 개인 일정 통합 조회 뷰 (all_schedules_view)
CREATE OR REPLACE VIEW public.all_schedules_view AS
SELECT
  id::text AS schedule_id,
  semester_id,
  'class'::text AS schedule_category,
  title,
  weekday AS day_or_date,
  start_time,
  end_time,
  (start_date || ' ~ ' || end_date) AS note_or_period,
  created_at
FROM public.class_schedules
UNION ALL
SELECT
  id::text AS schedule_id,
  semester_id,
  'personal'::text AS schedule_category,
  title,
  date AS day_or_date,
  start_time,
  end_time,
  COALESCE(note, '') AS note_or_period,
  created_at
FROM public.personal_schedules;

-- ============================================================================
-- Row Level Security (RLS) 설정
-- ============================================================================
ALTER TABLE public.semester_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- 기존 정책 초기화 (재실행 안전성 보장)
DROP POLICY IF EXISTS "Public read semester_settings" ON public.semester_settings;
DROP POLICY IF EXISTS "Admin write semester_settings" ON public.semester_settings;
DROP POLICY IF EXISTS "Public read class_schedules" ON public.class_schedules;
DROP POLICY IF EXISTS "Admin write class_schedules" ON public.class_schedules;
DROP POLICY IF EXISTS "Admin all personal_schedules" ON public.personal_schedules;
DROP POLICY IF EXISTS "Public read slot_locks" ON public.slot_locks;
DROP POLICY IF EXISTS "Public insert appointment slot_locks" ON public.slot_locks;
DROP POLICY IF EXISTS "Admin write slot_locks" ON public.slot_locks;
DROP POLICY IF EXISTS "Public read students for verification" ON public.students;
DROP POLICY IF EXISTS "Admin write students" ON public.students;
DROP POLICY IF EXISTS "Public insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admin all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admin all admin_users" ON public.admin_users;

-- 1) semester_settings: 조회 및 관리자 설정 저장 허용
CREATE POLICY "Public read semester_settings" ON public.semester_settings
  FOR SELECT USING (true);
CREATE POLICY "Admin write semester_settings" ON public.semester_settings
  FOR ALL USING (true) WITH CHECK (true);

-- 2) class_schedules: 조회 및 관리자 수업 일정 저장/삭제 허용
CREATE POLICY "Public read class_schedules" ON public.class_schedules
  FOR SELECT USING (true);
CREATE POLICY "Admin write class_schedules" ON public.class_schedules
  FOR ALL USING (true) WITH CHECK (true);

-- 3) personal_schedules: 교수 관리자 일정 관리 허용
CREATE POLICY "Admin all personal_schedules" ON public.personal_schedules
  FOR ALL USING (true) WITH CHECK (true);

-- 4) slot_locks: 슬롯 조회, 상담 신청 잠금 및 관리자 잠금 해제 허용
CREATE POLICY "Public read slot_locks" ON public.slot_locks
  FOR SELECT USING (true);
CREATE POLICY "Public insert appointment slot_locks" ON public.slot_locks
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write slot_locks" ON public.slot_locks
  FOR ALL USING (true) WITH CHECK (true);

-- 5) students: 학번 확인 및 지도학생 명단 관리 허용
CREATE POLICY "Public read students for verification" ON public.students
  FOR SELECT USING (true);
CREATE POLICY "Admin write students" ON public.students
  FOR ALL USING (true) WITH CHECK (true);

-- 6) appointments: 상담 신청 생성 및 교수 관리자 조회/취소 허용
CREATE POLICY "Public insert appointments" ON public.appointments
  FOR INSERT WITH CHECK (status = 'confirmed');
CREATE POLICY "Admin all appointments" ON public.appointments
  FOR ALL USING (true) WITH CHECK (true);

-- 7) admin_users: 교수 관리자 프로필 저장 허용
CREATE POLICY "Admin all admin_users" ON public.admin_users
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Realtime 활성화 (slot_locks, appointments 실시간 동기화)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'slot_locks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_locks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;

-- ============================================================================
-- 초기 기본 학기 데이터 시드 (2026-2)
-- ============================================================================
INSERT INTO public.semester_settings (
  id, year, semester, title, start_date, end_date, timezone, day_start, day_end, slot_minutes, appointment_minutes, google_form_url, active
) VALUES (
  '2026-2', 2026, 2, '2026학년도 2학기', '2026-09-01', '2026-12-31', 'Asia/Seoul', '09:00', '18:00', 30, 60, '', true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.students (id, semester_id, student_id, name, active, first_semester_in_person)
VALUES
  ('2026-2_20260001', '2026-2', '20260001', '김민준', true, true),
  ('2026-2_20260002', '2026-2', '20260002', '이서연', true, true),
  ('2026-2_20260003', '2026-2', '20260003', '박도윤', true, true),
  ('2026-2_20260004', '2026-2', '20260004', '정하은', true, true),
  ('2026-2_20260005', '2026-2', '20260005', '최지우', true, true)
ON CONFLICT (id) DO NOTHING;
