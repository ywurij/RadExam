import { db } from './firebase';
import {
    doc, getDoc, setDoc, updateDoc, increment, collection, writeBatch, deleteDoc,
    getDocs, query, orderBy
} from 'firebase/firestore';

// --- Invite System (Token Links) ---

/**
 * Validates an invite token.
 * @param {string} token 
 * @returns {Promise<{valid: boolean, message?: string, inviteData?: any}>}
 */
export const validateInviteToken = async (token) => {
    if (!token) return { valid: false, message: 'トークンが無効です' };

    try {
        // Query by token field (or doc ID if token is ID)
        const ref = doc(db, 'invitation_codes', token);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
            return { valid: false, message: '無効な招待リンクです' };
        }

        const data = snap.data();
        if (data.used) {
            return { valid: false, message: 'この招待リンクは既に使用されています' };
        }

        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            return { valid: false, message: '招待リンクの有効期限が切れています' };
        }

        return { valid: true, inviteData: data };
    } catch (e) {
        console.error("Error validating token:", e);
        return { valid: false, message: '検証エラーが発生しました' };
    }
};

/**
 * Mark invite as used by a user.
 */
export const markInviteAsUsed = async (token, uid) => {
    if (!token || !uid) return;
    const ref = doc(db, 'invitation_codes', token);
    await updateDoc(ref, {
        used: true,
        usedBy: uid,
        usedAt: new Date()
    });
};

/**
 * Create a new invite token.
 */
export const createInviteToken = async (createdByUid) => {
    const token = crypto.randomUUID(); // Browser native UUID
    const ref = doc(db, 'invitation_codes', token);
    await setDoc(ref, {
        token,
        createdBy: createdByUid,
        createdAt: new Date(),
        used: false,
        expiresAt: null // No expiration for now, or set one
    });
    return token;
};

/**
 * Get all invites.
 */
export const getInvites = async () => {
    try {
        const col = collection(db, 'invitation_codes');
        const q = query(col, orderBy('createdAt', 'desc'));
        const qSnapshot = await getDocs(q);

        const invites = [];
        qSnapshot.forEach((doc) => {
            invites.push({ id: doc.id, ...doc.data() });
        });
        return invites;
    } catch (e) {
        console.error("Error fetching invites:", e);
        return [];
    }
};

// Legacy Code Verification
export const verifyInviteCode = async (code) => {
    return { valid: false, message: "Deprecated" };
};

// --- User Progress ---

/**
 * Save user progress for a specific question.
 * Collection: users/{uid}/progress/{questionId}
 */
export const saveUserProgress = async (uid, questionId, data) => {
    if (!uid || !questionId) return;
    const progressRef = doc(db, 'users', uid, 'progress', questionId.toString());
    try {
        await setDoc(progressRef, data, { merge: true });
    } catch (e) {
        console.error("Error saveUserProgress:", e);
    }
};

/** 
 * Save answer override (Answer Editor).
 */
export const saveQuestionOverride = async (questionId, data) => {
    if (!questionId) return;
    const ref = doc(db, 'overrides', questionId.toString());
    try {
        await setDoc(ref, data, { merge: true });
    } catch (e) {
        console.error("Error saveQuestionOverride:", e);
    }
};

/**
 * Fetch all overrides.
 */
export const getOverrides = async () => {
    return {};
};

export const getQuestionOverride = async (questionId) => {
    if (!questionId) return null;
    try {
        const docSnap = await getDoc(doc(db, 'overrides', questionId.toString()));
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
        return null;
    }
};

/**
 * Get all progress for a user.
 */
export const getUserExamProgress = async (uid) => {
    if (!uid) return {};
    try {
        const colRef = collection(db, 'users', uid, 'progress');
        const snapshot = await getDocs(colRef);

        const progress = {};
        snapshot.forEach(doc => {
            progress[doc.id] = doc.data();
        });
        return progress;
    } catch (e) {
        console.error("Error getUserExamProgress:", e);
        return {};
    }
};

/**
 * Get all overrides (or scoped).
 */
export const getAllOverrides = async () => {
    try {
        const colRef = collection(db, 'overrides');
        const snapshot = await getDocs(colRef);
        const overrides = {};
        snapshot.forEach(doc => {
            overrides[doc.id] = doc.data();
        });
        return overrides;
    } catch (e) {
        console.error("Error getAllOverrides:", e);
        return {};
    }
};

// Helper to convert simple Markdown to HTML for Tiptap
const parseMarkdownToHtml = (text) => {
    if (!text) return '';

    // Normalize newlines
    const lines = text.split(/\r?\n/);
    let html = '';

    // State for list nesting
    // stack items: { type: 'ul'|'ol', indent: number }
    const listStack = [];

    const closeList = (type) => {
        html += `</${type}>`;
    };

    const closeAllLists = () => {
        while (listStack.length > 0) {
            const last = listStack.pop();
            closeList(last.type);
        }
    };

    // Helper: calculate indent level (number of spaces)
    // We treat 1 tab as 4 spaces for simplicity if mixed
    const getIndentLevel = (str) => {
        let spaces = 0;
        for (let i = 0; i < str.length; i++) {
            if (str[i] === ' ') spaces++;
            else if (str[i] === '\t') spaces += 4;
            else break;
        }
        return spaces;
    };

    const processInline = (str) => {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/&lt;sup&gt;(.*?)&lt;\/sup&gt;/g, '<sup>$1</sup>')
            .replace(/&lt;sub&gt;(.*?)&lt;\/sub&gt;/g, '<sub>$1</sub>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    };

    lines.forEach(line => {
        const trimmed = line.trim();

        if (trimmed === '') {
            closeAllLists();
            return;
        }

        // 1. Check for Headers (Ignore indentation for headers to be lenient)
        // Note: Headers must reset all lists.
        const h3 = trimmed.match(/^###\s+(.*)/);
        if (h3) {
            closeAllLists();
            html += `<h3>${processInline(h3[1])}</h3>`;
            return;
        }
        const h2 = trimmed.match(/^##\s+(.*)/);
        if (h2) {
            closeAllLists();
            html += `<h2>${processInline(h2[1])}</h2>`;
            return;
        }
        const h1 = trimmed.match(/^#\s+(.*)/);
        if (h1) {
            closeAllLists();
            html += `<h1>${processInline(h1[1])}</h1>`;
            return;
        }

        // 2. Check for List Items
        // Matches: (indent)(marker)(space)(content)
        // Markers: - or * for UL, 1. for OL (only 1. usually supported by simple MD, or \d+)

        // UL: lead spaces + [-*] + space + content
        const ulMatch = line.match(/^(\s*)([-*])\s+(.*)/);
        // OL: lead spaces + \d+\. + space + content
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);

        if (ulMatch || olMatch) {
            const indent = getIndentLevel(ulMatch ? ulMatch[1] : olMatch[1]);
            const type = ulMatch ? 'ul' : 'ol';
            const content = ulMatch ? ulMatch[3] : olMatch[3];

            // List Indentation Logic
            if (listStack.length === 0) {
                // New Root List
                listStack.push({ type, indent });
                html += `<${type}>`;
            } else {
                const last = listStack[listStack.length - 1];

                if (indent > last.indent) {
                    // Nesting Deeper
                    listStack.push({ type, indent });
                    html += `<${type}>`;
                } else if (indent === last.indent) {
                    // Same Level
                    if (last.type !== type) {
                        // Switch type at same level? Close last, open new.
                        listStack.pop();
                        closeList(last.type);
                        listStack.push({ type, indent });
                        html += `<${type}>`;
                    }
                } else {
                    // Dedent (Close children)
                    while (listStack.length > 0) {
                        const top = listStack[listStack.length - 1];
                        if (indent < top.indent) {
                            listStack.pop();
                            closeList(top.type);
                        } else {
                            break;
                        }
                    }

                    // After closing children, check current top
                    if (listStack.length === 0) {
                        // Fallback if dedented past root (should rarely happen if indent matches root)
                        listStack.push({ type, indent });
                        html += `<${type}>`;
                    } else {
                        const top = listStack[listStack.length - 1];
                        if (top.type !== type) {
                            // Swapping type at upper level
                            listStack.pop();
                            closeList(top.type);
                            listStack.push({ type, indent });
                            html += `<${type}>`;
                        }
                    }
                }
            }

            html += `<li>${processInline(content)}</li>`;
            return;
        }

        // 3. Regular Paragraph
        closeAllLists();
        html += `<p>${processInline(trimmed)}</p>`;
    });

    closeAllLists();
    return html;
};

/**
 * Migrate legacy Flutter app data to new subcollection structure.
 * Target: users/{uid}/progress/{questionId}
 */
export const migrateLegacyData = async (uid) => {
    if (!uid) return { success: false, message: 'No User ID' };

    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            return { success: false, message: 'User document not found' };
        }

        const userData = userSnap.data();

        // Fields to migrate
        const { answerHistory, favorites, customExplanations, customGenres, customAnswers } = userData;

        if (!answerHistory && !favorites && !customExplanations && !customGenres && !customAnswers) {
            // Even if no data, mark as done so we don't retry forever
            await updateDoc(userRef, {
                migrationToNextJsAppDone: true,
                migrationDate: new Date()
            });
            return { success: true, message: 'No legacy data found to migrate (Marked as done)' };
        }

        // 1. Consolidate data by Question ID
        const progressMap = {};

        const ensureEntry = (id) => {
            if (!progressMap[id]) progressMap[id] = {};
        };

        console.log("Starting Migration. Inputs:", {
            hasHistory: !!answerHistory,
            hasFavorites: !!favorites,
            hasExplanations: !!customExplanations,
            hasGenres: !!customGenres,
            hasAnswers: !!customAnswers
        });

        // Process Answer History
        if (answerHistory) {
            const keys = Object.keys(answerHistory);
            console.log(`Processing ${keys.length} answerHistory items`);
            keys.forEach((id) => {
                ensureEntry(id);
                progressMap[id].status = answerHistory[id];
            });
        }

        // Process Favorites
        if (favorites) {
            const keys = Object.keys(favorites);
            console.log(`Processing ${keys.length} favorites items`);
            keys.forEach((id) => {
                if (favorites[id]) {
                    ensureEntry(id);
                    progressMap[id].isLiked = true;
                }
            });
        }

        // Process Explanations
        if (customExplanations) {
            Object.entries(customExplanations).forEach(([id, text]) => {
                if (text && text.trim().length > 0) {
                    ensureEntry(id);
                    progressMap[id].overrideExplanation = parseMarkdownToHtml(text);
                }
            });
        }

        // Process Genres
        if (customGenres) {
            Object.entries(customGenres).forEach(([id, genres]) => {
                if (Array.isArray(genres) && genres.length > 0) {
                    ensureEntry(id);
                    progressMap[id].overrideGenre = genres;
                }
            });
        }

        // Process Answers
        if (customAnswers) {
            Object.entries(customAnswers).forEach(([id, ans]) => {
                ensureEntry(id);
                progressMap[id].overrideAnswer = ans;
            });
        }

        // 2. Batch Write
        const entries = Object.entries(progressMap);
        console.log(`Consolidated into ${entries.length} unique question entries`);

        if (entries.length === 0) {
            console.warn("No entries to write!");
            return { success: true, message: 'Source data existed but resulted in 0 entries (Empty objects?)' };
        }

        const batchSize = 450;
        let batch = writeBatch(db);
        let count = 0;
        let totalBatches = 0;

        // Counters for debug
        let stats = {
            totalEntries: entries.length,
            withStatus: 0,
            withLike: 0,
            withNote: 0, // overrideExplanation
            withGenre: 0, // overrideGenre
            withAnswer: 0 // overrideAnswer
        };

        for (const [questionId, data] of entries) {
            // ... logs ...
            if (data.status) stats.withStatus++;
            if (data.isLiked) stats.withLike++;
            if (data.overrideExplanation) stats.withNote++;
            if (data.overrideGenre) stats.withGenre++;
            if (data.overrideAnswer) stats.withAnswer++;

            const docRef = doc(db, 'users', uid, 'progress', questionId);
            batch.set(docRef, data, { merge: true });
            count++;

            if (count >= batchSize) {
                await batch.commit();
                totalBatches++;
                batch = writeBatch(db);
                count = 0;
            }
        }

        if (count > 0) {
            await batch.commit();
            totalBatches++;
        }

        console.log("Batch writes completed. Updating flag...");

        // 3. Update User Doc
        await updateDoc(userRef, {
            migrationToNextJsAppDone: true,
            migrationDate: new Date()
        });

        return {
            success: true,
            message: `Migration Done. Processed ${stats.totalEntries} items. (Status: ${stats.withStatus}, Genre: ${stats.withGenre}, Answer: ${stats.withAnswer})`
        };

    } catch (e) {
        console.error("Migration Error:", e);
        return { success: false, message: e.message };
    }
};

/**
 * Export user data (progress) to JSON object with granular filtering.
 * @param {string} uid 
 * @param {Object} options { history: boolean, answers: boolean, notes: boolean, genres: boolean }
 */
export const exportUserData = async (uid, options = { history: true, answers: true, notes: true, genres: true }) => {
    if (!uid) throw new Error("User ID required");

    try {
        const progressRef = collection(db, 'users', uid, 'progress');
        const snap = await getDocs(progressRef);

        const data = {};
        snap.forEach(doc => {
            const raw = doc.data();
            const exported = {};
            let hasContent = false;

            // Study History (Status, Likes, etc.)
            if (options.history) {
                if (raw.status) { exported.status = raw.status; hasContent = true; }
                if (raw.isLiked) { exported.isLiked = raw.isLiked; hasContent = true; }
                if (raw.updatedAt) { exported.updatedAt = raw.updatedAt; } // Always keep metadata if history is on?
            }

            // My Answers
            if (options.answers && raw.overrideAnswer) {
                exported.overrideAnswer = raw.overrideAnswer;
                hasContent = true;
            }

            // My Notes
            if (options.notes && raw.note) {
                exported.note = raw.note;
                hasContent = true;
            }

            // My Genres
            if (options.genres && raw.overrideGenre) {
                exported.overrideGenre = raw.overrideGenre;
                hasContent = true;
            }

            if (hasContent) {
                data[doc.id] = exported;
            }
        });

        return {
            version: 1,
            timestamp: Date.now(),
            userId: uid,
            options: options,
            data: data
        };
    } catch (e) {
        console.error("Export failed:", e);
        throw e;
    }
};

/**
 * Import user data from JSON object.
 * @param {string} uid
 * @param {Object} jsonData
 * @param {string} strategy 'overwrite' | 'keep' (default: 'overwrite')
 */
export const importUserData = async (uid, jsonData, strategy = 'overwrite') => {
    if (!uid) throw new Error("User ID required");
    if (!jsonData || !jsonData.data) throw new Error("Invalid data format");

    try {
        const entries = Object.entries(jsonData.data);
        const importKeys = new Set(Object.keys(jsonData.data));

        // Operations list to execute in batches
        // Each op: { type: 'set' | 'update' | 'delete', ref: docRef, data: ... }
        let operations = [];

        // 1. If strategy is 'overwrite', we need to DELETE existing docs that are NOT in the import file.
        //    (Mirroring / Sync behavior)
        if (strategy === 'overwrite') {
            const progressRef = collection(db, 'users', uid, 'progress');
            const snap = await getDocs(progressRef);

            snap.forEach(docSnap => {
                if (!importKeys.has(docSnap.id)) {
                    // This doc exists locally but is NOT in the import file -> Delete it
                    operations.push({
                        type: 'delete',
                        ref: doc(db, 'users', uid, 'progress', docSnap.id)
                    });
                }
            });
        }

        // 2. If strategy is 'keep', we need existing data to check for conflicts (don't overwrite existing).
        let existingData = {};
        if (strategy === 'keep') {
            const progressRef = collection(db, 'users', uid, 'progress');
            const snap = await getDocs(progressRef);
            snap.forEach(doc => {
                existingData[doc.id] = doc.data();
            });
        }

        // 3. Prepare Import Operations (Set / Update)
        entries.forEach(([docId, docData]) => {
            const docRef = doc(db, 'users', uid, 'progress', docId);

            if (strategy === 'overwrite') {
                // Force Overwrite: Replace doc
                operations.push({
                    type: 'set',
                    ref: docRef,
                    data: docData
                });
            } else if (strategy === 'keep') {
                const local = existingData[docId];
                if (!local) {
                    // No local data -> Safe to write
                    operations.push({
                        type: 'set',
                        ref: docRef,
                        data: docData
                    });
                } else {
                    // Local exists -> Merge only missing fields
                    const updates = {};
                    let hasUpdates = false;
                    Object.keys(docData).forEach(key => {
                        if (local[key] === undefined || local[key] === null) {
                            updates[key] = docData[key];
                            hasUpdates = true;
                        }
                    });
                    if (hasUpdates) {
                        operations.push({
                            type: 'update',
                            ref: docRef,
                            data: updates
                        });
                    }
                }
            }
        });

        if (operations.length === 0) return { success: true, count: 0 };

        // 4. Execute Batches (Limit 500)
        const chunkedOps = [];
        for (let i = 0; i < operations.length; i += 450) { // Safety margin < 500
            chunkedOps.push(operations.slice(i, i + 450));
        }

        for (const chunk of chunkedOps) {
            const batch = writeBatch(db);
            chunk.forEach(op => {
                if (op.type === 'delete') {
                    batch.delete(op.ref);
                } else if (op.type === 'set') {
                    batch.set(op.ref, op.data); // No merge:true for overwrite
                } else if (op.type === 'update') {
                    batch.update(op.ref, op.data);
                }
            });
            await batch.commit();
        }

        return { success: true, count: entries.length, deleted: operations.filter(o => o.type === 'delete').length };
    } catch (e) {
        console.error("Import failed:", e);
        throw e;
    }
};

// --- Active Session Management (Cross-Device Sync) ---

/**
 * Save active session to Firestore.
 * path: users/{uid}/sessions/{sessionId}
 */
export const saveActiveSession = async (uid, sessionId, sessionData) => {
    if (!uid || !sessionId) return;
    try {
        const ref = doc(db, 'users', uid, 'sessions', sessionId);
        await setDoc(ref, {
            ...sessionData,
            updatedAt: new Date() // Server timestamp would be better but local is fine for simple comparison
        });
    } catch (e) {
        console.error("Error saving active session:", e);
    }
};

/**
 * Get all active sessions from Firestore.
 */
export const getActiveSessions = async (uid) => {
    if (!uid) return [];
    try {
        const colRef = collection(db, 'users', uid, 'sessions');
        const q = query(colRef, orderBy('updatedAt', 'desc'));
        const snap = await getDocs(q);
        const sessions = [];
        snap.forEach(doc => {
            sessions.push({ id: doc.id, ...doc.data() });
        });
        return sessions;
    } catch (e) {
        console.error("Error fetching active sessions:", e);
        return [];
    }
};

/**
 * Delete active session from Firestore.
 */
export const deleteActiveSession = async (uid, sessionId) => {
    if (!uid || !sessionId) return;
    try {
        const ref = doc(db, 'users', uid, 'sessions', sessionId);
        await deleteDoc(ref);
    } catch (e) {
        console.error("Error deleting active session:", e);
    }
};

// --- Announcement Read Status ---

/**
 * Save verify read status to Firestore.
 */
export const saveLastReadAnnouncement = async (uid, announcementId) => {
    if (!uid || !announcementId) return;
    try {
        const ref = doc(db, 'users', uid);
        await setDoc(ref, {
            lastReadAnnouncementId: announcementId,
            lastReadAnnouncementDate: new Date()
        }, { merge: true });
    } catch (e) {
        console.error("Error saving last read announcement:", e);
    }
};

/**
 * Get verify read status from Firestore.
 */
export const getLastReadAnnouncement = async (uid) => {
    if (!uid) return null;
    try {
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            return snap.data().lastReadAnnouncementId || null;
        }
        return null;
    } catch (e) {
        console.error("Error fetching last read announcement:", e);
        return null;
    }
};
