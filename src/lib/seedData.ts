import { collection, doc, writeBatch, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { isSupabaseConfigured, supabase } from './supabase';
import { SemesterSettings } from '../types';

export const SAMPLE_SEMESTER: SemesterSettings = {
  id: '2026-2',
  year: 2026,
  semester: 2,
  title: '2026학년도 2학기',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  timezone: 'Asia/Seoul',
  dayStart: '09:00',
  dayEnd: '18:00',
  slotMinutes: 30,
  appointmentMinutes: 60,
  active: true,
  createdAt: new Date().toISOString(),
};

export const SAMPLE_CLASSES = [
  {
    semesterId: '2026-2',
    title: '데이터사이언스 심화 프로그래밍',
    weekday: 'monday',
    startTime: '10:30',
    endTime: '12:00',
    startDate: '2026-09-01',
    endDate: '2026-12-21',
  },
  {
    semesterId: '2026-2',
    title: '시계열 데이터 처리 및 분석',
    weekday: 'wednesday',
    startTime: '13:00',
    endTime: '15:00',
    startDate: '2026-09-01',
    endDate: '2026-12-21',
  },
  {
    semesterId: '2026-2',
    title: '딥러닝 고급과 응용',
    weekday: 'thursday',
    startTime: '15:00',
    endTime: '17:00',
    startDate: '2026-09-01',
    endDate: '2026-12-21',
  },
];

export const SAMPLE_STUDENTS = [
  { studentId: '20260001', name: '김민준' },
  { studentId: '20260002', name: '이서연' },
  { studentId: '20260003', name: '박도윤' },
  { studentId: '20260004', name: '정하은' },
  { studentId: '20260005', name: '최지우' },
];

/**
 * Initializes the default semester ONLY if the semester_settings table is completely empty.
 * Never overwrites or re-inserts sample data if the professor has already configured any semester.
 */
export async function seedInitialDataIfNeeded(): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: existingRows, error } = await supabase
        .from('semester_settings')
        .select('id')
        .limit(1);

      if (error || (existingRows && existingRows.length > 0)) {
        return false;
      }

      await supabase.from('semester_settings').upsert({
        id: SAMPLE_SEMESTER.id,
        year: SAMPLE_SEMESTER.year,
        semester: SAMPLE_SEMESTER.semester,
        title: SAMPLE_SEMESTER.title,
        start_date: SAMPLE_SEMESTER.startDate,
        end_date: SAMPLE_SEMESTER.endDate,
        timezone: SAMPLE_SEMESTER.timezone,
        day_start: SAMPLE_SEMESTER.dayStart,
        day_end: SAMPLE_SEMESTER.dayEnd,
        slot_minutes: SAMPLE_SEMESTER.slotMinutes,
        appointment_minutes: SAMPLE_SEMESTER.appointmentMinutes,
        google_form_url: '',
        active: true,
      });

      return true;
    } catch (err) {
      console.warn('Supabase auto-seed skipped:', err);
      return false;
    }
  }

  try {
    const snap = await getDocs(collection(db, 'semesterSettings'));
    if (!snap.empty) {
      return false; // Already seeded
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'semesterSettings', '2026-2'), {
      ...SAMPLE_SEMESTER,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('Auto-seed bypassed:', err);
    return false;
  }
}
