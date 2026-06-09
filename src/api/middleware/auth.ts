import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  apiKey?: string;
  isAuthenticated: boolean;
}

export const authenticateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  const authReq = req as AuthenticatedRequest;

  if (!authHeader) {
    authReq.isAuthenticated = false;
    return next();
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' && scheme !== 'ApiKey') {
    authReq.isAuthenticated = false;
    return next();
  }

  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    console.warn('API_KEY environment variable not set');
    authReq.isAuthenticated = false;
    return next();
  }

  if (token === expectedApiKey) {
    authReq.isAuthenticated = true;
    authReq.apiKey = token;
    authReq.userId = 'api-client';
  } else {
    authReq.isAuthenticated = false;
  }

  next();
};

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.isAuthenticated) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required',
    });
    return;
  }

  next();
};

export const validateApiKey = (apiKey: string): boolean => {
  const expectedApiKey = process.env.API_KEY;
  if (!expectedApiKey) {
    return false;
  }
  return apiKey === expectedApiKey;
};
