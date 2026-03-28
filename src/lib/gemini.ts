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
    discussionId?: string;
  } = {},
  signal?: AbortSignal,
  ollamaUrl: string = 'http://localhost:11434',
  ollamaModel: string = 'gemma'
) {
  const discussionId = options.discussionId || `disc-${Date.now()}`;
  
  const manager = agents.find(a => a.role === 'Manager' || a.id === 0);
  const specialists = agents.filter(a => a.role !== 'Manager' && a.id !== 0);

  // 1. Yield Manager's name immediately for instant feedback
  yield `[${manager.name}]: `;

  // 2. Initialize/Load Shared Memory from "DB"
  let memoryBoard: MemoryBoard;
  try {
    const res = await fetch(`/api/memory/${discussionId}`);
    memoryBoard = await res.json();
    if (!memoryBoard.facts.length) {
      memoryBoard.facts = [`Project Topic: ${topic}`];
    }
  } catch (e) {
    memoryBoard = {
      facts: [`Project Topic: ${topic}`],
      assumptions: [],
      conflicts: [],
      decisions: [],
      openQuestions: []
    };
  }

  const conversationHistory: { role: string, content: string }[] = [];

  // 3. Manager Opens the Meeting
  yield* runAgentTurn(manager, `Open the meeting for the topic: "${topic}". Frame the project and set the initial direction.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel, false, true);

  // Update memory board from manager's opening
  const managerOpening = conversationHistory[conversationHistory.length - 1].content;
  const managerUpdates = await extractMemoryUpdates(manager.name, manager.role, managerOpening, memoryBoard);
  updateMemoryBoard(memoryBoard, managerUpdates);
  yield `MEMORY_UPDATE:${JSON.stringify(memoryBoard)}`;
  await saveMemory(discussionId, memoryBoard);

  // 3. Discussion Loop (Sequential turns)
  for (const agent of specialists) {
    if (signal?.aborted) break;
    yield* runAgentTurn(agent, `Contribute to the discussion about "${topic}" from your perspective as ${agent.role}. React to what others have said.`, conversationHistory, memoryBoard, agents, options, signal, ollamaUrl, ollamaModel);
    
    // Update memory board from specialist's turn
    const agentResponse = conversationHistory[conversationHistory.length - 1].content;
    const agentUpdates = await extractMemoryUpdates(agent.name, agent.role, agentResponse, memoryBoard);
    updateMemoryBoard(memoryBoard, agentUpdates);
    yield `MEMORY_UPDATE:${JSON.stringify(memoryBoard)}`;
    await saveMemory(discussionId, memoryBoard);
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
      model: agent.model || "gemini-3.1-pro-preview",
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
