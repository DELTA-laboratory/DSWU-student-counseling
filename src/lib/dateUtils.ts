/**
 * Date and Time utilities strictly for Asia/Seoul (KST, UTC+9)
 * and [start, end) interval collision checking.
 */

// Format numbers to 2-digit strings
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Convert "HH:mm" string to total minutes since midnight
export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Convert minutes since midnight to "HH:mm"
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Returns true if two intervals [startA, endA) and [startB, endB) overlap.
 * Logical formula: startA < endB && startB < endA
 *
 * Example:
 * 10:00~11:00 and 11:00~12:00 -> 600 < 720 && 660 < 660 (false) -> NO overlap
 * 10:00~11:00 and 10:30~11:30 -> 600 < 690 && 630 < 660 (true) -> OVERLAP
 */
export function hasIntervalOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

export function hasTimeOverlap(
  startAStr: string,
  endAStr: string,
  startBStr: string,
  endBStr: string
): boolean {
  const startA = timeToMinutes(startAStr);
  const endA = timeToMinutes(endAStr);
  const startB = timeToMinutes(startBStr);
  const endB = timeToMinutes(endBStr);
  return hasIntervalOverlap(startA, endA, startB, endB);
}

/**
 * Generate all 30-minute slot times between dayStart and dayEnd.
 * e.g., 09:00 to 18:00 gives:
 * ["09:00", "09:30", "10:00", ..., "17:30"]
 */
export function generate30MinSlots(dayStart = '09:00', dayEnd = '18:00'): string[] {
  const startMin = timeToMinutes(dayStart);
  const endMin = timeToMinutes(dayEnd);
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += 30) {
    slots.push(minutesToTime(m));
  }
  return slots;
}

/**
 * Valid student appointment start slots:
 * Since each appointment takes 60 minutes (2 consecutive 30-min slots),
 * the latest start time for 18:00 end is 17:00 (17:00 ~ 18:00).
 * 17:30 would end at 18:30 (exceeds dayEnd).
 */
export function generateEligibleAppointmentStarts(dayStart = '09:00', dayEnd = '18:00', durationMin = 60): string[] {
  const startMin = timeToMinutes(dayStart);
  const endMin = timeToMinutes(dayEnd);
  const slots: string[] = [];
  for (let m = startMin; m + durationMin <= endMin; m += 30) {
    slots.push(minutesToTime(m));
  }
  return slots;
}

/**
 * Given a start time "14:30" and duration 60 minutes:
 * Returns the two 30-minute sub-slot keys: ["14:30", "15:00"] and end time "15:30"
 */
export function getAppointmentSubSlots(startTimeStr: string, durationMinutes = 60): { subSlots: string[]; endTime: string } {
  const startMin = timeToMinutes(startTimeStr);
  const endMin = startMin + durationMinutes;
  const subSlots: string[] = [];
  for (let m = startMin; m < endMin; m += 30) {
    subSlots.push(minutesToTime(m));
  }
  return {
    subSlots,
    endTime: minutesToTime(endMin),
  };
}

/**
 * Returns current date/time string formatted in Asia/Seoul
 */
export function getNowSeoul(): { dateStr: string; timeStr: string; full: Date } {
  // Asia/Seoul is UTC+9
  const now = new Date();
  const seoulFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = seoulFormatter.formatToParts(now);
  const mapping: Record<string, string> = {};
  for (const p of parts) {
    mapping[p.type] = p.value;
  }
  const dateStr = `${mapping.year}-${mapping.month}-${mapping.day}`;
  const timeStr = `${mapping.hour}:${mapping.minute}`;
  return { dateStr, timeStr, full: now };
}

/**
 * Format a YYYY-MM-DD string into Korean format
 * e.g., "2026-09-23" -> "2026년 9월 23일 (수)"
 */
export function formatKoreanDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = weekdays[date.getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${dayName})`;
}

/**
 * Returns day of week (0: Sun, 1: Mon, ... 6: Sat) for a "YYYY-MM-DD" in UTC/neutral
 */
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.getUTCDay();
}

export function getWeekdayNameEn(dayIndex: number): string {
  const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return map[dayIndex] || 'sunday';
}

export function getWeekdayNameKo(dayIndex: number): string {
  const map = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return map[dayIndex] || '';
}

/**
 * Check if targetDateStr is between startDateStr and endDateStr (inclusive)
 */
export function isDateInRange(targetDateStr: string, startDateStr: string, endDateStr: string): boolean {
  return targetDateStr >= startDateStr && targetDateStr <= endDateStr;
}

/**
 * Check if targetDateStr is strictly in the past compared to today in Asia/Seoul
 */
export function isPastDate(targetDateStr: string): boolean {
  const { dateStr: todayStr } = getNowSeoul();
  return targetDateStr < todayStr;
}

/**
 * Generate a friendly confirmation code, e.g. "APT-2609-8421"
 */
export function generateConfirmationCode(dateStr: string): string {
  const cleanDate = dateStr.replace(/-/g, '').slice(2); // e.g. 260923
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `APT-${cleanDate}-${randomDigits}`;
}

/**
 * Format Korean phone numbers automatically:
 * e.g. "01012345678" -> "010-1234-5678"
 */
export function formatPhoneNumber(val: string): string {
  const cleaned = val.replace(/[^0-9]/g, '');
  if (cleaned.length < 4) return cleaned;
  if (cleaned.length < 8) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }
  if (cleaned.length <= 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  }
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
}

// Re-export Korean holiday utilities
export {
  getKoreanHoliday,
  isKoreanHoliday,
  getKoreanHolidayName,
  type HolidayInfo,
} from './koreanHolidays';
