export interface VoicePromptOptions {
  rate?: number;
  volume?: number;
  priority?: boolean;
}

let lastPromptKey = '';
let lastPromptAt = 0;

export function speakNavigationPrompt(text: string, key: string, options: VoicePromptOptions = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const now = Date.now();
  if (key === lastPromptKey && now - lastPromptAt < 5000) return;
  lastPromptKey = key;
  lastPromptAt = now;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? 1.03;
  utterance.pitch = 1;
  utterance.volume = options.volume ?? 0.95;
  if (options.priority) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
