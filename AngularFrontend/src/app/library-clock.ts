import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LibraryClock {
  readonly now = signal<number | null>(null);
  readonly error = signal(false);
}
