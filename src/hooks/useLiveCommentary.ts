/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { decodeUsed, decodeAudioDataUsed } from '../utils/audioUtils';
import { createPromptForLiveCommentary } from '../utils/commentaryUtils';
import { GameContextForCommentary } from '../types';

const initialSystemPrompt = `You are a cricket commentator for an arcade game. Adopt the persona of a classic, old-school Yorkshireman: a bit grumpy, cynical, and not easily impressed, but with a dry wit. Your commentary should be short, reactive, and in character. Do not mention being an AI.`;

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