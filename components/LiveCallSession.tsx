import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob } from '@google/genai';
import { Phone, PhoneOff, Mic, User } from 'lucide-react';
import { AssistantSettings } from '../types';
import { WaveVisualizer } from './WaveVisualizer';

interface LiveCallSessionProps {
  settings: AssistantSettings;
  onComplete: (transcript: string, audioBlob: Blob | null) => void;
  onCancel: () => void;
}

export const LiveCallSession: React.FC<LiveCallSessionProps> = ({ settings, onComplete, onCancel }) => {
  const [status, setStatus] = useState<'RINGING' | 'CONNECTING' | 'ACTIVE' | 'ENDING'>('RINGING');
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState<string>('');
  
  // Audio Context & Processing Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const inputChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Playback scheduling
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    // 1. Initialize Audio Contexts immediately on mount to capture user gesture eligibility.
    // Input: Try to force 16kHz for Gemini compatibility.
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    
    // Output: Use system default rate (usually 44.1k or 48k) to ensure compatibility. 
    // We will tell the buffer it's 24k later, and Web Audio handles the resampling automatically.
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    inputAudioContextRef.current = inputCtx;
    outputAudioContextRef.current = outputCtx;

    // 2. Start Ringing Timer
    const ringTime = settings.ringsBeforePickup * 1000; // approx 1s per ring
    const ringTimer = setTimeout(() => {
      startCallSession();
    }, ringTime);

    return () => {
      clearTimeout(ringTimer);
      cleanup(); // Ensure cleanup on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let interval: number;
    if (status === 'ACTIVE') {
      interval = window.setInterval(() => setDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  const startCallSession = async () => {
    setStatus('CONNECTING');
    try {
      if (!process.env.API_KEY) throw new Error("No API Key");
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Use initialized contexts
      const inputCtx = inputAudioContextRef.current;
      const outputCtx = outputAudioContextRef.current;

      if (!inputCtx || !outputCtx) throw new Error("Audio Contexts not initialized");

      // Resume if suspended (browser policy fix)
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      if (inputCtx.state === 'suspended') await inputCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Start recording user audio for the "Voicemail" blob (local recording)
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      inputChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if(e.data.size > 0) inputChunksRef.current.push(e.data);
      };
      mediaRecorder.start();

      const systemInstruction = `
        You are ${settings.assistantName}, an intelligent executive assistant answering a phone call on behalf of ${settings.ownerName}.
        
        Protocol:
        1. Greet the caller politely. State your name and that you are ${settings.ownerName}'s assistant.
        2. Inform them that ${settings.ownerName} is currently unavailable.
        3. Ask for their name and the reason for their call.
        4. Engage in a brief conversation to clarify any details if necessary.
        5. Assure them you will pass the message along.
        6. Keep responses concise and conversational. Do not simulate a phone hangup sound.
      `;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName } },
          },
          // Enabled without specific model parameters
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus('ACTIVE');
            
            // Audio Pipeline: Mic -> ScriptProcessor -> Live API
            const source = inputCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            
            // Buffer size 4096 provides a balance between latency and stability
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              playAudioChunk(audioData, outputCtx);
            }

            // Handle Transcriptions
            if (msg.serverContent?.inputTranscription?.text) {
                setTranscript(prev => prev + "Caller: " + msg.serverContent!.inputTranscription!.text + "\n");
            }
            if (msg.serverContent?.outputTranscription?.text) {
                setTranscript(prev => prev + "Assistant: " + msg.serverContent!.outputTranscription!.text + "\n");
            }
          },
          onclose: () => {
            console.log("Live session closed");
            finishCall();
          },
          onerror: (err) => {
            console.error("Live session error", err);
            finishCall();
          }
        }
      });

    } catch (error) {
      console.error("Failed to start call", error);
      alert("Could not start audio session. Please ensure Microphone permissions are granted.");
      onCancel();
    }
  };

  const playAudioChunk = async (base64Audio: string, ctx: AudioContext) => {
    try {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      
      const int16Data = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }
      
      // Create buffer at 24kHz (Gemini Native output rate)
      // The AudioContext (which might be 48kHz) handles resampling automatically.
      const buffer = ctx.createBuffer(1, float32Data.length, 24000);
      buffer.copyToChannel(float32Data, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      const now = ctx.currentTime;
      // Ensure we schedule after the previous chunk finishes to avoid overlap
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;
      
      sourcesRef.current.add(source);
      source.onended = () => sourcesRef.current.delete(source);

    } catch (e) {
      console.error("Audio decode error", e);
    }
  };

  const createPcmBlob = (data: Float32Array): GenAIBlob => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    
    let binary = '';
    const bytes = new Uint8Array(int16.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    
    return {
      data: base64,
      mimeType: 'audio/pcm;rate=16000'
    };
  };

  const finishCall = () => {
    if (status === 'ENDING') return;
    setStatus('ENDING');

    // Stop Recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        // Wait a tick for onstop to fire and gather last blob
        setTimeout(() => {
            const blob = inputChunksRef.current.length > 0 
                ? new Blob(inputChunksRef.current, { type: 'audio/webm' }) 
                : null;
            
            cleanup();
            onComplete(transcript, blob);
        }, 200);
    } else {
        cleanup();
        onComplete(transcript, null);
    }
  };

  const cleanup = () => {
    // Disconnect Audio Nodes
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
    }
    if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
    }

    // Stop Tracks
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
    }

    // Close Contexts safely
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close().catch(() => {});
        inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close().catch(() => {});
        outputAudioContextRef.current = null;
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // --- Render ---

  if (status === 'RINGING') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-900 text-white animate-in fade-in duration-500">
        <div className="w-32 h-32 bg-indigo-600 rounded-full flex items-center justify-center mb-8 animate-pulse shadow-[0_0_50px_rgba(79,70,229,0.5)]">
           <Phone size={48} fill="currentColor" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">Incoming Call...</h2>
        <p className="text-slate-400">Unknown Caller</p>
        <div className="mt-12 text-sm text-slate-500 bg-slate-800/50 px-4 py-2 rounded-full">
           Wait for assistant to pickup ({settings.ringsBeforePickup}s)
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 text-white">
      {/* Header */}
      <div className="p-6 flex justify-between items-start">
        <div className="flex gap-3 items-center">
            <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center">
                <User size={20} />
            </div>
            <div>
                <h3 className="font-semibold">Simulated Caller</h3>
                <p className="text-xs text-indigo-300">Connected via Gemini Live</p>
            </div>
        </div>
        <div className="px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-mono flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
             REC
        </div>
      </div>

      {/* Main Visualization */}
      <div className="flex-1 flex flex-col items-center justify-center space-y-12">
         <div className="text-center space-y-2">
            <p className="text-slate-400 text-sm uppercase tracking-widest font-medium">Call in Progress</p>
            <h1 className="text-5xl font-light tracking-tighter font-mono">{formatTime(duration)}</h1>
         </div>

         <div className="w-full px-12 h-32 flex items-center justify-center">
             <WaveVisualizer isRecording={true} />
         </div>

         <div className="text-center max-w-xs">
            <p className="text-indigo-300 text-sm font-medium mb-2">Assistant Active</p>
            <p className="text-slate-500 text-xs leading-relaxed">
                {settings.assistantName} is speaking with the caller. Speak into your mic to act as the caller.
            </p>
         </div>
      </div>

      {/* Controls */}
      <div className="p-8 pb-12 flex justify-center">
         <button 
           onClick={() => finishCall()}
           className="w-20 h-20 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-all transform hover:scale-105 active:scale-95"
         >
            <PhoneOff size={32} fill="currentColor" />
         </button>
      </div>
    </div>
  );
};
