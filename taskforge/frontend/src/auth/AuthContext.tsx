import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { API_BASE, setAuthToken, getAuthToken, UserItem } from '../api';

export type User = UserItem;

export interface AuthResponse {
  token: string;
  user: User;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('taskforge_auth_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [token, setTokenState] = useState<string | null>(getAuthToken());
  const [loading, setLoading] = useState<boolean>(true);

  // Sync Supabase Auth state changes
  useEffect(() => {
    let isMounted = true;

    const syncUserIdentity = async (sessionToken: string | null) => {
      if (!sessionToken) {
        if (isMounted) {
          setUser(null);
          setTokenState(null);
          setAuthToken(null);
          localStorage.removeItem('taskforge_auth_user');
        }
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.user && isMounted) {
            setUser(data.user);
            setTokenState(sessionToken);
            setAuthToken(sessionToken);
            localStorage.setItem('taskforge_auth_user', JSON.stringify(data.user));
          }
        }
      } catch (e) {
        console.warn('[AuthContext] Error syncing user identity:', e);
      }
    };

    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        syncUserIdentity(session.access_token);
      } else {
        const storedToken = getAuthToken();
        if (storedToken) syncUserIdentity(storedToken);
      }
      if (isMounted) setLoading(false);
    });

    // 2. Auth State Change Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        syncUserIdentity(session.access_token);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    let sessionToken = authData?.session?.access_token || null;

    if (authError || !sessionToken) {
      // Fallback via backend API
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Login failed');

      sessionToken = data.token;
      setAuthToken(sessionToken);
      setTokenState(sessionToken);
      setUser(data.user);
      localStorage.setItem('taskforge_auth_user', JSON.stringify(data.user));
      return data.user;
    }

    // 2. Fetch User Profile
    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (!meRes.ok) throw new Error('Could not fetch user profile after login.');
    const meData = await meRes.json();

    setAuthToken(sessionToken);
    setTokenState(sessionToken);
    setUser(meData.user);
    localStorage.setItem('taskforge_auth_user', JSON.stringify(meData.user));

    return meData.user;
  };

  const register = async (name: string, email: string, password: string): Promise<User> => {
    // 1. Supabase Auth Registration (Role is ALWAYS forced to 'user')
    const { data: signUpData } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    let sessionToken = signUpData?.session?.access_token || null;

    // 2. Backend Fallback Registration
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Registration failed');

    sessionToken = data.token || sessionToken;
    setAuthToken(sessionToken);
    setTokenState(sessionToken);
    setUser(data.user);
    localStorage.setItem('taskforge_auth_user', JSON.stringify(data.user));

    return data.user;
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {}

    setAuthToken(null);
    setTokenState(null);
    setUser(null);
    localStorage.removeItem('taskforge_auth_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
