const bytesToHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

export const generateId = (): string => {
    const c = globalThis.crypto as Crypto | undefined;

    if (c?.randomUUID) {
        return c.randomUUID();
    }

    if (c?.getRandomValues) {
        const b = new Uint8Array(16);
        c.getRandomValues(b);

        // RFC 4122 v4
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;

        const hex = bytesToHex(b);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};
