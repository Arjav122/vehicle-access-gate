# Phase 3: ANPR edge worker

## What we built and why

A Python program that runs next to the camera (the "edge"). It finds plates, reads them, decides when it has seen a car well enough, and sends **one read per car** to the server, even when the network is down.

1. **Sources** (`sources.py`): webcam, RTSP/HTTP stream, video file, or a folder of photos.
2. **Detector** (`detector.py`): a YOLO11 model on ONNX Runtime. We wrote the letterboxing, output decoding and NMS ourselves in NumPy, so no PyTorch is needed.
3. **OCR** (`ocr.py`): crop the plate, clean the image up, read it with PaddleOCR, and put the pieces in reading order.
4. **Frame voting** (`tracker.py`): many reads of one car are combined into one, by summed confidence.
5. **Delivery** (`client.py`, `buffer.py`): every read goes into SQLite first, then is sent oldest-first with retries. Nothing is lost when the server is down.
6. **Pipeline + CLI + preview** (`pipeline.py`, `cli.py`, `preview.py`): the same chain runs from the command line and on the local webcam page.
7. **Model download** (`download_model.py`): a pinned file with a SHA-256 check. **Evaluation** (`eval/evaluate.py`): honest measurements on labelled photos.

## Key concepts, simply

- **ONNX / ONNX Runtime:** a standard file format for trained models, plus a small, fast engine to run them. Train in PyTorch, run anywhere without PyTorch.
- **Letterboxing:** resize the image to fit 640×640 while keeping its shape, then fill the rest with grey. Afterwards, boxes are mapped back by undoing the scale and padding.
- **NMS (non-maximum suppression):** the model proposes many overlapping boxes for one plate. Keep the most confident one, drop boxes that overlap it a lot (IoU > 0.5), repeat.
- **IoU (intersection over union):** overlap area ÷ combined area. 1 = identical boxes, 0 = no overlap.
- **Frame voting:** a car is read 5–20 times. Reads within 2 edits of each other belong to one car. The text with the highest total confidence wins, and it's sent once.
- **Offline buffer / store-and-forward:** write first, send second. If sending fails, the read is still on disk. Sending in order (oldest first) keeps entry/exit order right.
- **WAL + synchronous=FULL:** SQLite settings for durability. A write that returned is safe even after a power cut.
- **Retry with backoff:** wait 0.5 s, 1 s, 2 s … between tries, so a struggling server isn't hammered. 4xx means "you sent something wrong", so retrying won't help: set it aside.
- **DNS rebinding and CSRF on localhost:** any website could try to call `127.0.0.1:8765`. Checking the Host header and requiring a custom header blocks it.
- **Licences:** our code is MIT. The default detector weights are someone else's, under AGPL-3.0. We download them from their publisher; we don't re-host them.

## Files to read, in order

1. `anpr/anpr/detector.py`: letterbox, decode, NMS, mapping boxes back.
2. `anpr/tests/test_detector.py`: the maths checked on hand-built tensors, then the real model.
3. `anpr/anpr/ocr.py`: crop, preprocessing, reading order, the IND line.
4. `anpr/anpr/tracker.py` and `tests/test_tracker.py`: voting and when a track is sent.
5. `anpr/anpr/client.py`, `buffer.py`, `tests/test_buffer.py`: retries and the offline queue.
6. `anpr/anpr/pipeline.py`, `cli.py`: how the pieces fit.
7. `anpr/anpr/preview.py`, `preview.html`: three threads, the page, its security.
8. `anpr/anpr/download_model.py`, `anpr/eval/evaluate.py`, `anpr/DATASET.md`.
9. `server/prisma/webcamDevices.ts`: how the webcam gets its two device keys.

## Alternatives we rejected

- **Ultralytics at run time:** easy, but it pulls in PyTorch (a huge install) and AGPL code on the edge device.
- **Repairing plates on the camera:** the server already repairs; two places would disagree.
- **Sending every frame:** 20 events per car, a lot of bandwidth, and debouncing pushed onto the server.
- **Retrying forever in memory:** a restart loses the reads. SQLite keeps them.
- **EasyOCR as a fallback:** only if it measurably wins (≥ 2 points) on our own held-out photos.

## Likely interview questions

1. **Why ONNX Runtime instead of Ultralytics?** A much smaller install, no PyTorch, no AGPL library code at the edge. The model file is the only third-party part.
2. **Walk me through NMS.** Sort boxes by score; take the best; remove every box whose IoU with it is above 0.5; repeat with what's left.
3. **How does one car become one event?** The tracker groups reads within 2 edits, votes by summed confidence, and sends once: early after 3 identical reads, or after 2 s out of view. The server also debounces, as a second line of defence.
4. **What happens when the Wi-Fi drops?** Reads are already in SQLite. Draining stops at the first network failure and resumes oldest-first. The server's idempotency makes repeats harmless.
5. **Why does a 4xx not block the queue?** It will never succeed, so it moves to a `rejected` table. Only temporary failures stop the drain.
6. **Why do recordings use video time, not wall-clock time?** Re-running the same clip gives the same capture times, so the server recognises repeats (`duplicate`) instead of creating new events.
7. **How do you keep the local demo page safe?** Bind to 127.0.0.1, check Host, require a custom header (not sendable cross-site without a preflight we never allow), and a CSP with a nonce and `frame-ancestors 'none'`.
8. **How would you measure accuracy honestly?** A labelled, held-out set from a different source than training, a selection rule fixed before looking, exact-match accuracy with counts, and latency medians/p95 with the machine named. No number without a reproducible run.
9. **What did you find when testing OCR?** PaddlePaddle's oneDNN path crashed on Windows; text pieces came back out of order. Both are fixed, with tests. And OCR is the bottleneck (~1 s/crop on CPU vs ~60 ms for detection).

## Exercise

Add a `--max-frames N` flag to the CLI that stops after N analysed frames, which is handy for quick tests on long videos. Write a test with a 3-second synthetic video (see `test_pipeline.py`) that checks only N frames reach the pipeline.
