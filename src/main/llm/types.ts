export type LLMImage = {mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; label: string};
export type LLMMessage = {role: 'user' | 'assistant'; content: string};
// Images attach to the final user message.
export type LLMRequest = {system: string; messages: LLMMessage[]; images?: LLMImage[]; json?: boolean};
export interface LLMClient {
  readonly name: string;
  readonly vision: boolean;
  complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void): Promise<string>;
}
export const outputLimit = 512_000;

// CLI providers take a single prompt, so earlier turns are flattened into it.
export function flatten(request: LLMRequest, includeSystem = true) {
  const turns = request.messages.map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${m.content}`).join('\n\n');
  const images = request.images?.length ? `\n\nAttached images, in order: ${request.images.map(i => i.label).join('; ')}.` : '';
  return `${includeSystem ? `INSTRUCTIONS:\n${request.system}\n\n` : ''}CONVERSATION (respond as the assistant to the last USER turn):\n\n${turns}${images}`;
}
