import React, { useState } from 'react';
import { createCheckoutSession } from '../services/stripeService';

const EMAIL = /^[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-z]{2,}$/i;

/**
 * "Token Fund" (signed-in users): sponsor a specific student's year of access, or donate to
 * the Emergency Token Fund for disadvantaged students.
 */
export default function TokenFundModal({ isOpen, onClose, currentUser, onOpenDonation }) {
  const [studentEmail, setStudentEmail] = useState('');
  const [isFunding, setIsFunding] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSponsor = async (e) => {
    e.preventDefault();
    const email = studentEmail.trim();
    if (!EMAIL.test(email)) {
      setError("Enter the student's email address to fund their account.");
      return;
    }
    setError('');
    setIsFunding(true);
    try {
      await createCheckoutSession({
        type: 'student_sponsorship',
        amount: 52,
        studentEmail: email,
        donorEmail: currentUser?.email || ''
      });
      // Stripe redirects the page; nothing else to do here.
    } catch (err) {
      setError(err?.message || 'Failed to start the Stripe checkout. Please try again.');
      setIsFunding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !isFunding && onClose()}>
      <div
        className="glass modal-content animate-fade-in-up"
        style={{ maxWidth: '860px' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-fund-title"
      >
        <button className="close-btn" onClick={onClose} disabled={isFunding} aria-label="Close">✕</button>
        <h2 id="token-fund-title" style={{ marginBottom: '8px' }}>💛 Token Fund</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', margin: '0 0 22px 0' }}>
          Help a student learn: sponsor someone you know, or give to the emergency fund.
        </p>

        {error && (
          <div role="alert" style={{
            background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(248, 113, 113, 0.5)', color: '#fecaca',
            padding: '10px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '0.9rem'
          }}>
            ⚠️ {error}
          </div>
        )}

        <div className="twin-panels" style={{ marginBottom: 0 }}>
          <div className="glass twin-panel">
            <h3>Sponsor a Student</h3>
            <p>Donate to fund a specific student's access for a year.</p>
            <form onSubmit={handleSponsor} className="input-group">
              <input
                type="email"
                placeholder="Student's Email Address"
                className="email-input"
                value={studentEmail}
                onChange={e => setStudentEmail(e.target.value)}
                aria-label="Student's email address"
                required
              />
              <button type="submit" className="nav-btn primary" disabled={isFunding}>
                {isFunding ? 'Connecting...' : 'Fund Account'}
              </button>
            </form>
          </div>
          <div className="glass twin-panel">
            <h3>Emergency Token Fund</h3>
            <p>Contribute to our token pool for disadvantaged students around the world.</p>
            <button className="nav-btn primary" onClick={onOpenDonation} disabled={isFunding}>
              Donate to Token Fund
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
