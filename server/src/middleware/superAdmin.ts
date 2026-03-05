import type { Request, Response, NextFunction } from 'express';

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.isSuperAdmin) {
    res.status(403).json({ error: 'Super admin access required' });
    return;
  }
  next();
}
