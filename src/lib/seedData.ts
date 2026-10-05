import { collection, doc, getDocs, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from './firebase';
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
 * Initializes the default 2026-2 semester, sample professor classes, and registered student IDs
 * if not already initialized in the database.
 */
export async function seedInitialDataIfNeeded(): Promise<boolean> {
  try {
    const semesterDoc = await getDoc(doc(db, 'semesterSettings', '2026-2'));
    if (semesterDoc.exists()) {
      return false; // Already seeded
    }

    console.log('Seeding initial semester, classes, and students into Firestore...');
    const batch = writeBatch(db);

    // 1. Create active semester
    batch.set(doc(db, 'semesterSettings', '2026-2'), {
      ...SAMPLE_SEMESTER,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 2. Create sample classes
    for (const cls of SAMPLE_CLASSES) {
      const classRef = doc(collection(db, 'classSchedules'));
      batch.set(classRef, {
        ...cls,
        id: classRef.id,
        createdAt: serverTimestamp(),
      });
    }

    // 3. Create sample students
    for (const student of SAMPLE_STUDENTS) {
      const studentDocId = `2026-2_${student.studentId}`;
      batch.set(doc(db, 'students', studentDocId), {
        id: studentDocId,
        semesterId: '2026-2',
        studentId: student.studentId,
        name: student.name,
        active: true,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    console.log('Initial sample dataset seeded successfully!');
    return true;
  } catch (err) {
    console.warn('Auto-seed bypassed or permissions require login:', err);
    return false;
  }
}
