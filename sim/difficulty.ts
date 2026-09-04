// sim/difficulty.ts — opponent pressure presets. Player rules stay fixed;
// only the other side's chase / reclaim / Rip timing scales.

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyTuning {
  /** Opponent open-field speed vs PLAYER_MAX_SPEED (1 = walk parity). */
  opponentSpeedMult: number;
  /** Loose-stone contest burst for opponents (1 = no burst). */
  opponentLooseBoost: number;
  /** Last-third defend burst for opponents. */
  opponentDefendBoost: number;
  /** Score-drive force multiplier while an opponent carries / shepherds. */
  opponentDriveForceMult: number;
  /** Score-drive speed nudge while an opponent carries. */
  opponentDriveSpeedMult: number;
  /** How many opposing hold bodies leave the millstone to reclaim. */
  opponentReclaimCount: number;
  /** How many opposing hold bodies swarm a loose stone from anywhere. */
  opponentLooseHelpCount: number;
  /** Seconds an opposing NPC must hold Rip to pop the stone. */
  opponentRipSeconds: number;
  /** Ticks before another opposing NPC may start Rip after a pop. */
  opponentRipCooldownTicks: number;
}

/** Default first-run preset. */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export const DIFFICULTY_TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: {
    opponentSpeedMult: 0.84,
    opponentLooseBoost: 1.1,
    opponentDefendBoost: 1.08,
    opponentDriveForceMult: 1.18,
    opponentDriveSpeedMult: 1.02,
    opponentReclaimCount: 1,
    opponentLooseHelpCount: 2,
    opponentRipSeconds: 1.35,
    opponentRipCooldownTicks: 280,
  },
  normal: {
    opponentSpeedMult: 1,
    opponentLooseBoost: 1.22,
    opponentDefendBoost: 1.16,
    opponentDriveForceMult: 1.36,
    opponentDriveSpeedMult: 1.04,
    opponentReclaimCount: 2,
    opponentLooseHelpCount: 3,
    opponentRipSeconds: 1.15,
    opponentRipCooldownTicks: 210,
  },
  hard: {
    opponentSpeedMult: 1.06,
    opponentLooseBoost: 1.26,
    opponentDefendBoost: 1.22,
    opponentDriveForceMult: 1.48,
    opponentDriveSpeedMult: 1.06,
    opponentReclaimCount: 4,
    opponentLooseHelpCount: 5,
    opponentRipSeconds: 0.85,
    opponentRipCooldownTicks: 140,
  },
};

export function difficultyTuning(level: Difficulty): DifficultyTuning {
  return DIFFICULTY_TUNING[level];
}
