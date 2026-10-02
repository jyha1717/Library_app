import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { switchMap, tap } from 'rxjs';
import { TokenStore } from './token-store';

export interface User {
  _id?: string | { $oid: string };
  email: string;
  role?: 'User' | 'Admin';
  name?: string;
  interests?: string[];
  createdAt?: string | { $date: string | { $numberLong: string } };
}
interface LoginResponse { access_token: string; token_type: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);
  private readonly currentUser = signal<User | null>(null);
  readonly user = this.currentUser.asReadonly();

  hasToken(): boolean { return !!this.tokens.get(); }

  login(email: string, password: string) {
    return this.http.post<LoginResponse>('/api/users/login', { email, password }).pipe(
      tap(response => {
        if (!response.access_token || response.token_type?.toLowerCase() !== 'bearer') {
          throw new Error('Invalid login response');
        }
        this.tokens.set(response.access_token);
      }),
      switchMap(() => this.loadUser()),
    );
  }

  loadUser() {
    return this.http.get<User>('/api/users/me').pipe(
      tap(user => this.currentUser.set(user)),
    );
  }

  createUser(user: { email: string; password: string; name: string; interests: string[] }) {
    return this.http.post<User>('/api/users/create', user);
  }

  changePassword(password: string, newPassword: string) {
    return this.http.post('/api/users/change_password', { password, new_password: newPassword });
  }

  updateProfile(field: 'email' | 'name' | 'interests', value: string | string[]) {
    return this.http.post(`/api/users/change_${field}`, { [field]: value }).pipe(
      tap(() => this.currentUser.update(user => user ? { ...user, [field]: value } : user)),
    );
  }

  logout(): void {
    this.tokens.clear();
    this.currentUser.set(null);
  }
}
