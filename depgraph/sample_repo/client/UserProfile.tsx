/**
 * UserProfile React component.
 *
 * ⚠ CRITICAL DEPENDENCY: This component renders user.userEmail at lines 21 and 34.
 * If user_email is renamed in schema.sql without updating TypeScript interfaces,
 * user.userEmail becomes undefined. React renders undefined as blank — NO ERROR THROWN.
 * This is the bug DepGraph.ai catches.
 */
import React from 'react';
import { UserDTO } from './types';

interface UserProfileProps {
    user: UserDTO;
    onEdit?: (userId: number) => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ user, onEdit }) => {
    return (
        <div className="user-profile">
            <div className="user-header">
                <h2 className="user-name">{user.fullName || 'Unknown User'}</h2>
                <p className="user-email">{user.userEmail}</p>  {/* ← line 21: BREAKS if user_email renamed */}
            </div>
            <div className="user-meta">
                <span className="user-id">ID: {user.id}</span>
                <span className={`user-status ${user.isActive ? 'active' : 'inactive'}`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                </span>
            </div>
            {onEdit && (
                <button onClick={() => onEdit(user.id)} className="edit-btn">
                    Edit Profile
                </button>
            )}
        </div>
    );
};

export const UserCard: React.FC<{ user: UserDTO }> = ({ user }) => {
    return (
        <div className="card user-card">
            <div className="card-header">
                <span className="card-email">{user.userEmail}</span>  {/* ← line 34: BREAKS if user_email renamed */}
                {user.isActive && <span className="badge-active">●</span>}
            </div>
            <div className="card-body">
                <p className="card-name">{user.fullName}</p>
                <small className="card-id">User #{user.id}</small>
            </div>
        </div>
    );
};

export const UserList: React.FC<{ users: UserDTO[] }> = ({ users }) => {
    if (!users.length) return <div className="empty">No users found</div>;
    return (
        <div className="user-list">
            {users.map(u => (
                <UserCard key={u.id} user={u} />
            ))}
        </div>
    );
};

export default UserProfile;
