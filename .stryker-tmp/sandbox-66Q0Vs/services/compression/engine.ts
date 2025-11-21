/**
 * EFFECT-TS COMPRESSION ENGINE
 *
 * Transforms 350KB of medical documents into 70-100KB LLM-optimized YAML.
 *
 * Architecture:
 * - Pure functional pipeline using Effect
 * - Errors as values (no exceptions)
 * - Schema validation at every boundary
 * - Composable, testable, type-safe
 *
 * Pipeline:
 * 1. Extract events from documents (Effect)
 * 2. Deduplicate using content hashing (Effect)
 * 3. Prioritize (abnormals > normals) (Effect)
 * 4. Compress to target size (Effect)
 * 5. Generate YAML with error collection (Effect)
 */
// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import { Effect, pipe, Array as EffectArray, Schema as S } from "effect";
import { CompressedTimeline, CompressedTimelineSchema, TimelineEntry, TimelineEntrySchema, TimelineEventType, ConfidenceLevel, MedicationSummary, LabTrend, CompressionOptions, CompressionMetadata, PatientDemographics, DateRange } from "./schema";
import { CompressionError, ParseError, ValidationError, DateAmbiguityError, OCRWarning, DeduplicationError, CompressionSizeExceededError, ErrorCollector } from "./errors";

/**
 * Input: ProcessedDocument from existing pipeline
 * (Bridge between current system and new compression system)
 */
export interface ProcessedDocument {
  id: string;
  filename: string;
  text: string;
  metadata: {
    pageCount?: number;
    createdAt?: Date;
    documentType?: string;
  };
}

/**
 * Progress callback for UI updates
 */
export interface CompressionProgress {
  stage: "extracting" | "deduplicating" | "compressing" | "generating";
  current: number;
  total: number;
  message: string;
}
export type ProgressCallback = (progress: CompressionProgress) => void;

/**
 * Compression Context (carries state through pipeline)
 */
interface CompressionContext {
  documents: ProcessedDocument[];
  options: CompressionOptions;
  errorCollector: ErrorCollector;
  progressCallback?: ProgressCallback;
}

/**
 * STAGE 1: Event Extraction
 *
 * Extract timeline events from processed documents.
 * Uses Effect for composable error handling.
 */
const extractEventsFromDocument = (doc: ProcessedDocument, errorCollector: ErrorCollector): Effect.Effect<TimelineEntry[], never, never> => {
  if (stryMutAct_9fa48("0")) {
    {}
  } else {
    stryCov_9fa48("0");
    return Effect.sync(() => {
      if (stryMutAct_9fa48("1")) {
        {}
      } else {
        stryCov_9fa48("1");
        const events: TimelineEntry[] = stryMutAct_9fa48("2") ? ["Stryker was here"] : (stryCov_9fa48("2"), []);
        try {
          if (stryMutAct_9fa48("3")) {
            {}
          } else {
            stryCov_9fa48("3");
            // Regex patterns for event extraction (very flexible - match anything between keyword and date)
            const visitPattern = stryMutAct_9fa48("10") ? /(?:visit|appointment|consultation).*?(\d{1,2}\/\d{1,2}\/\D{4})/gi : stryMutAct_9fa48("9") ? /(?:visit|appointment|consultation).*?(\d{1,2}\/\d{1,2}\/\d)/gi : stryMutAct_9fa48("8") ? /(?:visit|appointment|consultation).*?(\d{1,2}\/\D{1,2}\/\d{4})/gi : stryMutAct_9fa48("7") ? /(?:visit|appointment|consultation).*?(\d{1,2}\/\d\/\d{4})/gi : stryMutAct_9fa48("6") ? /(?:visit|appointment|consultation).*?(\D{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("5") ? /(?:visit|appointment|consultation).*?(\d\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("4") ? /(?:visit|appointment|consultation).(\d{1,2}\/\d{1,2}\/\d{4})/gi : (stryCov_9fa48("4", "5", "6", "7", "8", "9", "10"), /(?:visit|appointment|consultation).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi);
            const labPattern = stryMutAct_9fa48("20") ? /(?:lab|test)\s+results?.*?(\d{1,2}\/\d{1,2}\/\D{4})/gi : stryMutAct_9fa48("19") ? /(?:lab|test)\s+results?.*?(\d{1,2}\/\d{1,2}\/\d)/gi : stryMutAct_9fa48("18") ? /(?:lab|test)\s+results?.*?(\d{1,2}\/\D{1,2}\/\d{4})/gi : stryMutAct_9fa48("17") ? /(?:lab|test)\s+results?.*?(\d{1,2}\/\d\/\d{4})/gi : stryMutAct_9fa48("16") ? /(?:lab|test)\s+results?.*?(\D{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("15") ? /(?:lab|test)\s+results?.*?(\d\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("14") ? /(?:lab|test)\s+results?.(\d{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("13") ? /(?:lab|test)\s+results.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("12") ? /(?:lab|test)\S+results?.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("11") ? /(?:lab|test)\sresults?.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi : (stryCov_9fa48("11", "12", "13", "14", "15", "16", "17", "18", "19", "20"), /(?:lab|test)\s+results?.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi);
            const medPattern = stryMutAct_9fa48("27") ? /(?:started|stopped|prescribed).*?(\d{1,2}\/\d{1,2}\/\D{4})/gi : stryMutAct_9fa48("26") ? /(?:started|stopped|prescribed).*?(\d{1,2}\/\d{1,2}\/\d)/gi : stryMutAct_9fa48("25") ? /(?:started|stopped|prescribed).*?(\d{1,2}\/\D{1,2}\/\d{4})/gi : stryMutAct_9fa48("24") ? /(?:started|stopped|prescribed).*?(\d{1,2}\/\d\/\d{4})/gi : stryMutAct_9fa48("23") ? /(?:started|stopped|prescribed).*?(\D{1,2}\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("22") ? /(?:started|stopped|prescribed).*?(\d\/\d{1,2}\/\d{4})/gi : stryMutAct_9fa48("21") ? /(?:started|stopped|prescribed).(\d{1,2}\/\d{1,2}\/\d{4})/gi : (stryCov_9fa48("21", "22", "23", "24", "25", "26", "27"), /(?:started|stopped|prescribed).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi);

            // Extract visits
            let match;
            while (stryMutAct_9fa48("29") ? (match = visitPattern.exec(doc.text)) === null : stryMutAct_9fa48("28") ? false : (stryCov_9fa48("28", "29"), (match = visitPattern.exec(doc.text)) !== null)) {
              if (stryMutAct_9fa48("30")) {
                {}
              } else {
                stryCov_9fa48("30");
                const dateStr = match[1];
                const parsedDate = parseDate(dateStr, doc.filename, errorCollector);
                if (stryMutAct_9fa48("32") ? false : stryMutAct_9fa48("31") ? true : (stryCov_9fa48("31", "32"), parsedDate)) {
                  if (stryMutAct_9fa48("33")) {
                    {}
                  } else {
                    stryCov_9fa48("33");
                    events.push({
                      id: `${doc.id}-visit-${events.length}`,
                      date: parsedDate,
                      type: "visit" as TimelineEventType,
                      sourceDocument: doc.filename,
                      confidence: "medium" as ConfidenceLevel
                    });
                  }
                }
              }
            }

            // Extract lab results
            while (stryMutAct_9fa48("37") ? (match = labPattern.exec(doc.text)) === null : stryMutAct_9fa48("36") ? false : (stryCov_9fa48("36", "37"), (match = labPattern.exec(doc.text)) !== null)) {
              if (stryMutAct_9fa48("38")) {
                {}
              } else {
                stryCov_9fa48("38");
                const dateStr = match[1];
                const parsedDate = parseDate(dateStr, doc.filename, errorCollector);
                if (stryMutAct_9fa48("40") ? false : stryMutAct_9fa48("39") ? true : (stryCov_9fa48("39", "40"), parsedDate)) {
                  if (stryMutAct_9fa48("41")) {
                    {}
                  } else {
                    stryCov_9fa48("41");
                    events.push({
                      id: `${doc.id}-lab-${events.length}`,
                      date: parsedDate,
                      type: "lab_result" as TimelineEventType,
                      sourceDocument: doc.filename,
                      confidence: "high" as ConfidenceLevel
                    });
                  }
                }
              }
            }

            // Extract medication changes
            while (stryMutAct_9fa48("45") ? (match = medPattern.exec(doc.text)) === null : stryMutAct_9fa48("44") ? false : (stryCov_9fa48("44", "45"), (match = medPattern.exec(doc.text)) !== null)) {
              if (stryMutAct_9fa48("46")) {
                {}
              } else {
                stryCov_9fa48("46");
                const dateStr = match[1]; // First capture group is the date
                const parsedDate = parseDate(dateStr, doc.filename, errorCollector);
                if (stryMutAct_9fa48("48") ? false : stryMutAct_9fa48("47") ? true : (stryCov_9fa48("47", "48"), parsedDate)) {
                  if (stryMutAct_9fa48("49")) {
                    {}
                  } else {
                    stryCov_9fa48("49");
                    events.push({
                      id: `${doc.id}-med-${events.length}`,
                      date: parsedDate,
                      type: "medication_change" as TimelineEventType,
                      sourceDocument: doc.filename,
                      confidence: "high" as ConfidenceLevel
                    });
                  }
                }
              }
            }
          }
        } catch (error) {
          if (stryMutAct_9fa48("52")) {
            {}
          } else {
            stryCov_9fa48("52");
            // Collect parse errors without failing the pipeline
            errorCollector.add(new ParseError({
              file: doc.filename,
              field: "events",
              expected: "timeline events",
              actual: error instanceof Error ? error.message : "unknown error",
              suggestion: "Document may have non-standard format. Manual review recommended."
            }));
          }
        }
        return events;
      }
    });
  }
};

/**
 * Date parsing with ambiguity detection
 */
const parseDate = (dateStr: string, filename: string, errorCollector: ErrorCollector): Date | null => {
  if (stryMutAct_9fa48("58")) {
    {}
  } else {
    stryCov_9fa48("58");
    try {
      if (stryMutAct_9fa48("59")) {
        {}
      } else {
        stryCov_9fa48("59");
        // Try standard US format: MM/DD/YYYY
        const parts = dateStr.split("/");
        if (stryMutAct_9fa48("63") ? parts.length !== 3 : stryMutAct_9fa48("62") ? false : stryMutAct_9fa48("61") ? true : (stryCov_9fa48("61", "62", "63"), parts.length === 3)) {
          if (stryMutAct_9fa48("64")) {
            {}
          } else {
            stryCov_9fa48("64");
            const month = parseInt(parts[0], 10);
            const day = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);

            // Construct date and validate (catches JS normalization like Feb 30 -> Mar 2)
            const date = new Date(year, stryMutAct_9fa48("65") ? month + 1 : (stryCov_9fa48("65"), month - 1), day);
            if (stryMutAct_9fa48("68") ? (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || year < 1900) && year > 2100 : stryMutAct_9fa48("67") ? false : stryMutAct_9fa48("66") ? true : (stryCov_9fa48("66", "67", "68"), (stryMutAct_9fa48("70") ? (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) && year < 1900 : stryMutAct_9fa48("69") ? false : (stryCov_9fa48("69", "70"), (stryMutAct_9fa48("72") ? (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1) && date.getDate() !== day : stryMutAct_9fa48("71") ? false : (stryCov_9fa48("71", "72"), (stryMutAct_9fa48("74") ? (isNaN(date.getTime()) || date.getFullYear() !== year) && date.getMonth() !== month - 1 : stryMutAct_9fa48("73") ? false : (stryCov_9fa48("73", "74"), (stryMutAct_9fa48("76") ? isNaN(date.getTime()) && date.getFullYear() !== year : stryMutAct_9fa48("75") ? false : (stryCov_9fa48("75", "76"), isNaN(date.getTime()) || (stryMutAct_9fa48("78") ? date.getFullYear() === year : stryMutAct_9fa48("77") ? false : (stryCov_9fa48("77", "78"), date.getFullYear() !== year)))) || (stryMutAct_9fa48("80") ? date.getMonth() === month - 1 : stryMutAct_9fa48("79") ? false : (stryCov_9fa48("79", "80"), date.getMonth() !== (stryMutAct_9fa48("81") ? month + 1 : (stryCov_9fa48("81"), month - 1)))))) || (stryMutAct_9fa48("83") ? date.getDate() === day : stryMutAct_9fa48("82") ? false : (stryCov_9fa48("82", "83"), date.getDate() !== day)))) || (stryMutAct_9fa48("86") ? year >= 1900 : stryMutAct_9fa48("85") ? year <= 1900 : stryMutAct_9fa48("84") ? false : (stryCov_9fa48("84", "85", "86"), year < 1900)))) || (stryMutAct_9fa48("89") ? year <= 2100 : stryMutAct_9fa48("88") ? year >= 2100 : stryMutAct_9fa48("87") ? false : (stryCov_9fa48("87", "88", "89"), year > 2100)))) {
              if (stryMutAct_9fa48("90")) {
                {}
              } else {
                stryCov_9fa48("90");
                errorCollector.add(new ParseError({
                  file: filename,
                  field: "date",
                  expected: "valid date (MM/DD/YYYY, 1900-2100)",
                  actual: dateStr,
                  suggestion: "Date is invalid (e.g., month/day out of range). Check source document."
                }));
                return null;
              }
            }

            // Ambiguity detection: 01/02/2023 could be Jan 2 or Feb 1
            if (stryMutAct_9fa48("97") ? month <= 12 && day <= 12 || month !== day : stryMutAct_9fa48("96") ? false : stryMutAct_9fa48("95") ? true : (stryCov_9fa48("95", "96", "97"), (stryMutAct_9fa48("99") ? month <= 12 || day <= 12 : stryMutAct_9fa48("98") ? true : (stryCov_9fa48("98", "99"), (stryMutAct_9fa48("102") ? month > 12 : stryMutAct_9fa48("101") ? month < 12 : stryMutAct_9fa48("100") ? true : (stryCov_9fa48("100", "101", "102"), month <= 12)) && (stryMutAct_9fa48("105") ? day > 12 : stryMutAct_9fa48("104") ? day < 12 : stryMutAct_9fa48("103") ? true : (stryCov_9fa48("103", "104", "105"), day <= 12)))) && (stryMutAct_9fa48("107") ? month === day : stryMutAct_9fa48("106") ? true : (stryCov_9fa48("106", "107"), month !== day)))) {
              if (stryMutAct_9fa48("108")) {
                {}
              } else {
                stryCov_9fa48("108");
                errorCollector.add(new DateAmbiguityError({
                  file: filename,
                  rawDate: dateStr,
                  possibleInterpretations: stryMutAct_9fa48("110") ? [] : (stryCov_9fa48("110"), [`${month}/${day}/${year} (MM/DD/YYYY)`, `${day}/${month}/${year} (DD/MM/YYYY)`]),
                  chosenInterpretation: `${month}/${day}/${year} (MM/DD/YYYY)`,
                  suggestion: "Assumed US date format. Verify if patient records use DD/MM/YYYY."
                }));
              }
            }
            return date;
          }
        }
      }
    } catch (error) {
      if (stryMutAct_9fa48("115")) {
        {}
      } else {
        stryCov_9fa48("115");
        errorCollector.add(new ParseError({
          file: filename,
          field: "date",
          expected: "MM/DD/YYYY",
          actual: dateStr,
          suggestion: "Check date format in source document."
        }));
      }
    }
    return null;
  }
};

/**
 * STAGE 2: Deduplication
 *
 * Hash-based deduplication with similarity detection.
 */
const deduplicateEvents = (events: TimelineEntry[], aggressive: boolean, errorCollector: ErrorCollector): Effect.Effect<TimelineEntry[], never, never> => {
  if (stryMutAct_9fa48("120")) {
    {}
  } else {
    stryCov_9fa48("120");
    return Effect.sync(() => {
      if (stryMutAct_9fa48("121")) {
        {}
      } else {
        stryCov_9fa48("121");
        const seen = new Map<string, TimelineEntry>();
        const deduplicated: TimelineEntry[] = stryMutAct_9fa48("122") ? ["Stryker was here"] : (stryCov_9fa48("122"), []);
        for (const event of events) {
          if (stryMutAct_9fa48("123")) {
            {}
          } else {
            stryCov_9fa48("123");
            // Create content hash (date + type + source)
            const hash = `${event.date.toISOString()}-${event.type}-${event.sourceDocument}`;
            if (stryMutAct_9fa48("126") ? false : stryMutAct_9fa48("125") ? true : (stryCov_9fa48("125", "126"), seen.has(hash))) {
              if (stryMutAct_9fa48("127")) {
                {}
              } else {
                stryCov_9fa48("127");
                // Exact duplicate found
                const original = seen.get(hash)!;
                errorCollector.add(new DeduplicationError({
                  event1: original.id,
                  event2: event.id,
                  similarity: 1.0,
                  action: "merged",
                  suggestion: "Identical events merged. Verify source documents."
                }));
              }
            } else if (stryMutAct_9fa48("132") ? false : stryMutAct_9fa48("131") ? true : (stryCov_9fa48("131", "132"), aggressive)) {
              if (stryMutAct_9fa48("133")) {
                {}
              } else {
                stryCov_9fa48("133");
                // Fuzzy matching: same date + type (ignore source)
                const fuzzyHash = `${event.date.toISOString()}-${event.type}`;
                const similar = Array.from(seen.values()).find(stryMutAct_9fa48("135") ? () => undefined : (stryCov_9fa48("135"), e => stryMutAct_9fa48("138") ? `${e.date.toISOString()}-${e.type}` !== fuzzyHash : stryMutAct_9fa48("137") ? false : stryMutAct_9fa48("136") ? true : (stryCov_9fa48("136", "137", "138"), `${e.date.toISOString()}-${e.type}` === fuzzyHash)));
                if (stryMutAct_9fa48("141") ? false : stryMutAct_9fa48("140") ? true : (stryCov_9fa48("140", "141"), similar)) {
                  if (stryMutAct_9fa48("142")) {
                    {}
                  } else {
                    stryCov_9fa48("142");
                    errorCollector.add(new DeduplicationError({
                      event1: similar.id,
                      event2: event.id,
                      similarity: 0.8,
                      action: "merged",
                      suggestion: "Similar events from different sources merged. Review for accuracy."
                    }));
                  }
                } else {
                  if (stryMutAct_9fa48("146")) {
                    {}
                  } else {
                    stryCov_9fa48("146");
                    seen.set(hash, event);
                    deduplicated.push(event);
                  }
                }
              }
            } else {
              if (stryMutAct_9fa48("147")) {
                {}
              } else {
                stryCov_9fa48("147");
                seen.set(hash, event);
                deduplicated.push(event);
              }
            }
          }
        }
        return deduplicated;
      }
    });
  }
};

/**
 * STAGE 3: Prioritization
 *
 * Sort by importance and recency.
 */
const prioritizeEvents = (events: TimelineEntry[]): Effect.Effect<TimelineEntry[], never, never> => {
  if (stryMutAct_9fa48("148")) {
    {}
  } else {
    stryCov_9fa48("148");
    return Effect.succeed(stryMutAct_9fa48("149") ? [...events] : (stryCov_9fa48("149"), (stryMutAct_9fa48("150") ? [] : (stryCov_9fa48("150"), [...events])).sort((a, b) => {
      if (stryMutAct_9fa48("151")) {
        {}
      } else {
        stryCov_9fa48("151");
        // Priority: high confidence > medium > low
        const confidenceWeight = {
          high: 3,
          medium: 2,
          low: 1
        };
        const confDiff = stryMutAct_9fa48("153") ? confidenceWeight[b.confidence] + confidenceWeight[a.confidence] : (stryCov_9fa48("153"), confidenceWeight[b.confidence] - confidenceWeight[a.confidence]);
        if (stryMutAct_9fa48("156") ? confDiff === 0 : stryMutAct_9fa48("155") ? false : stryMutAct_9fa48("154") ? true : (stryCov_9fa48("154", "155", "156"), confDiff !== 0)) return confDiff;

        // Secondary: more recent events first
        return stryMutAct_9fa48("157") ? b.date.getTime() + a.date.getTime() : (stryCov_9fa48("157"), b.date.getTime() - a.date.getTime());
      }
    })));
  }
};

/**
 * STAGE 4: Compression to Target Size
 *
 * Iteratively remove low-priority events until size target met.
 */
const compressToTargetSize = (events: TimelineEntry[], targetSizeKb: number, errorCollector: ErrorCollector): Effect.Effect<TimelineEntry[], never, never> => {
  if (stryMutAct_9fa48("158")) {
    {}
  } else {
    stryCov_9fa48("158");
    return Effect.sync(() => {
      if (stryMutAct_9fa48("159")) {
        {}
      } else {
        stryCov_9fa48("159");
        let compressed = stryMutAct_9fa48("160") ? [] : (stryCov_9fa48("160"), [...events]);

        // Estimate YAML size (100 bytes per event for realistic compression)
        const estimateSize = stryMutAct_9fa48("161") ? () => undefined : (stryCov_9fa48("161"), (() => {
          const estimateSize = (evts: TimelineEntry[]) => stryMutAct_9fa48("162") ? evts.length / 0.1 : (stryCov_9fa48("162"), evts.length * 0.1);
          return estimateSize;
        })()); // KB

        while (stryMutAct_9fa48("164") ? estimateSize(compressed) > targetSizeKb || compressed.length > 10 : stryMutAct_9fa48("163") ? false : (stryCov_9fa48("163", "164"), (stryMutAct_9fa48("167") ? estimateSize(compressed) <= targetSizeKb : stryMutAct_9fa48("166") ? estimateSize(compressed) >= targetSizeKb : stryMutAct_9fa48("165") ? true : (stryCov_9fa48("165", "166", "167"), estimateSize(compressed) > targetSizeKb)) && (stryMutAct_9fa48("170") ? compressed.length <= 10 : stryMutAct_9fa48("169") ? compressed.length >= 10 : stryMutAct_9fa48("168") ? true : (stryCov_9fa48("168", "169", "170"), compressed.length > 10)))) {
          if (stryMutAct_9fa48("171")) {
            {}
          } else {
            stryCov_9fa48("171");
            // Remove lowest priority event (last in sorted array)
            compressed.pop();
          }
        }
        const finalSize = estimateSize(compressed);
        if (stryMutAct_9fa48("175") ? finalSize <= targetSizeKb : stryMutAct_9fa48("174") ? finalSize >= targetSizeKb : stryMutAct_9fa48("173") ? false : stryMutAct_9fa48("172") ? true : (stryCov_9fa48("172", "173", "174", "175"), finalSize > targetSizeKb)) {
          if (stryMutAct_9fa48("176")) {
            {}
          } else {
            stryCov_9fa48("176");
            errorCollector.add(new CompressionSizeExceededError({
              targetSizeKb,
              actualSizeKb: finalSize,
              suggestion: "Increase target size or enable more aggressive deduplication."
            }));
          }
        }
        return compressed;
      }
    });
  }
};

/**
 * STAGE 5: Build Compressed Timeline
 *
 * Assemble final output with metadata.
 */
const buildCompressedTimeline = (events: TimelineEntry[], documents: ProcessedDocument[], originalEventsCount: number, options: CompressionOptions): Effect.Effect<CompressedTimeline, never, never> => {
  if (stryMutAct_9fa48("179")) {
    {}
  } else {
    stryCov_9fa48("179");
    return Effect.sync(() => {
      if (stryMutAct_9fa48("180")) {
        {}
      } else {
        stryCov_9fa48("180");
        // Calculate date range (handle empty events array)
        const now = new Date();
        const dateRange: DateRange = (stryMutAct_9fa48("184") ? events.length <= 0 : stryMutAct_9fa48("183") ? events.length >= 0 : stryMutAct_9fa48("182") ? false : stryMutAct_9fa48("181") ? true : (stryCov_9fa48("181", "182", "183", "184"), events.length > 0)) ? {
          start: new Date(stryMutAct_9fa48("186") ? Math.max(...events.map(e => e.date.getTime())) : (stryCov_9fa48("186"), Math.min(...events.map(stryMutAct_9fa48("187") ? () => undefined : (stryCov_9fa48("187"), e => e.date.getTime()))))),
          end: new Date(stryMutAct_9fa48("188") ? Math.min(...events.map(e => e.date.getTime())) : (stryCov_9fa48("188"), Math.max(...events.map(stryMutAct_9fa48("189") ? () => undefined : (stryCov_9fa48("189"), e => e.date.getTime())))))
        } : {
          start: now,
          end: now
        };

        // Calculate compression metadata
        const originalSizeKb = documents.reduce(stryMutAct_9fa48("191") ? () => undefined : (stryCov_9fa48("191"), (sum, doc) => stryMutAct_9fa48("192") ? sum - doc.text.length / 1024 : (stryCov_9fa48("192"), sum + (stryMutAct_9fa48("193") ? doc.text.length * 1024 : (stryCov_9fa48("193"), doc.text.length / 1024)))), 0);
        // Estimate compressed size (100 bytes per event for realistic compression)
        const compressedSizeKb = stryMutAct_9fa48("194") ? events.length / 0.1 : (stryCov_9fa48("194"), events.length * 0.1);

        // Calculate ratio (cap at 1.0 since compression can't make things bigger)
        const rawRatio = (stryMutAct_9fa48("198") ? originalSizeKb <= 0 : stryMutAct_9fa48("197") ? originalSizeKb >= 0 : stryMutAct_9fa48("196") ? false : stryMutAct_9fa48("195") ? true : (stryCov_9fa48("195", "196", "197", "198"), originalSizeKb > 0)) ? stryMutAct_9fa48("199") ? compressedSizeKb * originalSizeKb : (stryCov_9fa48("199"), compressedSizeKb / originalSizeKb) : 0;
        const ratio = stryMutAct_9fa48("200") ? Math.max(rawRatio, 1.0) : (stryCov_9fa48("200"), Math.min(rawRatio, 1.0));
        const metadata: CompressionMetadata = {
          originalSizeKb,
          compressedSizeKb,
          ratio,
          eventsTotal: originalEventsCount,
          eventsIncluded: events.length,
          deduplication: options.deduplicationAggressive ? "aggressive" : "light"
        };

        // Build demographics (placeholder - real implementation would extract from docs)
        const demographics: PatientDemographics = {
          patientId: "PATIENT-REDACTED",
          ageAtFirstVisit: 0 // Would be extracted from documents
        };

        // Build medication summary (placeholder)
        const medications: MedicationSummary = {
          current: stryMutAct_9fa48("207") ? ["Stryker was here"] : (stryCov_9fa48("207"), []),
          discontinued: stryMutAct_9fa48("208") ? ["Stryker was here"] : (stryCov_9fa48("208"), [])
        };

        // Build lab trends (placeholder)
        const labTrends: LabTrend[] = stryMutAct_9fa48("209") ? ["Stryker was here"] : (stryCov_9fa48("209"), []);
        const timeline: CompressedTimeline = {
          patientId: "PATIENT-REDACTED",
          dateRange,
          totalDocuments: documents.length,
          totalEvents: originalEventsCount,
          demographics,
          timeline: events,
          medications,
          labTrends,
          compressionMetadata: metadata
        };

        // Return timeline (schema validation happens at boundaries)
        return timeline;
      }
    });
  }
};

/**
 * MAIN COMPRESSION PIPELINE
 *
 * Orchestrates all stages with progress reporting.
 */
export const compressTimeline = (documents: ProcessedDocument[], options: CompressionOptions, progressCallback?: ProgressCallback): Effect.Effect<{
  timeline: CompressedTimeline;
  errors: ErrorCollector;
}, CompressionError, never> => {
  if (stryMutAct_9fa48("212")) {
    {}
  } else {
    stryCov_9fa48("212");
    return Effect.gen(function* (_) {
      if (stryMutAct_9fa48("213")) {
        {}
      } else {
        stryCov_9fa48("213");
        const errorCollector = new ErrorCollector();

        // STAGE 1: Extract events
        stryMutAct_9fa48("214") ? progressCallback({
          stage: "extracting",
          current: 0,
          total: documents.length,
          message: "Extracting timeline events..."
        }) : (stryCov_9fa48("214"), progressCallback?.({
          stage: "extracting",
          current: 0,
          total: documents.length,
          message: "Extracting timeline events..."
        }));
        const allEvents: TimelineEntry[] = stryMutAct_9fa48("218") ? ["Stryker was here"] : (stryCov_9fa48("218"), []);
        for (let i = 0; stryMutAct_9fa48("221") ? i >= documents.length : stryMutAct_9fa48("220") ? i <= documents.length : stryMutAct_9fa48("219") ? false : (stryCov_9fa48("219", "220", "221"), i < documents.length); stryMutAct_9fa48("222") ? i-- : (stryCov_9fa48("222"), i++)) {
          if (stryMutAct_9fa48("223")) {
            {}
          } else {
            stryCov_9fa48("223");
            const events = yield* _(extractEventsFromDocument(documents[i], errorCollector));
            allEvents.push(...events);
            stryMutAct_9fa48("224") ? progressCallback({
              stage: "extracting",
              current: i + 1,
              total: documents.length,
              message: `Extracted ${allEvents.length} events from ${i + 1}/${documents.length} documents`
            }) : (stryCov_9fa48("224"), progressCallback?.({
              stage: "extracting",
              current: stryMutAct_9fa48("227") ? i - 1 : (stryCov_9fa48("227"), i + 1),
              total: documents.length,
              message: `Extracted ${allEvents.length} events from ${stryMutAct_9fa48("229") ? i - 1 : (stryCov_9fa48("229"), i + 1)}/${documents.length} documents`
            }));
          }
        }
        const originalEventsCount = allEvents.length;

        // STAGE 2: Deduplicate
        stryMutAct_9fa48("230") ? progressCallback({
          stage: "deduplicating",
          current: 0,
          total: 1,
          message: "Removing duplicate events..."
        }) : (stryCov_9fa48("230"), progressCallback?.({
          stage: "deduplicating",
          current: 0,
          total: 1,
          message: "Removing duplicate events..."
        }));
        const deduplicated = yield* _(deduplicateEvents(allEvents, options.deduplicationAggressive, errorCollector));
        stryMutAct_9fa48("234") ? progressCallback({
          stage: "deduplicating",
          current: 1,
          total: 1,
          message: `Removed ${allEvents.length - deduplicated.length} duplicates`
        }) : (stryCov_9fa48("234"), progressCallback?.({
          stage: "deduplicating",
          current: 1,
          total: 1,
          message: `Removed ${stryMutAct_9fa48("238") ? allEvents.length + deduplicated.length : (stryCov_9fa48("238"), allEvents.length - deduplicated.length)} duplicates`
        }));

        // STAGE 3: Prioritize
        const prioritized = yield* _(prioritizeEvents(deduplicated));

        // STAGE 4: Compress to target size
        stryMutAct_9fa48("239") ? progressCallback({
          stage: "compressing",
          current: 0,
          total: 1,
          message: "Compressing to target size..."
        }) : (stryCov_9fa48("239"), progressCallback?.({
          stage: "compressing",
          current: 0,
          total: 1,
          message: "Compressing to target size..."
        }));
        const compressed = yield* _(compressToTargetSize(prioritized, options.maxOutputSizeKb, errorCollector));
        stryMutAct_9fa48("243") ? progressCallback({
          stage: "compressing",
          current: 1,
          total: 1,
          message: `Compressed to ${compressed.length} events`
        }) : (stryCov_9fa48("243"), progressCallback?.({
          stage: "compressing",
          current: 1,
          total: 1,
          message: `Compressed to ${compressed.length} events`
        }));

        // STAGE 5: Build final timeline
        stryMutAct_9fa48("247") ? progressCallback({
          stage: "generating",
          current: 0,
          total: 1,
          message: "Generating compressed timeline..."
        }) : (stryCov_9fa48("247"), progressCallback?.({
          stage: "generating",
          current: 0,
          total: 1,
          message: "Generating compressed timeline..."
        }));
        const timeline = yield* _(buildCompressedTimeline(compressed, documents, originalEventsCount, options));
        stryMutAct_9fa48("251") ? progressCallback({
          stage: "generating",
          current: 1,
          total: 1,
          message: "Compression complete!"
        }) : (stryCov_9fa48("251"), progressCallback?.({
          stage: "generating",
          current: 1,
          total: 1,
          message: "Compression complete!"
        }));
        return {
          timeline,
          errors: errorCollector
        };
      }
    });
  }
};

/**
 * Helper: Run compression pipeline (for easy testing)
 */
export const runCompression = async (documents: ProcessedDocument[], options: CompressionOptions, progressCallback?: ProgressCallback): Promise<{
  timeline: CompressedTimeline;
  errors: ErrorCollector;
}> => {
  if (stryMutAct_9fa48("256")) {
    {}
  } else {
    stryCov_9fa48("256");
    return Effect.runPromise(compressTimeline(documents, options, progressCallback));
  }
};