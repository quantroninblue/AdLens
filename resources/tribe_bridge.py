"""AdLens bridge to a locally installed TRIBE v2 (facebookresearch/tribev2).

AdLens runs this file with the Python interpreter of the environment where
TRIBE is installed. It never installs anything.

    python tribe_bridge.py probe [checkpoint]   one JSON line describing the environment
    python tribe_bridge.py serve                JSON-lines requests on stdin, events on stdout

Only bounded summaries are returned. The full (time x vertex) prediction stays
in this process.
"""

import json
import math
import os
import sys
import time
import traceback

PROTOCOL = 1
# Anatomical groupings of Destrieux (aparc.a2009s) labels on fsaverage5. They are
# coarse descriptive groupings, not functional localizers.
REGION_GROUPS = [
    ("early_visual", "Early visual cortex", ["S_calcarine", "G_cuneus", "Pole_occipital", "G_occipital_sup", "G_occipital_middle", "S_oc_sup_and_transversal", "S_oc_middle_and_Lunatus"]),
    ("ventral_visual", "Ventral visual / object & face areas", ["G_oc-temp_lat-fusifor", "S_oc-temp_lat", "G_oc-temp_med-Lingual", "S_oc-temp_med_and_Lingual", "G_and_S_occipital_inf"]),
    ("motion_lateral_occipital", "Lateral occipitotemporal (motion, bodies)", ["S_occipital_ant", "G_temporal_inf", "S_temporal_inf"]),
    ("auditory", "Auditory cortex", ["G_temp_sup-G_T_transv", "S_temporal_transverse", "G_temp_sup-Plan_tempo", "Lat_Fis-post"]),
    ("language", "Language network (temporal & inferior frontal)", ["G_temp_sup-Lateral", "S_temporal_sup", "G_front_inf-Opercular", "G_front_inf-Triangul", "G_pariet_inf-Angular", "G_pariet_inf-Supramar"]),
    ("attention", "Dorsal attention (parietal & frontal eye fields)", ["S_intrapariet_and_P_trans", "G_parietal_sup", "S_precentral-sup-part", "G_front_middle"]),
    ("default_mode", "Default mode / self-referential", ["G_precuneus", "G_cingul-Post-dorsal", "G_cingul-Post-ventral", "G_and_S_cingul-Ant", "G_rectus", "G_subcallosal", "G_and_S_transv_frontopol"]),
    ("somatomotor", "Somatomotor cortex", ["G_precentral", "G_postcentral", "S_central", "G_and_S_paracentral"]),
]
HOOK_SECONDS = 3.0
_model = None
_model_key = None


def _protocol_stream():
    # Libraries print to stdout. Keep the real stdout for protocol messages only
    # and send everything else (including C-level writes) to stderr.
    out = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return out


def _send(stream, message):
    stream.write(json.dumps(message, allow_nan=False) + "\n")
    stream.flush()


def _finite(value, default=0.0):
    value = float(value)
    return value if math.isfinite(value) else default


def _checkpoint_cached(checkpoint):
    try:
        if os.path.isdir(checkpoint):
            return os.path.isfile(os.path.join(checkpoint, "config.yaml")) and os.path.isfile(os.path.join(checkpoint, "best.ckpt"))
        from huggingface_hub import try_to_load_from_cache

        found = try_to_load_from_cache(checkpoint, "best.ckpt")
        return isinstance(found, str)
    except Exception:
        return None


def probe(checkpoint):
    import importlib.util

    info = {"protocol": PROTOCOL, "python": sys.executable, "pythonVersion": sys.version.split()[0], "tribev2": False, "version": None, "checkpointCached": None}
    if importlib.util.find_spec("tribev2") is None:
        return info
    info["tribev2"] = True
    try:
        from importlib.metadata import version

        info["version"] = version("tribev2")
    except Exception:
        pass
    info["checkpointCached"] = _checkpoint_cached(checkpoint)
    return info


def _load(checkpoint, device, cache, progress):
    global _model, _model_key
    key = (checkpoint, device, cache)
    if _model is not None and _model_key == key:
        return _model
    _model = None
    progress("Loading TRIBE v2 checkpoint" + ("" if _checkpoint_cached(checkpoint) else " (first run downloads weights)"))
    from tribev2 import TribeModel

    _model = TribeModel.from_pretrained(checkpoint, cache_folder=cache, device=device)
    _model_key = key
    return _model


def _zscore(values):
    import numpy as np

    values = np.asarray(values, dtype=np.float64)
    std = values.std()
    return (values - values.mean()) / std if std > 1e-12 else np.zeros_like(values)


def _local_extrema(z, times, highest, threshold, limit, separation=2.0):
    order = sorted(range(len(z)), key=lambda i: -z[i] if highest else z[i])
    chosen = []
    for i in order:
        if (z[i] < threshold) if highest else (z[i] > -threshold):
            break
        if all(abs(times[i] - times[j]) >= separation for j in chosen):
            chosen.append(i)
        if len(chosen) >= limit:
            break
    return sorted(chosen)


def _regions(preds, warnings):
    import numpy as np

    if preds.shape[1] != 20484:
        warnings.append(f"Prediction has {preds.shape[1]} vertices, not fsaverage5 (20484); regional summary omitted.")
        return None, []
    try:
        from nilearn import datasets

        atlas = datasets.fetch_atlas_surf_destrieux()
    except Exception as error:
        warnings.append(f"Destrieux atlas unavailable ({type(error).__name__}); install nilearn in the TRIBE environment for regional summaries.")
        return None, []
    labels = [label.decode() if isinstance(label, bytes) else str(label) for label in atlas["labels"]]
    # TRIBE concatenates the left then right fsaverage5 hemispheres.
    maps = np.concatenate([np.asarray(atlas["map_left"]), np.asarray(atlas["map_right"])])
    groups = []
    for group_id, label, names in REGION_GROUPS:
        indices = [labels.index(name) for name in names if name in labels]
        mask = np.isin(maps, indices)
        if mask.sum():
            groups.append((group_id, label, mask))
    return "Destrieux 2009 (nilearn, fsaverage5), grouped", groups


def summarize(preds, segments, tr, events, warnings):
    import numpy as np

    preds = np.asarray(preds, dtype=np.float64)
    count = preds.shape[0]
    times = []
    for index, segment in enumerate(segments):
        start = getattr(segment, "start", None)
        try:
            times.append(float(start))
        except (TypeError, ValueError):
            times.append(index * tr)
    times = np.asarray(times, dtype=np.float64)
    order = np.argsort(times, kind="stable")
    preds, times = preds[order], times[order]

    activity = np.sqrt(np.mean(preds ** 2, axis=1))
    activity_z = _zscore(activity)
    change = [None]
    for t in range(1, count):
        a, b = preds[t], preds[t - 1]
        denominator = a.std() * b.std()
        change.append(None if denominator < 1e-12 else _finite(1 - np.mean((a - a.mean()) * (b - b.mean())) / denominator))
    change_values = np.asarray([c for c in change if c is not None] or [0.0])
    change_z = {t: (c - change_values.mean()) / change_values.std() if change_values.std() > 1e-12 else 0.0 for t, c in enumerate(change) if c is not None}

    atlas, groups = _regions(preds, warnings)
    regions, region_z = [], {}
    hook = times < times.min() + HOOK_SECONDS if count else np.zeros(0, dtype=bool)
    for group_id, label, mask in groups:
        course = preds[:, mask].mean(axis=1)
        z = _zscore(course)
        region_z[label] = z
        slope = float(np.polyfit(times, z, 1)[0]) * 10 if count > 2 and np.ptp(times) > 0 else 0.0
        peak = int(np.argmax(z))
        regions.append({"id": group_id, "label": label, "vertices": int(mask.sum()), "mean": _finite(course.mean()),
                        "peakTime": _finite(times[peak]), "peakZ": _finite(z[peak]),
                        "hookZ": _finite(z[hook].mean()) if hook.any() and count > 3 else None, "trend": _finite(slope)})

    def active_regions(index):
        names = [label for label, z in region_z.items() if z[index] > 1]
        return f" Regions above their own clip average (z > 1): {', '.join(names)}." if names else ""

    moments = []
    for i in _local_extrema(activity_z, times, True, 1.0, 6):
        moments.append({"time": _finite(times[i]), "kind": "peak", "detail": f"Overall predicted response at z = {activity_z[i]:.1f} relative to this clip.{active_regions(i)}"[:400]})
    shift_indices = sorted(change_z, key=lambda t: -change_z[t])
    chosen = []
    for t in shift_indices:
        if change_z[t] < 1.5 or len(chosen) >= 6:
            break
        if all(abs(times[t] - times[j]) >= 2 for j in chosen):
            chosen.append(t)
    for t in sorted(chosen):
        moments.append({"time": _finite(times[t]), "kind": "shift", "detail": f"Large change in the cortical response pattern (z = {change_z[t]:.1f}); often coincides with cuts, new speakers or new content."[:400]})
    for i in _local_extrema(activity_z, times, False, 1.0, 4):
        moments.append({"time": _finite(times[i]), "kind": "dip", "detail": f"Overall predicted response at z = {activity_z[i]:.1f} relative to this clip.{active_regions(i)}"[:400]})
    moments.sort(key=lambda m: m["time"])

    stride = max(1, math.ceil(count / 600))
    series = [{"t": _finite(times[i]), "activity": _finite(activity_z[i]), "change": None if change[i] is None else _finite(change[i])} for i in range(0, count, stride)]

    words = []
    try:
        rows = events[events["type"] == "Word"].sort_values("start")
        for start, text in zip(rows["start"], rows["text"]):
            if isinstance(text, str) and text.strip() and len(words) < 3000:
                words.append({"time": _finite(start), "text": text.strip()[:200]})
    except Exception:
        warnings.append("Word timings could not be read from the TRIBE events table.")
    return {
        "atlas": atlas, "global": series, "regions": regions, "moments": moments[:24], "words": words,
        "duration": _finite(times.max() - times.min() + tr) if count else 0.0,
        "method": (
            "Predicted fMRI-like responses of an average subject on fsaverage5. 'activity' is the root-mean-square response across vertices "
            "at each time step, z-scored within this clip. 'change' is 1 minus the Pearson correlation between consecutive response patterns. "
            "Region values are mean responses over grouped Destrieux labels, z-scored within the clip; hookZ is the mean z over the first "
            f"{HOOK_SECONDS:.0f} seconds and trend is the z-score slope per 10 seconds. All values are relative to this clip, not to other videos "
            "or to a population norm."
        ),
    }


def predict(request, progress):
    started = time.time()
    path, kind = request["path"], request["kind"]
    model = _load(request["checkpoint"], request.get("device", "auto"), request["cache"], progress)
    progress("Extracting audio and transcribing speech" if kind == "video" else "Transcribing audio")
    events = model.get_events_dataframe(**{("video_path" if kind == "video" else "audio_path"): path})
    progress("Running feature extractors and the brain model")
    preds, segments = model.predict(events=events, verbose=False)
    progress("Summarizing predicted responses")
    warnings = []
    tr = float(getattr(model.data, "TR", 1.0))
    summary = summarize(preds, segments, tr, events, warnings)
    device = str(getattr(getattr(model, "_model", None), "device", request.get("device", "auto")))
    return {
        "source": "tribe", "model": "TRIBE v2", "checkpoint": request["checkpoint"], "device": device,
        "asset": os.path.basename(path), "inputKind": kind, "tr": tr,
        "timesteps": int(preds.shape[0]), "vertices": int(preds.shape[1]),
        "timeConvention": "Times are seconds on the stimulus timeline as returned by TRIBE. Upstream predictions are already shifted 5 s to compensate for hemodynamic lag; no further shift was applied.",
        "runtimeSeconds": round(time.time() - started, 1), "warnings": warnings[:10], **summary,
    }


def serve():
    stream = _protocol_stream()
    _send(stream, {"type": "ready", "protocol": PROTOCOL})
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("op") != "predict":
                raise ValueError("Unknown operation.")
            result = predict(request, lambda detail: _send(stream, {"type": "progress", "id": request_id, "detail": detail}))
            _send(stream, {"type": "result", "id": request_id, "result": result})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            _send(stream, {"type": "error", "id": request_id, "message": f"{type(error).__name__}: {error}"[:1000]})


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "probe":
        print(json.dumps(probe(sys.argv[2] if len(sys.argv) > 2 else "facebook/tribev2")))
    elif command == "serve":
        serve()
    else:
        sys.exit("usage: tribe_bridge.py probe [checkpoint] | serve")
