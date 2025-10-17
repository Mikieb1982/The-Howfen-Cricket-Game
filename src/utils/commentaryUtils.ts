/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { GameContextForCommentary } from '../types';
import { DEFAULT_MAX_WICKETS } from '../constants';

export async function createPromptForLiveCommentary(context: GameContextForCommentary): Promise<string> {
    const {
        event,
        score = 0,
        wickets = 0,
        ballsBowled = 0,
        totalBalls = 12,
        targetScore = 0,
    } = context;

    let eventDescription = "";
    const runsNeeded = Math.max(0, targetScore - score);
    const ballsRemaining = totalBalls - ballsBowled;
    const wicketsRemaining = DEFAULT_MAX_WICKETS - wickets;

    // Build a factual description of the event
    switch (event) {
        case "gameStart":
            eventDescription = `The game is starting. Target: ${targetScore} runs from ${totalBalls} balls.`;
            break;
        case "hitSix":
            eventDescription = "Event: SIX runs scored.";
            break;
        case "hitFour":
            eventDescription = "Event: FOUR runs scored.";
            break;
        case "hitThree":
            eventDescription = "Event: THREE runs scored.";
            break;
        case "hitTwo":
            eventDescription = "Event: TWO runs scored.";
            break;
        case "hitOne":
            eventDescription = "Event: ONE run scored.";
            break;
        case "hitDotContact":
            eventDescription = "Event: Dot ball. Batsman made contact, but no run.";
            break;
        case "wicketBowled":
            eventDescription = "Event: WICKET! The batsman is bowled.";
            break;
        case "missedHit":
            eventDescription = "Event: Dot ball. Batsman swung and missed.";
            break;
        case "dotBallKeeper":
            eventDescription = "Event: Dot ball. Ball went to the keeper, no hit.";
            break;
        case "gameWon":
            eventDescription = "Event: VICTORY! The batting team has won the game.";
            break;
        case "gameOverWickets":
            eventDescription = "Event: GAME OVER. The batting team is all out.";
            break;
        case "gameOverBalls":
            eventDescription = "Event: GAME OVER. The batting team ran out of balls.";
            break;
        default:
            eventDescription = `An interesting moment in the game.`;
            break;
    }

    let overallSituation = "";
    // Add crucial match context for non-terminal events
    if (event !== "gameStart" && event !== "gameWon" && event !== "gameOverWickets" && event !== "gameOverBalls") {
        if (runsNeeded > 0) {
            overallSituation = `Overall Situation: They now need ${runsNeeded} runs from ${ballsRemaining} ball${ballsRemaining !== 1 ? 's' : ''} to win.`;
        } else if (targetScore > 0 && score >= targetScore) {
            overallSituation = "Overall Situation: The target has been reached!";
        }

        if (wicketsRemaining <= 1 && wickets < DEFAULT_MAX_WICKETS) {
            overallSituation += ` This is the last wicket.`;
        }
    }

    // The final prompt for the model
    const finalPrompt = `${eventDescription} ${overallSituation}`.trim();
    
    console.log("Generated prompt for Live API:", finalPrompt);
    return finalPrompt;
}
