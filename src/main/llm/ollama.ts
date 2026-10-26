import { boundedText, endpoint, readLines } from './transport';
import { outputLimit, type LLMClient, type LLMRequest } from './types';

export async function ollamaModels(base: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(endpoint(base, 'api/tags'), {signal: AbortSignal.timeout(3000), redirect: 'error'});
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const data = JSON.parse(await boundedText(response)) as {models?: {name?: unknown}[]};
  return (data.models ?? []).map(m => m.name).filter((n): n is string => typeof n === 'string' && n.length <= 200).map(id => ({id, name: id}));
}
export async function ollamaVision(base: string, model: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(endpoint(base, 'api/show'), {method: 'POST', body: JSON.stringify({model}), signal: AbortSignal.timeout(5000), redirect: 'error'});
    if (!response.ok) return false;
    const data = JSON.parse(await boundedText(response, 4_000_000));
    return Array.isArray(data.capabilities) && data.capabilities.includes('vision');
  } catch {return false;}
}

export class OllamaClient implements LLMClient {
  readonly name: string;
  constructor(private base: string, private model: string, readonly vision: boolean, private fetcher: typeof fetch = fetch) {this.name = `${model} (Ollama)`;}
  async complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void) {
    const messages: {role: string; content: string; images?: string[]}[] = [{role: 'system', content: request.system}, ...request.messages.map(m => ({...m}))];
    if (this.vision && request.images?.length) messages[messages.length - 1].images = request.images.map(i => i.data);
    const response = await this.fetcher(endpoint(this.base, 'api/chat'), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)]),
      body: JSON.stringify({model: this.model, messages, stream: true, ...(request.json ? {format: 'json'} : {}), options: {num_ctx: 32768}}),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Check that the model is pulled and running.`);
    let text = '';
    await readLines(response, line => {
      const event = JSON.parse(line);
      if (event.error) throw new Error(`Ollama: ${String(event.error).slice(0, 300)}`);
      const delta = event.message?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        if (text.length > outputLimit) throw new Error('Model output exceeded the size limit.');
        onDelta(delta);
      }
    }, 8_000_000);
    if (!text.trim()) throw new Error('The local model returned an empty reply.');
    return text;
  }
}
