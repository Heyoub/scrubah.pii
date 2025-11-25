/**
 * Lightweight Document Structure Parser
 *
 * Alternative to tree-sitter: Uses regex to identify medical document sections
 * and provide context-aware scrubbing directives without complex grammar.
 *
 * Benefits:
 * - No WASM overhead
 * - Handles OCR errors gracefully
 * - Works across document formats
 * - Provides scrubbing context without parsing complexity
 */

export enum SectionType {
  // High PII risk - scrub aggressively
  DEMOGRAPHICS = 'demographics',
  CHIEF_COMPLAINT = 'chief_complaint',
  HISTORY = 'history',
  SOCIAL_HISTORY = 'social_history',
  FAMILY_HISTORY = 'family_history',

  // Medium PII risk - scrub names/dates only
  PHYSICAL_EXAM = 'physical_exam',
  REVIEW_OF_SYSTEMS = 'review_of_systems',

  // Low PII risk - minimal scrubbing
  VITALS = 'vitals',
  LAB_RESULTS = 'lab_results',
  MEDICATIONS = 'medications',
  ASSESSMENT = 'assessment',
  DIAGNOSES = 'diagnoses',

  // Unknown section
  UNKNOWN = 'unknown'
}

export interface DocumentSection {
  type: SectionType;
  startIndex: number;
  endIndex: number;
  content: string;
  scrubIntensity: 'high' | 'medium' | 'low';
}

export interface StructuredDocument {
  sections: DocumentSection[];
  documentType: 'soap_note' | 'lab_report' | 'imaging_report' | 'discharge_summary' | 'unknown';
}

/**
 * Section header patterns (fuzzy matching for OCR tolerance)
 */
const SECTION_PATTERNS = [
  // Demographics (HIGH PII)
  { pattern: /(?:PATIENT|PT\.?)\s+(?:NAME|INFORMATION|DEMOGRAPHICS)/i, type: SectionType.DEMOGRAPHICS, intensity: 'high' as const },
  { pattern: /(?:NAME|DOB|DATE\s+OF\s+BIRTH|ADDRESS|PHONE)/i, type: SectionType.DEMOGRAPHICS, intensity: 'high' as const },

  // Chief Complaint (HIGH PII - contains patient narrative)
  { pattern: /(?:CHIEF\s+COMPLAINT|CC|PRESENTING\s+PROBLEM)/i, type: SectionType.CHIEF_COMPLAINT, intensity: 'high' as const },

  // History sections (HIGH PII - patient stories)
  { pattern: /(?:HISTORY\s+OF\s+PRESENT\s+ILLNESS|HPI)/i, type: SectionType.HISTORY, intensity: 'high' as const },
  { pattern: /(?:SOCIAL\s+HISTORY|SH)/i, type: SectionType.SOCIAL_HISTORY, intensity: 'high' as const },
  { pattern: /(?:FAMILY\s+HISTORY|FH)/i, type: SectionType.FAMILY_HISTORY, intensity: 'high' as const },

  // Exam sections (MEDIUM PII)
  { pattern: /(?:PHYSICAL\s+EXAM|PE|EXAMINATION)/i, type: SectionType.PHYSICAL_EXAM, intensity: 'medium' as const },
  { pattern: /(?:REVIEW\s+OF\s+SYSTEMS|ROS)/i, type: SectionType.REVIEW_OF_SYSTEMS, intensity: 'medium' as const },

  // Structured data (LOW PII - mostly safe)
  { pattern: /(?:VITAL\s+SIGNS?|VITALS)/i, type: SectionType.VITALS, intensity: 'low' as const },
  { pattern: /(?:LAB\s+RESULTS?|LABORATORY|LABS)/i, type: SectionType.LAB_RESULTS, intensity: 'low' as const },
  { pattern: /(?:MEDICATIONS?|MEDS|PRESCRIPTIONS?)/i, type: SectionType.MEDICATIONS, intensity: 'low' as const },
  { pattern: /(?:ASSESSMENT|IMPRESSION)/i, type: SectionType.ASSESSMENT, intensity: 'low' as const },
  { pattern: /(?:DIAGNOS[IE]S|ICD-?\d+)/i, type: SectionType.DIAGNOSES, intensity: 'low' as const },
];

/**
 * Parse document into sections based on headers
 */
export const parseDocumentStructure = (text: string): StructuredDocument => {
  const sections: DocumentSection[] = [];
  const lines = text.split('\n');

  let currentSection: DocumentSection | null = null;
  let documentType: StructuredDocument['documentType'] = 'unknown';

  // Detect document type from first 500 chars
  const header = text.substring(0, 500).toUpperCase();
  if (/SOAP|SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN/.test(header)) {
    documentType = 'soap_note';
  } else if (/LAB\s+REPORT|CBC|METABOLIC|PANEL/.test(header)) {
    documentType = 'lab_report';
  } else if (/RADIOLOGY|IMAGING|X-RAY|CT|MRI/.test(header)) {
    documentType = 'imaging_report';
  } else if (/DISCHARGE|SUMMARY|ADMISSION/.test(header)) {
    documentType = 'discharge_summary';
  }

  lines.forEach((line, lineIndex) => {
    // Check if line is a section header
    for (const { pattern, type, intensity } of SECTION_PATTERNS) {
      if (pattern.test(line)) {
        // Save previous section
        if (currentSection) {
          sections.push(currentSection);
        }

        // Start new section
        const startIndex = text.indexOf(line);
        currentSection = {
          type,
          startIndex,
          endIndex: text.length, // Will be updated when next section starts
          content: '',
          scrubIntensity: intensity
        };
        break;
      }
    }

    // Add line to current section
    if (currentSection) {
      currentSection.content += line + '\n';
    }
  });

  // Add final section
  if (currentSection) {
    sections.push(currentSection);
  }

  // Update endIndex for all sections
  sections.forEach((section, i) => {
    if (i < sections.length - 1) {
      section.endIndex = sections[i + 1].startIndex;
    }
  });

  // If no sections found, treat entire document as UNKNOWN (high intensity)
  if (sections.length === 0) {
    sections.push({
      type: SectionType.UNKNOWN,
      startIndex: 0,
      endIndex: text.length,
      content: text,
      scrubIntensity: 'high'
    });
  }

  return { sections, documentType };
};

/**
 * Get scrubbing configuration based on section type
 */
export const getScrubConfigForSection = (section: DocumentSection) => {
  switch (section.scrubIntensity) {
    case 'high':
      return {
        skipML: false,           // Use full ML inference
        aggressiveRegex: true,   // Use all regex patterns
        confidenceThreshold: 0.75 // Lower threshold (more aggressive)
      };

    case 'medium':
      return {
        skipML: false,
        aggressiveRegex: true,
        confidenceThreshold: 0.85 // Standard threshold
      };

    case 'low':
      return {
        skipML: true,            // Skip ML (regex only for speed)
        aggressiveRegex: false,  // Only scrub explicit PII patterns
        confidenceThreshold: 0.95 // High threshold (less aggressive)
      };

    default:
      return {
        skipML: false,
        aggressiveRegex: true,
        confidenceThreshold: 0.85
      };
  }
};

/**
 * Example usage:
 *
 * const structured = parseDocumentStructure(rawText);
 *
 * for (const section of structured.sections) {
 *   const config = getScrubConfigForSection(section);
 *
 *   if (config.skipML) {
 *     // Fast path: regex only for lab values, medications
 *     result = await piiScrubber.scrub(section.content, { regexOnly: true });
 *   } else {
 *     // Full scrubbing for patient narratives
 *     result = await piiScrubber.scrub(section.content);
 *   }
 * }
 */
