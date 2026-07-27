import type { AppUser } from '@jixin/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AppUser;
    }
  }
}

export {};
