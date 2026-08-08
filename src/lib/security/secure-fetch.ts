/**
 * Client helper: attach replay-protection headers required by authorizeApiRequest.
 */
export function withSecurityHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('x-security-nonce', crypto.randomUUID());
  headers.set('x-timestamp', String(Date.now()));
  return { ...init, headers };
}

export async function secureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, withSecurityHeaders(init));
}
