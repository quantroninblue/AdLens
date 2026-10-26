import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { BetaMessageParam, BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { outputLimit, type LLMClient, type LLMRequest } from './types';

const clientOptions = (apiKey: string) => ({apiKey, maxRetries: 1, timeout: 15 * 60_000});
const limit = (onDelta: (text: string) => void) => {
  let size = 0;
  return (text: string) => {size += text.length; if (size > outputLimit) throw new Error('Model output exceeded the size limit.'); onDelta(text);};
};
const apiError = (provider: string, error: unknown) => {
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 401 || status === 403) return new Error(`${provider} rejected the API key. Check it in Connections.`);
    if (status === 404) return new Error(`${provider} does not offer that model to this key. Choose another model.`);
    if (status === 429) return new Error(`${provider} rate limit or quota reached. Try again later.`);
    if (status) return new Error(`${provider} returned HTTP ${status}: ${error.message.slice(0, 300)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
};

export async function openaiModels(key: string) {
  const client = new OpenAI(clientOptions(key)), models: {id: string; name: string}[] = [];
  try {
    for await (const model of client.models.list({signal: AbortSignal.timeout(15000)})) {
      if (!/^(gpt-|o[134](?:-|$)|chatgpt-)/.test(model.id) || /image|audio|realtime|transcribe|tts|search|deep-research|instruct/.test(model.id)) continue;
      models.push({id: model.id, name: model.id});
      if (models.length >= 300) break;
    }
  } catch (error) {throw apiError('OpenAI', error);}
  return models.sort((a, b) => b.id.localeCompare(a.id, undefined, {numeric: true}));
}
export class OpenAIClient implements LLMClient {
  readonly vision = true;
  readonly name: string;
  constructor(private key: string, private model: string) {this.name = `${model} (OpenAI API)`;}
  async complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void) {
    const client = new OpenAI(clientOptions(this.key));
    const input: ResponseInputItem[] = request.messages.map((m, i) => i === request.messages.length - 1 && m.role === 'user' && request.images?.length
      ? {role: 'user', content: [{type: 'input_text', text: m.content}, ...request.images.map(image => ({type: 'input_image' as const, detail: 'auto' as const, image_url: `data:${image.mime};base64,${image.data}`}))]}
      : {role: m.role, content: m.content});
    const delta = limit(onDelta);
    const stream = client.responses.stream({model: this.model, instructions: request.system, input, store: false, max_output_tokens: 32000,
      ...(request.json ? {text: {format: {type: 'json_object' as const}}} : {})}, {signal});
    try {
      for await (const event of stream) if (event.type === 'response.output_text.delta') delta(event.delta);
      const response = await stream.finalResponse();
      if (response.status !== 'completed') throw new Error('OpenAI stopped before completing the reply. Try again or choose another model.');
      return response.output_text;
    } catch (error) {stream.abort(); if (signal.aborted) throw error; throw apiError('OpenAI', error);}
  }
}

export async function anthropicModels(key: string) {
  const client = new Anthropic(clientOptions(key)), models: {id: string; name: string}[] = [];
  try {
    for await (const model of client.models.list({limit: 100}, {signal: AbortSignal.timeout(15000)})) {
      models.push({id: model.id, name: model.display_name || model.id});
      if (models.length >= 200) break;
    }
  } catch (error) {throw apiError('Anthropic', error);}
  return models;
}
// Models that accept the server-side refusal fallback.
const fallbackModels = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
export class AnthropicClient implements LLMClient {
  readonly vision = true;
  readonly name: string;
  constructor(private key: string, private model: string) {this.name = `${model} (Anthropic API)`;}
  async complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void) {
    const client = new Anthropic(clientOptions(this.key));
    const messages: BetaMessageParam[] = request.messages.map((m, i) => {
      if (i !== request.messages.length - 1 || m.role !== 'user' || !request.images?.length) return {role: m.role, content: m.content};
      const content: BetaContentBlockParam[] = request.images.flatMap(image => [
        {type: 'text' as const, text: image.label},
        {type: 'image' as const, source: {type: 'base64' as const, media_type: image.mime, data: image.data}},
      ]);
      content.push({type: 'text', text: m.content});
      return {role: 'user', content};
    });
    const delta = limit(onDelta);
    const stream = client.beta.messages.stream({model: this.model, system: request.system, messages, max_tokens: 32000,
      ...(fallbackModels.has(this.model) ? {betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const} : {})}, {signal});
    try {
      for await (const event of stream) if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') delta(event.delta.text);
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing, or choose another model.');
      if (message.stop_reason === 'max_tokens') throw new Error('Claude reached the output limit before finishing.');
      return message.content.map(block => block.type === 'text' ? block.text : '').join('');
    } catch (error) {stream.abort(); if (signal.aborted) throw error; throw apiError('Anthropic', error);}
  }
}
