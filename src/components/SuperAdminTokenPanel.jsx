import React, { useState, useEffect, useCallback } from 'react';
import {
  getTokenConfig,
  updateTokenPrice,
  getEligibleAccountsForRedistribution,
  redistributeTokensFromPool
} from '../services/tokenService';
import {
  listAllTeacherApplications,
  approveTeacherApplication,
  rejectTeacherApplication
} from '../services/teacherApplicationService';
import { ALLOWED_ROLES, listAllUsers, updateMemberRole, updateUserCharityStatus } from '../services/authService';

export default function SuperAdminTokenPanel({ currentUser, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('tokens'); // 'tokens' | 'redistribute' | 'teachers' | 'roles'
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState({ type: '', message: '' });

  // Token Config State
  const [tokenConfig, setTokenConfig] = useState({ token_price_aud: 1.00, pool_balance: 1560 });
  const [newTokenPrice, setNewTokenPrice] = useState('1.00');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);

  // Redistribution State
  const [eligibleAccounts, setEligibleAccounts] = useState([]);
  const [tokensPerAccount, setTokensPerAccount] = useState(26);
  const [isRedistributing, setIsRedistributing] = useState(false);

  // Teacher Applications State
  const [teacherApps, setTeacherApps] = useState([]);
  const [processingAppId, setProcessingAppId] = useState(null);

  // Role Management State
  const [allUsers, setAllUsers] = useState([]);
  const [updatingUid, setUpdatingUid] = useState(null);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [cfg, eligible, apps, users] = await Promise.all([
        getTokenConfig(),
        getEligibleAccountsForRedistribution(),
        listAllTeacherApplications(currentUser.uid),
        listAllUsers(currentUser.uid).catch(() => [])
      ]);

      if (cfg) {
        setTokenConfig(cfg);
        setNewTokenPrice(String(cfg.token_price_aud || 1.00));
      }
      setEligibleAccounts(eligible || []);
      setTeacherApps(apps || []);
      setAllUsers(users || []);
    } catch (err) {
      console.warn('Error loading admin panel data:', err);
      setNotice({ type: 'error', message: err?.message || 'Could not load complete admin data.' });
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Handler: Set Token Price
  const handleSaveTokenPrice = async (e) => {
    e.preventDefault();
    setIsUpdatingPrice(true);
    setNotice({ type: '', message: '' });
    try {
      const updated = await updateTokenPrice(currentUser.uid, newTokenPrice);
      setTokenConfig(prev => ({ ...prev, token_price_aud: updated }));
      setNotice({ type: 'success', message: `Token price updated to $${updated.toFixed(2)} AUD.` });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to update token price.' });
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  // Handler: Execute Redistribution
  const handleRedistribute = async () => {
    if (eligibleAccounts.length === 0) {
      alert('No accounts currently meet the criteria (< 26 tokens and active within past 90 days).');
      return;
    }
    const confirmMsg = `Redistribute tokens from the fund to ${eligibleAccounts.length} qualifying accounts?`;
    if (!window.confirm(confirmMsg)) return;

    setIsRedistributing(true);
    setNotice({ type: '', message: '' });
    try {
      const res = await redistributeTokensFromPool(currentUser.uid, {
        tokensPerAccount: Number(tokensPerAccount) || 26
      });
      setNotice({ type: 'success', message: res.message });
      // Reload updated balances
      loadData();
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Redistribution failed.' });
    } finally {
      setIsRedistributing(false);
    }
  };

  // Handler: Approve Teacher Application
  const handleApproveTeacher = async (app) => {
    setProcessingAppId(app.id);
    setNotice({ type: '', message: '' });
    try {
      await approveTeacherApplication(currentUser.uid, app.id, app.applicant_uid);
      setTeacherApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'approved' } : a));
      setNotice({ type: 'success', message: `Approved ${app.applicant_name} as Teacher! Role updated.` });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to approve application.' });
    } finally {
      setProcessingAppId(null);
    }
  };

  // Handler: Role Change
  const handleRoleChange = async (targetUid, newRole) => {
    setUpdatingUid(targetUid);
    setNotice({ type: '', message: '' });
    try {
      await updateMemberRole(currentUser.uid, targetUid, newRole);
      setAllUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, role: newRole } : u));
      setNotice({ type: 'success', message: `Updated user role to ${newRole}.` });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to update role.' });
    } finally {
      setUpdatingUid(null);
    }
  };

  // Handler: Toggle Charity Teacher Privileges (0-token copying)
  const handleCharityToggle = async (targetUid, currentStatus) => {
    setNotice({ type: '', message: '' });
    try {
      const nextStatus = !currentStatus;
      await updateUserCharityStatus(currentUser.uid, targetUid, nextStatus);
      setAllUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, isCharityTeacher: nextStatus } : u));
      setNotice({
        type: 'success',
        message: `${nextStatus ? '🎉 Granted Charity Pass (0 Tokens)' : 'Revoked Charity Pass'} for member.`
      });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to update charity status.' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem'
    }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', borderRadius: '20px', maxWidth: '900px', width: '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#fbbf24' }}>🛡️</span> Super Admin Control Panel
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Firebase Admin & System Governance • Token Economy, Fund Redistribution & Faculty Certification
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ffffff',
            borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer',
            fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>×</button>
        </div>

        {/* Navigation Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', padding: '0 1rem'
        }}>
          <button
            onClick={() => setActiveTab('tokens')}
            style={{
              padding: '12px 18px', border: 'none', background: 'none', fontWeight: 600, fontSize: '0.9rem',
              cursor: 'pointer', borderBottom: activeTab === 'tokens' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'tokens' ? '#4f46e5' : '#64748b'
            }}
          >
            🪙 Token Economy & Price
          </button>
          <button
            onClick={() => setActiveTab('redistribute')}
            style={{
              padding: '12px 18px', border: 'none', background: 'none', fontWeight: 600, fontSize: '0.9rem',
              cursor: 'pointer', borderBottom: activeTab === 'redistribute' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'redistribute' ? '#4f46e5' : '#64748b'
            }}
          >
            🔄 Fund Redistribution ({eligibleAccounts.length})
          </button>
          <button
            onClick={() => setActiveTab('teachers')}
            style={{
              padding: '12px 18px', border: 'none', background: 'none', fontWeight: 600, fontSize: '0.9rem',
              cursor: 'pointer', borderBottom: activeTab === 'teachers' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'teachers' ? '#4f46e5' : '#64748b'
            }}
          >
            📮 Teacher Postcards ({teacherApps.filter(a => a.status === 'pending').length} pending)
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            style={{
              padding: '12px 18px', border: 'none', background: 'none', fontWeight: 600, fontSize: '0.9rem',
              cursor: 'pointer', borderBottom: activeTab === 'roles' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'roles' ? '#4f46e5' : '#64748b'
            }}
          >
            👥 Member Roles ({allUsers.length})
          </button>
        </div>

        {/* Notice Alert */}
        {notice.message && (
          <div style={{
            margin: '1rem 1.5rem 0', padding: '10px 14px', borderRadius: '8px', fontSize: '0.88rem',
            background: notice.type === 'error' ? '#fef2f2' : '#f0fdf4',
            border: notice.type === 'error' ? '1px solid #fecaca' : '1px solid #bbf7d0',
            color: notice.type === 'error' ? '#b91c1c' : '#15803d'
          }}>
            {notice.type === 'error' ? '⚠️' : '✅'} {notice.message}
          </div>
        )}

        {/* Tab Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              Loading system metrics...
            </div>
          ) : (
            <>
              {/* TAB 1: TOKEN ECONOMY & PRICE SETTING */}
              {activeTab === 'tokens' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '1.5rem' }}>
                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Current Token Value</div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4f46e5', marginTop: '4px' }}>
                        ${Number(tokenConfig.token_price_aud || 1).toFixed(2)} AUD
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Per single token</div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Accumulated Fund Pool</div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                        {Number(tokenConfig.pool_balance || 0).toLocaleString()} 🪙
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Available to redistribute</div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Total Distributed to Date</div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
                        {Number(tokenConfig.total_redistributed_tokens || 0).toLocaleString()} 🪙
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Total educational grants</div>
                    </div>
                  </div>

                  {/* Set Token Value Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '14px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: '#0f172a' }}>
                      Set Token Value (Super Admin)
                    </h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#64748b' }}>
                      Define the statutory AUD valuation of 1 token across all Stripe checkouts and student disbursements.
                    </p>

                    <form onSubmit={handleSaveTokenPrice} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{ position: 'relative', width: '200px' }}>
                        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: 700 }}>
                          $
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={newTokenPrice}
                          onChange={(e) => setNewTokenPrice(e.target.value)}
                          style={{
                            width: '100%', padding: '10px 14px 10px 28px', borderRadius: '8px', border: '1px solid #cbd5e1',
                            fontSize: '1rem', fontWeight: 700, boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <span style={{ color: '#475569', fontWeight: 600, fontSize: '0.9rem' }}>AUD per token</span>
                      <button
                        type="submit"
                        disabled={isUpdatingPrice}
                        style={{
                          padding: '10px 20px', borderRadius: '8px', border: 'none',
                          background: '#4f46e5', color: '#ffffff', fontWeight: 700, cursor: 'pointer'
                        }}
                      >
                        {isUpdatingPrice ? 'Saving...' : 'Update Token Value'}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* TAB 2: REDISTRIBUTION ENGINE */}
              {activeTab === 'redistribute' && (
                <div>
                  <div style={{
                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem'
                  }}>
                    <h4 style={{ margin: '0 0 6px 0', color: '#0f172a' }}>
                      Autonomous Fund Redistribution Policy
                    </h4>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#64748b', lineHeight: '1.5' }}>
                      Transfers donated tokens from the accumulated fund pool to accounts that have a balance <strong>under 26 tokens</strong> and have logged on <strong>at least once in the past 90 days</strong>.
                    </p>
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Fund Pool Available:</span>
                        <strong style={{ marginLeft: '6px', color: '#4f46e5' }}>{tokenConfig.pool_balance} 🪙</strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Qualifying Accounts:</span>
                        <strong style={{ marginLeft: '6px', color: '#0f172a' }}>{eligibleAccounts.length}</strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Target Ceiling:</span>
                        <strong style={{ marginLeft: '6px', color: '#16a34a' }}>Top up to 26 🪙</strong>
                      </div>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155' }}>
                      Accounts Eligible for Token Grants
                    </div>
                    <button
                      onClick={handleRedistribute}
                      disabled={isRedistributing || eligibleAccounts.length === 0}
                      style={{
                        padding: '10px 20px', borderRadius: '8px', border: 'none',
                        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                        color: '#ffffff', fontWeight: 700, cursor: isRedistributing ? 'wait' : 'pointer',
                        opacity: eligibleAccounts.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '8px'
                      }}
                    >
                      {isRedistributing ? 'Disbursing Tokens...' : `Redistribute to ${eligibleAccounts.length} Accounts 🚀`}
                    </button>
                  </div>

                  {/* Table of Eligible Accounts */}
                  {eligibleAccounts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', background: '#f8fafc', borderRadius: '10px', color: '#64748b' }}>
                      ✅ All active accounts currently have 26 or more tokens, or no accounts logged in within 90 days.
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                        <thead style={{ background: '#f1f5f9', color: '#475569' }}>
                          <tr>
                            <th style={{ padding: '10px 14px' }}>User</th>
                            <th style={{ padding: '10px 14px' }}>Role</th>
                            <th style={{ padding: '10px 14px' }}>Balance</th>
                            <th style={{ padding: '10px 14px' }}>Tokens Needed</th>
                            <th style={{ padding: '10px 14px' }}>Last Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eligibleAccounts.map((account, idx) => (
                            <tr key={account.uid} style={{ borderTop: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                              <td style={{ padding: '10px 14px' }}>
                                <div style={{ fontWeight: 600, color: '#0f172a' }}>{account.displayName}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{account.email}</div>
                              </td>
                              <td style={{ padding: '10px 14px' }}>
                                <span style={{
                                  padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700,
                                  background: account.role === 'teacher' ? '#e0e7ff' : '#dcfce7',
                                  color: account.role === 'teacher' ? '#3730a3' : '#166534'
                                }}>
                                  {account.role}
                                </span>
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 700, color: '#dc2626' }}>
                                {account.token_balance} 🪙
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 700, color: '#16a34a' }}>
                                +{account.deficit} 🪙
                              </td>
                              <td style={{ padding: '10px 14px', color: '#64748b' }}>
                                {account.last_login_at ? new Date(account.last_login_at).toLocaleDateString() : 'Recent'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: TEACHER POSTCARD APPLICATIONS */}
              {activeTab === 'teachers' && (
                <div>
                  <h4 style={{ margin: '0 0 12px 0', color: '#0f172a' }}>
                    Submitted Teacher Postcard Applications ({teacherApps.length})
                  </h4>

                  {teacherApps.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', background: '#f8fafc', borderRadius: '10px', color: '#64748b' }}>
                      No teacher applications submitted yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {teacherApps.map(app => (
                        <div key={app.id} style={{
                          border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.25rem',
                          background: app.status === 'approved' ? '#f0fdf4' : '#ffffff',
                          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>
                                  {app.applicant_name}
                                </h4>
                                <span style={{
                                  padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
                                  background: app.status === 'approved' ? '#dcfce7' : '#fef3c7',
                                  color: app.status === 'approved' ? '#15803d' : '#b45309'
                                }}>
                                  {app.status}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{app.applicant_email}</div>
                            </div>

                            {app.status === 'pending' && (
                              <button
                                onClick={() => handleApproveTeacher(app)}
                                disabled={processingAppId === app.id}
                                style={{
                                  padding: '8px 16px', borderRadius: '8px', border: 'none',
                                  background: '#16a34a', color: '#ffffff', fontWeight: 700, cursor: 'pointer',
                                  fontSize: '0.88rem'
                                }}
                              >
                                {processingAppId === app.id ? 'Approving...' : 'Approve as Teacher ✅'}
                              </button>
                            )}
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.88rem', marginBottom: '12px' }}>
                            <div>
                              <div><strong>Specialty:</strong> {app.subject_specialty}</div>
                              <div><strong>Proposed Course:</strong> {app.proposed_course_title} (🪙 {app.proposed_token_rate} Tokens)</div>
                              <div style={{ marginTop: '6px', color: '#475569', fontSize: '0.82rem' }}>
                                "{app.teaching_bio}"
                              </div>
                            </div>

                            {/* AI Verification Box */}
                            {app.ai_id_verification && (
                              <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                                <div style={{ fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                                  🤖 AI ID Document Analysis:
                                </div>
                                <div><strong>Document:</strong> {app.ai_id_verification.document_type}</div>
                                <div><strong>ID Number:</strong> {app.ai_id_verification.id_number_masked}</div>
                                <div><strong>Confidence:</strong> {app.ai_id_verification.confidence_score}%</div>
                                <div><strong>Assessment:</strong> {app.ai_id_verification.authenticity_assessment}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: MEMBER ROLES */}
              {activeTab === 'roles' && (
                <div>
                  <h4 style={{ margin: '0 0 12px 0', color: '#0f172a' }}>
                    Member Classification & Roles Directory
                  </h4>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                      <thead style={{ background: '#f1f5f9', color: '#475569' }}>
                        <tr>
                          <th style={{ padding: '10px 14px' }}>Member</th>
                          <th style={{ padding: '10px 14px' }}>Current Role</th>
                          <th style={{ padding: '10px 14px' }}>Charity Pass (0 Tokens)</th>
                          <th style={{ padding: '10px 14px' }}>Token Balance</th>
                          <th style={{ padding: '10px 14px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allUsers.map(u => (
                          <tr key={u.uid} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{u.displayName || 'User'}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</div>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700,
                                background: u.role === 'Superadmin' ? '#fef3c7' : u.role === 'teacher' ? '#e0e7ff' : '#f1f5f9',
                                color: u.role === 'Superadmin' ? '#b45309' : u.role === 'teacher' ? '#3730a3' : '#475569'
                              }}>
                                {u.role || 'Supporter'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <button
                                type="button"
                                onClick={() => handleCharityToggle(u.uid, Boolean(u.isCharityTeacher))}
                                style={{
                                  padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                                  background: u.isCharityTeacher ? '#dcfce7' : '#f1f5f9',
                                  color: u.isCharityTeacher ? '#166534' : '#64748b',
                                  border: u.isCharityTeacher ? '1px solid #86efac' : '1px solid #cbd5e1'
                                }}
                                title="Toggle 0-token copying privileges for charity/NFP teachers"
                              >
                                {u.isCharityTeacher ? '🎉 Active (0 Tokens)' : 'Standard (1 Token)'}
                              </button>
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                              {u.token_balance || 0} 🪙
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <select
                                value={u.role || 'Supporter'}
                                onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                                disabled={updatingUid === u.uid}
                                style={{
                                  padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1',
                                  fontSize: '0.85rem'
                                }}
                              >
                                {ALLOWED_ROLES.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
