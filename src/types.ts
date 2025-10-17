/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// Fix: Removed self-import of GameState that was causing a conflict.
export type GameState = 'PLAYER_SELECT' | 'IDLE' | 'LOADING' | 'READY' | 'BOWLING' | 'HITTING' | 'BALL_IN_PLAY' | 'OUT' | 'BALL_DEAD' | 'GAME_OVER';
export type ShotDirection = 'STRAIGHT' | 'OFF' | 'LEG';
export type PlayerCharacter = 'SP' | 'DH';


export interface Ball {
    x: number;
    y: number;
    z: number; // Height off the ground
    radius: number;
    dx: number; // Horizontal velocity
    dy: number; // Forward/backward velocity
    dz: number; // Vertical velocity (for hops/bounces)
    trail: { x: number; y: number; z: number, radius: number }[]; // For visual trail effect
}

export interface Batsman {
    x: number;
    y: number;
}

export interface Bat {
    swinging: boolean;
    swingAngle: number;
    maxSwingAngle: number;
}

export interface Stumps {
    x: number;
    y: number;
    width: number;
    height: number;
    hit: boolean;
}

export interface GameContextForCommentary {
    event: string;
    score?: number;
    wickets?: number;
    ballsBowled?: number;
    totalBalls?: number;
    targetScore?: number;
    runsScoredThisBall?: number;
}

export interface AssetsLoaded {
    bat: boolean;
    batsman: boolean;
    dhBatsman: boolean;
    ball: boolean;
    grass: boolean;
    all: boolean;
}