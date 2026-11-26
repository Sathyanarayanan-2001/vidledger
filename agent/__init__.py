"""VidLedger agent: turns saved YouTube videos into reviewed learning records.

Runs on GitHub Actions in the private data repository. Reads the dashboard's
records (branch vidledger-user), asks Gemini to watch each video, and writes the
library (branch vidledger-state).
"""

VERSION = "1.0.0"
