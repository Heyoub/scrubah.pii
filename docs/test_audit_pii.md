# PII Scrubbing Audit Test Document

This document contains various types of PII to test the scrubbing functionality.

## Patient Information

Patient Name: John Smith
Name: Mary Johnson
Full Name: Robert Williams
Dr. Sarah Davis

## Contact Information

Email: <john.smith@example.com>
Phone: (555) 123-4567
Mobile: 555-987-6543

## Addresses

123 Main Street, Boston, MA 02101
456 Elm Avenue, New York, NY 10001
789 Oak Road, Los Angeles, CA 90001
1234 Pine Boulevard, Chicago, IL 60601
567 Maple Drive, Houston, TX 77001

Street Address: 999 Cherry Lane
City: San Francisco
State: California
ZIP: 94102

## Medical Records

MRN: ABC123456
Medical Record Number: XYZ789012
Patient ID: MED456789
DOB: 01/15/1985
Date of Birth: 12/31/1990
SSN: 123-45-6789

## Visit Information

Visit Date: 11/20/2024
Admission Date: 10/15/2024
Discharge Date: 10/20/2024

## Insurance

Policy Number: 4532-1234-5678-9010
Member ID: INS987654

## Structured Formats

**JSON-like:**

```json
{
  "patientName": "Alice Brown",
  "address": "321 Sunset Boulevard, Miami, FL 33101",
  "phone": "305-555-1234",
  "email": "alice.brown@email.com"
}
```

**CSV-like:**
Name,Address,Phone,Email
"Michael Green","654 River Road, Seattle, WA 98101","206-555-5678","<michael.g@test.com>"
"Jennifer White","987 Mountain View, Denver, CO 80201","303-555-9012","<jen.white@example.org>"

**XML-like:**

```xml
<Patient>
  <Name>David Lee</Name>
  <Address>147 Valley Street, Portland, OR 97201</Address>
  <Phone>503-555-3456</Phone>
  <Email>david.lee@mail.com</Email>
</Patient>
```

## Label Variations

Patient: Thomas Anderson
Patient's Name: Linda Martinez
Pt Name: Christopher Taylor
Name of Patient: Patricia Anderson
Legal Name: William Thompson

## Additional Address Formats

Home Address: 852 Beach Avenue, Apt 4B, Miami Beach, FL 33139
Work Address: 369 Corporate Parkway, Suite 200, Austin, TX 78701
Mailing Address: P.O. Box 1234, Phoenix, AZ 85001
Billing Address: 741 Commerce Street, Dallas, TX 75201

## City and State Only

Location: Boston, Massachusetts
City/State: Los Angeles, CA
Residing in: New York, NY
From: Chicago, Illinois
