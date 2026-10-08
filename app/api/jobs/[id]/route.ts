// Read-only status endpoint for a handwriting job. Returns the parent doc
// plus a summary of page statuses so a polling client can render progress
// without subscribing to Firestore directly.
//
// Auth: caller must own the job (uid match) — anyone else gets 404.

import { NextRequest } from 'next/server';
import { verifyAuthToken } from '../../../../lib/verify-auth';
import { adminDb } from '../../../../lib/firebase-admin';
import type { HandwritingJobDocument, PageJob } from '../../../../lib/job-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const authUser = await verifyAuthToken(req);
  if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const jobRef = adminDb.collection('handwritingJobs').doc(id);
  const snap = await jobRef.get();
  if (!snap.exists) return Response.json({ error: 'Not found' }, { status: 404 });

  const job = snap.data() as HandwritingJobDocument;
  if (job.uid !== authUser.uid) return Response.json({ error: 'Not found' }, { status: 404 });

  // Page summary — small payload, just status counts + per-page minimal info.
  const pagesSnap = await jobRef.collection('pages').orderBy('pageNum').get();
  const pages = pagesSnap.docs.map(d => {
    const p = d.data() as PageJob;
    return {
      pageNum: p.pageNum,
      status: p.status,
      attempts: p.attempts,
      wordCount: p.wordCount ?? 0,
      hasGujarati: !!p.gujaratiText,
      hasTransliteration: !!p.transliteratedText,
      error: p.error ?? null,
    };
  });

  return Response.json({ job, pages });
}
