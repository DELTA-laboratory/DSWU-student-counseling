import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  BookOpen,
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Phone,
  ShieldCheck,
  Search,
  Upload,
  UserCheck,
  CalendarCheck,
  ArrowUpRight,
  LogOut,
  MapPin,
  Video,
  FileText,
  ExternalLink,
  Link as LinkIcon,
  Edit2,
} from 'lucide-react';
import {
  SemesterSettings,
  Appointment,
  ClassSchedule,
  PersonalSchedule,
  StudentRecord,
  Weekday,
} from '../types';
import { formatKoreanDate, getNowSeoul } from '../lib/dateUtils';
import {
  saveSemester,
  updateSemesterGoogleFormUrl,
  addClassSchedule,
  updateClassSchedule,
  deleteClassSchedule,
  checkPersonalScheduleConflicts,
  savePersonalScheduleWithAutoCancel,
  updatePersonalSchedule,
  deletePersonalSchedule,
  addStudentsBatch,
  toggleStudentStatus,
  toggleStudentFirstSemesterInPerson,
  updateStudent,
  deleteStudent,
  cancelAppointmentByAdmin,
  updateAppointmentByAdmin,
  deleteAppointmentByAdmin,
} from '../lib/firestoreService';

interface AdminDashboardProps {
  semester: SemesterSettings | null;
  allSemesters: SemesterSettings[];
  appointments: Appointment[];
  classSchedules: ClassSchedule[];
  personalSchedules: PersonalSchedule[];
  students: StudentRecord[];
  onRefresh: () => void;
  onLogout: () => void;
  userEmail?: string;
}

type TabType = 'overview' | 'appointments' | 'classes' | 'personal' | 'students' | 'semester';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  semester,
  allSemesters,
  appointments,
  classSchedules,
  personalSchedules,
  students,
  onRefresh,
  onLogout,
  userEmail,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Search & filter states
  const [studentSearch, setStudentSearch] = useState('');
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'confirmed' | 'canceled'>('all');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal / Form states
  const [showAddClass, setShowAddClass] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [showAddPersonal, setShowAddPersonal] = useState(false);
  const [editingPersonalSchedule, setEditingPersonalSchedule] = useState<PersonalSchedule | null>(null);
  const [showAddStudents, setShowAddStudents] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [editStudentForm, setEditStudentForm] = useState({
    name: '',
    firstSemesterInPerson: true,
    active: true,
  });
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [editAppointmentForm, setEditAppointmentForm] = useState({
    studentName: '',
    studentId: '',
    phone: '',
    date: '',
    startTime: '14:00',
    consultationType: 'in_person' as 'in_person' | 'online',
    status: 'confirmed' as 'confirmed' | 'canceled',
  });
  const [showSemesterEdit, setShowSemesterEdit] = useState(false);

  // Conflict modal state for Personal Schedule (CASE 9 & 10)
  const [conflictModalData, setConflictModalData] = useState<{
    personalData: Omit<PersonalSchedule, 'id' | 'createdAt'>;
    conflicts: Appointment[];
    editingTarget?: PersonalSchedule | null;
  } | null>(null);

  // New Class Form State
  const [newClass, setNewClass] = useState({
    title: '',
    weekday: 'monday' as Weekday,
    startTime: '10:30',
    endTime: '12:00',
    startDate: semester?.startDate || '2026-09-01',
    endDate: semester?.endDate || '2026-12-15',
  });

  // New Personal Schedule Form State
  const [newPersonal, setNewPersonal] = useState(() => ({
    title: '',
    note: '',
    date: getNowSeoul().dateStr,
    startTime: '14:00',
    endTime: '15:30',
  }));

  // Batch Students Text Input
  const [bulkStudentText, setBulkStudentText] = useState('');

  // Semester edit state
  const [editSemesterData, setEditSemesterData] = useState({
    year: semester?.year || 2026,
    semester: (semester?.semester || 2) as 1 | 2,
    startDate: semester?.startDate || '2026-09-01',
    endDate: semester?.endDate || '2026-12-31',
    dayStart: semester?.dayStart || '09:00',
    dayEnd: semester?.dayEnd || '18:00',
    googleFormUrl: semester?.googleFormUrl || '',
  });

  const [quickGoogleFormUrl, setQuickGoogleFormUrl] = useState(semester?.googleFormUrl || '');
  const [savingFormUrl, setSavingFormUrl] = useState(false);

  useEffect(() => {
    if (semester) {
      setEditSemesterData({
        year: semester.year,
        semester: semester.semester,
        startDate: semester.startDate,
        endDate: semester.endDate,
        dayStart: semester.dayStart,
        dayEnd: semester.dayEnd,
        googleFormUrl: semester.googleFormUrl || '',
      });
      setQuickGoogleFormUrl(semester.googleFormUrl || '');
    }
  }, [semester]);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Metrics computation
  const confirmedCount = appointments.filter((a) => a.status === 'confirmed').length;
  const canceledCount = appointments.filter((a) => a.status === 'canceled').length;
  const activeStudentsCount = students.filter((s) => s.active).length;

  // Upcoming confirmed appointment
  const nextAppointment = appointments
    .filter((a) => a.status === 'confirmed')
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))[0];

  // ---------------- Handlers ----------------

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semester) return;
    try {
      if (editingClassId) {
        await updateClassSchedule(editingClassId, {
          ...newClass,
          semesterId: semester.id,
        });
        showNotification('success', '수업 일정이 성공적으로 수정되었습니다.');
      } else {
        await addClassSchedule({
          ...newClass,
          semesterId: semester.id,
        });
        showNotification('success', '수업 일정이 성공적으로 등록되었습니다.');
      }
      setShowAddClass(false);
      setEditingClassId(null);
      setNewClass({
        title: '',
        weekday: 'monday',
        startTime: '10:30',
        endTime: '12:00',
        startDate: semester.startDate,
        endDate: semester.endDate,
      });
      onRefresh();
    } catch (err) {
      showNotification('error', '수업 일정 저장 실패');
    }
  };

  const handleStartEditClass = (cls: ClassSchedule) => {
    setEditingClassId(cls.id);
    setNewClass({
      title: cls.title,
      weekday: cls.weekday,
      startTime: cls.startTime,
      endTime: cls.endTime,
      startDate: cls.startDate,
      endDate: cls.endDate,
    });
    setShowAddClass(true);
  };

  const handleDeleteClass = async (id: string) => {
    if (!confirm('해당 수업 일정을 삭제하시겠습니까?')) return;
    try {
      await deleteClassSchedule(id);
      showNotification('success', '수업 일정이 삭제되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '삭제 실패');
    }
  };

  const handlePreCheckPersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semester) return;

    try {
      const personalData = {
        title: newPersonal.title || '교수 개인 일정',
        note: newPersonal.note,
        date: newPersonal.date,
        startTime: newPersonal.startTime,
        endTime: newPersonal.endTime,
        semesterId: semester.id,
      };

      // Check conflicts
      const conflicts = await checkPersonalScheduleConflicts(
        newPersonal.date,
        newPersonal.startTime,
        newPersonal.endTime,
        semester.id
      );

      if (conflicts.length > 0) {
        // Show conflict modal! (Requirement CASE 9 & 10)
        setConflictModalData({
          personalData,
          conflicts,
          editingTarget: editingPersonalSchedule,
        });
      } else {
        if (editingPersonalSchedule) {
          await updatePersonalSchedule(editingPersonalSchedule, personalData, []);
          showNotification('success', '개인 일정이 수정되었습니다.');
        } else {
          await savePersonalScheduleWithAutoCancel(personalData, []);
          showNotification('success', '개인 일정이 등록되었습니다.');
        }
        setShowAddPersonal(false);
        setEditingPersonalSchedule(null);
        onRefresh();
      }
    } catch (err) {
      showNotification('error', '개인 일정 저장 중 오류');
    }
  };

  const handleStartEditPersonal = (sch: PersonalSchedule) => {
    setEditingPersonalSchedule(sch);
    setNewPersonal({
      title: sch.title,
      note: sch.note || '',
      date: sch.date,
      startTime: sch.startTime,
      endTime: sch.endTime,
    });
    setShowAddPersonal(true);
  };

  const handleConfirmPersonalWithCancel = async () => {
    if (!conflictModalData) return;
    try {
      if (conflictModalData.editingTarget) {
        await updatePersonalSchedule(
          conflictModalData.editingTarget,
          conflictModalData.personalData,
          conflictModalData.conflicts
        );
      } else {
        await savePersonalScheduleWithAutoCancel(
          conflictModalData.personalData,
          conflictModalData.conflicts
        );
      }
      setConflictModalData(null);
      setShowAddPersonal(false);
      setEditingPersonalSchedule(null);
      showNotification(
        'success',
        `개인 일정이 저장되었으며 충돌 상담 ${conflictModalData.conflicts.length}건이 안전하게 취소 처리되었습니다.`
      );
      onRefresh();
    } catch (err) {
      showNotification('error', '처리 중 오류가 발생했습니다.');
    }
  };

  const handleDeletePersonal = async (sch: PersonalSchedule) => {
    if (!confirm('이 개인 일정을 삭제하시겠습니까? 해당 시간의 신청 차단이 해제됩니다.')) return;
    try {
      await deletePersonalSchedule(sch);
      showNotification('success', '개인 일정이 삭제되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '삭제 실패');
    }
  };

  const handleBulkAddStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semester) return;

    // Parse lines or comma separated values
    const lines = bulkStudentText.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
    const studentList: Array<{ studentId: string; name?: string }> = [];

    for (const line of lines) {
      // Format: "20260001 김민준" or "20260001" or CSV "20260001,김민준"
      const parts = line.split(/[\s,]+/);
      if (parts[0]) {
        studentList.push({
          studentId: parts[0],
          name: parts[1] || '',
        });
      }
    }

    if (studentList.length === 0) {
      showNotification('error', '등록할 학번을 입력해주세요.');
      return;
    }

    try {
      const added = await addStudentsBatch(semester.id, studentList);
      setShowAddStudents(false);
      setBulkStudentText('');
      showNotification('success', `${added}명의 지도학생이 등록되었습니다.`);
      onRefresh();
    } catch {
      showNotification('error', '학생 명단 등록 실패');
    }
  };

  const handleToggleStudent = async (studentDocId: string, current: boolean) => {
    try {
      await toggleStudentStatus(studentDocId, current);
      onRefresh();
    } catch {
      showNotification('error', '상태 변경 실패');
    }
  };

  const handleToggleStudentFirstSemester = async (studentDocId: string, currentVal?: boolean) => {
    try {
      await toggleStudentFirstSemesterInPerson(studentDocId, currentVal ?? true);
      showNotification('success', '학생의 1학기 대면 상담 이수 여부가 변경되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '상담 유형 자격 변경 실패');
    }
  };

  const handleStartEditStudent = (st: StudentRecord) => {
    setEditingStudent(st);
    setEditStudentForm({
      name: st.name || '',
      firstSemesterInPerson: st.firstSemesterInPerson ?? true,
      active: st.active,
    });
  };

  const handleSaveStudentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    try {
      await updateStudent(editingStudent.id, editStudentForm);
      setEditingStudent(null);
      showNotification('success', '학생 정보가 수정되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '학생 정보 수정 실패');
    }
  };

  const handleDeleteStudent = async (studentDocId: string) => {
    if (!confirm('해당 학생을 지도학생 명단에서 삭제하시겠습니까?')) return;
    try {
      await deleteStudent(studentDocId);
      showNotification('success', '학생이 삭제되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '학생 삭제 실패');
    }
  };

  const handleSaveQuickGoogleFormUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semester) return;
    setSavingFormUrl(true);
    try {
      await updateSemesterGoogleFormUrl(semester.id, quickGoogleFormUrl);
      showNotification('success', '비대면 상담용 구글폼 링크가 저장되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '구글폼 링크 저장에 실패했습니다.');
    } finally {
      setSavingFormUrl(false);
    }
  };

  const handleSaveSemesterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `${editSemesterData.year}-${editSemesterData.semester}`;
    const newSem: SemesterSettings = {
      id,
      year: editSemesterData.year,
      semester: editSemesterData.semester,
      title: `${editSemesterData.year}학년도 ${editSemesterData.semester}학기`,
      startDate: editSemesterData.startDate,
      endDate: editSemesterData.endDate,
      timezone: 'Asia/Seoul',
      dayStart: editSemesterData.dayStart,
      dayEnd: editSemesterData.dayEnd,
      slotMinutes: 30,
      appointmentMinutes: 60,
      googleFormUrl: editSemesterData.googleFormUrl.trim(),
      active: true,
      createdAt: new Date().toISOString(),
    };

    try {
      await saveSemester(newSem, semester?.id);
      setShowSemesterEdit(false);
      showNotification('success', '학기 설정 및 구글폼 링크가 Supabase에 저장되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '학기 설정 저장 실패');
    }
  };

  const handleStartEditAppointment = (apt: Appointment) => {
    setEditingAppointment(apt);
    setEditAppointmentForm({
      studentName: apt.studentName,
      studentId: apt.studentId,
      phone: apt.phone,
      date: apt.date,
      startTime: apt.startTime,
      consultationType: apt.consultationType || 'in_person',
      status: apt.status,
    });
  };

  const handleSaveAppointmentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAppointment) return;
    try {
      await updateAppointmentByAdmin(editingAppointment.appointmentId, editAppointmentForm);
      setEditingAppointment(null);
      showNotification('success', '상담 신청 내역이 수정되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '상담 내역 수정 실패');
    }
  };

  const handleCancelAppointment = async (aptId: string) => {
    if (!confirm('이 상담 신청을 취소하시겠습니까? 취소 후 상담 시간은 다시 비워집니다.')) return;
    try {
      await cancelAppointmentByAdmin(aptId, 'manual_admin_cancel');
      showNotification('success', '상담 신청이 취소 처리되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '신청 취소 실패');
    }
  };

  const handleDeleteAppointment = async (aptId: string) => {
    if (!confirm('이 상담 내역을 데이터베이스에서 완전히 삭제하시겠습니까?')) return;
    try {
      await deleteAppointmentByAdmin(aptId);
      showNotification('success', '상담 내역이 삭제되었습니다.');
      onRefresh();
    } catch {
      showNotification('error', '상담 내역 삭제 실패');
    }
  };

  // Filtered Appointments
  const filteredAppointments = appointments.filter((a) => {
    if (appointmentFilter === 'all') return true;
    return a.status === appointmentFilter;
  });

  // Filtered Students
  const filteredStudents = students.filter((s) => {
    if (!studentSearch) return true;
    return (
      s.studentId.toLowerCase().includes(studentSearch.toLowerCase()) ||
      (s.name && s.name.toLowerCase().includes(studentSearch.toLowerCase()))
    );
  });

  return (
    <div id="admin-dashboard-root" className="min-h-screen bg-white flex flex-col text-neutral-900">
      {/* Top Admin Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md bg-[#B70050] text-white font-bold text-xs tracking-wider uppercase">
              Admin
            </span>
            <h1 className="text-base font-bold tracking-tight text-neutral-900">교수 관리자 포털</h1>
            {semester && (
              <span className="hidden sm:inline text-xs font-semibold text-[#B70050]">
                · {semester.title} (활성)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500 hidden md:inline">{userEmail}</span>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#FDF2F6] hover:text-[#B70050] hover:border-[#B70050] text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-neutral-200"
            >
              <LogOut className="w-3.5 h-3.5 text-[#B70050]" />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Sub-bar */}
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between overflow-x-auto">
          <nav className="flex space-x-1 sm:space-x-3 py-2">
            {[
              { key: 'overview', label: '대시보드 요약', icon: CalendarCheck },
              { key: 'appointments', label: `상담 현황 (${confirmedCount})`, icon: Calendar },
              { key: 'classes', label: `수업 일정 (${classSchedules.length})`, icon: BookOpen },
              { key: 'personal', label: `개인 일정 (${personalSchedules.length})`, icon: Clock },
              { key: 'students', label: `지도학생 (${students.length})`, icon: Users },
              { key: 'semester', label: '학기 설정', icon: ShieldCheck },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  id={`admin-tab-${tab.key}`}
                  type="button"
                  onClick={() => setActiveTab(tab.key as TabType)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#B70050] text-white font-bold shadow-xs'
                      : 'text-neutral-600 hover:text-[#B70050] hover:bg-[#FDF2F6]/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Alert toast message */}
      {statusMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 w-full">
          <div
            className={`p-3.5 rounded-xl border text-xs font-medium ${
              statusMessage.type === 'success'
                ? 'bg-[#FDF2F6] border-[#F5C2D7] text-[#B70050]'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {statusMessage.text}
          </div>
        </div>
      )}

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">활성 학기</div>
                <div className="text-xl font-bold text-neutral-900">{semester?.title || '설정 없음'}</div>
                <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">
                  {semester ? `${semester.startDate} ~ ${semester.endDate}` : '학기 생성 필요'}
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">등록된 지도학생</div>
                <div className="text-xl font-bold text-[#B70050] tabular-nums">{activeStudentsCount}명</div>
                <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">총 {students.length}명 중 활성</div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">확정된 상담 신청</div>
                <div className="text-xl font-bold text-[#B70050] tabular-nums">{confirmedCount}건</div>
                <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">취소 이력 {canceledCount}건 보존</div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">다음 예정 상담</div>
                <div className="text-sm font-bold text-neutral-900 truncate">
                  {nextAppointment
                    ? `${nextAppointment.studentName} (${nextAppointment.startTime})`
                    : '예정된 상담 없음'}
                </div>
                <div className="text-[11px] text-neutral-400 mt-1">
                  {nextAppointment ? formatKoreanDate(nextAppointment.date) : '새로운 신청을 기다리는 중'}
                </div>
              </div>
            </div>

            {/* Quick Google Form Link Configuration Card */}
            {semester && (
              <div className="bg-white rounded-2xl border border-neutral-200 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7] flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm sm:text-base font-bold text-neutral-900">
                        비대면 상담용 구글폼(Google Form) 링크 설정
                      </h2>
                      <p className="text-xs text-neutral-500">
                        비대면 상담을 신청한 학생들에게 안내되는 사전 질문지 구글폼 주소입니다. (1학기: 전원 대면 / 2학기: 1학기 대면 완료자 비대면 허용)
                      </p>
                    </div>
                  </div>
                  {semester.googleFormUrl && (
                    <a
                      href={semester.googleFormUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-[#B70050] hover:underline flex items-center gap-1 self-start sm:self-center shrink-0"
                    >
                      <span>현재 링크 열기</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                <form onSubmit={handleSaveQuickGoogleFormUrl} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <LinkIcon className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
                    <input
                      id="input-quick-google-form-url"
                      type="url"
                      placeholder="https://docs.google.com/forms/... 또는 https://forms.gle/..."
                      value={quickGoogleFormUrl}
                      onChange={(e) => setQuickGoogleFormUrl(e.target.value)}
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:outline-none focus:border-[#B70050]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingFormUrl}
                    className="px-5 py-2.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-xl text-xs sm:text-sm transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {savingFormUrl ? '저장 중...' : '구글폼 링크 저장'}
                  </button>
                </form>
              </div>
            )}

            {/* Recent Confirmed Appointments List */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-neutral-900">최근 상담 신청 현황</h2>
                  <p className="text-xs text-neutral-500">학생들의 확정된 1:1 면담 일정입니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('appointments')}
                  className="text-xs font-bold text-[#B70050] hover:text-[#960041] flex items-center gap-1 cursor-pointer"
                >
                  <span>전체보기</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {appointments.length === 0 ? (
                <div className="text-center py-10 text-neutral-400 text-sm">
                  아직 접수된 상담 신청이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-100 text-neutral-400 uppercase tracking-wider">
                        <th className="py-2.5 px-3">일자</th>
                        <th className="py-2.5 px-3">시간</th>
                        <th className="py-2.5 px-3">유형</th>
                        <th className="py-2.5 px-3">학생명 (학번)</th>
                        <th className="py-2.5 px-3">연락처</th>
                        <th className="py-2.5 px-3">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {appointments.slice(0, 5).map((apt) => (
                        <tr key={apt.appointmentId} className="hover:bg-neutral-50/70">
                          <td className="py-3 px-3 font-medium text-neutral-900 tabular-nums">{apt.date}</td>
                          <td className="py-3 px-3 text-[#B70050] font-bold tabular-nums">
                            {apt.startTime} ~ {apt.endTime}
                          </td>
                          <td className="py-3 px-3">
                            {apt.consultationType === 'online' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-800 font-bold text-[11px]">
                                <Video className="w-3 h-3 text-[#B70050]" />
                                비대면
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FDF2F6] text-[#B70050] font-bold text-[11px]">
                                <MapPin className="w-3 h-3" />
                                대면
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-medium text-neutral-900 tabular-nums">
                            {apt.studentName} <span className="text-neutral-400">({apt.studentId})</span>
                          </td>
                          <td className="py-3 px-3 text-neutral-600 tabular-nums">{apt.phone}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-xs font-bold ${
                                apt.status === 'confirmed'
                                  ? 'text-[#B70050]'
                                  : 'text-neutral-400'
                              }`}
                            >
                              {apt.status === 'confirmed' ? '확정' : '취소됨'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: APPOINTMENTS */}
        {activeTab === 'appointments' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">상담 신청 현황 상세</h2>
                  <p className="text-xs text-neutral-500">
                    취소된 상담의 학생 연락처와 취소 사유도 안전하게 보존됩니다.
                  </p>
                </div>

                {/* Filter toggle */}
                <div className="flex items-center gap-1.5 bg-neutral-100 p-1 rounded-xl">
                  {(['all', 'confirmed', 'canceled'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setAppointmentFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                        appointmentFilter === f
                          ? 'bg-white text-[#B70050] shadow-xs font-bold'
                          : 'text-neutral-500 hover:text-neutral-900'
                      }`}
                    >
                      {f === 'all' ? '전체' : f === 'confirmed' ? '확정' : '취소'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Edit Appointment Form */}
              {editingAppointment && (
                <form
                  onSubmit={handleSaveAppointmentEdit}
                  className="p-4 bg-[#FDF2F6]/60 rounded-xl border border-[#F5C2D7] mb-6 space-y-3"
                >
                  <h3 className="text-xs font-bold text-[#B70050] uppercase">
                    상담 신청 내역 수정 · {editingAppointment.studentName} ({editingAppointment.studentId})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
                    <div>
                      <label className="block text-neutral-600 mb-1">학생명</label>
                      <input
                        type="text"
                        value={editAppointmentForm.studentName}
                        onChange={(e) =>
                          setEditAppointmentForm({ ...editAppointmentForm, studentName: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">학번</label>
                      <input
                        type="text"
                        value={editAppointmentForm.studentId}
                        onChange={(e) =>
                          setEditAppointmentForm({ ...editAppointmentForm, studentId: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">상담 날짜</label>
                      <input
                        type="date"
                        value={editAppointmentForm.date}
                        onChange={(e) =>
                          setEditAppointmentForm({ ...editAppointmentForm, date: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">시작 시간</label>
                      <input
                        type="time"
                        step={1800}
                        value={editAppointmentForm.startTime}
                        onChange={(e) =>
                          setEditAppointmentForm({ ...editAppointmentForm, startTime: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">상담 유형</label>
                      <select
                        value={editAppointmentForm.consultationType}
                        onChange={(e) =>
                          setEditAppointmentForm({
                            ...editAppointmentForm,
                            consultationType: e.target.value as 'in_person' | 'online',
                          })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      >
                        <option value="in_person">대면</option>
                        <option value="online">비대면</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">상태</label>
                      <select
                        value={editAppointmentForm.status}
                        onChange={(e) =>
                          setEditAppointmentForm({
                            ...editAppointmentForm,
                            status: e.target.value as 'confirmed' | 'canceled',
                          })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      >
                        <option value="confirmed">확정</option>
                        <option value="canceled">취소됨</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingAppointment(null)}
                      className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      수정 저장
                    </button>
                  </div>
                </form>
              )}

              {filteredAppointments.length === 0 ? (
                <div className="text-center py-12 text-neutral-400 text-sm">
                  해당 조건에 일치하는 상담 신청이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-100 text-neutral-400 uppercase tracking-wider">
                        <th className="py-3 px-3">상담 일자</th>
                        <th className="py-3 px-3">시간 (30~60분)</th>
                        <th className="py-3 px-3">상담 유형</th>
                        <th className="py-3 px-3">학생명</th>
                        <th className="py-3 px-3">학번</th>
                        <th className="py-3 px-3">연락처</th>
                        <th className="py-3 px-3">확인코드</th>
                        <th className="py-3 px-3">상태 / 취소사유</th>
                        <th className="py-3 px-3 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filteredAppointments.map((apt) => (
                        <tr key={apt.appointmentId} className="hover:bg-neutral-50/70">
                          <td className="py-3 px-3 font-semibold text-neutral-900">{formatKoreanDate(apt.date)}</td>
                          <td className="py-3 px-3 font-bold text-[#B70050] tabular-nums">
                            {apt.startTime} ~ {apt.endTime}
                          </td>
                          <td className="py-3 px-3">
                            {apt.consultationType === 'online' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-neutral-100 text-neutral-800 font-bold text-[11px]">
                                <Video className="w-3 h-3 text-[#B70050]" />
                                비대면
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FDF2F6] text-[#B70050] font-bold text-[11px]">
                                <MapPin className="w-3 h-3" />
                                대면
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-medium text-neutral-900">{apt.studentName}</td>
                          <td className="py-3 px-3 text-neutral-600 font-mono tabular-nums">{apt.studentId}</td>
                          <td className="py-3 px-3 text-neutral-600 tabular-nums">
                            <a href={`tel:${apt.phone}`} className="hover:underline text-[#B70050]">
                              {apt.phone}
                            </a>
                          </td>
                          <td className="py-3 px-3 font-mono text-neutral-500 tabular-nums">{apt.confirmationCode || '-'}</td>
                          <td className="py-3 px-3">
                            {apt.status === 'confirmed' ? (
                              <span className="text-xs font-bold text-[#B70050]">
                                확정
                              </span>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs font-semibold text-neutral-400">
                                  취소됨
                                </span>
                                <span className="text-[10px] text-neutral-400 mt-0.5">
                                  {apt.cancellationReason === 'professor_schedule_conflict'
                                    ? '교수 개인일정 충돌'
                                    : apt.cancellationReason === 'class_schedule_change'
                                    ? '수업 일정 변경'
                                    : '관리자 수동 취소'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleStartEditAppointment(apt)}
                              className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[11px] font-medium transition-colors cursor-pointer"
                            >
                              수정
                            </button>
                            {apt.status === 'confirmed' && (
                              <button
                                type="button"
                                onClick={() => handleCancelAppointment(apt.appointmentId)}
                                className="px-2.5 py-1 rounded-lg bg-[#FDF2F6] hover:bg-[#B70050] hover:text-white text-[#B70050] text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                취소
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteAppointment(apt.appointmentId)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CLASS SCHEDULES */}
        {activeTab === 'classes' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">교수 수업 일정 관리</h2>
                  <p className="text-xs text-neutral-500">
                    등록된 수업 요일 및 시간대는 학생 상담 화면에서 자동으로 신청 불가 처리됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingClassId(null);
                    setNewClass({
                      title: '',
                      weekday: 'monday',
                      startTime: '10:30',
                      endTime: '12:00',
                      startDate: semester?.startDate || '2026-09-01',
                      endDate: semester?.endDate || '2026-12-15',
                    });
                    setShowAddClass(!showAddClass);
                  }}
                  className="px-3.5 py-2 bg-[#B70050] hover:bg-[#960041] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>수업 일정 추가</span>
                </button>
              </div>

              {/* Add / Edit Class Form */}
              {showAddClass && (
                <form onSubmit={handleCreateClass} className="p-4 bg-[#FDF2F6]/60 rounded-xl border border-[#F5C2D7] mb-6 space-y-4">
                  <h3 className="text-xs font-bold text-[#B70050] uppercase">
                    {editingClassId ? '기존 수업 일정 수정' : '새 수업 등록'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-neutral-600 mb-1">과목명</label>
                      <input
                        type="text"
                        placeholder="예: 머신러닝"
                        value={newClass.title}
                        onChange={(e) => setNewClass({ ...newClass, title: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">요일</label>
                      <select
                        value={newClass.weekday}
                        onChange={(e) => setNewClass({ ...newClass, weekday: e.target.value as Weekday })}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      >
                        <option value="monday">월요일</option>
                        <option value="tuesday">화요일</option>
                        <option value="wednesday">수요일</option>
                        <option value="thursday">목요일</option>
                        <option value="friday">금요일</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">수업 시간</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={newClass.startTime}
                          onChange={(e) => setNewClass({ ...newClass, startTime: e.target.value })}
                          className="w-full px-2 py-2 bg-white rounded-lg border border-neutral-200 text-center focus:outline-none focus:border-[#B70050]"
                          required
                        />
                        <span>~</span>
                        <input
                          type="time"
                          value={newClass.endTime}
                          onChange={(e) => setNewClass({ ...newClass, endTime: e.target.value })}
                          className="w-full px-2 py-2 bg-white rounded-lg border border-neutral-200 text-center focus:outline-none focus:border-[#B70050]"
                          required
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddClass(false);
                        setEditingClassId(null);
                      }}
                      className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      {editingClassId ? '수정 저장하기' : '저장하기'}
                    </button>
                  </div>
                </form>
              )}

              {/* Class list */}
              {classSchedules.length === 0 ? (
                <div className="text-center py-10 text-neutral-400 text-sm">
                  등록된 수업 일정이 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {classSchedules.map((cls) => (
                    <div
                      key={cls.id}
                      className="p-4 rounded-xl border border-neutral-200 bg-white hover:border-[#B70050] transition-all flex items-start justify-between"
                    >
                      <div>
                        <span className="text-[11px] font-bold text-[#B70050] uppercase">
                          {cls.weekday === 'monday' ? '월' : cls.weekday === 'tuesday' ? '화' : cls.weekday === 'wednesday' ? '수' : cls.weekday === 'thursday' ? '목' : '금'}요일
                        </span>
                        <h4 className="font-bold text-sm text-neutral-900 mt-0.5">{cls.title}</h4>
                        <div className="text-xs text-[#B70050] font-semibold mt-0.5 tabular-nums">
                          {cls.startTime} ~ {cls.endTime}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">
                          적용: {cls.startDate} ~ {cls.endDate}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditClass(cls)}
                          className="p-1.5 text-neutral-400 hover:text-[#B70050] rounded-lg hover:bg-[#FDF2F6] transition-colors cursor-pointer"
                          title="수업 수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClass(cls.id)}
                          className="p-1.5 text-neutral-400 hover:text-[#B70050] rounded-lg hover:bg-[#FDF2F6] transition-colors cursor-pointer"
                          title="수업 삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PERSONAL SCHEDULES */}
        {activeTab === 'personal' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">교수 개인 일정 관리</h2>
                  <p className="text-xs text-neutral-500">
                    일정 제목과 메모는 학생에게 절대 노출되지 않으며, 등록·수정 시 충돌하는 상담 신청은 자동으로 취소 및 차단됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPersonalSchedule(null);
                    setNewPersonal({
                      title: '',
                      note: '',
                      date: getNowSeoul().dateStr,
                      startTime: '14:00',
                      endTime: '15:30',
                    });
                    setShowAddPersonal(!showAddPersonal);
                  }}
                  className="px-3.5 py-2 bg-[#B70050] hover:bg-[#960041] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>개인 일정 추가</span>
                </button>
              </div>

              {/* Add / Edit Personal Form */}
              {showAddPersonal && (
                <form onSubmit={handlePreCheckPersonal} className="p-4 bg-[#FDF2F6]/60 rounded-xl border border-[#F5C2D7] mb-6 space-y-4">
                  <h3 className="text-xs font-bold text-[#B70050] uppercase">
                    {editingPersonalSchedule ? '기존 개인 일정 수정' : '개인 일정 등록'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-neutral-600 mb-1">날짜</label>
                      <input
                        type="date"
                        value={newPersonal.date}
                        onChange={(e) => setNewPersonal({ ...newPersonal, date: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">시간</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={newPersonal.startTime}
                          onChange={(e) => setNewPersonal({ ...newPersonal, startTime: e.target.value })}
                          className="w-full px-2 py-2 bg-white rounded-lg border border-neutral-200 text-center focus:outline-none focus:border-[#B70050]"
                          required
                        />
                        <span>~</span>
                        <input
                          type="time"
                          value={newPersonal.endTime}
                          onChange={(e) => setNewPersonal({ ...newPersonal, endTime: e.target.value })}
                          className="w-full px-2 py-2 bg-white rounded-lg border border-neutral-200 text-center focus:outline-none focus:border-[#B70050]"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">일정 제목 (교수만 열람)</label>
                      <input
                        type="text"
                        placeholder="예: 학과 회의 / 외부 학회"
                        value={newPersonal.title}
                        onChange={(e) => setNewPersonal({ ...newPersonal, title: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">메모 (선택)</label>
                      <input
                        type="text"
                        placeholder="비고"
                        value={newPersonal.note}
                        onChange={(e) => setNewPersonal({ ...newPersonal, note: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddPersonal(false);
                        setEditingPersonalSchedule(null);
                      }}
                      className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      {editingPersonalSchedule ? '수정 내용 저장' : '확인 및 저장'}
                    </button>
                  </div>
                </form>
              )}

              {/* Personal list */}
              {personalSchedules.length === 0 ? (
                <div className="text-center py-10 text-neutral-400 text-sm">
                  등록된 개인 일정이 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {personalSchedules.map((sch) => (
                    <div
                      key={sch.id}
                      className="p-4 rounded-xl border border-neutral-200 bg-white hover:border-[#B70050] transition-all flex items-start justify-between"
                    >
                      <div>
                        <div className="text-xs font-semibold text-neutral-500">{formatKoreanDate(sch.date)}</div>
                        <h4 className="font-bold text-sm text-neutral-900 mt-0.5">{sch.title}</h4>
                        <div className="text-xs text-[#B70050] font-semibold mt-0.5 tabular-nums">
                          {sch.startTime} ~ {sch.endTime} (차단됨)
                        </div>
                        {sch.note && <div className="text-[11px] text-neutral-400 mt-1">{sch.note}</div>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditPersonal(sch)}
                          className="p-1.5 text-neutral-400 hover:text-[#B70050] rounded-lg hover:bg-[#FDF2F6] transition-colors cursor-pointer"
                          title="일정 수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePersonal(sch)}
                          className="p-1.5 text-neutral-400 hover:text-[#B70050] rounded-lg hover:bg-[#FDF2F6] transition-colors cursor-pointer"
                          title="일정 삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: STUDENTS DIRECTORY */}
        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">지도학생 명단 관리</h2>
                  <p className="text-xs text-neutral-500">
                    해당 학기에 등록된 학번만 상담 신청이 승인됩니다. 학생 브라우저로 전체 명단이 절대 노출되지 않습니다.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="학번 또는 이름 검색"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-xl border border-neutral-200 text-xs w-44 sm:w-56 focus:outline-none focus:border-[#B70050]"
                    />
                    <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddStudents(!showAddStudents)}
                    className="px-3.5 py-2 bg-[#B70050] hover:bg-[#960041] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>학번 일괄 등록</span>
                  </button>
                </div>
              </div>

              {/* Add Students Form */}
              {showAddStudents && (
                <form onSubmit={handleBulkAddStudents} className="p-4 bg-[#FDF2F6]/60 rounded-xl border border-[#F5C2D7] mb-6 space-y-3">
                  <h3 className="text-xs font-bold text-[#B70050] uppercase">학번 및 학생 일괄 등록 (붙여넣기 / CSV)</h3>
                  <p className="text-[11px] text-neutral-500">
                    줄바꿈 또는 쉼표로 구분하여 여러 학번을 한 번에 입력할 수 있습니다. (예: "20260001 김민준" 또는 "20260002")
                  </p>
                  <textarea
                    rows={4}
                    value={bulkStudentText}
                    onChange={(e) => setBulkStudentText(e.target.value)}
                    placeholder="20260001 김민준&#10;20260002 이서연&#10;20260003"
                    className="w-full p-3 bg-white rounded-lg border border-neutral-200 text-xs font-mono focus:outline-none focus:border-[#B70050]"
                    required
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddStudents(false)}
                      className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      일괄 등록 실행
                    </button>
                  </div>
                </form>
              )}

              {/* Edit Single Student Form */}
              {editingStudent && (
                <form onSubmit={handleSaveStudentEdit} className="p-4 bg-[#FDF2F6]/60 rounded-xl border border-[#F5C2D7] mb-6 space-y-3">
                  <h3 className="text-xs font-bold text-[#B70050] uppercase">
                    학생 정보 수정 · 학번 {editingStudent.studentId}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-neutral-600 mb-1">이름</label>
                      <input
                        type="text"
                        value={editStudentForm.name}
                        onChange={(e) => setEditStudentForm({ ...editStudentForm, name: e.target.value })}
                        placeholder="학생 이름"
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">1학기 대면 상담 이수 여부</label>
                      <select
                        value={editStudentForm.firstSemesterInPerson ? 'true' : 'false'}
                        onChange={(e) =>
                          setEditStudentForm({
                            ...editStudentForm,
                            firstSemesterInPerson: e.target.value === 'true',
                          })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      >
                        <option value="true">1학기 대면 완료 (2학기 비대면 가능)</option>
                        <option value="false">최초 상담 (대면 필수)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-neutral-600 mb-1">신청 활성 상태</label>
                      <select
                        value={editStudentForm.active ? 'true' : 'false'}
                        onChange={(e) =>
                          setEditStudentForm({
                            ...editStudentForm,
                            active: e.target.value === 'true',
                          })
                        }
                        className="w-full px-3 py-2 bg-white rounded-lg border border-neutral-200 focus:outline-none focus:border-[#B70050]"
                      >
                        <option value="true">활성 (신청 가능)</option>
                        <option value="false">비활성 (신청 제한)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingStudent(null)}
                      className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      수정 저장
                    </button>
                  </div>
                </form>
              )}

              {/* Student table */}
              {filteredStudents.length === 0 ? (
                <div className="text-center py-10 text-neutral-400 text-sm">
                  등록된 지도학생이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-100 text-neutral-400 uppercase tracking-wider">
                        <th className="py-2.5 px-3">학번</th>
                        <th className="py-2.5 px-3">이름</th>
                        <th className="py-2.5 px-3">올해(1학기) 대면 상담 여부</th>
                        <th className="py-2.5 px-3">상태</th>
                        <th className="py-2.5 px-3 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filteredStudents.map((st) => {
                        const completedInPerson = st.firstSemesterInPerson ?? true;
                        return (
                          <tr key={st.id} className="hover:bg-neutral-50/70">
                            <td className="py-3 px-3 font-mono font-bold text-neutral-900 tabular-nums">{st.studentId}</td>
                            <td className="py-3 px-3 text-neutral-700">{st.name || '-'}</td>
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => handleToggleStudentFirstSemester(st.id, completedInPerson)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                  completedInPerson
                                    ? 'bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7]'
                                    : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                                }`}
                                title="클릭하여 대면/비대면 가능 여부 변경"
                              >
                                {completedInPerson ? '1학기 대면 완료 (2학기 비대면 가능)' : '최초 상담 (대면 필수)'}
                              </button>
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`text-xs font-bold ${
                                  st.active ? 'text-[#B70050]' : 'text-neutral-400'
                                }`}
                              >
                                {st.active ? '활성 (신청 가능)' : '비활성'}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right space-x-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEditStudent(st)}
                                className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[11px] font-medium cursor-pointer"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStudent(st.id, st.active)}
                                className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[11px] font-medium cursor-pointer"
                              >
                                {st.active ? '비활성화' : '활성화'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteStudent(st.id)}
                                className="px-2.5 py-1 rounded-lg bg-[#FDF2F6] hover:bg-[#B70050] hover:text-white text-[#B70050] text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: SEMESTER SETTINGS */}
        {activeTab === 'semester' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 max-w-2xl">
              <h2 className="text-lg font-bold text-neutral-900 mb-1">학기 및 상담 기본 설정</h2>
              <p className="text-xs text-neutral-500 mb-6">
                현재 활성화된 학기 기간(시작일~종료일) 내에서만 학생들이 상담 일정을 신청할 수 있습니다.
              </p>

              <form onSubmit={handleSaveSemesterSettings} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">년도</label>
                    <input
                      type="number"
                      value={editSemesterData.year}
                      onChange={(e) =>
                        setEditSemesterData({ ...editSemesterData, year: parseInt(e.target.value) || 2026 })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">학기 (대면/비대면 정책 자동 연동)</label>
                    <select
                      value={editSemesterData.semester}
                      onChange={(e) =>
                        setEditSemesterData({
                          ...editSemesterData,
                          semester: parseInt(e.target.value) as 1 | 2,
                        })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                    >
                      <option value={1}>1학기 (전원 대면 상담 전용)</option>
                      <option value={2}>2학기 (1학기 대면 완료자 비대면 허용)</option>
                    </select>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#FDF2F6]/60 border border-[#F5C2D7] text-neutral-700 leading-relaxed">
                  <span className="font-bold text-[#B70050]">학기별 상담 유형 운영 정책: </span>
                  {editSemesterData.semester === 1
                    ? '1학기로 설정 시 모든 지도학생은 대면 상담만 신청할 수 있습니다.'
                    : '2학기로 설정 시 올해(1학기) 대면 상담을 진행한 학생은 비대면 상담을 선택할 수 있으며, 최초 상담 학생은 대면을 선택하도록 안내됩니다.'}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">학기 시작일</label>
                    <input
                      type="date"
                      value={editSemesterData.startDate}
                      onChange={(e) =>
                        setEditSemesterData({ ...editSemesterData, startDate: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">학기 종료일</label>
                    <input
                      type="date"
                      value={editSemesterData.endDate}
                      onChange={(e) =>
                        setEditSemesterData({ ...editSemesterData, endDate: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">상담가능 시작시간</label>
                    <input
                      type="time"
                      value={editSemesterData.dayStart}
                      onChange={(e) =>
                        setEditSemesterData({ ...editSemesterData, dayStart: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-neutral-600 mb-1">상담가능 종료시간</label>
                    <input
                      type="time"
                      value={editSemesterData.dayEnd}
                      onChange={(e) =>
                        setEditSemesterData({ ...editSemesterData, dayEnd: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                      required
                    />
                  </div>
                </div>

                {/* Google Form Link Setting */}
                <div className="pt-2 border-t border-neutral-100">
                  <label className="block font-bold text-neutral-800 mb-1">
                    비대면 상담용 구글폼(Google Form) 링크
                  </label>
                  <p className="text-[11px] text-neutral-500 mb-2">
                    비대면 상담을 신청한 학생들이 상담 전 사전 내용을 작성할 구글폼 주소(URL)를 입력하세요.
                  </p>
                  <input
                    id="input-semester-google-form-url"
                    type="url"
                    placeholder="https://docs.google.com/forms/... 또는 https://forms.gle/..."
                    value={editSemesterData.googleFormUrl}
                    onChange={(e) =>
                      setEditSemesterData({ ...editSemesterData, googleFormUrl: e.target.value })
                    }
                    className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B70050]"
                  />
                </div>

                <div className="pt-3">
                  <button
                    type="submit"
                    className="w-full py-3 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    학기 설정 및 구글폼 링크 저장
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* CONFLICT WARNING MODAL (CASE 9 & 10 REQUIREMENT) */}
      {conflictModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#F5C2D7]">
            <div className="w-12 h-12 rounded-xl bg-[#FDF2F6] text-[#B70050] flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-neutral-900 mb-1">상담 신청 충돌 경고</h3>
            <p className="text-xs text-[#B70050] font-semibold mb-4">
              이 개인 일정을 추가하면 기존 확정된 상담 신청 {conflictModalData.conflicts.length}건이 자동으로 취소됩니다.
            </p>

            <div className="text-xs text-neutral-600 mb-4 bg-neutral-50 p-3 rounded-xl space-y-2 border border-neutral-200 max-h-48 overflow-y-auto">
              <div className="font-semibold text-neutral-700">영향을 받는 학생 목록:</div>
              {conflictModalData.conflicts.map((c) => (
                <div key={c.appointmentId} className="border-b border-neutral-200/60 pb-2 last:border-0 last:pb-0">
                  <div className="font-bold text-neutral-900">
                    {c.studentName} ({c.studentId})
                  </div>
                  <div className="text-neutral-500 text-[11px] tabular-nums">
                    일시: {formatKoreanDate(c.date)} {c.startTime} ~ {c.endTime}
                  </div>
                  <div className="text-neutral-500 text-[11px] tabular-nums">
                    연락처: <span className="font-semibold text-neutral-700">{c.phone}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-neutral-500 mb-5 leading-relaxed">
              취소 후에도 상담 이력 및 학생 연락처는 삭제되지 않고 "취소됨 (교수 개인일정 충돌)" 상태로 관리자 화면에 보존됩니다.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConflictModalData(null)}
                className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-neutral-700 text-xs font-semibold hover:bg-neutral-50 cursor-pointer"
              >
                취소 (일정 등록 안 함)
              </button>
              <button
                type="button"
                onClick={handleConfirmPersonalWithCancel}
                className="flex-1 py-2.5 rounded-xl bg-[#B70050] hover:bg-[#960041] text-white text-xs font-bold cursor-pointer"
              >
                기존 상담 취소하고 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
