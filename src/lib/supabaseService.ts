import { supabase } from './supabase';
import {
  SemesterSettings,
  ClassSchedule,
  PersonalSchedule,
  Appointment,
  SlotLock,
  StudentRecord,
  ProfessorAttribution,
  ProfessorConsultationSettings,
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

const DEFAULT_PROFESSOR: Required<ProfessorAttribution> = {
  professorUid: 'admin-professor',
  professorName: '박성우 교수',
  professorEmail: 'sungwoopark1224@gmail.com',
};

const OWNERSHIP_META_UID = 'meta:professor_ownership';
const PROF_SETTINGS_META_UID = 'meta:professor_settings';
const LOCAL_PROF_SETTINGS_KEY = 'ds_counseling_prof_settings_map';
let cachedOwnershipMap: Record<string, Required<ProfessorAttribution>> = {};
let cachedProfSettingsMap: Record<string, ProfessorConsultationSettings> = {};
let lastOwnershipFetchMs = 0;
let inflightOwnershipPromise: Promise<Record<string, Required<ProfessorAttribution>>> | null = null;

/**
 * Resolves the currently logged-in professor/admin attribution from session or override.
 * Defaults to 박성우 교수 (sungwoopark1224@gmail.com).
 */
export function getCurrentProfessorAttribution(
  override?: ProfessorAttribution
): Required<ProfessorAttribution> {
  if (override?.professorName && override?.professorEmail) {
    return {
      professorUid: override.professorUid || DEFAULT_PROFESSOR.professorUid,
      professorName:
        override.professorName.replace(/\s*\(관리자\)\s*$/, '').trim() ||
        DEFAULT_PROFESSOR.professorName,
      professorEmail: override.professorEmail.trim().toLowerCase(),
    };
  }

  try {
    const raw = localStorage.getItem('ds_counseling_admin_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.email) {
        const cleanName = String(parsed.displayName || DEFAULT_PROFESSOR.professorName)
          .replace(/\s*\(관리자\)\s*$/, '')
          .trim();
        return {
          professorUid: String(parsed.uid || DEFAULT_PROFESSOR.professorUid),
          professorName: cleanName || DEFAULT_PROFESSOR.professorName,
          professorEmail: String(parsed.email).trim().toLowerCase(),
        };
      }
    }
  } catch {
    // Ignore storage error
  }

  return { ...DEFAULT_PROFESSOR };
}

async function loadOwnershipMapFromSupabase(
  force = false
): Promise<Record<string, Required<ProfessorAttribution>>> {
  if (!supabase) return cachedOwnershipMap;
  const now = Date.now();
  if (!force && lastOwnershipFetchMs > 0 && now - lastOwnershipFetchMs < 15000) {
    return cachedOwnershipMap;
  }
  if (inflightOwnershipPromise) {
    return inflightOwnershipPromise;
  }

  inflightOwnershipPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('name')
        .eq('uid', OWNERSHIP_META_UID)
        .maybeSingle();

      if (!error && data?.name) {
        const parsed = JSON.parse(data.name);
        if (parsed && typeof parsed === 'object') {
          cachedOwnershipMap = { ...cachedOwnershipMap, ...parsed };
        }
      }
      lastOwnershipFetchMs = Date.now();
    } catch {
      // Ignore
    } finally {
      inflightOwnershipPromise = null;
    }
    return cachedOwnershipMap;
  })();

  return inflightOwnershipPromise;
}

async function saveOwnershipForRecord(
  tableKey: string,
  recordId: string,
  prof: Required<ProfessorAttribution>
): Promise<void> {
  return saveOwnershipForRecords(tableKey, [recordId], prof);
}

async function saveOwnershipForRecords(
  tableKey: string,
  recordIds: string[],
  prof: Required<ProfessorAttribution>
): Promise<void> {
  if (recordIds.length === 0) return;
  for (const id of recordIds) {
    cachedOwnershipMap[`${tableKey}:${id}`] = prof;
  }
  if (!supabase) return;
  try {
    const current = await loadOwnershipMapFromSupabase();
    const merged: Record<string, Required<ProfessorAttribution>> = { ...current };
    for (const id of recordIds) {
      merged[`${tableKey}:${id}`] = prof;
    }
    cachedOwnershipMap = merged;
    await supabase.from('admin_users').upsert({
      uid: OWNERSHIP_META_UID,
      email: 'meta@system.local',
      name: JSON.stringify(merged),
      role: 'meta',
    });
  } catch {
    // Ignore
  }
}

function resolveRowProfessor(
  tableKey: string,
  recordId: string,
  row: any
): Required<ProfessorAttribution> {
  if (row?.professor_name) {
    return {
      professorUid: row.professor_uid || DEFAULT_PROFESSOR.professorUid,
      professorName: row.professor_name,
      professorEmail: row.professor_email || DEFAULT_PROFESSOR.professorEmail,
    };
  }
  const fromMeta = cachedOwnershipMap[`${tableKey}:${recordId}`];
  if (fromMeta) {
    return fromMeta;
  }
  return { ...DEFAULT_PROFESSOR };
}

// ----------------------------------------------------
// Row Mappers (snake_case DB <-> camelCase App)
// ----------------------------------------------------

function mapSemesterRow(row: any): SemesterSettings {
  let cachedUrl = '';
  try {
    cachedUrl = localStorage.getItem(`ds_google_form_url_${row.id}`) || '';
  } catch {
    // Ignore
  }
  const prof = resolveRowProfessor('semester_settings', row.id, row);
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
    googleFormUrl: row.google_form_url || cachedUrl || '',
    active: Boolean(row.active),
    professorUid: prof.professorUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClassRow(row: any): ClassSchedule {
  const prof = resolveRowProfessor('class_schedules', row.id, row);
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    startDate: row.start_date,
    endDate: row.end_date,
    professorUid: prof.professorUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
  };
}

function mapPersonalRow(row: any): PersonalSchedule {
  const prof = resolveRowProfessor('personal_schedules', row.id, row);
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title,
    note: row.note || '',
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    professorUid: prof.professorUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
  };
}

function mapSlotLockRow(row: any): SlotLock {
  const prof = resolveRowProfessor('slot_locks', row.id, row);
  let resolvedUid = prof.professorUid;
  if (
    (!row?.professor_uid || resolvedUid === DEFAULT_PROFESSOR.professorUid) &&
    typeof row?.id === 'string' &&
    row.id.startsWith('prof-')
  ) {
    const underscoreIdx = row.id.indexOf('_');
    if (underscoreIdx > 5) {
      resolvedUid = row.id.slice(0, underscoreIdx);
    }
  }
  return {
    id: row.id,
    slotKey: row.slot_key,
    date: row.date,
    time: row.time,
    type: row.type,
    semesterId: row.semester_id,
    referenceId: row.reference_id || undefined,
    professorUid: resolvedUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
  };
}

function mapStudentRow(row: any): StudentRecord {
  const prof = resolveRowProfessor('students', row.id, row);
  return {
    id: row.id,
    semesterId: row.semester_id,
    studentId: row.student_id,
    name: row.name || '',
    active: Boolean(row.active),
    firstSemesterInPerson: row.first_semester_in_person ?? true,
    professorUid: prof.professorUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
  };
}

function mapAppointmentRow(row: any): Appointment {
  const prof = resolveRowProfessor('appointments', row.appointment_id, row);
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
    professorUid: prof.professorUid,
    professorName: prof.professorName,
    professorEmail: prof.professorEmail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----------------------------------------------------
// 1. Semester Management (Supabase)
// ----------------------------------------------------

export async function sbGetActiveSemester(): Promise<SemesterSettings | null> {
  if (!supabase) return null;
  await loadOwnershipMapFromSupabase();

  const { data, error } = await supabase
    .from('semester_settings')
    .select('*')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return mapSemesterRow(data);
  }

  const { data: fallback } = await supabase
    .from('semester_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return fallback ? mapSemesterRow(fallback) : null;
}

export async function sbGetAllSemesters(): Promise<SemesterSettings[]> {
  if (!supabase) return [];
  await loadOwnershipMapFromSupabase();
  const { data, error } = await supabase.from('semester_settings').select('*');
  if (error || !data) return [];
  return data.map(mapSemesterRow);
}

export async function sbSaveSemester(
  semester: SemesterSettings,
  previousSemesterId?: string
): Promise<void> {
  if (!supabase) return;
  try {
    localStorage.setItem(`ds_google_form_url_${semester.id}`, (semester.googleFormUrl || '').trim());
  } catch {
    // Ignore
  }

  const prof = getCurrentProfessorAttribution(semester);

  const basePayload: Record<string, any> = {
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
  };

  const payloadWithProf: Record<string, any> = {
    ...basePayload,
    professor_name: prof.professorName,
    professor_email: prof.professorEmail,
    professor_uid: prof.professorUid,
  };

  // 1. Upsert the target semester row first (with professor columns if present, fallback if not)
  const { error } = await supabase.from('semester_settings').upsert(payloadWithProf);
  if (error) {
    const { error: retryErr } = await supabase.from('semester_settings').upsert(basePayload);
    if (retryErr) {
      const { google_form_url, updated_at, ...minimalPayload } = basePayload;
      const { error: minErr } = await supabase.from('semester_settings').upsert(minimalPayload);
      if (minErr) throw minErr;
    }
  }
  await saveOwnershipForRecord('semester_settings', semester.id, prof);

  // 2. Find any other semester rows (e.g. when year or semester changed from 2026-2 to 2027-1)
  const { data: allSems } = await supabase
    .from('semester_settings')
    .select('id')
    .neq('id', semester.id);

  const oldIds = new Set<string>();
  if (previousSemesterId && previousSemesterId !== semester.id) {
    oldIds.add(previousSemesterId);
  }
  if (allSems) {
    allSems.forEach((r: any) => {
      if (r.id && r.id !== semester.id) oldIds.add(r.id);
    });
  }

  // 3. Migrate child records to the new semester.id and remove stale semester_settings rows
  for (const oldId of oldIds) {
    await supabase
      .from('class_schedules')
      .update({
        semester_id: semester.id,
        start_date: semester.startDate,
        end_date: semester.endDate,
      })
      .eq('semester_id', oldId);

    await supabase
      .from('personal_schedules')
      .update({ semester_id: semester.id })
      .eq('semester_id', oldId);

    await supabase
      .from('appointments')
      .update({ semester_id: semester.id })
      .eq('semester_id', oldId);

    await supabase
      .from('slot_locks')
      .update({ semester_id: semester.id })
      .eq('semester_id', oldId);

    const { data: oldStudents } = await supabase
      .from('students')
      .select('*')
      .eq('semester_id', oldId);

    if (oldStudents && oldStudents.length > 0) {
      const migratedStudents = oldStudents.map((st: any) => ({
        id: `${semester.id}_${st.student_id}`,
        semester_id: semester.id,
        student_id: st.student_id,
        name: st.name || '',
        active: Boolean(st.active),
        first_semester_in_person: st.first_semester_in_person ?? true,
      }));
      await supabase.from('students').upsert(migratedStudents);
      await supabase.from('students').delete().eq('semester_id', oldId);
    }

    await supabase.from('semester_settings').delete().eq('id', oldId);
  }

  await supabase
    .from('class_schedules')
    .update({
      start_date: semester.startDate,
      end_date: semester.endDate,
    })
    .eq('semester_id', semester.id);
}

export function resolveProfessorConsultationSettings(
  prof: ProfessorAttribution,
  settingsMap: Record<string, ProfessorConsultationSettings>,
  fallbackAdminFormUrl = ''
): ProfessorConsultationSettings {
  const uid = (prof.professorUid || DEFAULT_PROFESSOR.professorUid).trim();
  const email = (prof.professorEmail || DEFAULT_PROFESSOR.professorEmail).trim().toLowerCase();
  const name =
    (prof.professorName || DEFAULT_PROFESSOR.professorName)
      .replace(/\s*\(관리자\)\s*$/, '')
      .trim() || DEFAULT_PROFESSOR.professorName;

  const byUid = settingsMap[uid];
  if (byUid) {
    return {
      ...byUid,
      professorUid: uid,
      professorEmail: email,
      professorName: name,
    };
  }

  const byEmail = settingsMap[email];
  if (byEmail) {
    return {
      ...byEmail,
      professorUid: uid,
      professorEmail: email,
      professorName: name,
    };
  }

  const isDefaultAdmin =
    uid === 'admin-professor' || email === 'sungwoopark1224@gmail.com';

  return {
    professorUid: uid,
    professorEmail: email,
    professorName: name,
    onlineEnabled: isDefaultAdmin ? true : false,
    googleFormUrl: isDefaultAdmin ? (fallbackAdminFormUrl || '').trim() : '',
  };
}

export async function sbGetProfessorConsultationSettingsMap(
  fallbackAdminFormUrl = ''
): Promise<Record<string, ProfessorConsultationSettings>> {
  try {
    const localRaw = localStorage.getItem(LOCAL_PROF_SETTINGS_KEY);
    if (localRaw) {
      const parsedLocal = JSON.parse(localRaw);
      if (parsedLocal && typeof parsedLocal === 'object') {
        cachedProfSettingsMap = { ...cachedProfSettingsMap, ...parsedLocal };
      }
    }
  } catch {
    // Ignore
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('name')
        .eq('uid', PROF_SETTINGS_META_UID)
        .maybeSingle();

      if (!error && data?.name) {
        const parsed = JSON.parse(data.name);
        if (parsed && typeof parsed === 'object') {
          cachedProfSettingsMap = { ...cachedProfSettingsMap, ...parsed };
          try {
            localStorage.setItem(LOCAL_PROF_SETTINGS_KEY, JSON.stringify(cachedProfSettingsMap));
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!cachedProfSettingsMap['admin-professor']) {
    cachedProfSettingsMap['admin-professor'] = {
      professorUid: 'admin-professor',
      professorEmail: 'sungwoopark1224@gmail.com',
      professorName: '박성우 교수',
      onlineEnabled: true,
      googleFormUrl: (fallbackAdminFormUrl || '').trim(),
    };
  } else if (
    fallbackAdminFormUrl &&
    !cachedProfSettingsMap['admin-professor'].googleFormUrl
  ) {
    cachedProfSettingsMap['admin-professor'] = {
      ...cachedProfSettingsMap['admin-professor'],
      googleFormUrl: fallbackAdminFormUrl.trim(),
    };
  }

  return { ...cachedProfSettingsMap };
}

export async function sbSaveProfessorConsultationSettings(
  settings: ProfessorConsultationSettings,
  semesterId?: string
): Promise<void> {
  const uid = (settings.professorUid || DEFAULT_PROFESSOR.professorUid).trim();
  const email = (settings.professorEmail || DEFAULT_PROFESSOR.professorEmail)
    .trim()
    .toLowerCase();
  const name =
    (settings.professorName || DEFAULT_PROFESSOR.professorName)
      .replace(/\s*\(관리자\)\s*$/, '')
      .trim() || DEFAULT_PROFESSOR.professorName;

  const cleanEntry: ProfessorConsultationSettings = {
    professorUid: uid,
    professorEmail: email,
    professorName: name,
    onlineEnabled: Boolean(settings.onlineEnabled),
    googleFormUrl: (settings.googleFormUrl || '').trim(),
    updatedAt: new Date().toISOString(),
  };

  const currentMap = await sbGetProfessorConsultationSettingsMap();
  const nextMap: Record<string, ProfessorConsultationSettings> = {
    ...currentMap,
    [uid]: cleanEntry,
    [email]: cleanEntry,
  };
  cachedProfSettingsMap = nextMap;

  try {
    localStorage.setItem(LOCAL_PROF_SETTINGS_KEY, JSON.stringify(nextMap));
  } catch {
    // Ignore
  }

  if (supabase) {
    const { error } = await supabase.from('admin_users').upsert({
      uid: PROF_SETTINGS_META_UID,
      email: 'meta-settings@system.local',
      name: JSON.stringify(nextMap),
      role: 'meta',
    });
    if (error) {
      throw error;
    }

    // If this is the primary admin professor, also keep semester_settings.google_form_url in sync
    if (
      (uid === 'admin-professor' || email === 'sungwoopark1224@gmail.com') &&
      semesterId
    ) {
      await sbUpdateSemesterGoogleFormUrl(semesterId, cleanEntry.googleFormUrl);
    }
  }
}

export async function sbUpdateSemesterGoogleFormUrl(
  semesterId: string,
  googleFormUrl: string
): Promise<void> {
  const cleanUrl = googleFormUrl.trim();
  try {
    localStorage.setItem(`ds_google_form_url_${semesterId}`, cleanUrl);
  } catch {
    // Ignore
  }
  if (!supabase) return;
  const prof = getCurrentProfessorAttribution();
  const { error } = await supabase
    .from('semester_settings')
    .update({
      google_form_url: cleanUrl,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .eq('id', semesterId);

  if (error) {
    const { error: retryErr } = await supabase
      .from('semester_settings')
      .update({
        google_form_url: cleanUrl,
      })
      .eq('id', semesterId);

    if (retryErr) {
      console.warn('Supabase google_form_url update warning:', retryErr.message);
      if (
        !retryErr.message?.includes('google_form_url') &&
        !retryErr.code?.includes('PGRST204') &&
        !retryErr.code?.includes('42703')
      ) {
        throw retryErr;
      }
    }
  }
  await saveOwnershipForRecord('semester_settings', semesterId, prof);
}

// ----------------------------------------------------
// 2. Class Schedules (Supabase)
// ----------------------------------------------------

export async function sbGetClassSchedules(semesterId: string): Promise<ClassSchedule[]> {
  if (!supabase) return [];
  await loadOwnershipMapFromSupabase();
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
  const prof = getCurrentProfessorAttribution(data);

  const basePayload = {
    semester_id: data.semesterId,
    title: data.title,
    weekday: data.weekday,
    start_time: data.startTime,
    end_time: data.endTime,
    start_date: data.startDate,
    end_date: data.endDate,
  };

  let insertedRow: any = null;
  const { data: inserted, error } = await supabase
    .from('class_schedules')
    .insert({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .select()
    .single();

  if (error) {
    const { data: retryInserted, error: retryErr } = await supabase
      .from('class_schedules')
      .insert(basePayload)
      .select()
      .single();
    if (retryErr) throw retryErr;
    insertedRow = retryInserted;
  } else {
    insertedRow = inserted;
  }

  await saveOwnershipForRecord('class_schedules', insertedRow.id, prof);
  return insertedRow.id;
}

export async function sbUpdateClassSchedule(
  scheduleId: string,
  data: Omit<ClassSchedule, 'id' | 'createdAt'>
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const prof = getCurrentProfessorAttribution(data);

  const basePayload = {
    title: data.title,
    weekday: data.weekday,
    start_time: data.startTime,
    end_time: data.endTime,
    start_date: data.startDate,
    end_date: data.endDate,
  };

  const { error } = await supabase
    .from('class_schedules')
    .update({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .eq('id', scheduleId);

  if (error) {
    const { error: retryErr } = await supabase
      .from('class_schedules')
      .update(basePayload)
      .eq('id', scheduleId);
    if (retryErr) throw retryErr;
  }

  await saveOwnershipForRecord('class_schedules', scheduleId, prof);
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
  await loadOwnershipMapFromSupabase();
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
  semesterId: string,
  profOverride?: ProfessorAttribution
): Promise<Appointment[]> {
  if (!supabase) return [];
  await loadOwnershipMapFromSupabase();
  const prof = getCurrentProfessorAttribution(profOverride);

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
    const sameProfessor =
      (apt.professorEmail &&
        apt.professorEmail.toLowerCase() === prof.professorEmail.toLowerCase()) ||
      (apt.professorUid && apt.professorUid === prof.professorUid);

    if (sameProfessor && hasTimeOverlap(apt.startTime, apt.endTime, startTime, endTime)) {
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
  const prof = getCurrentProfessorAttribution(personalData);

  const basePayload = {
    semester_id: personalData.semesterId,
    title: personalData.title,
    note: personalData.note || '',
    date: personalData.date,
    start_time: personalData.startTime,
    end_time: personalData.endTime,
  };

  // 1. Insert personal schedule
  let insertedRow: any = null;
  const { data: inserted, error: insertErr } = await supabase
    .from('personal_schedules')
    .insert({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .select()
    .single();

  if (insertErr) {
    const { data: retryInserted, error: retryErr } = await supabase
      .from('personal_schedules')
      .insert(basePayload)
      .select()
      .single();
    if (retryErr) throw retryErr;
    insertedRow = retryInserted;
  } else {
    insertedRow = inserted;
  }

  await saveOwnershipForRecord('personal_schedules', insertedRow.id, prof);

  // 2. Upsert 30-min slot locks (scoped per professor so other professors' schedules do not collide)
  const slots = generate30MinSlots(personalData.startTime, personalData.endTime);
  const lockPrefix = prof.professorUid === 'admin-professor' ? '' : `${prof.professorUid}_`;
  const baseLocks = slots.map((slotTime) => {
    const lockId = `${lockPrefix}${personalData.date}_${slotTime}`;
    return {
      id: lockId,
      slot_key: lockId,
      date: personalData.date,
      time: slotTime,
      type: 'personal',
      semester_id: personalData.semesterId,
      reference_id: insertedRow.id,
    };
  });

  if (baseLocks.length > 0) {
    const locksWithProf = baseLocks.map((l) => ({
      ...l,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    }));
    const { error: lockErr } = await supabase.from('slot_locks').upsert(locksWithProf);
    if (lockErr) {
      const { error: retryLockErr } = await supabase.from('slot_locks').upsert(baseLocks);
      if (retryLockErr) throw retryLockErr;
    }
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

  return insertedRow.id;
}

export async function sbDeletePersonalSchedule(schedule: PersonalSchedule): Promise<void> {
  if (!supabase) return;
  await supabase.from('personal_schedules').delete().eq('id', schedule.id);

  // 1. Delete locks linked by reference_id
  if (schedule.id) {
    await supabase.from('slot_locks').delete().eq('reference_id', schedule.id);
  }

  // 2. Also delete locks by deterministic slot lock IDs (both default and professor-prefixed)
  const slots = generate30MinSlots(schedule.startTime, schedule.endTime);
  const profUid = schedule.professorUid || 'admin-professor';
  const lockIds = slots.flatMap((slotTime) => [
    `${schedule.date}_${slotTime}`,
    `${profUid}_${schedule.date}_${slotTime}`,
  ]);
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
  const prof = getCurrentProfessorAttribution(updatedData);

  // 1. Remove old slot locks (by reference_id and deterministic IDs)
  if (oldSchedule.id) {
    await supabase.from('slot_locks').delete().eq('reference_id', oldSchedule.id);
  }
  const oldSlots = generate30MinSlots(oldSchedule.startTime, oldSchedule.endTime);
  const oldProfUid = oldSchedule.professorUid || prof.professorUid || 'admin-professor';
  const oldLockIds = oldSlots.flatMap((slotTime) => [
    `${oldSchedule.date}_${slotTime}`,
    `${oldProfUid}_${oldSchedule.date}_${slotTime}`,
  ]);
  if (oldLockIds.length > 0) {
    await supabase.from('slot_locks').delete().in('id', oldLockIds);
  }

  const basePayload = {
    title: updatedData.title,
    note: updatedData.note || '',
    date: updatedData.date,
    start_time: updatedData.startTime,
    end_time: updatedData.endTime,
  };

  // 2. Update personal_schedules row
  const { error: updErr } = await supabase
    .from('personal_schedules')
    .update({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .eq('id', oldSchedule.id);

  if (updErr) {
    const { error: retryErr } = await supabase
      .from('personal_schedules')
      .update(basePayload)
      .eq('id', oldSchedule.id);
    if (retryErr) throw retryErr;
  }

  await saveOwnershipForRecord('personal_schedules', oldSchedule.id, prof);

  // 3. Create new slot locks
  const newSlots = generate30MinSlots(updatedData.startTime, updatedData.endTime);
  const lockPrefix = prof.professorUid === 'admin-professor' ? '' : `${prof.professorUid}_`;
  const baseLocks = newSlots.map((slotTime) => {
    const lockId = `${lockPrefix}${updatedData.date}_${slotTime}`;
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
  if (baseLocks.length > 0) {
    const locksWithProf = baseLocks.map((l) => ({
      ...l,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    }));
    const { error: lockErr } = await supabase.from('slot_locks').upsert(locksWithProf);
    if (lockErr) {
      await supabase.from('slot_locks').upsert(baseLocks);
    }
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
  await loadOwnershipMapFromSupabase();
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('semester_id', semesterId);
  if (error || !data) return [];
  return data.map(mapStudentRow);
}

export async function sbAddStudentsBatch(
  semesterId: string,
  students: Array<{ studentId: string; name?: string; firstSemesterInPerson?: boolean }>,
  profOverride?: ProfessorAttribution
): Promise<number> {
  if (!supabase) return 0;
  const prof = getCurrentProfessorAttribution(profOverride);

  const baseRows = students
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
    .filter(Boolean) as Array<Record<string, any>>;

  if (baseRows.length === 0) return 0;

  const rowsWithProf = baseRows.map((r) => ({
    ...r,
    professor_name: prof.professorName,
    professor_email: prof.professorEmail,
    professor_uid: prof.professorUid,
  }));

  const { error } = await supabase.from('students').upsert(rowsWithProf);
  if (error) {
    const { error: retryErr } = await supabase.from('students').upsert(baseRows);
    if (retryErr) throw retryErr;
  }

  await saveOwnershipForRecords(
    'students',
    baseRows.map((r) => r.id),
    prof
  );

  return baseRows.length;
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
  const prof = getCurrentProfessorAttribution();
  const basePayload = {
    name: updates.name.trim(),
    first_semester_in_person: updates.firstSemesterInPerson,
    active: updates.active,
  };

  const { error } = await supabase
    .from('students')
    .update({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .eq('id', docId);

  if (error) {
    const { error: retryErr } = await supabase
      .from('students')
      .update(basePayload)
      .eq('id', docId);
    if (retryErr) throw retryErr;
  }
  await saveOwnershipForRecord('students', docId, prof);
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
  await loadOwnershipMapFromSupabase();

  const [locksRes, personalRes, aptsRes] = await Promise.all([
    supabase.from('slot_locks').select('*').eq('semester_id', semesterId),
    supabase.from('personal_schedules').select('id').eq('semester_id', semesterId),
    supabase
      .from('appointments')
      .select('appointment_id, status')
      .eq('semester_id', semesterId),
  ]);

  if (locksRes.error || !locksRes.data) return [];

  const validPersonalIds = new Set((personalRes.data || []).map((p: any) => String(p.id)));
  const validConfirmedAptIds = new Set(
    (aptsRes.data || [])
      .filter((a: any) => a.status === 'confirmed')
      .map((a: any) => String(a.appointment_id))
  );

  const orphanLockIds: string[] = [];
  const validRows = locksRes.data.filter((row: any) => {
    if (row.type === 'personal' && row.reference_id && !personalRes.error) {
      if (!validPersonalIds.has(String(row.reference_id))) {
        orphanLockIds.push(row.id);
        return false;
      }
    }
    if (row.type === 'appointment' && row.reference_id && !aptsRes.error) {
      if (!validConfirmedAptIds.has(String(row.reference_id))) {
        orphanLockIds.push(row.id);
        return false;
      }
    }
    return true;
  });

  if (orphanLockIds.length > 0) {
    supabase.from('slot_locks').delete().in('id', orphanLockIds).then(() => {});
  }

  return validRows.map(mapSlotLockRow);
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

    const requestedProf: Required<ProfessorAttribution> = {
      professorUid: (req.professorUid || DEFAULT_PROFESSOR.professorUid).trim(),
      professorName:
        (req.professorName || DEFAULT_PROFESSOR.professorName)
          .replace(/\s*\(관리자\)\s*$/, '')
          .trim() || DEFAULT_PROFESSOR.professorName,
      professorEmail: (req.professorEmail || DEFAULT_PROFESSOR.professorEmail)
        .trim()
        .toLowerCase(),
    };

    // C. Validate student ID in this semester
    await loadOwnershipMapFromSupabase();
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

    const mappedStudent = mapStudentRow(studentRow);
    const studentProfEmail = (mappedStudent.professorEmail || DEFAULT_PROFESSOR.professorEmail)
      .trim()
      .toLowerCase();
    const studentProfUid = (mappedStudent.professorUid || DEFAULT_PROFESSOR.professorUid).trim();
    const studentProfName = (mappedStudent.professorName || DEFAULT_PROFESSOR.professorName)
      .replace(/\s*\(관리자\)\s*$/, '')
      .trim();

    const isMatchingAdvisor =
      (studentProfEmail &&
        requestedProf.professorEmail &&
        studentProfEmail === requestedProf.professorEmail) ||
      (studentProfUid &&
        requestedProf.professorUid &&
        studentProfUid === requestedProf.professorUid) ||
      (studentProfName &&
        requestedProf.professorName &&
        studentProfName === requestedProf.professorName);

    if (!isMatchingAdvisor) {
      return {
        success: false,
        errorMessage: `입력하신 학번(${cleanStudentId})의 배정된 지도교수는 [${studentProfName}]입니다. 상단 '지도교수 선택'에서 [${studentProfName}]을(를) 선택한 후 신청해주세요.`,
        code: 'INVALID_STUDENT',
      };
    }

    const assignedProf: Required<ProfessorAttribution> = {
      professorUid: mappedStudent.professorUid || requestedProf.professorUid,
      professorName: mappedStudent.professorName || requestedProf.professorName,
      professorEmail: mappedStudent.professorEmail || requestedProf.professorEmail,
    };

    if (req.consultationType === 'online') {
      const profSettingsMap = await sbGetProfessorConsultationSettingsMap(
        semester.googleFormUrl || ''
      );
      const profConfig = resolveProfessorConsultationSettings(
        assignedProf,
        profSettingsMap,
        semester.googleFormUrl || ''
      );
      if (!profConfig.onlineEnabled) {
        return {
          success: false,
          errorMessage: `${assignedProf.professorName}님은 현재 비대면 상담을 운영하지 않습니다. 대면 상담으로 신청해주세요.`,
          code: 'OUT_OF_RANGE',
        };
      }
      if (studentRow.first_semester_in_person === false) {
        return {
          success: false,
          errorMessage:
            '올해 처음으로 상담을 진행하는 학생(1학기 대면 상담 미진행)은 반드시 대면 상담을 선택해야 합니다.',
          code: 'INVALID_STUDENT',
        };
      }
    }

    // D. Validate class schedule overlap (scoped to the selected professor)
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
        const clsEmail = (cls.professorEmail || DEFAULT_PROFESSOR.professorEmail)
          .trim()
          .toLowerCase();
        const clsUid = (cls.professorUid || DEFAULT_PROFESSOR.professorUid).trim();
        const clsName = (cls.professorName || DEFAULT_PROFESSOR.professorName)
          .replace(/\s*\(관리자\)\s*$/, '')
          .trim();

        const isSameProfClass =
          (clsEmail && clsEmail === assignedProf.professorEmail.toLowerCase()) ||
          (clsUid && clsUid === assignedProf.professorUid) ||
          (clsName && clsName === assignedProf.professorName);

        if (!isSameProfClass) continue;

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

    // E. Acquire atomic 30-min slot locks via unique constraint on slot_locks(id), scoped per professor
    const lockPrefix =
      assignedProf.professorUid === 'admin-professor' ? '' : `${assignedProf.professorUid}_`;
    const lock1Id = `${lockPrefix}${req.date}_${subSlots[0]}`;
    const lock2Id = `${lockPrefix}${req.date}_${subSlots[1]}`;

    const baseLocks = [
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
    ];

    const locksWithProf = baseLocks.map((l) => ({
      ...l,
      professor_name: assignedProf.professorName,
      professor_email: assignedProf.professorEmail,
      professor_uid: assignedProf.professorUid,
    }));

    const { error: lockErr } = await supabase.from('slot_locks').insert(locksWithProf);
    if (lockErr) {
      const { error: retryLockErr } = await supabase.from('slot_locks').insert(baseLocks);
      if (retryLockErr) {
        return {
          success: false,
          errorMessage: '선택하신 시간이 방금 마감되었습니다. 다른 시간을 선택해주세요.',
          code: 'TIME_CONFLICT',
        };
      }
    }

    const confirmationCode = generateConfirmationCode(req.date);
    const startAt = `${req.date}T${req.startTime}:00+09:00`;
    const endAt = `${req.date}T${endTime}:00+09:00`;

    const baseAptPayload = {
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
    };

    let aptInserted: any = null;
    const { data: insertedWithProf, error: aptErr } = await supabase
      .from('appointments')
      .insert({
        ...baseAptPayload,
        professor_name: assignedProf.professorName,
        professor_email: assignedProf.professorEmail,
        professor_uid: assignedProf.professorUid,
      })
      .select()
      .single();

    if (aptErr) {
      const { data: retryApt, error: retryAptErr } = await supabase
        .from('appointments')
        .insert(baseAptPayload)
        .select()
        .single();
      if (retryAptErr || !retryApt) {
        await supabase.from('slot_locks').delete().in('id', [lock1Id, lock2Id]);
        throw retryAptErr || new Error('Failed to create appointment');
      }
      aptInserted = retryApt;
    } else {
      aptInserted = insertedWithProf;
    }

  if (aptInserted?.appointment_id) {
    await supabase
      .from('slot_locks')
      .update({ reference_id: aptInserted.appointment_id })
      .in('id', [lock1Id, lock2Id]);
  }

    await saveOwnershipForRecords('slot_locks', [lock1Id, lock2Id], assignedProf);
    await saveOwnershipForRecord('appointments', aptInserted.appointment_id, assignedProf);

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
  await loadOwnershipMapFromSupabase();
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

  await supabase.from('slot_locks').delete().eq('reference_id', appointmentId);
  const { subSlots } = getAppointmentSubSlots(apt.startTime, 60);
  const profUid = apt.professorUid || 'admin-professor';
  const lockIds = subSlots.flatMap((slot) => [
    `${apt.date}_${slot}`,
    `${profUid}_${apt.date}_${slot}`,
  ]);
  await supabase.from('slot_locks').delete().in('id', lockIds);
}

export async function sbUpdateAppointmentByAdmin(
  appointmentId: string,
  updates: {
    studentName: string;
    studentId: string;
    phone: string;
    date: string;
    startTime: string;
    consultationType: 'in_person' | 'online';
    status: 'confirmed' | 'canceled';
  }
): Promise<void> {
  if (!supabase) return;
  const prof = getCurrentProfessorAttribution();

  const { data: oldRow } = await supabase
    .from('appointments')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (!oldRow) return;
  const oldApt = mapAppointmentRow(oldRow);
  const oldProfUid = oldApt.professorUid || prof.professorUid || 'admin-professor';

  // 1. Remove old slot locks
  await supabase.from('slot_locks').delete().eq('reference_id', appointmentId);
  const oldSub = getAppointmentSubSlots(oldApt.startTime, 60);
  const oldLockIds = oldSub.subSlots.flatMap((slot) => [
    `${oldApt.date}_${slot}`,
    `${oldProfUid}_${oldApt.date}_${slot}`,
  ]);
  if (oldLockIds.length > 0) {
    await supabase.from('slot_locks').delete().in('id', oldLockIds);
  }

  // 2. Calculate new endTime and timestamps
  const { subSlots: newSubSlots, endTime: newEndTime } = getAppointmentSubSlots(
    updates.startTime,
    60
  );
  const startAt = `${updates.date}T${updates.startTime}:00+09:00`;
  const endAt = `${updates.date}T${newEndTime}:00+09:00`;

  const basePayload = {
    student_name: updates.studentName.trim(),
    student_id: updates.studentId.trim(),
    phone: updates.phone.trim(),
    date: updates.date,
    start_time: updates.startTime,
    end_time: newEndTime,
    start_at: startAt,
    end_at: endAt,
    consultation_type: updates.consultationType,
    status: updates.status,
    updated_at: new Date().toISOString(),
  };

  // 3. Update appointments table
  const { error: updErr } = await supabase
    .from('appointments')
    .update({
      ...basePayload,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    })
    .eq('appointment_id', appointmentId);

  if (updErr) {
    const { error: retryErr } = await supabase
      .from('appointments')
      .update(basePayload)
      .eq('appointment_id', appointmentId);
    if (retryErr) throw retryErr;
  }

  await saveOwnershipForRecord('appointments', appointmentId, prof);

  // 4. If status is confirmed, upsert new slot locks
  if (updates.status === 'confirmed') {
    const lockPrefix = prof.professorUid === 'admin-professor' ? '' : `${prof.professorUid}_`;
    const baseLocks = newSubSlots.map((slot) => {
      const lockId = `${lockPrefix}${updates.date}_${slot}`;
      return {
        id: lockId,
        slot_key: lockId,
        date: updates.date,
        time: slot,
        type: 'appointment',
        semester_id: oldApt.semesterId,
        reference_id: appointmentId,
      };
    });
    const locksWithProf = baseLocks.map((l) => ({
      ...l,
      professor_name: prof.professorName,
      professor_email: prof.professorEmail,
      professor_uid: prof.professorUid,
    }));
    const { error: lockErr } = await supabase.from('slot_locks').upsert(locksWithProf);
    if (lockErr) {
      await supabase.from('slot_locks').upsert(baseLocks);
    }
  }
}

export async function sbDeleteAppointmentByAdmin(appointmentId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('slot_locks').delete().eq('reference_id', appointmentId);
  const { data: aptRow } = await supabase
    .from('appointments')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (aptRow) {
    const apt = mapAppointmentRow(aptRow);
    const profUid = apt.professorUid || 'admin-professor';
    const { subSlots } = getAppointmentSubSlots(apt.startTime, 60);
    const lockIds = subSlots.flatMap((slot) => [
      `${apt.date}_${slot}`,
      `${profUid}_${apt.date}_${slot}`,
    ]);
    if (lockIds.length > 0) {
      await supabase.from('slot_locks').delete().in('id', lockIds);
    }
  }

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('appointment_id', appointmentId);
  if (error) throw error;
}
