/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, ShotDirection, Ball, Batsman, Bat, Stumps, GameContextForCommentary, AssetsLoaded } from '../types';
import {
    CANVAS_WIDTH, CANVAS_HEIGHT, DEFAULT_TOTAL_BALLS, DEFAULT_MAX_WICKETS, MIN_BALL_SPEED_Y, MAX_BALL_SPEED_Y,
    NUM_STUMPS, STUMPS_WIDTH, STUMP_GAP, BATSMAN_SPRITE_DISPLAY_HEIGHT, STUMPS_HEIGHT,
    BAT_VISUAL_OFFSET_X, BAT_SPRITE_DISPLAY_WIDTH, FALLBACK_BAT_WIDTH, BAT_SPRITE_DISPLAY_HEIGHT,
    GRAVITY, BOUNCE_FACTOR, TRAIL_LENGTH, BALL_RADIUS
} from '../constants';

const MAX_COMMENTARY_WAIT_MS = 7000; // Maximum time to wait for commentary before forcing game progression

type UseGameEngineProps = {
    assets: {
        assetsLoaded: AssetsLoaded;
        batHitSoundRef: React.RefObject<HTMLAudioElement>;
        wicketSoundRef: React.RefObject<HTMLAudioElement>;
    };
    commentary: {
        isAudioPlayingRef: React.RefObject<boolean>;
        pendingNextBallActionRef: React.RefObject<(() => void) | null>;
        safetyNetNextBallTimeoutRef: React.RefObject<number | null>;
        initLiveSession: () => Promise<void>;
        triggerDynamicCommentary: (context: GameContextForCommentary) => Promise<boolean>;
    };
};

/**
 * The core game logic engine, managed as a custom hook.
 * This hook is responsible for all game state, physics, rules, and user input.
 */
export function useGameEngine({ assets, commentary }: UseGameEngineProps) {
    // Game State
    const [score, setScore] = useState(0);
    const [targetScore, setTargetScore] = useState(0);
    const [ballsBowled, setBallsBowled] = useState(0);
    const [totalBalls] = useState(DEFAULT_TOTAL_BALLS);
    const [wickets, setWickets] = useState(0);
    const [maxWickets] = useState(DEFAULT_MAX_WICKETS);
    const [currentGameState, setCurrentGameState] = useState<GameState>('LOADING');
    const [message, setMessage] = useState("Loading Assets...");
    const [shotDirection, setShotDirection] = useState<ShotDirection>('STRAIGHT');
    const [impactEffectText, setImpactEffectText] = useState("");
    const [showImpactEffect, setShowImpactEffect] = useState(false);

    // Game Elements
    const [ball, setBall] = useState<Ball | null>(null);
    const [batsman, setBatsman] = useState<Batsman | null>(null);
    const [bat, setBat] = useState<Bat | null>(null);
    const [stumps, setStumps] = useState<Stumps | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // --- Refs for State Access in Callbacks/Loops ---
    const stateRefs = useRef({ score, targetScore, ballsBowled, wickets, currentGameState, shotDirection, ball, batsman, bat, stumps, assetsLoaded: assets.assetsLoaded }).current;
    Object.assign(stateRefs, { score, targetScore, ballsBowled, wickets, currentGameState, shotDirection, ball, batsman, bat, stumps, assetsLoaded: assets.assetsLoaded });

    // --- Refs for Timers and Logic Flow ---
    const gameLoopIdRef = useRef<number | null>(null);
    const messageTimeoutIdRef = useRef<number | null>(null);
    const bowlTimeoutIdRef = useRef<number | null>(null);
    const nextBallTimeoutIdRef = useRef<number | null>(null);
    const isExecutingNextBallLogicRef = useRef(false);
    const deliveryContextRef = useRef<{ wasMiss?: boolean }>({});

    // --- UI & Message Functions ---
    const showAppMessage = useCallback((text: string, duration = 2000) => {
        setMessage(text);
        if (messageTimeoutIdRef.current) window.clearTimeout(messageTimeoutIdRef.current);
        if (duration > 0) messageTimeoutIdRef.current = window.setTimeout(() => setMessage(p => (p === text ? "" : p)), duration);
    }, []);

    const triggerImpactEffect = useCallback((text: string) => {
        setImpactEffectText(text);
        setShowImpactEffect(true);
        setTimeout(() => setShowImpactEffect(false), 1500);
    }, []);

    // --- Game Element Initialization ---
    const initGameElements = useCallback(() => {
        deliveryContextRef.current = {};
        const newBatsmanData: Batsman = { x: CANVAS_WIDTH / 2, y: 275 };
        setBall({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 38, z: 0, radius: 8, dx: 0, dy: 0, dz: 0, trail: [] });
        setBatsman(newBatsmanData);
        setBat({ swinging: false, swingAngle: 0, maxSwingAngle: Math.PI / 3.5 });
        setStumps({ x: CANVAS_WIDTH / 2 - (NUM_STUMPS * STUMPS_WIDTH + (NUM_STUMPS - 1) * STUMP_GAP) / 2, y: newBatsmanData.y + (BATSMAN_SPRITE_DISPLAY_HEIGHT / 2) - STUMPS_HEIGHT - 10, width: STUMPS_WIDTH, height: STUMPS_HEIGHT, hit: false });
    }, []);

    const playerWasSelected = useCallback(() => {
        if (stateRefs.currentGameState === 'PLAYER_SELECT') {
            setCurrentGameState('IDLE');
            setMessage("Press Start Game to begin!");
        }
    }, [stateRefs]);

    // --- Game Flow Logic ---
    const gameOver = useCallback((finalState: typeof stateRefs) => {
        setCurrentGameState('GAME_OVER');
        deliveryContextRef.current = {};
        const context: GameContextForCommentary = {
            event: '', score: finalState.score, targetScore: finalState.targetScore,
            wickets: finalState.wickets, ballsBowled: finalState.ballsBowled, totalBalls,
        };
        let endMsg = "";
        if (finalState.score >= finalState.targetScore && finalState.targetScore > 0) {
            endMsg = `YOU WON! Target: ${finalState.targetScore} Score: ${finalState.score}`;
            context.event = "gameWon";
            triggerImpactEffect("YOU WON!");
        } else if (finalState.wickets >= maxWickets) {
            endMsg = `Game Over! BOWLED! Target: ${finalState.targetScore} Score: ${finalState.score}`;
            context.event = "gameOverWickets";
            triggerImpactEffect("GAME OVER!");
        } else {
            endMsg = `Game Over! Overs Up! Target: ${finalState.targetScore} Score: ${finalState.score}`;
            context.event = "gameOverBalls";
            triggerImpactEffect("GAME OVER!");
        }
        showAppMessage(endMsg);
        commentary.triggerDynamicCommentary(context);
    }, [commentary, maxWickets, totalBalls, showAppMessage, triggerImpactEffect]);
    
    const bowlLogic = useCallback(() => {
        if (stateRefs.currentGameState !== 'READY') return;
        setCurrentGameState('BOWLING');
        deliveryContextRef.current = {};
        const randomSpeed = MIN_BALL_SPEED_Y + Math.random() * (MAX_BALL_SPEED_Y - MIN_BALL_SPEED_Y);
        setBall(prev => prev ? { ...prev, x: CANVAS_WIDTH / 2 + (Math.random() - 0.5) * 40, y: CANVAS_HEIGHT - 38, z: 0, dz: 0, dx: 0, dy: -randomSpeed, trail: [] } : null);
        showAppMessage("Bowler running in...", 2000);
    }, [showAppMessage, stateRefs]);
    
    const executeNextBallLogic = useCallback(async () => {
        if (isExecutingNextBallLogicRef.current) return;
        isExecutingNextBallLogicRef.current = true;

        if (bowlTimeoutIdRef.current) window.clearTimeout(bowlTimeoutIdRef.current);
        if (nextBallTimeoutIdRef.current) window.clearTimeout(nextBallTimeoutIdRef.current);
        if (commentary.safetyNetNextBallTimeoutRef.current) clearTimeout(commentary.safetyNetNextBallTimeoutRef.current);

        const latestState = stateRefs;
        if (latestState.currentGameState === 'GAME_OVER') {
            isExecutingNextBallLogicRef.current = false;
            return;
        }
        
        const { score, wickets, ballsBowled, targetScore } = latestState;
        if (wickets >= maxWickets || ballsBowled >= totalBalls || (targetScore > 0 && score >= targetScore)) {
            gameOver(latestState);
        } else {
            setCurrentGameState('READY');
            initGameElements();
            showAppMessage("Bowler is ready...", 0);
            bowlTimeoutIdRef.current = window.setTimeout(bowlLogic, 1000 + Math.random() * 900);
        }
        isExecutingNextBallLogicRef.current = false;
    }, [gameOver, initGameElements, showAppMessage, commentary, maxWickets, totalBalls, stateRefs, bowlLogic]);


    const scheduleNextBall = useCallback((delay: number) => {
        if (stateRefs.currentGameState === 'GAME_OVER') return;
        if (nextBallTimeoutIdRef.current) clearTimeout(nextBallTimeoutIdRef.current);
        if (bowlTimeoutIdRef.current) clearTimeout(bowlTimeoutIdRef.current);
        if (commentary.safetyNetNextBallTimeoutRef.current) clearTimeout(commentary.safetyNetNextBallTimeoutRef.current);

        const action = () => { commentary.pendingNextBallActionRef.current = null; executeNextBallLogic(); };
        commentary.pendingNextBallActionRef.current = action;

        if (!commentary.isAudioPlayingRef.current) {
            nextBallTimeoutIdRef.current = window.setTimeout(action, delay);
        } else {
            commentary.safetyNetNextBallTimeoutRef.current = window.setTimeout(() => {
                if (commentary.pendingNextBallActionRef.current === action) action();
            }, MAX_COMMENTARY_WAIT_MS);
        }
    }, [stateRefs, commentary, executeNextBallLogic]);

    const handleHit = useCallback(async () => {
        const { bat: cBt, ball: cBl, batsman: cBtsmn, shotDirection: cShtDir, assetsLoaded: cAssets } = stateRefs;
        if (!cBt || !cBl || !cBtsmn) return;

        let vSF = 0; if (cShtDir === 'LEG') vSF = -1; else if (cShtDir === 'OFF') vSF = 1;
        setBat(p => p ? { ...p, swinging: true, swingAngle: vSF * p.maxSwingAngle } : null);
        window.setTimeout(() => setBat(p => p ? { ...p, swinging: false } : null), 200);

        const batSpriteReady = cAssets.bat;
        const batWidth = batSpriteReady ? BAT_SPRITE_DISPLAY_WIDTH * 2.8 : FALLBACK_BAT_WIDTH * 4.0;
        const batHeight = batSpriteReady ? BAT_SPRITE_DISPLAY_HEIGHT * 2.0 : 150;
        const batCenterX = cBtsmn.x + BAT_VISUAL_OFFSET_X;
        const batEffectiveY = cBtsmn.y;
        const batTop = batEffectiveY - (batHeight / 2);
        const batBottom = batEffectiveY + (batHeight / 2);
        const batLeft = batCenterX - (batWidth / 2);
        const batRight = batCenterX + (batWidth / 2);

        let hitMade = cBl.y + cBl.radius > batTop &&
            cBl.y - cBl.radius < batBottom &&
            cBl.x + cBl.radius > batLeft &&
            cBl.x - cBl.radius < batRight;

        deliveryContextRef.current = {};

        if (hitMade) {
            setCurrentGameState('BALL_IN_PLAY');
            assets.batHitSoundRef.current?.play();

            let cE = "missedHit"; let rSTH = 0;
            const ballsBowledAfterThisDelivery = stateRefs.ballsBowled + 1;
            let timingFactor = Math.abs(cBl.y - batEffectiveY);
            let strength = 10;
            let verticalStrength = 8;

            if (timingFactor < batHeight * 0.25) {
                rSTH = Math.random() < 0.6 ? 6 : 4;
                showAppMessage(rSTH === 6 ? "PERFECT! SIXER!" : "SWEET! FOUR!", 2000);
                if (rSTH === 6) triggerImpactEffect("SIX!"); else triggerImpactEffect("FOUR!");
                strength = 17 + (Math.random() * 3);
                verticalStrength = 18;
                cE = rSTH === 6 ? 'hitSix' : 'hitFour';
            } else if (timingFactor < batHeight * 0.45) {
                rSTH = Math.random() < 0.8 ? 4 : (Math.random() < 0.7 ? 2 : 3);
                showAppMessage(rSTH === 4 ? "Well Hit! FOUR!" : `${rSTH} Runs!`, 2000);
                if (rSTH === 4) triggerImpactEffect("FOUR!");
                else if (rSTH === 3) triggerImpactEffect("THREE RUNS!");
                else if (rSTH === 2) triggerImpactEffect("TWO RUNS!");
                strength = 14 + (Math.random() * 2);
                verticalStrength = 12;
                if (rSTH === 4) cE = 'hitFour'; else if (rSTH === 3) cE = 'hitThree'; else cE = 'hitTwo';
            } else {
                rSTH = Math.random() < 0.8 ? 1 : (Math.random() < 0.6 ? 0 : 2);
                showAppMessage(rSTH > 0 ? `${rSTH} Run(s).` : "POOR TIMING!", 2000);
                if (rSTH === 2) triggerImpactEffect("TWO RUNS!");
                else if (rSTH === 1) triggerImpactEffect("ONE RUN!");
                else triggerImpactEffect("DOT BALL!");
                strength = 10 + (Math.random() * 1);
                verticalStrength = 5;
                if (rSTH === 2) cE = 'hitTwo'; else if (rSTH === 1) cE = 'hitOne'; else cE = 'hitDotContact';
            }

            const newScore = stateRefs.score + rSTH;
            setScore(newScore); setBallsBowled(ballsBowledAfterThisDelivery);
            
            let ballSpeedX = 0;
            if (cShtDir === 'LEG') ballSpeedX = (strength / 1.7);
            else if (cShtDir === 'OFF') ballSpeedX = (-strength / 1.7);
            else ballSpeedX = (Math.random() - 0.5) * 6;
            setBall(p => p ? { ...p, dx: ballSpeedX + (Math.random() - 0.5) * 2, dy: strength, dz: verticalStrength } : null);

            const gameEndsByThisHit = stateRefs.wickets >= maxWickets || ballsBowledAfterThisDelivery >= totalBalls || (stateRefs.targetScore > 0 && newScore >= stateRefs.targetScore);

            if (gameEndsByThisHit) {
                gameOver({ ...stateRefs, score: newScore, ballsBowled: ballsBowledAfterThisDelivery });
            } else {
                commentary.triggerDynamicCommentary({
                    event: cE, runsScoredThisBall: rSTH, score: newScore,
                    targetScore: stateRefs.targetScore, wickets: stateRefs.wickets,
                    ballsBowled: ballsBowledAfterThisDelivery, totalBalls
                });
            }
        } else {
            showAppMessage("SWING AND A MISS!", 1500);
            triggerImpactEffect("MISS!");
            deliveryContextRef.current = { wasMiss: true };
        }
    }, [stateRefs, assets.batHitSoundRef, showAppMessage, triggerImpactEffect, totalBalls, maxWickets, gameOver, commentary]);

    const swingBat = useCallback(() => {
        if (stateRefs.currentGameState === 'BOWLING') {
            setCurrentGameState('HITTING');
            handleHit();
        }
    }, [stateRefs, handleHit]);


    const updateBallPosition = useCallback(() => {
        const { currentGameState: cState, ball: cBall, stumps: cStumps, bat: cBat, score: cScore, wickets: cWickets, ballsBowled: cBalls, targetScore: cTarget } = stateRefs;
        if (!cBall) return;

        if (cState === 'BOWLING' || cState === 'HITTING') {
            if (!cStumps) return;
            const newBall = { ...cBall, y: cBall.y + cBall.dy };

            const canBeBowled = !(cBat?.swinging) || cState === 'BOWLING';
            if (canBeBowled && !cStumps.hit &&
                newBall.y - newBall.radius < cStumps.y + STUMPS_HEIGHT &&
                newBall.x + newBall.radius > cStumps.x && newBall.x - newBall.radius < cStumps.x + (NUM_STUMPS * STUMPS_WIDTH + (NUM_STUMPS - 1) * STUMP_GAP) &&
                newBall.y + newBall.radius > cStumps.y) {
                
                const wicketsAfterThis = cWickets + 1;
                const ballsBowledAfterThis = cBalls + 1;
                setStumps(p => p ? { ...p, hit: true } : null);
                assets.wicketSoundRef.current?.play();
                setCurrentGameState('OUT');
                showAppMessage("CLEAN BOWLED!", 3000);
                triggerImpactEffect("BOWLED!");
                setWickets(wicketsAfterThis);
                setBallsBowled(ballsBowledAfterThis);
                deliveryContextRef.current = {};
                
                commentary.triggerDynamicCommentary({
                    event: "wicketBowled", wickets: wicketsAfterThis, score: cScore,
                    targetScore: cTarget, ballsBowled: ballsBowledAfterThis, totalBalls
                });
                scheduleNextBall(3000);
                return;
            }

            if (newBall.y + newBall.radius < 0) { // Ball through to the keeper
                const ballsBowledAfterThis = cBalls + 1;
                setCurrentGameState('BALL_DEAD');
                showAppMessage("Through to the keeper.", 2000);
                setBallsBowled(ballsBowledAfterThis);
                const wasMissEvent = deliveryContextRef.current.wasMiss;
                if (wasMissEvent) triggerImpactEffect("MISS!"); else triggerImpactEffect("DOT BALL!");
                deliveryContextRef.current = {};
                
                commentary.triggerDynamicCommentary({
                    event: wasMissEvent ? "missedHit" : "dotBallKeeper", score: cScore,
                    targetScore: cTarget, wickets: cWickets, ballsBowled: ballsBowledAfterThis, totalBalls
                });
                scheduleNextBall(2500);
            }
            setBall(newBall);

        } else if (cState === 'BALL_IN_PLAY') {
            const newBall = { ...cBall };
            newBall.dz -= GRAVITY; newBall.z += newBall.dz;
            if (newBall.z < 0) { newBall.z = 0; newBall.dz = -newBall.dz * BOUNCE_FACTOR; newBall.dx *= 0.95; newBall.dy *= 0.95; }
            newBall.x += newBall.dx; newBall.y += newBall.dy;

            const currentRadius = BALL_RADIUS + newBall.z * 0.5;
            const newTrail = [...newBall.trail, { x: newBall.x, y: newBall.y, z: newBall.z, radius: currentRadius }];
            if (newTrail.length > TRAIL_LENGTH) newTrail.shift();
            newBall.trail = newTrail;

            const speed = Math.sqrt(newBall.dx * newBall.dx + newBall.dy * newBall.dy);
            const isEffectivelyStopped = newBall.z <= 0 && speed < 0.1;
            const outOfBounds = newBall.y > CANVAS_HEIGHT * 3 || newBall.y < -CANVAS_HEIGHT * 3 || newBall.x < -CANVAS_WIDTH * 3 || newBall.x > CANVAS_WIDTH * 3;
            
            if (outOfBounds || isEffectivelyStopped) {
                setCurrentGameState('BALL_DEAD');
                scheduleNextBall(2000);
            }
            setBall(newBall);
        }
    }, [stateRefs, assets.wicketSoundRef, commentary, gameOver, maxWickets, scheduleNextBall, showAppMessage, totalBalls, triggerImpactEffect, initGameElements]);


    // --- Effects ---
    useEffect(() => {
        if (assets.assetsLoaded.all) {
            setCurrentGameState('PLAYER_SELECT');
            setMessage('Choose Your Player');
            initGameElements();
        }
    }, [assets.assetsLoaded.all, initGameElements]);

    useEffect(() => {
        const loop = () => {
            if (stateRefs.currentGameState === 'BOWLING' || stateRefs.currentGameState === 'HITTING' || stateRefs.currentGameState === 'BALL_IN_PLAY') {
                updateBallPosition();
            }
            gameLoopIdRef.current = requestAnimationFrame(loop);
        };
        if (assets.assetsLoaded.all && !gameLoopIdRef.current) gameLoopIdRef.current = requestAnimationFrame(loop);
        return () => { if (gameLoopIdRef.current) { cancelAnimationFrame(gameLoopIdRef.current); gameLoopIdRef.current = null; } };
    }, [assets.assetsLoaded.all, updateBallPosition, stateRefs]);


    const startGame = useCallback(async () => {
        if (currentGameState === 'LOADING' || isExecutingNextBallLogicRef.current) return;

        if (gameLoopIdRef.current) cancelAnimationFrame(gameLoopIdRef.current); gameLoopIdRef.current = null;
        if (bowlTimeoutIdRef.current) clearTimeout(bowlTimeoutIdRef.current);
        if (nextBallTimeoutIdRef.current) clearTimeout(nextBallTimeoutIdRef.current);
        if (messageTimeoutIdRef.current) clearTimeout(messageTimeoutIdRef.current);
        if (commentary.safetyNetNextBallTimeoutRef.current) clearTimeout(commentary.safetyNetNextBallTimeoutRef.current);
        commentary.pendingNextBallActionRef.current = null;
        
        setScore(0); setWickets(0); setBallsBowled(0);
        const newTarget = Math.floor(Math.random() * 20) + 15;
        setTargetScore(newTarget); initGameElements();

        try { await commentary.initLiveSession(); await commentary.triggerDynamicCommentary({ event: "gameStart", targetScore: newTarget, totalBalls });
        } catch (e) { console.error("Failed to initialize commentary:", e); showAppMessage("Commentary failed to connect.", 3000); }

        setCurrentGameState('READY');
        bowlTimeoutIdRef.current = window.setTimeout(bowlLogic, 2000);
    }, [currentGameState, initGameElements, commentary, totalBalls, showAppMessage, bowlLogic]);

    const handleSetShotDirection = useCallback((dir: ShotDirection) => {
        setShotDirection(dir);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const cS = stateRefs.currentGameState;

            if (e.code === 'ArrowLeft') setShotDirection('OFF');
            else if (e.code === 'ArrowRight') setShotDirection('LEG');
            else if (e.code === 'ArrowUp') setShotDirection('STRAIGHT');

            if (e.code === 'Space') {
                e.preventDefault();
                if (cS === 'BOWLING') swingBat();
                else if (cS === 'IDLE' || cS === 'GAME_OVER') startGame();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [stateRefs, startGame, swingBat]);

    return {
        score, targetScore, ballsBowled, totalBalls, wickets, maxWickets, currentGameState,
        message, shotDirection, ball, batsman, bat, stumps, canvasRef, impactEffectText,
        showImpactEffect, startGame, swingBat, setShotDirection: handleSetShotDirection, playerWasSelected
    };
}