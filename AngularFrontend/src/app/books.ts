import { ColumnFilter, filterOptions, matchesFilter } from './column-filter';
import { TableSort, sortRows } from './table-sort';
import { Eligibility, EligibilityService, eligibilityKey } from './eligibility.service';
import { Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { finalize, forkJoin, switchMap, throwError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiId, readId } from './api-values';
import { AuthService } from './auth.service';
import { Book, BooksService } from './books.service';
import { Copies } from './copies';
import { CopyCounts } from './copy-counts';

@Component({
  selector: 'app-books',
  imports: [ColumnFilter, TableSort, RouterLink, FormsModule, DatePipe, Copies, CopyCounts],
  templateUrl: './books.html',
  styleUrl: './books.css',
})
export class Books {
  readonly auth = inject(AuthService);
  private readonly api = inject(BooksService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eligibilityApi = inject(EligibilityService);
  readonly eligibility = signal<Eligibility | null>(null);
  readonly eligibilityLoading = signal(false);
  readonly eligibilityError = signal('');
  reason(book: string, user = 'self') {
    const state = this.eligibility();
    if (!state) return 'Checking eligibility';
    const key = eligibilityKey(book, user);
    return state.borrowed.has(key) ? 'already borrowed' : state.reserved.has(key) ? 'already reserved' : '';
  }
  loadEligibility() {
    this.eligibility.set(null); this.eligibilityLoading.set(true); this.eligibilityError.set('');
    this.eligibilityApi.load(this.books().map(book => book._id), false).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.eligibilityLoading.set(false))).subscribe({
      next: state => this.eligibility.set(state),
      error: () => this.eligibilityError.set('Unable to check existing loans and reservations. Refresh before borrowing or reserving.'),
    });
  }
  readonly copyCounts = signal<Record<string, Record<string, number> | null>>({});
  readonly borrowing = signal<string | null>(null);
  readonly borrowError = signal('');
  readonly reserving = signal<string | null>(null);
  readonly reserveBook = signal<Book | null>(null);
  private readonly reserveDialog = viewChild<ElementRef<HTMLDialogElement>>('reserveDialog');
  openReserve(book: Book) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.reserving() || this.borrowing() || book.archivedAt || this.availability(book._id) !== 'waiting') return;
    if (this.auth.user()?.role === 'User' && this.reason(book._id)) return;
    this.borrowerId = '';
    if (this.auth.user()?.role === 'Admin') this.loadBorrowers(book);
    this.reserveBook.set(book);
    this.borrowError.set('');
    this.reserveDialog()?.nativeElement.showModal();
  }
  closeReserve() { if (!this.reserving()) this.reserveDialog()?.nativeElement.close(); }
  cancelReserve(event: Event) { if (this.reserving()) event.preventDefault(); }
  reserve(book: Book) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.reserving() || this.borrowing() || book.archivedAt || this.availability(book._id) !== 'waiting') return;
    const borrower = this.borrowers().find(user => user.id === this.borrowerId);
    if (this.auth.user()?.role === 'Admin' && (!borrower || this.loadingBorrowers() || this.borrowerError() || this.reason(book._id, borrower.id))) return;
    if (this.auth.user()?.role === 'User' && this.reason(book._id)) return;
    this.reserving.set(book._id);
    this.borrowError.set('');
    this.message.set('');
    this.http.post('/api/reservation/new', { book_id: book._id, ...(this.auth.user()?.role === 'Admin' ? { user_id: borrower!.id } : {}) }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => { this.reserving.set(null); this.reserveDialog()?.nativeElement.close(); if (this.auth.user()?.role === 'User') this.loadEligibility(); }),
    ).subscribe({
      next: () => this.message.set(this.auth.user()?.role === 'Admin' ? `Reserved "${book.title}" for ${borrower!.email}.` : `Reserved "${book.title}". View its status in My reservations.`),
      error: (error: HttpErrorResponse) => {
        this.borrowError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm the reservation. Check My reservations before retrying.');
        this.refreshCopyCounts(book._id);
      },
    });
  }
  readonly borrowers = signal<{ id: string; email: string; name?: string }[]>([]);
  readonly loadingBorrowers = signal(false);
  readonly borrowerError = signal('');
  borrowerId = '';
  loadBorrowers(book: Book) {
    if (this.loadingBorrowers()) return;
    this.loadingBorrowers.set(true); this.borrowerError.set(''); this.borrowers.set([]); this.borrowerId = '';
    this.eligibility.set(null);
    forkJoin({ users: this.http.get<{ _id: ApiId; email: string; name?: string; role: string }[]>('/api/users/retrieve'), state: this.eligibilityApi.load([book._id], true) }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loadingBorrowers.set(false)),
    ).subscribe({
      next: ({ users, state }) => {
        this.eligibility.set(state);
        if (!Array.isArray(users)) { this.borrowerError.set('Unable to load users: the server did not return a user list.'); return; }
        this.borrowers.set(users.filter(user => user.role === 'User').map(user => ({ id: readId(user._id), email: user.email, name: user.name })).sort((a, b) => a.email.localeCompare(b.email)));
      },
      error: () => this.borrowerError.set('Unable to load users. Please try again.'),
    });
  }
  readonly borrowBook = signal<Book | null>(null);
  private readonly borrowDialog = viewChild<ElementRef<HTMLDialogElement>>('borrowDialog');
  openBorrow(book: Book) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.borrowing() || book.archivedAt || this.availability(book._id) !== 'available') return;
    if (this.auth.user()?.role === 'User' && this.reason(book._id)) return;
    this.borrowerId = '';
    if (this.auth.user()?.role === 'Admin') this.loadBorrowers(book);
    this.borrowBook.set(book);
    this.borrowError.set('');
    this.borrowDialog()?.nativeElement.showModal();
  }
  closeBorrow() { if (!this.borrowing()) this.borrowDialog()?.nativeElement.close(); }
  cancelBorrow(event: Event) { if (this.borrowing()) event.preventDefault(); }
  setCopyCounts(id: string, counts: Record<string, number> | null) {
    this.copyCounts.update(current => ({ ...current, [id]: counts }));
  }
  availability(id: string) {
    const counts = this.copyCounts()[id];
    if (!counts) return '';
    if (counts['available'] > 0) return 'available';
    if (counts['onLoan'] > 0 || counts['reserved'] > 0) return 'waiting';
    return 'unavailable';
  }
  borrow(book: Book) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.borrowing() || book.archivedAt || this.availability(book._id) !== 'available') return;
    const borrower = this.borrowers().find(user => user.id === this.borrowerId);
    if (this.auth.user()?.role === 'Admin' && (!borrower || this.loadingBorrowers() || this.borrowerError() || this.reason(book._id, borrower.id))) return;
    if (this.auth.user()?.role === 'User' && this.reason(book._id)) return;
    this.borrowing.set(book._id);
    this.borrowError.set('');
    this.message.set('');
    this.http.post<{ _id: string | { $oid: string }; status: string }[]>('/api/copy/retrieve', { _id: book._id }).pipe(
      switchMap(copies => {
        const copy = copies.find(copy => copy.status === 'available');
        if (!copy) return throwError(() => new Error('No copies are available now. Please try again later.'));
        const id = typeof copy._id === 'string' ? copy._id : copy._id.$oid;
        return this.http.post('/api/copy/borrow', { copy_id: id, ...(this.auth.user()?.role === 'Admin' ? { user_id: borrower!.id } : {}) });
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.borrowing.set(null); this.borrowDialog()?.nativeElement.close(); this.refreshCopyCounts(book._id); if (this.auth.user()?.role === 'User') this.loadEligibility(); }),
    ).subscribe({
      next: () => this.message.set(this.auth.user()?.role === 'Admin' ? `Borrowed "${book.title}" for ${borrower!.email}. Please return it within 14 days.` : `You have borrowed "${book.title}". Please return it within 14 days.`),
      error: (error: unknown) => this.borrowError.set(error instanceof HttpErrorResponse
        ? (typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm borrowing. Check your loan status before retrying.')
        : error instanceof Error ? error.message : 'Unable to borrow this book.'),
    });
  }
  readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('bookDialog');
  readonly archiveDialog = viewChild<ElementRef<HTMLDialogElement>>('archiveDialog');
  readonly selectedBook = signal<Book | null>(null);
  readonly copiesBook = signal<Book | null>(null);
  readonly copyRevisions = signal<Record<string, number>>({});
  refreshCopyCounts(id: string) {
    this.copyCounts.update(counts => ({ ...counts, [id]: null }));
    this.copyRevisions.update(revisions => ({ ...revisions, [id]: (revisions[id] || 0) + 1 }));
  }
  readonly updatingArchive = signal(false);
  readonly archiveError = signal('');
  archiveChecked = false;
  readonly books = signal<Book[]>([]);

  readonly authorFilter = signal<string[] | null>(null);
  readonly topicFilter = signal<string[] | null>(null);
  readonly authorOptions = computed(() => filterOptions(this.books().flatMap(book => book?.authors ?? [])));
  readonly topicOptions = computed(() => filterOptions(this.books().flatMap(book => book?.topics ?? [])));
  readonly sortKey = signal('');
  readonly sortDirection = signal('asc');
  readonly visibleBooks = computed(() => {
    const books = this.books().filter(book => matchesFilter(book.authors, this.authorFilter()) && matchesFilter(book.topics, this.topicFilter()));
    return sortRows(books, this.sortKey(), this.sortDirection(), (book, key) => key === 'authors' ? book.authors : key === 'topics' ? book.topics : book.title);
  });

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly message = signal('');
  title = '';
  authors = '';
  topics = '';

  constructor() { this.load(); }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.api.retrieve().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: books => { this.books.set(this.auth.user()?.role === 'Admin' ? books : books.filter(book => book.archivedAt == null)); if (this.auth.user()?.role === 'User') this.loadEligibility(); },
      error: () => this.error.set('We could not load the books. Please try again.'),
    });
  }

  open() {
    if (this.auth.user()?.role !== 'Admin') return;
    this.title = this.authors = this.topics = '';
    this.saveError.set('');
    this.message.set('');
    this.dialog()?.nativeElement.showModal();
  }

  close() { if (!this.saving()) this.dialog()?.nativeElement.close(); }
  cancel(event: Event) { if (this.saving()) event.preventDefault(); }
  canArchive(book: Book) {
    const counts = this.copyCounts()[book._id];
    return counts != null && Object.entries(counts).every(([status, count]) => status === 'withdrawn' || count === 0);
  }
  openArchive(book: Book) {
    if (this.auth.user()?.role !== 'Admin' || !this.canArchive(book)) return;
    this.selectedBook.set(book);
    this.archiveChecked = book.archivedAt != null;
    this.archiveError.set('');
    this.message.set('');
    this.archiveDialog()?.nativeElement.showModal();
  }

  closeArchive() { if (!this.updatingArchive()) this.archiveDialog()?.nativeElement.close(); }
  cancelArchive(event: Event) { if (this.updatingArchive()) event.preventDefault(); }
  archiveChanged() { return this.archiveChecked !== (this.selectedBook()?.archivedAt != null); }

  saveArchive() {
    const book = this.selectedBook();
    if (!book || !this.archiveChanged() || this.updatingArchive() || this.auth.user()?.role !== 'Admin') return;
    const archived = this.archiveChecked;
    if (archived && !this.canArchive(book)) { this.archiveError.set('All copies must be withdrawn before archiving.'); return; }
    this.updatingArchive.set(true);
    this.archiveError.set('');
    this.api.setArchived(book._id, archived).pipe(finalize(() => this.updatingArchive.set(false))).subscribe({
      next: () => {
        this.archiveDialog()?.nativeElement.close();
        this.message.set(archived ? 'Book archived successfully.' : 'Book restored successfully.');
        this.load();
      },
      error: (error: HttpErrorResponse) => this.archiveError.set(
        typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm the status change. Please close this dialog and reload the page to check the current status.',
      ),
    });
  }
  entries(value: string) { return [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))]; }
  valid() { return !!this.title.trim() && this.entries(this.authors).length > 0 && this.entries(this.topics).length > 0; }

  save() {
    if (!this.valid() || this.saving() || this.auth.user()?.role !== 'Admin') return;
    this.saving.set(true);
    this.saveError.set('');
    this.api.add({ title: this.title.trim(), authors: this.entries(this.authors), topics: this.entries(this.topics) })
      .pipe(finalize(() => this.saving.set(false))).subscribe({
        next: () => {
          this.dialog()?.nativeElement.close();
          this.message.set('Book added successfully.');
          this.load();
        },
        error: (error: HttpErrorResponse) => this.saveError.set(
          error.status === 0 || error.status >= 500
            ? 'The server could not confirm the save. Close this form and refresh the list before retrying to avoid adding a duplicate.'
            : typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to add this book. Please try again.',
        ),
      });
  }
}
