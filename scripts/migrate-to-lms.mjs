#!/usr/bin/env node
/**
 * migrate-to-lms.mjs — SAFE, COPY-ONLY migration of legacy collections into the `lms` namespace.
 *
 *   courses  -> lms_courses   (+ siteId, visibility, migratedFrom; stray addDoc stubs skipped)
 *   students -> lms_students  (+ siteId, enrolments; sensitive fields -> private/sensitive)
 *
 * Guarantees:
 *   - NEVER deletes or modifies legacy `courses` / `students` documents.
 *   - Idempotent: documents keep their IDs and are tagged `migratedFrom`; re-running merges.
 *   - --dry-run (default) prints the plan and writes nothing. Pass --apply to write.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
 *   node scripts/migrate-to-lms.mjs --site=ozedu            # dry run
 *   node scripts/migrate-to-lms.mjs --site=ozedu --apply    # write
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const APPLY = args.apply === true;
const SITE_ID = String(args.site || process.env.VITE_LMS_SITE_ID || '').trim();
const PROJECT_ID = args.project || process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

if (!SITE_ID) {
  console.error('ERROR: --site=<siteId> is required (e.g. --site=ozedu).');
  process.exit(1);
}

// Keep in sync with SENSITIVE_STUDENT_FIELDS in src/services/lmsRepository.js
const SENSITIVE_STUDENT_FIELDS = [
  'proofOfIdentityType', 'proofOfIdentityNumber', 'passportNumber', 'visaSubclass',
  'coeNumber', 'nationalIdNumber', 'healthCoverProvider', 'healthCoverPolicyNumber',
  'requiresAccessibilitySupport', 'accessibilitySupportDetails', 'indigenousStatus',
  'guardianDetails', 'taxFileNumberProvided'
];

const STUB_KEYS = new Set(['title', 'startDate', 'students', 'createdAt']);
const STUB_MATCH_WINDOW_MS = 10_000;

function isStrayStub(docData, docId, allDocs) {
  // Legacy bug: addDoc created an auto-ID stub with only these keys, while the real
  // course lived under a Date.now() ID. Skip the stub if its twin exists.
  const keys = Object.keys(docData);
  if (!keys.every(k => STUB_KEYS.has(k))) return false;
  const created = Number(docData.createdAt);
  if (!Number.isFinite(created)) return false;
  return allDocs.some(d => {
    if (d.id === docId) return false;
    const n = Number(d.id);
    return Number.isFinite(n) && Math.abs(n - created) <= STUB_MATCH_WINDOW_MS;
  });
}

async function main() {
  initializeApp({ credential: applicationDefault(), ...(PROJECT_ID ? { projectId: PROJECT_ID } : {}) });
  const db = getFirestore();

  console.log(`\n=== migrate-to-lms | site=${SITE_ID} | mode=${APPLY ? 'APPLY' : 'DRY RUN'} ===\n`);

  // ---------- courses ----------
  const coursesSnap = await db.collection('courses').get();
  const courseDocs = coursesSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  let coursesCopied = 0, stubsSkipped = 0;

  for (const { id, data } of courseDocs) {
    if (isStrayStub(data, id, courseDocs)) {
      stubsSkipped++;
      console.log(`  [skip stub] courses/${id} "${data.title}"`);
      continue;
    }
    const target = db.collection('lms_courses').doc(id);
    const payload = {
      ...data,
      siteId: data.siteId || SITE_ID,
      visibility: data.visibility || 'site',
      archived: Boolean(data.archived),
      modules: Array.isArray(data.modules) ? data.modules : [],
      assessments: Array.isArray(data.assessments) ? data.assessments : [],
      students: Number(data.students) || 0,
      migratedFrom: `courses/${id}`,
      migratedAt: FieldValue.serverTimestamp()
    };
    console.log(`  [course] courses/${id} -> lms_courses/${id} "${data.title || '(untitled)'}"`);
    if (APPLY) await target.set(payload, { merge: true });
    coursesCopied++;
  }

  // ---------- students ----------
  const studentsSnap = await db.collection('students').get();
  let studentsCopied = 0;

  for (const d of studentsSnap.docs) {
    const data = d.data();
    const publicPart = {};
    const sensitivePart = {};
    for (const [k, v] of Object.entries(data)) {
      (SENSITIVE_STUDENT_FIELDS.includes(k) ? sensitivePart : publicPart)[k] = v;
    }
    const enrolledCourseIds = Array.isArray(data.enrolledCourseIds) ? data.enrolledCourseIds.map(String) : [];

    console.log(`  [student] students/${d.id} -> lms_students/${d.id} (+private/sensitive: ${Object.keys(sensitivePart).length} fields)`);
    if (APPLY) {
      const batch = db.batch();
      const ref = db.collection('lms_students').doc(d.id);
      batch.set(ref, {
        ...publicPart,
        id: d.id,
        siteId: data.siteId || SITE_ID,
        enrolledCourseIds,
        enrolments: enrolledCourseIds.map(courseId => ({ siteId: data.siteId || SITE_ID, courseId })),
        migratedFrom: `students/${d.id}`,
        migratedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      batch.set(ref.collection('private').doc('sensitive'), { ...sensitivePart, siteId: data.siteId || SITE_ID }, { merge: true });
      await batch.commit();
    }
    studentsCopied++;
  }

  console.log(`\nSummary: ${coursesCopied} courses, ${stubsSkipped} stray stubs skipped, ${studentsCopied} students.`);
  console.log(APPLY
    ? 'Done. Legacy collections were NOT modified. Verify in the console, then set VITE_LMS_LEGACY_READ=false.'
    : 'Dry run only — nothing written. Re-run with --apply to perform the copy.');
}

main().catch(err => {
  console.error('\nMigration failed (no legacy data was modified):', err?.message || err);
  process.exit(1);
});
