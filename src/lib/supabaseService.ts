import { supabase } from './supabase';
import {
  SemesterSettings,
  ClassSchedule,
  PersonalSchedule,
  Appointment,
  SlotLock,
  StudentRecord,
} from '../types';
import {
  generate30MinSlots,
  getAppointmentSubSlots,
  hasTimeOverlap,
  getDayOfWeek,
  getWeekdayNameEn,
  isDateInRange,
  isPastDate,
  generateConfirmationCode,
  timeToMinutes,
  getKoreanHoliday,
} from './dateUtils';
import type { BookingRequest, BookingResult } from './firestoreService';

const DEFAULT_SEMESTER_ID = '2026-2';

// ----------------------------------------------------
// Row Mappers (snake_case DB <-> camelCase App)
// ----------------------------------------------------

function mapSemesterRow(row: any): SemesterSettings {
  return {
    id: row.id,
    year: Number(row.year),
    semester: Number(row.semester) as 1 | 2,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone || 'Asia/Seoul',
    dayStart: row.day_start || '09:00',
    dayEnd: row.day_end || '18:00',
    slotMinutes: Number(row.slot_minutes || 30),
    appointmentMinutes: Number(row.appointment_minutes || 60),
    googleFormUrl: row.google_form_url || '',
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClassRow(row: any): ClassSchedule {
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

function mapPersonalRow(row: any): PersonalSchedule {
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title,
    note: row.note || '',
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  };
}

function mapSlotLockRow(row: any): SlotLock {
  return {
    id: row.id,
    slotKey: row.slot_key,
    date: row.date,
    time: row.time,
    type: row.type,
    semesterId: row.semester_id,
    referenceId: row.reference_id || undefined,
    createdAt: row.created_at,
  };
}

function mapStudentRow(row: any): StudentRecord {
  return {
    id: row.id,
    semesterId: row.semester_id,
    studentId: row.student_id,
    name: row.name || '',
    active: Boolean(row.active),
    firstSemesterInPerson: row.first_semester_in_person ?? true,
    createdAt: row.created_at,
  };
}

function mapAppointmentRow(row: any): Appointment {
  return {
    appointmentId: row.appointment_id,
    semesterId: row.semester_id,
    studentName: row.student_name,
    studentId: row.student_id,
    phone: row.phone,
    consultationType: row.consultation_type || 'in_person',
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    confirmationCode: row.confirmation_code || undefined,
    cancellationReason: row.cancellation_reason || undefined,
    canceledBy: row.canceled_by || undefined,
    canceledAt: row.canceled_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----------------------------------------------------
// 1. Semester Management (Supabase)
// ----------------------------------------------------

export async function sbGetActiveSemester(): Promise<SemesterSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('semester_settings')
    .select('*')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return mapSemesterRow(data);
  }

  const { data: fallback } = await supabase
    .from('semester_settings')
    .select('*')
    .eq('id', DEFAULT_SEMESTER_ID)
    .maybeSingle();

  return fallback ? mapSemesterRow(fallback) : null;
}

export async function sbGetAllSemesters(): Promise<SemesterSettings[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('semester_settings').select('*');
  if (error || !data) return [];
  return data.map(mapSemesterRow);
}

export async function sbSaveSemester(semester: SemesterSettings): Promise<void> {
  if (!supabase) return;
  if (semester.active) {
    await supabase
      .from('semester_settings')
      .update({ active: false })
      .neq('id', semester.id);
  }

  const { error } = await supabase.from('semester_settings').upsert({
    id: semester.id,
    year: semester.year,
    semester: semester.semester,
    title: semester.title,
    start_date: semester.startDate,
    end_date: semester.endDate,
    timezone: semester.timezone || 'Asia/Seoul',
    day_start: semester.dayStart,
    day_end: semester.dayEnd,
    slot_minutes: semester.slotMinutes || 30,
    appointment_minutes: semester.appointmentMinutes || 60,
    google_form_url: semester.googleFormUrl || '',
    active: semester.active,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function sbUpdateSemesterGoogleFormUrl(
  semesterId: string,
  googleFormUrl: string
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('semester_settings')
    .update({
      google_form_url: googleFormUrl.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', semesterId);
  if (error) throw error;
}

// ----------------------------------------------------
// 2. Class Schedules (Supabase)
// ----------------------------------------------------

export async function sbGetClassSchedules(semesterId: string): Promise<ClassSchedule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('class_schedules')
    .select('*')
    .eq('semester_id', semesterId);
  if (error || !data) return [];
  return data.map(mapClassRow);
}

export async function sbAddClassSchedule(
  data: Omit<ClassSchedule, 'id' | 'createdAt'>
): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: inserted, error } = await supabase
    .from('class_schedules')
    .insert({
      semester_id: data.semesterId,
      title: data.title,
      weekday: data.weekday,
      start_time: data.startTime,
      end_time: data.endTime,
      start_date: data.startDate,
      end_date: data.endDate,
    })
    .select()
    .single();
  if (error) throw error;
  return inserted.id;
}

export async function sbUpdateClassSchedule(
  scheduleId: string,
  data: Omit<ClassSchedule, 'id' | 'createdAt'>
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('class_schedules')
    .update({
      title: data.title,
      weekday: data.weekday,
      start_time: data.startTime,
      end_time: data.endTime,
      start_date: data.startDate,
      end_date: data.endDate,
    })
    .eq('id', scheduleId);
  if (error) throw error;
}

export async function sbDeleteClassSchedule(scheduleId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('class_schedules').delete().eq('id', scheduleId);
  if (error) throw error;
}

// ----------------------------------------------------
// 3. Personal Schedules & Conflict Handling (Supabase)
// ----------------------------------------------------

export async function sbGetPersonalSchedules(semesterId: string): Promise<PersonalSchedule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('personal_schedules')
    .select('*')
    .eq('semester_id', semesterId);
  if (error || !data) return [];
  return data.map(mapPersonalRow);
}

export async function sbCheckPersonalScheduleConflicts(
  date: string,
  startTime: string,
  endTime: string,
  semesterId: string
): Promise<Appointment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('semester_id', semesterId)
    .eq('date', date)
    .eq('status', 'confirmed');

  if (error || !data) return [];
  const conflicts: Appointment[] = [];
  for (const row of data) {
    const apt = mapAppointmentRow(row);
    if (hasTimeOverlap(apt.startTime, apt.endTime, startTime, endTime)) {
      conflicts.push(apt);
    }
  }
  return conflicts;
}

export async function sbSavePersonalScheduleWithAutoCancel(
  personalData: Omit<PersonalSchedule, 'id' | 'createdAt'>,
  conflictAppointments: Appointment[]
): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');

  // 1. Insert personal schedule
  const { data: inserted, error: insertErr } = await supabase
    .from('personal_schedules')
    .insert({
      semester_id: personalData.semesterId,
      title: personalData.title,
      note: personalData.note || '',
      date: personalData.date,
      start_time: personalData.startTime,
      end_time: personalData.endTime,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  // 2. Upsert 30-min slot locks
  const slots = generate30MinSlots(personalData.startTime, personalData.endTime);
  const lockRows = slots.map((slotTime) => {
    const lockId = `${personalData.date}_${slotTime}`;
    return {
      id: lockId,
      slot_key: lockId,
      date: personalData.date,
      time: slotTime,
      type: 'personal',
      semester_id: personalData.semesterId,
      reference_id: inserted.id,
    };
  });

  if (lockRows.length > 0) {
    const { error: lockErr } = await supabase.from('slot_locks').upsert(lockRows);
    if (lockErr) throw lockErr;
  }

  // 3. Mark conflicting appointments as canceled (retain student info)
  for (const apt of conflictAppointments) {
    await supabase
      .from('appointments')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancellation_reason: 'professor_schedule_conflict',
        canceled_by: 'admin',
        updated_at: new Date().toISOString(),
      })
      .eq('appointment_id', apt.appointmentId);
  }

  return inserted.id;
}

export async function sbDeletePersonalSchedule(schedule: PersonalSchedule): Promise<void> {
  if (!supabase) return;
  await supabase.from('personal_schedules').delete().eq('id', schedule.id);

  const slots = generate30MinSlots(schedule.startTime, schedule.endTime);
  const lockIds = slots.map((slotTime) => `${schedule.date}_${slotTime}`);
  if (lockIds.length > 0) {
    await supabase.from('slot_locks').delete().in('id', lockIds);
  }
}

export async function sbUpdatePersonalSchedule(
  oldSchedule: PersonalSchedule,
  updatedData: Omit<PersonalSchedule, 'id' | 'createdAt'>,
  conflictAppointments: Appointment[] = []
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');

  // 1. Remove old slot locks
  const oldSlots = generate30MinSlots(oldSchedule.startTime, oldSchedule.endTime);
  const oldLockIds = oldSlots.map((slotTime) => `${oldSchedule.date}_${slotTime}`);
  if (oldLockIds.length > 0) {
    await supabase.from('slot_locks').delete().in('id', oldLockIds);
  }

  // 2. Update personal_schedules row
  const { error: updErr } = await supabase
    .from('personal_schedules')
    .update({
      title: updatedData.title,
      note: updatedData.note || '',
      date: updatedData.date,
      start_time: updatedData.startTime,
      end_time: updatedData.endTime,
    })
    .eq('id', oldSchedule.id);
  if (updErr) throw updErr;

  // 3. Create new slot locks
  const newSlots = generate30MinSlots(updatedData.startTime, updatedData.endTime);
  const lockRows = newSlots.map((slotTime) => {
    const lockId = `${updatedData.date}_${slotTime}`;
    return {
      id: lockId,
      slot_key: lockId,
      date: updatedData.date,
      time: slotTime,
      type: 'personal',
      semester_id: updatedData.semesterId,
      reference_id: oldSchedule.id,
    };
  });
  if (lockRows.length > 0) {
    await supabase.from('slot_locks').upsert(lockRows);
  }

  // 4. Cancel conflicting appointments if any
  for (const apt of conflictAppointments) {
    await supabase
      .from('appointments')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancellation_reason: 'professor_schedule_conflict',
        canceled_by: 'admin',
        updated_at: new Date().toISOString(),
      })
      .eq('appointment_id', apt.appointmentId);
  }
}

// ----------------------------------------------------
// 4. Students Directory (Supabase)
// ----------------------------------------------------

export async function sbGetStudents(semesterId: string): Promise<StudentRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('semester_id', semesterId);
  if (error || !data) return [];
  return data.map(mapStudentRow);
}

export async function sbAddStudentsBatch(
  semesterId: string,
  students: Array<{ studentId: string; name?: string; firstSemesterInPerson?: boolean }>
): Promise<number> {
  if (!supabase) return 0;
  const rows = students
    .map((s) => {
      const cleanId = s.studentId.trim();
      if (!cleanId) return null;
      return {
        id: `${semesterId}_${cleanId}`,
        semester_id: semesterId,
        student_id: cleanId,
        name: s.name?.trim() || '',
        active: true,
        first_semester_in_person: s.firstSemesterInPerson ?? true,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return 0;
  const { error } = await supabase.from('students').upsert(rows);
  if (error) throw error;
  return rows.length;
}

export async function sbToggleStudentStatus(docId: string, currentActive: boolean): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('students')
    .update({ active: !currentActive })
    .eq('id', docId);
  if (error) throw error;
}

export async function sbToggleStudentFirstSemesterInPerson(
  docId: string,
  currentStatus: boolean
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('students')
    .update({ first_semester_in_person: !currentStatus })
    .eq('id', docId);
  if (error) throw error;
}

export async function sbUpdateStudent(
  docId: string,
  updates: { name: string; firstSemesterInPerson: boolean; active: boolean }
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('students')
    .update({
      name: updates.name.trim(),
      first_semester_in_person: updates.firstSemesterInPerson,
      active: updates.active,
    })
    .eq('id', docId);
  if (error) throw error;
}

export async function sbDeleteStudent(docId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('students').delete().eq('id', docId);
  if (error) throw error;
}

export async function sbIsStudentEligible(semesterId: string, studentId: string): Promise<boolean> {
  if (!supabase) return false;
  const cleanId = studentId.trim();
  const docId = `${semesterId}_${cleanId}`;
  const { data, error } = await supabase
    .from('students')
    .select('active')
    .eq('id', docId)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(data.active);
}

// ----------------------------------------------------
// 5. Slot Locks & Atomic Appointment Booking (Supabase)
// ----------------------------------------------------

export async function sbGetSlotLocks(semesterId: string): Promise<SlotLock[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('slot_locks')
    .select('*')
    .eq('semester_id', semesterId);
  if (error || !data) return [];
  return data.map(mapSlotLockRow);
}

export async function sbBookAppointmentAtomic(req: BookingRequest): Promise<BookingResult> {
  if (!supabase) {
    return {
      success: false,
      errorMessage: '데이터베이스 연결이 설정되지 않았습니다.',
      code: 'SYSTEM_ERROR',
    };
  }

  try {
    // A. Validate semester & date range
    const { data: semData, error: semErr } = await supabase
      .from('semester_settings')
      .select('*')
      .eq('id', req.semesterId)
      .maybeSingle();

    if (semErr || !semData) {
      return { success: false, errorMessage: '현재 상담 신청 기간이 아닙니다.', code: 'OUT_OF_RANGE' };
    }
    const semester = mapSemesterRow(semData);
    if (!semester.active) {
      return { success: false, errorMessage: '현재 활성화된 학기가 아닙니다.', code: 'OUT_OF_RANGE' };
    }
    if (!isDateInRange(req.date, semester.startDate, semester.endDate)) {
      return { success: false, errorMessage: '학기 기간 외의 날짜는 신청할 수 없습니다.', code: 'OUT_OF_RANGE' };
    }
    if (isPastDate(req.date)) {
      return { success: false, errorMessage: '과거 날짜는 신청할 수 없습니다.', code: 'PAST_DATE' };
    }

    if (semester.semester === 1 && req.consultationType === 'online') {
      return {
        success: false,
        errorMessage: '1학기 정기 상담은 전원 대면 상담으로 진행됩니다. 상담 유형을 대면으로 선택해주세요.',
        code: 'OUT_OF_RANGE',
      };
    }

    const holiday = getKoreanHoliday(req.date);
    if (holiday.isHoliday) {
      return {
        success: false,
        errorMessage: `해당 날짜는 대한민국 법정공휴일(${holiday.name || '공휴일'})이므로 상담을 신청할 수 없습니다.`,
        code: 'OUT_OF_RANGE',
      };
    }

    const dayOfWeek = getDayOfWeek(req.date);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        success: false,
        errorMessage: '주말(토·일요일)에는 상담을 신청할 수 없습니다.',
        code: 'OUT_OF_RANGE',
      };
    }

    // B. Operating hours check
    const startMinutes = timeToMinutes(req.startTime);
    const dayStartMin = timeToMinutes(semester.dayStart || '09:00');
    const dayEndMin = timeToMinutes(semester.dayEnd || '18:00');
    if (startMinutes < dayStartMin || startMinutes + 60 > dayEndMin || startMinutes % 30 !== 0) {
      return { success: false, errorMessage: '유효한 상담 운영 시간대가 아닙니다.', code: 'OUT_OF_RANGE' };
    }

    const { subSlots, endTime } = getAppointmentSubSlots(req.startTime, 60);

    // C. Validate student ID in this semester
    const cleanStudentId = req.studentId.trim();
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('*')
      .eq('id', `${req.semesterId}_${cleanStudentId}`)
      .maybeSingle();

    if (studentErr || !studentRow || !studentRow.active) {
      return {
        success: false,
        errorMessage: '해당 학기의 지도학생 명단에 등록되지 않은 학번입니다. 학과 사무실 또는 지도교수님께 문의해주세요.',
        code: 'INVALID_STUDENT',
      };
    }

    if (req.consultationType === 'online' && studentRow.first_semester_in_person === false) {
      return {
        success: false,
        errorMessage: '올해 처음으로 상담을 진행하는 학생(1학기 대면 상담 미진행)은 반드시 대면 상담을 선택해야 합니다.',
        code: 'INVALID_STUDENT',
      };
    }

    // D. Validate class schedule overlap
    const dayOfWeekIdx = getDayOfWeek(req.date);
    const weekdayName = getWeekdayNameEn(dayOfWeekIdx);
    const { data: classRows } = await supabase
      .from('class_schedules')
      .select('*')
      .eq('semester_id', req.semesterId)
      .eq('weekday', weekdayName);

    if (classRows) {
      for (const cRow of classRows) {
        const cls = mapClassRow(cRow);
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
    }

    // E. Acquire atomic 30-min slot locks via unique constraint on slot_locks(id)
    const lock1Id = `${req.date}_${subSlots[0]}`;
    const lock2Id = `${req.date}_${subSlots[1]}`;

    const { error: lockErr } = await supabase.from('slot_locks').insert([
      {
        id: lock1Id,
        slot_key: lock1Id,
        date: req.date,
        time: subSlots[0],
        type: 'appointment',
        semester_id: req.semesterId,
      },
      {
        id: lock2Id,
        slot_key: lock2Id,
        date: req.date,
        time: subSlots[1],
        type: 'appointment',
        semester_id: req.semesterId,
      },
    ]);

    if (lockErr) {
      return {
        success: false,
        errorMessage: '선택하신 시간이 방금 마감되었습니다. 다른 시간을 선택해주세요.',
        code: 'TIME_CONFLICT',
      };
    }

    const confirmationCode = generateConfirmationCode(req.date);
    const startAt = `${req.date}T${req.startTime}:00+09:00`;
    const endAt = `${req.date}T${endTime}:00+09:00`;

    const { data: aptInserted, error: aptErr } = await supabase
      .from('appointments')
      .insert({
        semester_id: req.semesterId,
        student_name: req.studentName.trim(),
        student_id: cleanStudentId,
        phone: req.phone.trim(),
        consultation_type: req.consultationType,
        date: req.date,
        start_time: req.startTime,
        end_time: endTime,
        start_at: startAt,
        end_at: endAt,
        status: 'confirmed',
        confirmation_code: confirmationCode,
      })
      .select()
      .single();

    if (aptErr || !aptInserted) {
      // Rollback locks if appointment insert failed
      await supabase.from('slot_locks').delete().in('id', [lock1Id, lock2Id]);
      throw aptErr || new Error('Failed to create appointment');
    }

    return {
      success: true,
      appointment: mapAppointmentRow(aptInserted),
    };
  } catch (err) {
    console.error('Supabase booking error:', err);
    return {
      success: false,
      errorMessage: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      code: 'SYSTEM_ERROR',
    };
  }
}

// ----------------------------------------------------
// 6. Admin Appointments Management (Supabase)
// ----------------------------------------------------

export async function sbGetAdminAppointments(semesterId: string): Promise<Appointment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('semester_id', semesterId)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error || !data) return [];
  return data.map(mapAppointmentRow);
}

export async function sbCancelAppointmentByAdmin(
  appointmentId: string,
  reason: 'manual_admin_cancel' | 'professor_schedule_conflict' | 'class_schedule_change' = 'manual_admin_cancel'
): Promise<void> {
  if (!supabase) return;
  const { data: aptRow } = await supabase
    .from('appointments')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (!aptRow) return;
  const apt = mapAppointmentRow(aptRow);

  await supabase
    .from('appointments')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      cancellation_reason: reason,
      canceled_by: 'admin',
      updated_at: new Date().toISOString(),
    })
    .eq('appointment_id', appointmentId);

  const { subSlots } = getAppointmentSubSlots(apt.startTime, 60);
  const lockIds = subSlots.map((slot) => `${apt.date}_${slot}`);
  await supabase.from('slot_locks').delete().in('id', lockIds);
}
