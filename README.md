# transliterator-baps

Backend service for handwritten Gujarati → Roman-script transliteration. Sister tool to [`translator.baps.solutions`](../Mandir/web/) for the harder case of cursive handwriting — workshop notes, journals, scribbled lecture pages.

**Architecture:** headless backend. Frontend lives elsewhere (`translation-tool/`). This repo exposes API routes deployable to Vercel + a long-running local worker that processes pages page-by-page from a Firestore queue.

## Why a separate service?

The printed-text pipeline at `translator.baps.solutions` does single-pass Claude vision OCR — fine for clean PDFs, useless on handwriting. On handwritten BAPS notes, vanilla Claude vision confidently mis-renders ભગવાન (Bhagwān) as bhāvavān/bhukhvāl/netravan inside the same document because the model has no prior over the BAPS lexicon.

This service tackles that with two ideas:
1. **Prime the OCR engine with the BAPS glossary** — collapses lexical ambiguity.
2. **Run multiple architecturally-different engines and vote** — disagreement signals real uncertainty, not shared LLM hallucination.

## Architecture

```
[ translation-tool (Vercel UI) ]
            │ Firebase ID token
            ▼
[ /api/upload    →   Vercel Blob + Firestore handwritingJobs/{id}/pages/{n}      ]
[ /api/jobs/[id] →   read-only status                                             ]
            │
            ▼
[ Firestore — handwritingJobs collection (separate from Mandir's) ]
            │ polls
            ▼
[ scripts/handwriting-worker.mjs (long-running, on Jay's Mac)      ]
   ├── claim page (Firestore txn)
   ├── pdftoppm → 300-DPI PNG
   ├── 3-engine OCR pipeline:
   │     A · Tesseract (guj traineddata)
   │     B · BAPS-primed Claude vision
   │     C · Consensus voter (LCS token diff)
   ├── chunk + transliterate (Claude Sonnet)
   └── ā-only diacritic enforcer
```

## Quickstart

```bash
npm install
brew install tesseract tesseract-lang poppler

# Reuse Mandir's env, or create a fresh .env.local with:
#   CLAUDE_CODE_OAUTH_TOKEN, FIREBASE_PROJECT_ID,
#   FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
#   BLOB_READ_WRITE_TOKEN
! cp ../Mandir/web/.env.local .env.local

# Standalone CLI eval (no Firestore — produces a Markdown report):
npm run sample

# Full backend service:
npm run dev      # Next.js API on http://localhost:3000
npm run worker   # poller — leave running in another terminal

# Production:
npm run build && npm run start
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | PDF/image upload + page-job fan-out (multipart or JSON-with-blobUrl) |
| `POST` | `/api/blob-token` | Vercel Blob upload-token handshake (large files bypass 4.5 MB body cap) |
| `GET`  | `/api/jobs/[id]` | Read-only status for a job + per-page summary |

All routes require `Authorization: Bearer <Firebase ID token>`.

## Engines (round 1)

| Engine | Architecture | Status |
|--------|--------------|--------|
| **A · Tesseract** (`guj` traineddata) | Bottom-up character OCR | Unusable on handwriting (kept for round-2 ablations) |
| **B · BAPS-primed Claude vision** | Top-down LLM + glossary primer | **Working** — produces coherent BAPS Gujarati |
| **C · Consensus voter** | LCS token-diff of A vs B | Noisy until A is replaced |

The worker stores per-engine outputs on each page doc so a future reviewer UI can surface disagreements without re-running OCR.

## Per-token confidence

The transliterator preserves consensus markers verbatim:
- `word` — agreed by both engines (high confidence)
- `{tess|claude}` — engines disagreed (pick the better BAPS term)
- `{?A:...}` — only Tesseract saw this (likely page-show-through noise)
- `{?B:...}` — only Claude saw this (probably real, possibly hallucinated)

These travel from the Gujarati OCR output through to the Roman transliteration without a separate UI layer.

## Deploy

Vercel project on `sapio-health-dev` team. Region `lhr1`. Worker is **NOT** deployed to Vercel — it runs on Jay's Mac (same as Mandir's worker), polls Firestore for jobs.

## See also
- `CLAUDE.md` — architecture details + roadmap
- `samples/bhakti-page{1,2}-eval.md` — round-1 reference output
- `../Mandir/web/` — sister project for printed-text pipeline
- `../translation-tool/` — frontend (separate repo)
