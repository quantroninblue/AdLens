# Remote provider contracts

These contracts describe what the **AdLens client** consumes. No official hosted
TRIBE API is assumed. This repository contains client adapters, not model servers.
TRIBE and the Colibrì reasoning backend are intended to share one VM; deployment
awaits infrastructure approval. The current desktop engine still calls them
sequentially over HTTPS. A future VM coordinator must own the handoff to remove
the laptop round trip. See [the source inspection](tribe-source-review.md).

All remote URLs require HTTPS (HTTP is accepted for loopback development only).
Base URLs must not include credentials, query strings, or fragments. Requests do
not follow redirects. Each provider uses its own optional Bearer token:

| Settings field | Environment override | Token environment variable |
| --- | --- | --- |
| reasoningUrl | ADLENS_REASONING_URL | ADLENS_REASONING_KEY |
| model | ADLENS_REASONING_MODEL | — |
| mediaUrl | ADLENS_MEDIA_URL | ADLENS_MEDIA_KEY |
| tribeUrl | ADLENS_TRIBE_URL | ADLENS_TRIBE_KEY |

Health checks time out after 5 seconds; processing requests after 180 seconds.
Cancelling stops the client request; a server must separately honor disconnects
to stop GPU work. There are no automatic retries or silent model substitutions.

## ReasoningProvider

Base URL includes the API version, e.g. `https://inference.example/v1`.

- `GET /v1/models` → `{"data":[{"id":"your-model-id"}]}`. The selected model must
  appear before the UI reports ready. Health is not proof of inference success.
- `POST /v1/chat/completions`: `model`, `messages`, `stream: true`,
  `response_format: {"type":"json_object"}`, `temperature: 0.2`, `max_tokens: 5000`.
  Wrap or adapt the server if it does not support these fields.
- SSE `data:` events carry `choices[0].delta.content`. CRLF, split network chunks,
  UTF-8, usage events, and `[DONE]` are handled. A non-streaming compatible
  `choices[0].message.content` JSON response is also accepted.
- Content must be JSON matching `assessmentSchema` in `src/shared/schema.ts`.
  The JSON Schema is supplied in the system prompt, then validated locally.

Shape (values below illustrate the **contract**, not an actual assessment):

```typescript
{
  summary: string;
  metrics: {
    hook: Metric; clarity: Metric; audience: Metric;
    emotion: Metric; visual: Metric; cta: Metric;
  };
  strengths: string[];
  weaknesses: string[];
  recommendations: { title: string; detail: string }[];
}
type Metric = { score: number | null; evidence: string }; // 0–100
```

The reasoning context includes supplied copy, target audience, channel, the
media representation, and a `neural` envelope:

```typescript
type NeuralContext =
  | { status: 'available'; signal: NeuralSignal; fusionWeight: number }
  | { status: 'unavailable' | 'disabled'; reason: string };
```

`NeuralSignal` is the validated wrapper response below, including method,
confidence, model, and modalities. Valid neural context is sent even with zero
direct fusion weight. The prompt requests attribution, contextual interpretation,
and recommendations while keeping dimension scores grounded in content evidence.
It forbids treating a proxy as measured viewer activity or deriving timed scene
claims from an untimed scalar. Prompt instructions are not a scientific guarantee.
Reports record `metadata.neuralContextProvided` for successful model assessments.
Old saved reports default that field to false.

The context does not include raw media, API keys, or a local path.
The engine independently clears visual scores without visual observations and
audience scores without an audience brief. It computes aggregate scores itself.

## MediaProvider

Base URL is the service root, e.g. `https://media.example`.

- `GET /health` → `{"available": true}` only if the required models are ready.
- `POST /v1/representations` uses multipart form data:
  - `file`: original image/video (maximum client upload: 100 MB)
  - `options`: JSON with `max_frames: 12`, `max_dimension: 1280`,
    `transcribe: true`, `preserve_timestamps: true`
- Response:

```typescript
{
  summary: string;               // 1–12,000 characters
  transcript?: string;           // <=30,000 characters, actual transcription only
  observations: { time?: number; description: string }[]; // <=24, seconds
  modalities: ('image' | 'video' | 'audio' | 'text')[];
  models: string[];              // actual model identifiers used
  duration?: number;             // seconds
}
```

The original asset modality must be reported. An empty observation list will
leave visual quality unscored. Servers must not report audio analysis merely
because a video might contain an audio track. Partial media failures should omit
unused modalities. The wrapper owns representative sampling, temporal ordering,
bounded resizing, audio extraction, and the vision/speech provider choices.

Do not send full frame arrays to the reasoning provider. Retain source timestamps
in observations so recommendations can cite the original clip. A future revision
can extend this contract with preview references and per-stage server events.

## EngagementProvider / TRIBE wrapper

Base URL is the service root, e.g. `https://neural.example`.

- `GET /health` → `{"available": true}` only if actual TRIBE inference is ready.
- `POST /v1/neural-response`:
  - with an asset: multipart `file` (original bytes) and `context` (JSON containing
    `copy`, optional/nullable `transcript`, and `transcriptTiming: "unavailable"`);
  - without an asset: JSON `{ "text": "…", "modality": "text" }`.
- Response:

```typescript
{
  source: 'tribe';
  model: string;                 // actual upstream model/checkpoint identifier
  inputModalities: ('text' | 'image' | 'video' | 'audio')[];
  score: number | null;          // 0–100 derived proxy, or null for a response summary
  confidence: number | null;     // 0–1; use null unless meaning is established
  interpretation: string;
  method: string;                // required description/version of the proxy transform
}
```

Only return a signal after successful inference. An unsupported input modality
must be omitted from `inputModalities`, or rejected with an appropriate status.
For example, do not imply a still image was natively handled if the chosen TRIBE
pipeline does not support it. The client rejects claims about modalities that
were not supplied or derivable from the video. The wrapper must verify that a
video really has audio. It may derive text from speech even when no transcript
was supplied by the client. Untimed copy/captions must not be concatenated into a
spoken-word timeline. Generate aligned Word events from the original media, or
consume an explicitly timed manifest once that separate contract is implemented.

Raw predicted cortical activity requires an explicit, reproducible transformation
before returning a 0–100 score. Without an engagement transform, return a genuine
descriptive neural-response summary with `score: null`, `confidence: null`, and a
method describing the summarization. It can inform reasoning without numerical
fusion. Return a non-2xx error if inference itself fails. Record method/version
and input modalities with every response. Do not call it a virality probability.

The signal is displayed independently. Its contribution to engagement defaults
to zero and can be changed under Connections → Scoring weights. If the signal is
unavailable, its weight is removed and the available content dimensions are used.
The valid signal also goes into the reasoning context. A zero direct fusion
weight does not mean the signal had no influence on the model's interpretation.

## Failure and data boundaries

Invalid schemas, non-2xx responses, oversize responses, network failures, and
timeouts result in an explicit failed component. Output text is rendered as React
text, not HTML. JSON responses are limited to 250 KB, SSE streams to 1 MB.

User-uploaded media is untrusted: impose server-side decoding, duration, memory,
and execution limits, authenticate requests, and define retention on the VM.
Client disconnects should cancel server jobs where possible. Model-weight storage
belongs on the inference host's appropriate local storage, not the laptop.
