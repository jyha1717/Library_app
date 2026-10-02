import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, of } from 'rxjs';
import { ApiId, readId } from './api-values';
interface Loan { userId?: ApiId; copyId: ApiId; returnedAt?: unknown; }
interface Reservation { userId?: ApiId; bookId: ApiId; status: string; }
export interface Eligibility { borrowed: Set<string>; reserved: Set<string>; }
export const eligibilityKey = (book: string, user: string) => JSON.stringify([book, user]);
@Injectable({ providedIn: 'root' })
export class EligibilityService {
  private readonly http = inject(HttpClient);
  load(bookIds: string[], admin: boolean, existingReservations?: Reservation[]) {
    const suffix = admin ? 'retrieve_all' : 'retrieve';
    const copies = bookIds.map(book => this.http.post<{ _id: ApiId }[]>('/api/copy/retrieve', { _id: book }).pipe(map(items => items.map(copy => [readId(copy._id), book] as const))));
    return forkJoin({
      loans: this.http.get<Loan[]>(`/api/loan/${suffix}`),
      reservations: existingReservations ? of(existingReservations) : this.http.get<Reservation[]>(`/api/reservation/${suffix}`),
      copies: copies.length ? forkJoin(copies) : of([]),
    }).pipe(map(({ loans, reservations, copies }): Eligibility => {
      const byCopy = new Map(copies.flat());
      const borrowed = new Set<string>();
      const reserved = new Set<string>();
      for (const loan of loans) {
        const book = byCopy.get(readId(loan.copyId));
        if (book && loan.returnedAt == null) borrowed.add(eligibilityKey(book, admin ? readId(loan.userId ?? '') : 'self'));
      }
      for (const reservation of reservations) if (['waiting', 'ready'].includes(reservation.status)) reserved.add(eligibilityKey(readId(reservation.bookId), admin ? readId(reservation.userId ?? '') : 'self'));
      return { borrowed, reserved };
    }));
  }
}
