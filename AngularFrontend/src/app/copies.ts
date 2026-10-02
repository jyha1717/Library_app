import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Book } from './books.service';

type Id = string | { $oid: string };
type ApiDate = string | { $date: string | { $numberLong: string } };
interface ApiCopy { _id: Id; bookId: Id; status: string; createdAt: ApiDate; }
interface Copy { _id: string; status: string; createdAt: string; }

@Component({
  selector: 'app-copies',
  imports: [FormsModule, DatePipe],
  templateUrl: './copies.html',
  styleUrls: ['./books.css', './copies.css'],
})
export class Copies {
  readonly book = input.required<Book>();
  readonly closed = output<void>();
  readonly refreshed = output<void>();
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('copiesDialog');
  readonly copies = signal<Copy[]>([]);
  readonly statuses = computed(() => this.auth.user()?.role === 'Admin'
    ? ['available', 'onLoan', 'reserved', 'withdrawn'] : ['available', 'onLoan', 'reserved']);
  readonly visibleCopies = computed(() => this.copies().filter(copy => this.statuses().includes(copy.status)));
  readonly breakdown = computed(() => this.statuses().map(status => ({
    status, label: this.statusLabel(status), count: this.copies().filter(copy => copy.status === status).length,
  })));
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly updatingCopy = signal<string | null>(null);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly message = signal('');
  count: number | null = 1;

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      this.load();
    });
  }

  close() { if (!this.saving() && !this.updatingCopy()) this.dialog().nativeElement.close(); }
  cancel(event: Event) { if (this.saving() || this.updatingCopy()) event.preventDefault(); }
  validCount() { return typeof this.count === 'number' && Number.isSafeInteger(this.count) && this.count > 0; }
  statusLabel(status: string) { return status === 'onLoan' ? 'On loan' : status.charAt(0).toUpperCase() + status.slice(1); }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.http.post<ApiCopy[]>('/api/copy/retrieve', { _id: this.book()._id }).pipe(
      map(copies => copies.map(copy => {
        const date = typeof copy.createdAt === 'string' ? copy.createdAt : copy.createdAt.$date;
        return { _id: typeof copy._id === 'string' ? copy._id : copy._id.$oid, status: copy.status,
          createdAt: typeof date === 'string' ? date : new Date(Number(date.$numberLong)).toISOString() };
      })),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({ next: copies => { this.copies.set(copies); this.refreshed.emit(); }, error: () => this.error.set('Unable to load copies. Please try again.') });
  }

  changeStatus(copy: Copy, reactivate = false) {
    if (this.auth.user()?.role !== 'Admin' || this.book().archivedAt || copy.status !== (reactivate ? 'withdrawn' : 'available') || this.updatingCopy() || this.saving() || this.loading()) return;
    this.updatingCopy.set(copy._id); this.saveError.set(''); this.message.set('');
    this.http.post(reactivate ? '/api/copy/reactivate' : '/api/copy/withdraw', { copy_id: copy._id }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.updatingCopy.set(null)),
    ).subscribe({
      next: () => {
        this.message.set(reactivate ? 'Copy reactivated successfully.' : 'Copy withdrawn successfully.');
        this.refreshed.emit();
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saveError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm the copy status change. Refresh copies before retrying.');
        this.refreshed.emit();
        this.load();
      },
    });
  }

  add() {
    if (this.auth.user()?.role !== 'Admin' || this.book().archivedAt || !this.validCount() || this.saving() || this.updatingCopy() || this.loading()) return;
    const count = this.count!;
    this.saving.set(true);
    this.saveError.set('');
    this.message.set('');
    this.http.post<unknown>('/api/copy/add', { _id: this.book()._id, count }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.message.set(`${count} ${count === 1 ? 'copy' : 'copies'} added successfully.`);
        this.count = 1;
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saveError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'The server could not confirm the addition. Refresh the copies before retrying; some copies may already have been saved.');
      },
    });
  }
}
