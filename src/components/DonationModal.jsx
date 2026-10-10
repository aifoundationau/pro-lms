import React, { useState } from 'react';
import { createCheckoutSession } from '../services/stripeService';

export default function DonationModal({ isOpen, onClose }) {
  const [selectedAmount, setSelectedAmount] = useState(52);
  const [customAmount, setCustomAmount] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorName, setDonorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const presetAmounts = [10, 25, 52, 100];
  const finalAmount = customAmount ? Math.max(1, Number(customAmount) || 1) : selectedAmount;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await createCheckoutSession({
        type: 'token_pool',
        amount: finalAmount,
        donorEmail,
        donorName
      });
    } catch (err) {
      setError(err?.message || 'Failed to initialize Stripe checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem'
    }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', borderRadius: '20px', maxWidth: '520px', width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🪙</span> Global Token Pool Fund
            </h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.88rem', color: '#94a3b8' }}>
              Contribute to our token pool for disadvantaged students around the world.
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ffffff',
            borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer',
            fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>×</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2',
              border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.88rem'
            }}>
              ⚠️ {error}
            </div>
          )}

          <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
            Select Contribution Amount (AUD)
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '14px' }}>
            {presetAmounts.map((amt) => {
              const isSelected = !customAmount && selectedAmount === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setSelectedAmount(amt); setCustomAmount(''); }}
                  style={{
                    padding: '10px 0', borderRadius: '10px', border: isSelected ? '2px solid #6366f1' : '1px solid #cbd5e1',
                    background: isSelected ? '#e0e7ff' : '#f8fafc', color: isSelected ? '#4338ca' : '#1e293b',
                    fontWeight: 700, fontSize: '1rem', cursor: 'pointer', transition: 'all 0.15s ease'
                  }}
                >
                  ${amt}
                </button>
              );
            })}
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: '6px' }}>
              Or enter custom amount ($AUD):
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 52"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                fontSize: '0.95rem', boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#334155', marginBottom: '6px', fontWeight: 500 }}>
              Your Name (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Sarah Jenkins"
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                fontSize: '0.95rem', boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#334155', marginBottom: '6px', fontWeight: 500 }}>
              Receipt Email (Optional)
            </label>
            <input
              type="email"
              placeholder="e.g. supporter@example.com"
              value={donorEmail}
              onChange={(e) => setDonorEmail(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                fontSize: '0.95rem', boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || finalAmount < 1}
            style={{
              width: '100%', padding: '14px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff', border: 'none', fontSize: '1rem', fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.4)'
            }}
          >
            {loading ? 'Connecting to Stripe...' : `Proceed to Stripe Checkout ($${finalAmount} AUD)`}
          </button>

          <p style={{ margin: '12px 0 0 0', textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8' }}>
            🔒 Powered by Stripe • Secure 256-bit SSL encrypted checkout
          </p>
        </form>
      </div>
    </div>
  );
}
