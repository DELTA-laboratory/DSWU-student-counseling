import React, { useState, useEffect } from 'react';
import {
  Clock,
  User,
  Phone,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Check,
  Ban,
  MapPin,
  Video,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimeSlotOption, SemesterSettings, Appointment, ConsultationType } from '../types';
import { formatKoreanDate, formatPhoneNumber, getKoreanHoliday } from '../lib/dateUtils';
import { appointmentFormSchema } from '../lib/validation';
import { bookAppointmentAtomic } from '../lib/firestoreService';

interface StudentBookingPanelProps {
  selectedDate: string; // "YYYY-MM-DD"
  timeSlots: TimeSlotOption[];
  semester: SemesterSettings;
  loadingSlots: boolean;
  onBookingSuccess: (appointment: Appointment) => void;
}

export const StudentBookingPanel: React.FC<StudentBookingPanelProps> = ({
  selectedDate,
  timeSlots,
  semester,
  loadingSlots,
  onBookingSuccess,
}) => {
  const [selectedTime, setSelectedTime] = useState<string>(''); // e.g. "14:30"
  const [consultationType, setConsultationType] = useState<ConsultationType>('in_person');
  const [studentName, setStudentName] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [phone, setPhone] = useState<string>('');

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isFirstSemester = semester.semester === 1;

  // Enforce in_person if semester is 1st semester
  useEffect(() => {
    if (isFirstSemester && consultationType === 'online') {
      setConsultationType('in_person');
    }
  }, [isFirstSemester, consultationType]);

  const holiday = getKoreanHoliday(selectedDate);

  // Auto-calculated 60-min end time
  const selectedSlot = timeSlots.find((s) => s.time === selectedTime);
  const endTimeDisplay = selectedSlot?.endTime || '';

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setPhone(formatPhoneNumber(raw));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFormErrors({});

    if (!selectedTime) {
      setServerError('상담 시작 시간을 먼저 선택해주세요.');
      return;
    }

    // Client-side validation with Zod
    const validationResult = appointmentFormSchema.safeParse({
      studentName,
      studentId,
      phone,
      date: selectedDate,
      startTime: selectedTime,
      consultationType,
    });

    if (!validationResult.success) {
      const fieldErrors: Record<string, string> = {};
      const issues = validationResult.error.issues;
      issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[issue.path[0].toString()] = issue.message;
        }
      });
      setFormErrors(fieldErrors);
      return;
    }

    setSubmitting(true);

    try {
      const res = await bookAppointmentAtomic({
        semesterId: semester.id,
        studentName,
        studentId,
        phone,
        consultationType,
        date: selectedDate,
        startTime: selectedTime,
      });

      if (res.success && res.appointment) {
        onBookingSuccess(res.appointment);
      } else {
        setServerError(res.errorMessage || '상담 신청에 실패했습니다.');
      }
    } catch (err: any) {
      setServerError('네트워크 또는 시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedDate) {
    return (
      <motion.div
        id="booking-panel-empty"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="bg-white rounded-2xl border border-neutral-200 p-8 flex flex-col items-center justify-center text-center min-h-[440px] relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-neutral-200" />
        <div className="w-16 h-16 rounded-2xl bg-[#FDF2F6] border border-[#F5C2D7] flex items-center justify-center text-[#B70050] mb-4">
          <Clock className="w-8 h-8 stroke-[1.75]" />
        </div>
        <h3 className="text-lg font-bold text-neutral-900 mb-1.5">상담 희망 일자를 먼저 선택해주세요</h3>
        <p className="text-xs sm:text-sm text-neutral-500 max-w-xs leading-relaxed mb-4">
          좌측 캘린더에서 원하시는 평일 날짜를 클릭하시면 해당 일자의 1시간 단위 상담 가능 시간을 즉시 조회할 수 있습니다.
        </p>
        <div className="inline-flex items-center gap-1.5 text-neutral-500 text-xs font-medium">
          <Calendar className="w-3.5 h-3.5 text-[#B70050]" />
          <span>캘린더 날짜 클릭 대기 중</span>
        </div>
      </motion.div>
    );
  }

  const availableCount = timeSlots.filter((s) => s.available).length;

  return (
    <motion.div
      id="booking-panel"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-7 flex flex-col relative overflow-hidden"
    >
      {/* Luxury Burgundy Top Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-[#B70050]" />

      {/* Selected Date Header */}
      <div className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-bold text-[#B70050] uppercase tracking-wider">
              선택한 상담 일자
            </span>
            <h3 className="text-lg sm:text-xl font-bold text-neutral-900 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{formatKoreanDate(selectedDate)}</span>
              {holiday.isHoliday && (
                <span className="text-xs font-semibold text-rose-600">
                  · {holiday.name} (법정공휴일)
                </span>
              )}
            </h3>
          </div>
          {selectedTime && !holiday.isHoliday && (
            <div className="px-3 py-1.5 bg-[#FDF2F6] border border-[#F5C2D7] text-[#B70050] rounded-xl text-xs font-bold tabular-nums self-start sm:self-center whitespace-nowrap">
              {selectedTime} ~ {endTimeDisplay} (60분)
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-neutral-100 my-3" />

      {holiday.isHoliday ? (
        <div
          id="holiday-blocked-notice"
          className="p-8 bg-rose-50/50 border border-rose-200/80 rounded-2xl text-center my-auto flex flex-col items-center justify-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-3.5">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h4 className="text-lg font-bold text-neutral-900 mb-1.5">
            {holiday.name} (대한민국 법정공휴일)
          </h4>
          <p className="text-xs sm:text-sm text-neutral-600 max-w-sm leading-relaxed mb-4">
            관공서의 공휴일에 관한 규정에 따른 법정공휴일로 지정되어 있어 상담 신청이 불가능합니다.
          </p>
          <div className="text-xs text-rose-700 font-semibold">
            달력에서 공휴일 및 주말을 제외한 평일 날짜를 선택해주세요.
          </div>
        </div>
      ) : (
        <>
          {/* Available Time Slots Grid */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs sm:text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#B70050]" />
                <span>상담 시작 시간 선택 (30~60분 진행)</span>
              </label>
              <span className="text-xs font-semibold text-[#B70050] tabular-nums">
                {availableCount}개 시간 신청 가능
              </span>
            </div>

            {/* Intuitive visual legend */}
            <div className="flex items-center flex-wrap gap-4 mb-3.5 text-xs text-neutral-600 bg-neutral-50 px-3.5 py-2 rounded-xl border border-neutral-200/60">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-[#B70050] shrink-0" />
                <span className="text-neutral-800 font-medium">신청 가능</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#B70050] shrink-0" />
                <span className="text-neutral-800 font-medium">선택됨</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 shrink-0" />
                <span className="text-neutral-400">신청 불가 (수업/마감)</span>
              </div>
            </div>

            {loadingSlots ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <div key={n} className="h-16 bg-neutral-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : timeSlots.length === 0 || timeSlots.every((s) => !s.available) ? (
              <div className="p-6 bg-neutral-50 rounded-xl text-center text-xs sm:text-sm text-neutral-500 border border-neutral-200/60 leading-relaxed">
                선택하신 날짜에는 교수님의 수업 또는 선신청 일정으로 인해 신청 가능한 시간이 없습니다. 다른 날짜를 선택해주세요.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {timeSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  const isAvailable = slot.available;

                  return (
                    <button
                      key={slot.time}
                      id={`time-slot-${slot.time.replace(':', '')}`}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => {
                        setSelectedTime(slot.time);
                        setServerError(null);
                      }}
                      className={`relative p-3 rounded-xl text-left flex flex-col justify-between transition-all border ${
                        !isAvailable
                          ? 'bg-neutral-100/70 border-dashed border-neutral-200 text-neutral-400 opacity-55 cursor-not-allowed select-none'
                          : isSelected
                          ? 'bg-[#B70050] border-[#B70050] text-white shadow-sm ring-2 ring-[#B70050]/25 cursor-pointer'
                          : 'bg-white border-neutral-200 text-neutral-900 hover:border-[#B70050] hover:bg-[#FDF2F6]/50 cursor-pointer'
                      }`}
                    >
                      {/* Top status row */}
                      <div className="flex items-center justify-between w-full mb-1">
                        <span
                          className={`text-[11px] font-bold ${
                            !isAvailable
                              ? 'text-neutral-400'
                              : isSelected
                              ? 'text-white'
                              : 'text-[#B70050]'
                          }`}
                        >
                          {!isAvailable ? '신청 불가' : isSelected ? '선택됨' : '신청 가능'}
                        </span>
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                        ) : !isAvailable ? (
                          <Ban className="w-3.5 h-3.5 text-neutral-300" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-[#B70050]" />
                        )}
                      </div>

                      {/* Main Time display */}
                      <div className="mt-0.5 tabular-nums">
                        <span
                          className={`text-base font-bold tracking-tight block ${
                            !isAvailable
                              ? 'text-neutral-400 line-through'
                              : isSelected
                              ? 'text-white'
                              : 'text-neutral-900'
                          }`}
                        >
                          {slot.time}
                        </span>
                        <span
                          className={`text-[11px] block mt-0.5 ${
                            !isAvailable
                              ? 'text-neutral-400'
                              : isSelected
                              ? 'text-white/85'
                              : 'text-neutral-500'
                          }`}
                        >
                          {isAvailable ? `~ ${slot.endTime}` : '수업/마감'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section Divider */}
          <div className="h-px w-full bg-neutral-200/80 my-4" />

          {/* Step 3: Student Details Form */}
          <div className="mb-3 flex items-center gap-1.5 text-xs sm:text-sm font-bold text-neutral-900">
            <User className="w-4 h-4 text-[#B70050]" />
            <span>학생 정보 입력 및 본인 확인</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence>
              {serverError && (
                <motion.div
                  id="booking-server-error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <div className="leading-relaxed font-medium">{serverError}</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Consultation Type Selector (대면 / 비대면) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-neutral-700">
                  상담 유형 선택 <span className="text-[#B70050]">*</span>
                </label>
                <span className="text-[11px] font-semibold text-[#B70050]">
                  {isFirstSemester ? '1학기: 전원 대면 진행' : '2학기: 1학기 대면 완료자 비대면 가능'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {/* In-Person Option */}
                <button
                  id="btn-type-in-person"
                  type="button"
                  onClick={() => setConsultationType('in_person')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    consultationType === 'in_person'
                      ? 'bg-[#FDF2F6] border-[#B70050] ring-2 ring-[#B70050]/15'
                      : 'bg-white border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-neutral-900">
                      <MapPin className={`w-4 h-4 ${consultationType === 'in_person' ? 'text-[#B70050]' : 'text-neutral-400'}`} />
                      <span>대면 상담</span>
                    </span>
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        consultationType === 'in_person'
                          ? 'border-[#B70050] bg-[#B70050] text-white'
                          : 'border-neutral-300 bg-white'
                      }`}
                    >
                      {consultationType === 'in_person' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    차미리사관 130호 연구실 방문
                  </p>
                </button>

                {/* Online Option */}
                <button
                  id="btn-type-online"
                  type="button"
                  disabled={isFirstSemester}
                  onClick={() => {
                    if (!isFirstSemester) setConsultationType('online');
                  }}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                    isFirstSemester
                      ? 'bg-neutral-100/80 border-dashed border-neutral-200 text-neutral-400 opacity-60 cursor-not-allowed'
                      : consultationType === 'online'
                      ? 'bg-[#FDF2F6] border-[#B70050] ring-2 ring-[#B70050]/15 cursor-pointer'
                      : 'bg-white border-neutral-200 hover:border-neutral-300 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold ${
                        isFirstSemester ? 'text-neutral-400' : 'text-neutral-900'
                      }`}
                    >
                      <Video className={`w-4 h-4 ${consultationType === 'online' ? 'text-[#B70050]' : 'text-neutral-400'}`} />
                      <span>비대면 상담</span>
                    </span>
                    {isFirstSemester ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-500">
                        2학기 가능
                      </span>
                    ) : (
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          consultationType === 'online'
                            ? 'border-[#B70050] bg-[#B70050] text-white'
                            : 'border-neutral-300 bg-white'
                        }`}
                      >
                        {consultationType === 'online' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    {isFirstSemester ? '1학기는 전원 대면으로 진행' : '1학기 대면 완료자 · 구글폼 필수'}
                  </p>
                </button>
              </div>

              {/* Caution Note on Consultation Type */}
              <div className="mt-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 text-[11px] sm:text-xs text-neutral-600 space-y-1.5 leading-relaxed">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-[#B70050] shrink-0 mt-0.5" />
                  <p>
                    <strong className="font-bold text-neutral-900">지도교수 변경 학생 주의사항:</strong> 1학기에 박성우 교수가 아닌 다른 교수님께 지도교수 배정을 받고 <strong className="font-bold text-[#B70050]">2학기에 박성우 교수가 지도교수로 배정된 학생은 반드시 대면으로 진행</strong>해야 합니다.
                    {isFirstSemester && ' (1학기 정기 상담은 모두 대면으로 진행됩니다.)'}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <FileText className="w-3.5 h-3.5 text-[#B70050] shrink-0 mt-0.5" />
                  <p>
                    <strong className="font-bold text-neutral-900">비대면 신청 시 유의사항:</strong> 비대면 신청자도 <strong className="font-bold text-[#B70050]">반드시 상담 날짜와 시간을 하나 신청</strong>해야 하며, <strong className="font-bold text-[#B70050]">구글폼을 통해 상담에 필요한 내용을 작성</strong>해야 합니다.
                  </p>
                </div>
              </div>

              {/* Highlighted Google Form Action Box when Online is selected */}
              <AnimatePresence>
                {consultationType === 'online' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2.5 p-3.5 rounded-xl bg-[#FDF2F6] border border-[#F5C2D7] text-xs text-neutral-800 space-y-2.5">
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-[#B70050] shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <span className="font-bold text-[#B70050] block mb-0.5">
                            [필수] 비대면 상담 사전 구글폼 작성 안내
                          </span>
                          비대면 상담을 신청하는 학생은 상담 진행 전까지 반드시 구글폼을 통해 상담에 필요한 내용을 작성하여 제출해야 합니다.
                        </div>
                      </div>
                      {semester.googleFormUrl ? (
                        <a
                          href={semester.googleFormUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 px-3 bg-white hover:bg-[#B70050] text-[#B70050] hover:text-white border border-[#B70050] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <span>구글폼(Google Form) 작성 바로가기</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <p className="text-[11px] text-[#B70050] font-medium bg-white/80 px-2.5 py-1.5 rounded-lg border border-[#F5C2D7]">
                          ※ 교수님이 구글폼 링크를 등록하면 이곳과 신청 완료 화면에서 바로 접속할 수 있습니다.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Student Name */}
              <div>
                <label htmlFor="input-student-name" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  이름 <span className="text-[#B70050]">*</span>
                </label>
                <input
                  id="input-student-name"
                  type="text"
                  placeholder="예: 홍길동"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[#B70050] focus:ring-2 focus:ring-[#B70050]/15 ${
                    formErrors.studentName ? 'border-rose-400 bg-rose-50/30' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                  required
                />
                {formErrors.studentName && (
                  <p className="text-[11px] text-rose-600 mt-1">{formErrors.studentName}</p>
                )}
              </div>

              {/* Student ID */}
              <div>
                <label htmlFor="input-student-id" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  학번 <span className="text-[#B70050]">*</span>
                </label>
                <input
                  id="input-student-id"
                  type="text"
                  placeholder="예: 20260001"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm tabular-nums transition-colors focus:outline-none focus:border-[#B70050] focus:ring-2 focus:ring-[#B70050]/15 ${
                    formErrors.studentId ? 'border-rose-400 bg-rose-50/30' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                  required
                />
                {formErrors.studentId && (
                  <p className="text-[11px] text-rose-600 mt-1">{formErrors.studentId}</p>
                )}
              </div>
            </div>

            {/* Phone number */}
            <div>
              <label htmlFor="input-student-phone" className="block text-xs font-semibold text-neutral-700 mb-1.5 flex items-center justify-between">
                <span>연락처 (휴대폰 번호) <span className="text-[#B70050]">*</span></span>
                <span className="text-[11px] font-normal text-neutral-400">교수 비상 연락용</span>
              </label>
              <div className="relative">
                <input
                  id="input-student-phone"
                  type="tel"
                  placeholder="010-1234-5678"
                  value={phone}
                  onChange={handlePhoneChange}
                  maxLength={13}
                  className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl border text-sm tabular-nums transition-colors focus:outline-none focus:border-[#B70050] focus:ring-2 focus:ring-[#B70050]/15 ${
                    formErrors.phone ? 'border-rose-400 bg-rose-50/30' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                  required
                />
                <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-3" />
              </div>
              {formErrors.phone && (
                <p className="text-[11px] text-rose-600 mt-1">{formErrors.phone}</p>
              )}
            </div>

            {/* Privacy note */}
            <div className="flex items-start gap-2.5 p-3.5 bg-neutral-50 rounded-xl text-xs text-neutral-500 leading-relaxed border border-neutral-200/70">
              <ShieldCheck className="w-4 h-4 text-[#B70050] shrink-0 mt-0.5" />
              <span>
                입력하신 개인정보는 지도교수 상담 일정 확인 및 긴급 연락 목적으로만 안전하게 보관되며 타 학생에게 절대 공개되지 않습니다.
              </span>
            </div>

            {/* Submit Button */}
            <button
              id="btn-submit-appointment"
              type="submit"
              disabled={submitting || !selectedTime}
              className="w-full py-3.5 px-4 bg-[#B70050] hover:bg-[#960041] active:bg-[#7A0035] text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>상담 신청 처리 중...</span>
                </>
              ) : (
                <>
                  <span>상담 신청 확정하기</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </>
      )}
    </motion.div>
  );
};
