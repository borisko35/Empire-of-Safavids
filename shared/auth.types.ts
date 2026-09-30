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
  /**
   * Код из приложения-аутентификатора или код восстановления.
   *
   * Необязателен: у аккаунта без 2FA его не будет. Наличие второго фактора
   * решает сервер, а не клиент, - иначе клиент пришлось бы знать про 2FA
   * больше, чем сервер, и наверстал бы расхождение.
   */
  code?: string;
}

export interface AuthResponse {
  token: string;
  jwtToken: string;
  userId: string;
  username: string;
  expiresAt: Date;
  /** true — аккаунт гостевой: его стоит предложить сохранить */
  isGuest?: boolean;
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
  /** true — аккаунт гостевой, ещё не присвоен игроком */
  isGuest?: boolean;
}

export interface SessionState {
  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  expiresAt: Date | null;
}

/** Внешние сервисы входа: пароль не придумываем — один клик */
export type OAuthProvider = 'google' | 'facebook';

/** Публичная часть настройки: секрет в браузер не попадает никогда */
export interface OAuthPublicConfig {
  provider: OAuthProvider;
  clientId: string;
  /** Куда провайдер вернёт игрока */
  redirectUri: string;
  /** Адрес, на который клиент отправляет игрока */
  authorizeUrl: string;
}

export interface OAuthProfile {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
}

export type AuthError =
  | 'invalid_credentials'
  | 'user_not_found'
  | 'email_taken'
  | 'username_taken'
  | 'username_invalid'
  | 'email_invalid'
  | 'weak_password'
  | 'password_mismatch'
  | 'underage'
  | 'terms_not_accepted'
  | 'account_banned'
  | 'session_expired'
  | 'network_error'
  | 'server_error'
  | 'guest_rate_limited'
  | 'not_guest'
  | 'already_claimed'
  | 'provider_disabled'
  | 'invalid_state'
  | 'provider_error'
  // Второй фактор. Возможны только после верного пароля.
  | 'two_factor_required'
  | 'two_factor_invalid'
  | 'two_factor_replayed'
  | 'two_factor_locked'
  | 'two_factor_not_enabled'
  | 'two_factor_no_secret'
  | 'two_factor_unavailable';

export const AUTH_ERROR_MESSAGES: Record<AuthError, string> = {
  invalid_credentials: 'Неверный email или пароль',
  user_not_found:      'Пользователь не найден',
  email_taken:         'Этот email уже зарегистрирован',
  username_taken:      'Это имя уже занято',
  username_invalid:    'Имя: 3-20 символов, только латиница, цифры и _',
  email_invalid:       'Некорректный email',
  password_mismatch:   'Пароли не совпадают',
  weak_password:       'Пароль слишком простой (мин 8 символов)',
  underage:            'Доступ разрешён только с 18 лет',
  terms_not_accepted:  'Необходимо принять условия',
  account_banned:      'Аккаунт заблокирован',
  session_expired:     'Сессия истекла. Войдите снова',
  network_error:       'Ошибка сети. Проверьте подключение',
  server_error:        'Ошибка сервера. Попробуйте позже',
  guest_rate_limited:  'Слишком много гостевых аккаунтов с этого устройства. Попробуйте позже',
  not_guest:           'Это не гостевой аккаунт',
  already_claimed:     'Аккаунт уже сохранён',
  provider_disabled:   'Этот способ входа пока не настроен',
  invalid_state:       'Вход устарел. Попробуйте ещё раз',
  two_factor_required:   'Введите код из приложения-аутентификатора',
  two_factor_invalid:    'Код не подошёл',
  two_factor_replayed:   'Этот код уже использован. Введите следующий',
  two_factor_locked:     'Слишком много попыток. Подождите несколько минут',
  two_factor_not_enabled:'Второй фактор не включён',
  two_factor_no_secret:  'Код временно недоступен. Попробуйте позже',
  two_factor_unavailable:'Второй фактор сейчас недоступен',
  provider_error:      'Не удалось войти через внешний сервис',
};
