import { Timestamp } from 'firebase/firestore';

export type ConsultationType = 'in_person' | 'online';

export interface ProfessorAttribution {
  professorUid?: string;   // e.g. "admin-professor" or "prof-..."
  professorName?: string;  // e.g. "박성우 교수"
  professorEmail?: string; // e.g. "sungwoopark1224@gmail.com"
}

export interface ProfessorConsultationSettings {
  professorUid: string;
  professorEmail: string;
  professorName: string;
  onlineEnabled: boolean;
  googleFormUrl: string;
  updatedAt?: string;
}

export interface SemesterSettings extends ProfessorAttribution {
  id: string; // e.g. "2026-2"
  year: number;
  semester: 1 | 2;
  title: string; // e.g. "2026학년도 2학기"
  startDate: string; // "YYYY-MM-DD" e.g. "2026-09-01"
  endDate: string;   // "YYYY-MM-DD" e.g. "2026-12-31"
  timezone: string;  // "Asia/Seoul"
  dayStart: string;  // "09:00"
  dayEnd: string;    // "18:00"
  slotMinutes: number; // 30
  appointmentMinutes: number; // 60
  googleFormUrl?: string; // 비대면 상담용 구글폼 사전 작성 링크
  active: boolean;
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface ClassSchedule extends ProfessorAttribution {
  id: string;
  semesterId: string;
  title: string;
  weekday: Weekday; // 'monday', 'tuesday', etc.
  startTime: string; // "10:30"
  endTime: string;   // "12:00"
  startDate: string; // "2026-09-01"
  endDate: string;   // "2026-12-15"
  createdAt: Timestamp | string;
}

export interface PersonalSchedule extends ProfessorAttribution {
  id: string;
  semesterId: string;
  title: string;
  note?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "14:30"
  endTime: string;   // "16:00"
  createdAt: Timestamp | string;
}

export type AppointmentStatus = 'confirmed' | 'canceled';
export type CancellationReason = 'professor_schedule_conflict' | 'class_schedule_change' | 'manual_admin_cancel' | 'student_cancel';

export interface Appointment extends ProfessorAttribution {
  appointmentId: string;
  semesterId: string;
  studentName: string;
  studentId: string;
  phone: string;
  consultationType?: ConsultationType; // 'in_person' (대면) | 'online' (비대면)
  date: string; // "YYYY-MM-DD"
  startTime: string; // "14:30"
  endTime: string;   // "15:30"
  startAt: string;   // ISO String in Asia/Seoul or standard UTC ISO
  endAt: string;
  status: AppointmentStatus;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
  canceledAt?: Timestamp | string;
  cancellationReason?: CancellationReason;
  canceledBy?: 'admin' | 'system' | 'student';
  confirmationCode?: string;
}

export type SlotLockType = 'appointment' | 'personal' | 'class';

export interface SlotLock extends ProfessorAttribution {
  id: string; // Document ID: `${date}_${time}` e.g. "2026-09-23_14:30"
  slotKey: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "14:30"
  type: SlotLockType;
  semesterId: string;
  referenceId?: string; // appointmentId or personalScheduleId or classScheduleId
  createdAt: Timestamp | string;
}

export interface StudentRecord extends ProfessorAttribution {
  id: string; // e.g. `${semesterId}_${studentId}`
  semesterId: string;
  studentId: string;
  name?: string;
  active: boolean;
  firstSemesterInPerson?: boolean; // 올해(1학기) 대면 상담 완료 여부 (true: 비대면 신청 가능, false: 대면 필수)
  createdAt: Timestamp | string;
}

export interface AdminUser {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'professor' | 'superadmin';
  createdAt: Timestamp | string;
}

// Available time slot summary for the student UI
export interface TimeSlotOption {
  time: string;       // e.g. "09:00"
  endTime: string;    // e.g. "10:00" (always +60min)
  available: boolean; // true if both time and time+30m are free
  reason?: string;    // UI hint (internal, shown generically as "예약 불가")
}

export interface DayAvailability {
  date: string; // "YYYY-MM-DD"
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  status: 'fully_available' | 'partially_available' | 'unavailable' | 'closed';
  availableCount: number;
  totalSlots: number;
}
