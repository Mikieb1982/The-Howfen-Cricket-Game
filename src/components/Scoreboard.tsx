/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';

interface ScoreboardProps {
    score: number;
    targetScore: number;
    ballsBowled: number;
    totalBalls: number;
    wickets: number;
    maxWickets: number;
}

const Scoreboard: React.FC<ScoreboardProps> = ({
    score,
    targetScore,
    ballsBowled,
    totalBalls,
    wickets,
    maxWickets
}) => {
    const runsToWin = Math.max(0, targetScore - score);
    const ballsLeft = totalBalls - ballsBowled;

    return (
        <div className="scoreboard">
            <div className="score-item">
                <span className="score-label">Score</span>
                <span className="score-value">{score}/{wickets}</span>
            </div>
             <div className="score-item">
                <span className="score-label">Target</span>
                <span className="score-value">{targetScore > 0 ? targetScore : '--'}</span>
            </div>
            <div className="score-item">
                <span className="score-label">Balls Left</span>
                <span className="score-value">{ballsLeft}</span>
            </div>
             <div className="score-item">
                <span className="score-label">To Win</span>
                <span className="score-value">{targetScore > 0 ? runsToWin : '--'}</span>
            </div>
        </div>
    );
};

export default Scoreboard;