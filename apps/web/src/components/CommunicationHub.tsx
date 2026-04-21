import React, { useState, useEffect } from 'react';
import { communicationService, Message, Client } from '../services/communicationService';

export default function CommunicationHub({ T }: { T: any }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [pending, setPending] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'whatsapp' | 'email' | 'in-app'>('all');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [hist, pend] = await Promise.all([
                communicationService.getMessageHistory(''), // Empty string for overall history in MVP
                communicationService.getPendingApprovals()
            ]);
            setMessages(hist);
            setPending(pend);
            setLoading(false);
        };
        load();
    }, []);

    const handleApprove = async (id: string) => {
        if (await communicationService.approveMessage(id)) {
            setPending(prev => prev.filter(m => m.id !== id));
            // In a real app, status would update to 'sent'
        }
    };

    if (loading) return <div style={{ padding: 20, color: T.textMuted }}>Loading communications...</div>;

    const filtered = filter === 'all' ? messages : messages.filter(m => m.channel === filter);

    return (
        <div style={{ flex: 1, overflowY: "auto", padding: 24, background: T.bg }}>
            {/* Header */}
            <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 8 }}>Communication Hub</h2>
                <p style={{ color: T.textSub, fontSize: 14 }}>Monitor and manage client interactions across WhatsApp, Email, and In-App channels.</p>
            </div>

            {/* Stats Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginBottom: 32 }}>
                <StatCard title="Pending Approvals" count={pending.length} icon="⏳" color="#9B7B28" T={T} />
                <StatCard title="WhatsApp Sent" count={messages.filter(m => m.channel === 'whatsapp' && m.direction === 'outbound').length} icon="📱" color="#1A8C5B" T={T} />
                <StatCard title="Client Replies" count={messages.filter(m => m.direction === 'inbound').length} icon="📥" color="#1A2E5E" T={T} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 32 }}>
                {/* 1. Approval Bench */}
                <div>
                    <SectionHead title="Approval Bench" icon="🛡️" T={T} />
                    <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                        {pending.length === 0 ? (
                            <div style={{ padding: 32, textAlign: "center", color: T.textMuted }}>
                                <div style={{ fontSize: 24, marginBottom: 12 }}>✨</div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>Zero pending approvals</div>
                            </div>
                        ) : (
                            pending.map(m => (
                                <div key={m.id} style={{ padding: 16, borderBottom: `1px solid ${T.borderSoft}`, position: "relative" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: "#9B7B28", textTransform: "uppercase" }}>Requires AOR Approval</div>
                                        <div style={{ fontSize: 11, color: T.textMuted }}>{new Date(m.created_at).toLocaleString()}</div>
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>To: {(m as any).clients?.name || 'Client'}</div>
                                    <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5, background: T.bg, padding: 12, borderRadius: 8, marginTop: 8 }}>
                                        {m.content}
                                    </div>
                                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                        <button onClick={() => handleApprove(m.id)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "#1A8C5B", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Approve & Send</button>
                                        <button style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 2. Communication History */}
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <SectionHead title="Recent History" icon="📜" T={T} />
                        <div style={{ display: "flex", gap: 6 }}>
                            {['all', 'whatsapp', 'email', 'in-app'].map(f => (
                                <button key={f} onClick={() => setFilter(f as any)} style={{
                                    padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "none",
                                    background: filter === f ? T.accentDark : T.borderSoft,
                                    color: filter === f ? "#fff" : T.textSub,
                                    cursor: "pointer", textTransform: "capitalize"
                                }}>{f}</button>
                            ))}
                        </div>
                    </div>
                    <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                        {filtered.length === 0 ? (
                            <div style={{ padding: 48, textAlign: "center", color: T.textMuted }}>No history found</div>
                        ) : (
                            filtered.map(m => (
                                <div key={m.id} style={{ padding: "16px 20px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", gap: 16 }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                                        background: m.direction === 'inbound' ? "rgba(26,46,94,0.1)" : "rgba(26,140,91,0.1)",
                                        color: m.direction === 'inbound' ? "#1A2E5E" : "#1A8C5B",
                                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
                                    }}>{m.channel === 'whatsapp' ? '💬' : m.channel === 'email' ? '📧' : '🔔'}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{m.direction === 'inbound' ? 'From Client' : 'To Client'}</div>
                                            <div style={{ fontSize: 11, color: T.textMuted }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                        </div>
                                        <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.4 }}>{m.content.slice(0, 100)}{m.content.length > 100 ? '...' : ''}</div>
                                        {m.metadata?.ai_analysis && (
                                            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                                                <span style={{ fontSize: 10, background: "#F0F9FF", color: "#0369A1", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>AI: {m.metadata.ai_analysis.intent}</span>
                                                <span style={{ fontSize: 10, background: m.metadata.ai_analysis.urgency === 'high' ? "#FEF2F2" : "#F8FAFC", color: m.metadata.ai_analysis.urgency === 'high' ? "#991B1B" : T.textSub, padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>{m.metadata.ai_analysis.urgency.toUpperCase()}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, count, icon, color, T }: { title: string; count: number; icon: string; color: string; T: any }) {
    return (
        <div style={{ background: T.surface, padding: 20, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color }}>{count}</div>
        </div>
    );
}

function SectionHead({ title, icon, T }: { title: string; icon: string; T: any }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>{title}</span>
        </div>
    );
}
