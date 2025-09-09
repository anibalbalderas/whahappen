// lib/auth-context.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebase';

type Ctx = { user: User | null; initializing: boolean };
const AuthCtx = createContext<Ctx>({ user: null, initializing: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInit] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setInit(false);
    });
    return () => unsub();
  }, []);

  return <AuthCtx.Provider value={{ user, initializing }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
