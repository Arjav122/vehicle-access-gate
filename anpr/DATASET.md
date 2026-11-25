# Datasets for measuring the ANPR worker

Accuracy numbers in the README come only from runs of `eval/evaluate.py` on data described here.
Images are **never committed**: `anpr/eval/data/` is gitignored. Only the result tables in
`eval/results/` are committed.

## Folder layout

```
anpr/eval/data/<set-name>/
├── labels.csv          # filename,plate      (the plate exactly as printed, e.g. UP16AB1234)
├── 0001.jpg            # one photo per row; any size; JPEG/PNG/WebP
├── 0002.jpg
└── boxes/              # optional, for detection mAP: YOLO format, one .txt per image
    └── 0001.txt        # "0 cx cy w h" per plate, all relative to image size (0–1)
```

`labels.csv` example:

```csv
filename,plate
0001.jpg,UP16AB1234
0002.jpg,22BH1234AA
0003.jpg,DL3CAF7203
```

## Collecting your own photos (labelling guide)

The easiest way is the webcam demo's **Save for testing** button
(`python -m anpr.cli --source 0 --preview`). It stores the current frame and the plate you type
into `eval/data/webcam/`, already in this format.

When photographing plates yourself:

1. **Consent and privacy:** only photograph plates you are allowed to (your own car, friends'
   with permission). Plates are personal data: keep the photos private, and never commit them.
2. **Type the plate exactly as printed**, without spaces: `UP16AB1234`. Leave out the `IND` mark.
   For a two-line plate, write the top line then the bottom line: `UP16` + `AB1234` → `UP16AB1234`.
3. **Mix conditions:** day / night, straight / at an angle, near / far, clean / dirty,
   cars / two-wheelers, white private plates / yellow commercial plates, BH-series if you can.
4. **Keep a separate test set.** Never tune settings on the images you report results on.
   A good split is 70% for trying settings, 30% held out for the final numbers.
5. Aim for **at least 100 held-out photos** before quoting a percentage; with fewer, report the
   counts ("47 of 52 read exactly") instead.

## Open datasets

For retraining the detector (`notebooks/train_detector.ipynb`), use datasets whose licence
allows it, and record the licence next to every number. Evaluate on a held-out set **from a
different source** than the training data, so the score reflects new cameras and places.
