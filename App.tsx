import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Play, 
  Pause, 
  Square, 
  Archive, 
  Share2, 
  Trash2, 
  ChevronLeft, 
  Settings, 
  PhoneIncoming,
  CheckCircle2,
  AlertCircle,
  ListTodo,
  FileText,
  Sparkles,
  Inbox,
  Phone
} from 'lucide-react';
import { analyzeVoicemail, analyzeTranscript } from './services/geminiService';
import { Voicemail, ViewState, ProcessingStatus, AssistantSettings, DEFAULT_SETTINGS } from './types';
import { WaveVisualizer } from './components/WaveVisualizer';
import { LiveCallSession } from './components/LiveCallSession';

// --- MOCK DATA GENERATOR ---
const generateMockVoicemail = (): Voicemail => ({
  id: Math.random().toString(36).substr(2, 9),
  sender: "Unknown Caller",
  timestamp: Date.now(),
  duration: 0,
  status: ProcessingStatus.COMPLETED,
  isRead: false,
  analysis: {
    transcript: "Hey, just calling to confirm our meeting for next Tuesday at 2 PM. Please let me know if you need to reschedule.",
    summary: "Confirmation for meeting next Tuesday at 2 PM.",
    actions: ["Confirm meeting time", "Check calendar"],
    priority: "Medium"
  }
});

const App: React.FC = () => {
  // State
  const [view, setView] = useState<ViewState>(ViewState.INBOX);
  const [voicemails, setVoicemails] = useState<Voicemail[]>([]);
  const [selectedVoicemailId, setSelectedVoicemailId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AssistantSettings>(DEFAULT_SETTINGS);
  
  // Recorder State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // --- EFFECTS ---
  
  // Initial load simulation
  useEffect(() => {
    // Add one mock voicemail on start
    const mock = generateMockVoicemail();
    mock.sender = "(555) 123-4567";
    mock.timestamp = Date.now() - 3600000;
    mock.duration = 12;
    setVoicemails([mock]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- HANDLERS ---

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        handleNewVoicemail(audioBlob, audioUrl, recordingTime);
        
        // Cleanup stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone permission is required to record.");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleNewVoicemail = async (blob: Blob, url: string, duration: number) => {
    const newVm: Voicemail = {
      id: Math.random().toString(36).substr(2, 9),
      sender: "New Recording",
      timestamp: Date.now(),
      duration: duration,
      audioBlob: blob,
      audioUrl: url,
      status: ProcessingStatus.PENDING,
      isRead: false,
    };

    setVoicemails(prev => [newVm, ...prev]);
    processVoicemail(newVm);
    setView(ViewState.INBOX);
  };

  const processVoicemail = async (vm: Voicemail) => {
    if (!vm.audioBlob) return;
    setVoicemails(prev => prev.map(v => v.id === vm.id ? { ...v, status: ProcessingStatus.PROCESSING } : v));
    try {
      const result = await analyzeVoicemail(vm.audioBlob);
      setVoicemails(prev => prev.map(v => v.id === vm.id ? { ...v, status: ProcessingStatus.COMPLETED, analysis: result } : v));
    } catch (error) {
      console.error("Processing failed", error);
      setVoicemails(prev => prev.map(v => v.id === vm.id ? { ...v, status: ProcessingStatus.FAILED } : v));
    }
  };

  // Handler for when the AI Live Call finishes
  const handleCallComplete = async (transcript: string, audioBlob: Blob | null) => {
    // 1. Create the entry
    const duration = audioBlob ? Math.ceil(audioBlob.size / 32000) : 0; // Roughly est duration or 0
    const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : undefined;
    
    const newVm: Voicemail = {
        id: Math.random().toString(36).substr(2, 9),
        sender: "Simulated Call",
        timestamp: Date.now(),
        duration: duration, // We don't have exact duration easily unless tracked, using approx
        audioBlob: audioBlob || undefined,
        audioUrl: audioUrl,
        status: ProcessingStatus.PROCESSING,
        isRead: false,
    };

    setVoicemails(prev => [newVm, ...prev]);
    setView(ViewState.INBOX);

    // 2. Analyze transcript directly (skip audio transcription since we have it)
    try {
        const result = await analyzeTranscript(transcript);
        setVoicemails(prev => prev.map(v => v.id === newVm.id ? {
            ...v,
            status: ProcessingStatus.COMPLETED,
            analysis: result
        } : v));
    } catch (e) {
        setVoicemails(prev => prev.map(v => v.id === newVm.id ? { ...v, status: ProcessingStatus.FAILED } : v));
    }
  };

  const handlePlayPause = (vm: Voicemail) => {
    if (selectedVoicemailId !== vm.id) {
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      if (vm.audioUrl) {
        const audio = new Audio(vm.audioUrl);
        audio.onended = () => setIsPlaying(false);
        setAudioElement(audio);
        audio.play();
        setIsPlaying(true);
      }
    } else {
      if (audioElement) {
        if (isPlaying) {
          audioElement.pause();
        } else {
          audioElement.play();
        }
        setIsPlaying(!isPlaying);
      } else if (vm.audioUrl) {
        const audio = new Audio(vm.audioUrl);
        audio.onended = () => setIsPlaying(false);
        setAudioElement(audio);
        audio.play();
        setIsPlaying(true);
      }
    }
  };

  const deleteVoicemail = (id: string) => {
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
    }
    setVoicemails(prev => prev.filter(v => v.id !== id));
    if (selectedVoicemailId === id) {
      setSelectedVoicemailId(null);
      setView(ViewState.INBOX);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- RENDER HELPERS ---

  const renderInbox = () => (
    <div className="flex flex-col h-full">
      <header className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Inbox</h1>
          <p className="text-sm text-slate-500">{voicemails.length} messages</p>
        </div>
        <button onClick={() => setView(ViewState.SETTINGS)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
          <Settings size={24} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24 no-scrollbar">
        {/* Call Simulation Entry Point */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-4 text-white shadow-md mb-4 flex items-center justify-between">
            <div>
                <h3 className="font-semibold flex items-center gap-2"><Phone size={16} fill="currentColor"/> Test Call Pickup</h3>
                <p className="text-xs text-indigo-100 mt-1 opacity-90">Simulate an incoming call handled by AI</p>
            </div>
            <button 
              onClick={() => setView(ViewState.CALL_SIMULATION)}
              className="bg-white text-indigo-600 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-indigo-50 active:scale-95 transition-all"
            >
                Simulate
            </button>
        </div>

        {voicemails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Inbox size={48} className="mb-4 opacity-50" />
            <p>No voicemails yet</p>
          </div>
        ) : (
          voicemails.map(vm => (
            <div 
              key={vm.id} 
              onClick={() => {
                setSelectedVoicemailId(vm.id);
                setView(ViewState.DETAIL);
              }}
              className={`
                bg-white p-4 rounded-xl shadow-sm border border-slate-100 active:scale-[0.98] transition-transform cursor-pointer
                ${!vm.isRead ? 'border-l-4 border-l-indigo-500' : ''}
              `}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    ${vm.status === ProcessingStatus.COMPLETED ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}
                  `}>
                    <PhoneIncoming size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{vm.sender}</h3>
                    <p className="text-xs text-slate-500">{new Date(vm.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                {vm.analysis?.priority === 'High' && (
                  <span className="bg-rose-100 text-rose-700 text-xs px-2 py-1 rounded-full font-medium">
                    Urgent
                  </span>
                )}
              </div>
              
              {vm.status === ProcessingStatus.PROCESSING ? (
                <div className="flex items-center gap-2 text-sm text-indigo-600 mt-2 animate-pulse">
                  <Sparkles size={14} />
                  <span>Processing conversation...</span>
                </div>
              ) : vm.status === ProcessingStatus.COMPLETED && vm.analysis ? (
                <p className="text-sm text-slate-600 line-clamp-2 mt-2">
                  {vm.analysis.summary}
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic mt-2">Audio pending processing</p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button for Record */}
      <div className="absolute bottom-6 right-6">
        <button 
          onClick={() => setView(ViewState.RECORD)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition-all active:scale-90 flex items-center justify-center"
        >
          <Mic size={28} />
        </button>
      </div>
    </div>
  );

  const renderRecord = () => (
    <div className="h-full flex flex-col bg-slate-900 text-white relative">
      <button 
        onClick={() => !isRecording && setView(ViewState.INBOX)}
        className="absolute top-6 left-6 p-2 bg-white/10 rounded-full backdrop-blur-sm z-10"
      >
        <ChevronLeft size={24} />
      </button>

      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-light tracking-tight">
            {isRecording ? 'Recording...' : 'Ready to Record'}
          </h2>
          <p className="text-slate-400 font-mono text-xl">
            {formatTime(recordingTime)}
          </p>
        </div>

        <div className="h-24 w-full flex items-center justify-center">
          <WaveVisualizer isRecording={isRecording} />
        </div>

        <div className="mt-8">
          {isRecording ? (
            <button 
              onClick={handleStopRecording}
              className="w-20 h-20 bg-rose-500 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(244,63,94,0.4)] hover:scale-105 transition-transform"
            >
              <Square size={32} fill="currentColor" />
            </button>
          ) : (
            <button 
              onClick={handleStartRecording}
              className="w-20 h-20 bg-indigo-500 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(99,102,241,0.4)] hover:scale-105 transition-transform"
            >
              <Mic size={32} />
            </button>
          )}
        </div>
        
        <p className="text-slate-500 text-sm max-w-xs text-center px-8">
          {isRecording ? "Tap stop to analyze audio." : "Tap the microphone to start recording a voicemail."}
        </p>
      </div>
    </div>
  );

  const renderDetail = () => {
    const vm = voicemails.find(v => v.id === selectedVoicemailId);
    if (!vm) return null;
    const isCurrentPlaying = selectedVoicemailId === vm.id && isPlaying;

    return (
      <div className="flex flex-col h-full bg-white">
        <header className="px-4 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <button onClick={() => setView(ViewState.INBOX)} className="p-2 -ml-2 hover:bg-slate-50 rounded-full">
            <ChevronLeft size={24} className="text-slate-600" />
          </button>
          <div className="flex gap-2">
             <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full">
               <Archive size={20} />
             </button>
             <button 
              onClick={() => deleteVoicemail(vm.id)}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full"
            >
               <Trash2 size={20} />
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="p-6 pb-4">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">{vm.sender}</h1>
            <p className="text-slate-500">{new Date(vm.timestamp).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: 'numeric' })}</p>
          </div>

          {vm.audioUrl && (
            <div className="mx-6 bg-slate-50 rounded-2xl p-4 flex items-center gap-4 border border-slate-100">
                <button 
                onClick={() => handlePlayPause(vm)}
                className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-md hover:bg-indigo-700 transition-colors flex-shrink-0"
                >
                {isCurrentPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
                <div className="flex-1">
                <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className={`h-full bg-indigo-500 w-0 transition-all duration-300 ${isCurrentPlaying ? 'animate-[width_linear]' : ''}`} style={{ width: isCurrentPlaying ? '100%' : '0%' }}></div>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-xs text-slate-400">0:00</span>
                    <span className="text-xs text-slate-400">{formatTime(vm.duration)}</span>
                </div>
                </div>
            </div>
          )}
          {!vm.audioUrl && (
              <div className="mx-6 p-4 bg-slate-50 text-slate-400 text-sm rounded-xl text-center italic">
                  No audio recording available for this session.
              </div>
          )}

          <div className="p-6 space-y-6">
            {vm.status === ProcessingStatus.PROCESSING && (
               <div className="flex flex-col items-center justify-center py-12 text-indigo-600">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
                 <p className="font-medium">Transcribing & Analyzing...</p>
               </div>
            )}

            {vm.status === ProcessingStatus.FAILED && (
              <div className="bg-rose-50 p-4 rounded-lg text-rose-700 flex items-center gap-3">
                <AlertCircle size={20} />
                <p>Analysis failed. Please try again.</p>
              </div>
            )}

            {vm.status === ProcessingStatus.COMPLETED && vm.analysis && (
              <>
                <section>
                   <div className="flex items-center gap-2 mb-3">
                     <Sparkles size={18} className="text-indigo-500" />
                     <h2 className="font-semibold text-slate-800">AI Summary</h2>
                   </div>
                   <div className="bg-indigo-50/50 p-4 rounded-xl text-slate-700 text-sm leading-relaxed border border-indigo-100">
                     {vm.analysis.summary}
                   </div>
                </section>

                {vm.analysis.actions.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <ListTodo size={18} className="text-emerald-500" />
                      <h2 className="font-semibold text-slate-800">Action Items</h2>
                    </div>
                    <ul className="space-y-2">
                      {vm.analysis.actions.map((action, i) => (
                        <li key={i} className="flex items-start gap-3 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                          <div className="mt-0.5 text-emerald-500">
                            <CheckCircle2 size={16} />
                          </div>
                          <span className="text-sm text-slate-700">{action}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={18} className="text-slate-400" />
                    <h2 className="font-semibold text-slate-800">Transcript</h2>
                  </div>
                  <div className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap pl-1">
                    {vm.analysis.transcript}
                  </div>
                </section>
                
                <div className="pt-4 flex gap-3">
                   <button className="flex-1 bg-slate-900 text-white py-3 rounded-xl text-sm font-medium shadow-lg hover:bg-slate-800 transition-colors">
                     Reply
                   </button>
                   <button className="flex-1 bg-white border border-slate-200 text-slate-700 py-3 rounded-xl text-sm font-medium shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
                     <Share2 size={16} /> Share
                   </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => (
     <div className="flex flex-col h-full bg-slate-50">
       <header className="bg-white px-6 py-4 border-b border-slate-200 flex items-center gap-4 sticky top-0">
         <button onClick={() => setView(ViewState.INBOX)}>
           <ChevronLeft className="text-slate-600" />
         </button>
         <h1 className="text-xl font-bold text-slate-800">Settings</h1>
       </header>
       <div className="p-6 space-y-6 overflow-y-auto no-scrollbar">
         
         {/* Assistant Config */}
         <div className="bg-white rounded-xl p-4 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-500"/> Assistant Configuration
            </h3>
            
            <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Assistant Name</label>
                <input 
                    type="text" 
                    value={settings.assistantName}
                    onChange={(e) => setSettings({...settings, assistantName: e.target.value})}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
            </div>

            <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Your Name (Owner)</label>
                <input 
                    type="text" 
                    value={settings.ownerName}
                    onChange={(e) => setSettings({...settings, ownerName: e.target.value})}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
            </div>

            <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">AI Voice</label>
                <select 
                    value={settings.voiceName}
                    onChange={(e) => setSettings({...settings, voiceName: e.target.value})}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                >
                    {['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map(v => (
                        <option key={v} value={v}>{v}</option>
                    ))}
                </select>
            </div>

            <div className="flex items-center justify-between py-2">
               <span className="text-slate-600 text-sm">Rings before pickup</span>
               <div className="flex items-center gap-3">
                   <button 
                    className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center"
                    onClick={() => setSettings(s => ({...s, ringsBeforePickup: Math.max(1, s.ringsBeforePickup - 1)}))}
                   >-</button>
                   <span className="text-sm font-medium w-4 text-center">{settings.ringsBeforePickup}</span>
                   <button 
                    className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center"
                    onClick={() => setSettings(s => ({...s, ringsBeforePickup: Math.min(10, s.ringsBeforePickup + 1)}))}
                   >+</button>
               </div>
            </div>
         </div>
         
         <div className="bg-white rounded-xl p-4 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800">Account</h3>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
               <span className="text-slate-600">Email</span>
               <span className="text-slate-400">demo@voicemate.ai</span>
            </div>
            <div className="flex items-center justify-between py-2">
               <span className="text-slate-600">Plan</span>
               <span className="text-indigo-600 font-medium">Pro</span>
            </div>
         </div>

         <div className="text-center mt-8">
           <p className="text-xs text-slate-400">VoiceMate AI v1.1.0</p>
         </div>
       </div>
     </div>
  );

  // Main Router Switch
  return (
    <div className="max-w-md mx-auto h-screen bg-white shadow-2xl overflow-hidden relative font-sans">
      {!process.env.API_KEY && (
        <div className="absolute top-0 left-0 right-0 bg-rose-500 text-white text-xs p-2 text-center z-50">
          Demo Mode: API Key missing. Mock data only.
        </div>
      )}
      
      {view === ViewState.INBOX && renderInbox()}
      {view === ViewState.RECORD && renderRecord()}
      {view === ViewState.DETAIL && renderDetail()}
      {view === ViewState.SETTINGS && renderSettings()}
      {view === ViewState.CALL_SIMULATION && (
          <LiveCallSession 
            settings={settings}
            onComplete={handleCallComplete}
            onCancel={() => setView(ViewState.INBOX)}
          />
      )}
    </div>
  );
};

export default App;
