import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, EMPTY, merge, Subject, switchMap, timer } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiId, readId } from './api-values';

@Injectable({ providedIn: 'root' })
export class UnreadNotifications {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly refreshRequested = new Subject<void>();
  private readonly unread = signal<Set<string>>(new Set());
  readonly count = computed(() => this.unread().size);

  constructor() {
    effect(onCleanup => {
      const user = this.auth.user();
      this.unread.set(new Set());
      if (user?.role !== 'User') return;
      const subscription = merge(timer(0, 10000), this.refreshRequested).pipe(
        switchMap(() => this.http.get<{ _id: ApiId; readAt?: unknown }[]>('/api/notification/retrieve').pipe(
          catchError(() => EMPTY),
        )),
      ).subscribe(items => this.unread.set(new Set(items.filter(item => item.readAt == null).map(item => readId(item._id)))));
      onCleanup(() => subscription.unsubscribe());
    });
  }

  markRead(id: string) {
    this.unread.update(current => { const next = new Set(current); next.delete(id); return next; });
    // Cancel any older poll so it cannot restore a stale unread count.
    this.refreshRequested.next();
  }
}
