import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { AppUser, UserRole } from '@jixin/shared';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { USERS_BY_ID, USERS_BY_USERNAME } from './users.js';

interface TokenClaims extends JwtPayload {
  sub: string;
  role: UserRole;
}

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authenticateDemoUser(username: string, password: string): AppUser {
  const account = USERS_BY_USERNAME.get(username);
  if (!account || !equalSecret(password, account.password)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
  }
  return account.user;
}

export function createToken(user: AppUser, config: AppConfig) {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn as NonNullable<SignOptions['expiresIn']>,
  };
  return jwt.sign({ role: user.role }, config.jwtSecret, { ...options, subject: user.id });
}

export function authenticateRequest(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      next(new AppError(401, 'AUTH_REQUIRED', 'A Bearer token is required'));
      return;
    }

    try {
      const decoded = jwt.verify(header.slice(7), config.jwtSecret, {
        algorithms: ['HS256'],
      }) as TokenClaims;
      const user = decoded.sub ? USERS_BY_ID.get(decoded.sub) : undefined;
      if (!user || user.role !== decoded.role) throw new Error('Unknown token subject');
      request.user = user;
      next();
    } catch {
      next(new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired'));
    }
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user) {
      next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required'));
      return;
    }
    if (!roles.includes(request.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'Your role cannot perform this action'));
      return;
    }
    next();
  };
}

export function requireUser(request: Request): AppUser {
  if (!request.user) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required');
  return request.user;
}
