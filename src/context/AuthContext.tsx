import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface AuthUserProfile {
  uid: string;
  email: string | null;
  displayName?: string | null;
}

interface AuthContextType {
  user: AuthUserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  registerAsAdmin: (uid: string, email: string) => Promise<void>;
}

const LOCAL_ADMIN_STORAGE_KEY = 'ds_counseling_admin_session';

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  loginWithEmail: async () => {},
  logout: async () => {},
  registerAsAdmin: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let sbSubscription: { unsubscribe: () => void } | null = null;

    // 1. Check saved env-based admin session first
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

  const loginWithEmail = async (email: string, password: string) => {
    const cleanEmail = email.trim();
    const envAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim();
    const envAdminPassword = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined)?.trim();

    // 1. Check if VITE_ADMIN_EMAIL & VITE_ADMIN_PASSWORD are configured and match
    if (envAdminEmail && envAdminPassword) {
      if (cleanEmail.toLowerCase() === envAdminEmail.toLowerCase() && password === envAdminPassword) {
        const profile: AuthUserProfile = {
          uid: 'admin-professor',
          email: cleanEmail,
          displayName: '박성우 교수',
        };
        localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(profile));
        setUser(profile);
        setIsAdmin(true);

        if (isSupabaseConfigured && supabase) {
          try {
            await supabase.from('admin_users').upsert({
              uid: profile.uid,
              email: cleanEmail,
              name: '박성우 교수',
              role: 'admin',
            });
          } catch {
            // Ignore non-fatal error
          }
        }
        return;
      }
    }

    // 2. Authenticate via Supabase Email/Password Auth
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        throw new Error('이메일 또는 비밀번호가 올바르지 않습니다. 다시 확인해주세요.');
      }

      if (data.user) {
        const profile: AuthUserProfile = {
          uid: data.user.id,
          email: data.user.email || cleanEmail,
          displayName: data.user.user_metadata?.full_name || '박성우 교수',
        };
        setUser(profile);
        setIsAdmin(true);

        try {
          await supabase.from('admin_users').upsert({
            uid: data.user.id,
            email: cleanEmail,
            name: '박성우 교수',
            role: 'admin',
          });
        } catch {
          // Ignore non-fatal error
        }
      }
      return;
    }

    // 3. Fallback: Firebase Email/Password Auth if Supabase is not configured
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const profile: AuthUserProfile = {
        uid: cred.user.uid,
        email: cred.user.email || cleanEmail,
        displayName: cred.user.displayName || '박성우 교수',
      };
      setUser(profile);
      setIsAdmin(true);
    } catch {
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다. 설정한 관리자 계정 정보를 확인해주세요.');
    }
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
        logout,
        registerAsAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
