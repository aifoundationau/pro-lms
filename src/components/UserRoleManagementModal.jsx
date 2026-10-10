import React, { useState, useEffect, useCallback } from 'react';
import { ALLOWED_ROLES, listAllUsers, updateMemberRole } from '../services/authService';

export default function UserRoleManagementModal({ currentUser, isOpen, onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [updatingUid, setUpdatingUid] = useState(null);

  const loadUsers = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const list = await listAllUsers(currentUser.uid);
      setUsers(list);
    } catch (err) {
      setError(err?.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isOpen && currentUser) {
      loadUsers();
    }
  }, [isOpen, currentUser, loadUsers]);

  const handleRoleChange = async (targetUid, newRole) => {
    setUpdatingUid(targetUid);
    setError('');
    setSuccessMsg('');
    try {
      await updateMemberRole(currentUser.uid, targetUid, newRole);
      setUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, role: newRole } : u));
      setSuccessMsg(`Role successfully updated to ${newRole}`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err?.message || 'Failed to update member role.');
    } finally {
      setUpdatingUid(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem'
    }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', borderRadius: '16px', maxWidth: '800px', width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#ffffff'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#fbbf24' }}>🛡️</span> Superadmin Member Role Management
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Manage permissions and classification across the LMS network
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ffffff',
            borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer',
            fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>×</button>
        </div>

        {/* Alerts */}
        {error && (
          <div style={{
            margin: '1rem 1.5rem 0', padding: '0.75rem 1rem', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.9rem'
          }}>
            ⚠️ {error}
          </div>
        )}
        {successMsg && (
          <div style={{
            margin: '1rem 1.5rem 0', padding: '0.75rem 1rem', background: '#f0fdf4',
            border: '1px solid #bbf7d0', borderRadius: '8px', color: '#15803d', fontSize: '0.9rem'
          }}>
            ✅ {successMsg}
          </div>
        )}

        {/* Content list */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#64748b' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>⏳</div>
              Loading member directory...
            </div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#64748b' }}>
              No registered users found in Firestore.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '10px 12px' }}>User</th>
                    <th style={{ padding: '10px 12px' }}>Email</th>
                    <th style={{ padding: '10px 12px' }}>Logins</th>
                    <th style={{ padding: '10px 12px' }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.uid} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {u.photoURL ? (
                          <img src={u.photoURL} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                        ) : (
                          <div style={{
                            width: '32px', height: '32px', borderRadius: '50%', background: '#6366f1',
                            color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 600, fontSize: '0.8rem'
                          }}>
                            {(u.displayName || u.email || 'U')[0].toUpperCase()}
                          </div>
                        )}
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{u.displayName || 'Unnamed User'}</span>
                      </td>
                      <td style={{ padding: '12px', color: '#64748b' }}>{u.email}</td>
                      <td style={{ padding: '12px', color: '#64748b' }}>{u.login_count || 1}</td>
                      <td style={{ padding: '12px' }}>
                        <select
                          value={u.role || 'Supporter'}
                          disabled={updatingUid === u.uid}
                          onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                          style={{
                            padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1',
                            fontSize: '0.85rem', background: '#f8fafc', fontWeight: 500,
                            color: u.role === 'Superadmin' ? '#b45309' : '#0f172a',
                            cursor: updatingUid === u.uid ? 'wait' : 'pointer'
                          }}
                        >
                          {ALLOWED_ROLES.map(role => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <button onClick={loadUsers} style={{
            background: 'none', border: '1px solid #cbd5e1', padding: '6px 14px',
            borderRadius: '6px', fontSize: '0.85rem', color: '#475569', cursor: 'pointer'
          }}>
            ↻ Refresh Directory
          </button>
          <button onClick={onClose} style={{
            background: '#1e293b', border: 'none', color: '#ffffff', padding: '8px 18px',
            borderRadius: '6px', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer'
          }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
