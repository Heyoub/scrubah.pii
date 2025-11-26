
import React from 'react';
import { ProcessedFile, ProcessingStage } from '../schemas/schemas';
import {
  Loader2,
  CheckSquare,
  AlertOctagon,
  Activity,
  Cpu,
  Download
} from 'lucide-react';
import { clsx } from 'clsx';

interface StatusBoardProps {
  files: ProcessedFile[];
  onDownload?: (file: ProcessedFile) => void;
}

export const StatusBoard: React.FC<StatusBoardProps> = ({ files, onDownload }) => {
  if (files.length === 0) return null;

  return (
    <div className="bg-white neo-border shadow-hard-sm overflow-hidden">
      <div className="bg-black text-white px-4 py-3 border-b-2 border-black flex justify-between items-center">
        <h3 className="font-bold font-mono flex items-center gap-2 uppercase tracking-wider text-sm">
          <Activity className="w-4 h-4" />
          System_Status
        </h3>
        <span className="text-xs font-bold bg-white text-black px-2 py-0.5 border border-black">
          BATCH_SIZE: {files.length}
        </span>
      </div>

      <div className="divide-y-2 divide-black font-mono text-sm">
        {files.map((file) => (
          <div key={file.id} className="px-4 py-3 flex items-center gap-4 hover:bg-zinc-50 transition-colors group">

            {/* Status Indicator */}
            <div className="shrink-0">
              {file.stage === ProcessingStage.COMPLETED ? (
                <CheckSquare className="w-5 h-5 text-emerald-600" />
              ) : file.stage === ProcessingStage.ERROR ? (
                <AlertOctagon className="w-5 h-5 text-rose-600" />
              ) : (
                <Loader2 className="w-5 h-5 text-accent-600 animate-spin" />
              )}
            </div>

            {/* File Info */}
            <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center">
              <div className="col-span-5 truncate font-bold text-black">
                {file.originalName}
              </div>

              <div className="col-span-4 flex items-center gap-2">
                {/* Brutalist Progress Bar */}
                <div className="h-3 w-full border border-black bg-white p-[1px]">
                  <div
                    className={clsx(
                      "h-full transition-all duration-300 ease-linear",
                      file.stage === ProcessingStage.ERROR ? "bg-rose-600" :
                        file.stage === ProcessingStage.COMPLETED ? "bg-emerald-600" : "bg-accent-600 repeating-stripes"
                    )}
                    style={{ width: getProgressWidth(file.stage) }}
                  />
                </div>
              </div>

              <div className="col-span-3 text-right text-xs text-zinc-500">
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>

            {/* Action/Stats */}
            <div className="text-right shrink-0 min-w-[140px] flex items-center gap-2 justify-end">
              <div>
                {file.stage === ProcessingStage.COMPLETED ? (
                  <div className="flex flex-col items-end">
                    <span className="bg-emerald-100 text-emerald-800 px-1 border border-emerald-800 text-[10px] font-bold">CLEAN</span>
                    {file.stats && (
                      <span className="text-[10px] mt-1 text-zinc-500">
                        -{file.stats.piiRemovedCount} Entities
                      </span>
                    )}
                  </div>
                ) : file.stage === ProcessingStage.ERROR ? (
                  <span className="bg-rose-100 text-rose-800 px-1 border border-rose-800 text-[10px] font-bold">FAIL</span>
                ) : (
                  <div className="flex flex-col items-end">
                    <span className="bg-accent-100 text-accent-800 px-1 border border-accent-800 text-[10px] font-bold animate-pulse">{file.stage}</span>
                    <span className="text-[10px] mt-1 flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> Processing
                    </span>
                  </div>
                )}
              </div>

              {/* Download Button */}
              {file.stage === ProcessingStage.COMPLETED && onDownload && (
                <button
                  onClick={() => onDownload(file)}
                  className="p-2 border-2 border-black bg-white hover:bg-black hover:text-white transition-all"
                  title="Download this file"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Log Footer */}
      <div className="bg-zinc-100 border-t-2 border-black px-4 py-2 text-[10px] font-mono text-zinc-500 uppercase flex justify-between">
        <span>Engine: Scrubah.PII-v1</span>
        <span>Mem: OK</span>
      </div>
    </div>
  );
};

const getProgressWidth = (stage: ProcessingStage): string => {
  switch (stage) {
    case ProcessingStage.QUEUED: return '5%';
    case ProcessingStage.PARSING: return '25%';
    case ProcessingStage.SCRUBBING: return '60%';
    case ProcessingStage.FORMATTING: return '85%';
    case ProcessingStage.COMPLETED: return '100%';
    case ProcessingStage.ERROR: return '100%';
    default: return '0%';
  }
};