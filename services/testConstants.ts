/**
 * OBVIOUSLY-FAKE TEST DATA CONSTANTS
 *
 * These values are intentionally invalid to prevent copy-paste into production.
 * Defense-in-depth: Hard to accidentally ship, easy to identify in logs.
 */

export const TEST_PII = {
  // Emails - using .invalid TLD (RFC 6761 - guaranteed to never be real)
  EMAIL_PRIMARY: 'test-patient@example.invalid',
  EMAIL_SECONDARY: 'test-doctor@medical.invalid',
  EMAIL_EMERGENCY: 'test-contact@family.invalid',
  EMAIL_REPEATED: 'test-repeated@example.invalid',

  // SSNs - Using 000 prefix (invalid per SSA rules)
  SSN_PRIMARY: '000-00-0001',
  SSN_SPOUSE: '000-00-0002',
  SSN_DEPENDENT: '000-00-0003',

  // Phone Numbers - Using 555-01XX range (reserved for fictional use)
  // Must be 10 digits for regex match: xxx-xxx-xxxx
  PHONE_PRIMARY: '555-010-0000',
  PHONE_SECONDARY: '555-010-0001',
  PHONE_EMERGENCY: '555-010-0002',
  PHONE_WITH_COUNTRY: '+1 555-010-0003',
  PHONE_FORMATTED_1: '(555) 010-0004',
  PHONE_FORMATTED_2: '555-010-0005',

  // Credit Cards - Using test card numbers (Luhn-valid but reserved)
  // Source: https://www.paypalobjects.com/en_GB/vhelp/paypalmanager_help/credit_card_numbers.htm
  CARD_VISA: '4111-1111-1111-1111',
  CARD_MASTERCARD: '5500-0000-0000-0004',
  CARD_AMEX: '3400-0000-0000-009',

  // Medical Record Numbers - Prefix with TEST
  // Must be 6-12 alphanumeric chars for regex match
  MRN_PRIMARY: 'TEST000001',
  MRN_SECONDARY: 'TEST000002',
  MRN_FORMATTED: 'TESTMED0001',

  // ZIP Codes - Using 00000 (non-existent)
  ZIP_5_DIGIT: '00000',
  ZIP_PLUS_4: '00000-0001',
  ZIP_REAL_LOOKING: '99999', // Also invalid

  // Dates - Using obviously fake dates
  DATE_FUTURE: '12/31/2099',
  DATE_PAST: '01/01/1900',
  DATE_BIRTH: '01/01/1950',
  DATE_VISIT: '06/15/2024',

  // Names - Clearly test data
  NAME_PATIENT: 'Test Patient',
  NAME_DOCTOR: 'Dr. Test Physician',
  NAME_NURSE: 'Nurse Test Helper',

  // Locations - Fictional
  LOCATION_HOSPITAL: 'Test General Hospital',
  LOCATION_CITY: 'Testville',
  LOCATION_STATE: 'Testachusetts',

  // Organizations - Clearly fake
  ORG_INSURANCE: 'Test Insurance Corp',
  ORG_PHARMACY: 'Test Pharmacy LLC',
  ORG_CLINIC: 'Test Medical Clinic'
} as const;

/**
 * Test data patterns - for pattern matching tests
 */
export const TEST_PATTERNS = {
  VALID_EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(invalid|test)$/,
  VALID_SSN: /^000-00-\d{4}$/,
  VALID_PHONE: /^(?:\+1\s*)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}$/,
  VALID_CARD: /^(4111|5500|3400)/,
  VALID_MRN: /^TEST(?:MED)?\d{4,6}$/,
  VALID_ZIP: /^(00000|99999)/
};

/**
 * Why these values?
 *
 * 1. .invalid TLD - IETF reserved, will NEVER resolve
 * 2. 000-xx-xxxx SSNs - SSA explicitly excludes these
 * 3. 555-01xx phones - FCC reserved for fictional use
 * 4. 4111... cards - Payment processor test numbers
 * 5. TEST prefix - Immediately obvious in any log/database
 * 6. 00000/99999 ZIPs - USPS non-existent ranges
 *
 * If someone copy-pastes this into production:
 * - Emails will bounce (invalid TLD)
 * - SSNs will fail validation
 * - Phones won't route
 * - Cards will be rejected
 * - TEST prefix will be obvious in databases
 */
