# TRIBE v2 source review

Inspected 5 October 2026 (wrapper re-checked 26 October 2026). This is a source review, not a
measurement of inference latency. No model weights or neuroscience datasets were downloaded
or executed.

Sources inspected:

- [TRIBE source](https://github.com/facebookresearch/tribev2/tree/af58661791a351a448a489042a28f6c37e1c14b7),
  revision `af58661791a351a448a489042a28f6c37e1c14b7`.
- [Released checkpoint config](https://huggingface.co/facebook/tribev2/blob/f894e783020944dcd96e5568550afe2aa9743f9f/config.yaml),
  checkpoint repository revision `f894e783020944dcd96e5568550afe2aa9743f9f`.
- The Python source inside the upstream-pinned
  [neuralset 0.0.2 wheel](https://files.pythonhosted.org/packages/73/96/91557ba7821e01ece45c055c675a65c6c107706dcc4dcfff848050e4d4f1/neuralset-0.0.2-py3-none-any.whl),
  SHA256 `e1ba6e5709b86e8851591f1fd259c88d7b6ca14f960bcd5a69ff03cdeacdb265`.
  Downloaded with `pip download --no-deps`, extracted for reading, not installed.
  Its advertised GitHub source was unavailable during this review.

## Finding: local media preparation is possible

There are three separate stages. “Preprocessing” can mean either inexpensive
media operations or expensive learned feature extraction; these need different
placements.

| Stage | Source behavior | Placement in the earlier remote-VM plan (since dropped) |
| --- | --- | --- |
| Event preparation | Video/audio events, audio extraction, chunks, aligned words and language context | Metadata and media operations may run locally; ASR/alignment stays on VM by default |
| Feature extraction | Video, acoustic and language encoders produce aligned hidden features | VM by default |
| Brain-response inference | Transformer maps feature tensors to predicted cortical responses | VM |

The public `get_events_dataframe()` pipeline extracts audio, builds events and
runs transcription. `predict(events)` accepts an already prepared event table,
so we can bypass that first pipeline with equivalent client-prepared events.
However, `predict()` calls `data.get_loaders()`, which prepares the learned
extractors before running the brain model. Sending a prepared event table does
not remove feature-extractor inference from the VM.
[Inference wrapper](https://github.com/facebookresearch/tribev2/blob/af58661791a351a448a489042a28f6c37e1c14b7/tribev2/demo_utils.py),
[data pipeline](https://github.com/facebookresearch/tribev2/blob/af58661791a351a448a489042a28f6c37e1c14b7/tribev2/main.py).

A VM running only the final brain model is also technically possible: reconstruct
its `SegmentData` inputs from precomputed, correctly aligned feature tensors.
The model consumes modality arrays shaped as batch × layers × feature channels ×
time. This requires a new validated tensor transport and equivalence tests; the
upstream public wrapper is not a ready-made remote tensor API.
[Model implementation](https://github.com/facebookresearch/tribev2/blob/af58661791a351a448a489042a28f6c37e1c14b7/tribev2/model.py).

Putting all learned feature extraction on an arbitrary laptop would undermine
our lightweight-client goal. Optional client preprocessing should therefore cover
file inspection, decoding, audio extraction, and packaging, with a remote fallback.

## Exact temporal input matters

The released configuration uses V-JEPA 2 (`facebook/vjepa2-vitg-fpc64-256`),
Wav2Vec-BERT 2.0, and Llama 3.2 3B as video, audio, and text feature extractors.
Features are aligned at 2 Hz. The video lookback is four seconds. The brain output
frequency is 1 Hz; configured inference segments span 100 output timesteps, and
the transformer is non-causal. Intermediate layer selection/aggregation is part
of the input contract. The report-writing language model cannot simply replace that text
feature encoder without changing the brain model's learned inputs.
[Checkpoint configuration](https://huggingface.co/facebook/tribev2/blob/f894e783020944dcd96e5568550afe2aa9743f9f/config.yaml).

In neuralset 0.0.2, `extractors/video.py` defaults V-JEPA 2 to 64 frames per clip,
constructs trailing windows at feature sample times, and clamps early frame times
to the beginning. It then invokes the model processor and encoder. Audio code
resamples to the extractor's expected rate, mixes channels, and normalizes audio.
This behavior must be reproduced, including timestamps, boundary handling,
processor versions, and event offsets, before moving those operations locally.
[Inspected dependency artifact](https://files.pythonhosted.org/packages/73/96/91557ba7821e01ece45c055c675a65c6c107706dcc4dcfff848050e4d4f1/neuralset-0.0.2-py3-none-any.whl).

Consequences for AdLens:

- The media-summary request's `max_frames: 12` is for semantic marketing analysis.
  It must not become TRIBE's video sampler.
- Preserve motion and synchronized timing. Do not reduce an entire Reel to a few
  independent thumbnails or treat 2 Hz features as two source frames per second.
- Extracted raw frames can be much larger than a compressed clip. Deduplicate
  overlapping samples, compress transport, and measure total upload + preprocessing
  + inference time before assuming a local frame path is faster.
- Independently chopping a video changes the context available to a non-causal
  model. Any streaming/windowing adaptation needs explicit boundary tests and a
  comparison with upstream predictions. Streaming report text is a separate issue.

The included transcription helper calls WhisperX `large-v3` with word alignment;
English is the default. Local ASR is an optional optimization requiring a suitable
model and validation of alignment, not a cheap universal requirement. Supplied
copy and a plain transcript are not aligned Word events.
[Transcription transform](https://github.com/facebookresearch/tribev2/blob/af58661791a351a448a489042a28f6c37e1c14b7/tribev2/eventstransforms.py).

## What the brain result means

The public inference output is a time × cortical-vertex array for an average
subject, on the fsaverage5 surface (approximately 20,000 vertices). Upstream
records a five-second hemodynamic alignment offset. Preserve its time convention
rather than blindly shifting it twice. This is model-predicted fMRI-like activity;
no viewer is being monitored. The five seconds describe physiological alignment,
not a promise about request latency.
[Upstream explanation](https://github.com/facebookresearch/tribev2/tree/af58661791a351a448a489042a28f6c37e1c14b7#quick-start).

Source inspection did not identify a marketing-engagement output head. Activity
magnitude, a regional peak, or a mean over the cortex is not by itself a validated
engagement score. For the deployed wrapper, keep the full array on the VM and
produce bounded summaries with explicit units, regions/atlas, time convention,
checkpoint/config identifiers, and the summarization method. Any engagement
mapping needs its own stated hypothesis and empirical evaluation.

The current client accepts an unscored response summary (`score: null`) so a real
TRIBE result can inform reasoning before a numerical proxy is justified. The
current response schema carries interpretation and method text, not the full
vertex matrix or a structured neural timeline. A richer regional/time-series
contract remains work for the real server integration. The reasoning prompt
forbids deriving scene timings from an untimed scalar or treating predictions as
observed viewer attention.

## How AdLens uses TRIBE now

AdLens no longer plans a remote TRIBE server. TRIBE runs in its own Python environment on the
same computer, and AdLens talks to it through `resources/tribe_bridge.py`:

- AdLens finds interpreters where `tribev2` is importable (the probe uses `importlib.util.find_spec`,
  so it does not import torch) or uses the one chosen in Connections.
- The bridge is started once with that interpreter and kept alive between analyses, so the model
  loads once. It is stopped after 15 idle minutes, when settings change, or when an analysis is
  cancelled.
- For each video or audio file it calls `TribeModel.from_pretrained(checkpoint, cache_folder, device)`,
  `get_events_dataframe(video_path=... | audio_path=...)` and `predict(events)`, exactly as the
  upstream quick start does. TRIBE therefore does its own audio extraction, WhisperX transcription
  and feature extraction; AdLens does not resample or re-time anything it sends.
- The time × vertex prediction stays inside the bridge. It returns a bounded JSON summary: per-step
  RMS response z-scored within the clip, the pattern change between consecutive steps
  (1 − Pearson r), grouped Destrieux regions on fsaverage5 when `nilearn` is installed (left then
  right hemisphere), peaks, dips and pattern shifts, and the word timings from the events table.
- Segment start times come from the segments `predict` returns. The upstream 5-second hemodynamic
  offset is already applied by TRIBE and is not applied again.

The video frames that the language model sees are sampled separately in the app (up to twelve per
video). They are for the model's semantic review and never feed TRIBE.

Still not established: a validated mapping from these summaries to engagement or virality, and
actual inference times on typical laptops. The upstream repository and its dependency declare
CC-BY-NC-4.0, which limits use to non-commercial purposes.
