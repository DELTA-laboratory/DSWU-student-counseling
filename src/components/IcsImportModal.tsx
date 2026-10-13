import React, { useState, useId, useMemo } from 'react';
import {
  X,
  Upload,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Filter,
  Check,
  Info,
  CalendarDays,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  SemesterSettings,
  PersonalSchedule,
  Appointment,
  ProfessorAttribution,
} from '../types';
import {
  parseGoogleCalendarIcs,
  ParsedIcsEvent,
  alignTimeTo30MinSlots,
} from '../lib/icsParser';
import { hasTimeOverlap } from '../lib/dateUtils';
import { savePersonalSchedulesBatch } from '../lib/firestoreService';

interface IcsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  semester: SemesterSettings;
  existingPersonalSchedules: PersonalSchedule[];
  existingAppointments: Appointment[];
  currentProfessor: Required<ProfessorAttribution>;
  onImportSuccess: (count: number, canceledAppointmentsCount: number) => void;
}

interface ProcessedIcsItem extends ParsedIcsEvent {
  selected: boolean;
  isDuplicate: boolean;
  conflicts: Appointment[];
}

export const IcsImportModal: React.FC<IcsImportModalProps> = ({
  isOpen,
  onClose,
  semester,
  existingPersonalSchedules,
  existingAppointments,
  currentProfessor,
  onImportSuccess,
}) => {
  const fileInputId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [calendarTitle, setCalendarTitle] = useState<string | null>(null);
  const [items, setItems] = useState<ProcessedIcsItem[]>([]);
  const [totalFoundInFile, setTotalFoundInFile] = useState(0);
  const [outOfSemesterCount, setOutOfSemesterCount] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [autoCancelConflicts, setAutoCancelConflicts] = useState(true);
  const [alignTo30Min, setAlignTo30Min] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Process raw text and detect duplicates and student appointment conflicts
  const processIcsText = (text: string, name: string) => {
    setIsParsing(true);
    setErrorMessage(null);
    try {
      const result = parseGoogleCalendarIcs(text, {
        startDate: semester.startDate,
        endDate: semester.endDate,
        dayStart: semester.dayStart,
        dayEnd: semester.dayEnd,
      });

      setFileName(name);
      setCalendarTitle(result.calendarName || null);
      setTotalFoundInFile(result.totalEventsInFile);
      setOutOfSemesterCount(result.outOfSemesterCount);

      // Professor's existing personal schedules for duplication check
      const myPersonal = existingPersonalSchedules.filter((ps) => {
        const psEmail = (ps.professorEmail || '').toLowerCase();
        const curEmail = currentProfessor.professorEmail.toLowerCase();
        const psUid = ps.professorUid || 'admin-professor';
        return psEmail === curEmail || psUid === currentProfessor.professorUid;
      });

      // Professor's confirmed student appointments for collision check
      const myAppointments = existingAppointments.filter((apt) => {
        if (apt.status !== 'confirmed') return false;
        const aptEmail = (apt.professorEmail || '').toLowerCase();
        const curEmail = currentProfessor.professorEmail.toLowerCase();
        const aptUid = apt.professorUid || 'admin-professor';
        return aptEmail === curEmail || aptUid === currentProfessor.professorUid;
      });

      const processed: ProcessedIcsItem[] = result.inSemesterEvents.map((evt) => {
        // Aligned times if 30-min alignment is selected
        const times = alignTo30Min
          ? alignTimeTo30MinSlots(evt.startTime, evt.endTime, semester.dayStart, semester.dayEnd)
          : { startTime: evt.startTime, endTime: evt.endTime };

        // Duplicate check: same date and overlapping time with existing personal schedule
        const isDuplicate = myPersonal.some(
          (ps) =>
            ps.date === evt.date &&
            hasTimeOverlap(ps.startTime, ps.endTime, times.startTime, times.endTime)
        );

        // Student consultation conflict check
        const conflicts = myAppointments.filter(
          (apt) =>
            apt.date === evt.date &&
            hasTimeOverlap(apt.startTime, apt.endTime, times.startTime, times.endTime)
        );

        return {
          ...evt,
          startTime: times.startTime,
          endTime: times.endTime,
          selected: !isDuplicate, // Default unselect if already duplicate
          isDuplicate,
          conflicts,
        };
      });

      setItems(processed);
    } catch (err: any) {
      console.error('Failed to parse ICS file:', err);
      setErrorMessage(
        'ICS 파일을 분석하는 도중 오류가 발생했습니다. 올바른 Google 캘린더 .ics 파일인지 확인해주세요.'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processIcsText(content, file.name);
      }
    };
    reader.onerror = () => {
      setErrorMessage('파일을 읽지 못했습니다. 다시 시도해주세요.');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.ics')) {
      setErrorMessage('.ics 확장자 파일만 업로드할 수 있습니다.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processIcsText(content, file.name);
      }
    };
    reader.readAsText(file);
  };

  const toggleSelectAll = (select: boolean) => {
    setItems((prev) =>
      prev.map((item) => {
        if (hideDuplicates && item.isDuplicate) return item;
        return { ...item, selected: select };
      })
    );
  };

  const toggleItem = (uid: string) => {
    setItems((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, selected: !item.selected } : item))
    );
  };

  // Filtered list based on search and duplicate hiding
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (hideDuplicates && item.isDuplicate) return false;
      if (!filterSearch.trim()) return true;
      const q = filterSearch.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.date.includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
      );
    });
  }, [items, hideDuplicates, filterSearch]);

  const selectedCount = useMemo(() => {
    return items.filter((it) => it.selected).length;
  }, [items]);

  const duplicateCount = useMemo(() => {
    return items.filter((it) => it.isDuplicate).length;
  }, [items]);

  const totalConflictsCount = useMemo(() => {
    return items
      .filter((it) => it.selected)
      .reduce((acc, curr) => acc + curr.conflicts.length, 0);
  }, [items]);

  const handleImportSubmit = async () => {
    const selectedItems = items.filter((it) => it.selected);
    if (selectedItems.length === 0) {
      alert('등록할 일정을 하나 이상 선택해주세요.');
      return;
    }

    if (totalConflictsCount > 0 && !autoCancelConflicts) {
      const confirmProceed = confirm(
        `선택한 일정 중 기존 학생 상담과 겹치는 일정이 ${totalConflictsCount}건 있습니다.\n해당 상담을 취소하지 않고 등록을 진행하시겠습니까? (상담 슬롯 차단은 적용됩니다)`
      );
      if (!confirmProceed) return;
    }

    setIsSubmitting(true);
    try {
      const batchPayload = selectedItems.map((it) => ({
        personalData: {
          semesterId: semester.id,
          title: it.title,
          note: it.description || (it.location ? `장소: ${it.location}` : ''),
          date: it.date,
          startTime: it.startTime,
          endTime: it.endTime,
          professorUid: currentProfessor.professorUid,
          professorName: currentProfessor.professorName,
          professorEmail: currentProfessor.professorEmail,
        },
        conflictAppointments: autoCancelConflicts ? it.conflicts : [],
      }));

      const res = await savePersonalSchedulesBatch(batchPayload);
      onImportSuccess(res.addedCount, res.canceledAppointmentsCount);
      onClose();
    } catch (err: any) {
      console.error('Failed to batch save personal schedules:', err);
      alert('일정 등록 중 오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-neutral-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-neutral-200 flex items-center justify-between bg-gradient-to-r from-neutral-50 via-white to-pink-50/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#B70050]/10 border border-[#F5C2D7] flex items-center justify-center text-[#B70050]">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-neutral-900 text-base sm:text-lg">
                  Google 캘린더 (.ics) 일정 불러오기
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7] text-[11px] font-bold">
                  {currentProfessor.professorName}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                현재 활성화된 <strong className="text-neutral-700">{semester.title}</strong> 기간 (
                <span className="tabular-nums font-medium text-neutral-700">{semester.startDate}</span> ~{' '}
                <span className="tabular-nums font-medium text-neutral-700">{semester.endDate}</span>)의 일정만 자동 선별됩니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* File Upload Zone */}
          {!fileName ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[#F5C2D7] hover:border-[#B70050] bg-[#FDF2F6]/30 hover:bg-[#FDF2F6]/60 rounded-2xl p-8 text-center transition-all cursor-pointer group"
              onClick={() => document.getElementById(fileInputId)?.click()}
            >
              <input
                id={fileInputId}
                type="file"
                accept=".ics,text/calendar"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-14 h-14 mx-auto rounded-2xl bg-white shadow-sm border border-[#F5C2D7] flex items-center justify-center text-[#B70050] group-hover:scale-105 transition-transform mb-3">
                <Upload className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-neutral-800">
                Google 캘린더에서 내보낸 .ics 파일을 업로드하세요
              </h4>
              <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto">
                여기를 클릭하여 파일을 선택하거나, 다운로드한 ics 파일을 이곳으로 드래그해주세요.
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#B70050] bg-white px-3 py-1.5 rounded-lg border border-[#F5C2D7] shadow-2xs">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Google 캘린더 [설정] &gt; [캘린더 내보내기]에서 다운로드 가능</span>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-neutral-900">{fileName}</span>
                    {calendarTitle && (
                      <span className="text-[11px] text-neutral-500">({calendarTitle})</span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2">
                    <span>전체 {totalFoundInFile}건 발견</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">
                      학기 내 {items.length}건 선별 완료
                    </span>
                    {outOfSemesterCount > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-neutral-400">학기 외 {outOfSemesterCount}건 제외</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor={fileInputId}
                  className="px-3 py-1.5 bg-white hover:bg-neutral-100 text-neutral-700 rounded-lg border border-neutral-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>다른 파일 선택</span>
                </label>
                <input
                  id={fileInputId}
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Quick Stats Banner */}
          {items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="text-[11px] text-neutral-500 font-medium">학기 기간 내 일정</div>
                <div className="text-lg font-bold text-neutral-900 mt-0.5 tabular-nums">
                  {items.length}건
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200/80">
                <div className="text-[11px] text-emerald-700 font-medium">등록 선택된 일정</div>
                <div className="text-lg font-bold text-emerald-800 mt-0.5 tabular-nums">
                  {selectedCount}건
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80">
                <div className="text-[11px] text-amber-700 font-medium">기존 중복 일정</div>
                <div className="text-lg font-bold text-amber-800 mt-0.5 tabular-nums">
                  {duplicateCount}건
                </div>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200/80">
                <div className="text-[11px] text-rose-700 font-medium">학생 상담 충돌</div>
                <div className="text-lg font-bold text-rose-800 mt-0.5 tabular-nums">
                  {totalConflictsCount}건
                </div>
              </div>
            </div>
          )}

          {/* Search & Bulk Options Bar */}
          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(false)}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    선택 해제
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-neutral-600 ml-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideDuplicates}
                      onChange={(e) => setHideDuplicates(e.target.checked)}
                      className="rounded text-[#B70050] focus:ring-[#B70050]"
                    />
                    <span>중복 일정 숨기기</span>
                  </label>
                </div>

                <div className="relative">
                  <Filter className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="일정 제목 또는 날짜 검색..."
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    className="w-full sm:w-60 pl-8 pr-3 py-1.5 text-xs bg-neutral-50 rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                  />
                </div>
              </div>

              {/* Advanced Settings */}
              <div className="p-3 rounded-xl bg-[#FDF2F6]/50 border border-[#F5C2D7] text-xs space-y-2">
                <div className="flex items-start sm:items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoCancel"
                    checked={autoCancelConflicts}
                    onChange={(e) => setAutoCancelConflicts(e.target.checked)}
                    className="mt-0.5 sm:mt-0 rounded text-[#B70050] focus:ring-[#B70050]"
                  />
                  <label htmlFor="autoCancel" className="font-semibold text-neutral-800 cursor-pointer">
                    충돌 상담 안전 자동 취소: 등록할 개인 일정과 겹치는 학생 예약이 있을 경우, 자동으로 해당 예약을 취소 처리하고 상담 차단을 적용합니다.
                  </label>
                </div>
                <div className="flex items-start sm:items-center gap-2">
                  <input
                    type="checkbox"
                    id="alignSlots"
                    checked={alignTo30Min}
                    onChange={(e) => setAlignTo30Min(e.target.checked)}
                    className="mt-0.5 sm:mt-0 rounded text-[#B70050] focus:ring-[#B70050]"
                  />
                  <label htmlFor="alignSlots" className="text-neutral-600 cursor-pointer">
                    30분 단위 안전 슬롯 정렬 (권장): 구글 캘린더의 분 단위 일정을 30분 단위 슬롯으로 자동 확장하여 학생 상담 신청을 빈틈없이 차단합니다.
                  </label>
                </div>
              </div>

              {/* Event List Preview */}
              <div className="border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100 max-h-80 overflow-y-auto">
                {filteredItems.length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-400">
                    검색 조건에 맞는 일정이 없습니다.
                  </div>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.uid}
                      onClick={() => toggleItem(item.uid)}
                      className={`p-3.5 flex items-start sm:items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                        item.selected ? 'bg-[#FDF2F6]/20' : 'bg-white hover:bg-neutral-50/70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => {}} // Controlled via row click
                            className="w-4 h-4 rounded text-[#B70050] focus:ring-[#B70050] cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-neutral-900 text-xs sm:text-sm">
                              {item.title}
                            </span>
                            {item.isAllDay && (
                              <span className="px-1.5 py-0.5 bg-neutral-100 text-neutral-600 text-[10px] rounded font-semibold">
                                종일
                              </span>
                            )}
                            {item.isRecurring && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded font-semibold">
                                반복
                              </span>
                            )}
                            {item.isDuplicate && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded font-bold">
                                기존 등록됨
                              </span>
                            )}
                            {item.conflicts.length > 0 && (
                              <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] rounded font-bold flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3 inline" />
                                <span>상담 충돌 ({item.conflicts.length}건)</span>
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-neutral-500">
                            <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-neutral-700">
                              <Calendar className="w-3 h-3 text-[#B70050]" />
                              {item.date}
                            </span>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-[#B70050]">
                              <Clock className="w-3 h-3" />
                              {item.startTime} ~ {item.endTime}
                            </span>
                            {item.description && (
                              <>
                                <span>•</span>
                                <span className="text-neutral-400 line-clamp-1 max-w-xs">
                                  {item.description}
                                </span>
                              </>
                            )}
                          </div>

                          {item.conflicts.length > 0 && (
                            <div className="mt-1.5 text-[10px] text-rose-600 font-medium bg-rose-50/80 px-2 py-0.5 rounded border border-rose-100 inline-block">
                              충돌 예약: {item.conflicts.map((c) => `${c.studentName} (${c.startTime}~${c.endTime})`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {item.selected ? (
                          <span className="text-xs font-bold text-[#B70050] inline-flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>등록 예정</span>
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">제외됨</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Help Guidance Note */}
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-600 space-y-1 leading-relaxed">
            <div className="font-bold text-neutral-800 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#B70050]" />
              <span>Google 캘린더 연동 안내</span>
            </div>
            <p className="text-[11px] text-neutral-500">
              - Google 캘린더에서 내보낸 .ics 파일의 일정 제목 및 메모는 학생에게 공개되지 않으며 교수 본인 관리용으로만 사용됩니다.
            </p>
            <p className="text-[11px] text-neutral-500">
              - 일정이 추가된 날짜 및 시간 슬롯은 학생 상담 신청 페이지에서 자동으로 <strong>[예약 불가]</strong> 상태로 전환됩니다.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            {items.length > 0 ? (
              <span>
                총 <strong className="text-neutral-800">{items.length}건</strong> 중{' '}
                <strong className="text-[#B70050] font-bold">{selectedCount}건</strong> 선택됨
              </span>
            ) : (
              <span>.ics 파일을 첨부해주세요.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-neutral-100 text-neutral-700 rounded-xl border border-neutral-200 text-xs font-bold transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleImportSubmit}
              disabled={selectedCount === 0 || isSubmitting}
              className="px-4.5 py-2 bg-[#B70050] hover:bg-[#960041] disabled:bg-neutral-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>등록 중...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>선택한 {selectedCount}건 일괄 추가</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
