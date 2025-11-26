
import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Github,
  Mail,
  Cpu,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import JSZip from 'jszip';
import { clsx } from 'clsx';

import { DropZone } from './components/DropZone';
import { StatusBoard } from './components/StatusBoard';
import { runParseFile as parseFile } from './services/fileParser.effect';
import { loadModel, runScrubPII as scrubPII } from './services/piiScrubber.effect';
import { formatToMarkdownSync as formatToMarkdown } from './services/markdownFormatter.effect';
import { runBuildMasterTimeline as buildMasterTimeline } from './services/timelineOrganizer.effect';
import { db } from './services/db';
import { ProcessedFile, ProcessingStage } from './schemas/schemas';

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isGeneratingTimeline, setIsGeneratingTimeline] = useState(false);

  useEffect(() => {
    const initModel = async () => {
      setModelLoading(true);
      setModelError(null);
      try {
        await loadModel();
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error loading ML model';
        console.error("Model failed to load", e);
        setModelError(errorMsg);
      } finally {
        setModelLoading(false);
      }
    };
    initModel();

    db.files.toArray().then(savedFiles => {
      if (savedFiles.length > 0) {
        setFiles(savedFiles);
      }
    });
  }, []);

  const handleFilesDropped = useCallback(async (droppedFiles: File[]) => {
    if (!modelLoading) {
      loadModel().catch(console.error);
    }

    const newFiles: ProcessedFile[] = droppedFiles.map(f => ({
      id: crypto.randomUUID(),
      originalName: f.name,
      size: f.size,
      type: f.type,
      stage: ProcessingStage.QUEUED
    }));

    setFiles(prev => [...prev, ...newFiles]);
    processQueue(droppedFiles, newFiles);
  }, [modelLoading]);

  const processQueue = async (rawFiles: File[], fileEntries: ProcessedFile[]) => {
    setIsProcessing(true);

    for (let i = 0; i < rawFiles.length; i++) {
      const rawFile = rawFiles[i];
      const fileEntry = fileEntries[i];
      const startTime = performance.now();

      try {
        // 1. Parsing Stage
        updateFileStatus(fileEntry.id, ProcessingStage.PARSING);
        const rawText = await parseFile(rawFile);

        // 2. Scrubbing Stage
        updateFileStatus(fileEntry.id, ProcessingStage.SCRUBBING, { rawText });
        const scrubResult = await scrubPII(rawText);

        // 3. Formatting Stage
        updateFileStatus(fileEntry.id, ProcessingStage.FORMATTING);

        const processingTimeMs = performance.now() - startTime;
        const markdown = formatToMarkdown(fileEntry, scrubResult, processingTimeMs);

        const stats = {
          piiRemovedCount: scrubResult.count,
          processingTimeMs
        };

        const completedFile = {
          ...fileEntry,
          stage: ProcessingStage.COMPLETED,
          scrubbedText: scrubResult.text,
          markdown,
          stats
        };

        updateFileState(fileEntry.id, completedFile);
        await db.files.put(completedFile);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${fileEntry.originalName}`, error);
        updateFileStatus(fileEntry.id, ProcessingStage.ERROR, { error: errorMessage });
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

  const handleRetryModelLoad = async () => {
    setModelLoading(true);
    setModelError(null);
    try {
      await loadModel();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error loading ML model';
      console.error("Model failed to load", e);
      setModelError(errorMsg);
    } finally {
      setModelLoading(false);
    }
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
    const processed = files.filter(f => f.stage === ProcessingStage.COMPLETED && f.markdown);

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

  const handleGenerateTimeline = async () => {
    const completedFiles = files.filter(f => f.stage === ProcessingStage.COMPLETED && f.scrubbedText);

    if (completedFiles.length === 0) {
      alert('No processed files to compile. Please process some documents first.');
      return;
    }

    setIsGeneratingTimeline(true);

    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📊 Generating master timeline from ${completedFiles.length} documents...`);
      }
      const timeline = await buildMasterTimeline(completedFiles);

      // Download automatically
      const blob = new Blob([timeline.markdown], { type: 'text/markdown; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Medical_Timeline_${new Date().toISOString().split('T')[0]}.md`;
      a.click();
      URL.revokeObjectURL(url);

      if (process.env.NODE_ENV !== 'production') {
        console.log('✅ Master timeline generated successfully!');
        console.log(`📈 Stats: ${timeline.summary.totalDocuments} total, ${timeline.summary.uniqueDocuments} unique, ${timeline.summary.duplicates} duplicates`);
      }

    } catch (error) {
      console.error('Error generating timeline:', error);
      alert('Failed to generate timeline. Check console for details.');
    } finally {
      setIsGeneratingTimeline(false);
    }
  };

  const completedCount = files.filter(f => f.stage === ProcessingStage.COMPLETED).length;

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
                {modelLoading ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin text-accent-600" />
                    <span className="text-xs font-bold">LOADING_MODEL...</span>
                  </>
                ) : modelError ? (
                  <>
                    <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
                    <span className="text-xs font-bold text-rose-600">MODEL_ERROR</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                    <span className="text-xs font-bold">SYSTEM_READY</span>
                  </>
                )}
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
            SANITIZE YOUR DATA. <br />
            <span className="text-zinc-400">KEEP IT LOCAL.</span>
          </h2>
          <p className="text-lg font-mono text-zinc-600 max-w-2xl leading-relaxed">
            <span className="bg-black text-white px-1 font-bold mr-1">ZERO-TRUST</span>
            pipeline. Scrub Personally Identifiable Information (PII) from contracts, records, and transcripts using on-device AI.
            Format for LLMs without leaking secrets.
          </p>
        </div>

        {/* Important Disclaimer */}
        <div className="bg-amber-50 border-l-4 border-amber-500 p-5 mb-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-3">
              <h3 className="font-bold text-amber-900 uppercase tracking-tight text-sm">
                Important: Always Verify Before Sharing
              </h3>
              <div className="text-sm text-amber-800 space-y-2">
                <p>
                  <strong>This tool uses AI and pattern matching which may not catch all PII.</strong> No automated system is 100% accurate.
                  You are responsible for reviewing all output before sharing or submitting to any external service.
                </p>
                <p>
                  <strong>Always manually verify:</strong> Use <kbd className="bg-amber-200 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+F</kbd> (Windows/Linux)
                  or <kbd className="bg-amber-200 px-1.5 py-0.5 rounded text-xs font-mono">Cmd+F</kbd> (Mac) to search for names, dates, addresses,
                  and other sensitive information that may have been missed.
                </p>
                <p className="text-xs text-amber-700 pt-1 border-t border-amber-200">
                  <strong>Zero-Trust Architecture:</strong> All processing happens locally in your browser. No data is sent to any server.
                  However, this does not constitute legal or compliance advice. Consult your compliance officer before using
                  scrubbed documents for HIPAA, GDPR, or other regulated purposes. By using this tool, you accept full responsibility
                  for verifying the completeness of PII removal.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {modelError && (
          <div className="bg-rose-50 border-2 border-rose-600 p-6 mb-8 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-rose-900 mb-1 uppercase tracking-tight">
                  ML Model Failed to Load
                </h3>
                <p className="text-sm font-mono text-rose-800 mb-3">
                  {modelError}
                </p>
                <p className="text-xs text-rose-700 mb-3">
                  The app will still work with regex-based PII detection, but ML-powered entity recognition (names, locations, organizations) will be unavailable.
                </p>
                <button
                  onClick={handleRetryModelLoad}
                  disabled={modelLoading}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase bg-rose-600 text-white border-2 border-rose-800 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <RefreshCw className={clsx("w-4 h-4", modelLoading && "animate-spin")} />
                  Retry Model Load
                </button>
              </div>
            </div>
          </div>
        )}

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

            <div className="flex gap-3">
              <button
                onClick={handleGenerateTimeline}
                disabled={completedCount === 0 || isGeneratingTimeline}
                className={clsx(
                  "flex items-center gap-2 px-6 py-3 font-bold uppercase tracking-wide border-2 shadow-hard hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all",
                  completedCount > 0 && !isGeneratingTimeline
                    ? "bg-emerald-600 text-white border-black"
                    : "bg-zinc-200 text-zinc-400 border-zinc-300 shadow-none cursor-not-allowed"
                )}
              >
                {isGeneratingTimeline ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Compiling...
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" />
                    Generate Timeline ({completedCount})
                  </>
                )}
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
            <span className="font-bold text-black">© 2025 Forgestack.app</span>
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