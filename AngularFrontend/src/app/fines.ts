import { TableSort, sortRows } from './table-sort';
import { UserLookupService } from './user-lookup.service';
import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiId, ApiDate, readId, readDate } from './api-values';

interface ApiFine { userId?: ApiId; userEmail?: string; _id: ApiId; loanId: ApiId; amount: number; assessedAt: ApiDate; paidAt: ApiDate; }
const normalize = (fine: ApiFine) => ({ ...fine, _id: readId(fine._id), loanId: readId(fine.loanId), assessedAt: readDate(fine.assessedAt), paidAt: readDate(fine.paidAt) });
type Fine = ReturnType<typeof normalize>;

@Component({
  selector: 'app-fines', imports: [TableSort, DatePipe, CurrencyPipe], styleUrl: './books.css',
  template: `
    <section aria-labelledby="fines-title">
      <div class="heading"><div><p class="eyebrow">{{ isAdmin() ? 'LIBRARY ADMINISTRATION' : 'YOUR LIBRARY' }}</p><h1 id="fines-title">{{ history() ? 'Fine history' : isAdmin() ? 'All fines' : 'My fines' }}</h1><p class="intro">{{ history() ? 'Paid fines.' : isAdmin() ? 'Outstanding fines across the library.' : 'Your outstanding fines.' }}</p></div><button class="secondary" (click)="load()" [disabled]="loading() || paying()">Refresh</button></div>
      @if (message()) { <p class="success" role="status">{{ message() }}</p> }
      @if (loading()) { <p class="notice" role="status">Loading fines...</p> }
      @else if (error()) { <div class="notice"><p role="alert">{{ error() }}</p><button class="secondary" (click)="load()">Retry</button></div> }
      @else if (!rows().length) { <div class="notice"><h2>{{ history() ? 'No paid fines' : 'No outstanding fines' }}</h2><p>{{ history() ? 'Paid fines will appear here.' : 'There are no outstanding fines.' }}</p></div> }
      @else {
        <div class="table-container" role="region" aria-label="Fines" tabindex="0"><table>
          <thead><tr><th scope="col">Loan ID</th><th scope="col" [attr.aria-sort]="sortKey() === 'amount' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Amount (SGD)">Amount (SGD)<app-table-sort column="amount" label="Amount" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th><th scope="col" [attr.aria-sort]="sortKey() === 'assessedAt' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="Assessed at (SGT)">Assessed at (SGT)<app-table-sort column="assessedAt" label="Assessed at" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th>@if (history()) { <th scope="col">Paid at (SGT)</th> }@if (isAdmin()) { <th scope="col" [attr.aria-sort]="sortKey() === 'userEmail' ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'" aria-label="User email">User email<app-table-sort column="userEmail" label="User email" [(sortKey)]="sortKey" [(direction)]="sortDirection" /></th> }@if (!history()) { <th scope="col">Actions</th> }</tr></thead>
          <tbody>@for (row of visibleRows(); track row._id) {
            <tr><th scope="row">{{ row.loanId }}</th><td>{{ row.amount / 100 | currency:'SGD':'code':'1.2-2' }}</td><td class="archive-date">{{ row.assessedAt | date:'dd MMM yyyy, HH:mm':'+0800' }}</td>@if (history()) { <td class="archive-date">{{ row.paidAt | date:'dd MMM yyyy, HH:mm':'+0800' }}</td> }@if (isAdmin()) { <td class="owner-email">{{ row.userEmail || 'Email unavailable' }}</td> }@if (!history()) { <td>
              @if (!history() && row.paidAt === null) { <button class="primary" (click)="openPay(row)" [disabled]="paying() || (isAdmin() && !row.userId)">Pay fine</button> }
            </td> }</tr>
          }</tbody>
        </table></div>
      }
    </section>
    <dialog #paymentDialog aria-labelledby="payment-title" (cancel)="cancelDialog($event)">
      <h2 id="payment-title">Confirm payment</h2>
      @if (selected(); as fine) { <p>Pay this fine of <strong>{{ fine.amount / 100 | currency:'SGD':'code':'1.2-2' }}</strong> in full?</p><p>Loan: {{ fine.loanId }}</p>@if (isAdmin()) { <p>For: {{ fine.userEmail || 'Email unavailable' }}</p> } }
      @if (paymentError()) { <p class="error" role="alert">{{ paymentError() }}</p> }
      <div class="actions"><button class="secondary" autofocus (click)="closeDialog()" [disabled]="paying()">Cancel</button><button class="primary" (click)="pay()" [disabled]="paying()">{{ paying() ? 'Paying...' : 'Confirm payment' }}</button></div>
    </dialog>
  `,
})
export class Fines {
  readonly history = input(false);
  private readonly auth = inject(AuthService);
  readonly isAdmin = () => this.auth.user()?.role === 'Admin';
  private readonly http = inject(HttpClient);
  private readonly users = inject(UserLookupService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('paymentDialog');
  readonly rows = signal<Fine[]>([]);

  readonly sortKey = signal('');
  readonly sortDirection = signal('asc');
  readonly visibleRows = computed(() => sortRows(this.rows(), this.sortKey(), this.sortDirection(), (row, key) => row[key as 'amount' | 'assessedAt' | 'userEmail']));

  readonly loading = signal(false);
  readonly paying = signal(false);
  readonly error = signal('');
  readonly paymentError = signal('');
  readonly message = signal('');
  readonly selected = signal<Fine | null>(null);
  ngOnInit() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '')) { void this.router.navigateByUrl('/books'); return; }
    this.load();
  }
  load() {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || this.loading()) return;
    this.loading.set(true); this.error.set('');
    this.http.get<ApiFine[]>(this.isAdmin() ? '/api/fine/retrieve_all' : '/api/fine/retrieve').pipe(
      map(items => items.filter(item => this.history() ? item.paidAt != null : item.paidAt == null)),
      switchMap(items => this.isAdmin() ? this.users.withEmails(items) : of(items)),
      map(items => items.map(normalize).sort((a, b) => (b.assessedAt ?? 0) - (a.assessedAt ?? 0))),
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)),
    ).subscribe({ next: rows => this.rows.set(rows), error: () => this.error.set('Unable to load fines. Please try again.') });
  }
  openPay(fine: Fine) {
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !fine?.userId) || this.paying() || fine.paidAt !== null) return;
    this.selected.set(fine); this.paymentError.set(''); this.dialog().nativeElement.showModal();
  }
  closeDialog() { if (!this.paying()) this.dialog().nativeElement.close(); }
  cancelDialog(event: Event) { if (this.paying()) event.preventDefault(); }
  pay() {
    const fine = this.selected();
    if (!['User', 'Admin'].includes(this.auth.user()?.role ?? '') || (this.isAdmin() && !fine?.userId) || !fine || fine.paidAt !== null || this.paying()) return;
    this.paying.set(true); this.paymentError.set(''); this.message.set('');
    this.http.post<ApiFine>('/api/fine/pay', { fine_id: fine._id, ...(this.isAdmin() ? { user_id: readId(fine.userId!) } : {}) }).pipe(
      map(normalize), takeUntilDestroyed(this.destroyRef), finalize(() => this.paying.set(false)),
    ).subscribe({
      next: updated => {
        this.rows.update(rows => rows.filter(row => row._id !== fine._id));
        this.dialog().nativeElement.close(); this.message.set('Fine paid successfully.');
      },
      error: (error: HttpErrorResponse) => this.paymentError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to confirm payment. Close this dialog and refresh before retrying.'),
    });
  }
}
