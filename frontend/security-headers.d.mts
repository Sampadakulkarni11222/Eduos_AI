export function originOf(url: unknown): string;
export function contentSecurityPolicy(options?: { backendUrl?: string }): string;
export function securityHeaders(options?: { backendUrl?: string }): { key: string; value: string }[];
