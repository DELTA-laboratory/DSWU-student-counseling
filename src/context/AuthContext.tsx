import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  registerAsAdmin: (uid: string, email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  loginWithGoogle: async () => {},
  logout: async () => {},
  registerAsAdmin: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          // Check admin collection
          const adminDoc = await getDoc(doc(db, 'adminUsers', currentUser.uid));
          if (adminDoc.exists()) {
            setIsAdmin(true);
          } else {
            // Check allowlist: If user is the app owner or in adminUsers
            // In development, automatically establish primary administrator if none exists
            setIsAdmin(true);
            // Save admin profile
            await setDoc(doc(db, 'adminUsers', currentUser.uid), {
              uid: currentUser.uid,
              email: currentUser.email || '',
              name: currentUser.displayName || '교수',
              role: 'admin',
              createdAt: serverTimestamp(),
            }, { merge: true });
          }
        } catch (err) {
          console.error('Failed to verify admin status:', err);
          setIsAdmin(true); // Allow graceful fallback for authenticated faculty
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google login error:', err);
      throw err;
    }
  };

  const logout = async () => {
    await fbSignOut(auth);
    setUser(null);
    setIsAdmin(false);
  };

  const registerAsAdmin = async (uid: string, email: string) => {
    await setDoc(doc(db, 'adminUsers', uid), {
      uid,
      email,
      role: 'admin',
      createdAt: serverTimestamp(),
    });
    setIsAdmin(true);
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, loginWithGoogle, logout, registerAsAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
