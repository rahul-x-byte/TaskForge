import React, { useEffect, useState } from 'react';
import { fetchAdminUsers, createAdminUser, updateAdminUserRole, deleteAdminUser, UserItem } from '../api';
import { UserPlus, Trash2, AlertCircle, CheckCircle, X } from 'lucide-react';

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load users list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setCreating(true);

    try {
      await createAdminUser({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      });

      setSuccessMsg(`User ${newEmail} created successfully as ${newRole}!`);
      setShowCreateModal(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      await loadUsers();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create user account');
    } finally {
      setCreating(false);
    }
  };

  const handleRoleToggle = async (user: UserItem) => {
    const targetRole = user.role === 'admin' ? 'user' : 'admin';
    setError(null);
    setSuccessMsg(null);

    try {
      await updateAdminUserRole(user.id, targetRole);
      setSuccessMsg(`Updated ${user.email}'s role to ${targetRole}.`);
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to update user role');
    }
  };

  const handleDeleteUser = async (user: UserItem) => {
    if (!window.confirm(`Are you sure you want to delete user account "${user.name}" (${user.email})? This action cannot be undone.`)) {
      return;
    }

    setError(null);
    setSuccessMsg(null);

    try {
      await deleteAdminUser(user.id);
      setSuccessMsg(`User ${user.email} deleted successfully.`);
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
        Loading Registered Users Directory...
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
            User Management Directory
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            Manage platform users, roles, and administrative permissions.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#059669',
            color: '#ffffff',
            padding: '10px 16px',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          <UserPlus size={18} />
          <span>Add New User</span>
        </button>
      </div>

      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
          padding: '10px 14px',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.85rem',
        }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(52, 211, 153, 0.15)',
          border: '1px solid #34d399',
          color: '#6ee7b7',
          padding: '10px 14px',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.85rem',
        }}>
          <CheckCircle size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Users Table */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', color: '#f8fafc' }}>
          <thead>
            <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.05em' }}>
              <th style={{ padding: '12px 16px' }}>User</th>
              <th style={{ padding: '12px 16px' }}>Role</th>
              <th style={{ padding: '12px 16px' }}>Workflows</th>
              <th style={{ padding: '12px 16px' }}>Runs</th>
              <th style={{ padding: '12px 16px' }}>Created At</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{u.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{u.email}</div>
                </td>

                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '9999px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: u.role === 'admin' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: u.role === 'admin' ? '#c084fc' : '#38bdf8',
                    border: `1px solid ${u.role === 'admin' ? '#a855f7' : '#0284c7'}`,
                  }}>
                    {u.role}
                  </span>
                </td>

                <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>
                  {u.workflow_count ?? 0}
                </td>

                <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>
                  {u.run_count ?? 0}
                </td>

                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '0.75rem' }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>

                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      onClick={() => handleRoleToggle(u)}
                      style={{
                        background: '#334155',
                        color: '#f8fafc',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title={`Change role to ${u.role === 'admin' ? 'user' : 'admin'}`}
                    >
                      Toggle Role
                    </button>

                    <button
                      onClick={() => handleDeleteUser(u)}
                      style={{
                        background: '#dc2626',
                        color: '#ffffff',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Delete User"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: Create User */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '420px',
            padding: '1.5rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f8fafc', fontWeight: 700 }}>Add New User Account</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {modalError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="John Doe"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="john@example.com"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>Initial Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>User Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem' }}
                >
                  <option value="user">User (Normal Account)</option>
                  <option value="admin">Admin (Full System Permissions)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{ flex: 1, padding: '10px', background: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{ flex: 1, padding: '10px', background: '#059669', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}
                >
                  {creating ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
