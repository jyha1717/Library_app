import { Component, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Loans } from './loans';
import { Reservations } from './reservations';
import { Fines } from './fines';
@Component({
  selector: 'app-history',
  imports: [Loans, Reservations, Fines],
  styleUrl: './books.css',
  styles: 'app-loans, app-reservations, app-fines { display: block; margin-top: 36px; }',
  template: `<h1>{{ auth.user()?.role === 'Admin' ? 'All History' : 'History' }}</h1>
    <app-loans [history]="true" />
    <app-reservations [history]="true" />
    <app-fines [history]="true" />`,
})
export class History { readonly auth = inject(AuthService); }
