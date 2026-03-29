import React, { useState, useRef, useEffect } from 'react';
import { generatePanelDiscussion, generateTTS } from '../lib/gemini';
import { MASTER_PANEL_PROMPT } from '../lib/prompts';
import { Hexagon, SlidersHorizontal, Mic, Send, AudioLines, X, UserPlus, Trash2, Image as ImageIcon, Cpu, User, Star, Volume2, VolumeX, Moon, Sun, PanelLeftClose, PanelLeftOpen, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const dummyImages = [
  "https://freepngimg.com/thumb/man/22654-6-man-thumb.png",       // Suit Man
  "https://freepngimg.com/thumb/woman/13735-4-woman-suit-png-image-thumb.png", // Suit Woman
  "https://freepngimg.com/thumb/man/10-man-png-image-thumb.png",       // Casual Man
  "https://freepngimg.com/thumb/business_woman/1-2-business-woman-png-hd-thumb.png", // Business Woman
  "https://freepngimg.com/thumb/man/33-man-png-image-thumb.png",        // Older Man
  "https://freepngimg.com/thumb/robot/2-2-robot-transparent.png"
];

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255';
};

const defaultAgents = [
  { id: 1, name: "Atlas", role: "Product Strategist", hex: "#ef4444", rgba: "239, 68, 68", img: dummyImages[1], score: 100, voice: "Fenrir", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" },
  { id: 2, name: "Veda", role: "System Architect", hex: "#10b981", rgba: "16, 185, 129", img: dummyImages[2], score: 100, voice: "Kore", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" },
  { id: 3, name: "Echo", role: "Execution Engineer", hex: "#a855f7", rgba: "168, 85, 247", img: dummyImages[3], score: 100, voice: "Charon", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" },
  { id: 4, name: "Nova", role: "UX Specialist", hex: "#f59e0b", rgba: "245, 158, 11", img: dummyImages[4], score: 100, voice: "Puck", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" },
  { id: 5, name: "Cipher", role: "Reality Checker", hex: "#06b6d4", rgba: "6, 182, 212", img: dummyImages[5], score: 100, voice: "Fenrir", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" },
  { id: 0, name: "Nexus", role: "Administrator", hex: "#3b82f6", rgba: "59, 130, 246", img: dummyImages[0], score: 100, voice: "Zephyr", provider: "Cloud (Gemini)", model: "gemini-3.1-pro-preview" }
];

interface Message {
  id: string;
  sender: string;
  text: string;
  type: 'system-msg' | 'agent-message' | 'user-message';
  colorHex?: string;
  isFinalPlan?: boolean;
}

export default function Panel() {
  const [agents, setAgents] = useState(defaultAgents);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      sender: 'System',
      text: '<b>System Initialized.</b><br>Awaiting Commander\'s initial prompt/task. Use the text box or microphone to begin.',
      type: 'system-msg'
    }
  ]);

  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(MASTER_PANEL_PROMPT);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [currentStreamingText, setCurrentStreamingText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showMemoryBoard, setShowMemoryBoard] = useState(false);
  const [memoryBoardContent, setMemoryBoardContent] = useState('');
  const [activeEditIndex, setActiveEditIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('gemma');
  const [playingAgentName, setPlayingAgentName] = useState<string | null>(null);
  
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef('');
  const initialInputRef = useRef('');
  const audioQueueRef = useRef<{ text: string, voice: string, agentName: string }[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const processAudioQueue = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    const item = audioQueueRef.current.shift();
    if (!item) {
      isPlayingRef.current = false;
      return;
    }

    setPlayingAgentName(item.agentName);
    
    try {
      const url = await generateTTS(item.text, item.voice);
      if (url) {
        const audio = new Audio(url);
        audio.muted = isMuted;
        currentAudioRef.current = audio;
        audio.onended = () => {
          setPlayingAgentName(null);
          isPlayingRef.current = false;
          currentAudioRef.current = null;
          if (audioQueueRef.current.length === 0 && isHandsFree) {
            setTimeout(() => toggleMic(), 500);
          } else {
            processAudioQueue();
          }
        };
        audio.onerror = () => {
          setPlayingAgentName(null);
          isPlayingRef.current = false;
          currentAudioRef.current = null;
          if (audioQueueRef.current.length === 0 && isHandsFree) {
            setTimeout(() => toggleMic(), 500);
          } else {
            processAudioQueue();
          }
        };
        await audio.play();
      } else {
        setPlayingAgentName(null);
        isPlayingRef.current = false;
        processAudioQueue();
      }
    } catch (e) {
      setPlayingAgentName(null);
      isPlayingRef.current = false;
      processAudioQueue();
    }
  };

  const enqueueAudio = (text: string, voice: string, agentName: string) => {
    audioQueueRef.current.push({ text, voice, agentName });
    processAudioQueue();
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [messages, currentStreamingText]);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRec();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let text = '';
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
        }
        setInput((initialInputRef.current ? initialInputRef.current + ' ' : '') + text);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
        if (isHandsFree && inputRef.current.trim()) {
          handleSend(inputRef.current);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
      };
    }
  }, []);

  const formatMessageText = (text: string) => {
    if (!text) return '';
    return text.replace(/\[([a-zA-Z0-9\s\-,.]+)\](?!\()/g, '<span class="reaction-tag" style="opacity: 0.7; font-style: italic; font-size: 0.9em;">[$1]</span>');
  };

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Speech Recognition API is not supported in this browser.");
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      initialInputRef.current = input;
      recognitionRef.current.continuous = !isHandsFree;
      recognitionRef.current.start();
      setIsRecording(true);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const userMsg = (overrideInput || input).trim();
    if (!userMsg || isProcessing) return;

    setInput('');
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'Commander',
      text: userMsg,
      type: 'user-message'
    }]);

    setIsProcessing(true);
    setIsInitializing(true);
    const manager = agents.find(a => a.role === 'Manager' || a.role === 'Administrator' || a.id === 0);
    setActiveAgentName(manager?.name || null);
    setCurrentStreamingText('');
    setMemoryBoardContent('');

    audioQueueRef.current = [];
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setPlayingAgentName(null);
    isPlayingRef.current = false;

    abortControllerRef.current = new AbortController();

    try {
      let buffer = "";
      let isFinalPlanMode = false;
      let currentFinalPlan = "";
      let currentSpeaker = "";
      let currentMessageText = "";

      let sentenceBuffer = "";
      const sentenceEndRegex = /[.!?](\s|$)/;

      for await (const chunk of generatePanelDiscussion(userMsg, agents, { systemInstruction: systemPrompt, discussionId: `disc-${Date.now()}` }, abortControllerRef.current.signal, ollamaUrl, ollamaModel)) {
        setIsInitializing(false);
        if (abortControllerRef.current.signal.aborted) {
          break;
        }

        // Handle Real-time Memory Updates
        if (chunk.startsWith('MEMORY_UPDATE:')) {
          try {
            const memoryData = JSON.parse(chunk.replace('MEMORY_UPDATE:', ''));
            const formattedMemory = `
### FACTS
${memoryData.facts.map((f: string) => `- ${f}`).join('\n')}

### ASSUMPTIONS
${memoryData.assumptions.map((a: string) => `- ${a}`).join('\n')}

### CONFLICTS
${memoryData.conflicts.map((c: string) => `- ${c}`).join('\n')}

### DECISIONS
${memoryData.decisions.map((d: string) => `- ${d}`).join('\n')}

### OPEN QUESTIONS
${memoryData.openQuestions.map((q: string) => `- ${q}`).join('\n')}
            `;
            setMemoryBoardContent(formattedMemory);
            continue;
          } catch (e) {
            console.error("Failed to parse memory update:", e);
          }
        }

        buffer += chunk;
        
        // Immediate Speaker Detection (handle partial lines)
        if (!isFinalPlanMode) {
          const agentNames = agents.map(a => a.name).join('|');
          const speakerRegex = new RegExp(`^(?:\\*\\*|)?\\[(${agentNames})\\](?:\\*\\*|)?(?:\\s*\\[.*?\\])*:\\s*(.*)`, 'i');
          
          // Check if the buffer itself starts a new speaker
          const bufferMatch = buffer.match(speakerRegex);
          if (bufferMatch && !currentSpeaker) {
            currentSpeaker = bufferMatch[1].trim();
            setActiveAgentName(currentSpeaker);
          }
        }

        // Parallel TTS: Extract sentences from the current speaker's text
        if (!isFinalPlanMode && currentSpeaker) {
          sentenceBuffer += chunk;
          const parts = sentenceBuffer.split(sentenceEndRegex);
          if (parts.length > 1) {
            // The last part is the remaining incomplete sentence
            sentenceBuffer = parts.pop() || "";
            // The rest are complete sentences
            for (const sentence of parts) {
              if (sentence.trim().length > 5) {
                const agent = agents.find(a => a.name === currentSpeaker);
                if (agent) enqueueAudio(sentence.trim(), agent.voice, agent.name);
              }
            }
          }
        }

        let lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === '### FINAL_PLAN ###') {
            isFinalPlanMode = true;
            if (currentSpeaker && currentMessageText) {
              commitMessage(currentSpeaker, currentMessageText);
            }
            currentSpeaker = "";
            currentMessageText = "";
            setCurrentStreamingText('');
            setActiveAgentName(null);
            continue;
          }

          if (isFinalPlanMode) {
            currentFinalPlan += line + '\n';
            
            // Extract Memory Board
            const memoryBoardMatch = currentFinalPlan.match(/SECTION 6 — SHARED MEMORY BOARD\n([\s\S]*)/i);
            if (memoryBoardMatch) {
              setMemoryBoardContent(memoryBoardMatch[1]);
              const planWithoutMemory = currentFinalPlan.replace(/SECTION 6 — SHARED MEMORY BOARD\n[\s\S]*/i, '');
              updateFinalPlanMessage(planWithoutMemory);
            } else {
              updateFinalPlanMessage(currentFinalPlan);
            }
          } else {
          const agentNames = agents.map(a => a.name).join('|');
          const speakerRegex = new RegExp(`^(?:\\*\\*|)?\\[(${agentNames})\\](?:\\*\\*|)?(?:\\s*\\[.*?\\])*:\\s*(.*)`, 'i');
          const match = line.match(speakerRegex);
          if (match) {
            if (currentSpeaker && currentMessageText) {
              // Enqueue leftover sentence buffer before switching speakers
              if (sentenceBuffer.trim().length > 0) {
                const agent = agents.find(a => a.name === currentSpeaker);
                if (agent) enqueueAudio(sentenceBuffer.trim(), agent.voice, agent.name);
                sentenceBuffer = "";
              }
              commitMessage(currentSpeaker, currentMessageText, true);
            }
            currentSpeaker = match[1].trim();
            currentMessageText = match[2] + '\n';
            sentenceBuffer = match[2]; // Initialize sentence buffer with the first part of the message
            setActiveAgentName(currentSpeaker);
            setCurrentStreamingText(currentMessageText);
            
            // Clear initializing state as soon as we have a speaker
            setIsInitializing(false);
          } else if (currentSpeaker) {
              currentMessageText += line + '\n';
              setCurrentStreamingText(currentMessageText);
            }
          }
        }
      }

      if (buffer.trim()) {
        if (isFinalPlanMode) {
          currentFinalPlan += buffer;
          const memoryBoardMatch = currentFinalPlan.match(/SECTION 6 — SHARED MEMORY BOARD\n([\s\S]*)/i);
          if (memoryBoardMatch) {
            setMemoryBoardContent(memoryBoardMatch[1]);
            const planWithoutMemory = currentFinalPlan.replace(/SECTION 6 — SHARED MEMORY BOARD\n[\s\S]*/i, '');
            updateFinalPlanMessage(planWithoutMemory);
          } else {
            updateFinalPlanMessage(currentFinalPlan);
          }
        } else if (currentSpeaker) {
          currentMessageText += buffer;
          // Enqueue leftover sentence buffer
          if (sentenceBuffer.trim().length > 0) {
            const agent = agents.find(a => a.name === currentSpeaker);
            if (agent) enqueueAudio(sentenceBuffer.trim(), agent.voice, agent.name);
            sentenceBuffer = "";
          }
          commitMessage(currentSpeaker, currentMessageText, true);
        }
      } else if (currentSpeaker && currentMessageText) {
         // Enqueue leftover sentence buffer
         if (sentenceBuffer.trim().length > 0) {
           const agent = agents.find(a => a.name === currentSpeaker);
           if (agent) enqueueAudio(sentenceBuffer.trim(), agent.voice, agent.name);
           sentenceBuffer = "";
         }
         commitMessage(currentSpeaker, currentMessageText, true);
      }

    } catch (error) {
      console.error("Error generating discussion:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'System',
        text: 'Error generating discussion. Please try again.',
        type: 'system-msg'
      }]);
    } finally {
      setIsProcessing(false);
      setIsInitializing(false);
      setActiveAgentName(null);
      setCurrentStreamingText('');
    }
  };

  const commitMessage = (speaker: string, text: string, skipAudio: boolean = false) => {
    const agent = agents.find(a => a.role === speaker || a.name === speaker);
    setMessages(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      sender: speaker,
      text: text.trim(),
      type: 'agent-message',
      colorHex: agent?.hex || '#ffffff'
    }]);
    
    if (agent && !skipAudio) {
      enqueueAudio(text.trim(), agent.voice, agent.name);
    }
  };

  const updateFinalPlanMessage = (text: string) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.isFinalPlan) {
        return [...prev.slice(0, -1), { ...lastMsg, text }];
      } else {
        return [...prev, {
          id: 'final-plan-' + Date.now(),
          sender: 'System',
          text,
          type: 'system-msg',
          isFinalPlan: true
        }];
      }
    });
  };

  const handleInterrupt = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    audioQueueRef.current = [];
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setPlayingAgentName(null);
    isPlayingRef.current = false;

    setIsProcessing(false);
    setIsInitializing(false);
    setActiveAgentName(null);
    setCurrentStreamingText('');
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'System',
      text: 'Discussion interrupted by Commander.',
      type: 'system-msg'
    }]);
  };

  const rewardAgent = (idx: number) => {
    const newAgents = [...agents];
    newAgents[idx].score += 20;
    setAgents(newAgents);
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'System',
      text: `Positive reinforcement: +20 Power to <b style="color:${newAgents[idx].hex}">${newAgents[idx].name}</b>.`,
      type: 'system-msg'
    }]);
  };

  const playTTS = async (text: string, voiceName: string = 'Kore') => {
    const url = await generateTTS(text, voiceName);
    if (url) {
      const audio = new Audio(url);
      audio.play();
    }
  };

  const activeAgent = agents.find(a => a.name === activeAgentName);

  return (
    <>
      <header>
        <div className="flex items-center gap-4">
          <button className="btn-icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)} title="Toggle Sidebar">
            {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="logo"><Hexagon /><span>STRATEGY NEXUS</span></div>
        </div>
        <div className="header-actions">
          <button className="btn-icon" onClick={() => setIsMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="btn-icon" onClick={() => setIsDarkMode(!isDarkMode)} title="Toggle Theme">
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button 
            className={`btn-icon ${memoryBoardContent ? 'text-blue-400 border-blue-400' : ''}`} 
            onClick={() => setShowMemoryBoard(!showMemoryBoard)} 
            title="Shared Memory Board"
          >
            <AudioLines size={18} />
          </button>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="System Settings">
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </header>

      <main id="main-layout">
        <div id="left-sidebar" className={!isSidebarOpen ? 'collapsed' : ''}>
          <div id="chat-window" ref={chatWindowRef}>
            {messages.map((msg) => (
              <div key={msg.id} className={msg.type === 'system-msg' ? 'system-msg' : `message ${msg.type}`}>
                {msg.type === 'agent-message' && (
                  <div className="agent-msg-name" style={{ color: msg.colorHex }}>
                    <div className="flex items-center gap-2">
                      <Cpu size={14} /> {msg.sender}
                    </div>
                    <button 
                      onClick={() => {
                        const agent = agents.find(a => a.name === msg.sender);
                        playTTS(msg.text, agent?.voice || 'Kore');
                      }} 
                      className="text-gray-400 hover:text-white transition-colors ml-auto"
                      title="Read Aloud"
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                )}
                {msg.type === 'user-message' && (
                  <div className="agent-msg-name" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    <User size={14} /> COMMANDER
                  </div>
                )}
                
                {msg.isFinalPlan ? (
                  <div className="markdown-body text-left w-full">
                    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                      <h3 className="text-xl font-bold m-0">Final Project Plan</h3>
                      <button onClick={() => playTTS(msg.text, agents[0]?.voice || 'Zephyr')} className="p-2 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-colors" title="Read Aloud">
                        <Volume2 size={16} />
                      </button>
                    </div>
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                    {!isProcessing && messages[messages.length - 1].id === msg.id && (
                      <div className="mt-6 pt-4 border-t border-gray-700 flex justify-end">
                        <button 
                          onClick={() => handleSend("I approve the plan. Let's proceed to execution.")}
                          className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full transition-colors shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                        >
                          Approve Plan
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: formatMessageText(msg.text) }} />
                )}
              </div>
            ))}

            {isInitializing && (
              <div className="message system-msg flex items-center gap-2 text-gray-400 opacity-70">
                <Loader2 size={16} className="animate-spin" />
                <span>Initializing panel discussion...</span>
              </div>
            )}

            {activeAgentName && currentStreamingText && (
              <div className="message agent-message">
                <div className="agent-msg-name" style={{ color: activeAgent?.hex || '#ffffff' }}>
                  <div className="flex items-center gap-2">
                    <Cpu size={14} /> {activeAgentName}
                    <span className="text-[10px] uppercase tracking-widest opacity-50 ml-2 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> deliberating...
                    </span>
                  </div>
                </div>
                <div dangerouslySetInnerHTML={{ __html: formatMessageText(currentStreamingText) }} />
              </div>
            )}
          </div>

          <div id="controls-wrapper">
            <div className="flex flex-col items-center gap-1">
              <button className={`mic-btn ${isRecording ? 'recording' : ''} ${isHandsFree ? 'hands-free' : ''}`} onClick={toggleMic} title="Voice to Text">
                <Mic size={20} />
              </button>
              <button 
                className={`text-[10px] uppercase font-bold tracking-wider ${isHandsFree ? 'text-blue-400' : 'text-gray-500'}`}
                onClick={() => setIsHandsFree(!isHandsFree)}
                title="Hands-Free Mode (Auto-listen & Auto-send)"
              >
                {isHandsFree ? 'Hands-Free ON' : 'Hands-Free OFF'}
              </button>
            </div>
            
            <div className="input-group">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={isProcessing ? "Agents are deliberating..." : "Give the initial task or strategic prompt..."}
                disabled={isProcessing}
              />
            </div>

            <button className="send-btn" onClick={() => handleSend()} title="Send Prompt" disabled={isProcessing || !input.trim()}>
              <Send size={20} />
            </button>

            <button className={`interrupt-btn ${isProcessing ? 'enabled' : ''}`} onClick={handleInterrupt} title="Interrupt Agents" disabled={!isProcessing}>
              <AudioLines size={18} />
              <span>HALT</span>
            </button>
          </div>
        </div>

        <div id="agent-grid">
          {agents.map((a, i) => {
            const isSpeaking = playingAgentName === a.name;
            const isTyping = activeAgentName === a.name;
            const isActive = isSpeaking || isTyping;
            
            return (
              <div key={a.id} className={`agent-card ${isActive ? 'active' : ''}`} style={{ '--agent-color-rgb': a.rgba } as any}>
                <div className="card-top">
                  <img src={a.img} className="agent-img" alt={a.name} />
                  <button className="star-btn" onClick={() => rewardAgent(i)} title="Reward Idea">
                    <Star size={16} fill="currentColor" />
                  </button>
                </div>
                <div className="card-bottom">
                  <div className="agent-name">
                    {a.name}
                    <div className="visualizer" style={{ opacity: isSpeaking ? 1 : 0 }}>
                      <div className="bar"></div><div className="bar"></div><div className="bar"></div>
                    </div>
                  </div>
                  <div className="agent-status">{isSpeaking ? 'Speaking...' : isTyping ? 'Deliberating...' : a.role}</div>
                  <div className="power-row">
                    <span className="pwr-left">PWR</span>
                    <span className="pwr-right">{a.score}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {showMemoryBoard && (
        <div id="settings-modal" style={{ display: 'flex', opacity: 1 }}>
          <div className="modal-content" style={{ transform: 'scale(1)', flexDirection: 'column' }}>
            <div className="settings-header" style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', margin: 0 }}>
              <div>
                <div className="flex items-center gap-3">
                  <h2>Shared Memory Board</h2>
                  {isProcessing && (
                    <span className="text-[10px] uppercase tracking-widest text-blue-400 flex items-center gap-1 bg-blue-400/10 px-2 py-0.5 rounded border border-blue-400/20">
                      <Loader2 size={10} className="animate-spin" /> Syncing...
                    </span>
                  )}
                </div>
                <p>Facts, assumptions, conflicts, decisions, and open questions.</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-icon" onClick={() => setIsMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"}>
                  {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button onClick={() => setShowMemoryBoard(false)} className="btn-icon"><X /></button>
              </div>
            </div>
            <div className="settings-body markdown-body">
              {memoryBoardContent ? (
                <ReactMarkdown>{memoryBoardContent}</ReactMarkdown>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
                  <AudioLines size={48} style={{ margin: '0 auto 15px auto', opacity: 0.2 }} />
                  <p>The memory board is empty.</p>
                  <p style={{ fontSize: '0.85rem', marginTop: '10px' }}>It will be populated in real-time as the discussion progresses.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div id="settings-modal" style={{ display: 'flex', opacity: 1 }}>
          <div className="modal-content" style={{ transform: 'scale(1)' }}>
            <div className="settings-sidebar">
              <div className="settings-sidebar-header">System</div>
              <div className="sidebar-scroll">
                <div className={`agent-tab ${activeEditIndex === -1 ? 'active' : ''}`} onClick={() => setActiveEditIndex(-1)}>
                  <div className="tab-color-dot" style={{ color: 'var(--text-main)', background: 'var(--text-main)' }}></div>
                  System Prompt
                </div>
                <div className={`agent-tab ${activeEditIndex === -2 ? 'active' : ''}`} onClick={() => setActiveEditIndex(-2)}>
                  <div className="tab-color-dot" style={{ color: 'var(--text-main)', background: 'var(--text-main)' }}></div>
                  Server
                </div>
                <div className="settings-sidebar-header" style={{ marginTop: '20px' }}>Neural Nodes</div>
                {agents.map((a, i) => (
                  <div key={a.id} className={`agent-tab ${i === activeEditIndex ? 'active' : ''}`} onClick={() => setActiveEditIndex(i)} style={{ '--agent-color-rgb': a.rgba } as any}>
                    <div className="tab-color-dot" style={{ color: a.hex, background: a.hex }}></div>
                    {a.name}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="settings-body">
              <div className="settings-header">
                <div>
                  <h2>
                    {activeEditIndex === -1 ? 'System Configuration' : 
                     activeEditIndex === -2 ? 'Server Configuration' : 
                     'Configure Agent'}
                  </h2>
                  <p>
                    {activeEditIndex === -1 ? 'Edit the master prompt that orchestrates the panel.' : 
                     activeEditIndex === -2 ? 'Configure local and cloud model providers.' :
                     'Fine-tune persona, visuals, and directives.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-icon" onClick={() => setIsMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"}>
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <button onClick={() => setShowSettings(false)} className="btn-icon"><X /></button>
                </div>
              </div>

              {activeEditIndex === -1 ? (
                <div className="form-grid">
                  <div className="form-group full">
                    <label>Master System Prompt</label>
                    <textarea 
                      className="custom-input" 
                      style={{ height: '500px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                      value={systemPrompt} 
                      onChange={(e) => setSystemPrompt(e.target.value)} 
                    />
                  </div>
                </div>
              ) : activeEditIndex === -2 ? (
                <div className="form-grid">
                  <div className="form-group full">
                    <label>Ollama Localhost URL</label>
                    <input 
                      type="text" 
                      className="custom-input" 
                      value={ollamaUrl} 
                      onChange={(e) => setOllamaUrl(e.target.value)} 
                      placeholder="http://localhost:11434"
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Ensure your local Ollama instance is running and accessible.</p>
                  </div>
                  <div className="form-group full">
                    <label>Ollama Model Name</label>
                    <input 
                      type="text" 
                      className="custom-input" 
                      value={ollamaModel} 
                      onChange={(e) => setOllamaModel(e.target.value)} 
                      placeholder="gemma"
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>The model to use when an agent is set to Local (Ollama).</p>
                  </div>
                </div>
              ) : agents[activeEditIndex] && (
                <div className="form-grid">
                  <div className="form-group">
                    <label>Identity (Name)</label>
                    <input type="text" className="custom-input" value={agents[activeEditIndex].name} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].name = e.target.value;
                      setAgents(newAgents);
                    }} />
                  </div>

                  <div className="form-group">
                    <label>Role</label>
                    <input type="text" className="custom-input" value={agents[activeEditIndex].role} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].role = e.target.value;
                      setAgents(newAgents);
                    }} />
                  </div>

                  <div className="form-group">
                    <label>Model Provider</label>
                    <select className="custom-input" value={agents[activeEditIndex].provider || 'Cloud (Gemini)'} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].provider = e.target.value;
                      setAgents(newAgents);
                    }}>
                      <option value="Cloud (Gemini)">Cloud (Gemini)</option>
                      <option value="Local (Ollama)">Local (Ollama)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Model Name</label>
                    <input type="text" className="custom-input" value={agents[activeEditIndex].model || 'gemini-3.1-pro-preview'} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].model = e.target.value;
                      setAgents(newAgents);
                    }} />
                  </div>

                  <div className="form-group">
                    <label>Voice</label>
                    <select className="custom-input" value={agents[activeEditIndex].voice} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].voice = e.target.value;
                      setAgents(newAgents);
                    }}>
                      <option value="Puck">Puck</option>
                      <option value="Charon">Charon</option>
                      <option value="Kore">Kore</option>
                      <option value="Fenrir">Fenrir</option>
                      <option value="Zephyr">Zephyr</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Color Hex</label>
                    <input type="text" className="custom-input" value={agents[activeEditIndex].hex} onChange={(e) => {
                      const newAgents = [...agents];
                      newAgents[activeEditIndex].hex = e.target.value;
                      newAgents[activeEditIndex].rgba = hexToRgb(e.target.value);
                      setAgents(newAgents);
                    }} />
                  </div>

                  <div className="form-group full">
                    <label>Agent Avatar</label>
                    <div className="file-upload-zone" onClick={() => document.getElementById('avatar-upload')?.click()}>
                      <ImageIcon size={24} style={{ margin: '0 auto 10px auto', color: 'var(--text-muted)' }} />
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Click to upload new avatar</p>
                      <input 
                        type="file" 
                        id="avatar-upload" 
                        style={{ display: 'none' }} 
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              const newAgents = [...agents];
                              newAgents[activeEditIndex].img = reader.result as string;
                              setAgents(newAgents);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
