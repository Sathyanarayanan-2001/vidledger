# Setup (about 20 minutes, once)

1. **Two repositories** on your account with the same code: `vidledger` (public, serves the dashboard) and `vidledger-data` (private, runs the agent and keeps your library). Push this code to both.
2. **Gemini API key**: Google AI Studio → Get API key. The free tier processes up to 8 hours of YouTube video a day.
3. **Private repository** `vidledger-data` → Settings → Secrets and variables → Actions:
   - Secret `GEMINI_API_KEY` = your key.
   - Variable `VIDLEDGER_ROLE` = `data`.
4. **Optional** secret `YOUTUBE_API_KEY`: Google Cloud console → enable *YouTube Data API v3* → create an API key restricted to it. Gives exact durations, detects private or unlisted videos before spending budget, lets triage watch only the first 5 minutes, and expands playlist links.
5. **Public repository** `vidledger` → Settings → Pages → Source: *GitHub Actions*. The CI workflow tests and publishes on every push to `main`.
6. **Token for the dashboard**: GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
   - Repository access: only `vidledger-data`.
   - Permissions: Contents *Read and write*; Actions *Read and write*.
   - Expiry: 90 days is a good balance.
7. Open `https://<you>.github.io/vidledger/`, enter `<you>/vidledger-data` and the token, press **Connect**. Add videos, press **Process now**. The first run creates the `vidledger-state` branch; your first save creates `vidledger-user`.

## Optional repository variables (private repository)

| Variable | Default | Meaning |
| --- | --- | --- |
| `VIDLEDGER_MODEL` | `gemini-3.8-flash` | Model for transcripts, packs, cards and guides |
| `VIDLEDGER_TRIAGE_MODEL` | same | Model for triage |
| `VIDLEDGER_DAILY_VIDEO_HOURS` | `7.5` | Daily video budget (raise on a paid plan) |
| `VIDLEDGER_PARALLEL` | `2` | Videos processed at once (1-4) |
| `VIDLEDGER_MAX_JOBS_PER_RUN` | `20` | Jobs per run |
| `VIDLEDGER_RUN_MINUTES` | `50` | Stop starting new work after this |

## When something goes wrong

- **"Gemini rejected the API key"**: check the `GEMINI_API_KEY` secret.
- **"Gemini does not know this model"**: set `VIDLEDGER_MODEL` to a current model id from Google's docs.
- **"daily quota is used up"**: nothing to do; the next run after 13:30 IST continues.
- **A video "Needs attention"**: it is private, unlisted or removed; Gemini only reads public videos.
- **Dashboard says "Not saved"**: the token expired or lacks Contents write. Create a new one and paste it under Settings → Connection.
