export enum ViewState {
  INBOX = 'INBOX',
  RECORD = 'RECORD',
  DETAIL = 'DETAIL',
  SETTINGS = 'SETTINGS',
  CALL_SIMULATION = 'CALL_SIMULATION',
}

export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface AnalysisResult {
  transcript: string;
  summary: string;
  actions: string[];
  priority: 'Low' | 'Medium' | 'High';
}

export interface Voicemail {
  id: string;
  sender: string;
  timestamp: number;
  duration: number; // in seconds
  audioBlob?: Blob; // In-memory blob for new recordings
  audioUrl?: string; // URL for playback
  status: ProcessingStatus;
  analysis?: AnalysisResult;
  isRead: boolean;
}

export interface AssistantSettings {
  assistantName: string;
  ownerName: string;
  voiceName: string;
  ringsBeforePickup: number;
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  assistantName: "Athena",
  ownerName: "the user",
  voiceName: "Kore",
  ringsBeforePickup: 3,
};
