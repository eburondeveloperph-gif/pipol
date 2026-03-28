import { GoogleGenAI, ThinkingLevel, Modality } from "@google/genai";
import { MASTER_PANEL_PROMPT } from "./prompts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function* generatePanelDiscussion(
  topic: string, 
  agents: any[], 
  options: {
    platformTarget?: string;
    requiredFeatures?: string[];
    userPreferences?: string;
    systemInstruction?: string;
  } = {},
  signal?: AbortSignal,
  ollamaUrl: string = 'http://localhost:11434',
  ollamaModel: string = 'gemma'
) {
  const runtimeInstruction = `
PROJECT_REQUEST:
${topic}

USER_PREFERENCES:
${options.userPreferences || 'The first phase must feel like a real internal panel discussion with 5 agents and a manager. It must feel human, realistic, and technically grounded. CRITICAL: You MUST use natural human-like conversational elements. Include occasional reaction tags (e.g., [pauses], [sighs], [a little annoyed]), simulate partial overlaps (e.g., [cuts in]), and ensure agents do NOT agree instantly. Use conversational fillers like "um", "uh", "look", "actually". Make the panel feel highly dynamic, slightly messy like a real meeting, and realistic.'}

PLATFORM_TARGET:
${options.platformTarget || 'Web app'}

REQUIRED_FEATURES:
${(options.requiredFeatures || [
  'internal multi-agent panel discussion',
  'manager-led convergence',
  'brief summary',
  'detailed todo list',
  'approval gate',
  'eventual end-to-end production workflow'
]).map(f => `- ${f}`).join('\n')}

OUTPUT_REQUIREMENT:
Simulate a realistic 5-10 minutes internal panel meeting, then present the final structured plan.
`;

  // Since the panel discussion is generated via a single monolithic prompt,
  // we use the Manager's provider to determine the engine for the entire discussion.
  const manager = agents.find(a => a.role === 'Manager' || a.id === 0);
  const useOllama = manager?.provider === 'Local (Ollama)';

  if (useOllama) {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: (options.systemInstruction || MASTER_PANEL_PROMPT) + '\n\n' + runtimeInstruction,
        stream: true
      }),
      signal
    });

    if (!response.body) throw new Error('No response body from Ollama');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              yield json.response;
            }
          } catch (e) {
            console.error("Error parsing Ollama response:", e);
          }
        }
      }
    }
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.response) {
          yield json.response;
        }
      } catch (e) {}
    }
  } else {
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3.1-pro-preview",
      contents: runtimeInstruction,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction: options.systemInstruction || MASTER_PANEL_PROMPT,
      }
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }
}

export async function generateTTS(text: string, voiceName: string = 'Kore') {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        systemInstruction: "You are a highly expressive voice actor. Speak naturally, with human-like prosody, emotion, and pacing. If the text includes reaction tags like [pauses], [sighs], [laughs], or [clears throat], perform those actions naturally instead of reading the words literally. Maintain the specific persona of the character you are voicing.",
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    }
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
