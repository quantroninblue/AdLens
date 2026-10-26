import { useEffect, useState } from 'react';
import { Brain, Check, CircleHelp, FolderSearch, KeyRound, LoaderCircle, MessageSquareText, RefreshCw } from 'lucide-react';
import { llmProviderLabels, llmProviders, type LLMProvider, type LLMStatus, type ProviderStatus, type Settings, type TribeCandidate } from '../../shared/schema';
import { errorMessage } from './frames';

const providerNotes: Record<LLMProvider, string> = {
  ollama: 'Runs on this computer. Use a vision model (for example a Llama, Qwen or Gemma vision variant) so it can see the video frames.',
  codex: 'Uses your ChatGPT plan through the official Codex CLI. Sign in once with `codex login`.',
  'claude-code': 'Uses your Claude plan through the official Claude Code CLI. Sign in once by running `claude`.',
  openai: 'Pay-as-you-go OpenAI API key. Stored encrypted with your system keychain.',
  anthropic: 'Pay-as-you-go Anthropic API key. Stored encrypted with your system keychain.',
};

export default function Connections({config, statuses, busy, refresh, onSave, onError}: {config: Settings; statuses: ProviderStatus[]; busy: boolean; refresh: () => Promise<void>; onSave: (settings: Settings) => Promise<void>; onError: (message: string) => void}) {
  const [draft, setDraft] = useState(config), [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<TribeCandidate[]>(), [scanning, setScanning] = useState(false);
  const [llms, setLlms] = useState<LLMStatus[]>(), [checking, setChecking] = useState(false);
  const [key, setKey] = useState(''), [remember, setRemember] = useState(true);
  useEffect(() => setDraft(config), [config]);
  const rescan = async () => {setScanning(true); try {setCandidates(await window.adlens.scanTribe());} catch (e) {onError(errorMessage(e));} finally {setScanning(false);}};
  const checkModels = async () => {setChecking(true); try {setLlms(await window.adlens.llmStatus());} catch (e) {onError(errorMessage(e));} finally {setChecking(false);}};
  useEffect(() => {void rescan(); void checkModels();}, []);
  const tribe = statuses.find(s => s.id === 'tribe');
  const setTribe = (patch: Partial<Settings['tribe']>) => setDraft({...draft, tribe: {...draft.tribe, ...patch}});
  const setLLM = (patch: Partial<Settings['llm']>) => setDraft({...draft, llm: {...draft.llm, ...patch}});
  const choose = async () => {
    try {
      const found = await window.adlens.chooseTribePython();
      if (found) {setCandidates(list => [found, ...(list ?? []).filter(c => c.python !== found.python)]); setTribe({python: found.python});}
    } catch (e) {onError(errorMessage(e));}
  };
  const provider = draft.llm.provider, selected = llms?.find(l => l.provider === provider);
  const saveKey = async () => {
    if (provider !== 'openai' && provider !== 'anthropic') return;
    try {await window.adlens.setApiKey(provider, key, remember); setKey(''); await checkModels();} catch (e) {onError(errorMessage(e));}
  };
  const pickProvider = (next: LLMProvider) => {setKey(''); const models = llms?.find(l => l.provider === next)?.models ?? []; setLLM({provider: next, model: models.some(m => m.id === draft.llm.model) ? draft.llm.model : models[0]?.id ?? ''});};
  return <div className="page-content settings-page">
    <div className="page-heading"><div><div className="eyebrow">WORKSPACE SETTINGS</div><h1>Connections<span className="heading-dot">.</span></h1><p>TRIBE v2 runs from its own Python environment on this computer. The language model can be local or your own account.</p></div>
      <button className="secondary-button" disabled={checking} onClick={() => {void checkModels(); void refresh();}}><RefreshCw size={14} className={checking ? 'spin' : ''}/> Check status</button></div>
    <form onSubmit={async e => {e.preventDefault(); setSaving(true); try {await onSave(draft);} finally {setSaving(false);}}}>
      <section className="card connection-card wide"><div className="connection-icon"><Brain size={22}/></div><div className="connection-body">
        <div className="connection-heading"><div className="eyebrow">NEURAL RESPONSE</div><span className={`connection-badge ${tribe?.state ?? ''}`}><span className="status-dot"/>{tribe?.state === 'available' ? 'Found' : tribe?.state === 'unavailable' ? 'Unavailable' : 'Not found'}</span></div>
        <h2>TRIBE v2 · local</h2><p>AdLens looks for a Python environment where <code>tribev2</code> is installed (conda, venv, pyenv or a project’s <code>.venv</code>) and runs a small bridge script with it. Nothing is installed or downloaded by AdLens; TRIBE fetches its own weights on first use.</p>
        <label className="check-row"><input type="checkbox" checked={draft.tribe.enabled} disabled={busy} onChange={e => setTribe({enabled: e.target.checked})}/> Use TRIBE in analyses</label>
        <div className="field-title"><label>Python environment</label><span>{scanning ? 'Scanning…' : `${candidates?.length ?? 0} found`}</span></div>
        <div className="choice-list" role="radiogroup" aria-label="TRIBE Python environment">
          <label className={`choice ${!draft.tribe.python ? 'selected' : ''}`}><input type="radio" name="tribe-python" checked={!draft.tribe.python} disabled={busy} onChange={() => setTribe({python: ''})}/><div><strong>Automatic</strong><small>{candidates?.[0] ? `Currently ${candidates[0].label}` : 'Uses the first environment found'}</small></div></label>
          {candidates?.map(c => <label key={c.python} className={`choice ${draft.tribe.python === c.python ? 'selected' : ''}`}><input type="radio" name="tribe-python" checked={draft.tribe.python === c.python} disabled={busy} onChange={() => setTribe({python: c.python})}/><div><strong>{c.label}{c.version ? ` · tribev2 ${c.version}` : ''}</strong><small>{c.python}{c.checkpointCached === false ? ' · weights not downloaded yet' : c.checkpointCached ? ' · weights cached' : ''}</small></div></label>)}
          {draft.tribe.python && !candidates?.some(c => c.python === draft.tribe.python) && <label className="choice selected"><input type="radio" name="tribe-python" checked readOnly/><div><strong>Saved environment</strong><small>{draft.tribe.python}</small></div></label>}
        </div>
        <div className="button-row"><button type="button" className="secondary-button" disabled={scanning || busy} onClick={() => void rescan()}>{scanning ? <LoaderCircle size={13} className="spin"/> : <RefreshCw size={13}/>} Scan again</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void choose()}><FolderSearch size={13}/> Choose folder…</button></div>
        <div className="two-fields"><div><label htmlFor="checkpoint">Checkpoint</label><input id="checkpoint" value={draft.tribe.checkpoint} disabled={busy} onChange={e => setTribe({checkpoint: e.target.value})} placeholder="facebook/tribev2 or a local folder"/></div>
          <div><label htmlFor="device">Device</label><select id="device" value={draft.tribe.device} disabled={busy} onChange={e => setTribe({device: e.target.value as Settings['tribe']['device']})}><option value="auto">Automatic (GPU if available)</option><option value="cuda">GPU (CUDA)</option><option value="cpu">CPU</option></select></div></div>
        <small>{tribe?.detail ?? 'Not checked yet'}</small>
      </div></section>
      <section className="card connection-card wide"><div className="connection-icon"><MessageSquareText size={22}/></div><div className="connection-body">
        <div className="connection-heading"><div className="eyebrow">LANGUAGE MODEL</div><span className={`connection-badge ${selected?.available ? 'available' : provider ? 'unavailable' : ''}`}><span className="status-dot"/>{selected?.available ? 'Available' : provider ? 'Unavailable' : 'Not connected'}</span></div>
        <h2>Reads TRIBE’s output and writes the report</h2><p>It also powers the chat. The model receives the copy, sampled frames, transcript and TRIBE summary, with instructions on how to interpret them.</p>
        <div className="choice-list provider-grid" role="radiogroup" aria-label="Language model provider">{llmProviders.map(p => {const status = llms?.find(l => l.provider === p); return <label key={p} className={`choice ${provider === p ? 'selected' : ''}`}><input type="radio" name="llm-provider" checked={provider === p} disabled={busy} onChange={() => pickProvider(p)}/><div><strong>{llmProviderLabels[p]} <span className={`status-dot ${status?.available ? 'online' : ''}`}/></strong><small>{status ? status.detail : 'Checking…'}</small></div></label>;})}</div>
        {provider && <p className="provider-note">{providerNotes[provider]}</p>}
        {provider === 'ollama' && <><label htmlFor="ollama-url">Ollama URL</label><input id="ollama-url" type="url" value={draft.llm.ollamaUrl} disabled={busy} onChange={e => setLLM({ollamaUrl: e.target.value})}/></>}
        {(provider === 'openai' || provider === 'anthropic') && <div className="key-row"><label htmlFor="api-key"><KeyRound size={12}/> API key {selected?.keyStored ? <span>Saved ({selected.keyStored})</span> : null}</label>
          <div><input id="api-key" type="password" autoComplete="off" value={key} placeholder={selected?.keyStored ? 'Enter a new key to replace it' : provider === 'openai' ? 'sk-…' : 'sk-ant-…'} onChange={e => setKey(e.target.value)} disabled={busy}/>
            <button type="button" className="secondary-button" disabled={!key.trim() || busy} onClick={() => void saveKey()}>Save key</button>
            {selected?.keyStored && selected.keyStored !== 'environment' && <button type="button" className="secondary-button" disabled={busy} onClick={async () => {try {await window.adlens.removeApiKey(provider); await checkModels();} catch (e) {onError(errorMessage(e));}}}>Remove</button>}</div>
          <label className="check-row"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/> Remember on this computer (encrypted)</label></div>}
        {provider && <><label htmlFor="model-name">Model</label>
          {selected?.models.length ? <select id="model-name" value={draft.llm.model} disabled={busy} onChange={e => setLLM({model: e.target.value})}>{!selected.models.some(m => m.id === draft.llm.model) && <option value={draft.llm.model}>{draft.llm.model || 'Choose a model'}</option>}{selected.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            : <input id="model-name" value={draft.llm.model} disabled={busy} onChange={e => setLLM({model: e.target.value})} placeholder="Model identifier"/>}
          {provider === 'codex' && <><label htmlFor="codex-model">Codex model override <span>Optional</span></label><input id="codex-model" value={draft.llm.model} disabled={busy} onChange={e => setLLM({model: e.target.value.trim()})} placeholder="Leave empty for Codex’s default"/></>}</>}
        <small>{selected ? selected.account ?? selected.detail : provider ? 'Checking…' : 'Choose a provider'}</small>
      </div></section>
      <div className="settings-info"><CircleHelp size={16}/><p>Content is sent only to the model you choose here. Local models and TRIBE keep it on this computer; the ChatGPT, Claude and API options send it to that provider under your account. API keys can also come from <code>ADLENS_OPENAI_KEY</code> and <code>ADLENS_ANTHROPIC_KEY</code>.</p></div>
      <div className="settings-actions"><span>Changes apply to the next analysis and chat message.</span><button className="primary-button" disabled={saving || busy}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} Save connections</button></div>
    </form>
  </div>;
}
