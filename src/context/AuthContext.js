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
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null); // Role, etc.
    const [loading, setLoading] = useState(true);
    const [migrationDebugMsg, setMigrationDebugMsg] = useState('');
    const migrationAttempted = useRef(false); // Ref to block double-execution in Strict Mode

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (u) => {
            if (u) {
                setUser(u);
                // Fetch extra user data (role)
                try {
                    // 1. Check Admin Status from config/admins
                    const adminsDoc = await getDoc(doc(db, 'config', 'admins'));
                    let isAdminUser = false;
                    if (adminsDoc.exists()) {
                        const adminUids = adminsDoc.data().uids || [];
                        if (Array.isArray(adminUids) && adminUids.includes(u.uid)) {
                            isAdminUser = true;
                        }
                    }

                    // 2. Fetch User Profile
                    const userRef = doc(db, 'users', u.uid);
                    let userDoc = await getDoc(userRef);
                    let currentData = null;

                    if (userDoc.exists()) {
                        currentData = userDoc.data();
                        console.log(`[Auth] User loaded. FromCache: ${userDoc.metadata.fromCache}`);
                    } else {
                        // Inherit admin status even if no user profile yet
                        currentData = { role: 'user' };
                    }

                    // 3. Check & Run Migration if needed
                    if (currentData && !currentData.migrationToNextJsAppDone) {

                        // Check if we already tried in this session (handling Strict Mode)
                        if (migrationAttempted.current) {
                            console.log("[AutoMigration] Already attempting/attempted in this mount.");
                            setMigrationDebugMsg(prev => prev + "\n[INFO] Subsequent effect run ignored.");
                        } else {
                            migrationAttempted.current = true;

                            setMigrationDebugMsg(prev => prev + `\n[STARTED] UID: ${u.uid.substring(0, 6)}...`);
                            console.log(`[AutoMigration] Starting for UID: ${u.uid}`);

                            try {
                                const result = await migrateLegacyData(u.uid);
                                console.log("[AutoMigration] Result:", result);

                                if (result.success) {
                                    // Refresh user doc to get the new flag
                                    userDoc = await getDoc(userRef);
                                    if (userDoc.exists()) {
                                        currentData = userDoc.data();
                                    }
                                    setMigrationDebugMsg(prev => prev + `\n[SUCCESS] ${result.message}`);
                                } else {
                                    console.error("[AutoMigration] Failed:", result.message);
                                    setMigrationDebugMsg(prev => prev + `\n[FAILED] ${result.message}`);
                                }
                            } catch (migrationErr) {
                                console.error("[AutoMigration] Critical Error:", migrationErr);
                                setMigrationDebugMsg(prev => prev + `\n[ERROR] ${migrationErr.message}`);
                            }
                        }
                    } else {
                        // Only log skip if we haven't already done it (to avoid noise)
                        if (!migrationAttempted.current) {
                            const cache = userDoc ? userDoc.metadata.fromCache : 'unknown';
                            const reason = !currentData ? "No Data" : `Flag is ${currentData.migrationToNextJsAppDone} (Cache:${cache})`;
                            console.log("[AutoMigration] Not needed:", reason);
                            setMigrationDebugMsg(prev => prev + `\n[SKIPPED] ${reason}`);
                        }
                    }

                    setUserData({ ...currentData, isAdmin: isAdminUser });

                } catch (e) {
                    console.error("Error fetching user data", e);
                }
            } else {
                setUser(null);
                setUserData(null);
                // Reset migration attempt state so re-login works
                migrationAttempted.current = false;
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const login = (email, password) => {
        return signInWithEmailAndPassword(auth, email, password);
    };

    const signup = async (email, password, inviteToken) => {
        // 1. Validate Token First
        const { valid, message } = await validateInviteToken(inviteToken);
        if (!valid) throw new Error(message);

        // 2. Create Auth User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        // 3. Create User Doc
        await setDoc(doc(db, 'users', newUser.uid), {
            email: extractEmail(email),
            role: 'user', // Default role
            createdAt: new Date(),
        });

        // 4. Mark Invite Used
        await markInviteAsUsed(inviteToken, newUser.uid);

        return newUser;
    };

    const logout = () => signOut(auth);

    // Helper to allow simple email storage if object is complex
    const extractEmail = (e) => typeof e === 'string' ? e : e?.toString();

    const isAdmin = userData?.isAdmin || false;

    return (
        <AuthContext.Provider value={{ user, userData, isAdmin, login, signup, logout, loading, migrationDebugMsg }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

import { useRouter, usePathname } from 'next/navigation';

export const ProtectedRoute = ({ children }) => {
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!loading && !user) {
            // Allow access to login/signup pages without redirect loop
            if (pathname !== '/login' && pathname !== '/signup') {
                router.push('/login');
            }
        }
    }, [user, loading, router, pathname]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#666' }}>Loading...</div>;

    // If on login/signup page and user IS logged in, redirect to home? 
    // Maybe optional, but good for UX.
    if (user && (pathname === '/login' || pathname === '/signup')) {
        // Avoid effect loop, handled in page usually or here
        // Let's just return children for now, Pages handle redirect if needed (e.g. useEffect in LoginPage)
    }

    // If not logged in and not on public page, don't render children (layout might flash)
    if (!user && pathname !== '/login' && pathname !== '/signup') {
        return null;
    }

    return children;
};
