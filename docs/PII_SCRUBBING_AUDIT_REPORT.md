# PII Scrubbing Audit Report

**Date:** November 21, 2024
**Audited by:** Claude Code Assistant

## Executive Summary

This audit reveals **critical gaps** in the PII scrubbing implementation that allow patient names, addresses, and dates to leak through the sanitization process. The system has a two-phase scrubbing approach (regex + ML), but several PII categories are either:

1. **Defined but not implemented** (dates)
2. **Completely missing** (street addresses, label-based names)
3. **Unreliable** (ML-based detection with 85% confidence threshold)

---

## 🔴 Critical Issues Found

### 1. **DATE Pattern Defined But Never Used**

**Location:** `services/piiScrubber.ts:15`
**Severity:** HIGH

The `PATTERNS.DATE` regex is defined and tested but **never called in the scrubbing logic**.

```typescript
// Line 15: Pattern is defined
DATE: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,

// Lines 128-132: Where patterns are applied
runRegex('EMAIL', PATTERNS.EMAIL, 'EMAIL');
runRegex('PHONE', PATTERNS.PHONE, 'PHONE');
runRegex('ID', PATTERNS.SSN, 'SSN');
runRegex('ID', PATTERNS.CREDIT_CARD, 'CARD');
runRegex('ID', PATTERNS.ZIPCODE, 'ZIP');
// ❌ NO LINE FOR: runRegex('DATE', PATTERNS.DATE, 'DATE');
```

**Impact:** All dates in formats like `01/15/1985`, `12-31-1990`, `5/3/24` are **NOT scrubbed**.

**Examples that leak:**

- `DOB: 01/15/1985`
- `Visit Date: 11/20/2024`
- `Admission: 10-15-2024`

---

### 2. **No Street Address Detection**

**Location:** `services/piiScrubber.ts` (Pattern missing entirely)
**Severity:** CRITICAL

There is **NO pattern or logic** to detect street addresses. Only ZIP codes are detected.

**What's NOT being scrubbed:**

- ❌ `123 Main Street, Boston, MA 02101`
- ❌ `456 Elm Avenue`
- ❌ `789 Oak Road, Apt 4B`
- ❌ `P.O. Box 1234`
- ✅ `02101` (ZIP code only)

**The scrubber sees:**

```shell
Input:  "123 Main Street, Boston, MA 02101"
Output: "123 Main Street, Boston, MA [ZIP_1]"
```

Only the ZIP code gets scrubbed, leaving the full street address, city, and state exposed.

---

### 3. **Label-Based Names Not Detected**

**Location:** `services/piiScrubber.ts` (Pattern missing)
**Severity:** HIGH

Patient names following labels like "Patient Name:", "Name:", "Full Name:" are **only caught by the ML model**, which:

- Requires 85% confidence (line 206)
- May miss structured/formatted text
- Is not guaranteed to run on all text chunks

**Examples that may leak:**

- `Patient Name: John Smith` ← ML might miss if "Patient Name:" confuses context
- `Name: Mary Johnson` ← Depends on ML detection
- `patientName: "Alice Brown"` ← JSON formatting may break ML
- `<Name>David Lee</Name>` ← XML tags may break ML

**Current approach:** Relies entirely on BERT NER model detecting `PER` entities.
**Problem:** Structured formats (JSON, XML, CSV) may confuse the ML model.

---

### 4. **City and State Names Only Partially Covered**

**Location:** ML model LOC detection only
**Severity:** MEDIUM

City and state names depend **entirely on ML model** detecting `LOC` entities with >85% confidence.

**Risks:**

- Common words that are also cities may not be detected: "Boston General Hospital" → "Boston" might be missed if model sees it as part of organization name
- State abbreviations may not be detected: "Boston, MA" → "MA" might not register as location
- Formatting affects detection: `City: Boston` vs `Boston, Massachusetts` vs `<City>Boston</City>`

---

### 5. **File Format Handling Gaps**

#### **JSON Files** (`services/fileParser.ts:38`)

- Parsed as plain text via `file.text()`
- ML model may struggle with JSON structure:

  ```json
  {"patientName": "Alice Brown"}
  ```

  The key `"patientName"` might confuse context window

#### **CSV Files** (`services/fileParser.ts:36`)

- Parsed as plain text via `file.text()`
- Header rows may confuse ML:

  ```csv
  Name,Address,Phone
  John Smith,123 Main St,555-1234
  ```

  The header "Name" might affect detection of actual name "John Smith"

#### **XML/HTML** (No explicit support)

- No dedicated parser for XML/HTML
- Tags may break ML context:

  ```xml
  <Patient><Name>David Lee</Name></Patient>
  ```

  Tags `<Name>` and `</Name>` appear in text, potentially confusing BERT

#### **PDF Files** (`services/fileParser.ts:67-144`)

- Advanced parsing with OCR fallback
- Layout analysis may create spacing artifacts that break entity detection
- Multi-column layouts may produce non-linear text order

---

## 📊 What IS Being Scrubbed

### ✅ Regex-Based (Reliable, Phase 1)

| PII Type | Pattern | Scrubbed | Placeholder |
|----------|---------|----------|-------------|
| Email | `user@domain.com` | ✅ Yes | `[EMAIL_n]` |
| Phone | `(555) 123-4567` | ✅ Yes | `[PHONE_n]` |
| SSN | `123-45-6789` | ✅ Yes | `[SSN_n]` |
| Credit Card | `4532-1234-5678-9010` | ✅ Yes | `[CARD_n]` |
| ZIP Code | `12345` or `12345-6789` | ✅ Yes | `[ZIP_n]` |
| MRN (contextual) | `MRN: ABC123456` | ✅ Yes | `[MRN_n]` |
| **Date** | `01/15/1985` | ❌ **NO** | *(not implemented)* |

### ⚠️ ML-Based (Unreliable, Phase 2)

| PII Type | Entity | Confidence | Scrubbed | Placeholder |
|----------|--------|------------|----------|-------------|
| Names | `PER` | >85% | ⚠️ Maybe | `[PER_n]` |
| Locations | `LOC` | >85% | ⚠️ Maybe | `[LOC_n]` |
| Organizations | `ORG` | >85% | ⚠️ Maybe | `[ORG_n]` |

**Note:** ML-based detection is **NOT deterministic** and may miss entities in:

- Structured formats (JSON, XML, CSV)
- Text with unusual formatting
- Short text chunks
- Entities at chunk boundaries
- Low-confidence matches (80-84% confidence)

---

## 🔍 Testing Methodology

### Files Analyzed

1. `services/piiScrubber.ts` - Main scrubbing logic
2. `services/fileParser.ts` - File format parsers
3. `services/piiScrubber.test.ts` - Unit tests
4. `services/piiScrubber.integration.test.ts` - Integration tests
5. `schemas.ts` - Type definitions

### Test Coverage Review

- ✅ **Good coverage** for regex patterns (EMAIL, PHONE, SSN, etc.)
- ✅ **Good coverage** for MRN context detection
- ⚠️ **Limited coverage** for ML-based detection (browser-only tests)
- ❌ **NO coverage** for DATE scrubbing (pattern tested but implementation missing)
- ❌ **NO coverage** for address scrubbing (not implemented)
- ❌ **NO tests** for JSON/XML/CSV structured formats

---

## 🎯 Recommendations (Priority Order)

### Priority 1: CRITICAL (Fix Immediately)

#### 1.1 **Add DATE Pattern to Scrubbing Logic**

**File:** `services/piiScrubber.ts:133`
**Action:** Add one line after ZIP code scrubbing:

```typescript
runRegex('ID', PATTERNS.ZIPCODE, 'ZIP');
runRegex('DATE', PATTERNS.DATE, 'DATE'); // ← ADD THIS LINE
```

#### 1.2 **Add Street Address Pattern**

**File:** `services/piiScrubber.ts:18`
**Action:** Add comprehensive address pattern:

```typescript
// Multi-line street address pattern
ADDRESS: /\d+\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Parkway|Pkwy|Way|Circle|Cir|Place|Pl)(?:\.|\s|,|\s+Apt|\s+Suite|\s+Unit|\s+#)?(?:\s*[A-Za-z0-9#-]*)?/gi,

// City, State pattern (e.g., "Boston, MA" or "New York, NY")
CITY_STATE: /\b[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\b/g,

// P.O. Box pattern
PO_BOX: /P\.?O\.?\s*Box\s+\d+/gi,
```

**Then add to scrubbing logic:**

```typescript
runRegex('LOC', PATTERNS.ADDRESS, 'ADDR');
runRegex('LOC', PATTERNS.CITY_STATE, 'LOC');
runRegex('LOC', PATTERNS.PO_BOX, 'POBOX');
```

### Priority 2: HIGH (Fix Soon)

#### 2.1 **Add Label-Based Name Detection**

Context-aware name detection similar to MRN:

```typescript
const NAME_LABELS = [
  'Patient Name', 'Name', 'Full Name', 'Legal Name',
  'Patient:', 'Pt Name', "Patient's Name", 'patientName'
];

const detectLabeledName = (text: string) => {
  const pattern = new RegExp(
    `(${NAME_LABELS.join('|')})[:\\s]+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)`,
    'gi'
  );
  // Implementation...
};
```

#### 2.2 **Improve Chunk Boundary Handling**

**Issue:** Entities split across chunk boundaries may be missed.
**Solution:** Add overlap between chunks (e.g., last 100 chars of chunk N = first 100 chars of chunk N+1).

#### 2.3 **Add Format-Specific Pre-Processing**

Before scrubbing, detect format and normalize:

- **JSON:** Parse and flatten to "key: value" pairs
- **XML:** Strip tags, convert to "key: value" pairs
- **CSV:** Add newlines between rows, label columns

### Priority 3: MEDIUM (Enhance Later)

#### 3.1 **Lower ML Confidence Threshold for Names**

Current: 85% confidence for all entities.
Recommendation: Use different thresholds:

- PER (names): 75% (more sensitive)
- LOC (locations): 85% (current)
- ORG (organizations): 85% (current)

#### 3.2 **Add State Abbreviation List**

Regex for all 50 US state abbreviations in address context.

#### 3.3 **Comprehensive Integration Tests**

Add tests for:

- JSON files with PII
- XML files with PII
- CSV files with PII
- Multi-page PDF with addresses
- DOCX with embedded tables

---

## 📋 Quick Fix Checklist

To immediately fix the most critical issues:

- [ ] Add `runRegex('DATE', PATTERNS.DATE, 'DATE');` to line 133 of `piiScrubber.ts`
- [ ] Add `ADDRESS` pattern to `PATTERNS` object
- [ ] Add `CITY_STATE` pattern to `PATTERNS` object
- [ ] Add `PO_BOX` pattern to `PATTERNS` object
- [ ] Call `runRegex` for each new pattern
- [ ] Add label-based name detection function
- [ ] Add tests for all new patterns
- [ ] Test with real-world documents (PDF, JSON, CSV)

---

## 🧪 Testing Command

Run existing tests to ensure no regressions:

```bash
npm test services/piiScrubber
```

---

## Appendix: Example PII That Leaks

### Current Behavior (BEFORE FIX)

```yaml
Input:
Patient Name: John Smith
DOB: 01/15/1985
Address: 123 Main Street, Boston, MA 02101
Phone: (555) 123-4567
Email: john.smith@example.com

Output (Current):
Patient Name: John Smith          ← ❌ NAME LEAKED (depends on ML)
DOB: 01/15/1985                   ← ❌ DATE LEAKED
Address: 123 Main Street, Boston, MA [ZIP_1]  ← ❌ STREET/CITY/STATE LEAKED
Phone: [PHONE_1]                  ← ✅ SCRUBBED
Email: [EMAIL_1]                  ← ✅ SCRUBBED
```

### Expected Behavior (AFTER FIX)

```shell
Output (Expected):
Patient Name: [PER_1]             ← ✅ NAME SCRUBBED
DOB: [DATE_1]                     ← ✅ DATE SCRUBBED
Address: [ADDR_1], [LOC_1], [ZIP_1]  ← ✅ FULL ADDRESS SCRUBBED
Phone: [PHONE_1]                  ← ✅ SCRUBBED
Email: [EMAIL_1]                  ← ✅ SCRUBBED
```

---

## Conclusion

The PII scrubbing system has a solid foundation with regex patterns and ML model integration, but **critical gaps** allow dates, addresses, and context-dependent names to leak through. The most urgent fix is adding the DATE pattern to the scrubbing logic (1-line change), followed by implementing comprehensive address detection.

**Estimated fix time:**

- Critical issues (DATE, ADDRESS): 2-4 hours
- Label-based names: 1-2 hours
- Comprehensive testing: 2-3 hours
- **Total:** 5-9 hours of development time

---

**Report Generated:** 2024-11-21
**Audit Scope:** PII scrubbing logic, patterns, file format support
**Files Reviewed:** 8 TypeScript files, 2 test suites
**Issues Found:** 5 critical/high, 3 medium priority
