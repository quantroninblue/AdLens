# AdLens

AdLens is a desktop app for reviewing short videos (Reels, TikToks, Shorts), images and
marketing copy, and estimating how likely they are to spread. It combines two things that run
on your own computer:

- **TRIBE v2** (Meta FAIR), which predicts how an average viewer's brain responds to the video,
  second by second.
- **A language model** of your choice: a local model through Ollama, your ChatGPT or Claude
  account, or an OpenAI/Anthropic API key. It looks at sampled frames, the transcript and
  TRIBE's output and writes a report you can review.

The report gives a virality potential estimate with its reasoning, scores for the hook, pacing,
emotion, visuals, sound, clarity, shareability, call to action and audience fit, a timeline of
the predicted brain response with notable moments, and concrete edits. A chat panel lets you
ask follow-up questions about the report or the draft.

The scores are estimates, not forecasts of views. See **How scoring works** in the app.

## Requirements

- Windows 10/11, macOS or Linux.
- [Node.js](https://nodejs.org/) 22.12 or later (the LTS installer is fine). It includes npm.
- For TRIBE: a Python environment with [TRIBE v2](https://github.com/facebookresearch/tribev2)
  installed (see [Connecting TRIBE v2](#connecting-tribe-v2)). AdLens does not install it.
- For the report and chat: one of the language model options in
  [Connecting a language model](#connecting-a-language-model).

## Install and run

On Windows, open **PowerShell** (or Windows Terminal). On macOS/Linux, open a terminal.

```powershell
cd path\to\Adlens
npm ci
npm run dev
```

`npm ci` installs the exact dependency versions from `package-lock.json`, including Electron.
Use `npm install` instead if you change dependencies. `npm run dev` starts the app with live reload.

To run a production build without the dev server:

```powershell
npm run build
npm start
```

To build an installer for the current platform, run `npm run package`. The output goes to
`release\`: an NSIS installer (`AdLens Setup <version>.exe`) on Windows, a DMG on macOS and an
AppImage on Linux. `npm run package:dir` builds an unpacked app folder instead, which is faster
for a quick check. The installer is not code-signed, so Windows SmartScreen will warn the first
time; choose **More info → Run anyway**.

On Linux, if Electron won't start because of a sandbox error, check your system's Electron
sandbox setup and rerun `node scripts/prepare-linux-sandbox.mjs`.

## Connecting TRIBE v2

TRIBE runs from its own Python environment (3.11 or later). Install it the way its repository
describes, for example:

```powershell
git clone https://github.com/facebookresearch/tribev2
cd tribev2
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -e ".[plotting]"    # "plotting" adds nilearn, used for the brain-region summary
```

TRIBE downloads its checkpoint and feature models from Hugging Face on first use. Its text model
(Llama 3.2) is gated: accept Meta's licence on the model page and log in with
`huggingface-cli login` in the same environment. A CUDA GPU is strongly recommended; on CPU an
analysis can take a long time.

Check the installation in that environment before using AdLens:

```powershell
python -c "from tribev2 import TribeModel; print('ok')"
```

### Finding and connecting TRIBE in the app

AdLens searches for TRIBE by itself every time the Connections page opens. It looks in:

- conda, Miniconda, Miniforge and Mambaforge environments (including `%LOCALAPPDATA%` and
  `%ProgramData%` installs on Windows, and anything listed in `~/.conda/environments.txt`)
- pyenv versions and `virtualenvs`, `venvs` and `envs` folders in your home folder
- `.venv`, `venv` and `env` folders in your home, Desktop, Documents and project folders such as
  `projects`, `code`, `src`, `repos` or `dev`, one level deep (so `Desktop\tribev2\.venv` is found)
- Python installs registered with the Windows `py` launcher, and `python` on PATH

Each interpreter it finds is checked for an importable `tribev2` package. Only the ones that have
it are listed. The check doesn't load TRIBE, so it's quick.

To connect:

1. Click **Connections** in the left sidebar.
2. In the **TRIBE v2 · local** card, look at **Python environment**. The count on the right shows
   how many environments with `tribev2` were found. Each entry shows its name, the `tribev2`
   version, the interpreter path, and whether the weights are already downloaded.
3. Choose one:
   - **Automatic** uses the first environment found. This is fine if there is only one.
   - Click a listed environment to pin that one.
   - If yours isn't listed, click **Choose folder…** and select the environment folder (the one
     containing `Scripts\python.exe` on Windows or `bin/python` elsewhere), or the TRIBE project
     folder that contains `.venv`. AdLens checks it and adds it to the list. It tells you if
     `tribev2` isn't installed there.
   - Click **Scan again** after installing TRIBE somewhere new.
4. Leave **Checkpoint** as `facebook/tribev2`, or enter a local folder containing `config.yaml`
   and `best.ckpt`. Set **Device** to *Automatic* (GPU when available), *GPU (CUDA)* or *CPU*.
5. Make sure **Use TRIBE in analyses** is ticked and click **Save connections**.
6. The badge in the card turns to **Found**, and the line under the card shows the environment in
   use. The sidebar shows **TRIBE v2 found**. On the New analysis page, the
   **Analysis components** card shows TRIBE v2 as **Ready** once a video or audio file is added.

You can also skip the search by setting `ADLENS_TRIBE_PYTHON` to the interpreter path before
starting the app, for example `C:\Users\you\tribev2\.venv\Scripts\python.exe`.

TRIBE runs on the first video in an analysis, or on an audio file if there is no video. The first
analysis loads the model, which can take a while; it then stays loaded between analyses and is
stopped after 15 idle minutes or when you change TRIBE settings. TRIBE's cache of extracted
features lives in AdLens's profile folder (`%APPDATA%\AdLens\tribe-cache` on Windows). If TRIBE
fails during an analysis, the report shows the error under **Evidence & sources** and the
analysis continues without it.

## Connecting a language model

Choose one in **Connections**:

| Option | Setup |
| --- | --- |
| Local model (Ollama) | Install [Ollama](https://ollama.com/), then pull a vision-capable model, for example `ollama pull qwen2.5vl:7b` or `ollama pull gemma3`. Models without vision still work, but they can't see the frames, so visuals are not scored. |
| ChatGPT account | Install the Codex CLI (`npm install -g @openai/codex`) and sign in once with `codex login`. AdLens runs it in a read-only sandbox in an empty temporary folder, with your Codex config, rules and browser tools turned off. |
| Claude account | Install [Claude Code](https://code.claude.com/docs) and sign in once by running `claude`. AdLens runs it with every tool, MCP server, hook and settings file disabled. |
| OpenAI API key | Paste the key in Connections, or set `ADLENS_OPENAI_KEY`. |
| Anthropic API key | Paste the key in Connections, or set `ADLENS_ANTHROPIC_KEY`. |

### Finding and connecting a model in the app

When the Connections page opens, AdLens checks every option and shows the result under each
one. For Ollama, it lists the models installed in Ollama; for the account options, it checks
that the CLI is installed and signed in; for API keys, it checks the key and lists the models
the key can use.

To connect a local model with Ollama:

1. Install Ollama. On Windows and macOS it runs in the background after installation; on Linux,
   start it with `ollama serve` if it isn't running as a service.
2. Download a model in a terminal, for example `ollama pull qwen2.5vl:7b`. Pick a model that
   fits your memory; vision models let AdLens show it the video frames.
3. In AdLens, open **Connections** and, in the **Language model** card, select
   **Local model (Ollama)**. Its line should read, for example, "2 local models". If it says
   Ollama is not reachable, start Ollama and click **Check status** at the top of the page.
4. Choose the model in the **Model** list. The list shows every model Ollama has installed;
   after pulling a new one, click **Check status** to refresh it.
5. Leave **Ollama URL** as `http://127.0.0.1:11434` unless Ollama runs on another port. Only
   `localhost` addresses or HTTPS are accepted.
6. Click **Save connections**. The badge turns to **Available** and the sidebar shows
   **Model connected**.

AdLens asks Ollama whether the chosen model supports images. If it doesn't, frames are not sent
and the report leaves the visual score blank.

To use an account or API key instead, select **ChatGPT account (Codex CLI)**,
**Claude account (Claude Code)**, **OpenAI API key** or **Anthropic API key**:

- For the two account options, the line under the option says whether the CLI was found and is
  signed in. If it isn't, sign in from a terminal (`codex login`, or run `claude`) and click
  **Check status**. **Model** can stay on the CLI's default; for Codex you can type a model name
  in **Codex model override**.
- For API keys, paste the key into **API key**, keep **Remember on this computer (encrypted)**
  ticked if you want it saved, and click **Save key**. The **Model** list then fills with the
  models your key can use. **Remove** deletes a saved key.

Then click **Save connections**. The chat panel on the right shows the connected model, and the
same model is used for analyses and chat.

Saved keys are encrypted with the operating system's credential store (DPAPI on Windows,
Keychain on macOS, libsecret on Linux) and never reach the app's interface. If secure storage
isn't available, a key can be used for the current session only.

Content only leaves your computer if you pick the ChatGPT, Claude or API options. It then goes
to that provider under your account.

## Using it

1. Drop files on the workspace or click **browse files**: MP4, MOV, WebM or MKV videos, JPG,
   PNG or WebP images, MP3/WAV/OGG/FLAC audio, and TXT/MD files. Text files are added to the copy.
2. Add or edit the caption and on-screen text, choose the platform and, optionally, describe the
   audience.
3. Click **Analyze virality**. AdLens samples frames from each video, runs TRIBE, sends
   everything to the model and saves the report.
4. Read the **Assessment**, **Brain response** and **Evidence & sources** tabs, ask follow-up
   questions in the chat, and export the report as JSON if you need it elsewhere.

If TRIBE or the model is missing or fails, the report says so and uses what is available.
Without a model, only basic English copy checks run.

## Environment variables

All optional. Set them in the shell before `npm run dev` or `npm start`; a `.env` file is not
loaded. In PowerShell: `$env:ADLENS_TRIBE_PYTHON = "C:\path\to\python.exe"`.

| Variable | Purpose |
| --- | --- |
| `ADLENS_TRIBE_PYTHON` | Interpreter of the TRIBE environment, overriding the setting |
| `ADLENS_OPENAI_KEY`, `ADLENS_ANTHROPIC_KEY` | API keys, overriding saved keys |
| `ADLENS_USER_DATA` | Separate profile folder for settings, reports and chats |

## Development

```powershell
npm test              # unit tests: engine, storage, keys, model connectors, TRIBE bridge
npm run typecheck
npm run test:smoke    # builds the app and drives it with Playwright
```

The TRIBE bridge tests and the full-pipeline desktop test run the real bridge against a small
stand-in `tribev2` package in `tests/fixtures`, so they need Python with numpy but not TRIBE.
They are skipped when that isn't available. The Codex and Claude Code connector tests use
stand-in executables and are skipped on Windows.

Project layout:

| Path | Contents |
| --- | --- |
| `src/main/` | Electron main process: IPC, analysis pipeline, storage |
| `src/main/tribe.ts`, `resources/tribe_bridge.py` | TRIBE discovery, worker process and the Python bridge |
| `src/main/llm/` | Ollama, Codex CLI, Claude Code CLI, OpenAI and Anthropic connectors |
| `src/main/prompts.ts` | Instructions given to the model, including how to read TRIBE output |
| `src/renderer/` | React interface |
| `src/shared/` | Schemas shared by both sides |
| `docs/tribe-source-review.md` | Notes from reading the TRIBE v2 source |

## Licence note

TRIBE v2 and its `neuralset` dependency are released under CC BY-NC 4.0, which allows
non-commercial use only. Check that this fits how you use AdLens.
