// ============================================================
// Auth Types — Empire of Safavids
// ============================================================

export interface RegisterRequest {
  username: string;   // 3–20 символов, только a-z, 0-9, _
  email: string;
  password: string;   // мин 8 символов
  confirmPassword: string;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;
  birthYear: number;  // проверка 18+
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface AuthResponse {
  token: string;
  jwtToken: string;
  userId: string;
  username: string;
  expiresAt: Date;
}

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  isPremium: boolean;
  isAdmin: boolean;
  adminRole: string;
  isBanned: boolean;
  banReason?: string;
  banUntil?: Date;
  createdAt: Date;
  lastLoginAt: Date;
}

export interface SessionState {
  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  expiresAt: Date | null;
}

export type AuthError =
  | 'invalid_credentials'
  | 'user_not_found'
  | 'email_taken'
  | 'username_taken'
  | 'weak_password'
  | 'underage'
  | 'terms_not_accepted'
  | 'account_banned'
  | 'session_expired'
  | 'network_error'
  | 'server_error';

export const AUTH_ERROR_MESSAGES: Record<AuthError, string> = {
  invalid_credentials: 'Неверный email или пароль',
  user_not_found:      'Пользователь не найден',
  email_taken:         'Этот email уже зарегистрирован',
  username_taken:      'Это имя уже занято',
  weak_password:       'Пароль слишком простой (мин 8 символов)',
  underage:            'Доступ разрешён только с 18 лет',
  terms_not_accepted:  'Необходимо принять условия',
  account_banned:      'Аккаунт заблокирован',
  session_expired:     'Сессия истекла. Войдите снова',
  network_error:       'Ошибка сети. Проверьте подключение',
  server_error:        'Ошибка сервера. Попробуйте позже',
};
