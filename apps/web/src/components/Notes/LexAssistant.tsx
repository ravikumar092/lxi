import { useState, useEffect, useRef, useCallback } from 'react';
import { Scale, Volume2, VolumeX, Mic, MicOff, ArrowRight } from 'lucide-react';
import type { Case, Task } from '../../types';
import { LIGHT_THEME } from '../../themes';
import { Priority, TaskStatus } from '../../types';
import type {
  ChatMessage,
  AssistantAction,
  CaseSuggestion,
} from '../../services/lexAssistantService';
import {
  analyseMessage,
  getTodayCases,
  getUrgentItems,
} from '../../services/lexAssistantService';
import { createNote } from '../../services/notesService';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LexAssistantProps {
  cases: Case[];
  T: typeof LIGHT_THEME;
  onNavigateToCase: (caseId: string) => void;
  onNoteAdded: () => void;
  onTaskAdded: (caseId: string, task: Task) => void;
}

// Extend Window for SpeechRecognition (not in all TS lib versions)
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }
}

// ── Welcome message ────────────────────────────────────────────────────────────

const WELCOME_TEXT =
  "Hi! I'm Lex, your AI legal clerk. I can help you add notes, create tasks, check hearing dates, or give you a summary of today's listings. What do you need?";

const makeWelcomeMsg = (): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  text: WELCOME_TEXT,
  timestamp: new Date(),
  needsConfirmation: false,
  suggestedCases: [],
});

// ── Component ──────────────────────────────────────────────────────────────────

export default function LexAssistant({
  cases,
  T,
  onNavigateToCase,
  onNoteAdded,
  onTaskAdded,
}: LexAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcomeMsg()]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [pendingCaseName, setPendingCaseName] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState<string>('en-IN');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const spokenWelcome = useRef(false);
  const isProcessingRef = useRef(false);
  const finalTranscriptRef = useRef('');

  // ── Speech synthesis ─────────────────────────────────────────────────────────

  const speakText = useCallback(
    (text: string) => {
      if (isMuted) return;
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.lang = voiceLang;
      window.speechSynthesis.speak(utterance);
    },
    [isMuted, voiceLang]
  );

  // Speak welcome on mount (once)
  useEffect(() => {
    if (spokenWelcome.current) return;
    spokenWelcome.current = true;
    const timer = setTimeout(() => speakText(WELCOME_TEXT), 500);
    return () => clearTimeout(timer);
  }, [speakText]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const scrollToBottom = () => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const addBotMessage = useCallback(
    (text: string) => {
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text,
        timestamp: new Date(),
        needsConfirmation: false,
        suggestedCases: [],
      };
      setMessages(prev => [...prev, msg]);
      speakText(text);
      scrollToBottom();
    },
    [speakText]
  );

  // ── Voice input ───────────────────────────────────────────────────────────────

  const VOICE_ERROR_MAP: Record<string, string> = {
    'not-allowed':
      'Microphone access denied. Please allow microphone permission in browser settings.',
    'no-speech':
      'No speech detected. Please speak clearly and try again.',
    'network':
      'Network error during voice recognition. Please check your connection.',
    'language-not-supported':
      'This language is not supported for voice input. Please type your message instead.',
    'audio-capture':
      'No microphone found. Please connect a microphone and try again.',
  };

  const LANG_NAMES: Record<string, string> = {
    'en-IN': 'English',
    'ta-IN': 'Tamil',
    'hi-IN': 'Hindi',
    'te-IN': 'Telugu',
    'kn-IN': 'Kannada',
    'ml-IN': 'Malayalam',
    'mr-IN': 'Marathi',
    'bn-IN': 'Bengali',
    'gu-IN': 'Gujarati',
    'pa-IN': 'Punjabi',
  };

  const toggleListening = async () => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      addBotMessage(
        'Voice input is only supported in Chrome or Edge browsers. Please type your message instead.'
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      addBotMessage(
        'Microphone permission denied. Please allow microphone access in your browser settings and try again.'
      );
      return;
    }

    finalTranscriptRef.current = '';

    const recognition = new SR();
    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      setInputText(transcript);
      finalTranscriptRef.current = transcript;
      if (event.results[event.results.length - 1].isFinal) {
        recognition.stop();
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      const final = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = '';
      if (final && !isProcessingRef.current) {
        handleSend(final);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      const msg =
        VOICE_ERROR_MAP[event.error] ??
        `Voice error: ${event.error}. Please type instead.`;
      addBotMessage(msg);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // ── Send message ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      try {
        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          text: text.trim(),
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsThinking(true);

        const response = await analyseMessage(text, messages, cases);

        setIsThinking(false);

        const botMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: response.reply,
          timestamp: new Date(),
          action: response.action,
          suggestedCases: response.suggestedCases,
          needsConfirmation: response.needsConfirmation,
        };

        setMessages(prev => [...prev, botMsg]);

        if (response.needsConfirmation && response.action.type !== 'NONE') {
          setPendingAction(response.action);
          if (response.action.caseId) setPendingCaseId(response.action.caseId);
          if (response.action.caseName) setPendingCaseName(response.action.caseName);
        }

        speakText(response.reply);
        scrollToBottom();
      } finally {
        setIsThinking(false);
        isProcessingRef.current = false;
      }
    },
    [messages, cases, speakText]
  );

  // ── Case selected from suggestions ────────────────────────────────────────────

  const handleCaseSelected = useCallback(
    (suggestion: CaseSuggestion) => {
      setPendingCaseId(suggestion.caseId);
      setPendingCaseName(suggestion.title);
      if (pendingAction) {
        setPendingAction({ ...pendingAction, caseId: suggestion.caseId, caseName: suggestion.title });
      }
      const confirmMsg = `Got it — I've selected ${suggestion.title}. Shall I go ahead and save?`;
      const botMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: confirmMsg,
        timestamp: new Date(),
        needsConfirmation: true,
        suggestedCases: [],
      };
      setMessages(prev => [...prev, botMsg]);
      speakText(confirmMsg);
    },
    [pendingAction, speakText]
  );

  // ── Confirm pending action ────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;

    try {
      if (pendingAction.type === 'SAVE_NOTE') {
        const matchedCase = cases.find(c => c.id === pendingCaseId);
        await createNote({
          id: crypto.randomUUID(),
          title: `Voice Note — ${new Date().toLocaleDateString('en-IN')}`,
          content: pendingAction.note ?? '',
          case_number: matchedCase?.caseNumber ?? null,
          case_name: pendingCaseName,
          linked_team_member: null,
          tags: ['voice-note', 'lex-assistant'],
          created_by_id: '',
          created_by_name: 'Lex Assistant',
          created_at: new Date().toISOString(),
          updated_by_id: null,
          updated_by_name: null,
          updated_at: null,
          is_deleted: false,
          deleted_at: null,
          source: 'app',
        });
        onNoteAdded();
        addBotMessage(`Note saved to ${pendingCaseName ?? 'the case'}. Anything else I can help with?`);
      }

      if (pendingAction.type === 'SAVE_TASK') {
        const urgency = pendingAction.task?.urgency ?? 'Medium';
        const priorityMap: Record<string, Priority> = {
          Critical: Priority.HIGH,
          High: Priority.HIGH,
          Medium: Priority.MEDIUM,
          Low: Priority.LOW,
        };

        const deadlineDate = pendingAction.task?.deadline
          ? new Date(pendingAction.task.deadline)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const newTask: Task = {
          id: crypto.randomUUID(),
          title: pendingAction.task?.action ?? '',
          description: `Created by Lex Assistant. Assigned to: ${pendingAction.task?.assignee ?? 'team'}`,
          deadline: deadlineDate,
          priority: priorityMap[urgency] ?? Priority.MEDIUM,
          responsibleAssociateId: pendingAction.task?.assignee ?? '',
          status: TaskStatus.OPEN,
          linkedCaseId: pendingCaseId ?? '',
        };

        if (pendingCaseId) onTaskAdded(pendingCaseId, newTask);
        addBotMessage(
          `Task assigned to ${pendingAction.task?.assignee ?? 'team'} and saved. Anything else?`
        );
      }

      if (pendingAction.type === 'NAVIGATE_CASE') {
        if (pendingCaseId) onNavigateToCase(pendingCaseId);
        addBotMessage(`Opening ${pendingCaseName ?? 'the case'} now.`);
      }
    } catch {
      addBotMessage("Sorry, I couldn't save that. Please try again.");
    }

    setPendingAction(null);
    setPendingCaseId(null);
    setPendingCaseName(null);
  }, [pendingAction, pendingCaseId, pendingCaseName, cases, onNoteAdded, onTaskAdded, onNavigateToCase, addBotMessage]);

  // ── Cancel pending action ─────────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    setPendingCaseId(null);
    setPendingCaseName(null);
    addBotMessage('No problem, cancelled. Is there anything else I can help with?');
  }, [addBotMessage]);

  // ── Quick chips ───────────────────────────────────────────────────────────────

  const QUICK_CHIPS = ["Today's cases", 'Urgent tasks', 'Add a note', 'Next hearing'];

  // ── Status dot ────────────────────────────────────────────────────────────────

  const statusDot = isListening
    ? { color: '#EF4444', animate: true, label: 'Listening...' }
    : isThinking
    ? { color: '#C9A84C', animate: true, label: 'Thinking...' }
    : { color: '#9CA3AF', animate: false, label: 'Ready' };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe animations */}
      <style>{`
        @keyframes lexPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
        @keyframes lexBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes lexDotPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.4); }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

        {/* ── SECTION A: Header ── */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: T.sidebar,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={22} color="#C9A84C" />
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
                Lex Assistant
              </div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>
                Your AI legal clerk
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: statusDot.color,
                  animation: statusDot.animate ? 'lexDotPulse 1s ease-in-out infinite' : 'none',
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{statusDot.label}</span>
            </div>
            <button
              onClick={() => setIsMuted(m => !m)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <VolumeX size={18} color="rgba(255,255,255,0.7)" />
              ) : (
                <Volume2 size={18} color="rgba(255,255,255,0.7)" />
              )}
            </button>
          </div>
        </div>

        {/* ── SECTION B: Chat window ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 20,
            background: T.bg,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            scrollbarWidth: 'thin',
            scrollbarColor: `${T.border} transparent`,
          }}
        >
          {messages.map((msg, idx) => {
            const isLatest = idx === messages.length - 1;

            if (msg.role === 'user') {
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      background: '#C9A84C',
                      color: '#fff',
                      borderRadius: '16px 16px 4px 16px',
                      maxWidth: '75%',
                      padding: '12px 16px',
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            }

            // Bot message
            return (
              <div key={msg.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {/* Avatar */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: T.sidebar,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Scale size={16} color="#C9A84C" />
                </div>

                {/* Bubble */}
                <div
                  style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: '16px 16px 16px 4px',
                    maxWidth: '80%',
                    padding: '12px 16px',
                    fontSize: 14,
                    color: T.text,
                    lineHeight: 1.5,
                    position: 'relative',
                  }}
                >
                  {/* Re-read button */}
                  <button
                    onClick={() => speakText(msg.text)}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      opacity: 0.5,
                    }}
                    title="Read aloud"
                  >
                    <Volume2 size={14} color={T.textMuted} />
                  </button>

                  {/* Reply text */}
                  <div style={{ paddingRight: 20 }}>{msg.text}</div>

                  {/* Case suggestion cards */}
                  {msg.suggestedCases && msg.suggestedCases.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {msg.suggestedCases.map(s => (
                        <div
                          key={s.caseId}
                          onClick={() => handleCaseSelected(s)}
                          style={{
                            background: T.bg,
                            border: `1px solid ${T.border}`,
                            borderRadius: 10,
                            padding: '10px 14px',
                            marginTop: 6,
                            cursor: 'pointer',
                            transition: 'border-left 0.15s',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLDivElement).style.borderLeft = '3px solid #C9A84C';
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLDivElement).style.borderLeft = `1px solid ${T.border}`;
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 2 }}>
                            {s.title.slice(0, 40)}
                          </div>
                          <div style={{ fontSize: 12, color: T.textMuted }}>
                            D.No: {s.diaryNumber}/{s.diaryYear}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginTop: 4,
                            }}
                          >
                            <span style={{ fontSize: 11, color: T.textMuted }}>
                              {s.caseType} {s.nextHearingDate ? `• ${s.nextHearingDate}` : ''}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 8,
                                background: s.confidence > 80 ? '#C9A84C' : T.border,
                                color: s.confidence > 80 ? '#fff' : T.textMuted,
                              }}
                            >
                              {s.confidence}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Confirmation buttons — only on latest bot message */}
                  {isLatest && msg.needsConfirmation && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={handleConfirm}
                        style={{
                          padding: '8px 20px',
                          background: '#C9A84C',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Yes, Save
                      </button>
                      <button
                        onClick={handleCancel}
                        style={{
                          padding: '8px 20px',
                          background: T.bg,
                          color: T.textMuted,
                          border: `1px solid ${T.border}`,
                          borderRadius: 8,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {isThinking && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: T.sidebar,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Scale size={16} color="#C9A84C" />
              </div>
              <div
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: '16px 16px 16px 4px',
                  padding: '14px 20px',
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                {[0, 150, 300].map((delay, i) => (
                  <div
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: T.textMuted,
                      animation: `lexBounce 0.8s ease-in-out infinite`,
                      animationDelay: `${delay}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ── SECTION C: Input bar ── */}
        <div
          style={{
            background: T.surface,
            borderTop: `1px solid ${T.border}`,
            padding: '12px 16px',
            flexShrink: 0,
          }}
        >
          {/* Quick chips — only when just welcome message shown */}
          {messages.length === 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {QUICK_CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => handleSend(chip)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: T.bg,
                    border: `1px solid ${T.border}`,
                    color: T.textMuted,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#C9A84C';
                    (e.currentTarget as HTMLButtonElement).style.color = '#C9A84C';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = T.border;
                    (e.currentTarget as HTMLButtonElement).style.color = T.textMuted;
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Mic button */}
            <button
              onClick={toggleListening}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                border: isListening ? '1px solid #FECACA' : `1px solid ${T.border}`,
                background: isListening ? '#FEF2F2' : T.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                animation: isListening ? 'lexPulse 1s ease-in-out infinite' : 'none',
              }}
              title={isListening ? 'Stop listening' : 'Start voice input'}
            >
              {isListening ? (
                <MicOff size={16} color="#C62828" />
              ) : (
                <Mic size={16} color={T.textMuted} />
              )}
            </button>

            {/* Language selector */}
            <select
              value={voiceLang}
              onChange={e => setVoiceLang(e.target.value)}
              title="Voice input language"
              style={{
                height: 36,
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.bg,
                color: T.text,
                fontSize: 13,
                padding: '0 8px',
                width: 'auto',
                cursor: 'pointer',
                outline: 'none',
                flexShrink: 0,
              }}
            >
              <option value="en-IN">EN</option>
              <option value="ta-IN">தமிழ்</option>
              <option value="hi-IN">हिंदी</option>
              <option value="te-IN">తెలుగు</option>
              <option value="kn-IN">ಕನ್ನಡ</option>
              <option value="ml-IN">മലയാളം</option>
              <option value="mr-IN">मराठी</option>
              <option value="bn-IN">বাংলা</option>
              <option value="gu-IN">ગુજરાતી</option>
              <option value="pa-IN">ਪੰਜਾਬੀ</option>
            </select>

            {/* Text input */}
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(inputText);
                }
              }}
              disabled={isThinking}
              placeholder="Ask Lex anything about your cases..."
              style={{
                flex: 1,
                padding: '10px 14px',
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                background: T.bg,
                color: T.text,
                fontSize: 14,
                outline: 'none',
                opacity: isThinking ? 0.6 : 1,
              }}
            />

            {/* Send button */}
            <button
              onClick={() => handleSend(inputText)}
              disabled={!inputText.trim() || isThinking}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                border: 'none',
                background: inputText.trim() ? '#C9A84C' : T.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: inputText.trim() && !isThinking ? 'pointer' : 'not-allowed',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
              title="Send"
            >
              <ArrowRight size={16} color={inputText.trim() ? '#fff' : T.textMuted} />
            </button>
          </div>

          {/* Non-English voice hint */}
          {voiceLang !== 'en-IN' && (
            <div
              style={{
                fontSize: 11,
                color: T.textMuted,
                textAlign: 'center',
                padding: '4px 0 0',
              }}
            >
              Voice input works best in Chrome. If voice fails, please type in{' '}
              {LANG_NAMES[voiceLang] ?? voiceLang}.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
