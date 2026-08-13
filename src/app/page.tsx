'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud,
  FileText,
  X,
  Send,
  Copy,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  HelpCircle,
  Info,
  Terminal,
  ArrowRight,
  Lock,
  Loader2,
  Plus,
  MessageSquare,
  ExternalLink,
  ShoppingBag,
  Camera,
  Mic,
  StopCircle
} from 'lucide-react';
import { getAnonymousUser, isFirebaseConfigured } from '@/utils/firebase';
import { isSupabaseConfigured } from '@/utils/supabase';
import { isOpenAIConfigured } from '@/utils/openai';

interface FileItem {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'extracting' | 'embedding' | 'indexing' | 'ready' | 'failed';
  progress: number;
  errorMessage?: string;
  dbId?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  sources?: Array<{ filename: string; page?: number }>;
  image?: string;
}

function renderMessageText(text: string) {
  const cardRegex = /\[\!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g;
  
  const parts = [];
  let lastIndex = 0;
  let match;
  
  while ((match = cardRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    if (matchIndex > lastIndex) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex, matchIndex)
      });
    }
    
    parts.push({
      type: 'product_card',
      name: match[1],
      image_url: match[2],
      product_url: match[3]
    });
    
    lastIndex = cardRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.substring(lastIndex)
    });
  }

  if (parts.length === 0) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index} className="whitespace-pre-wrap">{part.content}</span>;
        } else {
          return (
            <div 
              key={index}
              className="bg-slate-950/50 border border-slate-800/80 rounded-xl overflow-hidden shadow-lg flex flex-col sm:flex-row gap-4 p-3.5 my-3.5 hover:border-violet-500/40 hover:shadow-violet-950/10 transition-all duration-300 group/card text-left"
            >
              <div className="relative w-full sm:w-24 h-24 bg-slate-900 border border-slate-800/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center self-center">
                {part.image_url && part.image_url !== 'N/A' ? (
                  <img 
                    src={part.image_url} 
                    alt={part.name} 
                    className="object-cover w-full h-full group-hover/card:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ShoppingBag className="w-8 h-8 text-slate-700 animate-pulse" />
                )}
              </div>
              <div className="flex-1 flex flex-col justify-between py-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-violet-400 uppercase tracking-widest bg-violet-950/40 border border-violet-900/30 px-1.5 py-0.5 rounded">
                      In Stock Match
                    </span>
                  </div>
                  <h4 className="text-white font-bold text-sm mt-2 tracking-tight group-hover/card:text-violet-300 transition-colors">
                    {part.name}
                  </h4>
                </div>
                <div className="mt-3 flex items-center justify-start">
                  <a 
                    href={part.product_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-3.5 py-1.5 rounded-lg transition-all shadow-md shadow-violet-950/20 active:scale-95"
                  >
                    <span>View Product</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          );
        }
      })}
    </>
  );
}

export default function Home() {
  // State variables
  const [userUid, setUserUid] = useState<string>('');
  const [isSimulatedMode, setIsSimulatedMode] = useState<boolean>(false);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hello! I am your isolated business knowledge assistant. Upload your documents (PDF, DOCX, TXT) above and wait for indexing. I will answer only using facts found inside your files.",
      timestamp: new Date(),
    }
  ]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // New recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Optional state for detected language badge
  const [detectedLang, setDetectedLang] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  // Initialize Anonymous Firebase Auth or Simulation Mode on Mount
  useEffect(() => {
    async function initAuth() {
      try {
        const user = await getAnonymousUser();
        setUserUid(user.uid);
        
        const isDbOk = isSupabaseConfigured();
        const isFbOk = isFirebaseConfigured();
        const isAiOk = isOpenAIConfigured();
        
        if (!isDbOk || !isFbOk || !isAiOk) {
          setIsSimulatedMode(true);
        }

        // Fetch user's existing files if database is connected
        if (isDbOk && isFbOk) {
          fetchUserFiles(user.uid);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        setIsSimulatedMode(true);
      }
    }
    initAuth();
  }, []);

  // Sync simulated/mock files with localStorage across page refreshes
  useEffect(() => {
    if (isSimulatedMode && typeof window !== 'undefined') {
      const localFiles = localStorage.getItem('knowledgechat_mock_files');
      if (localFiles) {
        try {
          setFiles(JSON.parse(localFiles));
        } catch (e) {
          console.error('Error reading persisted simulation files:', e);
        }
      }
    }
  }, [isSimulatedMode]);

  useEffect(() => {
    if (isSimulatedMode && typeof window !== 'undefined') {
      localStorage.setItem('knowledgechat_mock_files', JSON.stringify(files));
    }
  }, [files, isSimulatedMode]);


  // Safe response JSON parser to prevent HTML syntax errors when hosted server returns non-JSON pages
  const safeParseResponse = async <T = any>(res: Response, defaultError: string): Promise<T> => {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      if (contentType.includes('application/json') && text.trim()) {
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || `${defaultError} (HTTP ${res.status})`);
        } catch (e: any) {
          if (e.message && !e.message.startsWith('Unexpected token') && e.message !== defaultError) {
            throw e;
          }
        }
      }
      if (text.trim().startsWith('<') || text.toLowerCase().includes('<html>') || text.toLowerCase().includes('<!doctype')) {
        throw new Error(`Server returned HTML error page (HTTP ${res.status} ${res.statusText || ''}). Check backend server route configuration.`);
      }
      throw new Error(`${defaultError} (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }

    if (text.trim().startsWith('<') || text.toLowerCase().includes('<html>') || text.toLowerCase().includes('<!doctype')) {
      throw new Error(`Server returned HTML page instead of JSON. Check backend hosting API routing.`);
    }

    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
    }
  };

  // Fetch already uploaded files from DB
  const fetchUserFiles = async (uid: string) => {
    try {
      const res = await fetch(`/api/files?user_uid=${uid}`, {
        headers: {
          'x-user-uid': uid,
        }
      });
      if (res.ok) {
        const data = await safeParseResponse<{ files?: any[] }>(res, 'Failed to load user files');
        if (data && data.files) {
          const formatted: FileItem[] = data.files.map((f: any) => ({
            id: f.id,
            name: f.filename,
            size: f.file_size,
            status: f.status === 'indexed' ? 'ready' : f.status,
            progress: f.status === 'indexed' ? 100 : 50,
            dbId: f.id,
          }));
          setFiles(formatted);
        }
      }
    } catch (err) {
      console.error('Error fetching files:', err);
    }
  };

  // Auto Scroll Chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Handle File Drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Handle File Input Selection
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(Array.from(e.target.files));
    }
  };

  // File Validation and Pipeline Execution
  const handleFiles = (incomingFiles: File[]) => {
    setValidationError(null);

    // Limit overall files to 50
    if (files.length + incomingFiles.length > 50) {
      setValidationError('Maximum limit is 50 business knowledge files per anonymous account.');
      return;
    }

    incomingFiles.forEach((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const isAllowed = ['pdf', 'docx', 'txt', 'csv', 'json'].includes(extension || '');
      const MAX_SIZE = 20 * 1024 * 1024; // 20MB

      if (!isAllowed) {
        setValidationError(`Invalid format for ${file.name}. Only PDF, DOCX, TXT, CSV, and JSON are supported.`);
        return;
      }

      if (file.size > MAX_SIZE) {
        setValidationError(`File ${file.name} exceeds the 20MB size limit.`);
        return;
      }

      // Add to File queue list state
      const fileId = 'file_' + Math.random().toString(36).substring(2, 15);
      const newFileItem: FileItem = {
        id: fileId,
        name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 10,
      };

      setFiles((prev) => [newFileItem, ...prev]);

      // Execute upload & process pipeline
      processFilePipeline(file, fileId);
    });
  };

  // Unified Upload & Extraction & Embedding RAG Pipeline Execution
  const processFilePipeline = async (file: File, fileId: string) => {
    try {
      // Step 1: Uploading
      updateFileState(fileId, { progress: 30, status: 'uploading' });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_uid', userUid);

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'x-user-uid': userUid,
        },
        body: formData,
      });

      const docData = await safeParseResponse(uploadRes, 'Upload failed');
      const dbId = docData.id;

      // Step 2: Start an artificial progress interval to keep users engaged while backend processes
      updateFileState(fileId, { progress: 60, status: 'extracting', dbId });
      
      let currentProgress = 60;
      const progressInterval = setInterval(() => {
        // As it gets closer to 99%, slow down the increment so it doesn't get stuck at 99% too fast
        const increment = currentProgress > 90 ? (Math.random() > 0.5 ? 1 : 0) : Math.floor(Math.random() * 3) + 1;
        currentProgress += increment;
        if (currentProgress > 99) currentProgress = 99;
        
        let dynamicStatus: 'extracting' | 'embedding' | 'indexing' = 'extracting';
        if (currentProgress > 75) dynamicStatus = 'embedding';
        if (currentProgress > 88) dynamicStatus = 'indexing';

        updateFileState(fileId, { progress: currentProgress, status: dynamicStatus });
      }, 800);

      try {
        // Step 3: Trigger actual RAG parsing, embedding and vector database indexing
        const processRes = await fetch('/api/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uid': userUid,
          },
          body: JSON.stringify({
            document_id: dbId,
            user_uid: userUid,
          }),
        });

        await safeParseResponse(processRes, 'Document processing failed');

        // Completed Successfully
        updateFileState(fileId, { progress: 100, status: 'ready' });
      } catch (err: any) {
        console.error(`Pipeline error for ${file.name}:`, err);
        updateFileState(fileId, {
          status: 'failed',
          progress: 100,
          errorMessage: err.message || 'Processing failed. Retry.',
        });
      } finally {
        clearInterval(progressInterval);
      }
    } catch (err: any) {
      console.error(`Upload error for ${file.name}:`, err);
      updateFileState(fileId, {
        status: 'failed',
        progress: 100,
        errorMessage: err.message || 'Upload failed. Retry.',
      });
    }
  };

  const resolveProcessingStep = (resolve: any, fileId: string, status: any, progress: number) => {
    updateFileState(fileId, { status, progress });
    return resolve;
  };

  const updateFileState = (id: string, updates: Partial<FileItem>) => {
    setFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  // Delete uploaded knowledge file
  const handleDeleteFile = async (item: FileItem) => {
    try {
      // Optimistic state update
      setFiles((prev) => prev.filter((f) => f.id !== item.id));

      if (item.dbId && !isSimulatedMode) {
        await fetch(`/api/files/${item.dbId}?user_uid=${userUid}`, {
          method: 'DELETE',
          headers: {
            'x-user-uid': userUid,
          },
        });
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  };

  // Compress and downscale uploaded local images to prevent network payloads/timeouts with OpenAI
  const compressChatImage = (file: File, callback: (base64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000;
        const MAX_HEIGHT = 1000;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Export as compressed JPEG with 0.75 quality for rapid network transit (typically ~60kb - 90kb)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
          callback(dataUrl);
        } else {
          callback(event.target?.result as string);
        }
      };
      img.onerror = () => {
        callback(event.target?.result as string);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Handle chat image attachment selection
  const handleChatImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Chat image attachment size limit is 5MB.");
      return;
    }

    compressChatImage(file, (compressedBase64) => {
      setAttachedImage(compressedBase64);
    });

    if (chatImageInputRef.current) {
      chatImageInputRef.current.value = '';
    }
  };

  // Trigger Chat Query submit
  const handleSendMessage = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault();
    const query = (customMsg || inputMessage).trim();
    if (!query && !attachedImage) return;

    if (!customMsg) setInputMessage('');

    // Capture attachment snapshot and clear state
    let imgToSend = attachedImage;
    setAttachedImage(null);

    let finalQuery = query;

    // Client-side URL paste interceptor: detect if user pasted a direct image URL
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', 'fit=crop'];
    const hasImageSignature = imageExtensions.some(ext => query.toLowerCase().includes(ext)) || query.includes('images.unsplash.com') || query.includes('images/theme');
    const isImageUrl = (query.startsWith('http://') || query.startsWith('https://')) && hasImageSignature;

    if (isImageUrl && !imgToSend) {
      imgToSend = query;
      finalQuery = ''; // Treat primarily as visual-first input to prevent text search pollution
    }

    const userMessage: Message = {
      id: 'msg_' + Math.random().toString(36).substring(2, 15),
      role: 'user',
      text: query, // Keep original pasted URL or text visible in the message bubble
      timestamp: new Date(),
      image: imgToSend || undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: finalQuery,
          user_uid: userUid,
          image_url: imgToSend || undefined,
        }),
      });

      const data = await safeParseResponse(res, 'Could not contact the chatbot service.');
      
      const assistantMsg: Message = {
        id: 'msg_' + Math.random().toString(36).substring(2, 15),
        role: 'assistant',
        text: data.response,
        timestamp: new Date(),
        sources: data.sources || [],
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMsg: Message = {
        id: 'msg_err_' + Date.now(),
        role: 'assistant',
        text: "I encountered an error connecting to the RAG server. Please double-check your API key credentials or retry in a few moments.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  // Copy assistant response to clipboard
  const handleCopyToClipboard = (text: string, msgId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Voice recording start
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice.webm');
        // Send to backend for transcription
        try {
          const res = await fetch('/api/voice', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.text) {
            setInputMessage(data.text);
            setDetectedLang(data.language || null);
          }
        } catch (err) {
          console.error('Voice transcription error:', err);
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Unable to access microphone:', err);
    }
  };

  // Voice recording stop
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // Pre-process byte sizes for premium look
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Dynamic status-colored icons for parsing states
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />;
      case 'extracting':
        return <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />;
      case 'embedding':
        return <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />;
      case 'indexing':
        return <Loader2 className="w-4 h-4 text-fuchsia-400 animate-spin" />;
      case 'ready':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'uploading': return 'Uploading file...';
      case 'extracting': return 'Extracting text...';
      case 'embedding': return 'Generating embeddings...';
      case 'indexing': return 'Indexing in vector db...';
      case 'ready': return 'Ready';
      case 'failed': return 'Failed';
      default: return '';
    }
  };

  const suggestedQuestions = [
    "What do you offer?",
  "How much do your products or services cost?",
  "How can I get in touch with you?"
  ];

  return (
    <div className="flex-1 bg-grid-pattern relative flex flex-col justify-between overflow-x-hidden w-full max-w-full">
      
      {/* Background radial glowing effects */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] max-w-full rounded-full bg-violet-600/10 floating-glow animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[500px] h-[500px] max-w-full rounded-full bg-blue-600/10 floating-glow animate-pulse-glow" style={{ animationDelay: '-4s' }} />

      {/* Floating Simulation Mode alert banner */}
      {/* <AnimatePresence>
        {isSimulatedMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="bg-amber-950/40 border-b border-amber-800/30 text-amber-300 text-xs py-2.5 px-4 flex items-center justify-between gap-4 relative z-10 backdrop-blur-md"
          >
            <div className="flex items-center gap-2 mx-auto">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Offline Simulation Sandbox:</strong> Firebase / Supabase API keys are not fully configured yet. Running in beautiful interactive demonstration mode.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence> */}

      {/* Premium Header */}
      <header className="border-b border-slate-900/80 bg-slate-950/60 backdrop-blur-md relative z-10 py-4 px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center bg-transparent">
            <img src="/logo.jpg" alt="Logo" className="w-8 h-12 object-contain rounded-full shadow-sm shadow-slate-900/50" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              TulipTech AI
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">Intelligent Knowledge Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full text-xs font-mono text-slate-400 shadow-inner">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
            <span>UID:</span>
            <span className="text-slate-300 max-w-[120px] truncate">{userUid || 'Anonymous Loading...'}</span>
          </div>
        </div>
      </header>

      {/* Main SaaS Layout */}
      <main className="w-full max-w-7xl mx-auto px-2 sm:px-6 md:px-12 py-6 md:py-10 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 relative z-10">
        
        {/* Left column: SaaS pitch & Upload Area (5 columns) */}
        <section className="lg:col-span-5 flex flex-col justify-between gap-8 h-full">
          
          {/* SaaS Copy Hero */}
          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="px-3 py-1 text-xs font-semibold bg-violet-950/60 border border-violet-800/40 text-violet-300 rounded-full inline-flex items-center gap-1.5 shadow-md shadow-violet-900/10">
                <Terminal className="w-3.5 h-3.5" /> Premium AI Assistant
              </span>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-white break-words"
            >
              Chat With Your <br />
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
                Business Knowledge
              </span>
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-slate-400 text-sm md:text-base max-w-lg leading-relaxed"
            >
              Upload your business documents and instantly create an isolated, secure AI assistant trained only on your files. No data leaks, no guesswork.
            </motion.p>
          </div>

          {/* Drag & Drop Upload Container */}
          <div className="space-y-4 flex-1 flex flex-col">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`glow-border cursor-pointer relative p-8 md:p-10 rounded-2xl border border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-4 text-center glass-panel glass-panel-hover ${
                dragActive
                  ? 'border-violet-500 bg-violet-950/10 scale-[1.01]'
                  : 'border-slate-800 bg-slate-950/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.csv,.json"
                onChange={handleFileInput}
                className="hidden"
              />
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-full shadow-lg text-violet-400 shadow-violet-950/20 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8 animate-pulse" />
              </div>
              <div>
                <h3 className="text-white font-medium text-sm">Drag & drop files or click to upload</h3>
                <p className="text-slate-500 text-xs mt-1.5">Supports PDF, DOCX, TXT, CSV, JSON (Max 50 files, up to 20MB each)</p>
              </div>
            </div>

            {/* Error Notifications */}
            <AnimatePresence>
              {validationError && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="bg-rose-950/40 border border-rose-900/30 rounded-xl p-3.5 flex items-start gap-3 text-rose-300 text-xs"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">Validation Alert</span>
                    {validationError}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Uploaded Files Queue Section */}
            <div className="flex-1 max-h-[250px] overflow-y-auto space-y-3 pr-2 scrollbar">
              <AnimatePresence>
                {files.map((file) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 15 }}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-slate-900 bg-slate-950/50 backdrop-blur-sm group hover:border-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 group-hover:text-indigo-400 transition-colors flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-slate-200 text-xs font-semibold truncate pr-2" title={file.name}>
                          {file.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-slate-500 font-mono">{formatBytes(file.size)}</span>
                          <span className="text-[10px] text-slate-500">•</span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            {renderStatusBadge(file.status)}
                            {file.status === 'indexing' ? (
                              <span>Indexing... <span className="text-indigo-400 font-mono ml-0.5">{file.progress}%</span></span>
                            ) : (
                              getStatusText(file.status)
                            )}
                          </span>
                        </div>
                        {/* Display subtle upload progress line */}
                        {file.status !== 'ready' && file.status !== 'failed' && (
                          <div className="w-full bg-slate-900 h-1 rounded-full mt-2 overflow-hidden">
                            <motion.div
                              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${file.progress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        )}
                        {file.status === 'failed' && (
                          <p className="text-[10px] text-rose-400 mt-1">{file.errorMessage || 'Unknown extraction error'}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFile(file)}
                      className="p-1.5 rounded-md hover:bg-slate-900 border border-transparent hover:border-slate-800 text-slate-500 hover:text-rose-400 transition-all flex-shrink-0 ml-2"
                      title="Delete document"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {files.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center py-10 border border-dashed border-slate-900 rounded-xl bg-slate-950/10">
                  <p className="text-xs text-slate-500">No documents added to current knowledge base.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right column: High-fidelity Chat Interface (7 columns) */}
        <section className="lg:col-span-7 flex flex-col bg-slate-950/40 border border-slate-900/60 rounded-3xl min-h-[400px] md:min-h-[600px] overflow-hidden backdrop-blur-md shadow-2xl relative">
          
          {/* Active Chat Header */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-900/80 bg-slate-950/60 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20 animate-pulse" />
              <div>
                <h3 className="text-white font-bold text-sm">AI Agent</h3>
                {/* <p className="text-[10px] text-slate-500">Replies strictly from your {files.filter(f => f.status === 'ready').length} documents</p> */}
              </div>
            </div>
            
            {/* <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono bg-indigo-950/40 border border-indigo-900/30 text-indigo-400 px-2.5 py-1 rounded-md">
                GPT-4o-mini
              </span>
            </div> */}
          </div>

          {/* Message List Panel */}
          <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2 scrollbar">
            
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 shadow-lg flex flex-col gap-2 relative group ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-br-none shadow-violet-950/10'
                        : 'bg-slate-900/80 border border-slate-800 text-slate-100 rounded-bl-none'
                    }`}
                  >
                    
                    {/* Copy Button for Assistant messages */}
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleCopyToClipboard(msg.text, msg.id)}
                        className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-slate-950/40 border border-slate-800 text-slate-400 hover:text-white transition-opacity"
                        title="Copy to clipboard"
                      >
                        {copiedId === msg.id ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* User Sent Image rendering */}
                    {msg.image && (
                      <div className="relative max-w-[280px] rounded-xl overflow-hidden border border-slate-800/80 mb-1 bg-slate-950/40 shadow-inner">
                        <img src={msg.image} alt="Uploaded attachment" className="object-cover w-full h-auto max-h-48" />
                      </div>
                    )}

                    {/* Content */}
                    <div className="text-sm leading-relaxed selection:bg-violet-500/30 selection:text-white">
                      {renderMessageText(msg.text)}
                    </div>

                    {/* Source citations rendering */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex flex-col gap-1.5">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                          References Used ({msg.sources.length})
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((src, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-slate-950/60 border border-slate-800 rounded-md text-indigo-400"
                              title={src.filename}
                            >
                              <FileText className="w-3 h-3 text-slate-500" />
                              <span className="max-w-[120px] truncate">{src.filename}</span>
                              {src.page && <span className="text-slate-500">p.{src.page}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <span className="text-[9px] text-slate-400/70 self-end font-mono mt-1">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Simulated typing dot animation */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl rounded-bl-none p-4 flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Quick Suggested Questions & Prompt input Footer */}
          <div className="p-2 md:p-5 border-t border-slate-900 bg-slate-950/60 flex-shrink-0 space-y-2">
            
            {/* Suggested Questions Bubble cards */}
            {messages.length === 1 && (
              <div className="space-y-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Suggested Questions</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(undefined, q)}
                      disabled={isTyping}
                      className="text-left p-3 text-xs bg-slate-900/40 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/30 text-slate-300 hover:text-white rounded-xl transition-all shadow-sm flex items-start gap-2 group cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 flex-shrink-0 mt-0.5" />
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

             {/* Image Preview Thumbnail */}
             {attachedImage && (
               <div className="relative inline-flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl p-2 mb-3 shadow-lg group">
                 <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                   <img src={attachedImage} alt="Attachment preview" className="object-cover w-full h-full" />
                 </div>
                 <button
                   type="button"
                   onClick={() => setAttachedImage(null)}
                   className="absolute -top-1.5 -right-1.5 p-1 bg-rose-600 hover:bg-rose-500 text-white rounded-full transition-all shadow-md active:scale-95"
                   title="Remove image"
                 >
                   <X className="w-2.5 h-2.5" />
                 </button>
               </div>
             )}

             {/* Hidden file input for chat image attachment */}
             <input
               type="file"
               ref={chatImageInputRef}
               onChange={handleChatImageSelect}
               accept="image/*"
               className="hidden"
             />

             {/* Prompt input field */}
              <form onSubmit={(e) => handleSendMessage(e)} className="relative flex items-center">
               {/* Camera attachment button on the left */}
               <button
                 type="button"
                 onClick={() => chatImageInputRef.current?.click()}
                 disabled={isTyping}
                 className="absolute left-3 sm:left-3 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/40 transition-all z-10"
                 title="Attach product image"
               >
                 <Camera className="w-4 h-4" />
               </button>

               {/* Voice recording button */}
               <button
                 type="button"
                 onClick={isRecording ? stopRecording : startRecording}
                 disabled={isTyping}
                 className="absolute left-10 sm:left-12 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/40 transition-all z-10"
                 title={isRecording ? 'Stop Recording' : 'Start Voice Recording'}
               >
                 {isRecording ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
               </button>

               {/* Detected language badge */}
               {detectedLang && (
                 <span className="absolute left-[88px] sm:left-[96px] top-[14px] text-[10px] text-slate-400 bg-slate-800/50 px-1.5 rounded uppercase">{detectedLang}</span>
               )}

               <input
                 type="text"
                 value={inputMessage}
                 onChange={(e) => setInputMessage(e.target.value)}
                 placeholder={
                   files.filter(f => f.status === 'ready').length > 0 
                     ? "Ask your files anything..." 
                     : "Upload some files above to query your knowledge base..."
                 }
                 disabled={isTyping}
                 className="w-full glass-input text-sm text-white pl-[72px] sm:pl-[88px] pr-14 py-3.5 rounded-2xl outline-none transition-all placeholder-slate-500"
               />
               <button
                 type="submit"
                 disabled={(!inputMessage.trim() && !attachedImage) || isTyping}
                 className="absolute right-2 p-2.5 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-950/25"
               >
                 <Send className="w-4 h-4" />
               </button>
             </form>
          </div>

        </section>
      </main>

      {/* Premium minimal Footer */}
      <footer className="border-t border-slate-900/60 py-5 bg-slate-950/40 relative z-10 text-center text-slate-600 text-xs">
        <p>© 2026 KnowledgeChat AI. Zero-knowledge isolated RAG environment. All data resides in private sandbox containers.</p>
      </footer>
    </div>
  );
}
