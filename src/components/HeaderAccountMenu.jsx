import React, { useState } from 'react';

/**
 * Android / iPhone header pieces. On phones the Google button sits at the top right where the
 * 3-bar menu used to be: "Sign in with Google" when signed out, and the signed-in Google account
 * button that opens the role menu (whose first item is the role status). Desktop and laptop hide
 * all of these in App.css and keep their own header unchanged.
 */

export const HEADER_MENU_ID = 'header-nav-menu';

/** The four-colour Google "G" (same artwork as the desktop Sign in with Google button). */
export function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
    </svg>
  );
}

const ROLE_LABELS = {
  superadmin: 'Super Admin',
  'admin staff': 'Admin Staff',
  admin: 'Admin',
  ceo: 'CEO',
  coo: 'COO',
  cfo: 'CFO',
  'financial team': 'Financial Team',
  teacher: 'Teacher',
  student: 'Student',
  supporter: 'Supporter'
};

/** "superadmin" -> "Super Admin", "teacher" -> "Teacher"; unknown roles are title-cased. */
function roleDisplayName(role) {
  const key = String(role || '').trim().toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  return key ? key.replace(/\b[a-z]/g, c => c.toUpperCase()) : 'Supporter';
}

function accountName(user) {
  return user?.displayName || user?.email?.split('@')[0] || 'Account';
}

/** Google profile photo, or the first letter of the name when there is none (or it fails to load). */
function AccountAvatar({ user, size }) {
  const [failed, setFailed] = useState(false);
  if (user?.photoURL && !failed) {
    return (
      <img
        className="account-avatar"
        src={user.photoURL}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="account-avatar account-avatar-initial" style={{ width: size, height: size }} aria-hidden="true">
      {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
    </span>
  );
}

/** Phones, signed out: "Sign in with Google" at the top right of the header. */
export function MobileSignInButton({ onClick, busy = false }) {
  return (
    <button type="button" className="mobile-signin-btn" onClick={onClick} disabled={busy} title="Sign in with your Google account">
      <GoogleIcon size={18} />
      <span className="mobile-signin-label">{busy ? 'Connecting...' : 'Sign in with Google'}</span>
    </button>
  );
}

/** Phones, signed in: the Google account button that opens and closes the role menu. */
export function MobileAccountButton({ ref, user, role, open, onToggle }) {
  return (
    <button
      ref={ref}
      type="button"
      className={`mobile-account-btn${open ? ' open' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={HEADER_MENU_ID}
      aria-label={`Account menu for ${accountName(user)} (${roleDisplayName(role)})`}
      title="Your Google account and menu"
    >
      <GoogleIcon size={16} />
      <AccountAvatar key={user?.photoURL || 'initial'} user={user} size={28} />
      <span className="mobile-account-chevron" aria-hidden="true">▾</span>
    </button>
  );
}

/** First item of the phone menu: who is signed in and their role. */
export function MobileRoleStatus({ user, privileges }) {
  const tone = privileges?.isSuperadmin ? 'superadmin' : privileges?.isStaff ? 'staff' : 'member';
  return (
    <div className="mobile-role-status">
      <AccountAvatar key={user?.photoURL || 'initial'} user={user} size={40} />
      <div className="mobile-role-status-text">
        <span className="mobile-role-status-name">{accountName(user)}</span>
        {user?.email && <span className="mobile-role-status-email">{user.email}</span>}
      </div>
      <span className={`mobile-role-pill ${tone}`}>
        <span className="visually-hidden">Role: </span>
        {roleDisplayName(privileges?.role)}
      </span>
    </div>
  );
}
