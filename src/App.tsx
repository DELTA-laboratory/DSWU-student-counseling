import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { sbGetSlotLocks, sbGetAdminAppointments } from './lib/supabaseService';
import {
  SemesterSettings,
  ClassSchedule,
  PersonalSchedule,
  Appointment,
  SlotLock,
  StudentRecord,
  TimeSlotOption,
} from './types';
import {
  getActiveSemester,
  getAllSemesters,
  getClassSchedules,
  getPersonalSchedules,
  getStudents,
  getAdminAppointments,
  getDailySlotOptions,
} from './lib/firestoreService';
import { getNowSeoul } from './lib/dateUtils';
import { seedInitialDataIfNeeded } from './lib/seedData';
import { useAuth } from './context/AuthContext';
import { StudentCalendar } from './components/StudentCalendar';
import { StudentBookingPanel } from './components/StudentBookingPanel';
import { BookingSuccessModal } from './components/BookingSuccessModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminDashboard } from './components/AdminDashboard';
import {
  Calendar,
  Lock,
  Shield,
  GraduationCap,
  Sparkles,
  Info,
  Clock,
  CheckCircle2,
  MapPin,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  Video,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionDivider } from './components/SectionDivider';
import confetti from 'canvas-confetti';

export default function App() {
  const { user, isAdmin, logout } = useAuth();

  // Mode state: 'student' or 'admin'
  const [viewMode, setViewMode] = useState<'student' | 'admin'>('student');
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  // Core Data states
  const [semester, setSemester] = useState<SemesterSettings | null>(null);
  const [allSemesters, setAllSemesters] = useState<SemesterSettings[]>([]);
  const [classSchedules, setClassSchedules] = useState<ClassSchedule[]>([]);
  const [personalSchedules, setPersonalSchedules] = useState<PersonalSchedule[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [adminAppointments, setAdminAppointments] = useState<Appointment[]>([]);
  const [slotLocks, setSlotLocks] = useState<SlotLock[]>([]);

  // Student flow state — initialized to today's date in Asia/Seoul
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const { dateStr } = getNowSeoul();
    const [y, m] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => getNowSeoul().dateStr);
  const [dailySlots, setDailySlots] = useState<TimeSlotOption[]>([]);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [successAppointment, setSuccessAppointment] = useState<Appointment | null>(null);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);

  // 1. Initial Load & Seed Sample Data
  const refreshData = useCallback(async () => {
    try {
      await seedInitialDataIfNeeded();
      const activeSem = await getActiveSemester();
      setSemester(activeSem);

      const semList = await getAllSemesters();
      setAllSemesters(semList);

      if (activeSem) {
        const clsList = await getClassSchedules(activeSem.id);
        setClassSchedules(clsList);

        if (isAdmin) {
          const [persList, studList, aptList] = await Promise.all([
            getPersonalSchedules(activeSem.id),
            getStudents(activeSem.id),
            getAdminAppointments(activeSem.id),
          ]);
          setPersonalSchedules(persList);
          setStudents(studList);
          setAdminAppointments(aptList);
        } else {
          setPersonalSchedules([]);
          setStudents([]);
          setAdminAppointments([]);
        }
      }
    } catch (err) {
      console.error('Error refreshing initial data:', err);
    } finally {
      setInitialLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Align selectedDate and currentMonth when active semester date range changes
  useEffect(() => {
    if (!semester) return;
    const { dateStr: todayStr } = getNowSeoul();
    if (selectedDate < semester.startDate || selectedDate > semester.endDate) {
      const targetDate =
        todayStr >= semester.startDate && todayStr <= semester.endDate
          ? todayStr
          : semester.startDate;
      setSelectedDate(targetDate);
      const [y, m] = targetDate.split('-').map(Number);
      if (y && m) {
        setCurrentMonth(new Date(y, m - 1, 1));
      }
    }
  }, [semester?.id, semester?.startDate, semester?.endDate]);

  // Load admin-only datasets when authenticated as admin
  useEffect(() => {
    if (!isAdmin || !semester) {
      setPersonalSchedules([]);
      setStudents([]);
      setAdminAppointments([]);
      return;
    }

    let isMounted = true;
    Promise.all([
      getPersonalSchedules(semester.id),
      getStudents(semester.id),
      getAdminAppointments(semester.id),
    ])
      .then(([persList, studList, aptList]) => {
        if (isMounted) {
          setPersonalSchedules(persList);
          setStudents(studList);
          setAdminAppointments(aptList);
        }
      })
      .catch((err) => {
        console.error('Error loading admin-specific data:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isAdmin, semester]);

  // 2. Real-time Listener for SlotLocks
  // Crucial: Allows other students viewing simultaneously to see slots update without exposing names or phone numbers!
  useEffect(() => {
    if (!semester) return;

    if (isSupabaseConfigured && supabase) {
      sbGetSlotLocks(semester.id).then(setSlotLocks);
      const channel = supabase
        .channel(`slot_locks_${semester.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'slot_locks',
            filter: `semester_id=eq.${semester.id}`,
          },
          () => {
            sbGetSlotLocks(semester.id).then(setSlotLocks);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    const q = query(
      collection(db, 'slotLocks'),
      where('semesterId', '==', semester.id)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const locks: SlotLock[] = [];
        snapshot.forEach((doc) => {
          locks.push(doc.data() as SlotLock);
        });
        setSlotLocks(locks);
      },
      (err) => {
        console.error('Error listening to slotLocks:', err);
      }
    );

    return () => unsubscribe();
  }, [semester]);

  // 3. Real-time Listener for Appointments (if admin)
  useEffect(() => {
    if (!isAdmin || !semester) return;

    if (isSupabaseConfigured && supabase) {
      sbGetAdminAppointments(semester.id).then(setAdminAppointments);
      const channel = supabase
        .channel(`appointments_${semester.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointments',
            filter: `semester_id=eq.${semester.id}`,
          },
          () => {
            sbGetAdminAppointments(semester.id).then(setAdminAppointments);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    const q = query(
      collection(db, 'appointments'),
      where('semesterId', '==', semester.id)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const apts: Appointment[] = [];
        snapshot.forEach((doc) => {
          apts.push({ ...doc.data(), appointmentId: doc.id } as Appointment);
        });
        setAdminAppointments(apts);
      },
      (err) => {
        console.error('Error listening to appointments:', err);
      }
    );

    return () => unsubscribe();
  }, [isAdmin, semester]);

  // 4. Calculate Daily Slot Availability when date, locks, or classes change
  useEffect(() => {
    if (!semester || !selectedDate) {
      setDailySlots([]);
      return;
    }

    setLoadingSlots(true);
    getDailySlotOptions(semester, selectedDate, classSchedules, slotLocks)
      .then((slots) => {
        setDailySlots(slots);
      })
      .catch((err) => {
        console.error('Error calculating slots:', err);
      })
      .finally(() => {
        setLoadingSlots(false);
      });
  }, [selectedDate, semester, classSchedules, slotLocks]);

  // 5. Booking Success Event
  const handleBookingSuccess = (appointment: Appointment) => {
    setSuccessAppointment(appointment);
    try {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#B70050', '#960041', '#F5C2D7'],
      });
    } catch {
      // Ignore if confetti fails
    }
  };

  // Switch between student and admin view based on authentication or route
  if (viewMode === 'admin') {
    if (!user || !isAdmin) {
      // Security: Unauthorized direct access guard
      return (
        <div className="min-h-screen bg-white text-neutral-900 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FDF2F6] text-[#B70050] flex items-center justify-center mb-4 border border-[#F5C2D7]">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold mb-2">교수 관리자 전용 페이지</h2>
          <p className="text-xs sm:text-sm text-neutral-500 max-w-sm mb-6 leading-relaxed">
            인증되지 않은 사용자는 관리자 화면에 접근할 수 없습니다. 등록된 교수 계정으로 로그인해주세요.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              className="px-5 py-2.5 bg-[#B70050] hover:bg-[#960041] text-white rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors"
            >
              교수 로그인
            </button>
            <button
              type="button"
              onClick={() => setViewMode('student')}
              className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
            >
              학생 화면으로 돌아가기
            </button>
          </div>
          <AdminLoginModal
            isOpen={showLoginModal}
            onClose={() => setShowLoginModal(false)}
            onSuccess={() => setViewMode('admin')}
          />
        </div>
      );
    }

    return (
      <AdminDashboard
        semester={semester}
        allSemesters={allSemesters}
        appointments={adminAppointments}
        classSchedules={classSchedules}
        personalSchedules={personalSchedules}
        students={students}
        onRefresh={refreshData}
        onLogout={async () => {
          await logout();
          setViewMode('student');
        }}
        userEmail={user.email || undefined}
      />
    );
  }

  return (
    <div id="student-portal-root" className="min-h-screen bg-white flex flex-col font-sans text-neutral-900">
      {/* Top Navbar */}
      <header className="bg-white/95 backdrop-blur-md border-b border-neutral-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-18 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#B70050] text-white flex items-center justify-center shrink-0 shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight truncate">
                  학기별 상담 신청 플랫폼
                </span>
                {semester && (
                  <span className="text-xs font-semibold text-[#B70050] hidden sm:inline">
                    · {semester.title}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 font-medium truncate">
                데이터사이언스학과 박성우 교수
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-600">
              <a href="#booking-section" className="hover:text-[#B70050] transition-colors whitespace-nowrap">
                상담 일정 신청
              </a>
              <a href="#guidelines-section" className="hover:text-[#B70050] transition-colors whitespace-nowrap">
                유의사항 및 연구실 안내
              </a>
            </nav>

            {user && isAdmin ? (
              <button
                type="button"
                onClick={() => setViewMode('admin')}
                className="px-4 py-2 bg-[#B70050] hover:bg-[#960041] text-white text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Shield className="w-4 h-4 text-white" />
                <span>교수 관리자 포털</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="px-3.5 py-2 border border-neutral-200 hover:border-[#B70050] hover:text-[#B70050] hover:bg-[#FDF2F6]/40 text-neutral-700 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-[#B70050]" />
                <span>교수 로그인</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Student Page Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 w-full flex-1">
        {/* Banner 안내문 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-5 p-5 sm:p-6 rounded-2xl bg-white border border-neutral-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#B70050]" />
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-[#FDF2F6] text-[#B70050] shrink-0 mt-0.5 border border-[#F5C2D7]/70">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-neutral-900">
                  1:1 지도학생 상담 신청 안내
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-neutral-600 mt-1 leading-relaxed">
                달력에서 희망하는 날짜를 선택한 후 상담 시작 시간을 선택해 신청해주세요. 본 학기에 지도교수로 박성우 교수로 배정된 학생들만 신청 가능합니다. 만약, 학기별 정기 상담과는 별도로 상담을 신청하고 싶은 학생들은 직접 이야기를 하거나 메일로 신청을 하기 바랍니다.
              </p>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-4 text-xs sm:text-sm text-neutral-600 shrink-0 border-t lg:border-t-0 lg:border-l border-neutral-100 pt-3 lg:pt-0 lg:pl-6">
            <div className="flex items-center gap-1.5 font-medium tabular-nums">
              <Clock className="w-4 h-4 text-[#B70050]" />
              <span>
                상담가능 시간: {semester?.dayStart || '09:00'} ~ {semester?.dayEnd || '18:00'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-bold text-neutral-900">
              <CheckCircle2 className="w-4 h-4 text-[#B70050]" />
              <span>30~60분 상담</span>
            </div>
          </div>
        </motion.div>

        {/* Highlighted Policy Banner for In-Person / Online & Google Form (Positioned between 1:1 Info and Booking Section) */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="mb-8 bg-[#FDF2F6]/70 border border-[#F5C2D7] rounded-2xl p-5 sm:p-6 relative overflow-hidden"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#B70050] text-white text-xs font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>필독 유의사항 · 대면 및 비대면 상담 운영 안내</span>
              </div>
              <h4 className="text-base sm:text-lg font-bold text-neutral-900">
                학기별 상담 유형(대면·비대면) 선택 기준 및 사전 구글폼 작성 안내
              </h4>
              <ul className="space-y-1.5 text-xs sm:text-sm text-neutral-700 leading-relaxed list-disc list-inside">
                <li>
                  <strong className="font-bold text-neutral-900">학기별 운영 원칙:</strong> 1학기 정기 상담은 <strong className="font-bold text-[#B70050]">전원 대면 상담</strong>으로 진행하며, 2학기에는 <strong className="font-bold text-[#B70050]">1학기에 대면으로 상담을 진행한 학생에 한하여 비대면 상담 신청이 가능</strong>합니다.
                </li>
                <li>
                  <strong className="font-bold text-neutral-900">지도교수 변경 학생 주의사항:</strong> 1학기에 박성우 교수가 아닌 다른 교수님께 지도교수 배정을 받고 <strong className="font-bold text-[#B70050]">2학기에 박성우 교수가 지도교수로 배정된 학생은 반드시 대면으로 진행</strong>해야 합니다.
                </li>
                <li>
                  <strong className="font-bold text-neutral-900">비대면 신청자 구글폼 작성 필수:</strong> 비대면으로 신청한 학생들은 원활한 상담 진행을 위해 <strong className="font-bold text-[#B70050]">반드시 구글폼(Google Form)을 통해 상담에 필요한 내용을 작성</strong>해야 합니다.
                </li>
                <li>
                  <strong className="font-bold text-neutral-900">비대면 신청자 일정 선택 필수:</strong> 비대면 상담을 신청하는 학생들도 <strong className="font-bold text-[#B70050]">반드시 상담 날짜와 시간을 하나 선택하여 신청</strong>해주기 바랍니다.
                </li>
              </ul>
            </div>

            {semester?.googleFormUrl && (
              <div className="shrink-0 flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#F5C2D7]">
                <a
                  href={semester.googleFormUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-3 bg-[#B70050] hover:bg-[#960041] text-white text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-xs whitespace-nowrap"
                >
                  <FileText className="w-4 h-4" />
                  <span>비대면 상담 구글폼 작성하기</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <span className="text-[11px] text-[#B70050] font-medium text-center lg:text-right">
                  ※ 비대면 상담 신청 시 상담 전 필수 제출
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {initialLoading ? (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <div className="w-8 h-8 border-3 border-[#B70050] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs sm:text-sm text-neutral-500 font-medium">상담 일정 및 학기 정보를 불러오는 중입니다...</p>
          </div>
        ) : !semester || !semester.active ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl border border-neutral-200 p-12 text-center max-w-lg mx-auto"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#FDF2F6] text-[#B70050] flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-neutral-900 mb-1">현재 상담 신청 기간이 아닙니다.</h3>
            <p className="text-xs sm:text-sm text-neutral-500 leading-relaxed">
              교수님의 활성화된 학기 설정이 없습니다. 상담 신청 기간이 시작되면 일정이 공지됩니다.
            </p>
          </motion.div>
        ) : (
          <>
            {/* Section Divider: Main Booking Grid */}
            <div id="booking-section" className="scroll-mt-20">
              <SectionDivider
                title="상담 날짜 및 시간 신청"
                description="좌측 캘린더에서 희망 일자를 선택한 후 우측에서 상담 시작 시간을 선택해 신청을 진행하세요."
                icon={<Calendar className="w-6 h-6 text-[#B70050]" />}
                badge="실시간 확정"
                step="STEP 01 & 02"
                className="mt-2 mb-6"
              />

              {/* Responsive 2-column layout (Desktop: Side-by-Side, Mobile/Tablet: Stacked) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                {/* Left Col: Month Calendar (7 cols on desktop) */}
                <div className="lg:col-span-7 space-y-4">
                  <StudentCalendar
                    currentMonth={currentMonth}
                    onMonthChange={setCurrentMonth}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    semester={semester}
                    slotLocks={slotLocks}
                  />
                </div>

                {/* Right Col: Time Slot Selection & Student Booking Form (5 cols on desktop) */}
                <div className="lg:col-span-5 space-y-4">
                  <StudentBookingPanel
                    selectedDate={selectedDate}
                    timeSlots={dailySlots}
                    semester={semester}
                    loadingSlots={loadingSlots}
                    onBookingSuccess={handleBookingSuccess}
                  />
                </div>
              </div>
            </div>

            {/* Section Divider: Guidelines Section */}
            <div id="guidelines-section" className="scroll-mt-20">
              <SectionDivider
                title="상담 유의사항 및 연구실 안내"
                description="원활한 상담 진행을 위해 방문 전 반드시 아래 안내 사항을 숙지해주세요."
                icon={<ShieldCheck className="w-6 h-6 text-[#B70050]" />}
                badge="필독 유의사항"
                step="NOTICE"
                className="mt-14 mb-6"
              />

              {/* 4 Info / Guidance Cards with smooth scroll entry */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: 0.05 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 hover:border-[#B70050] transition-colors group"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7]/60 flex items-center justify-center mb-4 group-hover:bg-[#B70050] group-hover:text-white transition-colors">
                    <Clock className="w-5 h-5 stroke-[1.8]" />
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mb-2">상담 시간 준수 (60분 이내)</h4>
                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                    상담은 1인당 30~60분 이내로 진행됩니다. 다음 학생의 상담 일정에 지장이 없도록 반드시 신청 시간에 맞추어 참여해주세요.
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: 0.1 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 hover:border-[#B70050] transition-colors group"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7]/60 flex items-center justify-center mb-4 group-hover:bg-[#B70050] group-hover:text-white transition-colors">
                    <MapPin className="w-5 h-5 stroke-[1.8]" />
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mb-2">연구실 위치 및 방문</h4>
                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                    대면 상담의 경우 차미리사관 130호 박성우 교수 개인 연구실에서 진행합니다.
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: 0.15 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 hover:border-[#B70050] transition-colors group"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7]/60 flex items-center justify-center mb-4 group-hover:bg-[#B70050] group-hover:text-white transition-colors">
                    <Video className="w-5 h-5 stroke-[1.8]" />
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mb-2">비대면 상담 및 구글폼</h4>
                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                    올해 대면 상담을 진행한 학생만 2학기에 비대면 신청이 가능하며, 비대면 신청 시 반드시 사전 구글폼을 작성해야 합니다.
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: 0.2 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 hover:border-[#B70050] transition-colors group"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7]/60 flex items-center justify-center mb-4 group-hover:bg-[#B70050] group-hover:text-white transition-colors">
                    <HelpCircle className="w-5 h-5 stroke-[1.8]" />
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mb-2">일정 변경 및 문의</h4>
                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                    일정 변경 또는 문의 사항이 있으실 경우 교수에게 이메일로 최소 24시간 전 사전 연락 바랍니다.
                  </p>
                </motion.div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-neutral-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-400 gap-3">
          <p>© 2026 데이터사이언스학과 박성우 교수 연구실 · 학기별 상담 신청 플랫폼</p>
          <div className="flex items-center gap-3">
            <span>차미리사관 130호</span>
            <span aria-hidden="true">·</span>
            <span>Asia/Seoul (UTC+9)</span>
          </div>
        </div>
      </footer>

      {/* Booking Success Modal with AnimatePresence */}
      <AnimatePresence>
        {successAppointment && (
          <BookingSuccessModal
            appointment={successAppointment}
            googleFormUrl={semester?.googleFormUrl}
            onClose={() => setSuccessAppointment(null)}
          />
        )}
      </AnimatePresence>

      {/* Admin Login Modal with AnimatePresence */}
      <AnimatePresence>
        {showLoginModal && (
          <AdminLoginModal
            isOpen={showLoginModal}
            onClose={() => setShowLoginModal(false)}
            onSuccess={() => setViewMode('admin')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
