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
  scrubbedText?: string;
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
  text: string;
  replacements: PIIMap;
  count: number;
}