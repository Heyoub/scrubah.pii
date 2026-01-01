type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogMetadata = Record<string, unknown>;

const getMode = (): 'production' | 'development' => {
    try {
        // Vite/browser
        const meta = import.meta as unknown as { env?: { MODE?: string } };
        const mode = meta.env?.MODE;
        if (mode === 'production') return 'production';
        if (mode) return 'development';
    } catch {
        // ignore
    }

    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
        return 'production';
    }

    return 'development';
};

const isProduction = (): boolean => getMode() === 'production';

export const isProductionMode = (): boolean => isProduction();

const REDACT_KEYS = [/rawtext/i, /scrubbedtext/i, /text$/i, /content/i, /document/i, /context/i, /entity/i];

const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
        // Avoid leaking extracted content.
        // Keep small strings (labels, ids) but redact longer payloads.
        if (value.length > 120 || value.includes('\n')) {
            return '[REDACTED]';
        }
        return value;
    }

    if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
            return value.map((v) => redactValue(v));
        }

        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            if (REDACT_KEYS.some((re) => re.test(k))) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = redactValue(v);
            }
        }
        return out;
    }

    return value;
};

const shouldLog = (level: LogLevel): boolean => {
    if (!isProduction()) return true;
    return level === 'warn' || level === 'error';
};

const emit = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
    if (!shouldLog(level)) return;

    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message: redactValue(message),
        ...(metadata ? (redactValue(metadata) as LogMetadata) : {}),
    };

    if (level === 'error') {
        console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
        console.warn(JSON.stringify(entry));
    } else if (level === 'info') {
        console.info(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
};

export const appLogger = {
    debug(message: string, metadata?: LogMetadata) {
        emit('debug', message, metadata);
    },
    info(message: string, metadata?: LogMetadata) {
        emit('info', message, metadata);
    },
    warn(message: string, metadata?: LogMetadata) {
        emit('warn', message, metadata);
    },
    error(message: string, metadata?: LogMetadata) {
        emit('error', message, metadata);
    },
};
