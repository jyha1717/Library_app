import { ColumnFilter, filterOptions, matchesFilter } from './column-filter';
import { TableSort, sortRows } from './table-sort';
import { UserLookupService } from './user-lookup.service';
import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { Book, BooksService } from './books.service';
import { LibraryClock } from './library-clock';

type Id = string | { $oid: string };
type ApiDate = string | { $date: string | { $numberLong: string } } | null;
interface Loan { userId?: Id; userEmail?: string; _id: Id; copyId: Id; returnedAt: ApiDate; borrowedAt?: ApiDate; dueAt?: ApiDate; }
function dateValue(value: ApiDate | undefined): string | number | null {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : value.$date;
  const timestamp = typeof raw === 'string' ? Date.parse(raw) : Number(raw.$numberLong);
  return Number.isFinite(timestamp) ? timestamp : null;
}
interface LoanRow { returnedAt: string | number | null; userId?: string; userEmail?: string; id: string; copyId: string; book?: Book; borrowedAt: string | number | null; dueAt: string | number | null; }
const idString = (id: Id) => typeof id === 'string' ? id : id.$oid;

@Component({
  selector: 'app-loans',
  imports: [ColumnFilter, TableSort, DatePipe],
  template: `
    <section aria-labelledby="loans-title">
      <div class="heading"><div><p class="eyebrow">{{ isAdmin() ? 'LIBRARY ADMINISTRATION' : 'YOUR LIBRARY' }}</p><h1 id="loans-title">{{ history() ? 'Loan history' : isAdmin() ? 'All loans' : 'My loans' }}</h1><p class="intro">{{ history() ? 'Returned loans.' : isAdmin() ? 'Books currently on loan across the library.' : 'Books currently on loan to you.' }}</p></div><button type="button" class="secondary" (click)="load()" [disabled]="loading() || returning() !== null">Refresh</button></div>
      @if (returnMessage()) { <p class="success" role="status">{{ returnMessage() }}</p> }
      @if (returnError()) { <p class="error" role="alert">{{ returnError() }}</p> }
      @if (loading()) { <p class="notice" role="status">Loading loans...</p> }
      @else if (error()) { <div class="notice"><p role="alert">{{ error() }}</p><button class="secondary" (click)="load()">Retry</button></div> }
      @else if (!rows().length) { <div class="notice"><h2>{{ history() ? 'No returned loans' : 'No current loans' }}</h2><p>{{ history() ? 'Returned loans will appear here.' : isAdmin() ? 'There are no current loans across the library.' : 'Books you borrow will appear here until they are returned.' }}</p></div> }
      @else {
        <p class="count">{{ visibleRows().length }} {{ visibleRows().length === 1 ? 'loan' : 'loans' }}</p>
        @if (!visibleRows().length) { <p class="notice">No loans match these filters.</p> }
        <div class="table-container" role="region" aria-label="Current loans" tabindex="0">
          <table><thead><tr><th scope="col" [attr.aria-sort]="sortKey() === 'title' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Title">Title<app-table-sort column="title" label="Title" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th><th scope="col" [attr.aria-sort]="sortKey() === 'authors' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Authors">Authors<app-table-sort column="authors" label="Authors" [(sortKey)]="sortKey" [(direction)]="sortDirection" /><app-column-filter label="Filter authors" [options]="authorOptions()" [(value)]="authorFilter" /></th><th scope="col" [attr.aria-sort]="sortKey() === 'topics' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Topics">Topics<app-table-sort column="topics" label="Topics" [(sortKey)]="sortKey" [(direction)]="sortDirection" /><app-column-filter label="Filter topics" [options]="topicOptions()" [(value)]="topicFilter" [interests]="auth.user()?.interests ?? []" /></th><th scope="col">Copy ID</th><th scope="col" [attr.aria-sort]="sortKey() === 'borrowedAt' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Borrow date (SGT)">Borrow date (SGT)<app-table-sort column="borrowedAt" label="Borrow date" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th><th scope="col" [attr.aria-sort]="sortKey() === (history() ? 'returnedAt' : 'dueAt') ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" [attr.aria-label]="history() ? 'Return date (SGT)' : 'Due date (SGT)'">{{ history() ? 'Return date (SGT)' : 'Due date (SGT)' }}<app-table-sort [column]="history() ? 'returnedAt' : 'dueAt'" [label]="history() ? 'Return date' : 'Due date'" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th>@if (isAdmin()) { <th scope="col" [attr.aria-sort]="sortKey() === 'userEmail' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="User email">User email<app-table-sort column="userEmail" label="User email" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th> }@if (!history()) { <th scope="col">Actions</th> }</tr></thead>
            <tbody>@for (row of visibleRows(); track row.id) {
              <tr [class.row-green]="dueStatus(row) === 'green'" [class.row-yellow]="dueStatus(row) === 'yellow'" [class.row-red]="dueStatus(row) === 'red'"><th scope="row">{{ row.book?.title || 'Book details unavailable' }}</th><td>{{ row.book?.authors?.join(', ') || '' }}</td>
              <td><ul class="topics" aria-label="Topics">@for (topic of row.book?.topics || []; track $index) { <li>{{ topic }}</li> }</ul></td><td>{{ row.copyId }}</td><td class="archive-date">{{ (row.borrowedAt | date:'dd MMM yyyy, HH:mm':'+0800') || 'Unavailable' }}</td><td class="archive-date">{{ ((history() ? row.returnedAt : row.dueAt) | date:'dd MMM yyyy, HH:mm':'+0800') || 'Unavailable' }}</td>@if (isAdmin()) { <td class="owner-email">{{ row.userEmail || 'Email unavailable' }}</td> }@if (!history()) { <td><button type="button" class="primary" [disabled]="returning() !== null || (isAdmin() && !row.userId)" (click)="openReturn(row)" [attr.aria-label]="'Return ' + (row.book?.title || row.copyId)">{{ returning() === row.id ? 'Returning...' : 'Return' }}</button></td> }</tr>
            }</tbody>
          </table>
        </div>
      }
    </section>
    <dialog #returnDialog aria-labelledby="return-title" (cancel)="cancelReturn($event)">
      <h2 id="return-title">Confirm return</h2>
      <p>{{ selectedReturn()?.book?.title || selectedReturn()?.copyId }}</p>
      @if (isAdmin()) { <p>Return for {{ selectedReturn()?.userEmail || selectedReturn()?.userId }}?</p> }
      <p>Return this copy at the current library time? Overdue fines may apply.</p>
      <div class="actions"><button type="button" class="secondary" [disabled]="returning() !== null" (click)="closeReturn()">Cancel</button>
        @if (selectedReturn(); as row) { <button type="button" class="primary" [disabled]="returning() !== null" (click)="returnLoan(row)">{{ returning() ? 'Returning...' : 'Confirm return' }}</button> }
      </div>
    </dialog>
  `,
  styleUrl: './books.css',
})
export class Loans {
  readonly history = input(false);
  private readonly clock = inject(LibraryClock);
  dueStatus(row: LoanRow): string {
    if (this.history()) return '';
    const now = this.clock.now();
    if (now === null || this.clock.error() || row.dueAt === null) return '';
    const remaining = Number(row.dueAt) - now;
    if (remaining < 0) return 'red';
    return remaining <= 3 * 24 * 60 * 60 * 1000 ? 'yellow' : 'green';
  }
  readonly auth = inject(AuthService);
  readonly isAdmin = () => this.auth.user()?.role === 'Admin';
  private readonly http = inject(HttpClient);
  private readonly users = inject(UserLookupService);
  private readonly books = inject(BooksService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly rows = signal<LoanRow[]>([]);

  readonly authorFilter = signal<string[] | null>(null);
  readonly topicFilter = signal<string[] | null>(null);
  readonly authorOptions = computed(() => filterOptions(this.rows().map(row => row.book).flatMap(book => book?.authors ?? [])));
  readonly topicOptions = computed(() => filterOptions(this.rows().map(row => row.book).flatMap(book => book?.topics ?? [])));
  readonly sortKey = signal('');
  readonly sortDirection = signal('asc');
  readonly visibleRows = computed(() => sortRows(this.rows().filter(row => matchesFilter(row.book?.authors, this.authorFilter()) && matchesFilter(row.book?.topics, this.topicFilter())), this.sortKey(), this.sortDirection(), (row, key) => {
    if (key === 'borrowedAt' || key === 'dueAt' || key === 'returnedAt') return row[key] == null ? null : Number(row[key]);
    if (key === 'userEmail') return row.userEmail;
    return row.book?.[key as 'title' | 'authors' | 'topics'];
  }));

  readonly loading = signal(false);
  readonly error = signal('');
  readonly returning = signal<string | null>(null);
  readonly returnMessage = signal('');
  readonly returnError = signal('');

  readonly selectedReturn = signal<LoanRow | null>(null);
  private readonly returnDialog = viewChild.required<ElementRef<HTMLDialogElement>>('returnDialog');
  openReturn(row: LoanRow) {
    if (this.history() || this.returning() || (this.isAdmin() && !row.userId)) return;
    this.selectedReturn.set(row); this.returnError.set(''); this.returnDialog().nativeElement.showModal();
  }
  closeReturn() { if (!this.returning()) this.returnDialog().nativeElement.close(); }
  cancelReturn(event: Event) { if (this.returning()) event.preventDefault(); }
  returnLoan(row: LoanRow) {
    if (this.history() || !['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.returning() !== null || (this.isAdmin() && !row.userId)) return;
    this.returning.set(row.id);
    this.returnMessage.set('');
    this.returnError.set('');
    this.http.post('/api/loan/return', { loan_id: row.id, ...(this.isAdmin() ? { user_id: row.userId } : {}) }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => { this.returning.set(null); this.returnDialog().nativeElement.close(); }),
    ).subscribe({
      next: () => {
        this.returnMessage.set(`Returned "${row.book?.title || row.copyId}" successfully.`);
        this.load();
      },
      error: (error: HttpErrorResponse) => this.returnError.set(
        typeof error.error?.detail === 'string' ? error.error.detail
          : 'The server could not confirm the return. It may have been partially processed; check the loan before retrying.',
      ),
    });
  }

  ngOnInit() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '')) { void this.router.navigateByUrl('/books'); return; }
    this.load();
  }

  load() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.http.get<Loan[]>(this.isAdmin() ? '/api/loan/retrieve_all' : '/api/loan/retrieve').pipe(
      map(loans => loans.filter(loan => this.history() ? loan.returnedAt != null : loan.returnedAt == null)),
      switchMap(items => this.isAdmin() ? this.users.withEmails(items) : of(items)),
      switchMap(loans => {
        if (!loans.length) return of<LoanRow[]>([]);
        return this.books.retrieve().pipe(switchMap(books => {
          const requests = books.map(book => this.http.post<{ _id: Id }[]>('/api/copy/retrieve', { _id: book._id }).pipe(
            map(copies => copies.map(copy => ({ copyId: idString(copy._id), book }))),
          ));
          return (requests.length ? forkJoin(requests) : of([])).pipe(map(groups => {
            const byCopy = new Map(groups.flat().map(item => [item.copyId, item.book]));
            return loans.map(loan => ({ userId: loan.userId ? idString(loan.userId) : undefined, userEmail: loan.userEmail, id: idString(loan._id), copyId: idString(loan.copyId), book: byCopy.get(idString(loan.copyId)), returnedAt: dateValue(loan.returnedAt), borrowedAt: dateValue(loan.borrowedAt), dueAt: dateValue(loan.dueAt) }));
          }));
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({ next: rows => this.rows.set(rows), error: () => this.error.set('Unable to load loans. Please try again.') });
  }
}
