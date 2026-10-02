import { Component, DestroyRef, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, exhaustMap, finalize, map, timer } from 'rxjs';
import { AuthService } from './auth.service';
import { LibraryClock } from './library-clock';
import { UnreadNotifications } from './unread-notifications';

@Component({
  selector: 'app-library-shell',
  imports: [DatePipe, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './library-shell.html',
  styleUrl: './library-shell.css',
})
export class LibraryShell {
  readonly auth = inject(AuthService);
  readonly unreadNotifications = inject(UnreadNotifications);
  readonly logout = output<void>();
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('timeDialog');
  private readonly clock = inject(LibraryClock);
  readonly now = this.clock.now;
  readonly clockError = this.clock.error;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly fields = [
    { key: 'year', label: 'Year', min: 1000, max: 9999 },
    { key: 'month', label: 'Month', min: 1, max: 12 },
    { key: 'day', label: 'Day', min: 1, max: 31 },
    { key: 'hour', label: 'Hour', min: 0, max: 23 },
    { key: 'minute', label: 'Minute', min: 0, max: 59 },
    { key: 'second', label: 'Second', min: 0, max: 59 },
  ];
  values: Record<string, number | null> = {};
  private baseTime = 0;
  private baseTick = 0;

  constructor() {
    this.now.set(null);
    this.clockError.set(false);
    timer(0, 30000).pipe(
      exhaustMap(() => this.retrieve().pipe(catchError(() => { this.clockError.set(true); return EMPTY; }))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(time => this.updateClock(time));
    const ticker = setInterval(() => {
      if (this.now() !== null) this.now.set(this.baseTime + performance.now() - this.baseTick);
    }, 1000);
    this.destroyRef.onDestroy(() => clearInterval(ticker));
  }

  private retrieve() {
    return this.http.post<{ current_time: string | { $date: string | { $numberLong: string } } }>('/api/time/retrieve', {}).pipe(
      map(response => {
        const raw = typeof response.current_time === 'string' ? response.current_time : response.current_time.$date;
        const time = typeof raw === 'string' ? Date.parse(raw) : Number(raw.$numberLong);
        if (!Number.isFinite(time)) throw new Error('Invalid server time');
        return time;
      }),
    );
  }

  private updateClock(time: number) {
    this.baseTime = time;
    this.baseTick = performance.now();
    this.now.set(time);
    this.clockError.set(false);
  }

  openTime() {
    if (this.auth.user()?.role !== 'Admin') return;
    this.error.set('');
    this.values = {};
    this.dialog().nativeElement.showModal();
    this.prefill();
  }

  prefill() {
    this.loading.set(true);
    this.error.set('');
    this.retrieve().pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))).subscribe({
      next: time => {
        this.updateClock(time);
        const local = new Date(time + 8 * 60 * 60 * 1000);
        this.values = { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds() };
      },
      error: () => this.error.set('Unable to retrieve the current time. Please try again.'),
    });
  }

  targetTime(): number | null {
    if (this.fields.some(field => {
      const value = this.values[field.key];
      return value == null || !Number.isInteger(value) || value < field.min || value > field.max;
    })) return null;
    const v = this.values as Record<string, number>;
    const date = new Date(Date.UTC(v['year'], v['month'] - 1, v['day'], v['hour'], v['minute'], v['second']));
    if (date.getUTCMonth() !== v['month'] - 1 || date.getUTCDate() !== v['day']) return null;
    return date.getTime() - 8 * 60 * 60 * 1000;
  }

  closeTime() { if (!this.saving()) this.dialog().nativeElement.close(); }
  cancelTime(event: Event) { if (this.saving()) event.preventDefault(); }

  saveTime() {
    if (this.auth.user()?.role !== 'Admin' || this.loading() || this.saving()) return;
    const target = this.targetTime();
    if (target === null) { this.error.set('Enter a valid date and whole-number time values.'); return; }
    if (this.now() !== null && target <= this.now()!) { this.error.set('Choose a time later than the current library time.'); return; }
    this.saving.set(true);
    this.error.set('');
    this.http.post('/api/time/set', { set_to: new Date(target).toISOString() }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.updateClock(target);
        this.dialog().nativeElement.close();
        this.retrieve().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: time => this.updateClock(time), error: () => this.clockError.set(true) });
      },
      error: (error: HttpErrorResponse) => this.error.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to set the time. Please try again.'),
    });
  }
}
