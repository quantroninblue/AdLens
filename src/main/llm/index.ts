import { llmProviders, type LLMProvider, type LLMStatus, type Settings } from '../../shared/schema';
import { AnthropicClient, OpenAIClient, anthropicModels, openaiModels } from './api';
import { ClaudeCodeClient, CodexClient, claudeModels, claudeStatus, codexStatus, findExecutable } from './cli';
import type { ProviderKeys } from './keys';
import { OllamaClient, ollamaModels, ollamaVision } from './ollama';
import type { LLMClient } from './types';

export type { LLMClient, LLMImage, LLMRequest } from './types';
export { ProviderKeys, type KeyCipher } from './keys';

export async function llmStatus(settings: Settings, keys: ProviderKeys, only?: LLMProvider): Promise<LLMStatus[]> {
  const keyed = async (provider: 'openai' | 'anthropic', list: (key: string) => Promise<{id: string; name: string}[]>): Promise<LLMStatus> => {
    const stored = keys.get(provider);
    if (!stored) return {provider, available: false, detail: 'No API key saved.', models: []};
    try {return {provider, available: true, detail: 'API key accepted', models: await list(stored.key), keyStored: stored.storage};}
    catch (error) {return {provider, available: false, detail: (error as Error).message, models: [], keyStored: stored.storage};}
  };
  const checks: Record<LLMProvider, () => Promise<LLMStatus>> = {
    ollama: () => ollamaModels(settings.llm.ollamaUrl).then(
      models => ({provider: 'ollama' as const, available: models.length > 0, detail: models.length ? `${models.length} local model${models.length > 1 ? 's' : ''}` : 'Ollama is running but has no models. Pull one with `ollama pull`.', models}),
      () => ({provider: 'ollama' as const, available: false, detail: `Ollama not reachable at ${settings.llm.ollamaUrl}. Start it with \`ollama serve\`.`, models: []})),
    codex: async () => ({provider: 'codex' as const, ...await codexStatus(await findExecutable('codex')), models: [{id: '', name: 'Codex default model'}]}),
    'claude-code': async () => {const {version: _, ...s} = await claudeStatus(await findExecutable('claude')); return {provider: 'claude-code' as const, ...s, models: claudeModels};},
    openai: () => keyed('openai', openaiModels),
    anthropic: () => keyed('anthropic', anthropicModels),
  };
  return Promise.all((only ? [only] : llmProviders).map(provider => checks[provider]()));
}

export async function createClient(settings: Settings, keys: ProviderKeys): Promise<LLMClient | undefined> {
  const {provider, model} = settings.llm;
  switch (provider) {
    case null: return undefined;
    case 'ollama': {
      if (!model) throw new Error('Choose a local model in Connections.');
      return new OllamaClient(settings.llm.ollamaUrl, model, await ollamaVision(settings.llm.ollamaUrl, model));
    }
    case 'codex': {
      const file = await findExecutable('codex');
      if (!file) throw new Error('Codex CLI not found. Install it and run `codex login`.');
      return new CodexClient(file, model);
    }
    case 'claude-code': {
      const file = await findExecutable('claude');
      if (!file) throw new Error('Claude Code not found. Install it and sign in.');
      return new ClaudeCodeClient(file, model, (await claudeStatus(file)).version);
    }
    case 'openai': case 'anthropic': {
      const key = keys.get(provider)?.key;
      if (!key) throw new Error(`Add your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key in Connections.`);
      if (!model) throw new Error('Choose a model in Connections.');
      return provider === 'openai' ? new OpenAIClient(key, model) : new AnthropicClient(key, model);
    }
  }
}
