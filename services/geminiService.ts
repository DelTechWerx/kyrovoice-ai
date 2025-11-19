import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AnalysisResult } from '../types';

// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove the Data-URI prefix (e.g. "data:audio/webm;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const ANALYSIS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    transcript: {
      type: Type.STRING,
      description: "Verbatim transcription of the voicemail or conversation.",
    },
    summary: {
      type: Type.STRING,
      description: "A concise 1-2 sentence summary of the voicemail content.",
    },
    actions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of specific actionable tasks derived from the message.",
    },
    priority: {
      type: Type.STRING,
      enum: ["Low", "Medium", "High"],
      description: "The urgency of the message.",
    },
  },
  required: ["transcript", "summary", "actions", "priority"],
};

const SYSTEM_INSTRUCTION = `
  You are an expert executive assistant. 
  1. Transcribe the audio accurately (if audio provided) or use the provided transcript.
  2. Summarize the intent.
  3. Extract action items.
  4. Determine priority.
  Return the response in JSON format matching the schema.
`;

export const analyzeVoicemail = async (audioBlob: Blob): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = await blobToBase64(audioBlob);
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audioBlob.type || 'audio/webm',
              data: base64Data,
            },
          },
          { text: SYSTEM_INSTRUCTION }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
        temperature: 0.2, 
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text) as AnalysisResult;

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const analyzeTranscript = async (transcript: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: `Transcript to analyze:\n${transcript}\n\n${SYSTEM_INSTRUCTION}` }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    // The model might rewrite the transcript property. We want to ensure the full original transcript is preserved 
    // if the model truncates it, but usually for analysis we trust the model's output.
    // However, let's default to the passed transcript if the model returns empty.
    const result = JSON.parse(text) as AnalysisResult;
    if (!result.transcript || result.transcript.length < transcript.length) {
        result.transcript = transcript;
    }
    return result;

  } catch (error) {
    console.error("Gemini Transcript Analysis Error:", error);
    throw error;
  }
};
