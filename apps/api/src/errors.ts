import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function asyncHandler<T extends Request>(
  handler: (request: T, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: T, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(
    new AppError(404, 'ROUTE_NOT_FOUND', `Route ${request.method} ${request.path} was not found`),
  );
}

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) return;

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: request.requestId,
      },
    });
    return;
  }

  if ((error as { type?: string }).type === 'entity.too.large') {
    response.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the 256 KB limit',
        requestId: request.requestId,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten(),
        requestId: request.requestId,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId: request.requestId,
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown server error';
  if (process.env.NODE_ENV !== 'test') console.error(error);
  response.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The server could not complete the request',
      ...(process.env.NODE_ENV === 'development' ? { details: message } : {}),
      requestId: request.requestId,
    },
  });
};
