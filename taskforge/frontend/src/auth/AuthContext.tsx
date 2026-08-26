import React, { createContext, useContext, useState, useEffect } from 'react';
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

  useEffect(() => {
    const checkMe = async () => {
      const currentToken = getAuthToken();
      if (!currentToken) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            localStorage.setItem('taskforge_auth_user', JSON.stringify(data.user));
          }
        } else {
          logout();
        }
      } catch (e) {
        console.warn('[AuthContext] Error checking user identity:', e);
      } finally {
        setLoading(false);
      }
    };

    checkMe();
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    const authResp: AuthResponse = data;
    setAuthToken(authResp.token);
    setTokenState(authResp.token);
    setUser(authResp.user);
    localStorage.setItem('taskforge_auth_user', JSON.stringify(authResp.user));

    return authResp.user;
  };

  const register = async (name: string, email: string, password: string): Promise<User> => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    const authResp: AuthResponse = data;
    setAuthToken(authResp.token);
    setTokenState(authResp.token);
    setUser(authResp.user);
    localStorage.setItem('taskforge_auth_user', JSON.stringify(authResp.user));

    return authResp.user;
  };

  const logout = () => {
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
