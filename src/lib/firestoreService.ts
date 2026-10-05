import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  runTransaction,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { isSupabaseConfigured } from './supabase';
import {
  sbGetActiveSemester,
  sbGetAllSemesters,
  sbSaveSemester,
  sbUpdateSemesterGoogleFormUrl,
  sbGetClassSchedules,
  sbAddClassSchedule,
  sbUpdateClassSchedule,
  sbDeleteClassSchedule,
  sbGetPersonalSchedules,
  sbCheckPersonalScheduleConflicts,
  sbSavePersonalScheduleWithAutoCancel,
  sbUpdatePersonalSchedule,
  sbDeletePersonalSchedule,
  sbGetStudents,
  sbAddStudentsBatch,
  sbToggleStudentStatus,
  sbToggleStudentFirstSemesterInPerson,
  sbUpdateStudent,
  sbDeleteStudent,
  sbIsStudentEligible,
  sbBookAppointmentAtomic,
  sbGetAdminAppointments,
  sbCancelAppointmentByAdmin,
} from './supabaseService';
import {
  SemesterSettings,
  ClassSchedule,
  PersonalSchedule,
  Appointment,
  SlotLock,
  StudentRecord,
  TimeSlotOption,
  ConsultationType,
} from '../types';
import {
  generateEligibleAppointmentStarts,
  generate30MinSlots,
  getAppointmentSubSlots,
  hasTimeOverlap,
  getDayOfWeek,
  getWeekdayNameEn,
  isDateInRange,
  isPastDate,
  generateConfirmationCode,
  timeToMinutes,
  getNowSeoul,
  getKoreanHoliday,
} from './dateUtils';

const DEFAULT_SEMESTER_ID = '2026-2';

// ----------------------------------------------------
// 1. Semester Management
// ----------------------------------------------------

export async function getActiveSemester(): Promise<SemesterSettings | null> {
  if (isSupabaseConfigured) {
    return sbGetActiveSemester();
  }
  try {
    const q = query(collection(db, 'semesterSettings'), where('active', '==', true));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as SemesterSettings;
    }
    // Fallback: try default ID doc
    const directDoc = await getDoc(doc(db, 'semesterSettings', DEFAULT_SEMESTER_ID));
    if (directDoc.exists()) {
      return { id: directDoc.id, ...directDoc.data() } as SemesterSettings;
    }
    return null;
  } catch (err) {
    console.error('Error fetching active semester:', err);
    return null;
  }
}

export async function getAllSemesters(): Promise<SemesterSettings[]> {
  if (isSupabaseConfigured) {
    return sbGetAllSemesters();
  }
  const snap = await getDocs(collection(db, 'semesterSettings'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SemesterSettings));
}

export async function saveSemester(semester: SemesterSettings): Promise<void> {
  if (isSupabaseConfigured) {
    return sbSaveSemester(semester);
  }
  const semesterRef = doc(db, 'semesterSettings', semester.id);
  // If active is true, deactivate all others atomically
  if (semester.active) {
    const all = await getAllSemesters();
    const batch = writeBatch(db);
    all.forEach((s) => {
      if (s.id !== semester.id && s.active) {
        batch.update(doc(db, 'semesterSettings', s.id), { active: false });
      }
    });
    batch.set(semesterRef, {
      ...semester,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } else {
    await setDoc(semesterRef, {
      ...semester,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateSemesterGoogleFormUrl(
  semesterId: string,
  googleFormUrl: string
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbUpdateSemesterGoogleFormUrl(semesterId, googleFormUrl);
  }
  const semesterRef = doc(db, 'semesterSettings', semesterId);
  await updateDoc(semesterRef, {
    googleFormUrl: googleFormUrl.trim(),
    updatedAt: serverTimestamp(),
  });
}

// ----------------------------------------------------
// 2. Class Schedules (수업 일정)
// ----------------------------------------------------

export async function getClassSchedules(semesterId: string): Promise<ClassSchedule[]> {
  if (isSupabaseConfigured) {
    return sbGetClassSchedules(semesterId);
  }
  try {
    const q = query(collection(db, 'classSchedules'), where('semesterId', '==', semesterId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClassSchedule));
  } catch (err) {
    console.error('Error fetching class schedules:', err);
    return [];
  }
}

export async function addClassSchedule(data: Omit<ClassSchedule, 'id' | 'createdAt'>): Promise<string> {
  if (isSupabaseConfigured) {
    return sbAddClassSchedule(data);
  }
  const newRef = doc(collection(db, 'classSchedules'));
  await setDoc(newRef, {
    ...data,
    id: newRef.id,
    createdAt: serverTimestamp(),
  });
  return newRef.id;
}

export async function updateClassSchedule(
  scheduleId: string,
  data: Omit<ClassSchedule, 'id' | 'createdAt'>
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbUpdateClassSchedule(scheduleId, data);
  }
  await updateDoc(doc(db, 'classSchedules', scheduleId), {
    ...data,
  });
}

export async function deleteClassSchedule(scheduleId: string): Promise<void> {
  if (isSupabaseConfigured) {
    return sbDeleteClassSchedule(scheduleId);
  }
  await deleteDoc(doc(db, 'classSchedules', scheduleId));
}

// ----------------------------------------------------
// 3. Personal Schedules (교수 개인 일정) & Conflict Handling
// ----------------------------------------------------

export async function getPersonalSchedules(semesterId: string): Promise<PersonalSchedule[]> {
  if (isSupabaseConfigured) {
    return sbGetPersonalSchedules(semesterId);
  }
  if (!auth.currentUser) {
    return [];
  }
  try {
    const q = query(collection(db, 'personalSchedules'), where('semesterId', '==', semesterId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonalSchedule));
  } catch (err) {
    console.error('Error fetching personal schedules:', err);
    return [];
  }
}

/**
 * Check if adding a personal schedule conflicts with existing confirmed appointments.
 * Returns the conflicting appointments list without modifying anything.
 */
export async function checkPersonalScheduleConflicts(
  date: string,
  startTime: string,
  endTime: string,
  semesterId: string
): Promise<Appointment[]> {
  if (isSupabaseConfigured) {
    return sbCheckPersonalScheduleConflicts(date, startTime, endTime, semesterId);
  }
  const q = query(
    collection(db, 'appointments'),
    where('semesterId', '==', semesterId),
    where('date', '==', date),
    where('status', '==', 'confirmed')
  );
  const snap = await getDocs(q);
  const conflicts: Appointment[] = [];

  snap.docs.forEach((d) => {
    const apt = d.data() as Appointment;
    if (hasTimeOverlap(apt.startTime, apt.endTime, startTime, endTime)) {
      conflicts.push({ ...apt, appointmentId: d.id });
    }
  });

  return conflicts;
}

/**
 * Save personal schedule and automatically cancel conflicting appointments atomically!
 * (CASE 9 & CASE 10 requirement)
 */
export async function savePersonalScheduleWithAutoCancel(
  personalData: Omit<PersonalSchedule, 'id' | 'createdAt'>,
  conflictAppointments: Appointment[]
): Promise<string> {
  if (isSupabaseConfigured) {
    return sbSavePersonalScheduleWithAutoCancel(personalData, conflictAppointments);
  }
  const batch = writeBatch(db);

  // 1. Create personal schedule document
  const personalRef = doc(collection(db, 'personalSchedules'));
  batch.set(personalRef, {
    ...personalData,
    id: personalRef.id,
    createdAt: serverTimestamp(),
  });

  // 2. Lock the 30-min slots for this personal schedule
  const slots = generate30MinSlots(personalData.startTime, personalData.endTime);
  for (const slotTime of slots) {
    const lockId = `${personalData.date}_${slotTime}`;
    const lockRef = doc(db, 'slotLocks', lockId);
    batch.set(lockRef, {
      slotKey: lockId,
      date: personalData.date,
      time: slotTime,
      type: 'personal',
      semesterId: personalData.semesterId,
      referenceId: personalRef.id,
      createdAt: serverTimestamp(),
    });
  }

  // 3. Mark conflicting appointments as canceled (NOT DELETED!)
  // Retains student name, studentId, phone for professor review
  for (const apt of conflictAppointments) {
    const aptRef = doc(db, 'appointments', apt.appointmentId);
    batch.update(aptRef, {
      status: 'canceled',
      canceledAt: serverTimestamp(),
      cancellationReason: 'professor_schedule_conflict',
      canceledBy: 'admin',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return personalRef.id;
}

export async function deletePersonalSchedule(schedule: PersonalSchedule): Promise<void> {
  if (isSupabaseConfigured) {
    return sbDeletePersonalSchedule(schedule);
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'personalSchedules', schedule.id));

  // Remove corresponding slot locks
  const slots = generate30MinSlots(schedule.startTime, schedule.endTime);
  for (const slotTime of slots) {
    const lockId = `${schedule.date}_${slotTime}`;
    batch.delete(doc(db, 'slotLocks', lockId));
  }
  await batch.commit();
}

export async function updatePersonalSchedule(
  oldSchedule: PersonalSchedule,
  updatedData: Omit<PersonalSchedule, 'id' | 'createdAt'>,
  conflictAppointments: Appointment[] = []
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbUpdatePersonalSchedule(oldSchedule, updatedData, conflictAppointments);
  }
  const batch = writeBatch(db);

  // 1. Remove old slot locks
  const oldSlots = generate30MinSlots(oldSchedule.startTime, oldSchedule.endTime);
  for (const slotTime of oldSlots) {
    const lockId = `${oldSchedule.date}_${slotTime}`;
    batch.delete(doc(db, 'slotLocks', lockId));
  }

  // 2. Update personalSchedule document
  const personalRef = doc(db, 'personalSchedules', oldSchedule.id);
  batch.update(personalRef, {
    ...updatedData,
  });

  // 3. Create new slot locks
  const newSlots = generate30MinSlots(updatedData.startTime, updatedData.endTime);
  for (const slotTime of newSlots) {
    const lockId = `${updatedData.date}_${slotTime}`;
    const lockRef = doc(db, 'slotLocks', lockId);
    batch.set(lockRef, {
      slotKey: lockId,
      date: updatedData.date,
      time: slotTime,
      type: 'personal',
      semesterId: updatedData.semesterId,
      referenceId: oldSchedule.id,
      createdAt: serverTimestamp(),
    });
  }

  // 4. Cancel conflicting appointments if any
  for (const apt of conflictAppointments) {
    const aptRef = doc(db, 'appointments', apt.appointmentId);
    batch.update(aptRef, {
      status: 'canceled',
      canceledAt: serverTimestamp(),
      cancellationReason: 'professor_schedule_conflict',
      canceledBy: 'admin',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

// ----------------------------------------------------
// 4. Students Directory (지도학생 명단)
// ----------------------------------------------------

export async function getStudents(semesterId: string): Promise<StudentRecord[]> {
  if (isSupabaseConfigured) {
    return sbGetStudents(semesterId);
  }
  if (!auth.currentUser) {
    return [];
  }
  try {
    const q = query(collection(db, 'students'), where('semesterId', '==', semesterId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentRecord));
  } catch (err) {
    console.error('Error fetching students:', err);
    return [];
  }
}

export async function addStudentsBatch(
  semesterId: string,
  students: Array<{ studentId: string; name?: string; firstSemesterInPerson?: boolean }>
): Promise<number> {
  if (isSupabaseConfigured) {
    return sbAddStudentsBatch(semesterId, students);
  }
  const batch = writeBatch(db);
  let count = 0;
  for (const s of students) {
    const cleanId = s.studentId.trim();
    if (!cleanId) continue;
    const docId = `${semesterId}_${cleanId}`;
    const sRef = doc(db, 'students', docId);
    batch.set(sRef, {
      id: docId,
      semesterId,
      studentId: cleanId,
      name: s.name?.trim() || '',
      active: true,
      firstSemesterInPerson: s.firstSemesterInPerson ?? true,
      createdAt: serverTimestamp(),
    });
    count++;
  }
  await batch.commit();
  return count;
}

export async function toggleStudentStatus(docId: string, currentActive: boolean): Promise<void> {
  if (isSupabaseConfigured) {
    return sbToggleStudentStatus(docId, currentActive);
  }
  await updateDoc(doc(db, 'students', docId), {
    active: !currentActive,
  });
}

export async function toggleStudentFirstSemesterInPerson(
  docId: string,
  currentStatus: boolean
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbToggleStudentFirstSemesterInPerson(docId, currentStatus);
  }
  await updateDoc(doc(db, 'students', docId), {
    firstSemesterInPerson: !currentStatus,
  });
}

export async function updateStudent(
  docId: string,
  updates: { name: string; firstSemesterInPerson: boolean; active: boolean }
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbUpdateStudent(docId, updates);
  }
  await updateDoc(doc(db, 'students', docId), {
    name: updates.name.trim(),
    firstSemesterInPerson: updates.firstSemesterInPerson,
    active: updates.active,
  });
}

export async function deleteStudent(docId: string): Promise<void> {
  if (isSupabaseConfigured) {
    return sbDeleteStudent(docId);
  }
  await deleteDoc(doc(db, 'students', docId));
}

/**
 * Server-side / Client validation: Check if a studentId is registered in the active semester
 * Used when booking appointment.
 */
export async function isStudentEligible(semesterId: string, studentId: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    return sbIsStudentEligible(semesterId, studentId);
  }
  try {
    const cleanId = studentId.trim();
    const docId = `${semesterId}_${cleanId}`;
    const snap = await getDoc(doc(db, 'students', docId));
    if (!snap.exists()) return false;
    const data = snap.data() as StudentRecord;
    return data.active === true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------
// 5. Public Availability Calculation (학생용 달력 & 슬롯)
// ----------------------------------------------------

/**
 * Calculates available time slots for a specific date in the student view.
 * Guarantees privacy: Never exposes appointment student details or private notes.
 */
export async function getDailySlotOptions(
  semester: SemesterSettings,
  date: string,
  classSchedules: ClassSchedule[],
  slotLocks: SlotLock[]
): Promise<TimeSlotOption[]> {
  const eligibleStartSlots = generateEligibleAppointmentStarts(
    semester.dayStart || '09:00',
    semester.dayEnd || '18:00',
    semester.appointmentMinutes || 60
  );

  const dayOfWeekIdx = getDayOfWeek(date);
  const weekdayName = getWeekdayNameEn(dayOfWeekIdx);
  const holiday = getKoreanHoliday(date);

  // If date is a Korean statutory holiday or weekend, all slots are unavailable
  if (holiday.isHoliday) {
    return eligibleStartSlots.map((startTime) => {
      const { endTime } = getAppointmentSubSlots(startTime, 60);
      return {
        time: startTime,
        endTime,
        available: false,
        reason: `대한민국 법정공휴일(${holiday.name || '공휴일'})로 상담이 운영되지 않습니다.`,
      };
    });
  }

  if (dayOfWeekIdx === 0 || dayOfWeekIdx === 6) {
    return eligibleStartSlots.map((startTime) => {
      const { endTime } = getAppointmentSubSlots(startTime, 60);
      return {
        time: startTime,
        endTime,
        available: false,
        reason: '주말(토·일요일)에는 상담이 운영되지 않습니다.',
      };
    });
  }

  // Filter relevant classes for this date
  const activeClasses = classSchedules.filter((cs) => {
    return (
      cs.weekday === weekdayName &&
      isDateInRange(date, cs.startDate, cs.endDate)
    );
  });

  // Map of locked 30-min slot times on this date
  const locked30MinTimes = new Set<string>();
  slotLocks
    .filter((lock) => lock.date === date)
    .forEach((lock) => locked30MinTimes.add(lock.time));

  const results: TimeSlotOption[] = [];

  for (const startTime of eligibleStartSlots) {
    const { subSlots, endTime } = getAppointmentSubSlots(startTime, 60);

    let isAvailable = true;
    let failReason: string | undefined;

    // 1. Check if both 30-min sub-slots are free of existing slot locks
    for (const sub of subSlots) {
      if (locked30MinTimes.has(sub)) {
        isAvailable = false;
        failReason = '선택하신 시간대에 이미 다른 신청 또는 일정이 있습니다.';
        break;
      }
    }

    // 2. Check if [startTime, endTime) overlaps with any class schedules
    if (isAvailable) {
      for (const cls of activeClasses) {
        if (hasTimeOverlap(startTime, endTime, cls.startTime, cls.endTime)) {
          isAvailable = false;
          failReason = '교수 수업 시간과 겹쳐 신청이 불가능합니다.';
          break;
        }
      }
    }

    results.push({
      time: startTime,
      endTime,
      available: isAvailable,
      reason: failReason,
    });
  }

  return results;
}

// ----------------------------------------------------
// 6. Safe & Atomic Appointment Booking (Firestore Transaction)
// ----------------------------------------------------

export interface BookingRequest {
  semesterId: string;
  studentName: string;
  studentId: string;
  phone: string;
  consultationType: ConsultationType;
  date: string;
  startTime: string; // e.g. "14:30"
}

export interface BookingResult {
  success: boolean;
  appointment?: Appointment;
  errorMessage?: string;
  code?: 'INVALID_STUDENT' | 'TIME_CONFLICT' | 'OUT_OF_RANGE' | 'PAST_DATE' | 'SYSTEM_ERROR';
}

/**
 * Atomic reservation with deterministic 30-min slot lock:
 * 1. Validates active semester range & date
 * 2. Validates student eligibility in semester & consultationType (1학기: 전원 대면, 2학기: 1학기 대면 이수자 비대면 가능)
 * 3. Verifies non-overlap with classes
 * 4. Runs a Firestore Transaction to acquire both 30-min slot locks:
 *    `${date}_${subSlot1}` and `${date}_${subSlot2}`
 * If any slot lock already exists, the transaction aborts and returns TIME_CONFLICT.
 * Guarantees race-condition prevention (CASE 8 requirement).
 */
export async function bookAppointmentAtomic(req: BookingRequest): Promise<BookingResult> {
  if (isSupabaseConfigured) {
    return sbBookAppointmentAtomic(req);
  }
  try {
    // A. Validate semester & date range
    const semesterDoc = await getDoc(doc(db, 'semesterSettings', req.semesterId));
    if (!semesterDoc.exists()) {
      return { success: false, errorMessage: '현재 상담 신청 기간이 아닙니다.', code: 'OUT_OF_RANGE' };
    }
    const semester = semesterDoc.data() as SemesterSettings;
    if (!semester.active) {
      return { success: false, errorMessage: '현재 활성화된 학기가 아닙니다.', code: 'OUT_OF_RANGE' };
    }
    if (!isDateInRange(req.date, semester.startDate, semester.endDate)) {
      return { success: false, errorMessage: '학기 기간 외의 날짜는 신청할 수 없습니다.', code: 'OUT_OF_RANGE' };
    }
    if (isPastDate(req.date)) {
      return { success: false, errorMessage: '과거 날짜는 신청할 수 없습니다.', code: 'PAST_DATE' };
    }

    // 1학기 대면 전용 정책 확인
    if (semester.semester === 1 && req.consultationType === 'online') {
      return {
        success: false,
        errorMessage: '1학기 정기 상담은 전원 대면 상담으로 진행됩니다. 상담 유형을 대면으로 선택해주세요.',
        code: 'OUT_OF_RANGE',
      };
    }

    // Check Korean statutory holiday
    const holiday = getKoreanHoliday(req.date);
    if (holiday.isHoliday) {
      return {
        success: false,
        errorMessage: `해당 날짜는 대한민국 법정공휴일(${holiday.name || '공휴일'})이므로 상담을 신청할 수 없습니다.`,
        code: 'OUT_OF_RANGE',
      };
    }

    // Check weekend
    const dayOfWeek = getDayOfWeek(req.date);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        success: false,
        errorMessage: '주말(토·일요일)에는 상담을 신청할 수 없습니다.',
        code: 'OUT_OF_RANGE',
      };
    }

    // B. Check operating hours and exact 60-minute constraint
    const startMinutes = timeToMinutes(req.startTime);
    const dayStartMin = timeToMinutes(semester.dayStart || '09:00');
    const dayEndMin = timeToMinutes(semester.dayEnd || '18:00');
    if (startMinutes < dayStartMin || startMinutes + 60 > dayEndMin || startMinutes % 30 !== 0) {
      return { success: false, errorMessage: '유효한 상담 운영 시간대가 아닙니다.', code: 'OUT_OF_RANGE' };
    }

    const { subSlots, endTime } = getAppointmentSubSlots(req.startTime, 60);

    // C. Validate student ID in this semester (CASE 7 requirement)
    const cleanStudentId = req.studentId.trim();
    const studentDocRef = doc(db, 'students', `${req.semesterId}_${cleanStudentId}`);
    const studentDoc = await getDoc(studentDocRef);
    if (!studentDoc.exists() || !studentDoc.data()?.active) {
      return {
        success: false,
        errorMessage: '해당 학기의 지도학생 명단에 등록되지 않은 학번입니다. 학과 사무실 또는 지도교수님께 문의해주세요.',
        code: 'INVALID_STUDENT',
      };
    }

    const studentData = studentDoc.data() as StudentRecord;
    if (req.consultationType === 'online' && studentData.firstSemesterInPerson === false) {
      return {
        success: false,
        errorMessage: '올해 처음으로 상담을 진행하는 학생(1학기 대면 상담 미진행)은 반드시 대면 상담을 선택해야 합니다.',
        code: 'INVALID_STUDENT',
      };
    }

    // D. Validate class schedule overlap
    const dayOfWeekIdx = getDayOfWeek(req.date);
    const weekdayName = getWeekdayNameEn(dayOfWeekIdx);
    const classQuery = query(
      collection(db, 'classSchedules'),
      where('semesterId', '==', req.semesterId),
      where('weekday', '==', weekdayName)
    );
    const classDocs = await getDocs(classQuery);
    for (const cDoc of classDocs.docs) {
      const cls = cDoc.data() as ClassSchedule;
      if (isDateInRange(req.date, cls.startDate, cls.endDate)) {
        if (hasTimeOverlap(req.startTime, endTime, cls.startTime, cls.endTime)) {
          return {
            success: false,
            errorMessage: '선택하신 시간대에 교수 수업이 등록되어 있어 신청할 수 없습니다.',
            code: 'TIME_CONFLICT',
          };
        }
      }
    }

    // E. Run Atomic Transaction for Slot Locks & Appointment creation
    const aptRef = doc(collection(db, 'appointments'));
    const lock1Ref = doc(db, 'slotLocks', `${req.date}_${subSlots[0]}`);
    const lock2Ref = doc(db, 'slotLocks', `${req.date}_${subSlots[1]}`);

    const confirmationCode = generateConfirmationCode(req.date);

    await runTransaction(db, async (transaction) => {
      // 1. Check lock 1
      const lock1Snap = await transaction.get(lock1Ref);
      if (lock1Snap.exists()) {
        throw new Error('SLOT_ALREADY_LOCKED');
      }

      // 2. Check lock 2
      const lock2Snap = await transaction.get(lock2Ref);
      if (lock2Snap.exists()) {
        throw new Error('SLOT_ALREADY_LOCKED');
      }

      // 3. Create Slot Lock 1
      transaction.set(lock1Ref, {
        id: `${req.date}_${subSlots[0]}`,
        slotKey: `${req.date}_${subSlots[0]}`,
        date: req.date,
        time: subSlots[0],
        type: 'appointment',
        semesterId: req.semesterId,
        referenceId: aptRef.id,
        createdAt: serverTimestamp(),
      });

      // 4. Create Slot Lock 2
      transaction.set(lock2Ref, {
        id: `${req.date}_${subSlots[1]}`,
        slotKey: `${req.date}_${subSlots[1]}`,
        date: req.date,
        time: subSlots[1],
        type: 'appointment',
        semesterId: req.semesterId,
        referenceId: aptRef.id,
        createdAt: serverTimestamp(),
      });

      // 5. Create Appointment Record
      const newAppointmentData = {
        appointmentId: aptRef.id,
        semesterId: req.semesterId,
        studentName: req.studentName.trim(),
        studentId: cleanStudentId,
        phone: req.phone.trim(),
        consultationType: req.consultationType,
        date: req.date,
        startTime: req.startTime,
        endTime,
        startAt: `${req.date}T${req.startTime}:00+09:00`,
        endAt: `${req.date}T${endTime}:00+09:00`,
        status: 'confirmed',
        confirmationCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      transaction.set(aptRef, newAppointmentData);
    });

    const appointment: Appointment = {
      appointmentId: aptRef.id,
      semesterId: req.semesterId,
      studentName: req.studentName.trim(),
      studentId: cleanStudentId,
      phone: req.phone.trim(),
      consultationType: req.consultationType,
      date: req.date,
      startTime: req.startTime,
      endTime,
      startAt: `${req.date}T${req.startTime}:00+09:00`,
      endAt: `${req.date}T${endTime}:00+09:00`,
      status: 'confirmed',
      confirmationCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      appointment,
    };
  } catch (err: any) {
    if (err?.message === 'SLOT_ALREADY_LOCKED') {
      return {
        success: false,
        errorMessage: '선택하신 시간이 방금 마감되었습니다. 다른 시간을 선택해주세요.',
        code: 'TIME_CONFLICT',
      };
    }
    console.error('Booking error:', err);
    return {
      success: false,
      errorMessage: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      code: 'SYSTEM_ERROR',
    };
  }
}

// ----------------------------------------------------
// 7. Admin Appointments Management
// ----------------------------------------------------

export async function getAdminAppointments(semesterId: string): Promise<Appointment[]> {
  if (isSupabaseConfigured) {
    return sbGetAdminAppointments(semesterId);
  }
  if (!auth.currentUser) {
    return [];
  }
  try {
    const q = query(collection(db, 'appointments'), where('semesterId', '==', semesterId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), appointmentId: d.id } as Appointment));
  } catch (err) {
    console.error('Error fetching admin appointments:', err);
    return [];
  }
}

export async function cancelAppointmentByAdmin(
  appointmentId: string,
  reason: 'manual_admin_cancel' | 'professor_schedule_conflict' | 'class_schedule_change' = 'manual_admin_cancel'
): Promise<void> {
  if (isSupabaseConfigured) {
    return sbCancelAppointmentByAdmin(appointmentId, reason);
  }
  const aptDoc = await getDoc(doc(db, 'appointments', appointmentId));
  if (!aptDoc.exists()) return;
  const apt = aptDoc.data() as Appointment;

  const batch = writeBatch(db);
  batch.update(doc(db, 'appointments', appointmentId), {
    status: 'canceled',
    canceledAt: serverTimestamp(),
    cancellationReason: reason,
    canceledBy: 'admin',
    updatedAt: serverTimestamp(),
  });

  // Release the 30-min slot locks so other students can book if desired
  const { subSlots } = getAppointmentSubSlots(apt.startTime, 60);
  for (const slot of subSlots) {
    const lockRef = doc(db, 'slotLocks', `${apt.date}_${slot}`);
    batch.delete(lockRef);
  }

  await batch.commit();
}
