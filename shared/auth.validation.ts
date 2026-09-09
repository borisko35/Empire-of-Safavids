// ============================================================
// Auth Validation — Empire of Safavids
// ============================================================

import { RegisterRequest, LoginRequest, AuthError } from './auth.types';

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<string, string>>;
}

export function validateRegister(data: RegisterRequest): ValidationResult {
  const errors: Record<string, string> = {};

  // Username
  if (!data.username || data.username.length < 3) {
    errors.username = 'Имя должно быть не менее 3 символов';
  } else if (data.username.length > 20) {
    errors.username = 'Имя не должно превышать 20 символов';
  } else if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
    errors.username = 'Только латинские буквы, цифры и _';
  }

  // Email
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Введите корректный email';
  }

  // Password
  if (!data.password || data.password.length < 8) {
    errors.password = 'Пароль должен быть не менее 8 символов';
  } else if (!/[A-Z]/.test(data.password)) {
    errors.password = 'Пароль должен содержать хотя бы одну заглавную букву';
  } else if (!/[0-9]/.test(data.password)) {
    errors.password = 'Пароль должен содержать хотя бы одну цифру';
  }

  // Confirm password
  if (data.password !== data.confirmPassword) {
    errors.confirmPassword = 'Пароли не совпадают';
  }

  // Age check
  const currentYear = new Date().getFullYear();
  if (!data.birthYear || currentYear - data.birthYear < 18) {
    errors.birthYear = 'Доступ разрешён только с 18 лет';
  }

  // Terms
  if (!data.agreeToTerms) errors.agreeToTerms = 'Необходимо принять правила';
  if (!data.agreeToPrivacy) errors.agreeToPrivacy = 'Необходимо принять политику';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateLogin(data: LoginRequest): ValidationResult {
  const errors: Record<string, string> = {};
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Введите корректный email';
  }
  if (!data.password || data.password.length < 1) {
    errors.password = 'Введите пароль';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function getPasswordStrength(password: string): {
  score: number; label: string; color: string;
} {
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'Очень слабый', color: '#CC2200' };
  if (score === 2) return { score, label: 'Слабый',       color: '#FF6600' };
  if (score === 3) return { score, label: 'Средний',      color: '#FFB300' };
  if (score === 4) return { score, label: 'Хороший',      color: '#2D7A2D' };
  return { score, label: 'Отличный',    color: '#00AA44' };
}
