import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SemesterSettings, SlotLock, ClassSchedule } from '../types';
import {
  isDateInRange,
  isPastDate,
  pad2,
  getDayOfWeek,
  getWeekdayNameEn,
  getNowSeoul,
  getKoreanHoliday,
  generateEligibleAppointmentStarts,
  getAppointmentSubSlots,
  hasTimeOverlap,
} from '../lib/dateUtils';

interface StudentCalendarProps {
  currentMonth: Date; // 1st of display month
  onMonthChange: (newMonth: Date) => void;
  selectedDate: string; // "YYYY-MM-DD"
  onSelectDate: (date: string) => void;
  semester: SemesterSettings;
  slotLocks: SlotLock[];
  classSchedules?: ClassSchedule[];
}

export const StudentCalendar: React.FC<StudentCalendarProps> = ({
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  semester,
  slotLocks,
  classSchedules = [],
}) => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth(); // 0-indexed

  const { dateStr: todayStr } = getNowSeoul();

  // Compute start/end constraints for month navigation based on semester range & today's date
  const semesterStart = new Date(semester.startDate);
  const semesterEnd = new Date(semester.endDate);
  const [todayY, todayM] = todayStr.split('-').map(Number);
  const currentTodayMonthStart = new Date(todayY, todayM - 1, 1);

  const canGoPrev = useMemo(() => {
    const prevMonthStart = new Date(year, month - 1, 1);
    const endOfPrevMonth = new Date(year, month, 0);
    return endOfPrevMonth >= semesterStart && prevMonthStart >= currentTodayMonthStart;
  }, [year, month, semesterStart, currentTodayMonthStart]);

  const canGoNext = useMemo(() => {
    const nextMonthStart = new Date(year, month + 1, 1);
    return nextMonthStart <= semesterEnd;
  }, [year, month, semesterEnd]);

  const handlePrevMonth = () => {
    if (canGoPrev) {
      onMonthChange(new Date(year, month - 1, 1));
    }
  };

  const handleNextMonth = () => {
    if (canGoNext) {
      onMonthChange(new Date(year, month + 1, 1));
    }
  };

  // Calendar cells generation
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0: Sun, 1: Mon...

  const calendarDays = useMemo(() => {
    const eligibleStartSlots = generateEligibleAppointmentStarts(
      semester.dayStart || '09:00',
      semester.dayEnd || '18:00',
      semester.appointmentMinutes || 60
    );

    const days: Array<{
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isInSemester: boolean;
      isPast: boolean;
      isToday: boolean;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName?: string;
      lockedCount: number;
      availableSlotCount: number;
    }> = [];

    // Empty lead cells
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({
        dateStr: '',
        dayNum: 0,
        isCurrentMonth: false,
        isInSemester: false,
        isPast: false,
        isToday: false,
        isWeekend: false,
        isHoliday: false,
        holidayName: undefined,
        lockedCount: 0,
        availableSlotCount: 0,
      });
    }

    // Days of current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      const inRange = isDateInRange(dateStr, semester.startDate, semester.endDate);
      const isPast = isPastDate(dateStr);
      const dayOfWeek = getDayOfWeek(dateStr);
      const weekdayName = getWeekdayNameEn(dayOfWeek);
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const holidayInfo = getKoreanHoliday(dateStr);
      const isHoliday = holidayInfo.isHoliday;
      const holidayName = holidayInfo.name;

      const dayLocks = slotLocks.filter((l) => l.date === dateStr);
      const locked30MinTimes = new Set(dayLocks.map((l) => l.time));
      const activeClasses = classSchedules.filter(
        (cs) => cs.weekday === weekdayName && isDateInRange(dateStr, cs.startDate, cs.endDate)
      );

      let availableSlotCount = 0;
      if (inRange && !isPast && !isWeekend && !isHoliday) {
        for (const startTime of eligibleStartSlots) {
          const { subSlots, endTime } = getAppointmentSubSlots(startTime, 60);
          const hasLock = subSlots.some((sub) => locked30MinTimes.has(sub));
          if (hasLock) continue;
          const hasClass = activeClasses.some((cls) =>
            hasTimeOverlap(startTime, endTime, cls.startTime, cls.endTime)
          );
          if (!hasClass) {
            availableSlotCount++;
          }
        }
      }

      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true,
        isInSemester: inRange,
        isPast,
        isToday: dateStr === todayStr,
        isWeekend,
        isHoliday,
        holidayName,
        lockedCount: dayLocks.length,
        availableSlotCount,
      });
    }

    return days;
  }, [year, month, daysInMonth, firstDayIndex, semester, todayStr, slotLocks, classSchedules]);

  return (
    <motion.div
      id="student-calendar-card"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-7 relative overflow-hidden"
    >
      {/* Luxury Burgundy Top Accent Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-[#B70050]" />

      {/* Month Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#B70050] mb-1">
            <CalendarIcon className="w-3.5 h-3.5 text-[#B70050]" />
            <span>상담 가능 일정 조회</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight tabular-nums">
            {year}년 {month + 1}월
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            상담을 원하는 평일 날짜를 선택해주세요
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-neutral-50 p-1 rounded-xl border border-neutral-200 self-start sm:self-center">
          <button
            id="btn-calendar-prev-month"
            type="button"
            onClick={handlePrevMonth}
            disabled={!canGoPrev}
            className="p-2 rounded-lg bg-white border border-neutral-200/80 hover:border-[#B70050] hover:text-[#B70050] text-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label="이전 달 이동"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3 text-xs sm:text-sm font-semibold text-neutral-800 tabular-nums whitespace-nowrap">
            {month + 1}월
          </div>
          <button
            id="btn-calendar-next-month"
            type="button"
            onClick={handleNextMonth}
            disabled={!canGoNext}
            className="p-2 rounded-lg bg-white border border-neutral-200/80 hover:border-[#B70050] hover:text-[#B70050] text-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label="다음 달 이동"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-neutral-100 my-4" />

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center mb-2">
        {['일', '월', '화', '수', '목', '금', '토'].map((name, i) => (
          <div
            key={name}
            className={`text-xs font-semibold py-2 ${
              i === 0 ? 'text-[#B70050]' : i === 6 ? 'text-neutral-500' : 'text-neutral-600'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="grid grid-cols-7 gap-1 sm:gap-2"
        >
          {calendarDays.map((item, idx) => {
            if (!item.isCurrentMonth) {
              return <div key={`empty-${idx}`} className="h-12 sm:h-15" />;
            }

            const isWeekdayOpen = item.isInSemester && !item.isPast && !item.isWeekend && !item.isHoliday;
            const isSelectable = isWeekdayOpen && item.availableSlotCount > 0;
            const isSelected = item.dateStr === selectedDate;

            let btnClass =
              'bg-white text-neutral-800 border-neutral-200/80 hover:border-[#B70050] hover:bg-[#FDF2F6]/60 hover:text-[#B70050]';
            if (item.isPast) {
              btnClass =
                'text-neutral-300 bg-neutral-100/70 border-neutral-100 opacity-50 cursor-not-allowed select-none pointer-events-none';
            } else if (!isSelectable) {
              if (item.isHoliday) {
                btnClass = 'text-rose-600 bg-rose-50/40 border-rose-200/60 cursor-not-allowed';
              } else {
                btnClass = 'text-neutral-300 bg-neutral-50/60 border-transparent cursor-not-allowed';
              }
            }
            if (isSelected && !item.isPast) {
              btnClass =
                'bg-[#B70050] text-white font-bold border-[#B70050] ring-2 ring-[#B70050]/25 shadow-xs';
            } else if (item.isToday) {
              btnClass = isSelectable
                ? 'border-2 border-[#B70050] font-bold text-[#B70050] bg-[#FDF2F6]/50 ring-2 ring-[#B70050]/15'
                : 'border-2 border-[#B70050]/50 font-bold text-[#B70050] bg-[#FDF2F6]/30 cursor-not-allowed';
            }

            return (
              <button
                key={item.dateStr}
                id={`calendar-day-${item.dateStr}`}
                type="button"
                disabled={!isSelectable || item.isPast}
                onClick={() => {
                  if (isSelectable && !item.isPast) {
                    onSelectDate(item.dateStr);
                  }
                }}
                className={`h-12 sm:h-15 rounded-xl border flex flex-col items-center justify-between p-1.5 sm:p-2 text-sm transition-all relative ${
                  isSelectable && !item.isPast ? 'cursor-pointer' : 'cursor-not-allowed'
                } ${btnClass}`}
                aria-label={
                  item.isPast
                    ? `${item.dateStr} - 지난 날짜 선택 불가`
                    : item.isHoliday
                    ? `${item.dateStr} (${item.holidayName || '법정공휴일'}) - 공휴일 신청 불가`
                    : `${item.dateStr} 선택`
                }
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`text-xs sm:text-sm tabular-nums ${
                      item.isPast
                        ? 'text-neutral-300 line-through'
                        : item.isHoliday && !isSelected
                        ? 'text-rose-600 font-bold'
                        : item.isWeekend && !isSelected
                        ? 'text-neutral-400'
                        : ''
                    }`}
                  >
                    {item.dayNum}
                  </span>
                  {item.isToday && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                        isSelected
                          ? 'bg-white text-[#B70050] font-bold'
                          : 'bg-[#B70050] text-white font-bold'
                      }`}
                    >
                      오늘
                    </span>
                  )}
                </div>

                {/* Status indicator / Holiday label */}
                {item.isPast ? (
                  <span className="text-[9px] sm:text-[10px] text-neutral-300 hidden md:inline">
                    마감
                  </span>
                ) : item.isHoliday ? (
                  <div className="w-full flex justify-center overflow-hidden">
                    <span className="text-[9px] sm:text-[10px] text-rose-600 font-medium truncate max-w-full leading-tight">
                      {item.holidayName || '공휴일'}
                    </span>
                  </div>
                ) : isSelectable ? (
                  <div className="flex items-center gap-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-white' : 'bg-[#B70050]'
                      }`}
                    />
                    <span
                      className={`text-[10px] hidden md:inline ${
                        isSelected ? 'text-white/90 font-medium' : 'text-neutral-500'
                      }`}
                    >
                      신청가능
                    </span>
                  </div>
                ) : isWeekdayOpen && item.availableSlotCount === 0 ? (
                  <span className="text-[9px] sm:text-[10px] text-neutral-400 hidden md:inline">
                    일정마감
                  </span>
                ) : null}
              </button>
            );
          })}
        </motion.div>
      </AnimatePresence>

      {/* Calendar Legend */}
      <div className="mt-6 pt-4 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-neutral-500 gap-3">
        <div className="flex items-center flex-wrap gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#B70050]" />
            <span className="text-neutral-700 font-medium">선택 / 신청 가능</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="text-neutral-600 font-medium">법정공휴일 (신청 불가)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-neutral-300" />
            <span className="text-neutral-400">신청 불가 (과거/주말)</span>
          </div>
        </div>
        <div className="text-xs text-neutral-400 tabular-nums">
          학기 일정: {semester.startDate} ~ {semester.endDate}
        </div>
      </div>
    </motion.div>
  );
};
