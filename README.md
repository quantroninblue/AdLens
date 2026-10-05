# AdLens

AdLens is a desktop app for reviewing marketing copy, images, and short videos.
The idea is to bring visual observations, speech, copy, and predicted neural
responses into one report, with enough evidence to explain each assessment.

The desktop app works. The model services are still being connected. You can
review copy locally today; image understanding, transcription, and model-based
analysis need remote endpoints. There are no model weights bundled with the app.

## Running it

Use Node.js 22.12 or later:

```bash
npm ci
npm run dev
```

For a built version, run `npm run build`, then `npm start`. `npm run package`
creates an unpacked desktop application in `release/`. Development and desktop
tests have been run on Ubuntu; other platforms haven't been checked yet.

On Linux, window transparency depends on the compositor. The install script also
checks for an existing Chromium sandbox helper. If Electron won't launch because
of a sandbox error, check your system's Electron sandbox setup and rerun
`node scripts/prepare-linux-sandbox.mjs`.

## What's there

- Image and video import, with copy, channel, and audience inputs.
- Reports covering the hook, clarity, audience fit, emotion, visuals, and CTA.
- Evidence, recommendations, provider status, and scoring details in each report.
- Saved analyses, search, deletion, and JSON export.
- Remote provider adapters with streamed reasoning responses and cancellation.
- Local copy checks when a reasoning server isn't available.

Supported uploads are PNG, JPEG, WebP, MP4, MOV, and WebM, up to 100 MB. Images
have a preview; videos currently show file details. Without a media endpoint,
uploading an asset does not analyze its contents.

The local fallback checks sentence length, opening cues, and explicit calls to
action in English. It leaves dimensions it cannot assess blank.

## Connecting models

Set the URLs in **Connections** and provide API keys through environment variables.
The available variables are listed in [.env.example](.env.example). Environment
values override saved settings. A `.env` file is not loaded automatically.

There are three provider interfaces:

| Provider | Job |
| --- | --- |
| Media | Visual observations, video processing, and transcription |
| Reasoning | Interpret the collected evidence and return a structured report |
| TRIBE | Return a predicted neural-response summary and, optionally, a derived proxy score |

Colibrì is the intended inference backend for the reasoning model. The client
currently speaks an OpenAI-compatible chat-completions protocol, so the server
needs to expose that interface. The reasoning model receives the media summary,
copy, audience brief, and any valid TRIBE result.

The media and TRIBE endpoints are our own wrapper contracts, documented in
[docs/providers.md](docs/providers.md). They are not official hosted model APIs.
Neither live Colibrì nor live TRIBE inference has been verified yet.

The deployment plan puts TRIBE and Colibrì on the same VM, with a coordinator
passing results between them. For now, the Electron main process coordinates
those calls. Local video preparation and the server coordinator are still to do.
The [TRIBE source notes](docs/tribe-source-review.md) cover the proposed split.

## Reading the scores

These are prototype assessments, not calibrated predictions of reach or sales.
TRIBE predicts neural responses; an engagement score needs a separate, documented
mapping from those responses. A summary without a score is accepted.

Overall is a weighted average of the available dimensions. Missing dimensions
are left out and the remaining weights are normalized. The default weights are
hook .25, clarity .25, audience .15, emotion .10, visual .10, and CTA .15.

Direct numerical blending of the TRIBE score defaults to zero. Its summary can
still inform the reasoning model. That distinction is recorded in the report;
arithmetic weights don't tell us how much a piece of context influenced the model.
The rules themselves are in [heuristics.ts](src/main/heuristics.ts).

## Working on the code

The app uses Electron, React, TypeScript, and Zod. The main process owns file
access, provider requests, report validation, and storage. The renderer talks to
it through the preload bridge.

```text
src/main/engine.ts       Analysis pipeline and fallback handling
src/main/providers/     Remote adapters and streaming transport
src/main/store.ts        Local reports and settings
src/shared/             Schemas and shared types
src/preload/            Desktop API exposed to the renderer
src/renderer/src/       React interface
```

```bash
npm test
npm run test:smoke
```

The smoke suite builds and drives the sandboxed Electron app with temporary user
data. Provider tests use local HTTP fixtures; they don't test real model quality.
Screenshots and test output are written to `test-results/`.

Reports and settings live in Electron's user-data directory. Reports include copy,
transcripts, and analysis results, but not the original media files. Up to 100
reports are retained. Keys stay in the main process environment.
