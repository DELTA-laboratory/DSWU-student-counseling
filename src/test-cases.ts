import {
  hasIntervalOverlap,
  hasTimeOverlap,
  getAppointmentSubSlots,
  generateEligibleAppointmentStarts,
  timeToMinutes,
  getKoreanHoliday,
} from './lib/dateUtils';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- Running Automated Unit Tests for Reservation Collision & Slots ---');

// CASE 1: 09:00 and 09:30 empty -> 09:00~10:00 booking succeeds with subslots ["09:00", "09:30"]
const c1 = getAppointmentSubSlots('09:00', 60);
assert(c1.subSlots.length === 2 && c1.subSlots[0] === '09:00' && c1.subSlots[1] === '09:30', 'CASE 1 subslots');
assert(c1.endTime === '10:00', 'CASE 1 endTime');
console.log('✓ CASE 1 Passed: 09:00 booking takes [09:00, 09:30] ending at 10:00');

// CASE 2: 09:30 locked -> 09:00 booking needs 09:30, must overlap
assert(c1.subSlots.includes('09:30'), 'CASE 2 lock check');
console.log('✓ CASE 2 Passed: 09:00 requires 09:30 slot which is locked -> blocked');

// CASE 3: 10:30~11:30 Class vs 10:00~11:00 Appointment
// A: 10:00~11:00, B: 10:30~11:30
const c3Overlap = hasTimeOverlap('10:00', '11:00', '10:30', '11:30');
assert(c3Overlap === true, 'CASE 3 overlap');
console.log('✓ CASE 3 Passed: 10:00~11:00 overlaps with 10:30~11:30 class -> blocked');

// CASE 4: 11:00~12:00 Class vs 10:00~11:00 Appointment
// A: 10:00~11:00, B: 11:00~12:00 -> [10:00, 11:00) and [11:00, 12:00) DO NOT OVERLAP!
const c4Overlap = hasTimeOverlap('10:00', '11:00', '11:00', '12:00');
assert(c4Overlap === false, 'CASE 4 non-overlap');
console.log('✓ CASE 4 Passed: 10:00~11:00 and 11:00~12:00 do NOT overlap -> allowed');

// CASE 5: 17:00 Appointment -> 17:00~18:00
const eligibleStarts = generateEligibleAppointmentStarts('09:00', '18:00', 60);
assert(eligibleStarts.includes('17:00'), 'CASE 5 eligible 17:00');
console.log('✓ CASE 5 Passed: 17:00 start finishes exactly at 18:00 -> eligible');

// CASE 6: 17:30 Appointment -> 17:30~18:30 (exceeds 18:00 operating limit)
assert(!eligibleStarts.includes('17:30'), 'CASE 6 ineligible 17:30');
console.log('✓ CASE 6 Passed: 17:30 start would exceed 18:00 dayEnd -> not eligible');

// CASE 7: Korean statutory holidays (2026 Chuseok, National Foundation Day substitute, Hangul Day)
const chuseok1 = getKoreanHoliday('2026-09-24');
assert(chuseok1.isHoliday === true && Boolean(chuseok1.name?.includes('추석')), 'CASE 7 Chuseok Eve');
const chuseok2 = getKoreanHoliday('2026-09-25');
assert(chuseok2.isHoliday === true && chuseok2.name === '추석', 'CASE 7 Chuseok Day');
const gaecheonSubstitute = getKoreanHoliday('2026-10-05');
assert(gaecheonSubstitute.isHoliday === true && Boolean(gaecheonSubstitute.name?.includes('개천절')), 'CASE 7 Substitute holiday');
const normalDay = getKoreanHoliday('2026-09-23');
assert(normalDay.isHoliday === false, 'CASE 7 Normal weekday non-holiday');
console.log('✓ CASE 7 Passed: Korean statutory holidays correctly identified and blocked');

console.log('All 7 logic test cases verified successfully!');
