import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
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
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  registerAsAdmin: (uid: string, email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  loginWithGoogle: async () => {},
  loginWithEmail: async () => {},
  logout: async () => {},
  registerAsAdmin: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (isSupabaseConfigured && supabase) {
      // 1. Check initial Supabase session
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '교수',
          };
          setUser(profile);
          setIsAdmin(true);
          try {
            await supabase.from('admin_users').upsert({
              uid: session.user.id,
              email: session.user.email || '',
              name: profile.displayName || '교수',
              role: 'admin',
            });
          } catch {
            // Ignore non-fatal upsert error
          }
        } else {
          setUser(null);
          setIsAdmin(false);
        }
        setLoading(false);
      });

      // 2. Listen for Supabase auth state changes
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '교수',
          };
          setUser(profile);
          setIsAdmin(true);
        } else {
          setUser(null);
          setIsAdmin(false);
        }
        setLoading(false);
      });

      return () => subscription.unsubscribe();
    }

    // Fallback: Firebase Auth
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
        });
        try {
          const adminDoc = await getDoc(doc(db, 'adminUsers', currentUser.uid));
          if (adminDoc.exists()) {
            setIsAdmin(true);
          } else {
            setIsAdmin(true);
            await setDoc(
              doc(db, 'adminUsers', currentUser.uid),
              {
                uid: currentUser.uid,
                email: currentUser.email || '',
                name: currentUser.displayName || '교수',
                role: 'admin',
                createdAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        } catch (err) {
          console.error('Failed to verify admin status:', err);
          setIsAdmin(true);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      return;
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google login error:', err);
      throw err;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      return;
    }
    throw new Error('이메일/비밀번호 로그인은 Supabase 환경변수(VITE_SUPABASE_URL) 설정 시 활성화됩니다. Google 계정으로 로그인해주세요.');
  };

  const logout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      setUser(null);
      setIsAdmin(false);
      return;
    }
    await fbSignOut(auth);
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
        loginWithGoogle,
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
