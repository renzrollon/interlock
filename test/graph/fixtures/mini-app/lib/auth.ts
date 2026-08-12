export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AuthService {
  normalize(email: string) {
    return normalizeEmail(email);
  }
}
