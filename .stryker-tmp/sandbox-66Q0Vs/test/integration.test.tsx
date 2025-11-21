// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

// Mock external dependencies
vi.mock('../services/piiScrubber', () => ({
  piiScrubber: {
    loadModel: vi.fn().mockResolvedValue(undefined),
    scrub: vi.fn().mockResolvedValue({
      text: 'Patient [PER_1] visited on [DATE_1].',
      replacements: {
        'John Doe': '[PER_1]',
        '01/15/2024': '[DATE_1]',
      },
      count: 2,
    }),
  },
  detectContextualMRN: vi.fn().mockReturnValue([]),
  PATTERNS: {
    EMAIL: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g,
    PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
    SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g,
  },
  MRN_CONTEXT_KEYWORDS: ['MRN', 'Patient ID'],
}));

vi.mock('../services/fileParser', () => ({
  parseFile: vi.fn().mockResolvedValue('Patient John Doe visited on 01/15/2024.'),
}));

vi.mock('../services/db', () => ({
  db: {
    files: {
      toArray: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
}));

describe('Integration Tests - Full Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the app with header and hero section', () => {
    render(<App />);

    expect(screen.getByText(/Scrubah\.PII/i)).toBeInTheDocument();
    expect(screen.getByText(/SANITIZE YOUR DATA/i)).toBeInTheDocument();
    expect(screen.getByText(/KEEP IT LOCAL/i)).toBeInTheDocument();
  });

  it('should show system ready status after model loads', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });
  });

  it('should show loading state while model is loading', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');

    // Make model loading take time
    vi.mocked(piiScrubber.loadModel).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<App />);

    expect(screen.getByText(/LOADING_MODEL/i)).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
      },
      { timeout: 200 }
    );
  });

  it('should show error state when model fails to load', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');

    vi.mocked(piiScrubber.loadModel).mockRejectedValue(
      new Error('Failed to download model')
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/MODEL_ERROR/i)).toBeInTheDocument();
      expect(screen.getByText(/ML Model Failed to Load/i)).toBeInTheDocument();
    });
  });

  it('should allow retrying model load after failure', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');
    const user = userEvent.setup();

    // First call fails
    vi.mocked(piiScrubber.loadModel)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/MODEL_ERROR/i)).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Retry Model Load/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });
  });

  it('should render drop zone for file upload', () => {
    render(<App />);

    expect(screen.getByText(/Initiate Ingest/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag & Drop sensitive documents/i)).toBeInTheDocument();
  });

  it('should show accepted file types', () => {
    render(<App />);

    expect(screen.getByText(/PDF\/DOCX/i)).toBeInTheDocument();
    expect(screen.getByText(/OCR\/IMG/i)).toBeInTheDocument();
    expect(screen.getByText(/CSV\/MD/i)).toBeInTheDocument();
  });

  it('should process uploaded text file through full pipeline', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');
    const { parseFile } = await import('../services/fileParser');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    // Create a test file
    const fileContent = 'Patient John Doe visited on 01/15/2024.';
    const file = new File([fileContent], 'test.txt', { type: 'text/plain' });

    // Find the file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Simulate file selection
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    // Trigger the change event
    const event = new Event('change', { bubbles: true });
    fileInput.dispatchEvent(event);

    // Wait for processing to complete
    await waitFor(
      () => {
        expect(parseFile).toHaveBeenCalledWith(file);
        expect(piiScrubber.scrub).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );
  });

  it('should display file in status board after upload', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const fileContent = 'Test content';
    const file = new File([fileContent], 'medical-report.txt', { type: 'text/plain' });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    const event = new Event('change', { bubbles: true });
    fileInput.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText('medical-report.txt')).toBeInTheDocument();
    });
  });

  it('should show processing stages for uploaded file', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');

    // Make scrubbing take some time
    vi.mocked(piiScrubber.scrub).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        text: 'Scrubbed text',
        replacements: {},
        count: 0,
      }), 100))
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Should show processing stages
    await waitFor(() => {
      const statusText = screen.getByText(/test\.txt/i).closest('div');
      expect(statusText).toBeTruthy();
    });
  });

  it('should enable download button when file is processed', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const file = new File(['content'], 'report.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for completion
    await waitFor(
      () => {
        const downloadButton = screen.getByRole('button', { name: /Download Bundle/i });
        expect(downloadButton).not.toBeDisabled();
      },
      { timeout: 3000 }
    );
  });

  it('should show purge buffer button when files are present', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText(/Purge_Buffer/i)).toBeInTheDocument();
    });
  });

  it('should clear all files when purge is confirmed', async () => {
    const user = userEvent.setup();
    const { db } = await import('../services/db');

    // Mock window.confirm
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });

    const purgeButton = screen.getByRole('button', { name: /Purge_Buffer/i });
    await user.click(purgeButton);

    await waitFor(() => {
      expect(db.files.clear).toHaveBeenCalled();
    });
  });

  it('should display PII removal count after processing', async () => {
    const { piiScrubber } = await import('../services/piiScrubber');

    vi.mocked(piiScrubber.scrub).mockResolvedValue({
      text: 'Scrubbed content',
      replacements: { a: 'b', c: 'd', e: 'f' },
      count: 5,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM_READY/i)).toBeInTheDocument();
    });

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(
      () => {
        expect(screen.getByText(/-5 Entities/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
