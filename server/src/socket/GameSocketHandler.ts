// ============================================================
// Game Socket Handler — Empire of Safavids
// ============================================================
import { AuthenticatedSocket } from './AuthSocket';
import { Socket } from 'socket.io';
import { CombatService } from '../services/CombatService';
import { PartySystem } from '../systems/PartySystem';
import { DefenseStates } from '../systems/DefenseStates';
import { DungeonService } from '../systems/DungeonService';
import { MonsterEffects } from '../systems/MonsterEffects';
import { BuffService } from '../services/BuffService';
import { TerritoryBonuses } from '../systems/TerritoryBonuses';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { leaderboardService } from '../services/LeaderboardService';
import { achievementsService } from '../services/AchievementsService';
import { rewardService } from '../services/RewardService';
import { questService } from '../services/QuestService';
import { ai as GameLoop } from '../systems/GameLoop';
import { SOCKET_EVENTS } from '../constants';
import { Region } from '../types/game.types';
import { Vector3 } from '../types/game.types';
import { getZoneAt } from '../shared/constants';
import { STANCES } from '../systems/CombatStance';
import { CURRENCIES } from '../sharedconstants';

// (rest of the file continues...)