// Firebase Admin SDK initialiser. Service-account credentials come from env;
// for local dev we fall back to GOOGLE_APPLICATION_CREDENTIALS.
//
// Shares the `aksharpith-translator` Firestore project with Mandir/web — but
// writes to a SEPARATE collection (`handwritingJobs`) so the two workers do
// not contend for jobs.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'aksharpith-translator';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } else {
    initializeApp({ projectId });
  }
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
