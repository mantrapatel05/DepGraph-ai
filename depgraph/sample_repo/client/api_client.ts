/**
 * API client for Auth Service.
 * Maps snake_case JSON keys → camelCase TypeScript properties.
 *
 * NOTE: There is an INTENTIONAL inconsistency here for demo purposes:
 *   - UserDTO.userEmail (correct camelCase)
 *   - UserResponse interface below uses user_email (snake_case) — this BREAKS
 */
import { UserDTO, SessionDTO } from './types';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ← This interface uses snake_case — intentionally inconsistent with UserDTO
export interface UserResponse {
    id: number;
    user_email: string;   // ← snake_case: matches backend JSON key exactly
    full_name: string | null;
    is_active: boolean;
}

export async function getUser(userId: number): Promise<UserDTO> {
    const response = await fetch(`${BASE_URL}/users/${userId}`);
    if (!response.ok) throw new Error(`Failed to fetch user ${userId}`);
    const data: UserResponse = await response.json();
    return {
        id: data.id,
        userEmail: data.user_email,    // ← transform: snake_to_camel (CONVENTION_MAP edge)
        fullName: data.full_name,
        isActive: data.is_active,
    };
}

export async function createUser(userEmail: string, fullName?: string): Promise<UserDTO> {
    const response = await fetch(`${BASE_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail, full_name: fullName }),
    });
    if (!response.ok) throw new Error('Failed to create user');
    const data: UserResponse = await response.json();
    return {
        id: data.id,
        userEmail: data.user_email,
        fullName: data.full_name,
        isActive: data.is_active,
    };
}

export async function listUsers(): Promise<UserDTO[]> {
    const response = await fetch(`${BASE_URL}/users`);
    if (!response.ok) throw new Error('Failed to list users');
    const data: UserResponse[] = await response.json();
    return data.map(u => ({
        id: u.id,
        userEmail: u.user_email,
        fullName: u.full_name,
        isActive: u.is_active,
    }));
}
