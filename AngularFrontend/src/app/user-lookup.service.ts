import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, of } from 'rxjs';
import { ApiId, readId } from './api-values';

@Injectable({ providedIn: 'root' })
export class UserLookupService {
  private readonly http = inject(HttpClient);

  withEmails<T extends { userId?: ApiId }>(items: T[]) {
    const ids = [...new Set(items.map(item => readId(item.userId ?? '')).filter(Boolean))];
    const requests = ids.map(id => this.http.post<{ email: string }>('/api/users/lookup', { user_id: id }).pipe(
      map(user => [id, user.email] as const),
      // An unavailable/deleted user must not hide the other library records.
      catchError(() => of([id, undefined] as const)),
    ));
    return (requests.length ? forkJoin(requests) : of([])).pipe(map(users => {
      const emails = new Map<string, string | undefined>(users);
      return items.map(item => ({ ...item, userEmail: emails.get(readId(item.userId ?? '')) }));
    }));
  }
}
