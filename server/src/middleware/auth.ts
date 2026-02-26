import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Augment Express Request with userId, companyId, and userRole
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      companyId?: string;
      userRole?: string;
    }
  }
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.userId = data.user.id;

  // Resolve company membership and role
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, roles(name)')
    .eq('user_id', data.user.id)
    .single();

  if (membership) {
    req.companyId = membership.company_id;
    req.userRole = (membership.roles as unknown as { name: string })?.name || undefined;
  }
  // If no membership, user may be in invitation flow — allow through without companyId

  next();
}
