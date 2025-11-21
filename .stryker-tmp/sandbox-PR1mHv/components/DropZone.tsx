// @ts-nocheck

import React, { useCallback, useState } from 'react';
import { Upload, FilePlus, FileType, TerminalSquare, ScanLine, FileSpreadsheet } from 'lucide-react';
import { clsx } from 'clsx';

interface DropZoneProps {
  onFilesDropped: (files: File[]) => void;
  isProcessing: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFilesDropped, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      onFilesDropped(droppedFiles);
    }
  }, [onFilesDropped]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesDropped(Array.from(e.target.files));
    }
  }, [onFilesDropped]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={clsx(
        "relative bg-white neo-border p-12 transition-all duration-150 ease-out flex flex-col items-center justify-center text-center cursor-pointer group",
        isDragging 
          ? "shadow-hard translate-x-[2px] translate-y-[2px] bg-slate-50" 
          : "hover:shadow-hard hover:-translate-y-[2px] hover:-translate-x-[2px]",
        isProcessing && "opacity-50 cursor-not-allowed pointer-events-none grayscale"
      )}
    >
      <input
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.csv,.md,.png,.jpg,.jpeg,.webp"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        disabled={isProcessing}
      />
      
      <div className={clsx(
        "p-4 neo-border mb-6 transition-colors",
        isDragging ? "bg-black text-white" : "bg-white text-black group-hover:bg-accent-400 group-hover:text-white"
      )}>
        {isDragging ? (
          <FilePlus className="w-8 h-8" />
        ) : (
          <Upload className="w-8 h-8" />
        )}
      </div>
      
      <h3 className="text-2xl font-bold text-black mb-2 font-sans tracking-tight uppercase">
        {isDragging ? "Deploy Files Here" : "Initiate Ingest"}
      </h3>
      
      <p className="text-sm text-zinc-500 font-mono max-w-xs mb-6">
        Drag & Drop sensitive documents. <br/>
        <span className="bg-zinc-100 px-1">OMNI-PARSER ACTIVE</span>
      </p>
      
      <div className="flex flex-wrap justify-center gap-3 text-xs font-mono font-bold text-zinc-600 uppercase">
        <span className="flex items-center gap-1 px-2 py-1 border border-zinc-300 bg-zinc-50"><FileType className="w-3 h-3" /> PDF/DOCX</span>
        <span className="flex items-center gap-1 px-2 py-1 border border-zinc-300 bg-zinc-50"><ScanLine className="w-3 h-3" /> OCR/IMG</span>
        <span className="flex items-center gap-1 px-2 py-1 border border-zinc-300 bg-zinc-50"><FileSpreadsheet className="w-3 h-3" /> CSV/MD</span>
      </div>
    </div>
  );
};
