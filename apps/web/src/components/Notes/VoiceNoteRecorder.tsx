import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, X, Check, Save, Bell, BellOff, Plus, Trash2 } from 'lucide-react';
import { transcribeAudio, uploadAudioNote, createNote } from '../../services/notesService';
import { analyseNoteContent } from '../../services/noteAiService';
import { Case } from '../../types';
import { Note } from '../../types/notes';

interface VoiceNoteRecorderProps {
    cases: Case[];
    onClose: () => void;
    onComplete: (note: Note) => void;
    T: any;
}

export default function VoiceNoteRecorder({ cases, onClose, onComplete, T }: VoiceNoteRecorderProps) {
    const [status, setStatus] = useState<'idle' | 'recording' | 'processing' | 'done'>('idle');
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [transcription, setTranscription] = useState('');
    const [analysis, setAnalysis] = useState<any>(null);
    
    // Req #2b + #3: confirmed linked cases (user can add/remove)
    const [confirmedCaseIds, setConfirmedCaseIds] = useState<string[]>([]);
    const [showCaseSearch, setShowCaseSearch] = useState(false);
    const [caseSearchTerm, setCaseSearchTerm] = useState('');

    // Req #5: task confirmation  
    const [selectedTasks, setSelectedTasks] = useState<number[]>([]);

    // Req #7: notification toggle
    const [notifyAssociates, setNotifyAssociates] = useState(false);
    const [notifyClient, setNotifyClient] = useState(false);
    
    const [isSaving, setIsSaving] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        if (analysis?.suggestedCaseIds) {
            setConfirmedCaseIds(analysis.suggestedCaseIds);
        }
    }, [analysis]);

    useEffect(() => {
        if (analysis?.tasks) {
            setSelectedTasks(analysis.tasks.map((_: any, i: number) => i));
        }
    }, [analysis]);

    useEffect(() => {
        return () => {
            stopRecording();
            if (timerRef.current) clearInterval(timerRef.current);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                processAudio(audioBlob);
            };

            mediaRecorder.start();
            setIsRecording(true);
            setStatus('recording');
            setDuration(0);
            
            timerRef.current = setInterval(() => {
                setDuration(prev => prev + 1);
            }, 1000);

            startVisualizer(stream);
        } catch (err) {
            console.error('Failed to start recording:', err);
            alert('Could not access microphone. Please allow microphone permissions.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            clearInterval(timerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
    };

    const processAudio = async (blob: Blob) => {
        setStatus('processing');
        try {
            const { text } = await transcribeAudio(blob);
            setTranscription(text);
            const result = await analyseNoteContent(text, cases);
            setAnalysis(result);
            setStatus('done');
        } catch (err) {
            console.error('Processing failed:', err);
            setStatus('idle');
            alert('AI processing failed. Please try again.');
        }
    };

    const startVisualizer = (stream: MediaStream) => {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyserRef.current = analyser;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const draw = () => {
            if (!canvasRef.current) return;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            animationFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i] / 2;
                ctx.fillStyle = `rgb(201, 168, 76)`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };
        draw();
    };

    const formatTime = (s: number) => {
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Req #3: Add/remove case links
    const removeCaseLink = (caseId: string) => {
        setConfirmedCaseIds(prev => prev.filter(id => id !== caseId));
    };
    const addCaseLink = (caseId: string) => {
        if (!confirmedCaseIds.includes(caseId)) {
            setConfirmedCaseIds(prev => [...prev, caseId]);
        }
        setShowCaseSearch(false);
        setCaseSearchTerm('');
    };

    const filteredCases = cases.filter(c => {
        if (!caseSearchTerm.trim()) return !confirmedCaseIds.includes(c.id);
        const q = caseSearchTerm.toLowerCase();
        return !confirmedCaseIds.includes(c.id) && (
            (c.displayTitle || '').toLowerCase().includes(q) ||
            (c.petitioner || '').toLowerCase().includes(q) ||
            (c.caseNumber || '').toLowerCase().includes(q) ||
            String(c.diaryNumber || '').includes(q)
        );
    }).slice(0, 6);

    const handleSave = async () => {
        if (!analysis || isSaving) return;
        setIsSaving(true);

        try {
            const noteId = crypto.randomUUID();
            const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
            
            let audioUrl = null;
            try {
                audioUrl = await uploadAudioNote(audioBlob, noteId);
            } catch { /* non-fatal */ }

            // Req #2b + #3: use confirmed case IDs (user may have edited them)
            const primaryCaseId = confirmedCaseIds[0] || null;
            const primaryCase = primaryCaseId ? cases.find(c => c.id === primaryCaseId) : null;

            const newNote: Note = {
                id: noteId,
                title: analysis.summary || `Voice Note — ${new Date().toLocaleDateString()}`,
                content: transcription,
                case_number: primaryCase?.shortCaseNumber || primaryCase?.caseNumber || null,
                case_name: primaryCase?.displayTitle || null,
                linked_case_ids: confirmedCaseIds,
                category: analysis.category,
                audio_url: audioUrl,
                duration: duration,
                is_ai_processed: true,
                extracted_tasks: analysis.tasks.filter((_: any, i: number) => selectedTasks.includes(i)),
                linked_team_member: null,
                // Req #7: store notification preferences
                tags: ['voice-note', 'ai-processed', ...(notifyAssociates ? ['notify-associates'] : []), ...(notifyClient ? ['notify-client'] : [])],
                created_by_id: '',
                created_by_name: 'Me',
                created_at: new Date().toISOString(),
                updated_by_id: null,
                updated_by_name: null,
                updated_at: new Date().toISOString(),
                is_deleted: false,
                deleted_at: null,
                source: 'voice'
            };

            // Req #6: Create tasks in each confirmed linked case
            const tasksToCreate = analysis.tasks
                .filter((_: any, i: number) => selectedTasks.includes(i))
                .map((t: any) => ({
                    id: crypto.randomUUID(),
                    text: t.text,
                    assignee: t.assignee,
                    urgency: t.urgency,
                    deadline: new Date(Date.now() + t.deadline_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    done: false,
                    isAuto: true,
                    sourceNoteId: noteId
                }));

            if (tasksToCreate.length > 0 && confirmedCaseIds.length > 0) {
                const { patchCase } = await import('../../services/supabaseCasesService');
                for (const caseId of confirmedCaseIds) {
                    const caseObj = cases.find(c => c.id === caseId);
                    if (caseObj) {
                        const existingTasks = caseObj.tasks || [];
                        await patchCase(caseId, { tasks: [...existingTasks, ...tasksToCreate] });
                    }
                }
            }

            // Req #7: trigger notifications if user opted in
            if ((notifyAssociates || notifyClient) && confirmedCaseIds.length > 0) {
                try {
                    import('../../services/communicationService').then(async ({ communicationService }) => {
                        const msgParts = [`📝 *New Voice Note (AI Processed)*\n\n📌 ${newNote.title}\n\n🏷️ Category: ${analysis.category}`];
                        if (tasksToCreate.length > 0) {
                            msgParts.push(`\n\n✅ *Tasks Created (${tasksToCreate.length}):*`);
                            tasksToCreate.slice(0, 3).forEach((t: any) => {
                                msgParts.push(`\n• ${t.text} → ${t.assignee} (${t.urgency})`);
                            });
                        }
                        const msg = msgParts.join('');
                        await communicationService.sendNotification({
                            caseId: confirmedCaseIds[0],
                            clientId: '',
                            channel: 'whatsapp',
                            content: msg,
                            eventType: 'voice_note_processed',
                        });
                    });
                } catch { /* non-fatal */ }
            }

            await createNote(newNote);
            onComplete(newNote);
        } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to save note. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 28, 63, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
        }}>
            <div style={{
                background: T.surface,
                width: '100%',
                maxWidth: 580,
                borderRadius: 24,
                padding: 32,
                boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                textAlign: 'center',
                position: 'relative',
                maxHeight: '90vh',
                overflowY: 'auto'
            }}>
                <button 
                    onClick={onClose}
                    style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted }}
                >
                    <X size={24} />
                </button>

                <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8 }}>🎙 AI Voice Note</div>
                    <div style={{ fontSize: 14, color: T.textMuted }}>Record your thoughts, strategy, or tasks. AI will transcribe, classify, and extract actions.</div>
                </div>

                {/* ── IDLE: Start Button ── */}
                {status === 'idle' && (
                    <button 
                        onClick={startRecording}
                        className="pulse-button"
                        style={{
                            width: 80, height: 80, borderRadius: '50%',
                            background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                            color: '#fff', border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '60px auto', boxShadow: '0 8px 16px rgba(201,168,76,0.3)'
                        }}
                    >
                        <Mic size={32} />
                    </button>
                )}

                {/* ── RECORDING ── */}
                {status === 'recording' && (
                    <>
                        <canvas ref={canvasRef} width={300} height={60} style={{ margin: '0 auto 20px', display: 'block' }} />
                        <div style={{ fontSize: 32, fontWeight: 700, color: T.text, marginBottom: 24, fontFamily: 'monospace' }}>
                            {formatTime(duration)}
                        </div>
                        <button 
                            onClick={stopRecording}
                            style={{
                                width: 80, height: 80, borderRadius: '50%',
                                background: '#EF4444',
                                color: '#fff', border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto', boxShadow: '0 8px 16px rgba(239,68,68,0.3)'
                            }}
                        >
                            <Square size={32} fill="currentColor" />
                        </button>
                    </>
                )}

                {/* ── PROCESSING ── */}
                {status === 'processing' && (
                    <div style={{ padding: '40px 0' }}>
                        <Loader2 size={48} className="animate-spin" style={{ color: '#C9A84C', margin: '0 auto 16px' }} />
                        <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Analysing your note...</div>
                        <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Transcribing · Classifying · Identifying cases · Extracting tasks</div>
                    </div>
                )}

                {/* ── DONE: Confirmation UI ── */}
                {status === 'done' && (
                    <div style={{ textAlign: 'left' }}>
                        
                        {/* Transcription */}
                        <div style={{ background: T.bg, padding: 12, borderRadius: 12, marginBottom: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Transcription</div>
                            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, fontStyle: 'italic' }}>"{transcription}"</div>
                        </div>
                        
                        {/* Classification */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            <div style={{ background: 'rgba(201,168,76,0.1)', color: '#C9A84C', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, border: '1px solid rgba(201,168,76,0.2)' }}>
                                🏷️ {analysis?.category}
                            </div>
                            <div style={{ fontSize: 11, color: T.textMuted, padding: '4px 0', display: 'flex', alignItems: 'center' }}>
                                AI Confidence: High
                            </div>
                        </div>

                        {/* ── Req #2b + #3: CASE LINKING (mandatory confirmation with add/remove) ── */}
                        <div style={{ marginBottom: 16, background: T.bg, borderRadius: 12, padding: 14, border: `1px solid ${T.border}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
                                    ⚖️ Case Links ({confirmedCaseIds.length})
                                </div>
                                <button
                                    onClick={() => setShowCaseSearch(!showCaseSearch)}
                                    style={{ fontSize: 11, fontWeight: 700, color: '#2A7BD4', background: 'rgba(42,123,212,0.1)', border: '1px solid rgba(42,123,212,0.2)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                >
                                    <Plus size={12} /> Link Case
                                </button>
                            </div>

                            {/* Case search dropdown */}
                            {showCaseSearch && (
                                <div style={{ marginBottom: 10 }}>
                                    <input
                                        autoFocus
                                        value={caseSearchTerm}
                                        onChange={e => setCaseSearchTerm(e.target.value)}
                                        placeholder="Search by party name or case number..."
                                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 12, background: T.surface, color: T.text, boxSizing: 'border-box', outline: 'none' }}
                                    />
                                    <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4 }}>
                                        {filteredCases.length === 0 ? (
                                            <div style={{ fontSize: 12, color: T.textMuted, padding: '8px 0', textAlign: 'center' }}>No cases found</div>
                                        ) : filteredCases.map(c => (
                                            <button
                                                key={c.id}
                                                onClick={() => addCaseLink(c.id)}
                                                style={{ width: '100%', textAlign: 'left', background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', marginBottom: 4, fontSize: 12, color: T.text }}
                                            >
                                                <div style={{ fontWeight: 700 }}>{c.displayTitle || c.petitioner}</div>
                                                <div style={{ fontSize: 10, color: T.textMuted }}>{c.caseNumber || c.diaryNumber}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Confirmed case tags */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {confirmedCaseIds.length === 0 && (
                                    <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>No cases linked. Use "+ Link Case" to add.</div>
                                )}
                                {confirmedCaseIds.map(caseId => {
                                    const c = cases.find(x => x.id === caseId);
                                    return (
                                        <div key={caseId} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(42,123,212,0.1)', border: '1px solid rgba(42,123,212,0.2)', borderRadius: 20, padding: '4px 10px', fontSize: 11, color: '#2A7BD4', fontWeight: 700 }}>
                                            ⚖️ {c ? (c.displayTitle || c.petitioner || c.caseNumber) : caseId.slice(0, 8)}
                                            <button
                                                onClick={() => removeCaseLink(caseId)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2A7BD4', display: 'flex', padding: 0 }}
                                                title="Remove link"
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Req #5: Suggested Tasks ── */}
                        {analysis?.tasks.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>✅ Suggested Tasks (select to create)</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {analysis.tasks.map((task: any, idx: number) => {
                                        const isSelected = selectedTasks.includes(idx);
                                        return (
                                            <div 
                                                key={idx} 
                                                onClick={() => setSelectedTasks(prev => isSelected ? prev.filter(i => i !== idx) : [...prev, idx])}
                                                style={{ 
                                                    background: T.bg, 
                                                    padding: '10px 12px', 
                                                    borderRadius: 10, 
                                                    border: `1px solid ${isSelected ? '#C9A84C' : T.borderSoft}`,
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: 12,
                                                    cursor: 'pointer',
                                                    opacity: isSelected ? 1 : 0.6,
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <div style={{ 
                                                    width: 18, height: 18, borderRadius: 4, 
                                                    border: `2px solid ${isSelected ? '#C9A84C' : T.textMuted}`,
                                                    background: isSelected ? '#C9A84C' : 'transparent',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: '#fff', flexShrink: 0
                                                }}>
                                                    {isSelected && <Check size={14} strokeWidth={4} />}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{task.text}</div>
                                                    <div style={{ fontSize: 10, color: T.textMuted, display: 'flex', gap: 8, marginTop: 3 }}>
                                                        <span>👤 {task.assignee}</span>
                                                        <span style={{ color: task.urgency === 'Critical' ? '#EF4444' : task.urgency === 'High' ? '#F59E0B' : T.textMuted }}>🔥 {task.urgency}</span>
                                                        <span>⏱ {task.deadline_days === 0 ? 'Today' : `${task.deadline_days}d`}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── Req #7: Notification Toggle ── */}
                        <div style={{ marginBottom: 20, background: T.bg, borderRadius: 12, padding: 14, border: `1px solid ${T.border}` }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>🔔 Notifications (Optional)</div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    onClick={() => setNotifyAssociates(!notifyAssociates)}
                                    style={{
                                        flex: 1, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                                        border: `1px solid ${notifyAssociates ? '#C9A84C' : T.borderSoft}`,
                                        background: notifyAssociates ? 'rgba(201,168,76,0.1)' : T.surface,
                                        color: notifyAssociates ? '#C9A84C' : T.textMuted,
                                        fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {notifyAssociates ? <Bell size={14} /> : <BellOff size={14} />}
                                    Notify Associates
                                </button>
                                <button
                                    onClick={() => setNotifyClient(!notifyClient)}
                                    style={{
                                        flex: 1, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                                        border: `1px solid ${notifyClient ? '#2A7BD4' : T.borderSoft}`,
                                        background: notifyClient ? 'rgba(42,123,212,0.1)' : T.surface,
                                        color: notifyClient ? '#2A7BD4' : T.textMuted,
                                        fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {notifyClient ? <Bell size={14} /> : <BellOff size={14} />}
                                    Notify Client
                                </button>
                            </div>
                        </div>

                        {/* ── Action Buttons ── */}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button 
                                onClick={() => setStatus('idle')}
                                style={{
                                    flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${T.border}`,
                                    background: T.bg, color: T.text, cursor: 'pointer', fontWeight: 700, fontSize: 14
                                }}
                            >
                                Discard
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={isSaving}
                                style={{
                                    flex: 2, padding: '12px', borderRadius: 12,
                                    background: isSaving ? T.borderSoft : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                    color: '#fff', border: 'none', cursor: isSaving ? 'wait' : 'pointer',
                                    fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    boxShadow: '0 4px 12px rgba(201,168,76,0.3)',
                                    opacity: isSaving ? 0.7 : 1
                                }}
                            >
                                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {isSaving ? 'Saving...' : 'Confirm & Save'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
