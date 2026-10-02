import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly key = 'data4life.accessToken';
  get(): string | null { return sessionStorage.getItem(this.key); }
  set(token: string): void { sessionStorage.setItem(this.key, token); }
  clear(): void { sessionStorage.removeItem(this.key); }
}
