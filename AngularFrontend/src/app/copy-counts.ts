import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-copy-counts',
  template: `
    @if (loading()) { <span class="muted">Loading...</span> }
    @else if (failed()) { <button type="button" (click)="retry.update(increment)">Retry counts</button> }
    @else {
      <dl aria-label="Copy counts">
        @for (status of statuses(); track status.key) {
          <div [attr.data-status]="status.key"><dt>{{ status.label }}</dt><dd>{{ counts()[status.key] || 0 }}</dd></div>
        }
      </dl>
    }
  `,
  styles: `
    :host { display: block; min-width: 155px; }
    dl { margin: 0; display: grid; gap: 6px; }
    dl div { display: flex; justify-content: space-between; gap: 18px; }
    dt { color: #547463; font-size: 12px; } dd { margin: 0; font-weight: 600; font-size: 13px; }
    .muted { color: #68716a; font-size: 12px; }
    button { background: transparent; border: 1px solid #b9c8bb; border-radius: 6px; padding: 7px 10px; color: #214f41; cursor: pointer; }
  `,
})
export class CopyCounts {
  readonly bookId = input.required<string>();
  readonly revision = input(0);
  readonly updated = output<Record<string, number> | null>();
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly counts = signal<Record<string, number>>({});
  readonly retry = signal(0);
  readonly increment = (value: number) => value + 1;
  readonly statuses = computed(() => [
    { key: 'available', label: 'Available' }, { key: 'onLoan', label: 'On loan' },
    { key: 'reserved', label: 'Reserved' },
    ...(this.auth.user()?.role === 'Admin' ? [{ key: 'withdrawn', label: 'Withdrawn' }] : []),
  ]);

  constructor() {
    effect(onCleanup => {
      this.revision();
      this.retry();
      this.loading.set(true);
      this.failed.set(false);
      this.updated.emit(null);
      const subscription = this.http.post<{ status: string }[]>('/api/copy/retrieve', { _id: this.bookId() }).subscribe({
        next: copies => {
          const counts: Record<string, number> = {};
          for (const copy of copies) counts[copy.status] = (counts[copy.status] || 0) + 1;
          this.counts.set(counts);
          this.updated.emit(counts);
          this.loading.set(false);
        },
        error: () => { this.failed.set(true); this.loading.set(false); },
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }
}
