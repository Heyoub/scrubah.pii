import { ScrubbedText } from './schemas/phi';

export enum ProcessingStage {
  QUEUED = 'QUEUED',
  PARSING = 'PARSING',
  SCRUBBING = 'SCRUBBING',
  FORMATTING = 'FORMATTING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ProcessedFile {
  id: string;
  originalName: string;
  size: number;
  type: string;
  stage: ProcessingStage;
  rawText?: string;
  scrubbedText?: ScrubbedText;
  markdown?: string;
  error?: string;
  stats?: {
    piiRemovedCount: number;
    processingTimeMs: number;
  };
}

export interface PIIMap {
  [original: string]: string;
}

export interface ScrubResult {
  text: ScrubbedText;
  replacements: PIIMap;
  count: number;
  /** Confidence score (0-100) from multi-pass validation */
  confidence?: number;
}