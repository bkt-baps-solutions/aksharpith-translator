# transliterator-baps — Claude Instructions

## Purpose
Backend service for handwritten Gujarati → Roman-script transliteration. Sister tool to `translator.baps.solutions` (Mandir/web), specialised for the harder case of cursive handwriting where vanilla Claude vision OCR fails.

**Architecture role:** *headless backend*. The frontend lives in `translation-tool/` (separate repo). This service exposes upload + status APIs, runs a local long-running worker that polls Firestore for jobs, and writes Roman transliterations back. Vercel-deployable.

Domain (planned): `transliterator-baps-api.baps.solutions` (or similar — not user-facing).

## Tech stack
- **Next.js 15** (App Router) on Vercel — API routes only, no UI
- **Firebase Admin SDK** → shared `aksharpith-translator` Firestore project
- **Vercel Blob** → file staging (≤100 MB)
- **Claude Max** via `@anthropic-ai/claude-agent-sdk` (zero API spend)
- **Tesseract 5** with `guj` traineddata — bottom-up OCR engine A
- **Poppler `pdftoppm`** for PDF → PNG rendering (handles weird scanner PDFs)
- **TypeScript strict** for API routes; **`.mjs`** for worker + engines

## Hard rules
1. **Never modify Mandir's worker** (`Mandir/web/scripts/local-worker.mjs`) — that is the canonical printed-text worker. We run a SEPARATE worker on a SEPARATE collection.
2. **Separate Firestore collection**: `handwritingJobs/` (Mandir uses `transliterationJobs/`). Two workers coexist; neither contends.
3. **Auth via Firebase ID tokens**, not API keys. translation-tool is the source of authenticated callers.
4. **Never read or write `.env*` files** from Claude (workspace policy). Jay copies/edits them.
5. **Never commit secrets**.
6. **Conventional commits**: `feat(scope): summary` ≤72 chars.

## Project structure
```
transliterator-baps/
├── CLAUDE.md                          # This file
├── README.md
├── package.json                       # Next.js 15 + Firebase + Blob + Claude SDK
├── next.config.ts
├── tsconfig.json
├── vercel.json
├── .gitignore
├── app/
│   └── api/
│       ├── upload/route.ts            # PDF/image → Blob + Firestore page-job fan-out
│       ├── blob-token/route.ts        # Vercel Blob upload-token handshake
│       └── jobs/[id]/route.ts         # Read-only job status (uid-scoped)
├── lib/
│   ├── firebase-admin.ts              # Firestore + Auth singletons
│   ├── verify-auth.ts                 # Bearer token → uid + email
│   ├── job-types.ts                   # HandwritingJobDocument + PageJob
│   ├── pipeline.mjs                   # Chunker + ā-only enforcer + user-prompt
│   ├── parser.mjs                     # <transliteration> XML extraction
│   ├── ocr-engines/
│   │   ├── types.mjs                  # OcrEngine interface (typedef)
│   │   ├── tesseract.mjs              # Engine A — bottom-up character OCR
│   │   ├── baps-primed.mjs            # Engine B — Claude vision + BAPS primer
│   │   ├── consensus.mjs              # Engine C — LCS token diff voter
│   │   └── index.mjs
│   └── rules/
│       └── transliterator-prompt.ts   # Aksharpith ā-only system prompt
│                                      # (synced from Mandir; keep byte-identical)
├── scripts/
│   ├── handwriting-worker.mjs         # Long-running local worker (npm run worker)
│   └── transliterate-handwriting.mjs  # Standalone CLI eval (npm run sample)
└── samples/
    ├── bhakti-page{1,2}.png           # Round-1 test corpus
    └── bhakti-page{1,2}-eval.md       # Reference output
```

## Job lifecycle
```
HandwritingJob:
  pending → ocr_running → assembling → transliterating → done
                                                       |
                                                       └→ failed (any stage)

PageJob (sub-doc per PDF page):
  pending → ocr_running → ocr_done | ocr_failed
```

Each PageJob writes back per-engine outputs (`tesseract`, `bapsPrimed`, `consensus`) so a future reviewer UI can render disagreements without re-OCR.

## Endpoints

### `POST /api/upload`
Auth: Firebase ID token in `Authorization: Bearer <token>`.

Two intake paths:
- `multipart/form-data` with `file` field (≤4.5 MB body limit)
- `application/json { blobUrl, filename }` for files staged via `/api/blob-token` (≤100 MB)

Accepts PDF or PNG/JPG (images get wrapped into a 1-page PDF). Other extensions rejected — DOCX/TXT belong on `translator.baps.solutions`.

Returns: `{ jobId, totalPages, filename, status: 'pending' }`.

### `POST /api/blob-token`
Vercel Blob upload-token handshake. Standard pattern from `@vercel/blob/client`.

### `GET /api/jobs/[id]`
Auth + uid-scoped. Returns the parent job + page-status summary.

## Worker
Runs locally on Jay's Mac via `npm run worker`. Two pollers alternate:
1. **Page poller** — claims one pending page via Firestore txn, renders to 300 DPI PNG, runs the 3-engine OCR pipeline, writes `gujaratiText` + per-engine outputs.
2. **Transliteration poller** — when `pagesCompleted === totalPages`, assembles Gujarati, chunks (verse-aware, 300–500 words), runs Claude transliterator with consensus markers preserved, applies ā-only enforcer, writes `transliteratedOutput`.

Stale-claim reaper: pages claimed >10 min ago revert to `pending` so a crashed worker doesn't permanently strand pages.

## Round status

### Round 1 (this build) — DONE
- Backend skeleton + worker + 3 OCR engines wired up
- BAPS-primed Claude vision is the working engine; Tesseract is dead weight on handwriting (kept for round 2 ablations)
- Consensus voter is structurally correct but produces noisy output until A is fixed

### Round 2 (next)
- Replace Tesseract with second-Claude-pass (verbatim/no-glossary prior). Consensus disagreement then signals real ambiguity, not gibberish.
- Add ImageMagick preprocessing (greyscale + adaptive threshold) before vision OCR.
- Add bullet-band cropping for dense pages.

### Round 3 (later)
- Fold OCR-engine layer back into Mandir as a pluggable `OcrEngine` behind a `PageJob.ocrMode` flag, so the printed-text product gains a "this is handwritten" toggle and we delete this whole repo.

## Quickstart

```bash
cd transliterator-baps/
npm install
brew install tesseract tesseract-lang poppler

# Either:
! cp ../Mandir/web/.env.local .env.local      # reuse Mandir's Firebase + Claude creds
# Or create a fresh one — needs:
#   CLAUDE_CODE_OAUTH_TOKEN=...      (claude setup-token)
#   FIREBASE_PROJECT_ID=aksharpith-translator
#   FIREBASE_CLIENT_EMAIL=...        (service account from Firebase console)
#   FIREBASE_PRIVATE_KEY="..."

# CLI eval (no Firestore, just produces eval Markdown):
npm run sample

# Full backend service:
npm run dev      # API routes on http://localhost:3000
npm run worker   # poller — leave running in another terminal

# Production build:
npm run build && npm run typecheck
```

## Deploy
- Vercel project on `sapio-health-dev` team
- Region: `lhr1` (London)
- Env: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `BLOB_READ_WRITE_TOKEN`
- Worker is **NOT** deployed to Vercel — it's a long-running process on Jay's Mac (same as Mandir's worker)

## Don'ts
- Don't import `firebase-admin` from any `"use client"` file — server-only.
- Don't add a frontend here — that lives in `translation-tool/`.
- Don't store secrets in code — env vars only.
- Don't write to Mandir's `transliterationJobs/` collection — separate workers, separate streams.
- Don't expose stack traces in API error responses (`Sapio SECURITY` rule).

## Files synced from Mandir/web
| File | Source |
|------|--------|
| `lib/rules/transliterator-prompt.ts` | `Mandir/web/lib/rules/transliterator-prompt.ts` |
| `lib/firebase-admin.ts` | adapted from `Mandir/web/lib/firebase-admin.ts` |
| `lib/verify-auth.ts` | adapted from `Mandir/web/lib/verify-auth.ts` |
| `app/api/blob-token/route.ts` | adapted from `Mandir/web/app/api/blob-token/route.ts` |

When Mandir's prompt or auth changes, update the copies here and document the sync date.
