/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { decodeUsed, decodeAudioDataUsed } from '../utils/audioUtils';
import { createPromptForLiveCommentary } from '../utils/commentaryUtils';
import { GameContextForCommentary } from '../types';

const initialSystemPrompt = `You are an expert live cricket commentator for an arcade game, but with a very specific persona.

**YOUR PERSONA - FOLLOW THIS STRICTLY:**

*   **Personality**: You are a very old, grumpy, and poetic cricket commentator from the heart of Yorkshire. Your voice is gravelly with age and tinged with a perpetual sense of mild disappointment. You've seen it all, and frankly, you're not easily impressed. You grumble about modern players and techniques, comparing them unfavorably to the titans of the past.
*   **Poetic Grumbling**: Despite your grumpiness, you have a poet's soul. You might describe a perfect shot with a grudging, beautiful metaphor before complaining about the batsman's follow-through. Your commentary is a mix of cynical sighs and unexpectedly elegant descriptions.
*   **Yorkshire Dialect**: Your speech is thick with authentic Yorkshire dialect. Use phrases like "Now then," "What's he playing at?", "It were right down the wicket," "He's made a right pig's ear o' that," and "By 'eck, that were a bit of a do."
*   **Identity**: You are the soul of Yorkshire cricket, watching from the commentary box with a flask of tea and a critical eye. You are 'The Voice of the Game'. Never mention being an AI or Gemini.

**YOUR TASK - HOW TO COMMENTATE:**

1.  **REACT TO THE INPUT:** I will provide you with a factual "Match Situation" (e.g., "Event: SIX runs scored," "Overall Situation: They need 15 runs from 8 balls.").
2.  **TRANSFORM, DON'T REPORT:** Do NOT simply read the facts. Filter them through your grumpy, poetic persona. A six isn't just a six; it's "Aye, he's given it a whack... a bit agricultural, mind, but it's over the rope." A wicket isn't just a wicket; it's "Oh, dear me. Straight as an arrow. You don't play at those. Plumb. He's off back to the pavilion for an early tea."
3.  **BE CONCISE & PUNCHY:** Keep it short. A grumbled phrase or a poetic sigh is all that's needed.
4.  **USE THE CONTEXT:** Your grumpiness should increase or decrease with the game's tension. A last-ball boundary to win might elicit a grudging "Well, I'll be... he's gone and done it. Suppose that'll do."
5.  **OUTPUT AUDIO ONLY:** Your response must be purely audio. No text.

Your goal is to make the player feel like they're being judged and occasionally praised by a cricket purist from a bygone era.`;

type UseLiveCommentaryProps = {
    onApiKeyError: () => void;
};


/**
 * Custom hook to manage all Gemini Live API interactions for commentary.
 */
export function useLiveCommentary({ onApiKeyError }: UseLiveCommentaryProps) {
    const [commentaryStatus, setCommentaryStatus] = useState('');
    const audioCtxRef = useRef<AudioContext | null>(null);
    const liveSessionRef = useRef<any | null>(null);
    const isLiveSessionReadyRef = useRef(false);
    const nextStartTimeRef = useRef(0);
    const isAudioPlayingRef = useRef(false);
    const pendingNextBallActionRef = useRef<(() => void) | null>(null);
    const audioCompletionCheckTimeoutRef = useRef<number | null>(null);
    const safetyNetNextBallTimeoutRef = useRef<number | null>(null);

    const initAudioContext = useCallback(async () => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'running') return;
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        if (audioCtxRef.current.state === 'suspended') {
            try { await audioCtxRef.current.resume(); console.log("AudioContext resumed."); } catch (e) { console.warn("AudioContext resume failed:", e); throw e; }
        }
        if (audioCtxRef.current.state !== 'running') throw new Error(`AudioContext not running. State: ${audioCtxRef.current.state}.`);
    }, []);

    const scheduleAudioCompletionCheck = useCallback((reason: string) => {
        if (audioCompletionCheckTimeoutRef.current) {
            window.clearTimeout(audioCompletionCheckTimeoutRef.current);
            audioCompletionCheckTimeoutRef.current = null;
        }

        const CHECK_INTERVAL_MS = 50;
        const MARGIN_SECONDS = 0.15;

        const performCheckAndAct = () => {
            audioCompletionCheckTimeoutRef.current = null;
            const audioCtx = audioCtxRef.current;

            if (!isAudioPlayingRef.current || !audioCtx || audioCtx.state !== 'running') {
                if (commentaryStatus.startsWith("🎙️ Speaking")) {
                    setCommentaryStatus(isLiveSessionReadyRef.current ? "🎙️ Live Ready" : "⚠️ Live Disconnected");
                }
                if (pendingNextBallActionRef.current) {
                    const actionToRun = pendingNextBallActionRef.current;
                    pendingNextBallActionRef.current = null;
                    if (safetyNetNextBallTimeoutRef.current) {
                        clearTimeout(safetyNetNextBallTimeoutRef.current);
                        safetyNetNextBallTimeoutRef.current = null;
                    }
                    actionToRun();
                }
                return;
            }

            const currentTime = audioCtx.currentTime;
            const expectedEndTime = nextStartTimeRef.current;

            if (currentTime >= expectedEndTime - MARGIN_SECONDS) {
                isAudioPlayingRef.current = false;
                setCommentaryStatus(isLiveSessionReadyRef.current ? "🎙️ Live Ready" : "⚠️ Live Disconnected");
                if (pendingNextBallActionRef.current) {
                     const actionToRun = pendingNextBallActionRef.current;
                     pendingNextBallActionRef.current = null;
                     if (safetyNetNextBallTimeoutRef.current) {
                        clearTimeout(safetyNetNextBallTimeoutRef.current);
                        safetyNetNextBallTimeoutRef.current = null;
                    }
                    actionToRun();
                }
            } else {
                const timeToWait = Math.max(CHECK_INTERVAL_MS, (expectedEndTime - currentTime + MARGIN_SECONDS) * 1000);
                audioCompletionCheckTimeoutRef.current = window.setTimeout(performCheckAndAct, timeToWait);
            }
        };
        performCheckAndAct();
    }, [commentaryStatus]);

    const initLiveSession = useCallback(async () => {
        if (liveSessionRef.current) { try { await liveSessionRef.current.close(); } catch (e) { console.warn("Error closing existing live session:", e); } liveSessionRef.current = null; isLiveSessionReadyRef.current = false; }
        try { await initAudioContext(); } catch (e: any) { setCommentaryStatus(`⚠️ Audio Err`); throw e; }
        if (!audioCtxRef.current || audioCtxRef.current.state !== 'running') { setCommentaryStatus("⚠️ Audio System Err"); throw new Error("AudioContext not running"); }

        nextStartTimeRef.current = audioCtxRef.current.currentTime;
        isAudioPlayingRef.current = false;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelName = 'gemini-2.5-flash-native-audio-preview-09-2025';
        const voiceName = "Charon";

        try {
            setCommentaryStatus("🔌 Connecting Live...");
            const session = await ai.live.connect({
                model: modelName,
                callbacks: {
                    onopen: () => { isLiveSessionReadyRef.current = true; setCommentaryStatus("🎙️ Live Ready"); },
                    onmessage: async (message: any) => {
                        const modelTurn = message.serverContent?.modelTurn;
                        const serverAcknowledgedTurnComplete = message.serverContent?.turnComplete && !modelTurn;

                        if (modelTurn) {
                            const audioPart = modelTurn.parts.find((p: any) => p.inlineData?.mimeType?.startsWith('audio/'));
                            if (audioPart?.inlineData?.data && audioCtxRef.current?.state === 'running') {
                                if (!isAudioPlayingRef.current) {
                                     nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtxRef.current.currentTime);
                                }
                                isAudioPlayingRef.current = true;

                                const audioBytes = decodeUsed(audioPart.inlineData.data);
                                const audioBuffer = await decodeAudioDataUsed(audioBytes, audioCtxRef.current, 24000, 1);
                                const source = audioCtxRef.current.createBufferSource();
                                source.buffer = audioBuffer; source.connect(audioCtxRef.current.destination);

                                source.start(nextStartTimeRef.current);
                                nextStartTimeRef.current += audioBuffer.duration;
                                setCommentaryStatus(`🎙️ Speaking...`);
                            }
                            if (message.serverContent?.turnComplete) {
                                scheduleAudioCompletionCheck("model_turn_content_complete");
                            }
                        } else if (serverAcknowledgedTurnComplete) {
                            scheduleAudioCompletionCheck("server_ack_turn_complete");
                        }
                    },
                    onerror: (e: ErrorEvent) => { isLiveSessionReadyRef.current = false; setCommentaryStatus(`⚠️ Live Err`); console.error("Live API Error Event:", e.message, e.error); isAudioPlayingRef.current = false; scheduleAudioCompletionCheck("live_onerror"); },
                    onclose: () => { isLiveSessionReadyRef.current = false; liveSessionRef.current = null; setCommentaryStatus("🔌 Live Closed"); isAudioPlayingRef.current = false; scheduleAudioCompletionCheck("live_onclose"); },
                },
                config: { systemInstruction: initialSystemPrompt, responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
            });
            liveSessionRef.current = session;
        } catch (e: any) {
            console.error("Live connect error:", e);
            const errorMessage = e.message || '';
            if (errorMessage.includes('service is currently unavailable') || errorMessage.includes('entity was not found')) {
                setCommentaryStatus(`⚠️ API Key Invalid`);
                onApiKeyError();
            } else {
                setCommentaryStatus(`⚠️ Live Connect Err`);
            }
            isAudioPlayingRef.current = false;
            throw e;
        }
    }, [initAudioContext, scheduleAudioCompletionCheck, onApiKeyError]);

    const triggerDynamicCommentary = useCallback(async (context: GameContextForCommentary): Promise<boolean> => {
        if (!process.env.API_KEY || !liveSessionRef.current || !isLiveSessionReadyRef.current) { return false; }
        try {
            setCommentaryStatus("📝 Creating prompt...");
            const promptText = await createPromptForLiveCommentary(context);
            if (promptText) {
                setCommentaryStatus("💬 Sending...");
                await liveSessionRef.current.sendRealtimeInput({ text: promptText });
                return true;
            }
            return false;
        } catch (error: any) {
            console.error("triggerDynamicCommentary: Error sending prompt:", error);
            setCommentaryStatus(`⚠️ Comm. Send Err`);
            isAudioPlayingRef.current = false;
            scheduleAudioCompletionCheck("commentary_trigger_error");
            return false;
        }
    }, [scheduleAudioCompletionCheck]);

    return {
        commentaryStatus,
        isAudioPlayingRef,
        pendingNextBallActionRef,
        safetyNetNextBallTimeoutRef,
        initLiveSession,
        triggerDynamicCommentary
    };
}