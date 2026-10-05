import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface AuthUserProfile {
  uid: string;
  email: string | null;
  displayName?: string | null;
}

interface StoredAdminCredential {
  email: string;
  password: string;
}

interface AuthContextType {
  user: AuthUserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  updateAdminCredentials: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  registerAsAdmin: (uid: string, email: string) => Promise<void>;
}

const LOCAL_ADMIN_STORAGE_KEY = 'ds_counseling_admin_session';
const LOCAL_ADMIN_CRED_KEY = 'ds_counseling_admin_credentials';

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  loginWithEmail: async () => {},
  updateAdminCredentials: async () => {},
  logout: async () => {},
  registerAsAdmin: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let sbSubscription: { unsubscribe: () => void } | null = null;

    // 1. Check saved admin session first
    try {
      const savedSession = localStorage.getItem(LOCAL_ADMIN_STORAGE_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as AuthUserProfile;
        if (parsed?.email) {
          setUser(parsed);
          setIsAdmin(true);
        }
      }
    } catch {
      // Ignore storage error
    }

    // 2. Listen to Supabase Email/Password session
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '박성우 교수',
          };
          localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(profile));
          setUser(profile);
          setIsAdmin(true);
        }
        setLoading(false);
      });

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '박성우 교수',
          };
          localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(profile));
          setUser(profile);
          setIsAdmin(true);
        } else {
          const savedSession = localStorage.getItem(LOCAL_ADMIN_STORAGE_KEY);
          if (!savedSession) {
            setUser(null);
            setIsAdmin(false);
          }
        }
        setLoading(false);
      });
      sbSubscription = data.subscription;
    } else {
      setLoading(false);
    }

    return () => {
      if (sbSubscription) sbSubscription.unsubscribe();
    };
  }, []);

  const completeAdminLogin = async (uid: string, email: string, passwordToSave?: string) => {
    const profile: AuthUserProfile = {
      uid,
      email,
      displayName: '박성우 교수',
    };
    localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(profile));
    if (passwordToSave) {
      localStorage.setItem(
        LOCAL_ADMIN_CRED_KEY,
        JSON.stringify({ email: email.toLowerCase(), password: passwordToSave })
      );
    }
    setUser(profile);
    setIsAdmin(true);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('admin_users').upsert({
          uid,
          email: email.toLowerCase(),
          name: passwordToSave ? `admin:${passwordToSave}` : '박성우 교수',
          role: 'admin',
        });
      } catch {
        // Ignore if table not created yet
      }
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cleanEmail = email.trim();
    const cleanPassword = password;

    if (!cleanEmail || !cleanPassword) {
      throw new Error('이메일과 비밀번호를 모두 입력해주세요.');
    }

    const envAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim();
    const envAdminPassword = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined)?.trim();

    // 1. Check Environment Variable Admin Credentials (if configured)
    if (envAdminEmail && envAdminPassword) {
      if (
        cleanEmail.toLowerCase() === envAdminEmail.toLowerCase() &&
        cleanPassword === envAdminPassword
      ) {
        await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
        return;
      }
    }

    // 2. Check Saved Local Admin Credentials
    try {
      const savedCredStr = localStorage.getItem(LOCAL_ADMIN_CRED_KEY);
      if (savedCredStr) {
        const savedCred = JSON.parse(savedCredStr) as StoredAdminCredential;
        if (
          savedCred.email.toLowerCase() === cleanEmail.toLowerCase() &&
          savedCred.password === cleanPassword
        ) {
          await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
          return;
        }
      }
    } catch {
      // Ignore parse error
    }

    // 3. Try Supabase Auth (signInWithPassword) & Supabase admin_users table
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (!error && data?.user) {
        await completeAdminLogin(data.user.id, data.user.email || cleanEmail, cleanPassword);
        return;
      }

      // Check admin_users table in Supabase
      try {
        const { data: adminRows, error: tableErr } = await supabase
          .from('admin_users')
          .select('*');

        if (!tableErr && adminRows) {
          if (adminRows.length === 0) {
            // First-time admin login: register this email & password as the professor admin account
            await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
            return;
          }

          const matchedAdmin = adminRows.find(
            (r: any) =>
              String(r.email || '').toLowerCase() === cleanEmail.toLowerCase() &&
              (r.name === `admin:${cleanPassword}` || r.role === 'admin')
          );

          if (matchedAdmin) {
            const storedPw = String(matchedAdmin.name || '').startsWith('admin:')
              ? String(matchedAdmin.name).slice(6)
              : null;
            if (!storedPw || storedPw === cleanPassword) {
              await completeAdminLogin(matchedAdmin.uid || 'admin-professor', cleanEmail, cleanPassword);
              return;
            }
          }
        }
      } catch {
        // Ignore table query error
      }

      // If Supabase Auth returned "Email not confirmed", try signing in or inform clearly
      if (error?.message?.toLowerCase().includes('email not confirmed')) {
        await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
        return;
      }
    }

    // 4. Try Firebase Auth or First-Time Admin Setup
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
      await completeAdminLogin(cred.user.uid, cred.user.email || cleanEmail, cleanPassword);
      return;
    } catch {
      // Check if any admin exists in Firestore adminUsers or localStorage
      try {
        const savedCredStr = localStorage.getItem(LOCAL_ADMIN_CRED_KEY);
        if (!savedCredStr && !envAdminEmail) {
          // Check Firestore adminUsers
          const snap = await getDocs(collection(db, 'adminUsers'));
          if (snap.empty) {
            await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
            return;
          }
        }
      } catch {
        // If Firestore check fails and no local cred exists, register first-time admin locally
        const savedCredStr = localStorage.getItem(LOCAL_ADMIN_CRED_KEY);
        if (!savedCredStr && !envAdminEmail) {
          await completeAdminLogin('admin-professor', cleanEmail, cleanPassword);
          return;
        }
      }
    }

    throw new Error('이메일 또는 비밀번호가 일치하지 않습니다. 아래 [관리자 계정 재설정]으로 새 이메일/비밀번호를 지정할 수 있습니다.');
  };

  const updateAdminCredentials = async (email: string, password: string) => {
    const cleanEmail = email.trim();
    if (!cleanEmail || password.length < 4) {
      throw new Error('유효한 이메일과 4자 이상의 비밀번호를 입력해주세요.');
    }

    if (isSupabaseConfigured && supabase) {
      try {
        // Also attempt to sign up in Supabase Auth so both Auth and table stay synced
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
      } catch {
        // Ignore if already registered in Supabase Auth
      }

      try {
        await supabase.from('admin_users').delete().neq('uid', '');
      } catch {
        // Ignore
      }
    }

    await completeAdminLogin('admin-professor', cleanEmail, password);
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

  const registerAsAdmin = async (uid: string, email: string) => {
    if (isSupabaseConfigured && supabase) {
      await supabase.from('admin_users').upsert({
        uid,
        email,
        role: 'admin',
      });
      setIsAdmin(true);
      return;
    }
    await setDoc(doc(db, 'adminUsers', uid), {
      uid,
      email,
      role: 'admin',
      createdAt: serverTimestamp(),
    });
    setIsAdmin(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        loading,
        loginWithEmail,
        updateAdminCredentials,
        logout,
        registerAsAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
