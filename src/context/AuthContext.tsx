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
    let sbSubscription: { unsubscribe: () => void } | null = null;

    // 1. If Supabase is configured, also listen to Supabase Email/Password session
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '교수',
          };
          setUser(profile);
          setIsAdmin(true);
          setLoading(false);
        }
      });

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          const profile: AuthUserProfile = {
            uid: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.full_name || '교수',
          };
          setUser(profile);
          setIsAdmin(true);
          setLoading(false);
        }
      });
      sbSubscription = data.subscription;
    }

    // 2. Listen to Google Popup Auth (works immediately without extra Supabase Google OAuth setup)
    const unsubscribeFb = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const profile: AuthUserProfile = {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
        };
        setUser(profile);
        setIsAdmin(true);

        if (isSupabaseConfigured && supabase) {
          try {
            await supabase.from('admin_users').upsert({
              uid: currentUser.uid,
              email: currentUser.email || '',
              name: currentUser.displayName || '교수',
              role: 'admin',
            });
          } catch {
            // Ignore non-fatal upsert error
          }
        } else {
          try {
            const adminDoc = await getDoc(doc(db, 'adminUsers', currentUser.uid));
            if (!adminDoc.exists()) {
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
          } catch {
            // Ignore non-fatal error
          }
        }
      } else {
        // Only clear user if there is no active Supabase session either
        if (isSupabaseConfigured && supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            setUser(null);
            setIsAdmin(false);
          }
        } else {
          setUser(null);
          setIsAdmin(false);
        }
      }
      setLoading(false);
    });

    return () => {
      unsubscribeFb();
      if (sbSubscription) sbSubscription.unsubscribe();
    };
  }, []);

  const loginWithGoogle = async () => {
    // Use pre-configured Google Popup Auth so the user never hits
    // Supabase's "Unsupported provider: provider is not enabled" error
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user && isSupabaseConfigured && supabase) {
        try {
          await supabase.from('admin_users').upsert({
            uid: cred.user.uid,
            email: cred.user.email || '',
            name: cred.user.displayName || '교수',
            role: 'admin',
          });
        } catch {
          // Ignore if table not created yet
        }
      }
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
    throw new Error('이메일/비밀번호 로그인은 Supabase 환경변수 설정 시 활성화됩니다. Google 계정으로 로그인해주세요.');
  };

  const logout = async () => {
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
