/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useCallback } from 'react';

import { useGameAssets } from './hooks/useGameAssets';
import { useLiveCommentary } from './hooks/useLiveCommentary';
import { useGameEngine } from './hooks/useGameEngine';
import { PlayerCharacter } from './types';

import Scoreboard from './components/Scoreboard';
import GameCanvas from './components/GameCanvas';
import StartButton from './components/StartButton';
import ImpactMessage from './components/ImpactMessage';
import MobileControls from './components/MobileControls';
import MessageDisplay from './components/MessageDisplay';
import PlayerSelect from './components/PlayerSelect';

/**
 * The main Cricket Game component.
 * This component now acts as a "composition root". It initializes all the
 * custom hooks responsible for different parts of the game (assets, commentary, game logic)
 * and then passes the state and callbacks down to the presentational components.
 */
function CricketGame() {
    const [apiKeyReady, setApiKeyReady] = useState(false);
    const [apiKeyError, setApiKeyError] = useState(false);

    const handleApiKeyError = useCallback(() => {
        setApiKeyReady(false);
        setApiKeyError(true);
    }, []);

    const assets = useGameAssets();
    const commentary = useLiveCommentary({ onApiKeyError: handleApiKeyError });
    const game = useGameEngine({ assets, commentary });
    const [playerCharacter, setPlayerCharacter] = useState<PlayerCharacter>('SP');

    useEffect(() => {
        const checkKey = async () => {
            if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setApiKeyReady(hasKey);
            } else {
                console.warn("aistudio API not available.");
                // Fallback for local development if needed, though commentary will fail.
                setApiKeyReady(true);
            }
        };
        checkKey();
    }, []);

    const handleSelectApiKey = async () => {
        setApiKeyError(false);
        try {
            await window.aistudio.openSelectKey();
            setApiKeyReady(true); // Optimistically assume success
        } catch (e) {
            console.error("Failed to open API key selection:", e);
            setApiKeyError(true); // Show error if dialog fails to open
        }
    };


    const handlePlayerSelect = (player: PlayerCharacter) => {
        setPlayerCharacter(player);
        game.playerWasSelected();
    };

    if (!apiKeyReady) {
        return (
            <div className="immersive-container">
                 <div className="api-key-overlay">
                    <div className="api-key-content">
                        <h2>API Key Required</h2>
                        <p>This game uses the Gemini Live API for real-time commentary, which requires you to select your own API key.</p>
                        <p>Please ensure your project has billing enabled. <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Learn more about billing</a>.</p>
                        {apiKeyError && (
                            <p className="api-key-error">
                                There was a problem with your API key. The service may be unavailable or the key may not have the correct permissions. Please try selecting a different key.
                            </p>
                        )}
                        <button onClick={handleSelectApiKey} className="start-button-main">
                            Select API Key
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const showPlayerSelect = game.currentGameState === 'PLAYER_SELECT';
    const showStartButton = !showPlayerSelect && (game.currentGameState === 'IDLE' || game.currentGameState === 'GAME_OVER' || game.currentGameState === 'LOADING');
    const showControls = game.currentGameState === 'BOWLING' || game.currentGameState === 'READY';
    const showSwingInstruction = game.currentGameState === 'BOWLING';


    return (
        <div className="immersive-container">
            <header className="game-header">
                <h1>The Howfen Cricket Game</h1>
            </header>

            {showPlayerSelect && (
                <PlayerSelect
                    onPlayerSelect={handlePlayerSelect}
                    spImage={assets.batsmanImageRef.current}
                    dhImage={assets.dhBatsmanImageRef.current}
                />
            )}

            {showStartButton && (
                 <div className="start-game-overlay">
                    <div className="start-game-content">
                        <StartButton
                            onClick={game.startGame}
                            gameState={game.currentGameState}
                            commentaryStatus={commentary.commentaryStatus}
                            isLoadingAssets={!assets.assetsLoaded.all}
                        />
                        <div className="game-instructions-panel">
                            <h3>Controls</h3>
                            <div className="desktop-controls-instructions">
                                <p>Aim: <span className="key-highlight">&larr;</span> <span className="key-highlight">&uarr;</span> <span className="key-highlight">&rarr;</span></p>
                                <p>Hit: <span className="key-highlight">SPACEBAR</span></p>
                            </div>
                            <div className="mobile-controls-instructions">
                                <p>Aim: D-Pad Buttons</p>
                                <p>Hit: <span className="key-highlight">SWING</span> Button</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="game-message-container">
                <MessageDisplay
                    message={game.message}
                    commentaryStatus={commentary.commentaryStatus}
                />
                {showSwingInstruction && (
                    <div className="swing-instruction">
                        Press <span className="key-highlight">SPACEBAR</span> to Swing
                    </div>
                )}
            </div>

            <GameCanvas
                canvasRef={game.canvasRef}
                ball={game.ball}
                batsman={game.batsman}
                bat={game.bat}
                stumps={game.stumps}
                gameState={game.currentGameState}
                shotDirection={game.shotDirection}
                assetsLoaded={assets.assetsLoaded}
                batImage={assets.batImageRef.current}
                batsmanImage={playerCharacter === 'SP' ? assets.batsmanImageRef.current : assets.dhBatsmanImageRef.current}
                ballImage={assets.ballImageRef.current}
                grassImage={assets.grassImageRef.current}
            />
            
            {showControls && (
                <MobileControls 
                    shotDirection={game.shotDirection}
                    onDirectionChange={game.setShotDirection}
                    onSwing={game.swingBat}
                />
            )}

            <Scoreboard
                score={game.score}
                targetScore={game.targetScore}
                ballsBowled={game.ballsBowled}
                totalBalls={game.totalBalls}
                wickets={game.wickets}
                maxWickets={game.maxWickets}
            />

            <ImpactMessage text={game.impactEffectText} visible={game.showImpactEffect} />
        </div>
    );
}

export default CricketGame;