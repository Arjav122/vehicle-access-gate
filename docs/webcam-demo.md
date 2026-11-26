# Laptop webcam demo

Hold a number plate (printed, or on a phone screen) in front of your laptop camera. The worker reads it and sends it to the server, and the page shows what the server decided.

## One-time setup (Windows, PowerShell)

1. Start the stack and seed the demo society:

   ```powershell
   docker compose up --build --wait
   ```

   ```powershell
   docker compose exec server npm run seed -- --reset
   ```

2. Create the two webcam devices (entry and exit) and write their keys to `anpr/.env`:

   ```powershell
   cd server; $env:DATABASE_URL="postgresql://vehicle_access:vehicle_access@127.0.0.1:5432/vehicle_access"; npm run webcam:devices
   ```

   A demo reset (admin → Settings → Reset demo, or the nightly 04:00 reset in demo mode) deletes
   every device, so run this step again after one. The traffic simulator never touches devices
   whose name contains "Laptop webcam", so both can run side by side.

3. Install the worker with the OCR engine (Python 3.12; `uv` downloads it if needed), then download the detector:

   ```powershell
   cd anpr; uv venv --python 3.12 .venv; uv pip install --python .venv -e ".[ocr,dev]"
   ```

   ```powershell
   cd anpr; .venv\Scripts\python -m anpr.download_model
   ```

## Run it

```powershell
cd anpr; .venv\Scripts\python -m anpr.cli --source 0 --preview
```

Open http://127.0.0.1:8765. The first start takes a few seconds: PaddleOCR loads, and downloads its models the first time.

| Control | What it does |
|---|---|
| **Entry** / **Exit** (keys E / X) | Which lane, and so which device key, the next read is sent as |
| **Scan again** (Space) | Forget the current read, so the car in view is read and sent again |
| **Register this visitor** | For an unknown car: opens the guard console's register form, prefilled (Phase 6) |
| **Save frame + plate** | Stores the frame and the plate you type into `anpr/eval/data/webcam/`, for measuring real accuracy (see `anpr/DATASET.md`) |

What the colours mean is always also written in words: "Resident car (flat C-101): entry logged", "New car: register the visitor", "Watchlist plate: stop the car and call security", "Unclear read: the guard will check it", "Server offline: read saved…".

## Without a webcam

The same worker reads video files and photo folders:

```powershell
cd anpr; .venv\Scripts\python -m anpr.cli --source C:\path\to\photos --direction entry
```

## Notes

- **Speed:** on a laptop CPU, PaddleOCR takes about a second per read (docs/decisions.md D18), so hold the plate steady for 3 seconds.
- **The page is only for your own machine:** it binds to 127.0.0.1, checks the Host header, needs a custom header on every button, and cannot be framed by other sites.
- **If the server is down,** reads wait in `anpr/data/buffer-<lane>.sqlite` and are sent oldest-first when it is back.
