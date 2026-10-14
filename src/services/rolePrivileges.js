/**
 * Role & privilege resolution (pure module: no Firebase), shared by the UI, services and tests.
 *
 * - New accounts are "Supporter" until a Super Admin assigns a role.
 * - The Super Admin can do anything on the site and never needs tokens ("UNL" = unlimited).
 * - Teachers and students hold real token balances.
 */

export const OWNER_EMAIL = 'support@aifoundation.net.au';

export const ALLOWED_ROLES = [
  'supporter',
  'student',
  'teacher',
  'admin staff',
  'ceo',
  'coo',
  'cfo',
  'financial team',
  'superadmin'
];

/** Largest single Super Admin token grant. */
export const MAX_SUPERADMIN_GRANT = 999;

export const UNLIMITED_TOKENS_LABEL = 'UNL';

export function isOwnerEmail(email) {
  return String(email || '').trim().toLowerCase() === OWNER_EMAIL;
}

/** Resolves administrative and Super Admin privileges from Firestore role attributes. */
export function resolvePrivileges(profile, enrolledCoursesCount = 0) {
  const isFirebaseAdmin = isOwnerEmail(profile?.email);
  let rawRole = String(profile?.role || '').trim().toLowerCase();

  // If a user has 'supporter' status (or unset) and is enrolled in one or more courses,
  // they automatically become a student!
  if ((!rawRole || rawRole === 'supporter') && enrolledCoursesCount > 0) {
    rawRole = 'student';
  }

  const role = rawRole || (isFirebaseAdmin ? 'superadmin' : 'supporter');
  const isSuperadmin = role === 'superadmin' || isFirebaseAdmin;
  const isAdminStaff = isSuperadmin || role === 'ceo' || role === 'coo' || role === 'admin staff' || role === 'admin';
  const isFinancial = isSuperadmin || role === 'cfo' || role === 'financial team';
  const isTeacher = isSuperadmin || role === 'teacher';
  const isCOO = isSuperadmin || role === 'coo';
  const isCFO = isSuperadmin || role === 'cfo';
  const isStaff = isSuperadmin || isAdminStaff || isFinancial || isTeacher;
  const isStudent = role === 'student';
  const isSupporter = role === 'supporter' && !isSuperadmin;

  // Course enrolment authority:
  // "When someone logs in for the first time, they are a supporter. they can only be added to courses by teachers, admin, superadmin, coo, cfo."
  const canEnrolStudents = isSuperadmin || isTeacher || isAdminStaff || isCOO || isCFO;

  return {
    role: isSuperadmin ? 'superadmin' : role,
    classification: profile?.classification
      ? String(profile.classification).toLowerCase()
      : (isSuperadmin ? 'superadmin' : (isStudent ? 'student' : 'supporter')),
    isSuperadmin,
    isAdminStaff,
    isFinancial,
    isTeacher,
    isCOO,
    isCFO,
    isStaff,
    isStudent,
    isSupporter,
    hasUnlimitedTokens: isSuperadmin,
    canManageRoles: isSuperadmin,
    canGrantTokens: isSuperadmin,
    canCreateCourse: isStaff,
    canEditCourse: isStaff,
    canArchiveCourse: isStaff,
    canEnrolStudents,
    canViewAllStudents: canEnrolStudents,
    canViewDraftCourses: isStudent || isStaff,
    canViewGlobalCourses: isStaff || isStudent || isSupporter
  };
}

/**
 * Evaluates whether a user or role is permitted to add/enrol members to courses.
 * Permitted: teachers, admin, superadmin, coo, cfo.
 * Denied: supporters, students, and general financial team members.
 */
export function canEnrolInCourses(roleOrProfile) {
  if (!roleOrProfile) return false;
  const profile = typeof roleOrProfile === 'string' ? { role: roleOrProfile } : roleOrProfile;
  return resolvePrivileges(profile).canEnrolStudents;
}

export function hasUnlimitedTokens(profile) {
  return resolvePrivileges(profile).isSuperadmin;
}

/** "UNL" for the Super Admin, otherwise the whole-number balance. */
export function formatTokenBalance(balance, profile) {
  if (hasUnlimitedTokens(profile)) return UNLIMITED_TOKENS_LABEL;
  const n = Number(balance);
  return Number.isFinite(n) ? String(Math.max(0, Math.floor(n))) : '0';
}
