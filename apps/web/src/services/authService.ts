import { supabase } from '../lib/supabaseClient';
import type { UserProfile, TeamMemberRole } from '../types';

export interface GoogleUser {
    id: string;
    email: string;
    name: string;
    picture: string;
}

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE";

export const getCurrentUser = () => {
    const email = localStorage.getItem('google_user_email');
    const name = localStorage.getItem('google_user_name');

    if (email && name) {
        return {
            id: email,
            email: email,
            name: name,
            role: "User",
            picture: ""
        };
    }

    return {
        id: "guest",
        name: "Lex Tigress Guest",
        role: "Guest"
    };
};

export const fetchUserProfile = async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
    return data as UserProfile;
};

export const upsertUserProfile = async (
    userId: string,
    email: string,
    fullName: string,
    role: TeamMemberRole = 'Admin' as TeamMemberRole
): Promise<UserProfile | null> => {
    const { data, error } = await supabase
        .from('user_profiles')
        .upsert({
            id: userId,
            email,
            full_name: fullName,
            role,
        }, { onConflict: 'id' })
        .select()
        .single();

    if (error) {
        console.error('Error upserting user profile:', error);
        return null;
    }
    return data as UserProfile;
};

export const saveGoogleSession = (token: string, expiresIn: number, email: string, name: string) => {
    const expiry = Date.now() + expiresIn * 1000;
    localStorage.setItem('google_access_token', token);
    localStorage.setItem('google_token_expiry', expiry.toString());
    localStorage.setItem('google_user_email', email);
    localStorage.setItem('google_user_name', name);
};

export const getGoogleSession = () => {
    const token = localStorage.getItem('google_access_token');
    const expiryStr = localStorage.getItem('google_token_expiry');
    const email = localStorage.getItem('google_user_email');
    const name = localStorage.getItem('google_user_name');

    if (!token || !expiryStr || !email) return null;

    const isExpired = Date.now() > parseInt(expiryStr);

    return {
        token,
        email,
        name,
        expiresIn: parseInt(expiryStr) - Date.now(),
        isExpired
    };
};

export const logoutGoogle = () => {
    const email = localStorage.getItem('google_user_email');

    // 1. Remove session keys
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expiry');
    localStorage.removeItem('google_user_email');
    localStorage.removeItem('google_user_name');

    // 2. Remove user-specific sheet ID
    if (email) {
        localStorage.removeItem(`notes_sheet_id_${email}`);
        localStorage.removeItem(`privacy_notice_accepted_${email}`);
    }

    // 3. Clear ALL local note data as per security RULE 4
    localStorage.removeItem('lextgress_notes');
};

export const getSheetIdForUser = (email: string): string | null => {
    return localStorage.getItem(`notes_sheet_id_${email}`);
};

export const setSheetIdForUser = (email: string, sheetId: string) => {
    localStorage.setItem(`notes_sheet_id_${email}`, sheetId);
};
