import React from 'react';
import { CheckCircle, Calendar, Clock, User, Phone, MapPin, Video, FileText, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { Appointment } from '../types';
import { formatKoreanDate } from '../lib/dateUtils';

interface BookingSuccessModalProps {
  appointment: Appointment;
  googleFormUrl?: string;
  onClose: () => void;
}

export const BookingSuccessModal: React.FC<BookingSuccessModalProps> = ({
  appointment,
  googleFormUrl,
  onClose,
}) => {
  const isOnline = appointment.consultationType === 'online';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs"
    >
      <motion.div
        id="booking-success-modal"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="bg-white rounded-3xl max-w-md w-full p-7 shadow-2xl border border-neutral-200 flex flex-col items-center text-center relative overflow-hidden"
      >
        {/* Top Burgundy Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#B70050]" />

        <div className="w-16 h-16 rounded-2xl bg-[#FDF2F6] text-[#B70050] border border-[#F5C2D7] flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 stroke-[2.2]" />
        </div>

        <h3 className="text-xl font-bold text-neutral-900 mb-1">상담 신청이 완료되었습니다</h3>
        <p className="text-xs sm:text-sm text-neutral-500 mb-5 leading-relaxed">
          교수님의 상담 일정에 즉시 확정 반영되었습니다.<br />
          {isOnline
            ? '비대면 상담을 신청하셨으므로 반드시 사전 구글폼을 작성해주세요.'
            : '신청 일시에 맞추어 연구실(차미리사관 130호)로 방문해주세요.'}
        </p>

        {/* Confirmation Code Card */}
        {appointment.confirmationCode && (
          <div className="w-full bg-[#FDF2F6] border border-[#F5C2D7] rounded-xl p-3.5 mb-4 flex items-center justify-between">
            <span className="text-xs font-bold text-[#B70050]">신청 확인번호</span>
            <span className="font-mono text-xs font-bold text-neutral-900 bg-white px-3 py-1 rounded-lg border border-[#F5C2D7] tabular-nums">
              {appointment.confirmationCode}
            </span>
          </div>
        )}

        {/* Appointment Details Table */}
        <div className="w-full bg-neutral-50 rounded-2xl p-4 border border-neutral-200/80 text-left space-y-3 mb-5 text-xs sm:text-sm text-neutral-600">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500 flex items-center gap-1.5">
              {isOnline ? (
                <Video className="w-3.5 h-3.5 text-[#B70050]" />
              ) : (
                <MapPin className="w-3.5 h-3.5 text-[#B70050]" />
              )}
              <span>상담 유형</span>
            </span>
            <span className="font-bold text-[#B70050]">
              {isOnline ? '비대면 상담 (구글폼 작성 필수)' : '대면 상담 (차미리사관 130호)'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#B70050]" />
              <span>상담 일자</span>
            </span>
            <span className="font-bold text-neutral-900">{formatKoreanDate(appointment.date)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#B70050]" />
              <span>상담 시간</span>
            </span>
            <span className="font-bold text-[#B70050] tabular-nums">
              {appointment.startTime} ~ {appointment.endTime} (30~60분)
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#B70050]" />
              <span>신청 학생</span>
            </span>
            <span className="font-bold text-neutral-900 tabular-nums">
              {appointment.studentName} ({appointment.studentId})
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-[#B70050]" />
              <span>연락처</span>
            </span>
            <span className="font-bold text-neutral-900 tabular-nums">{appointment.phone}</span>
          </div>
        </div>

        {/* Mandatory Google Form Notice for Online Appointments */}
        {isOnline && (
          <div className="w-full p-4 rounded-2xl bg-[#FDF2F6] border border-[#F5C2D7] text-left mb-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <FileText className="w-4 h-4 text-[#B70050] shrink-0 mt-0.5" />
              <div className="text-xs text-neutral-800 leading-relaxed">
                <p className="font-bold text-[#B70050] mb-0.5">[필수] 비대면 상담 사전 구글폼 작성 안내</p>
                <p>
                  비대면으로 신청한 학생은 반드시 구글폼을 통해 상담에 필요한 내용을 작성해야 합니다.
                </p>
              </div>
            </div>
            {googleFormUrl && (
              <a
                href={googleFormUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>구글폼 작성하러 가기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        <button
          id="btn-close-success-modal"
          type="button"
          onClick={onClose}
          className={`w-full py-3.5 font-bold rounded-xl text-sm transition-colors cursor-pointer ${
            isOnline && googleFormUrl
              ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800'
              : 'bg-[#B70050] hover:bg-[#960041] text-white'
          }`}
        >
          확인 완료
        </button>
      </motion.div>
    </motion.div>
  );
};
