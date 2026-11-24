// Gemini 3.8 TTS is only available through v1beta. Keep the request shape in one place so the
// server route and its regression test exercise the same single-speaker generateContent payload.
export const GEMINI_TTS_API_VERSION = 'v1beta';

export function geminiTtsRequest(text: string, voice: string, model: string) {
  return {
    model,
    contents: [{
      role: 'user',
      parts: [{ text }],
    }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice } },
    },
  };
}
