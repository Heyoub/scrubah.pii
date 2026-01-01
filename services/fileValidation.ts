export type FileValidationIssueCode =
    | 'EMPTY_NAME'
    | 'NAME_TOO_SHORT'
    | 'INVALID_CHARS'
    | 'MISSING_EXTENSION'
    | 'EXT_NOT_ALLOWED'
    | 'MIME_NOT_ALLOWED'
    | 'FILE_TOO_LARGE'
    | 'EMPTY_FILE';

export interface FileValidationIssue {
    readonly code: FileValidationIssueCode;
    readonly message: string;
}

export interface FileValidationResult {
    readonly ok: boolean;
    readonly issues: ReadonlyArray<FileValidationIssue>;
    readonly normalizedName?: string;
    readonly extension?: string;
}

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
    'pdf',
    'docx',
    'txt',
    'csv',
    'md',
    'json',
    'png',
    'jpg',
    'jpeg',
    'webp',
]);

const DEFAULT_ALLOWED_MIME_PREFIXES = ['image/'] as const;

const DEFAULT_ALLOWED_MIME_EXACT = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
]);

const MAX_FILENAME_LENGTH = 180;

const normalizeFilename = (name: string): string => {
    const trimmed = name.trim();

    const withoutPath = trimmed.replace(/^[A-Za-z]:\\/g, '').split(/[/\\]/).pop() || trimmed;

    // remove control chars and normalize whitespace
    let safe = withoutPath.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();

    // reject obvious path traversal artifacts
    safe = safe.replace(/\.{2,}/g, '.');

    if (safe.length > MAX_FILENAME_LENGTH) {
        safe = safe.slice(0, MAX_FILENAME_LENGTH);
    }

    return safe;
};

const getExtension = (name: string): string | undefined => {
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return undefined;
    return name.slice(idx + 1).toLowerCase();
};

export const validateFile = (
    file: File,
    options?: {
        readonly allowedExtensions?: ReadonlySet<string>;
        readonly maxBytes?: number;
    }
): FileValidationResult => {
    const issues: FileValidationIssue[] = [];

    const normalizedName = normalizeFilename(file.name);
    if (!normalizedName) {
        issues.push({ code: 'EMPTY_NAME', message: 'File name is empty.' });
        return { ok: false, issues };
    }

    if (normalizedName.length < 3) {
        issues.push({ code: 'NAME_TOO_SHORT', message: 'File name is too short.' });
    }

    // Disallow reserved/suspicious characters in filenames
    if (/[<>:"|?*]/.test(normalizedName)) {
        issues.push({
            code: 'INVALID_CHARS',
            message: 'File name contains invalid characters.'
        });
    }

    const extension = getExtension(normalizedName);
    if (!extension) {
        issues.push({ code: 'MISSING_EXTENSION', message: 'File must have an extension.' });
    }

    const allowedExt = options?.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
    if (extension && !allowedExt.has(extension)) {
        issues.push({
            code: 'EXT_NOT_ALLOWED',
            message: `File extension .${extension} is not supported.`
        });
    }

    // MIME is best-effort (can be empty). If present, enforce allowlist.
    const mime = file.type;
    if (mime) {
        const prefixOk = DEFAULT_ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
        const exactOk = DEFAULT_ALLOWED_MIME_EXACT.has(mime);
        if (!prefixOk && !exactOk) {
            issues.push({
                code: 'MIME_NOT_ALLOWED',
                message: `File type ${mime} is not supported.`
            });
        }
    }

    if (typeof options?.maxBytes === 'number' && file.size > options.maxBytes) {
        issues.push({
            code: 'FILE_TOO_LARGE',
            message: `File is too large (${file.size} bytes).`
        });
    }

    if (file.size === 0) {
        issues.push({ code: 'EMPTY_FILE', message: 'File is empty.' });
    }

    return {
        ok: issues.length === 0,
        issues,
        normalizedName,
        extension,
    };
};
