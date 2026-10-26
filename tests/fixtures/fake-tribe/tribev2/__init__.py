"""Test double for the tribev2 package: same entry points, synthetic predictions.

It mimics only what the AdLens bridge calls. It is not TRIBE and its numbers mean nothing.
"""

import os
import time

import numpy as np


class _Column(list):
    def __eq__(self, other):
        return [value == other for value in self]


class _Frame:
    def __init__(self, rows):
        self.rows = rows

    def __getitem__(self, key):
        if isinstance(key, str):
            return _Column(row.get(key) for row in self.rows)
        return _Frame([row for row, keep in zip(self.rows, key) if keep])

    def sort_values(self, column):
        return _Frame(sorted(self.rows, key=lambda row: row[column]))


class _Segment:
    def __init__(self, start):
        self.start = start
        self.duration = 1.0


class _Data:
    TR = 1.0


class TribeModel:
    data = _Data()

    @classmethod
    def from_pretrained(cls, checkpoint, cache_folder=None, device="auto"):
        print("noise on stdout that must not reach the protocol")
        return cls()

    def get_events_dataframe(self, video_path=None, audio_path=None):
        if os.environ.get("FAKE_TRIBE_FAIL"):
            raise RuntimeError("synthetic failure")
        if os.environ.get("FAKE_TRIBE_SLEEP"):
            time.sleep(float(os.environ["FAKE_TRIBE_SLEEP"]))
        return _Frame([
            {"type": "Video", "start": 0.0, "text": None},
            {"type": "Word", "start": 0.9, "text": "scrolling"},
            {"type": "Word", "start": 0.5, "text": "Stop"},
        ])

    def predict(self, events, verbose=True):
        rng = np.random.default_rng(0)
        vertices = 20484 if os.environ.get("FAKE_TRIBE_FSAVERAGE") else 500
        base = rng.normal(size=(1, vertices))
        steps = 20
        preds = np.vstack([base + 0.05 * rng.normal(size=(1, vertices)) for _ in range(steps)])
        preds[2] *= 4.0  # a clear peak at t = 2 s
        if vertices == 20484:
            preds[:3, 2049:4000] += 3.0  # S_calcarine block (early visual) responds strongly in the opening
        shifted = rng.normal(size=(1, vertices))
        preds[12:] = shifted + 0.05 * rng.normal(size=(steps - 12, vertices))  # one pattern shift at t = 12 s
        return preds, [_Segment(float(t)) for t in range(steps)]
