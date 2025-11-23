import { describe, it, expect } from 'vitest';
import { runParseFile } from './fileParser.effect';

describe('File Parser - Effect-TS Version', () => {
  it('should parse plain text files', async () => {
    const content = 'Hello World';
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], 'test.txt', { type: 'text/plain' });

    const result = await runParseFile(file);

    expect(result).toContain('Hello World');
  });

  it('should parse CSV files', async () => {
    const content = 'Name,Age\\nJohn,30';
    const blob = new Blob([content], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const result = await runParseFile(file);

    expect(result).toContain('Name,Age');
    expect(result).toContain('John,30');
  });

  it('should handle empty files', async () => {
    const blob = new Blob([''], { type: 'text/plain' });
    const file = new File([blob], 'empty.txt', { type: 'text/plain' });

    const result = await runParseFile(file);

    expect(result).toBe('');
  });

  it('should throw error for unsupported file types', async () => {
    const blob = new Blob(['data'], { type: 'application/x-unknown' });
    const file = new File([blob], 'test.xyz', { type: 'application/x-unknown' });

    await expect(runParseFile(file)).rejects.toThrow();
  });
});
