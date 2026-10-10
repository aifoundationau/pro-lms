import React, { useState, useEffect } from 'react';
import { createCheckoutSession } from '../services/stripeService';
import { getTokenConfig } from '../services/tokenService';

export default function DonationModal({ isOpen, onClose, currentUser = null }) {
  const [tokenConfig, setTokenConfig] = useState({ token_price_aud: 1.00, pool_balance: 1560 });
  const [selectedTokens, setSelectedTokens] = useState(50);
  const [customTokens, setCustomTokens] = useState('');
  const [purchaseType, setPurchaseType] = useState('token_pool'); // 'token_pool' | 'token_purchase'
  const [donorEmail, setDonorEmail] = useState('');
  const [donorName, setDonorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      getTokenConfig().then(cfg => {
        if (cfg) setTokenConfig(cfg);
      }).catch(err => console.warn('Could not load token config:', err));
    }
  }, [isOpen]);

  useEffect(() => {
    if (currentUser?.email) {
      setDonorEmail(currentUser.email);
    }
    if (currentUser?.displayName) {
      setDonorName(currentUser.displayName);
    }
  }, [currentUser]);

  if (!isOpen) return null;

  const presetTokenAmounts = [50, 100, 250, 500];
  const tokenPrice = tokenConfig.token_price_aud || 1.00;

  const finalTokens = customTokens
    ? Math.max(50, Math.floor(Number(customTokens) || 50))
    : selectedTokens;

  const totalCostAud = (finalTokens * tokenPrice).toFixed(2);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (finalTokens < 50) {
      setError('Minimum purchase is 50 tokens. There is no upper limit.');
      setLoading(false);
      return;
    }

    try {
      await createCheckoutSession({
        type: purchaseType,
        tokens: finalTokens,
        tokenPriceAud: tokenPrice,
        donorEmail: donorEmail.trim(),
        donorName: donorName.trim(),
        targetUid: purchaseType === 'token_purchase' && currentUser?.uid ? currentUser.uid : ''
      });
    } catch (err) {
      setError(err?.message || 'Failed to initialize Stripe checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem'
    }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', borderRadius: '20px', maxWidth: '540px', width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)', overflow: 'hidden', border: '1px solid #e2e8f0'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '1.4rem' }}>🪙</span>
              <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>
                OzEdu Token Economy
              </h3>
              <span style={{
                background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #f59e0b',
                color: '#fbbf24', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 600
              }}>
                ${tokenPrice.toFixed(2)} AUD / Token
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Minimum purchase is 50 tokens with no upper limit. Donated tokens fund students and teachers in need.
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ffffff',
            borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer',
            fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>×</button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2',
              border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.88rem'
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Destination Selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
              Where should these tokens go?
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setPurchaseType('token_pool')}
                style={{
                  padding: '10px 12px', borderRadius: '10px',
                  border: purchaseType === 'token_pool' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                  background: purchaseType === 'token_pool' ? '#eef2ff' : '#f8fafc',
                  color: purchaseType === 'token_pool' ? '#4338ca' : '#475569',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>🌍 Accumulated Fund</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Donated for global redistribution</div>
              </button>

              <button
                type="button"
                onClick={() => setPurchaseType('token_purchase')}
                style={{
                  padding: '10px 12px', borderRadius: '10px',
                  border: purchaseType === 'token_purchase' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                  background: purchaseType === 'token_purchase' ? '#eef2ff' : '#f8fafc',
                  color: purchaseType === 'token_purchase' ? '#4338ca' : '#475569',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>👤 My Account Balance</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Credit to {currentUser ? 'your account' : 'active login'}</div>
              </button>
            </div>
          </div>

          {/* Token Amount Presets */}
          <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
            Select Token Quantity (Minimum 50 tokens)
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '12px' }}>
            {presetTokenAmounts.map((amt) => {
              const isSelected = !customTokens && selectedTokens === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setSelectedTokens(amt); setCustomTokens(''); }}
                  style={{
                    padding: '10px 0', borderRadius: '10px',
                    border: isSelected ? '2px solid #6366f1' : '1px solid #cbd5e1',
                    background: isSelected ? '#e0e7ff' : '#f8fafc',
                    color: isSelected ? '#4338ca' : '#1e293b',
                    fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer'
                  }}
                >
                  {amt} 🪙
                </button>
              );
            })}
          </div>

          {/* Custom Token Input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', color: '#64748b', marginBottom: '4px' }}>
              Or enter custom token amount (no limit, min 50):
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                min="50"
                step="1"
                placeholder="e.g. 75, 200, 1000..."
                value={customTokens}
                onChange={(e) => setCustomTokens(e.target.value)}
                style={{
                  width: '100%', padding: '10px 45px 10px 14px', borderRadius: '8px',
                  border: '1px solid #cbd5e1', fontSize: '0.95rem', boxSizing: 'border-box'
                }}
              />
              <span style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                color: '#64748b', fontWeight: 600, fontSize: '0.85rem'
              }}>
                Tokens
              </span>
            </div>
          </div>

          {/* Summary Callout */}
          <div style={{
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px',
            padding: '12px 14px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Investment:</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                ${totalCostAud} AUD
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Tokens to be credited:</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#4338ca' }}>
                {finalTokens.toLocaleString()} 🪙
              </div>
            </div>
          </div>

          {/* Contact Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#334155', marginBottom: '4px', fontWeight: 500 }}>
                Your Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Alex Taylor"
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: '6px',
                  border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#334155', marginBottom: '4px', fontWeight: 500 }}>
                Receipt Email (Optional)
              </label>
              <input
                type="email"
                placeholder="supporter@example.com"
                value={donorEmail}
                onChange={(e) => setDonorEmail(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: '6px',
                  border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || finalTokens < 50}
            style={{
              width: '100%', padding: '14px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff', border: 'none', fontSize: '1rem', fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.4)'
            }}
          >
            {loading ? 'Connecting to Stripe...' : `Checkout via Stripe (${finalTokens} Tokens • $${totalCostAud} AUD)`}
          </button>

          <p style={{ margin: '10px 0 0 0', textAlign: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>
            🔒 Powered by Stripe • Minimum 50 tokens • 256-bit encrypted checkout
          </p>
        </form>
      </div>
    </div>
  );
}
