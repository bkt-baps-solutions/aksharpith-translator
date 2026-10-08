// Upload endpoint for handwritten transliteration jobs.
//
// Accepts PDF or image (PNG/JPG). Two intake paths mirror Mandir/web:
//  1. multipart/form-data — small files (≤4.5 MB serverless body cap).
//  2. application/json { blobUrl, filename } — large files staged via
//     Vercel Blob by the client to bypass the body-size limit.
//
// Images are wrapped into a 1-page PDF before enqueuing, so the worker
// always receives a uniform input format.
//
// Output: { jobId, totalPages, filename, status: 'pending' }. The client
// then subscribes to handwritingJobs/{jobId} via Firestore for live progress.

import { PDFDocument } from 'pdf-lib';
import { NextRequest } from 'next/server';
import { put as blobPut } from '@vercel/blob';
import { verifyAuthToken } from '../../../lib/verify-auth';
import { adminDb } from '../../../lib/firebase-admin';
import type { HandwritingJobDocument, PageJob } from '../../../lib/job-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_IMG_SIZE = 20 * 1024 * 1024;   // 20 MB

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg']);

// ─── Image → 1-page PDF wrapper ───────────────────────────────────────

async function wrapImageInPdf(buf: Buffer, ext: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img = ext === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return Buffer.from(await doc.save());
}

// ─── Job creation ─────────────────────────────────────────────────────

async function enqueueHandwritingJob(params: {
  buf: Buffer;
  filename: string;
  uid: string;
  email: string;
  blobUrl?: string;
}): Promise<{ jobId: string; totalPages: number }> {
  const { buf, filename, uid, email } = params;

  let totalPages = 0;
  try {
    totalPages = (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount();
  } catch (err) {
    throw new Error(`Could not parse PDF structure: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  if (totalPages === 0) throw new Error('PDF has zero pages');

  // Worker fetches the PDF over HTTPS; ensure it lives in Blob storage.
  let pdfBlobUrl = params.blobUrl;
  if (!pdfBlobUrl) {
    const safeName = filename.replace(/[^\w.\- ]+/g, '_');
    const blob = await blobPut(`uploads/${uid}/${Date.now()}_${safeName}`, buf, {
      access: 'public',
      contentType: 'application/pdf',
    });
    pdfBlobUrl = blob.url;
  }

  const jobRef = adminDb.collection('handwritingJobs').doc();
  const jobId = jobRef.id;
  const now = new Date().toISOString();

  const parent: HandwritingJobDocument = {
    kind: 'handwriting',
    uid, email, filename, pdfBlobUrl, totalPages,
    status: 'pending',
    pagesCompleted: 0,
    createdAt: now,
  };
  await jobRef.set(parent);

  const BATCH = 500;
  for (let start = 0; start < totalPages; start += BATCH) {
    const batch = adminDb.batch();
    const end = Math.min(start + BATCH, totalPages);
    for (let i = start; i < end; i++) {
      const pageNum = i + 1;
      const pageRef = jobRef.collection('pages').doc(String(pageNum).padStart(4, '0'));
      const page: PageJob = { pageNum, status: 'pending', attempts: 0, createdAt: now };
      batch.set(pageRef, page);
    }
    await batch.commit();
  }

  return { jobId, totalPages };
}

// ─── Route handler ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authUser = await verifyAuthToken(req);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const contentType = req.headers.get('content-type') ?? '';
    let buf: Buffer;
    let filename: string;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null) as { blobUrl?: string; filename?: string } | null;
      if (!body?.blobUrl || !body?.filename) {
        return Response.json({ error: 'Missing blobUrl or filename' }, { status: 400 });
      }
      try {
        const u = new URL(body.blobUrl);
        if (!u.hostname.endsWith('.public.blob.vercel-storage.com')) {
          return Response.json({ error: 'Invalid blob URL host' }, { status: 400 });
        }
      } catch {
        return Response.json({ error: 'Invalid blob URL' }, { status: 400 });
      }
      try {
        const res = await fetch(body.blobUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        console.error('[upload] blob fetch failed:', err);
        return Response.json({ error: 'Could not retrieve uploaded file' }, { status: 502 });
      }
      filename = body.filename;
    } else {
      const formData = await req.formData().catch(() => null);
      if (!formData) return Response.json({ error: 'Invalid form data' }, { status: 400 });

      const fileField = formData.get('file');
      if (!fileField || typeof fileField === 'string' || !('arrayBuffer' in fileField)) {
        return Response.json({ error: 'No file provided' }, { status: 400 });
      }
      const file = fileField as File;
      if (!file.name) return Response.json({ error: 'No file provided' }, { status: 400 });
      try {
        buf = Buffer.from(await file.arrayBuffer());
      } catch {
        return Response.json({ error: 'Could not read file. The upload may be corrupted.' }, { status: 400 });
      }
      filename = file.name;
    }

    if (buf.length === 0) {
      return Response.json({ error: 'File is empty.' }, { status: 400 });
    }
    if (buf.length > MAX_FILE_SIZE) {
      return Response.json({
        error: `File too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Maximum is 100 MB.`,
      }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ext) {
      return Response.json({
        error: 'File has no extension. Supported: PDF, PNG, JPG.',
      }, { status: 400 });
    }

    let pdfBuf: Buffer;
    let pdfFilename: string;

    if (ext === 'pdf') {
      pdfBuf = buf;
      pdfFilename = filename;
    } else if (IMAGE_EXTS.has(ext)) {
      if (buf.length > MAX_IMG_SIZE) {
        return Response.json({
          error: `Image too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`,
        }, { status: 400 });
      }
      try {
        pdfBuf = await wrapImageInPdf(buf, ext);
      } catch (err) {
        console.error('[upload] image wrap failed:', err);
        return Response.json({ error: 'Could not wrap image for processing.' }, { status: 500 });
      }
      pdfFilename = filename.replace(/\.(png|jpe?g)$/i, '.pdf');
    } else {
      return Response.json({
        error: `Unsupported file type: .${ext}. Handwriting service accepts PDF, PNG, JPG only. For DOCX/TXT use translator.baps.solutions.`,
      }, { status: 400 });
    }

    try {
      const { jobId, totalPages } = await enqueueHandwritingJob({
        buf: pdfBuf,
        filename: pdfFilename,
        uid: authUser.uid,
        email: authUser.email,
      });
      return Response.json({
        jobId,
        totalPages,
        filename: pdfFilename,
        status: 'pending',
        message: `Queued — ${totalPages} page(s) will OCR via local handwriting worker.`,
      });
    } catch (err) {
      console.error('[upload] enqueueHandwritingJob failed:', err);
      return Response.json({
        error: 'Could not queue this file for processing. Please retry.',
      }, { status: 500 });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Upload error:', msg);
    return Response.json({ error: 'Upload failed. Please retry.' }, { status: 500 });
  }
}
