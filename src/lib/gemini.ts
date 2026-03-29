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

export async function generateAgentAvatar(prompt: string, options: { background?: 'white' | 'studio' | 'office' } = {}) {
  try {
    const bgPrompt = options.background === 'white' 
      ? "isolated on a pure, solid, flat white background (#FFFFFF). No shadows, no gradients, no environment, just the person on a clean white backdrop, perfect for background removal to create a transparent look" 
      : options.background === 'office'
      ? "in a modern, slightly blurred professional office environment"
      : "in a professional studio setting with neutral, clean lighting";

    // Prioritize Nano Banana (gemini-3.1-flash-image-preview) as requested
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [{ 
          text: `A highly realistic, professional studio portrait of a unique human ${prompt}. ${bgPrompt}. The person should have distinct facial features, a specific ethnic background, and an intelligent expression matching their role. Photorealistic, 8k resolution, cinematic lighting, sharp focus, detailed skin texture, professional headshot. No text, no logos, no watermarks.` 
        }],
      },
      config: { 
        imageConfig: { 
          aspectRatio: "1:1", 
          imageSize: "1K" 
        } 
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    // Fallback to Imagen if Nano Banana fails
    const imagenResponse = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: `A highly realistic, professional studio portrait of a unique human ${prompt}. ${bgPrompt}. The person should have distinct facial features, a specific ethnic background, and an intelligent expression matching their role. Photorealistic, 8k resolution, cinematic lighting, sharp focus, detailed skin texture, professional headshot. No text, no logos, no watermarks.`,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
        aspectRatio: '1:1',
      },
    });

    if (imagenResponse.generatedImages?.[0]?.image?.imageBytes) {
      return `data:image/png;base64,${imagenResponse.generatedImages[0].image.imageBytes}`;
    }
    
    return null;
  } catch (error) {
    console.error("Avatar Generation Error:", error);
    return null;
  }
}

export async function* generatePanelDiscussion(
  topic: string, 
  agents: any[], 
  options: {
    platformTarget?: string;
    requiredFeatures?: string[];
    userPreferences?: string;
    systemInstruction?: string;
    discussionId?: string;
  } = {},
  signal?: AbortSignal,
  ollamaUrl: string = 'http://localhost:11434',
  ollamaModel: string = 'gemma'
) {
  const discussionId = options.discussionId || `disc-${Date.now()}`;
  
  const manager = agents.find(a => a.role === 'Strategic Overseer' || a.role === 'Manager' || a.id === 0);
  const specialists = agents.filter(a => a.role !== 'Strategic Overseer' && a.role !== 'Manager' && a.id !== 0);

  // 1. Yield Manager's name immediately for instant feedback
  yield `[${manager.name}]: `;

  // 2. Initialize/Load Shared Memory from "DB"
  let memoryBoard: MemoryBoard;
  try {
    const res = await fetch(`/api/memory/${discussionId}`);
    memoryBoard = await res.json();
    if (!memoryBoard.facts.length) {
      memoryBoard.facts = [`Project Topic: ${topic}`, `Client: eburon.ai`];
    }
  } catch (e) {
    memoryBoard = {
      facts: [`Project Topic: ${topic}`, `Client: eburon.ai`],
      assumptions: [],
      conflicts: [],
      decisions: [],
      openQuestions: []
    };
  }

  const conversationHistory: { role: string, content: string }[] = [];

  // 3. Manager Opens the Meeting & Introductions
  yield* runAgentTurn(manager, `Open the meeting for the topic: "${topic}" for client eburon.ai. Introduce yourself as the Strategic Overseer, ask all participants to briefly introduce themselves, and frame the project.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel, false, true);

  // Update memory board from manager's opening
  const managerOpening = conversationHistory[conversationHistory.length - 1].content;
  const managerUpdates = await extractMemoryUpdates(manager.name, manager.role, managerOpening, memoryBoard);
  updateMemoryBoard(memoryBoard, managerUpdates);
  yield `MEMORY_UPDATE:${JSON.stringify(memoryBoard)}`;
  await saveMemory(discussionId, memoryBoard);

  // 3. Dynamic Discussion Loop
  let turnCount = 0;
  const maxTurns = 12;
  let shouldClose = false;

  while (turnCount < maxTurns && !shouldClose) {
    if (signal?.aborted) break;

    // Re-fetch memory board to catch any manual user edits during the discussion
    try {
      const res = await fetch(`/api/memory/${discussionId}`);
      if (res.ok) {
        const latestMemory = await res.json();
        memoryBoard = latestMemory;
      }
    } catch (e) {
      console.error("Failed to re-fetch memory during discussion:", e);
    }

    // Determine next speaker and hand raisers
    const selection = await selectNextSpeaker(conversationHistory, agents, memoryBoard, topic);
    shouldClose = selection.shouldClose;
    
    if (selection.transition && selection.transition !== 'standard') {
      yield `TRANSITION:${selection.transition}`;
    }

    if (selection.handRaisers && selection.handRaisers.length > 0) {
      yield `HANDS_RAISED:${JSON.stringify(selection.handRaisers)}`;
      // Give users a moment to see the "bidding" process
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (shouldClose) break;

    const nextAgent = agents.find(a => a.id === selection.nextAgentId) || specialists[turnCount % specialists.length];
    
    // Lower hands before speaking
    yield `HANDS_LOWERED`;

    yield* runAgentTurn(nextAgent, `Contribute to the discussion about "${topic}" from your perspective as ${nextAgent.role}. React to what others have said.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel);
    
    // Update memory board from specialist's turn
    const agentResponse = conversationHistory[conversationHistory.length - 1].content;
    const agentUpdates = await extractMemoryUpdates(nextAgent.name, nextAgent.role, agentResponse, memoryBoard);
    updateMemoryBoard(memoryBoard, agentUpdates);
    yield `MEMORY_UPDATE:${JSON.stringify(memoryBoard)}`;
    await saveMemory(discussionId, memoryBoard);

    turnCount++;
  }

  // 4. Manager Verdict and Final Plan
  yield* runAgentTurn(manager, `Summarize the discussion, make final decisions, and present the FINAL_PLAN including the Shared Memory Board.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel, true);
  
  // Final memory update
  const finalVerdict = conversationHistory[conversationHistory.length - 1].content;
  const finalUpdates = await extractMemoryUpdates(manager.name, manager.role, finalVerdict, memoryBoard);
  updateMemoryBoard(memoryBoard, finalUpdates);
  yield `MEMORY_UPDATE:${JSON.stringify(memoryBoard)}`;
  await saveMemory(discussionId, memoryBoard);
}

async function extractMemoryUpdates(
  agentName: string,
  agentRole: string,
  content: string,
  currentMemory: MemoryBoard
): Promise<Partial<MemoryBoard>> {
  const prompt = `
You are a memory extraction system. Analyze the following contribution from ${agentName} (${agentRole}) in a panel discussion.
Extract any NEW Facts, Assumptions, Conflicts, Decisions, or Open Questions.

CURRENT MEMORY:
${JSON.stringify(currentMemory, null, 2)}

CONTRIBUTION:
"${content}"

Return ONLY a JSON object with the updates. Do not repeat existing memory.
Example: { "facts": ["New fact"], "decisions": ["New decision"] }
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Memory extraction failed:", e);
    return {};
  }
}

function updateMemoryBoard(board: MemoryBoard, updates: Partial<MemoryBoard>) {
  if (updates.facts) board.facts = [...new Set([...board.facts, ...updates.facts])];
  if (updates.assumptions) board.assumptions = [...new Set([...board.assumptions, ...updates.assumptions])];
  if (updates.conflicts) board.conflicts = [...new Set([...board.conflicts, ...updates.conflicts])];
  if (updates.decisions) board.decisions = [...new Set([...board.decisions, ...updates.decisions])];
  if (updates.openQuestions) board.openQuestions = [...new Set([...board.openQuestions, ...updates.openQuestions])];
}

async function saveMemory(id: string, memory: MemoryBoard) {
  try {
    await fetch(`/api/memory/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory)
    });
  } catch (e) {
    console.error("Failed to save memory to DB:", e);
  }
}

async function selectNextSpeaker(
  conversationHistory: { role: string, content: string }[],
  agents: any[],
  memoryBoard: MemoryBoard,
  topic: string
): Promise<{ nextAgentId: number, handRaisers: number[], shouldClose: boolean, reason: string, transition: 'standard' | 'overlap' | 'interjection' }> {
  const specialists = agents.filter(a => a.role !== 'Strategic Overseer' && a.role !== 'Manager' && a.id !== 0);

  const prompt = `
You are the Strategic Overseer (Master). Based on the conversation history and the current memory board, decide who should speak next in the panel discussion about "${topic}" for client eburon.ai.

SPECIALISTS:
${specialists.map(s => `- ID ${s.id}: ${s.name} (${s.role})`).join('\n')}

RULES:
1. Ensure every specialist introduces themselves briefly at the start.
2. If someone was directly challenged or asked a question, they should likely speak next.
3. If a new topic was raised, the relevant specialist should speak.
4. If the discussion is circling, pick someone who hasn't spoken much.
5. Identify agents who would "raise their hand" (want to interject or build upon the point).
6. If the discussion has reached a natural conclusion or all points are covered, set shouldClose to true.
7. Limit the total turns to around 15-20 for a fast-paced discussion.
8. Ensure every specialist speaks at least once early in the discussion.

9. Decide on the TRANSITION TIMING to make the discussion feel natural:
   - "standard": Wait for the current speaker to fully finish (default).
   - "overlap": Start the next speaker during the final sentence of the current one (use for high agreement, excitement, or building on a point).
   - "interjection": Start the next speaker immediately after a key point is made, potentially cutting off the previous speaker's tail (use for urgency, direct challenge, or strong disagreement).

RESPONSE FORMAT (JSON ONLY):
{
  "nextAgentId": number,
  "handRaisers": number[],
  "reason": "string",
  "shouldClose": boolean,
  "transition": "standard" | "overlap" | "interjection"
}
`;

  try {
    // Truncate history for selection prompt to save tokens and keep context relevant
    const recentHistory = conversationHistory.slice(-5);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { role: 'user', parts: [{ text: prompt + "\n\nRECENT CONVERSATION HISTORY:\n" + recentHistory.map(h => `[${h.role}]: ${h.content.substring(0, 300)}`).join('\n') }] }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const json = JSON.parse(response.text || "{}");
    return {
      nextAgentId: json.nextAgentId || 0,
      handRaisers: json.handRaisers || [],
      reason: json.reason || "Next turn",
      shouldClose: !!json.shouldClose,
      transition: json.transition || 'standard'
    };
  } catch (e) {
    console.error("Speaker selection failed:", e);
    // Fallback: pick the next specialist in order
    const lastSpeakerName = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].role : "";
    const lastSpeaker = agents.find(a => a.name === lastSpeakerName);
    const lastSpeakerId = lastSpeaker ? lastSpeaker.id : -1;
    const nextIndex = (specialists.findIndex(s => s.id === lastSpeakerId) + 1) % specialists.length;
    return {
      nextAgentId: specialists[nextIndex].id,
      handRaisers: [],
      reason: "Fallback",
      shouldClose: conversationHistory.length > 15,
      transition: 'standard'
    };
  }
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
  isFinalVerdict: boolean = false,
  skipTag: boolean = false
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
Your personality: ${(agent.role === 'Strategic Overseer' || agent.role === 'Manager') ? 'Leader, decisive, focused on convergence.' : 'Specialist, opinionated, focused on your domain.'}
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
    
    if (!skipTag) yield `[${agent.name}]: `;

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
      model: agent.model || "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: agentPersona,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      }
    });

    if (!skipTag) yield `[${agent.name}]: `;
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

export async function generateTTS(text: string, voiceName: string = 'Kore', pitch: number = 1.0, retryCount = 0): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;

  // 1. Strip Markdown and common special characters that might confuse TTS
  let cleanText = text
    .replace(/[*_#`~>]/g, '') // Strip markdown symbols
    .replace(/\[.*?\]/g, '')  // Strip bracketed text (like [pauses]) for now to see if it helps stability
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim()
    .slice(0, 800);           // Slightly shorter truncation for safety

  if (cleanText.length === 0) return null;

  // Map pitch value to a descriptive instruction for the model
  let pitchInstruction = "";
  if (pitch > 1.2) pitchInstruction = "high-pitched and energetic";
  else if (pitch > 1.05) pitchInstruction = "slightly higher-pitched";
  else if (pitch < 0.8) pitchInstruction = "deep, low-pitched and authoritative";
  else if (pitch < 0.95) pitchInstruction = "slightly lower-pitched";
  else pitchInstruction = "natural-pitched";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak this ${pitchInstruction}: ${cleanText}` }] }],
      config: {
        // Removing systemInstruction as it might be causing instability in the preview model
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { 
              voiceName: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(voiceName) ? voiceName : 'Zephyr' 
            },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Audio = "";
    let mimeType = "";

    for (const part of parts) {
      if (part.inlineData?.data) {
        base64Audio = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "audio/pcm";
        break;
      }
    }

    if (base64Audio) {
      // Remove any whitespace from base64 string
      const cleanBase64 = base64Audio.replace(/\s/g, '');
      const binary = atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      console.log(`TTS Received: ${bytes.length} bytes, MimeType: ${mimeType}`);

      // If it's raw PCM or explicitly labeled as PCM/WAV without header
      if (mimeType.includes('pcm') || !mimeType || mimeType === 'audio/wav') {
        const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
        if (!isWav) {
          console.log("Adding WAV header to raw PCM data...");
          const blob = addWavHeader(bytes, 24000);
          return URL.createObjectURL(blob);
        }
      }

      const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
      return URL.createObjectURL(blob);
    }
    console.warn("TTS Response contained no audio data parts.");
    return null;
  } catch (error: any) {
    console.error(`TTS Error (Attempt ${retryCount + 1}):`, error);
    
    // Retry up to 2 times with exponential backoff
    if (retryCount < 2) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`Retrying TTS in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return generateTTS(text, voiceName, pitch, retryCount + 1);
    }
    
    return null;
  }
}

/**
 * Adds a WAV header to raw 16-bit PCM data.
 * Gemini TTS returns raw PCM (16-bit, mono, 24kHz).
 */
function addWavHeader(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 for PCM)
  view.setUint16(20, 1, true);
  // channel count (1 for mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  return new Blob([header, pcmData], { type: 'audio/wav' });
}
