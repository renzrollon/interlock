import { AuthService } from '../../lib/auth';
import { sessionKey } from '../../lib/session';

export function login(email: string) {
  const auth = new AuthService();
  const normalized = auth.normalize(email);
  return { key: sessionKey(normalized) };
}
