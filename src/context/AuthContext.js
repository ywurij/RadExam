"use client";

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { validateInviteToken, markInviteAsUsed, migrateLegacyData } from '@/lib/db';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    // 常にモックの管理者ユーザーとして振る舞うように設定 (ログイン画面をスキップ)
    const user = { uid: 'local_user', email: 'local@example.com' };
    const userData = { role: 'admin', isAdmin: true };
    const loading = false;
    const migrationDebugMsg = '';

    const login = () => Promise.resolve();
    const signup = () => Promise.resolve();
    const logout = () => Promise.resolve();
    const isAdmin = true;

    return (
        <AuthContext.Provider value={{ user, userData, isAdmin, login, signup, logout, loading, migrationDebugMsg }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

import { useRouter, usePathname } from 'next/navigation';

export const ProtectedRoute = ({ children }) => {
    // 常に子供のコンポーネントをそのまま描画してアクセス制限を解除
    return children;
};
