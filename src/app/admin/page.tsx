'use client';

import React, { useState } from 'react';
import { UploadCloud, FileText, CheckCircle, XCircle, Loader2, Database, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useUpload } from '@/components/UploadContext';

export default function AdminDashboard() {
  const { files, handleFiles, handleDeleteFile, validationError } = useUpload();
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(Array.from(e.target.files));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 md:px-10">
      <div className="w-full max-w-4xl bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
              <Database className="w-6 h-6 text-violet-600" />
              Admin Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">Manage product catalogs and knowledge bases</p>
          </div>
          <Link href="/" className="px-5 py-2.5 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 rounded-xl font-medium transition-all duration-200">
            Back to Chat
          </Link>
        </div>

        <div className="p-8">
          {validationError && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium flex items-start gap-3 border border-red-100">
              <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Upload Area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
              relative w-full rounded-2xl border-2 border-dashed transition-all duration-300 ease-out group p-10
              flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 hover:bg-violet-50/30
              ${dragActive ? 'border-violet-500 bg-violet-50/50 scale-[1.01]' : 'border-slate-200 hover:border-violet-300'}
            `}
          >
            <input
              type="file"
              multiple
              onChange={handleFileInput}
              accept=".pdf,.docx,.txt,.csv,.json"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              title="Click or drag to upload files"
            />
            <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 border border-slate-100">
              <UploadCloud className="w-8 h-8 text-violet-500" />
            </div>
            <p className="text-lg font-semibold text-slate-700 mb-1">Upload Product Catalog or Document</p>
            <p className="text-sm text-slate-500">Drag & drop JSON, CSV, PDF, XLSX, DOCX files here</p>
          </div>

          {/* Uploads List */}
          {files.length > 0 && (
            <div className="mt-10 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Processing Pipeline</h3>
              {files.map((item) => (
                <div key={item.id} className="group relative p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0 pr-10">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-sm font-semibold text-slate-800 truncate pr-4">{item.name}</p>
                        <p className="text-xs font-medium text-slate-500 flex-shrink-0">
                          {item.status === 'ready' ? 'Complete' : `${item.progress}%`}
                        </p>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ease-out ${
                            item.status === 'failed' ? 'bg-red-500' :
                            item.status === 'ready' ? 'bg-emerald-500' :
                            'bg-violet-600 relative overflow-hidden'
                          }`}
                          style={{ width: `${Math.max(item.progress, 2)}%` }}
                        >
                          {item.status !== 'failed' && item.status !== 'ready' && (
                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                          )}
                        </div>
                      </div>

                      {/* Status Text */}
                      <div className="flex items-center gap-2 mt-2">
                        {item.status === 'ready' && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                        {item.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                        {item.status !== 'ready' && item.status !== 'failed' && <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />}
                        
                        <p className={`text-xs font-medium ${
                          item.status === 'failed' ? 'text-red-600' : 
                          item.status === 'ready' ? 'text-emerald-600' : 
                          'text-violet-600'
                        }`}>
                          {item.status === 'failed' ? item.errorMessage :
                           item.status === 'ready' ? 'Processing Complete! Now searchable in Chat.' :
                           item.status === 'uploading' ? 'Uploading to cloud...' :
                           item.status === 'extracting' ? 'Extracting catalog data...' :
                           item.status === 'embedding' ? `Processing batch data (${item.progress}%)...` :
                           'Finalizing index...'}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Delete Button */}
                  <button
                    onClick={() => handleDeleteFile(item)}
                    className="absolute top-1/2 -translate-y-1/2 right-4 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete file"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
