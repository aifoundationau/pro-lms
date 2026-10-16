import React from 'react';

/**
 * "Token Fund" modal: Donate to the Emergency Token Fund for disadvantaged students.
 */
export default function TokenFundModal({ isOpen, onClose, onOpenDonation }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass modal-content animate-fade-in-up"
        style={{ maxWidth: '520px', textAlign: 'center', padding: '36px 32px' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-fund-title"
      >
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>💛</div>
        <h2 id="token-fund-title" style={{ marginBottom: '12px' }}>Emergency Token Fund</h2>
        <p style={{ color: 'var(--text-secondary)', margin: '0 auto 28px auto', fontSize: '1.05rem', lineHeight: 1.6, maxWidth: '440px' }}>
          Contribute to our token pool for disadvantaged students around the world.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="nav-btn primary"
            style={{ padding: '12px 28px', fontSize: '1.05rem', fontWeight: 600 }}
            onClick={onOpenDonation}
          >
            Donate to Token Fund
          </button>
        </div>
      </div>
    </div>
  );
}

