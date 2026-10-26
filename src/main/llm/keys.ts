import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type KeyProvider = 'openai' | 'anthropic';
export interface KeyCipher { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
const envNames: Record<KeyProvider, string> = {openai: 'ADLENS_OPENAI_KEY', anthropic: 'ADLENS_ANTHROPIC_KEY'};

// Keys stay in the main process. Saved keys are encrypted with the OS keychain via safeStorage.
export class ProviderKeys {
  private memory = new Map<KeyProvider, {key: string; storage: 'encrypted' | 'session' | 'environment'}>();
  constructor(private directory: string, private cipher: KeyCipher, private env: NodeJS.ProcessEnv = process.env) {}
  private file(provider: KeyProvider) { return path.join(this.directory, `${provider}.bin`); }
  async load() {
    for (const provider of ['openai', 'anthropic'] as const) {
      const fromEnv = this.env[envNames[provider]]?.trim();
      if (fromEnv) {this.memory.set(provider, {key: fromEnv, storage: 'environment'}); continue;}
      if (!this.cipher.available()) continue;
      try {
        const file = this.file(provider);
        if ((await fs.stat(file)).size > 16384) continue;
        this.memory.set(provider, {key: this.cipher.decrypt(await fs.readFile(file)), storage: 'encrypted'});
      } catch { /* Missing key or locked keychain: reconnect from Connections. */ }
    }
  }
  get(provider: KeyProvider) { return this.memory.get(provider); }
  async set(provider: KeyProvider, key: string, remember: boolean) {
    if (typeof key !== 'string' || key.trim().length < 8 || key.length > 4096 || /[\r\n\0\s]/.test(key.trim())) throw new Error('Enter a valid API key.');
    if (remember && !this.cipher.available()) throw new Error('Secure storage is unavailable on this system. Use the key for this session only.');
    if (remember) {
      await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
      const file = this.file(provider), temp = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, this.cipher.encrypt(key.trim()), {mode: 0o600}); await fs.rename(temp, file); }
      finally { await fs.rm(temp, {force: true}); }
    } else await fs.rm(this.file(provider), {force: true});
    this.memory.set(provider, {key: key.trim(), storage: remember ? 'encrypted' : 'session'});
  }
  async remove(provider: KeyProvider) { await fs.rm(this.file(provider), {force: true}); this.memory.delete(provider); }
}
