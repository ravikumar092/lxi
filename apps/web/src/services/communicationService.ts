/**
 * Lex Tigress — Communication Service
 * Handles interaction with the communication backend (WhatsApp, Email, In-app).
 * Manages client data and communication history.
 */

import { supabase } from '../lib/supabaseClient';

export interface Client {
    id: string;
    team_id: string;
    name: string;
    whatsapp_number: string;
    email: string;
    preferences: {
        channels: ('whatsapp' | 'email' | 'in-app')[];
        language: string;
    };
    created_at: string;
}

export interface Message {
    id: string;
    case_id: string | null;
    client_id: string;
    team_id: string;
    channel: 'whatsapp' | 'email' | 'in-app';
    direction: 'inbound' | 'outbound';
    content: string;
    status: 'queued' | 'pending_approval' | 'sent' | 'delivered' | 'read' | 'failed';
    metadata?: any;
    ai_extracted_tasks?: any[];
    created_at: string;
}

export const communicationService = {
    /**
     * Fetch clients for the current team.
     */
    async getClients(): Promise<Client[]> {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .order('name');
        if (error) { console.error('[Comm] getClients failed', error); return []; }
        return data as Client[];
    },

    /**
     * Create or update a client.
     */
    async saveClient(client: Partial<Client>): Promise<Client | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        // Get team_id for the user
        const { data: profile } = await supabase.from('user_profiles').select('team_id').single();
        const team_id = profile?.team_id;

        const { data, error } = await supabase
            .from('clients')
            .upsert({ ...client, team_id })
            .select()
            .single();

        if (error) { console.error('[Comm] saveClient failed', error); return null; }
        return data as Client;
    },

    /**
     * Fetch communication history for a specific case.
     */
    async getMessageHistory(caseId: string): Promise<Message[]> {
        const { data, error } = await supabase
            .from('communication_history')
            .select('*')
            .eq('case_id', caseId)
            .order('created_at', { ascending: true });
        if (error) { console.error('[Comm] getMessageHistory failed', error); return []; }
        return data as Message[];
    },

    /**
     * Fetch all messages requiring approval.
     */
    async getPendingApprovals(): Promise<Message[]> {
        const { data, error } = await supabase
            .from('communication_history')
            .select('*, cases(case_number, petitioner, respondent), clients(name)')
            .eq('status', 'pending_approval')
            .order('created_at', { ascending: false });
        if (error) { console.error('[Comm] getPendingApprovals failed', error); return []; }
        return data as Message[];
    },

    /**
     * Trigger a notification via backend.
     */
    async sendNotification(params: {
        caseId: string;
        clientId: string;
        channel: 'whatsapp' | 'email' | 'in-app';
        content: string;
        eventType: string;
        /** Recipient WhatsApp number, e.g. "+919566652806" or "whatsapp:+919566652806" */
        whatsappTo?: string;
        /** Template variables JSON string or object, e.g. {"1":"12/1","2":"3pm"} */
        contentVariables?: Record<string, string> | string;
    }): Promise<boolean> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch('/api/communication/notify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify(params)
            });
            return response.ok;
        } catch (err) {
            console.error('[Comm] sendNotification failed', err);
            return false;
        }
    },

    /**
     * Approve a pending message.
     */
    async approveMessage(messageId: string): Promise<boolean> {
        const { error } = await supabase
            .from('communication_history')
            .update({ status: 'sent' }) // In real app, this would trigger the actual send
            .eq('id', messageId);
        return !error;
    }
};
