import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { signOut as fbSignOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface AuthUserProfile {
  uid: string;
  email: string | null;
  displayName?: string | null;
  role: 'admin' | 'professor';
}

export interface ManagedAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'professor';
  createdAt?: string;
}

interface StoredAccountRecord {
  uid: string;
  email: string;
  displayName: string;
  password: string;
  role: 'admin' | 'professor';
  createdAt: string;
}

interface AuthContextType {
  user: AuthUserProfile | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  adminAccount: ManagedAccount | null;
  professorAccounts: ManagedAccount[];
  loginWithEmail: (email: string, password: string) => Promise<void>;
  updateAdminCredentials: (email: string, password: string) => Promise<void>;
  addProfessorAccount: (email: string, password: string, displayName?: string) => Promise<void>;
  updateProfessorPassword: (uid: string, newPassword: string, displayName?: string) => Promise<void>;
  deleteProfessorAccount: (uid: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  logout: () => Promise<void>;
}

const LOCAL_ADMIN_STORAGE_KEY = 'ds_counseling_admin_session';
const LOCAL_ADMIN_CRED_KEY = 'ds_counseling_admin_credentials';
const LOCAL_PROFESSORS_KEY = 'ds_counseling_professor_accounts';

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  isSuperAdmin: false,
  loading: true,
  adminAccount: null,
  professorAccounts: [],
  loginWithEmail: async () => {},
  updateAdminCredentials: async () => {},
  addProfessorAccount: async () => {},
  updateProfessorPassword: async () => {},
  deleteProfessorAccount: async () => {},
  refreshAccounts: async () => {},
  logout: async () => {},
});

/**
 * Helper to encode/decode account name & password in admin_users.name column
 * Format for admin: `admin:${password}` or `admin:${encodeURIComponent(displayName)}:${password}`
 * Format for professor: `prof:${encodeURIComponent(displayName)}:${password}`
 */
function encodeAccountNameField(role: 'admin' | 'professor', displayName: string, password: string): string {
  const prefix = role === 'admin' ? 'admin' : 'prof';
  const safeName = encodeURIComponent(displayName.trim() || (role === 'admin' ? '박성우 교수' : '교수'));
  return `${prefix}:${safeName}:${password}`;
}

function decodeAccountRow(row: any): StoredAccountRecord {
  const rawName = String(row.name || '');
  const role: 'admin' | 'professor' =
    row.role === 'admin' || row.uid === 'admin-professor' || rawName.startsWith('admin:')
      ? 'admin'
      : 'professor';

  let displayName = role === 'admin' ? '박성우 교수' : '교수';
  let password = '';

  if (rawName.startsWith('admin:') || rawName.startsWith('prof:')) {
    const withoutPrefix = rawName.startsWith('admin:') ? rawName.slice(6) : rawName.slice(5);
    const colonIdx = withoutPrefix.indexOf(':');
    if (colonIdx !== -1) {
      const encodedName = withoutPrefix.slice(0, colonIdx);
      const pwPart = withoutPrefix.slice(colonIdx + 1);
      try {
        displayName = decodeURIComponent(encodedName) || displayName;
      } catch {
        displayName = encodedName || displayName;
      }
      password = pwPart;
    } else {
      // Legacy format: `admin:${password}`
      password = withoutPrefix;
    }
  } else if (rawName) {
    displayName = rawName;
  }

  return {
    uid: String(row.uid || (role === 'admin' ? 'admin-professor' : `prof-${row.email}`)),
    email: String(row.email || '').toLowerCase().trim(),
    displayName,
    password,
    role,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [adminAccount, setAdminAccount] = useState<ManagedAccount | null>(null);
  const [professorAccounts, setProfessorAccounts] = useState<ManagedAccount[]>([]);

  const loadAllAccounts = useCallback(async (): Promise<StoredAccountRecord[]> => {
    const records: StoredAccountRecord[] = [];

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('*')
          .order('created_at', { ascending: true });

        if (!error && data) {
          for (const row of data) {
            if (String(row.uid || '').startsWith('meta:') || row.role === 'meta') {
              continue;
            }
            records.push(decodeAccountRow(row));
          }
        }
      } catch {
        // Ignore query error
      }
    } else {
      try {
        const snap = await getDocs(collection(db, 'adminUsers'));
        snap.forEach((d) => {
          const docData = d.data();
          if (d.id.startsWith('meta:') || docData?.role === 'meta') return;
          records.push(decodeAccountRow({ uid: d.id, ...docData }));
        });
      } catch {
        // Ignore Firestore error
      }
    }

    // Fallback to localStorage if DB returned no admin yet
    if (!records.some((r) => r.role === 'admin')) {
      const envAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim();
      const envAdminPassword = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined)?.trim();
      try {
        const savedCredStr = localStorage.getItem(LOCAL_ADMIN_CRED_KEY);
        if (savedCredStr) {
          const parsed = JSON.parse(savedCredStr);
          if (parsed?.email && parsed?.password) {
            records.push({
              uid: 'admin-professor',
              email: String(parsed.email).toLowerCase().trim(),
              displayName: '박성우 교수 (관리자)',
              password: String(parsed.password),
              role: 'admin',
              createdAt: new Date().toISOString(),
            });
          }
        } else if (envAdminEmail && envAdminPassword) {
          records.push({
            uid: 'admin-professor',
            email: envAdminEmail.toLowerCase(),
            displayName: '박성우 교수 (관리자)',
            password: envAdminPassword,
            role: 'admin',
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        // Ignore
      }
    }

    // Also merge any local professor accounts if offline
    try {
      const localProfsStr = localStorage.getItem(LOCAL_PROFESSORS_KEY);
      if (localProfsStr) {
        const localProfs = JSON.parse(localProfsStr) as StoredAccountRecord[];
        for (const lp of localProfs) {
          if (!records.some((r) => r.email.toLowerCase() === lp.email.toLowerCase())) {
            records.push(lp);
          }
        }
      }
    } catch {
      // Ignore
    }

    // Enforce single admin account in state
    const primaryAdmin = records.find((r) => r.uid === 'admin-professor') || records.find((r) => r.role === 'admin') || null;
    const profs = records.filter((r) => r.role === 'professor' && r.uid !== primaryAdmin?.uid);

    setAdminAccount(
      primaryAdmin
        ? {
            uid: primaryAdmin.uid,
            email: primaryAdmin.email,
            displayName: primaryAdmin.displayName,
            role: 'admin',
            createdAt: primaryAdmin.createdAt,
          }
        : null
    );

    setProfessorAccounts(
      profs.map((p) => ({
        uid: p.uid,
        email: p.email,
        displayName: p.displayName,
        role: 'professor',
        createdAt: p.createdAt,
      }))
    );

    return records;
  }, []);

  useEffect(() => {
    let parsedSession: AuthUserProfile | null = null;
    try {
      const savedSession = localStorage.getItem(LOCAL_ADMIN_STORAGE_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as AuthUserProfile;
        if (parsed?.email) {
          parsedSession = {
            ...parsed,
            role: parsed.role === 'admin' ? 'admin' : 'professor',
          };
          setUser(parsedSession);
          setIsAdmin(true);
        }
      }
    } catch {
      // Ignore storage error
    }

    loadAllAccounts()
      .then((records) => {
        if (parsedSession?.email && records.length > 0) {
          const matched = records.find(
            (r) => r.email.toLowerCase() === parsedSession!.email!.toLowerCase()
          );
          if (matched) {
            const verifiedProfile: AuthUserProfile = {
              uid: matched.uid,
              email: matched.email,
              displayName: matched.displayName,
              role: matched.role,
            };
            localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(verifiedProfile));
            setUser(verifiedProfile);
            setIsAdmin(true);
          } else {
            // Account was removed by admin
            localStorage.removeItem(LOCAL_ADMIN_STORAGE_KEY);
            setUser(null);
            setIsAdmin(false);
          }
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadAllAccounts]);

  const establishSession = (profile: AuthUserProfile) => {
    localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(profile));
    setUser(profile);
    setIsAdmin(true);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanEmail || !cleanPassword) {
      throw new Error('이메일과 비밀번호를 모두 입력해주세요.');
    }

    const records = await loadAllAccounts();

    // 1. Check against the single Admin account & registered Professor accounts in DB
    const matched = records.find((r) => r.email.toLowerCase() === cleanEmail);
    if (matched) {
      if (matched.password && matched.password === cleanPassword) {
        establishSession({
          uid: matched.uid,
          email: matched.email,
          displayName: matched.displayName,
          role: matched.role,
        });
        return;
      }
      throw new Error('비밀번호가 일치하지 않습니다. 다시 확인해주세요.');
    }

    // 2. Check environment variable Admin credentials if configured
    const envAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim().toLowerCase();
    const envAdminPassword = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined)?.trim();
    if (envAdminEmail && envAdminPassword && cleanEmail === envAdminEmail && cleanPassword === envAdminPassword) {
      establishSession({
        uid: 'admin-professor',
        email: cleanEmail,
        displayName: '박성우 교수 (관리자)',
        role: 'admin',
      });
      return;
    }

    throw new Error('등록되지 않은 계정입니다. 교수 계정은 관리자가 추가한 계정만 로그인할 수 있습니다.');
  };

  const updateAdminCredentials = async (email: string, password: string) => {
    if (!user || user.role !== 'admin') {
      throw new Error('관리자 계정만 관리자 정보를 변경할 수 있습니다.');
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || password.length < 4) {
      throw new Error('유효한 이메일과 4자 이상의 비밀번호를 입력해주세요.');
    }

    const encodedName = encodeAccountNameField('admin', '박성우 교수 (관리자)', password);

    localStorage.setItem(
      LOCAL_ADMIN_CRED_KEY,
      JSON.stringify({ email: cleanEmail, password })
    );

    if (isSupabaseConfigured && supabase) {
      // Ensure only 1 admin row exists with uid = 'admin-professor'
      await supabase
        .from('admin_users')
        .delete()
        .eq('role', 'admin')
        .neq('uid', 'admin-professor');

      const { error } = await supabase.from('admin_users').upsert({
        uid: 'admin-professor',
        email: cleanEmail,
        name: encodedName,
        role: 'admin',
      });
      if (error) {
        throw new Error('관리자 계정 정보 저장에 실패했습니다.');
      }
    } else {
      await setDoc(doc(db, 'adminUsers', 'admin-professor'), {
        uid: 'admin-professor',
        email: cleanEmail,
        name: encodedName,
        role: 'admin',
        createdAt: serverTimestamp(),
      });
    }

    establishSession({
      uid: 'admin-professor',
      email: cleanEmail,
      displayName: '박성우 교수 (관리자)',
      role: 'admin',
    });

    await loadAllAccounts();
  };

  const addProfessorAccount = async (email: string, password: string, displayName?: string) => {
    if (!user || user.role !== 'admin') {
      throw new Error('관리자 계정에서만 교수 계정을 추가할 수 있습니다.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (displayName || '').trim() || '교수';

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('유효한 교수 이메일 주소를 입력해주세요.');
    }
    if (!password || password.length < 4) {
      throw new Error('비밀번호는 4자 이상으로 설정해주세요.');
    }

    const existing = await loadAllAccounts();
    if (existing.some((acc) => acc.email.toLowerCase() === cleanEmail)) {
      throw new Error('이미 등록된 이메일 계정입니다.');
    }

    const uid = `prof-${Date.now()}`;
    const encodedName = encodeAccountNameField('professor', cleanName, password);

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('admin_users').insert({
        uid,
        email: cleanEmail,
        name: encodedName,
        role: 'professor',
      });
      if (error) {
        throw new Error('교수 계정 추가 중 데이터베이스 오류가 발생했습니다.');
      }
    } else {
      await setDoc(doc(db, 'adminUsers', uid), {
        uid,
        email: cleanEmail,
        name: encodedName,
        role: 'professor',
        createdAt: serverTimestamp(),
      });
    }

    // Also update local cache
    try {
      const localProfsStr = localStorage.getItem(LOCAL_PROFESSORS_KEY);
      const localProfs: StoredAccountRecord[] = localProfsStr ? JSON.parse(localProfsStr) : [];
      localProfs.push({
        uid,
        email: cleanEmail,
        displayName: cleanName,
        password,
        role: 'professor',
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(LOCAL_PROFESSORS_KEY, JSON.stringify(localProfs));
    } catch {
      // Ignore
    }

    await loadAllAccounts();
  };

  const updateProfessorPassword = async (uid: string, newPassword: string, displayName?: string) => {
    if (!user || user.role !== 'admin') {
      throw new Error('관리자 계정에서만 교수 계정을 수정할 수 있습니다.');
    }
    if (!newPassword || newPassword.length < 4) {
      throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
    }

    const existing = await loadAllAccounts();
    const target = existing.find((a) => a.uid === uid && a.role === 'professor');
    if (!target) {
      throw new Error('대상 교수 계정을 찾을 수 없습니다.');
    }

    const updatedName = (displayName || target.displayName || '교수').trim();
    const encodedName = encodeAccountNameField('professor', updatedName, newPassword);

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('admin_users')
        .update({ name: encodedName })
        .eq('uid', uid);
      if (error) {
        throw new Error('교수 계정 비밀번호 변경에 실패했습니다.');
      }
    } else {
      await setDoc(
        doc(db, 'adminUsers', uid),
        { name: encodedName },
        { merge: true }
      );
    }

    try {
      const localProfsStr = localStorage.getItem(LOCAL_PROFESSORS_KEY);
      if (localProfsStr) {
        const localProfs: StoredAccountRecord[] = JSON.parse(localProfsStr);
        const updated = localProfs.map((p) =>
          p.uid === uid ? { ...p, displayName: updatedName, password: newPassword } : p
        );
        localStorage.setItem(LOCAL_PROFESSORS_KEY, JSON.stringify(updated));
      }
    } catch {
      // Ignore
    }

    await loadAllAccounts();
  };

  const deleteProfessorAccount = async (uid: string) => {
    if (!user || user.role !== 'admin') {
      throw new Error('관리자 계정에서만 교수 계정을 삭제할 수 있습니다.');
    }
    if (uid === 'admin-professor') {
      throw new Error('유일한 관리자 계정은 삭제할 수 없습니다.');
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('admin_users').delete().eq('uid', uid);
      if (error) {
        throw new Error('교수 계정 삭제에 실패했습니다.');
      }
    } else {
      await deleteDoc(doc(db, 'adminUsers', uid));
    }

    try {
      const localProfsStr = localStorage.getItem(LOCAL_PROFESSORS_KEY);
      if (localProfsStr) {
        const localProfs: StoredAccountRecord[] = JSON.parse(localProfsStr);
        localStorage.setItem(
          LOCAL_PROFESSORS_KEY,
          JSON.stringify(localProfs.filter((p) => p.uid !== uid))
        );
      }
    } catch {
      // Ignore
    }

    await loadAllAccounts();
  };

  const logout = async () => {
    localStorage.removeItem(LOCAL_ADMIN_STORAGE_KEY);
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore
      }
    }
    try {
      await fbSignOut(auth);
    } catch {
      // Ignore
    }
    setUser(null);
    setIsAdmin(false);
  };

  const refreshAccounts = useCallback(async () => {
    await loadAllAccounts();
  }, [loadAllAccounts]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        isSuperAdmin: Boolean(user && user.role === 'admin'),
        loading,
        adminAccount,
        professorAccounts,
        loginWithEmail,
        updateAdminCredentials,
        addProfessorAccount,
        updateProfessorPassword,
        deleteProfessorAccount,
        refreshAccounts,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
