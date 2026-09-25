// ============================================================
// Friends Routes — Empire of Safavids
// ============================================================

import { Router, Request, Response } from 'express';
import { FriendsService } from '../services/FriendsService';
import { secureMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

export const friendsRouter = Router();
const friendsService = new FriendsService();

// GET /api/friends — список друзей
friendsRouter.get('/', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const friends = await friendsService.getFriends(req.userId!);
  const pending = await friendsService.getPendingRequests(req.userId!);
  return res.json({ friends, pending });
}));

// POST /api/friends/request — отправить запрос
friendsRouter.post('/request', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'friendId required' });
  await friendsService.sendRequest(req.userId!, friendId);
  return res.json({ success: true, message: 'Friend request sent' });
}));

// POST /api/friends/accept — принять запрос
friendsRouter.post('/accept', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'friendId required' });
  await friendsService.acceptRequest(req.userId!, friendId);
  return res.json({ success: true, message: 'Friend request accepted' });
}));

// DELETE /api/friends/:friendId — удалить друга
friendsRouter.delete('/:friendId', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  await friendsService.removeFriend(req.userId!, req.params.friendId);
  return res.json({ success: true, message: 'Friend removed' });
}));

// POST /api/friends/block — заблокировать
friendsRouter.post('/block', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'friendId required' });
  await friendsService.blockUser(req.userId!, friendId);
  return res.json({ success: true, message: 'User blocked' });
}));
