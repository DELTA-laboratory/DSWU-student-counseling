import React, { useState } from 'react';
import { ShieldAlert, X, Mail, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { loginWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginWithEmail(email, password);
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || '이메일 또는 비밀번호를 다시 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="bg-white rounded-3xl max-w-sm w-full p-7 shadow-2xl border border-neutral-200 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#B70050]" />

        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F6] text-[#B70050] flex items-center justify-center border border-[#F5C2D7]">
            <ShieldAlert className="w-6 h-6 stroke-[1.8]" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-[#B70050] hover:bg-[#FDF2F6] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h3 className="text-lg font-bold text-neutral-900 mb-1">교수 / 관리자 로그인</h3>
        <p className="text-xs sm:text-sm text-neutral-500 mb-5 leading-relaxed">
          관리자 계정 또는 관리자가 사전 등록한 교수 계정(이메일 · 비밀번호)으로만 접속할 수 있습니다.
        </p>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-3.5">
          <div>
            <label htmlFor="admin-email-input" className="block text-xs font-semibold text-neutral-700 mb-1">
              이메일
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
              <input
                id="admin-email-input"
                type="email"
                placeholder="professor@duksung.ac.kr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:outline-none focus:border-[#B70050]"
                required
                autoComplete="email"
              />
            </div>
          </div>
          <div>
            <label htmlFor="admin-password-input" className="block text-xs font-semibold text-neutral-700 mb-1">
              비밀번호
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
              <input
                id="admin-password-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:outline-none focus:border-[#B70050]"
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          <button
            id="btn-admin-email-login"
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#B70050] hover:bg-[#960041] text-white font-bold rounded-xl text-xs sm:text-sm transition-colors cursor-pointer disabled:opacity-50 mt-1"
          >
            {loading ? '인증 확인 중...' : '로그인'}
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-1 px-2 text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer font-medium"
          >
            닫기
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
