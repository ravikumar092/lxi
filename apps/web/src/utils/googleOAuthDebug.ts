/**
 * Google OAuth Recovery Utilities
 * Use these functions in browser console to diagnose and fix Google Sheets connection
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. DIAGNOSTIC: Check OAuth Status
// ─────────────────────────────────────────────────────────────────────────────
export function diagnoseGoogleOAuth() {
    console.group('🔍 Google OAuth Diagnosis');
    
    // Check environment
    console.log('📍 Current URL:', window.location.origin);
    console.log('📱 Dev Server:', window.location.origin.includes('localhost') ? '✅ Yes' : '❌ No');
    
    // Check Google API
    const googleLoaded = !!(window as any).google?.accounts?.oauth2;
    console.log('🔌 Google API Loaded:', googleLoaded ? '✅ Yes' : '❌ No');
    
    // Check stored session
    const storedSession = {
        email: localStorage.getItem('google_user_email'),
        token: localStorage.getItem('google_access_token') ? 'EXISTS' : 'MISSING',
        expiry: localStorage.getItem('google_token_expiry'),
        isExpired: Date.now() > parseInt(localStorage.getItem('google_token_expiry') || '0')
    };
    console.log('📋 Stored Session:', storedSession);
    
    // Check sheets
    const sheets: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('sheet_id_')) {
            sheets[key] = localStorage.getItem(key) || 'EMPTY';
        }
    }
    console.log('📊 Synced Sheets:', Object.keys(sheets).length > 0 ? sheets : 'NONE');
    
    // Check notes cache
    const notesCache = localStorage.getItem('lextgress_notes');
    console.log('📝 Notes Cached:', notesCache ? `✅ ${JSON.parse(notesCache).length} notes` : '❌ No');
    
    console.groupEnd();
    return { googleLoaded, storedSession, sheets };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RECOVERY: Clear All Google Data Safely
// ─────────────────────────────────────────────────────────────────────────────
export function clearGoogleSession() {
    console.group('🧹 Clearing Google Session...');
    
    const keysToDelete = [
        'google_access_token',
        'google_token_expiry',
        'google_user_email',
        'google_user_name',
        'lextgress_notes'
    ];
    
    // Delete main keys
    keysToDelete.forEach(key => {
        localStorage.removeItem(key);
        console.log(`✅ Deleted: ${key}`);
    });
    
    // Delete all sheet mappings
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('sheet_id_')) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`✅ Deleted: ${key}`);
    });
    
    console.log('\n✨ All Google data cleared!');
    console.log('🔄 Now close this tab and reopen Lex Tigress to test fresh connection');
    console.groupEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RECOVERY: Clear Privacy Notice (if consent screen changed)
// ─────────────────────────────────────────────────────────────────────────────
export function clearPrivacyNotices() {
    console.group('🔐 Clearing Privacy Acceptance...');
    
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('privacy_notice_')) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`✅ Cleared: ${key}`);
    });
    
    console.log('✨ Privacy notices cleared. You\'ll be asked again on next sync.');
    console.groupEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RECOVERY: Full Nuclear Reset (Everything)
// ─────────────────────────────────────────────────────────────────────────────
export function fullNuclearReset() {
    console.group('☢️ FULL NUCLEAR RESET');
    
    if (!confirm('⚠️ This will clear ALL Lex Tigress data from your browser!\n\nYour Google Sheet is NOT affected.\n\nContinue?')) {
        console.log('❌ Reset cancelled');
        console.groupEnd();
        return;
    }
    
    // Get all keys containing "lextgress"
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.toLowerCase().includes('lextgress') || 
            key?.startsWith('google_') || 
            key?.startsWith('sheet_id_') ||
            key?.startsWith('privacy_notice_')) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`🗑️ Deleted: ${key}`);
    });
    
    console.log('\n✨ FULL RESET COMPLETE');
    console.log('🔄 Reloading page in 3 seconds...');
    console.groupEnd();
    
    setTimeout(() => window.location.reload(), 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TESTING: Validate OAuth Client ID
// ─────────────────────────────────────────────────────────────────────────────
export function validateClientID() {
    console.group('✔️ Validating OAuth Client ID');
    
    const clientID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    
    console.log('📌 Client ID from .env:', clientID);
    
    if (clientID === 'PASTE_YOUR_GOOGLE_CLIENT_ID_HERE') {
        console.error('❌ DEFAULT PLACEHOLDER - NOT CONFIGURED');
        console.log('\n📝 Fix: Add VITE_GOOGLE_CLIENT_ID to .env');
        return false;
    }
    
    if (!clientID.includes('.apps.googleusercontent.com')) {
        console.error('❌ INVALID FORMAT - Should end with .apps.googleusercontent.com');
        return false;
    }
    
    console.log('✅ Client ID format is valid');
    console.log('🔐 Full ID:', clientID);
    console.groupEnd();
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EXPORT: Generate LocalStorage Snapshot
// ─────────────────────────────────────────────────────────────────────────────
export function exportLocalStorageSnapshot() {
    console.group('📸 LocalStorage Snapshot');
    
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) snapshot[key] = localStorage.getItem(key) || '';
    }
    
    const json = JSON.stringify(snapshot, null, 2);
    console.log(json);
    console.log('\n✅ Snapshot copied to console. You can save this for backup.');
    console.groupEnd();
    
    return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAKE FUNCTIONS AVAILABLE GLOBALLY FOR EASY CONSOLE ACCESS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
    (window as any).__LEX_TIGRESS_DEBUG = {
        diagnose: diagnoseGoogleOAuth,
        clearGoogle: clearGoogleSession,
        clearPrivacy: clearPrivacyNotices,
        nuclearReset: fullNuclearReset,
        validateClientID: validateClientID,
        exportSnapshot: exportLocalStorageSnapshot,
    };
}

console.log('✅ Lex Tigress Debug Utils Loaded');
console.log('\n📖 Available commands in browser console:');
console.log('   • __LEX_TIGRESS_DEBUG.diagnose() - Check OAuth status');
console.log('   • __LEX_TIGRESS_DEBUG.clearGoogle() - Clear Google data');
console.log('   • __LEX_TIGRESS_DEBUG.clearPrivacy() - Reset privacy notices');
console.log('   • __LEX_TIGRESS_DEBUG.nuclearReset() - FULL RESET');
console.log('   • __LEX_TIGRESS_DEBUG.validateClientID() - Verify Client ID');
console.log('   • __LEX_TIGRESS_DEBUG.exportSnapshot() - Backup LocalStorage');
