import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../services/RedisService';

declare global {
  // Официальный способ расширения Express.Request типами приложения
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const redis = RedisService.getInstance();

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const userId = await redis.getSession(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.userId = userId;
  next();
}
