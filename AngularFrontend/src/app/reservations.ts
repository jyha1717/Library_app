import { ColumnFilter, filterOptions, matchesFilter } from './column-filter';
import { TableSort, sortRows } from './table-sort';
import { EligibilityService, eligibilityKey } from './eligibility.service';
import { UserLookupService } from './user-lookup.service';
import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { Book, BooksService } from './books.service';

type Id = string | { $oid: string };
interface Reservation { userId?: Id; userEmail?: string; _id: Id; bookId: Id; status: string; }
interface ReservationRow { alreadyBorrowed?: boolean; userId?: string; userEmail?: string; id: string; status: string; book?: Book; }
const idString = (id: Id) => typeof id === 'string' ? id : id.$oid;

@Component({
  selector: 'app-reservations',
  imports: [ColumnFilter, TableSort, RouterLink],
  template: `
    <section aria-labelledby="reservations-title">
      <div class="heading"><div><p class="eyebrow">{{ isAdmin() ? 'LIBRARY ADMINISTRATION' : 'YOUR LIBRARY' }}</p><h1 id="reservations-title">{{ history() ? 'Reservation history' : isAdmin() ? 'All reservations' : 'My reservations' }}</h1><p class="intro">{{ history() ? 'Fulfilled and cancelled reservations.' : isAdmin() ? 'Waiting and ready reservations across the library.' : 'Books waiting for you, or waiting to become available.' }}</p></div><button type="button" class="secondary" (click)="load()" [disabled]="loading() || busy()">Refresh</button></div>
      @if (message()) { <p class="success" role="status">{{ message() }}</p> }
      @if (actionError()) { <p class="error" role="alert">{{ actionError() }}</p> }
      @if (loading()) { <p class="notice" role="status">Loading reservations...</p> }
      @else if (error()) { <div class="notice"><p role="alert">{{ error() }}</p><button class="secondary" (click)="load()">Retry</button></div> }
      @else if (!rows().length) { <div class="notice"><h2>{{ history() ? 'No reservation history' : 'No current reservations' }}</h2><p>{{ history() ? 'Fulfilled and cancelled reservations will appear here.' : isAdmin() ? 'There are no waiting or ready reservations across the library.' : 'Your waiting and ready reservations will appear here.' }}</p></div> }
      @else {
        <p class="count">{{ visibleRows().length }} {{ visibleRows().length === 1 ? 'reservation' : 'reservations' }}</p>
        @if (!visibleRows().length) { <p class="notice">No reservations match these filters.</p> }
        <div class="table-container" role="region" aria-label="Current reservations" tabindex="0">
          <table><thead><tr><th scope="col" [attr.aria-sort]="sortKey() === 'title' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Title">Title<app-table-sort column="title" label="Title" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th><th scope="col" [attr.aria-sort]="sortKey() === 'authors' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Authors">Authors<app-table-sort column="authors" label="Authors" [(sortKey)]="sortKey" [(direction)]="sortDirection" /><app-column-filter label="Filter authors" [options]="authorOptions()" [(value)]="authorFilter" /></th><th scope="col" [attr.aria-sort]="sortKey() === 'topics' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Topics">Topics<app-table-sort column="topics" label="Topics" [(sortKey)]="sortKey" [(direction)]="sortDirection" /><app-column-filter label="Filter topics" [options]="topicOptions()" [(value)]="topicFilter" [interests]="auth.user()?.interests ?? []" /></th><th scope="col">Status <app-column-filter label="Filter reservation status" [(value)]="statusFilter" [options]="history() ? [{ key: 'fulfilled', label: 'Fulfilled' }, { key: 'cancelled', label: 'Cancelled' }] : [{ key: 'waiting', label: 'Waiting' }, { key: 'ready', label: 'Ready' }]" /></th>@if (isAdmin()) { <th scope="col" [attr.aria-sort]="sortKey() === 'userEmail' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="User email">User email<app-table-sort column="userEmail" label="User email" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th> }@if (!history()) { <th scope="col">Actions</th> }</tr></thead>
            <tbody>@for (row of visibleRows(); track row.id) {
              <tr [class.row-green]="row.status === 'ready'" [class.row-yellow]="row.status === 'waiting'"><th scope="row">{{ row.book?.title || 'Book details unavailable' }}</th><td>{{ row.book?.authors?.join(', ') || '' }}</td>
              <td><ul class="topics" aria-label="Topics">@for (topic of row.book?.topics || []; track $index) { <li>{{ topic }}</li> }</ul></td><td>{{ row.status }}</td>@if (isAdmin()) { <td class="owner-email">{{ row.userEmail || 'Email unavailable' }}</td> }@if (!history()) { <td>
                 @if (row.status === 'ready') { @if (!row.alreadyBorrowed) { <button type="button" class="primary" [disabled]="busy() || row.alreadyBorrowed || (isAdmin() && !row.userId)" (click)="openBorrow(row)">Borrow</button> } @if (row.alreadyBorrowed) { @if (isAdmin()) { <span>already borrowed</span> } @else { <button type="button" class="primary" routerLink="/loans">Already borrowed</button> } } }
                <button type="button" class="secondary" [disabled]="busy() || (isAdmin() && !row.userId)" (click)="openCancel(row)">Cancel reservation</button>
              </td> }</tr>
            }</tbody>
          </table>
        </div>
      }
    </section>
    <dialog #cancelReservationDialog aria-labelledby="cancel-reservation-title" (cancel)="cancelDialog($event)">
      <h2 id="cancel-reservation-title">Cancel reservation?</h2>
      <p class="selected-title">{{ selected()?.book?.title || 'Reserved book' }}</p>
      @if (isAdmin()) { <p>For: {{ selected()?.userEmail || selected()?.userId }}</p> }
      <p>{{ selected()?.status === 'ready' ? 'The allocated copy will be released for another reader.' : 'The borrower will lose their place in the reservation queue.' }}</p>
      <div class="actions"><button type="button" class="secondary" autofocus [disabled]="busy()" (click)="closeCancel()">Keep reservation</button>
        @if (selected(); as row) { <button type="button" class="primary" [disabled]="busy()" (click)="perform(row, 'cancel')">{{ busy() ? 'Cancelling...' : 'Confirm cancellation' }}</button> }
      </div>
    </dialog>
    <dialog #borrowDialog aria-labelledby="reservation-borrow-title" (cancel)="cancelDialog($event)">
      <h2 id="reservation-borrow-title">Confirm borrowing</h2>
      <p class="selected-title">{{ selected()?.book?.title || 'Reserved book' }}</p>
      @if (isAdmin()) { <p>For: {{ selected()?.userEmail || selected()?.userId }}</p> }
      <p>Borrow the reserved copy for 14 days? The loan starts at the current library time.</p>
      <div class="actions"><button type="button" class="secondary" autofocus [disabled]="busy()" (click)="closeDialog()">Cancel</button>
        @if (selected(); as row) { <button type="button" class="primary" [disabled]="busy()" (click)="perform(row, 'borrow')">{{ busy() ? 'Borrowing...' : 'Confirm borrow' }}</button> }
      </div>
    </dialog>
  `,
  styleUrl: './books.css',
})
export class Reservations {
  readonly history = input(false);
  readonly auth = inject(AuthService);
  readonly isAdmin = () => this.auth.user()?.role === 'Admin';
  private readonly http = inject(HttpClient);
  private readonly eligibilityApi = inject(EligibilityService);
  private readonly users = inject(UserLookupService);
  private readonly books = inject(BooksService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly rows = signal<ReservationRow[]>([]);

  readonly authorFilter = signal<string[] | null>(null);
  readonly topicFilter = signal<string[] | null>(null);
  readonly authorOptions = computed(() => filterOptions(this.rows().map(row => row.book).flatMap(book => book?.authors ?? [])));
  readonly topicOptions = computed(() => filterOptions(this.rows().map(row => row.book).flatMap(book => book?.topics ?? [])));
  readonly sortKey = signal('');
  readonly sortDirection = signal('asc');
  readonly statusFilter = signal<string[] | null>(null);
  readonly visibleRows = computed(() => sortRows(
    this.rows().filter(row => matchesFilter([row.status], this.statusFilter()) && matchesFilter(row.book?.authors, this.authorFilter()) && matchesFilter(row.book?.topics, this.topicFilter())),
    this.sortKey(), this.sortDirection(), (row, key) => key === 'userEmail' ? row.userEmail : row.book?.[key as 'title' | 'authors' | 'topics'],
  ));

  readonly loading = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly message = signal('');
  readonly actionError = signal('');
  readonly selected = signal<ReservationRow | null>(null);
  private readonly borrowDialog = viewChild.required<ElementRef<HTMLDialogElement>>('borrowDialog');
  private readonly cancelReservationDialog = viewChild.required<ElementRef<HTMLDialogElement>>('cancelReservationDialog');
  openCancel(row: ReservationRow) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !row.userId) || this.busy() || !['waiting', 'ready'].includes(row.status)) return;
    this.selected.set(row);
    this.actionError.set('');
    this.cancelReservationDialog().nativeElement.showModal();
  }
  closeCancel() { if (!this.busy()) this.cancelReservationDialog().nativeElement.close(); }

  openBorrow(row: ReservationRow) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !row.userId) || this.busy() || row.status !== 'ready' || row.alreadyBorrowed) return;
    this.selected.set(row);
    this.actionError.set('');
    this.borrowDialog().nativeElement.showModal();
  }
  closeDialog() { if (!this.busy()) this.borrowDialog().nativeElement.close(); }
  cancelDialog(event: Event) { if (this.busy()) event.preventDefault(); }
  perform(row: ReservationRow, action: 'cancel' | 'borrow') {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !row.userId) || this.busy() || this.loading() || !['waiting', 'ready'].includes(row.status) || (action === 'borrow' && (row.status !== 'ready' || row.alreadyBorrowed))) return;
    this.busy.set(true);
    this.message.set('');
    this.actionError.set('');
    this.http.post(`/api/reservation/${action}`, { reservation_id: row.id, ...(this.isAdmin() ? { user_id: row.userId } : {}) }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.busy.set(false); this.borrowDialog().nativeElement.close(); this.cancelReservationDialog().nativeElement.close(); }),
    ).subscribe({
      next: () => {
        this.message.set(action === 'borrow' ? (this.isAdmin() ? 'Reserved copy borrowed successfully. View it in All loans.' : 'Reserved copy borrowed successfully. View it in My loans.') : 'Reservation cancelled.');
        this.load();
      },
      error: (error: HttpErrorResponse) => this.actionError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm the change. Refresh the list before retrying.'),
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
    this.http.get<Reservation[]>(this.isAdmin() ? '/api/reservation/retrieve_all' : '/api/reservation/retrieve').pipe(
      map(reservations => reservations.filter(item => this.history() ? ['fulfilled', 'cancelled'].includes(item.status) : item.status === 'ready' || item.status === 'waiting')),
      switchMap(items => this.isAdmin() ? this.users.withEmails(items) : of(items)),
      switchMap(reservations => {
        if (!reservations.length) return of<ReservationRow[]>([]);
        return this.books.retrieve().pipe(switchMap(books => (this.history() ? of({ borrowed: new Set<string>(), reserved: new Set<string>() }) : this.eligibilityApi.load(books.map(book => book._id), this.isAdmin(), reservations)).pipe(map(state => {
          const byId = new Map(books.map(book => [book._id, book]));
          return reservations.map(item => ({ alreadyBorrowed: state.borrowed.has(eligibilityKey(idString(item.bookId), this.isAdmin() ? idString(item.userId ?? '') : 'self')), userId: item.userId ? idString(item.userId) : undefined, userEmail: item.userEmail, id: idString(item._id), status: item.status, book: byId.get(idString(item.bookId)) }));
        }))));
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({ next: rows => this.rows.set(rows), error: () => this.error.set('Unable to load reservations. Please try again.') });
  }
}
