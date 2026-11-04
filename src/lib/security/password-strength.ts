export interface PasswordStrengthResult {
    isValid: boolean;
    score: number; // 0 to 4
    errors: string[];
    hasMinLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
}

/**
 * Client- and server-safe password complexity validator:
 * - 8 to 128 characters
 * - Uppercase, lowercase, digit, and symbol
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
    const errors: string[] = [];
    const hasMinLength = typeof password === 'string' && password.length >= 8;
    const hasMaxLength = typeof password === 'string' && password.length <= 128;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasMinLength) {
        errors.push('Password must be at least 8 characters long');
    }
    if (!hasMaxLength) {
        errors.push('Password cannot exceed 128 characters');
    }
    if (!hasUppercase) {
        errors.push('Password must include at least one uppercase letter');
    }
    if (!hasLowercase) {
        errors.push('Password must include at least one lowercase letter');
    }
    if (!hasNumber) {
        errors.push('Password must include at least one number');
    }
    if (!hasSpecial) {
        errors.push('Password must include at least one special character');
    }

    let score = 0;
    if (password && password.length >= 8) score++;
    if (password && password.length >= 12) score++;
    if (hasUppercase && hasLowercase) score++;
    if (hasNumber && hasSpecial) score++;

    // Cap score at 4
    score = Math.min(4, Math.max(0, score));

    const isValid = errors.length === 0;

    return {
        isValid,
        score,
        errors,
        hasMinLength,
        hasUppercase,
        hasLowercase,
        hasNumber,
        hasSpecial,
    };
}

