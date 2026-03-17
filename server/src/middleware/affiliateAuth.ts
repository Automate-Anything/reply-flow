import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

declare global {
  namespace Express {
    interface Request {
      affiliateId?: string;
    }
  }
}

export async function requireAffiliateAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (!env.AFFILIATE_JWT_SECRET) {
    res.status(500).json({ error: 'Affiliate auth not configured' });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.AFFILIATE_JWT_SECRET);
    if (typeof decoded !== 'object' || decoded === null || typeof (decoded as any).affiliateId !== 'string') {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }
    req.affiliateId = (decoded as { affiliateId: string }).affiliateId;
    next();
  } catch (err) {
    console.error('Affiliate auth failed:', err instanceof Error ? err.message : String(err));
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
