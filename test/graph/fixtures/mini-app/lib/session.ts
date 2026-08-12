import { normalizeEmail } from './auth';

export function sessionKey(email: string): string {
  return `sess:${normalizeEmail(email)}`;
}
