import { UnreadNotifications } from './unread-notifications';
import { UserLookupService } from './user-lookup.service';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiId, ApiDate, readId, readDate } from './api-values';

interface ApiNotification { userId?: ApiId; userEmail?: string; _id: ApiId; title: string; content: string; createdAt: ApiDate; readAt: ApiDate; }
const normalize = (item: ApiNotification) => ({ ...item, _id: readId(item._id), createdAt: readDate(item.createdAt), readAt: readDate(item.readAt) });
type Notification = ReturnType<typeof normalize>;

@Component({
  selector: 'app-notifications', imports: [DatePipe], styleUrl: './books.css',
  template: `
    <section aria-labelledby="notifications-title">
      <div class="heading"><div><p class="eyebrow">YOUR LIBRARY</p><h1 id="notifications-title">{{ isAdmin() ? 'All notifications' : 'Notifications' }}</h1><p class="intro">{{ isAdmin() ? 'Notifications across the library.' : 'Updates about your reservations and fines.' }}</p></div><button class="secondary" (click)="load()" [disabled]="loading() || !!reading()">Refresh</button></div>
      @if (actionError()) { <p class="error" role="alert">{{ actionError() }}</p> }
      @if (loading()) { <p class="notice" role="status">Loading notifications...</p> }
      @else if (error()) { <div class="notice"><p role="alert">{{ error() }}</p><button class="secondary" (click)="load()">Retry</button></div> }
      @else if (!rows().length) { <div class="notice"><h2>No notifications yet</h2></div> }
      @else {
        <div class="table-container" role="region" aria-label="Notifications" tabindex="0"><table>
          <thead><tr><th scope="col">Title</th><th scope="col">Message</th><th scope="col">Created at (SGT)</th><th scope="col">Status</th>@if (isAdmin()) { <th scope="col">User email</th> }<th scope="col">Actions</th></tr></thead>
          <tbody>@for (row of rows(); track row._id) {
            <tr [class.notification-read]="row.readAt !== null"><th scope="row">{{ row.title }}</th><td>{{ row.content }}</td><td class="archive-date">{{ row.createdAt | date:'dd MMM yyyy, HH:mm':'+0800' }}</td><td>{{ row.readAt === null ? 'Unread' : 'Read' }}</td>@if (isAdmin()) { <td class="owner-email">{{ row.userEmail || 'Email unavailable' }}</td> }<td>
              @if (row.readAt === null) { <button class="secondary" (click)="markRead(row)" [disabled]="!!reading() || (isAdmin() && !row.userId)">{{ reading() === row._id ? 'Marking...' : 'Mark as read' }}</button> }
            </td></tr>
          }</tbody>
        </table></div>
      }
    </section>
  `,
})
export class Notifications {
  private readonly unreadNotifications = inject(UnreadNotifications);
  private readonly auth = inject(AuthService);
  readonly isAdmin = () => this.auth.user()?.role === 'Admin';
  private readonly users = inject(UserLookupService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly rows = signal<Notification[]>([]);
  readonly loading = signal(false);
  readonly reading = signal<string | null>(null);
  readonly error = signal('');
  readonly actionError = signal('');
  constructor() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '')) { void this.router.navigateByUrl('/books'); return; }
    this.load();
  }
  load() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.loading()) return;
    this.loading.set(true); this.error.set('');
    this.http.get<ApiNotification[]>(this.isAdmin() ? '/api/notification/retrieve_all' : '/api/notification/retrieve').pipe(
      switchMap(items => this.isAdmin() ? this.users.withEmails(items) : of(items)),
      map(items => items.map(normalize).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))),
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)),
    ).subscribe({ next: rows => this.rows.set(rows), error: () => this.error.set('Unable to load notifications. Please try again.') });
  }
  markRead(row: Notification) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !row.userId) || this.reading() || row.readAt !== null) return;
    this.reading.set(row._id); this.actionError.set('');
    this.http.post<ApiNotification>('/api/notification/read', { notification_id: row._id, ...(this.isAdmin() ? { user_id: readId(row.userId!) } : {}) }).pipe(
      map(normalize), takeUntilDestroyed(this.destroyRef), finalize(() => this.reading.set(null)),
    ).subscribe({
      next: updated => {
        this.rows.update(rows => rows.map(item => item._id === row._id ? { ...updated, userEmail: item.userEmail } : item));
        if (!this.isAdmin()) this.unreadNotifications.markRead(row._id);
      },
      error: (error: HttpErrorResponse) => this.actionError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to mark the notification as read. Refresh before retrying.'),
    });
  }
}
