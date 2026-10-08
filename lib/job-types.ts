// Firestore schema for handwriting transliteration jobs.
//
// Lives in a SEPARATE collection (`handwritingJobs`) from Mandir's
// `transliterationJobs` so the two workers do not contend.
//
// Schema mirrors Mandir's TransliterationJobDocument with two additions:
//  • Per-page outputs include raw text from each OCR engine + the consensus
//    annotation, so a reviewer UI can show disagreements without re-running.
//  • Confidence percentage = ratio of consensus-matched tokens.

export type PageStatus =
  | 'pending'
  | 'ocr_running'
  | 'ocr_done'
  | 'ocr_failed';

export interface OcrEngineOutput {
  /** Raw OCR text returned by the engine. */
  text: string;
  /** Wall-clock duration in ms. */
  durationMs?: number;
  /** Engine-specific metadata (e.g. tesseract confidence, claude model). */
  meta?: Record<string, unknown>;
  /** If the engine errored — the message; raw text will be empty. */
  error?: string;
}

export interface PageJob {
  /** 1-indexed page number in the source PDF. */
  pageNum: number;
  status: PageStatus;
  /** OCR retry counter, capped at 3. */
  attempts: number;
  claimedBy?: string;
  claimedAt?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;

  // ─── OCR engine outputs ───────────────────────────────────────────────
  /** Bottom-up character recognition (Tesseract guj traineddata). */
  tesseract?: OcrEngineOutput;
  /** Claude vision OCR primed with BAPS glossary. */
  bapsPrimed?: OcrEngineOutput;
  /** Token-level diff of tesseract ∩ bapsPrimed; primary input to the
   *  transliterator. Disagreements wrapped as {a|b}, single-engine tokens
   *  as {?A:...} / {?B:...}. */
  consensus?: { merged: string; agreement: number };

  /** Final Gujarati text fed to the transliterator (= consensus.merged
   *  when both engines succeeded, else the surviving engine's output). */
  gujaratiText?: string;

  /** Per-page Roman transliteration. Populated by the transliterator stage
   *  AFTER all pages are OCR'd. */
  transliteratedText?: string;

  /** Word count of `gujaratiText`. */
  wordCount?: number;
}

export type HandwritingJobStatus =
  | 'pending'         // parent created, no pages claimed yet
  | 'ocr_running'     // at least one page in flight
  | 'assembling'      // all pages done, joining text
  | 'transliterating' // running chunker → transliterator → ā-only enforcer
  | 'done'
  | 'failed';

export interface HandwritingJobDocument {
  /** Discriminator vs Mandir's `transliterationJobs` collection. */
  kind: 'handwriting';

  uid: string;
  email: string;

  // Source
  filename: string;
  /** Vercel Blob URL for the original (always a PDF — images are wrapped
   *  into a 1-page PDF at upload time so the worker has one input format). */
  pdfBlobUrl: string;
  totalPages: number;

  // Parent state
  status: HandwritingJobStatus;
  pagesCompleted: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;

  // Outputs
  /** Assembled Gujarati after all pages OCR'd and joined. */
  gujaratiOutput?: string;
  /** Primary product — Roman transliteration with ā-only diacritics. */
  transliteratedOutput?: string;
}
