
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Download, 
  RefreshCw, 
  ShieldAlert, 
  Trash2, 
  Github,
  Mail,
  Cpu
} from 'lucide-react';
import JSZip from 'jszip';
import { clsx } from 'clsx';

import { DropZone } from './components/DropZone';
import { StatusBoard } from './components/StatusBoard';
import { runParseFile } from './services/fileParser.effect';
import { runScrubPII } from './services/piiScrubber.effect';
import { formatToMarkdown } from './services/markdownFormatter';
import { db } from './services/db';
import type { ProcessedFile, ProcessingStage } from './schemas';

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Load saved files from IndexedDB
    db.files.toArray().then(savedFiles => {
      if (savedFiles.length > 0) {
        setFiles(savedFiles);
      }
    });
  }, []);

  const handleFilesDropped = useCallback(async (droppedFiles: File[]) => {
    // Effect-TS handles model loading automatically

    const newFiles: ProcessedFile[] = droppedFiles.map(f => ({
      id: crypto.randomUUID(),
      originalName: f.name,
      size: f.size,
      type: f.type,
      stage: "QUEUED" as const
    }));

    setFiles(prev => [...prev, ...newFiles]);
    processQueue(droppedFiles, newFiles);
  }, []);

  const processQueue = async (rawFiles: File[], fileEntries: ProcessedFile[]) => {
    setIsProcessing(true);

    for (let i = 0; i < rawFiles.length; i++) {
      const rawFile = rawFiles[i];
      const fileEntry = fileEntries[i];
      const startTime = performance.now();

      try {
        // 1. Parsing Stage
        updateFileStatus(fileEntry.id, "PARSING");
        const rawText = await runParseFile(rawFile);

        // 2. Scrubbing Stage
        updateFileStatus(fileEntry.id, "SCRUBBING", { rawText });
        const scrubResult = await runScrubPII(rawText);

        // 3. Formatting Stage
        updateFileStatus(fileEntry.id, "FORMATTING");
        
        const processingTimeMs = performance.now() - startTime;
        const markdown = formatToMarkdown(fileEntry, scrubResult, processingTimeMs);

        const stats = {
          piiRemovedCount: scrubResult.count,
          processingTimeMs
        };

        const completedFile = {
          ...fileEntry,
          stage: "COMPLETED",
          scrubbedText: scrubResult.text,
          markdown,
          stats
        };
        
        updateFileState(fileEntry.id, completedFile);
        await db.files.put(completedFile);

      } catch (error: any) {
        console.error(`Error processing ${fileEntry.originalName}`, error);
        updateFileStatus(fileEntry.id, "ERROR", { error: error.message });
      }
    }

    setIsProcessing(false);
  };

  const updateFileStatus = (id: string, stage: ProcessingStage, updates: Partial<ProcessedFile> = {}) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, stage, ...updates } : f));
  };

  const updateFileState = (id: string, fullFile: ProcessedFile) => {
    setFiles(prev => prev.map(f => f.id === id ? fullFile : f));
  };


  const handleClearAll = async () => {
    if (window.confirm("PURGE MEMORY?\nThis will permanently delete all processed files from this session.")) {
      setFiles([]);
      await db.files.clear();
    }
  };

  const handleDownloadSingle = (file: ProcessedFile) => {
    if (!file.markdown) return;
    const blob = new Blob([file.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Scrubbed_${file.originalName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const processed = files.filter(f => f.stage === "COMPLETED" && f.markdown);
    
    if (processed.length === 0) return;

    processed.forEach(f => {
      zip.file(`Scrubbed_${f.originalName}.md`, f.markdown || '');
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Scrubah_Export_${new Date().toISOString().split('T')[0]}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const completedCount = files.filter(f => f.stage === "COMPLETED").length;

  return (
    <div className="min-h-screen bg-[#f0f0f0] font-sans text-zinc-900 pb-20 selection:bg-black selection:text-white">
      {/* Brutalist Header */}
      <header className="bg-white border-b-2 border-black sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black p-2 shadow-[4px_4px_0px_0px_rgba(99,102,241,1)]">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
               <h1 className="text-2xl font-black tracking-tighter uppercase leading-none">
                Scrubah<span className="text-accent-600">.PII</span>
              </h1>
              <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-500 uppercase">Forensic Data Sanitizer</span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
             <div className="hidden md:flex flex-col text-right">
                <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase">Status</span>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  <span className="text-xs font-bold">SYSTEM_READY</span>
                </div>
             </div>
             
             <a href="https://github.com/Heyoub" target="_blank" rel="noreferrer" className="p-2 border-2 border-transparent hover:border-black hover:bg-zinc-100 transition-all rounded-sm">
                <Github className="w-5 h-5" />
             </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-10">
        
        {/* Hero Section */}
        <div className="space-y-4 mb-12">
          <h2 className="text-4xl md:text-5xl font-black text-black tracking-tight leading-[0.9]">
            SANITIZE YOUR DATA. <br/>
            <span className="text-zinc-400">KEEP IT LOCAL.</span>
          </h2>
          <p className="text-lg font-mono text-zinc-600 max-w-2xl leading-relaxed">
            <span className="bg-black text-white px-1 font-bold mr-1">ZERO-TRUST</span>
            pipeline. Scrub Personally Identifiable Information (PII) from contracts, records, and transcripts using on-device AI.
            Format for LLMs without leaking secrets.
          </p>
        </div>

        {/* Action Area */}
        <DropZone onFilesDropped={handleFilesDropped} isProcessing={isProcessing} />

        {/* Controls */}
        {files.length > 0 && (
          <div className="flex justify-between items-center pt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <button
              onClick={handleClearAll}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold font-mono uppercase border-2 border-transparent hover:border-rose-600 hover:text-rose-600 hover:bg-rose-50 transition-all disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Purge_Buffer
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={completedCount === 0}
              className={clsx(
                "flex items-center gap-2 px-6 py-3 font-bold uppercase tracking-wide border-2 border-black shadow-hard hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all",
                completedCount > 0 
                  ? "bg-accent-600 text-white border-black" 
                  : "bg-zinc-200 text-zinc-400 border-zinc-300 shadow-none cursor-not-allowed"
              )}
            >
              <Download className="w-4 h-4" />
              Download Bundle ({completedCount})
            </button>
          </div>
        )}

        <StatusBoard files={files} onDownload={handleDownloadSingle} />

        {/* Footer / Info */}
        <div className="mt-20 border-t-2 border-zinc-200 pt-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-zinc-400 font-mono text-xs">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                <span>Local_WASM_Runtime</span>
            </div>
            <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                <span>Hybrid_Scrub_v1</span>
            </div>
          </div>
          
          <div className="flex flex-col md:items-end gap-1">
            <span className="font-bold text-black">© 2024 Forgestack.app</span>
            <a href="mailto:hello@forgestack.app" className="hover:text-accent-600 flex items-center gap-1">
                <Mail className="w-3 h-3" /> hello@forgestack.app
            </a>
          </div>
        </div>

      </main>
    </div>
  );
};

export default App;