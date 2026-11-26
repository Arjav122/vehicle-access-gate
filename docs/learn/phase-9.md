# Phase 9: Polish, docs, release preparation

Done before deployment, at the owner's request (decisions D36).

## What we built and why

1. **README** (recruiter-first, brief §18):
   - a GIF from the running app, the pitch and how to try it;
   - what it does, engineering highlights, an architecture diagram;
   - a results table with measured numbers only;
   - stack, quick start, screenshots, structure, testing, known limitations.
2. **A real speed number:** `anpr/eval/evaluate.py --latency N` times the real ONNX detector and
   records the machine it ran on. Accuracy stays "TBD" until labelled photos exist.
3. **Demo GIF tooling:** `npm run demo:frames` records a real flow with Playwright; `e2e/frames_to_gif.py` turns the frames into `docs/assets/demo.gif`.
4. **Interview guide** (`docs/learn/INTERVIEW_GUIDE.md`): pitch, walkthrough, ten hard questions.
5. **Deployment plan** (`docs/deployment.md`): reviewed, not carried out yet.
6. **A bug found and fixed:** the seed's "right now" visitor could be registered in the future.
7. **Checks:** every test suite, the browser journeys, the Docker stack, and a link check of all Markdown.

## Key concepts, simply

- **Measure, don't estimate:** a number in a README is a claim. Each one names how it was
  measured, on what, and where the raw result lives, so anyone can reproduce or doubt it.
- **Latency vs accuracy:** how fast a model runs doesn't depend on what the picture shows, so
  speed can be measured on a synthetic frame. How *correct* it is can't be; that needs real,
  labelled photos.
- **Median and p95:** the median is the typical case; p95 is "19 runs in 20 are at least this
  fast". The p95 shows the slow outliers a user actually notices.
- **Warm-up runs:** the first few inferences allocate memory and are slower. They are run but not
  timed, so the numbers describe the steady state.
- **Reproducible assets:** screenshots and the GIF come from scripts against the running app, so
  they can be re-made after any UI change instead of being hand-edited images.

## Files to read, in order

1. `README.md`, top to bottom, as a recruiter would.
2. `anpr/eval/evaluate.py`: `measure_latency`, `cpu_name`, and `--latency` in `main`; then
   `anpr/eval/results/latency-dev-laptop.md`.
3. `client/e2e/demo.spec.ts` and `client/e2e/frames_to_gif.py`.
4. `server/prisma/seed.ts` `registrationTime`, and its test in `server/tests/analytics.test.ts`.
5. `docs/learn/INTERVIEW_GUIDE.md`.
6. `docs/deployment.md`.

## Alternatives we rejected

- **Guessing an accuracy number** ("~95 %"): it can't be defended in an interview, and the brief forbids it.
- **A screen recording edited by hand:** it would go stale with the next UI change.
- **Adding ffmpeg or a GIF library to the client:** Pillow already exists in the ANPR environment.
- **Tagging v2.0.0 before deployment:** the release notes should include the live demo.

## Likely interview questions

1. **Why is accuracy "TBD" in your README?** I haven't collected a labelled photo set yet. The
   evaluation script is ready; publishing a number I didn't measure would be a guess.
2. **How did you measure the detector's speed?** 200 timed runs after 10 warm-up runs on a
   1280×720 frame, ONNX FP32 on CPU, with median and p95 reported along with the CPU and runtime version.
3. **Why is p95 higher than the median?** Background work on the machine and garbage collection
   make some runs slower. p95 shows how bad the slow cases get.
4. **How do you keep screenshots up to date?** They're produced by Playwright scripts against the
   running app, so I re-run one command after a UI change.
5. **What did you find while making the demo GIF?** An approval countdown above the 3-minute
   maximum: a seed timing bug. It's fixed and has a regression test.

## Exercise

Collect 30 labelled photos of plates (see `anpr/DATASET.md`), run
`python eval/evaluate.py --data eval/data/<your-set>`, and replace the two "TBD" rows in the
README with the measured numbers and a link to the result file.
