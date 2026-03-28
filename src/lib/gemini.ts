import { GoogleGenAI, ThinkingLevel, Modality } from "@google/genai";
import { MASTER_PANEL_PROMPT } from "./prompts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface MemoryBoard {
  facts: string[];
  assumptions: string[];
  conflicts: string[];
  decisions: string[];
  openQuestions: string[];
}

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
  // 1. Initialize Shared Memory
  const memoryBoard: MemoryBoard = {
    facts: [`Project Topic: ${topic}`],
    assumptions: [],
    conflicts: [],
    decisions: [],
    openQuestions: []
  };

  const conversationHistory: { role: string, content: string }[] = [];

  const manager = agents.find(a => a.role === 'Manager' || a.id === 0);
  const specialists = agents.filter(a => a.role !== 'Manager' && a.id !== 0);

  // 2. Manager Opens the Meeting
  yield* runAgentTurn(manager, `Open the meeting for the topic: "${topic}". Frame the project and set the initial direction.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel);

  // 3. Discussion Loop (Simplified for now: each specialist speaks once)
  // In a more complex version, the Manager would decide who speaks next.
  for (const agent of specialists) {
    if (signal?.aborted) break;
    yield* runAgentTurn(agent, `Contribute to the discussion about "${topic}" from your perspective as ${agent.role}. React to what others have said.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel);
  }

  // 4. Manager Verdict and Final Plan
  yield* runAgentTurn(manager, `Summarize the discussion, make final decisions, and present the FINAL_PLAN including the Shared Memory Board.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel, true);
}

async function* runAgentTurn(
  agent: any,
  instruction: string,
  history: { role: string, content: string }[],
  memory: MemoryBoard,
  allAgents: any[],
  options: any,
  signal?: AbortSignal,
  ollamaUrl?: string,
  ollamaModel?: string,
  isFinalVerdict: boolean = false
) {
  const memoryContext = `
SHARED MEMORY BOARD:
- FACTS: ${memory.facts.join(', ')}
- ASSUMPTIONS: ${memory.assumptions.join(', ')}
- CONFLICTS: ${memory.conflicts.join(', ')}
- DECISIONS: ${memory.decisions.join(', ')}
- OPEN QUESTIONS: ${memory.openQuestions.join(', ')}
`;

  const agentPersona = `
You are ${agent.name}, the ${agent.role}.
Your personality: ${agent.role === 'Manager' ? 'Leader, decisive, focused on convergence.' : 'Specialist, opinionated, focused on your domain.'}
${options.systemInstruction || MASTER_PANEL_PROMPT}

CURRENT TASK: ${instruction}
${isFinalVerdict ? 'CRITICAL: You must end your response with "### FINAL_PLAN ###" followed by the structured plan and the final Shared Memory Board.' : ''}
`;

  const prompt = `
${memoryContext}
${history.map(h => `[${h.role}]: ${h.content}`).join('\n')}

[SYSTEM]: ${agent.name}, it is your turn. ${instruction}
`;

  let fullResponse = "";

  if (agent.provider === 'Local (Ollama)') {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agent.model || ollamaModel,
        system: agentPersona,
        prompt: prompt,
        stream: true
      }),
      signal
    });

    if (!response.body) throw new Error('No response body from Ollama');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    yield `[${agent.name}]: `;

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
              fullResponse += json.response;
              yield json.response;
            }
          } catch (e) {}
        }
      }
    }
  } else {
    const responseStream = await ai.models.generateContentStream({
      model: agent.model || "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: agentPersona,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      }
    });

    yield `[${agent.name}]: `;
    for await (const chunk of responseStream) {
      if (chunk.text) {
        fullResponse += chunk.text;
        yield chunk.text;
      }
    }
  }

  yield '\n';
  history.push({ role: agent.name, content: fullResponse });
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
