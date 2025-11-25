/**
 * PII SCRUBBER WEB WORKER
 *
 * Offloads heavy regex processing to a background thread.
 * Prevents UI freezing when processing large documents.
 *
 * Note: ML inference (BERT) still runs on main thread due to WebGL requirements.
 * This worker handles regex-based scrubbing which is the bulk of processing.
 */

import { AuditCollector, AuditReport } from './auditCollector';

// ============================================================================
// PATTERNS (duplicated here since workers have separate scope)
// ============================================================================

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
]);

const PATTERNS = {
  EMAIL: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g,
  PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  SSN_PARTIAL: /\b(?:last\s*4|xxx-xx-)\s*[-:]?\s*\d{4}\b/gi,
  DATE: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  DATE_WRITTEN: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  DATE_WRITTEN_ALT: /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s+\d{4})?\b/gi,
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g,
  AGE: /\b\d{1,3}\s*(?:year[s]?\s*old|y\.?o\.?|yo|yr[s]?(?:\s*old)?)\b/gi,
  AGE_CONTEXT: /\b(?:age[d]?|DOB\s+indicates)\s*[:\s]*\d{1,3}\b/gi,
  ADDRESS: /\d+\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Parkway|Pkwy|Way|Circle|Cir|Place|Pl|Terrace|Ter)(?:\.|\s|,|\s+Apt|\s+Suite|\s+Unit|\s+#)?(?:\s*[A-Za-z0-9#-]*)?/gi,
  CITY_STATE: /\b[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\b/g,
  PO_BOX: /P\.?\s*O\.?\s*Box\s+\d+/gi,
  ALL_CAPS_NAME: /\b[A-Z]{2,}(?:,?\s+[A-Z]{2,})+\b/g,
  ALL_CAPS_SINGLE: /\b[A-Z]{3,}\b/g,
  LAST_FIRST_NAME: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  NAME_APOSTROPHE: /\b(?:O'|Mc|Mac)?[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)+\b/g,
  NAME_WITH_SUFFIX: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+(?:Jr\.?|Sr\.?|II|III|IV|V)\b/g,
  INSURANCE_ID: /\b(?:policy|member|subscriber|group|insurance)\s*(?:#|number|id|no)?[:\s]*[A-Z0-9]{6,15}\b/gi
};

const WHITELIST_ACRONYMS = new Set([
  'CBC', 'MRI', 'CAT', 'EKG', 'ECG', 'EEG', 'EMG', 'ICU', 'CCU', 'NICU', 'PICU', 'ER', 'OR', 'ED',
  'HIV', 'AIDS', 'COVID', 'COPD', 'CHF', 'CAD', 'GERD', 'UTI', 'DVT', 'PE', 'MI', 'CVA', 'TIA',
  'BMI', 'BP', 'HR', 'RR', 'SPO', 'BUN', 'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'BMP', 'CMP', 'LFT',
  'TSH', 'PSA', 'HBA', 'INR', 'PTT', 'ABG', 'VBG', 'CSF', 'EGD', 'ERCP', 'PET', 'CT', 'US',
  'PRN', 'BID', 'TID', 'QID', 'QHS', 'QAM', 'QPM', 'PO', 'IV', 'IM', 'SQ', 'SL', 'PR', 'TOP',
  'DNR', 'DNI', 'POLST', 'HCP', 'POA', 'LTC', 'SNF', 'ALF', 'ICD', 'CPT', 'DRG', 'HCPCS',
  'STAT', 'ASAP', 'WNL', 'NAD', 'PERRLA', 'ROS', 'HPI', 'PMH', 'PSH', 'FH', 'SH', 'RX', 'DX', 'TX',
  'SOB', 'DOE', 'PND', 'JVD', 'RUQ', 'LUQ', 'RLQ', 'LLQ', 'CVA', 'ROM', 'DTR', 'CN', 'EOM',
  'AMA', 'ADA', 'HIPAA', 'PHI', 'EMR', 'EHR', 'CMS', 'FDA', 'CDC', 'NIH', 'WHO',
  'PDF', 'DOC', 'PAGE', 'DATE', 'TIME', 'NOTE', 'NOTES', 'FORM', 'REPORT', 'SUMMARY', 'HISTORY',
  'NAME', 'AGE', 'SEX', 'DOB', 'MRN', 'SSN', 'ZIP', 'FAX', 'TEL', 'EXT',
  'MALE', 'FEMALE', 'YES', 'NO', 'NA', 'TBD', 'NKA', 'NKDA',
  'SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN', 'SOAP', 'IMPRESSION', 'RECOMMENDATION',
  'CHIEF', 'COMPLAINT', 'ALLERGIES', 'MEDICATIONS', 'VITALS', 'EXAM', 'LABS', 'IMAGING',
  'PROCEDURE', 'PROCEDURES', 'SURGERY', 'SURGERIES', 'DIAGNOSIS', 'DIAGNOSES',
  'USA', 'UK', 'EST', 'PST', 'CST', 'MST', 'UTC', 'GMT', 'AM', 'PM'
]);

const NAME_LABELS = [
  'Patient Name', 'Name', 'Full Name', 'Legal Name', 'Patient',
  'Pt Name', "Patient's Name", 'Name of Patient', 'patientName',
  'patient_name', 'fullName', 'full_name'
];

const MRN_CONTEXT_KEYWORDS = [
  'MRN', 'Medical Record Number', 'Patient ID', 'Patient Number',
  'Record Number', 'Chart Number', 'Account Number', 'Member ID'
];

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

export interface ScrubRequest {
  type: 'scrub';
  text: string;
  filename?: string;
  jobId: string;
}

export interface ScrubResponse {
  type: 'result';
  jobId: string;
  text: string;
  replacements: Record<string, string>;
  count: number;
  auditReport: AuditReport;
}

export interface ProgressUpdate {
  type: 'progress';
  jobId: string;
  stage: string;
  percent: number;
}

export interface ErrorResponse {
  type: 'error';
  jobId: string;
  error: string;
}

type WorkerMessage = ScrubRequest;
type _WorkerResponse = ScrubResponse | ProgressUpdate | ErrorResponse;

// ============================================================================
// SCRUBBING LOGIC
// ============================================================================

type EntityCounters = Record<'PER' | 'LOC' | 'ORG' | 'EMAIL' | 'PHONE' | 'ID' | 'DATE', number>;

function scrubText(
  text: string,
  filename: string | undefined,
  jobId: string,
  postProgress: (msg: ProgressUpdate) => void
): { text: string; replacements: Record<string, string>; count: number; auditReport: AuditReport } {
  const audit = new AuditCollector();
  audit.start(filename, text);

  const entityToPlaceholder: Record<string, string> = {};
  const counters: EntityCounters = { PER: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, ID: 0, DATE: 0 };
  let totalReplacements = 0;
  let interimText = text;

  const runRegex = (type: string, regex: RegExp, prefix: string, patternName: string) => {
    const startTime = performance.now();
    const matches: Array<{ original: string; placeholder: string }> = [];

    interimText = interimText.replace(regex, (match) => {
      if (!entityToPlaceholder[match]) {
        counters[type as keyof typeof counters]++;
        const placeholder = `[${prefix}_${counters[type as keyof typeof counters]}]`;
        entityToPlaceholder[match] = placeholder;
        totalReplacements++;
        matches.push({ original: match, placeholder });
      }
      return entityToPlaceholder[match];
    });

    audit.log(type, patternName, matches, performance.now() - startTime);
  };

  // Progress: 10%
  postProgress({ type: 'progress', jobId, stage: 'Processing emails and phones...', percent: 10 });
  runRegex('EMAIL', PATTERNS.EMAIL, 'EMAIL', 'EMAIL');
  runRegex('PHONE', PATTERNS.PHONE, 'PHONE', 'PHONE');

  // Progress: 20%
  postProgress({ type: 'progress', jobId, stage: 'Processing IDs...', percent: 20 });
  runRegex('ID', PATTERNS.SSN, 'SSN', 'SSN');
  runRegex('ID', PATTERNS.SSN_PARTIAL, 'SSN', 'SSN_PARTIAL');
  runRegex('ID', PATTERNS.CREDIT_CARD, 'CARD', 'CREDIT_CARD');
  runRegex('ID', PATTERNS.ZIPCODE, 'ZIP', 'ZIPCODE');
  runRegex('ID', PATTERNS.INSURANCE_ID, 'ID', 'INSURANCE_ID');

  // Progress: 35%
  postProgress({ type: 'progress', jobId, stage: 'Processing dates and ages...', percent: 35 });
  runRegex('DATE', PATTERNS.DATE, 'DATE', 'DATE');
  runRegex('DATE', PATTERNS.DATE_WRITTEN, 'DATE', 'DATE_WRITTEN');
  runRegex('DATE', PATTERNS.DATE_WRITTEN_ALT, 'DATE', 'DATE_WRITTEN_ALT');
  runRegex('DATE', PATTERNS.AGE, 'AGE', 'AGE');
  runRegex('DATE', PATTERNS.AGE_CONTEXT, 'AGE', 'AGE_CONTEXT');

  // Progress: 50%
  postProgress({ type: 'progress', jobId, stage: 'Processing addresses...', percent: 50 });
  runRegex('LOC', PATTERNS.ADDRESS, 'ADDR', 'ADDRESS');
  runRegex('LOC', PATTERNS.PO_BOX, 'POBOX', 'PO_BOX');
  runRegex('LOC', PATTERNS.CITY_STATE, 'LOC', 'CITY_STATE');

  // Progress: 65%
  postProgress({ type: 'progress', jobId, stage: 'Processing names...', percent: 65 });
  runRegex('PER', PATTERNS.ALL_CAPS_NAME, 'PER', 'ALL_CAPS_NAME');
  runRegex('PER', PATTERNS.LAST_FIRST_NAME, 'PER', 'LAST_FIRST_NAME');
  runRegex('PER', PATTERNS.NAME_APOSTROPHE, 'PER', 'NAME_APOSTROPHE');
  runRegex('PER', PATTERNS.NAME_WITH_SUFFIX, 'PER', 'NAME_WITH_SUFFIX');

  // Single ALL CAPS with whitelist
  const allCapsMatches: Array<{ original: string; placeholder: string }> = [];
  interimText = interimText.replace(PATTERNS.ALL_CAPS_SINGLE, (match) => {
    if (WHITELIST_ACRONYMS.has(match)) return match;
    if (/^\[[A-Z_]+\d+\]$/.test(match)) return match;

    if (!entityToPlaceholder[match]) {
      counters.PER++;
      const placeholder = `[PER_${counters.PER}]`;
      entityToPlaceholder[match] = placeholder;
      totalReplacements++;
      allCapsMatches.push({ original: match, placeholder });
    }
    return entityToPlaceholder[match];
  });
  audit.log('PER', 'ALL_CAPS_SINGLE', allCapsMatches);

  // Progress: 75%
  postProgress({ type: 'progress', jobId, stage: 'Processing states...', percent: 75 });

  // Standalone states
  const statePattern = /\b([A-Z]{2})\b/g;
  let stateMatch;
  const stateMatches: Array<{ start: number; end: number; value: string }> = [];

  while ((stateMatch = statePattern.exec(interimText)) !== null) {
    const potentialState = stateMatch[1];
    if (US_STATES.has(potentialState)) {
      const before = interimText.slice(Math.max(0, stateMatch.index - 1), stateMatch.index);
      const after = interimText.slice(stateMatch.index + 2, stateMatch.index + 3);
      if (before === '[' || after === ']' || before === '_') continue;
      stateMatches.push({ start: stateMatch.index, end: stateMatch.index + 2, value: potentialState });
    }
  }

  const stateAuditMatches: Array<{ original: string; placeholder: string }> = [];
  stateMatches.reverse().forEach(({ start, end, value }) => {
    if (!entityToPlaceholder[value]) {
      counters.LOC++;
      const placeholder = `[STATE_${counters.LOC}]`;
      entityToPlaceholder[value] = placeholder;
      totalReplacements++;
      stateAuditMatches.push({ original: value, placeholder });
    }
    interimText = interimText.substring(0, start) + entityToPlaceholder[value] + interimText.substring(end);
  });
  audit.log('LOC', 'STANDALONE_STATE', stateAuditMatches);

  // Progress: 85%
  postProgress({ type: 'progress', jobId, stage: 'Processing MRN and labeled names...', percent: 85 });

  // Context-aware MRN detection
  const mrnPattern = new RegExp(`(${MRN_CONTEXT_KEYWORDS.join('|')})[:\\s]+([A-Z0-9]{6,12})\\b`, 'gi');
  const mrnMatches: Array<{ original: string; placeholder: string }> = [];
  let mrnMatch;

  while ((mrnMatch = mrnPattern.exec(interimText)) !== null) {
    const mrnValue = mrnMatch[2];
    if (!entityToPlaceholder[mrnValue]) {
      counters.ID++;
      const placeholder = `[MRN_${counters.ID}]`;
      entityToPlaceholder[mrnValue] = placeholder;
      totalReplacements++;
      mrnMatches.push({ original: mrnValue, placeholder });
    }
  }
  // Apply MRN replacements
  for (const { original, placeholder } of mrnMatches) {
    interimText = interimText.replace(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), placeholder);
  }
  audit.log('ID', 'MRN_CONTEXTUAL', mrnMatches);

  // Labeled name detection
  const sortedLabels = [...NAME_LABELS].sort((a, b) => b.length - a.length);
  const labelPattern = new RegExp(`(${sortedLabels.join('|')})\\s*:\\s*`, 'gi');
  const labeledNameMatches: Array<{ original: string; placeholder: string }> = [];
  let labelMatch;

  while ((labelMatch = labelPattern.exec(interimText)) !== null) {
    const afterLabel = interimText.slice(labelMatch.index + labelMatch[0].length);
    const start = labelMatch.index + labelMatch[0].length;

    // Try patterns in order
    const allCapsPattern = /^([A-Z]{2,}(?:,?\s+[A-Z]{2,})+)/;
    const lastFirstPattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/;
    const namePattern = /^((?:Dr|Mr|Ms|Mrs|Miss)\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/;

    let matched: string | null = null;
    const allCapsMatch = afterLabel.match(allCapsPattern);
    if (allCapsMatch) matched = allCapsMatch[1];
    else {
      const lastFirstMatch = afterLabel.match(lastFirstPattern);
      if (lastFirstMatch) matched = lastFirstMatch[1];
      else {
        const nameMatch = afterLabel.match(namePattern);
        if (nameMatch) matched = nameMatch[0].trim();
      }
    }

    if (matched && !entityToPlaceholder[matched]) {
      counters.PER++;
      const placeholder = `[PER_${counters.PER}]`;
      entityToPlaceholder[matched] = placeholder;
      totalReplacements++;
      labeledNameMatches.push({ original: matched, placeholder });
      // Replace in text
      interimText = interimText.substring(0, start) + placeholder + interimText.substring(start + matched.length);
    }
  }
  audit.log('PER', 'LABELED_NAME', labeledNameMatches);

  // Progress: 100%
  postProgress({ type: 'progress', jobId, stage: 'Finalizing...', percent: 100 });

  const auditReport = audit.getReport(95, interimText); // Default confidence for regex-only

  return {
    text: interimText,
    replacements: entityToPlaceholder,
    count: totalReplacements,
    auditReport
  };
}

// ============================================================================
// WORKER MESSAGE HANDLER
// ============================================================================

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  if (msg.type === 'scrub') {
    try {
      const postProgress = (progress: ProgressUpdate) => {
        self.postMessage(progress);
      };

      const result = scrubText(msg.text, msg.filename, msg.jobId, postProgress);

      const response: ScrubResponse = {
        type: 'result',
        jobId: msg.jobId,
        text: result.text,
        replacements: result.replacements,
        count: result.count,
        auditReport: result.auditReport
      };

      self.postMessage(response);
    } catch (error) {
      const errorResponse: ErrorResponse = {
        type: 'error',
        jobId: msg.jobId,
        error: error instanceof Error ? error.message : 'Unknown error in worker'
      };
      self.postMessage(errorResponse);
    }
  }
};

export {};
