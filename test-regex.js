// Quick regex test
const testCases = [
  {
    name: "Visit",
    text: "Patient visit on 03/15/2024. Consultation completed successfully.",
    pattern: /(?:visit|appointment|consultation).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi
  },
  {
    name: "Lab",
    text: "Lab results received on 04/10/2024. CBC panel complete.",
    pattern: /(?:lab|test)\s+results?.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi
  },
  {
    name: "Medication",
    text: "Patient started Lisinopril 10mg on 05/01/2024.",
    pattern: /(?:started|stopped|prescribed).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi
  }
];

for (const test of testCases) {
  console.log(`\n${test.name}:`);
  console.log(`Text: "${test.text}"`);
  console.log(`Pattern: ${test.pattern}`);

  const match = test.pattern.exec(test.text);
  if (match) {
    console.log(`✓ Match found: "${match[0]}"`);
    console.log(`  Captured date: "${match[1]}"`);
  } else {
    console.log(`✗ No match found`);
  }
}
