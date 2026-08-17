'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud,
  FileText,
  X,
  Send,
  Copy,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Lock,
  Loader2,
  MessageSquare,
  ExternalLink,
  Camera,
  Mic,
  StopCircle,
  Download,
  Maximize2,
  Trash2
} from 'lucide-react';
import { getAnonymousUser, isFirebaseConfigured, storage } from '@/utils/firebase';
import { ref, uploadBytes } from 'firebase/storage';
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

// Download helper function for image inspection and saving
async function downloadImage(url: string, filename = 'product-image.jpg') {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('CORS or network issue');
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    // Direct link fallback
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function renderMessageText(text: string, onImageClick?: (url: string, alt?: string) => void) {
  // Regex to match:
  // 1. Linked image: [![alt](imgUrl)](linkUrl)
  // 2. Standalone image: ![alt](imgUrl)
  // 3. Standalone link: [text](linkUrl)
  const masterRegex = /\[\!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)|\!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;
  
  const parts: Array<{
    type: 'text' | 'linked_image' | 'image' | 'link';
    content?: string;
    alt?: string;
    imageUrl?: string;
    linkUrl?: string;
    text?: string;
    url?: string;
  }> = [];
  
  let lastIndex = 0;
  let match;
  
  while ((match = masterRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex, match.index)
      });
    }
    
    if (match[1] !== undefined && match[2] && match[3]) {
      // Linked image
      parts.push({
        type: 'linked_image',
        alt: match[1] || 'Product Image',
        imageUrl: match[2],
        linkUrl: match[3]
      });
    } else if (match[4] !== undefined && match[5]) {
      // Standalone image
      parts.push({
        type: 'image',
        alt: match[4] || 'Product Image',
        imageUrl: match[5]
      });
    } else if (match[6] && match[7]) {
      // Standalone link
      parts.push({
        type: 'link',
        text: match[6],
        url: match[7]
      });
    }
    
    lastIndex = masterRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.substring(lastIndex)
    });
  }

  const renderInlineFormatted = (rawText: string) => {
    const boldRegex = /\*\*([^*]+)\*\*/g;
    const inlineParts = [];
    let cur = 0;
    let bMatch;
    while ((bMatch = boldRegex.exec(rawText)) !== null) {
      if (bMatch.index > cur) {
        inlineParts.push(rawText.substring(cur, bMatch.index));
      }
      inlineParts.push(
        <strong key={bMatch.index} className="font-semibold text-slate-900">
          {bMatch[1]}
        </strong>
      );
      cur = boldRegex.lastIndex;
    }
    if (cur < rawText.length) {
      inlineParts.push(rawText.substring(cur));
    }
    return inlineParts;
  };

  return (
    <div className="space-y-1">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {renderInlineFormatted(part.content || '')}
            </span>
          );
        }

        if (part.type === 'image') {
          return (
            <div 
              key={index}
              className="my-3 max-w-sm rounded-2xl overflow-hidden border border-slate-200 bg-slate-50/80 shadow-md group relative transition-all duration-300 hover:shadow-xl hover:border-violet-300"
            >
              <div 
                onClick={() => onImageClick?.(part.imageUrl!, part.alt)}
                className="relative aspect-video sm:aspect-[4/3] w-full overflow-hidden cursor-pointer bg-slate-100 flex items-center justify-center"
              >
                <img 
                  src={part.imageUrl} 
                  alt={part.alt || 'Product Image'} 
                  className="w-full h-full object-contain sm:object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                
                {/* Hover overlay with action buttons */}
                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2.5 backdrop-blur-[2px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageClick?.(part.imageUrl!, part.alt);
                    }}
                    className="p-2 bg-white/95 hover:bg-white text-slate-900 rounded-xl shadow-lg transition-transform hover:scale-105 flex items-center gap-1.5 text-xs font-semibold px-3"
                    title="View Fullscreen"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-violet-600" />
                    <span>View Full</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadImage(part.imageUrl!, `${part.alt || 'product'}.jpg`);
                    }}
                    className="p-2 bg-white/95 hover:bg-white text-slate-900 rounded-xl shadow-lg transition-transform hover:scale-105 flex items-center gap-1.5 text-xs font-semibold px-3"
                    title="Download image"
                  >
                    <Download className="w-3.5 h-3.5 text-violet-600" />
                    <span>Download</span>
                  </button>
                </div>
              </div>
              
              {part.alt && part.alt !== 'Product Image' && (
                <div className="p-2.5 text-xs font-medium text-slate-700 truncate border-t border-slate-200/80 bg-white/90 flex items-center justify-between">
                  <span className="truncate">{part.alt}</span>
                  <span className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full ml-2 flex-shrink-0">
                    Click to zoom
                  </span>
                </div>
              )}
            </div>
          );
        }

        if (part.type === 'linked_image') {
          return (
            <div 
              key={index}
              className="my-3 max-w-sm rounded-2xl overflow-hidden border border-slate-200 bg-slate-50/80 shadow-md group relative transition-all duration-300 hover:shadow-xl hover:border-violet-300"
            >
              <div 
                onClick={() => onImageClick?.(part.imageUrl!, part.alt)}
                className="relative aspect-video sm:aspect-[4/3] w-full overflow-hidden cursor-pointer bg-slate-100 flex items-center justify-center"
              >
                <img 
                  src={part.imageUrl} 
                  alt={part.alt || 'Product Image'} 
                  className="w-full h-full object-contain sm:object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                
                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2.5 backdrop-blur-[2px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageClick?.(part.imageUrl!, part.alt);
                    }}
                    className="p-2 bg-white/95 hover:bg-white text-slate-900 rounded-xl shadow-lg transition-transform hover:scale-105 flex items-center gap-1.5 text-xs font-semibold px-3"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-violet-600" />
                    <span>View Full</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadImage(part.imageUrl!, `${part.alt || 'product'}.jpg`);
                    }}
                    className="p-2 bg-white/95 hover:bg-white text-slate-900 rounded-xl shadow-lg transition-transform hover:scale-105 flex items-center gap-1.5 text-xs font-semibold px-3"
                  >
                    <Download className="w-3.5 h-3.5 text-violet-600" />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              <div className="p-2.5 flex items-center justify-between border-t border-slate-200/80 bg-white/90 gap-2">
                <span className="text-xs font-bold text-slate-800 truncate">{part.alt}</span>
                <a
                  href={part.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-3 py-1.5 rounded-lg shadow-sm transition-all flex-shrink-0 active:scale-95"
                >
                  <span>View Product</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          );
        }

        if (part.type === 'link') {
          return (
            <a
              key={index}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100/90 border border-violet-200/70 px-3 py-1 rounded-lg text-xs my-1 transition-all shadow-xs active:scale-95 group/link"
            >
              <span>{part.text}</span>
              <ExternalLink className="w-3 h-3 text-violet-500 group-hover/link:translate-x-0.5 transition-transform" />
            </a>
          );
        }

        return null;
      })}
    </div>
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
  const [selectedImage, setSelectedImage] = useState<{ url: string; alt?: string } | null>(null);

  // Close image modal with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Load chat history from localStorage on initialization
  useEffect(() => {
    if (userUid && typeof window !== 'undefined') {
      const saved = localStorage.getItem(`knowledgechat_history_${userUid}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
        } catch (e) {
          console.error('Failed to parse chat history', e);
        }
      }
    }
  }, [userUid]);

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    if (userUid && typeof window !== 'undefined' && messages.length > 0) {
      localStorage.setItem(`knowledgechat_history_${userUid}`, JSON.stringify(messages));
    }
  }, [messages, userUid]);


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
      const isAllowed = ['pdf', 'docx', 'txt', 'csv', 'json', 'xlsx'].includes(extension || '');
      const MAX_SIZE = 20 * 1024 * 1024; // 20MB

      if (!isAllowed) {
        setValidationError(`Invalid format for ${file.name}. Only PDF, DOCX, TXT, CSV, JSON, and XLSX are supported.`);
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
      formData.append('user_uid', userUid);

      const isLargeFile = file.size > 4 * 1024 * 1024;
      const hasFirebase = isFirebaseConfigured() && isSupabaseConfigured();

      if (isLargeFile) {
        if (hasFirebase) {
          const storagePath = `users/${userUid}/${Date.now()}_${file.name}`;
          const storageRef = ref(storage!, storagePath);
          await uploadBytes(storageRef, await file.arrayBuffer(), { contentType: file.type });
          formData.append('direct_storage_path', storagePath);
        } else {
          formData.append('direct_storage_path', `simulated/${userUid}/${Date.now()}_${file.name}`);
        }
        // Always send metadata and skip the raw file for large files to avoid Vercel 4.5MB 413 errors
        formData.append('direct_filename', file.name);
        formData.append('direct_file_size', file.size.toString());
      } else {
        formData.append('file', file);
      }

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

  const handleClearChat = () => {
    if (confirm('Are you sure you want to clear the conversation?')) {
      const defaultWelcome: Message[] = [
        {
          id: 'welcome',
          role: 'assistant',
          text: "Hello! I am your isolated business knowledge assistant. Upload your documents (PDF, DOCX, TXT) above and wait for indexing. I will answer only using facts found inside your files.",
          timestamp: new Date(),
        }
      ];
      setMessages(defaultWelcome);
      if (userUid) {
        localStorage.removeItem(`knowledgechat_history_${userUid}`);
      }
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
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
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
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-md relative z-10 py-4 px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center bg-transparent">
            <img src="/logo.jpg" alt="Logo" className="w-20 h-12 object-contain rounded-full shadow-sm shadow-slate-200/60" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent">
              TulipTech AI
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">Intelligent Knowledge Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-slate-100/80 border border-slate-300 px-3 py-1.5 rounded-full text-xs font-mono text-slate-600 shadow-inner">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
            <span>UID:</span>
            <span className="text-slate-700 max-w-[120px] truncate">{userUid || 'Anonymous Loading...'}</span>
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
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-slate-900 break-words"
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
              className="text-slate-600 text-sm md:text-base max-w-lg leading-relaxed"
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
                  : 'border-slate-300 bg-white/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.csv,.json,.xlsx"
                onChange={handleFileInput}
                className="hidden"
              />
              <div className="p-4 bg-slate-100/80 border border-slate-300 rounded-full shadow-lg text-violet-400 shadow-violet-950/20 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8 animate-pulse" />
              </div>
              <div>
                <h3 className="text-slate-900 font-medium text-sm">Drag & drop files or click to upload</h3>
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
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
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
                    className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white/70 backdrop-blur-sm group hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="p-2 bg-slate-100 border border-slate-300 rounded-lg text-slate-600 group-hover:text-indigo-400 transition-colors flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-slate-800 text-xs font-semibold truncate pr-2" title={file.name}>
                          {file.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-slate-500 font-mono">{formatBytes(file.size)}</span>
                          <span className="text-[10px] text-slate-500">•</span>
                          <span className="text-[10px] text-slate-600 flex items-center gap-1">
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
                          <div className="w-full bg-slate-100 h-1 rounded-full mt-2 overflow-hidden">
                            <motion.div
                              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${file.progress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        )}
                        {file.status === 'failed' && (
                          <p className="text-[10px] text-rose-600 mt-1">{file.errorMessage || 'Unknown extraction error'}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFile(file)}
                      className="p-1.5 rounded-md hover:bg-slate-100 border border-transparent hover:border-slate-300 text-slate-500 hover:text-rose-600 transition-all flex-shrink-0 ml-2"
                      title="Delete document"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {files.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center py-10 border border-dashed border-slate-200 rounded-xl bg-slate-100/50">
                  <p className="text-xs text-slate-500">No documents added to current knowledge base.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right column: High-fidelity Chat Interface (7 columns) */}
        <section className="lg:col-span-7 flex flex-col bg-white/60 border border-slate-200/60 rounded-3xl h-[500px] md:h-[600px] lg:h-[calc(100vh-10rem)] overflow-hidden backdrop-blur-md shadow-2xl relative">
          
          {/* Active Chat Header */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-200/80 bg-white/80 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20 animate-pulse" />
              <div>
                <h3 className="text-slate-900 font-bold text-sm">AI Agent</h3>
                {/* <p className="text-[10px] text-slate-500">Replies strictly from your {files.filter(f => f.status === 'ready').length} documents</p> */}
              </div>
            </div>
            
            <button
              onClick={handleClearChat}
              className="p-1.5 md:p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors group/clear"
              title="Clear conversation"
            >
              <Trash2 className="w-4 h-4 md:w-5 md:h-5 transition-transform group-hover/clear:scale-110" />
            </button>
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
                    className={`max-w-[85%] relative group flex flex-col ${
                      msg.role === 'user'
                        ? (msg.image ? 'items-end' : 'gap-2 bg-slate-900 text-white p-3 rounded-2xl rounded-br-none shadow-lg shadow-slate-900/10')
                        : 'gap-2 bg-white border border-slate-200 text-slate-900 p-3 rounded-2xl rounded-bl-none shadow-lg'
                    }`}
                  >
                    
                    {/* Copy Button for Assistant messages */}
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleCopyToClipboard(msg.text, msg.id)}
                        className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-white/60 border border-slate-300 text-slate-600 hover:text-slate-900 transition-opacity z-10"
                        title="Copy to clipboard"
                      >
                        {copiedId === msg.id ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* User Sent Image rendering */}
                    {msg.image && (
                      <div 
                        onClick={() => setSelectedImage({ url: msg.image!, alt: 'Attached Image' })}
                        className={`relative max-w-[280px] overflow-hidden cursor-pointer group/userimg rounded-[16px] border border-slate-200/20 ${msg.text ? 'rounded-br-sm' : 'rounded-br-sm shadow-sm'}`}
                        title="Click to view fullscreen"
                      >
                        <img src={msg.image} alt="Uploaded attachment" className="object-cover w-full h-auto max-h-48 transition-transform duration-300 group-hover/userimg:scale-105" />
                        <div className="absolute inset-0 bg-slate-950/30 opacity-0 group-hover/userimg:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-xs bg-slate-900/80 px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 backdrop-blur-xs">
                            <Maximize2 className="w-3.5 h-3.5 text-violet-400" /> View Full
                          </span>
                        </div>
                        {/* Timestamp overlay when image ONLY */}
                        {!msg.text && msg.role === 'user' && (
                           <span suppressHydrationWarning className="absolute bottom-1.5 right-1.5 text-[9px] text-white/90 bg-black/40 backdrop-blur-md px-1.5 py-0.5 rounded-md font-mono z-10 pointer-events-none">
                             {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                           </span>
                        )}
                      </div>
                    )}

                    {/* Content Block (Text, Sources, Timestamp) */}
                    {(msg.text || msg.role === 'assistant') && (
                      <div className={`${
                        msg.role === 'user' && msg.image
                          ? 'bg-slate-900/95 backdrop-blur-md text-white p-3 rounded-2xl rounded-br-none shadow-xl shadow-slate-900/20 flex flex-col gap-2 relative z-10 -mt-4 border border-slate-700/50 w-full min-w-[120px]'
                          : 'flex flex-col gap-2 w-full'
                      }`}>
                        <div className="text-sm leading-relaxed selection:bg-violet-500/30 selection:text-slate-900">
                          {renderMessageText(msg.text, (url, alt) => setSelectedImage({ url, alt }))}
                        </div>

                        {/* Source citations rendering */}
                        {/* {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3.5 pt-3 border-t border-slate-300/80 flex flex-col gap-1.5">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                              References Used ({msg.sources.length})
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {msg.sources.map((src, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-white/80 border border-slate-300 rounded-md text-indigo-400"
                                  title={src.filename}
                                >
                                  <FileText className="w-3 h-3 text-slate-500" />
                                  <span className="max-w-[120px] truncate">{src.filename}</span>
                                  {src.page && <span className="text-slate-500">p.{src.page}</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )} */}

                        <span suppressHydrationWarning className={`text-[9px] self-end font-mono -mt-2 ${msg.role === 'user' ? 'text-slate-400' : 'text-slate-500'}`}>
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Simulated typing dot animation */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-100/80 border border-slate-300 rounded-2xl rounded-bl-none p-4 flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full dot-bounce" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Quick Suggested Questions & Prompt input Footer */}
          <div className="p-2 md:p-5 border-t border-slate-200 bg-white/80 flex-shrink-0 space-y-2">
            
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
                      className="text-left p-3 text-xs bg-slate-100/40 hover:bg-slate-100 border border-slate-300 hover:border-indigo-500/30 text-slate-700 hover:text-slate-900 rounded-xl transition-all shadow-sm flex items-start gap-2 group cursor-pointer"
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
               <div className="relative inline-flex items-center gap-2 bg-slate-100/90 border border-slate-300 rounded-xl p-2 mb-3 shadow-lg group">
                 <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-300 bg-white">
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
                 className="absolute left-3 sm:left-3 p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/40 transition-all z-10"
                 title="Attach product image"
               >
                 <Camera className="w-4 h-4" />
               </button>

               {/* Voice recording button */}
               <button
                 type="button"
                 onClick={isRecording ? stopRecording : startRecording}
                 disabled={isTyping}
                 className="absolute left-10 sm:left-12 p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/40 transition-all z-10"
                 title={isRecording ? 'Stop Recording' : 'Start Voice Recording'}
               >
                 {isRecording ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
               </button>

               {/* Detected language badge */}
               {detectedLang && (
                 <span className="absolute left-[88px] sm:left-[96px] top-[14px] text-[10px] text-slate-600 bg-slate-200/50 px-1.5 rounded uppercase">{detectedLang}</span>
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
                 className="w-full glass-input text-sm text-slate-900 pl-[72px] sm:pl-[88px] pr-14 py-3.5 rounded-2xl outline-none transition-all placeholder-slate-500"
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
      <footer className="border-t border-slate-200/60 py-5 bg-white/60 relative z-10 text-center text-slate-600 text-xs">
        <p>© 2026 TulipTech AI. Zero-knowledge isolated RAG environment. All data resides in private sandbox containers.</p>
      </footer>

      {/* Full-Screen Lightbox Modal for Image Zoom & Download */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6"
          >
            {/* Top Toolbar */}
            <div 
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl flex items-center justify-between text-white pb-3 border-b border-white/10 mb-3 sm:mb-4 px-2"
            >
              <div className="flex items-center gap-2 max-w-[55%]">
                <span className="font-semibold text-xs sm:text-base text-slate-100 truncate">
                  {selectedImage.alt || 'Product Image Preview'}
                </span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => downloadImage(selectedImage.url, `${selectedImage.alt || 'product-image'}.jpg`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-medium transition-all active:scale-95 shadow-sm"
                  title="Download image"
                >
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-violet-400" />
                  <span>Download</span>
                </button>
                <a
                  href={selectedImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-medium transition-all active:scale-95 shadow-sm"
                  title="Open original in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-violet-400" />
                  <span className="hidden sm:inline">Open URL</span>
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all ml-1 active:scale-95"
                  title="Close preview (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Centered Large Image */}
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-5xl max-h-[82vh] flex items-center justify-center rounded-2xl overflow-hidden shadow-2xl bg-black/40 border border-white/10"
            >
              <img
                src={selectedImage.url}
                alt={selectedImage.alt || 'Full size preview'}
                className="max-h-[80vh] max-w-[94vw] sm:max-w-[85vw] object-contain rounded-xl"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
