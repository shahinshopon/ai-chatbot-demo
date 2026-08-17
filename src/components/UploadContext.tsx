'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { getAnonymousUser } from '@/utils/firebase';

interface FileItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'extracting' | 'embedding' | 'indexing' | 'ready' | 'failed';
  errorMessage?: string;
  dbId?: string;
}

interface UploadContextType {
  files: FileItem[];
  userUid: string;
  handleFiles: (incomingFiles: File[]) => void;
  handleDeleteFile: (item: FileItem) => Promise<void>;
  validationError: string | null;
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [userUid, setUserUid] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getAnonymousUser();
        setUserUid(user.uid);
      } catch (err) {
        console.error('Failed to get anonymous user:', err);
      }
    };
    fetchUser();
  }, []);

  const updateFileState = (id: string, updates: Partial<FileItem>) => {
    setFiles((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const processFilePipeline = async (file: File, fileId: string, currentUid: string) => {
    try {
      updateFileState(fileId, { progress: 5, status: 'uploading' });

      // Step 1: Upload File
      const formData = new FormData();
      formData.append('user_uid', currentUid);
      
      const isLargeFile = file.size > 4 * 1024 * 1024;
      if (isLargeFile) {
        formData.append('direct_filename', file.name);
        formData.append('direct_file_size', file.size.toString());
      } else {
        formData.append('file', file);
      }

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'x-user-uid': currentUid },
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Upload failed');
      const docData = await uploadRes.json();
      const dbId = docData.id;

      updateFileState(fileId, { progress: 20, status: 'extracting', dbId });

      // Step 2: Init Parsing
      const initRes = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-uid': currentUid },
        body: JSON.stringify({ document_id: dbId, user_uid: currentUid, action: 'init' }),
      });
      if (!initRes.ok) throw new Error('Parsing failed');
      const initData = await initRes.json();

      // Step 3: Client-Side Batching
      if (initData.type === 'products') {
        const products = initData.products;
        updateFileState(fileId, { status: 'embedding' });

        const batchSize = 10;
        let processedCount = 0;

        for (let i = 0; i < products.length; i += batchSize) {
          const batch = products.slice(i, i + batchSize);
          const batchRes = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-uid': currentUid },
            body: JSON.stringify({ document_id: dbId, user_uid: currentUid, action: 'batch_products', products: batch }),
          });
          
          if (!batchRes.ok) {
            const errData = await batchRes.json().catch(() => ({}));
            throw new Error(`Batch ${i / batchSize + 1} failed: ${errData.error || 'Unknown error'}`);
          }
          processedCount += batch.length;
          const progress = 20 + Math.floor((processedCount / products.length) * 75);
          updateFileState(fileId, { progress });
        }
      } else if (initData.type === 'chunks') {
        const chunks = initData.chunks;
        updateFileState(fileId, { status: 'embedding' });

        const batchSize = 20;
        let processedCount = 0;

        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const batchRes = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-uid': currentUid },
            body: JSON.stringify({ document_id: dbId, user_uid: currentUid, action: 'batch_chunks', chunks: batch, startIndex: i, pageCount: initData.pageCount, filename: initData.filename }),
          });
          
          if (!batchRes.ok) {
            const errData = await batchRes.json().catch(() => ({}));
            throw new Error(`Batch ${i / batchSize + 1} failed: ${errData.error || 'Unknown error'}`);
          }
          processedCount += batch.length;
          const progress = 20 + Math.floor((processedCount / chunks.length) * 75);
          updateFileState(fileId, { progress });
        }
      }

      // Step 4: Complete
      updateFileState(fileId, { status: 'indexing' });
      await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-uid': currentUid },
        body: JSON.stringify({ document_id: dbId, user_uid: currentUid, action: 'complete' }),
      });

      updateFileState(fileId, { progress: 100, status: 'ready' });
    } catch (err: any) {
      console.error(`Pipeline error for ${file.name}:`, err);
      updateFileState(fileId, { status: 'failed', progress: 100, errorMessage: err.message || 'Processing failed.' });
    }
  };

  const handleFiles = (incomingFiles: File[]) => {
    setValidationError(null);

    incomingFiles.forEach((file) => {
      const MAX_SIZE = 20 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        setValidationError(`File ${file.name} exceeds the 20MB limit.`);
        return;
      }

      const fileId = 'file_' + Math.random().toString(36).substring(2, 15);
      setFiles((prev) => [{ id: fileId, name: file.name, size: file.size, status: 'uploading', progress: 0 }, ...prev]);
      
      // Use current userUid if available, otherwise it's handled in useEffect
      processFilePipeline(file, fileId, userUid);
    });
  };

  const handleDeleteFile = async (item: FileItem) => {
    setFiles((prev) => prev.filter((f) => f.id !== item.id));
    if (item.dbId) {
      await fetch(`/api/files/${item.dbId}?user_uid=${userUid}`, {
        method: 'DELETE',
        headers: { 'x-user-uid': userUid },
      });
    }
  };

  return (
    <UploadContext.Provider value={{ files, userUid, handleFiles, handleDeleteFile, validationError, setValidationError }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider');
  }
  return context;
}
