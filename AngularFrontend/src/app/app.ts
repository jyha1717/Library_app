import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AuthService } from './auth.service';
import { Router, RouterOutlet } from '@angular/router';
import { LibraryShell } from './library-shell';
import { PasswordField } from './password-field';
import { CreateUser } from './create-user';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, LibraryShell, PasswordField, CreateUser],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly registering = signal(false);
  readonly success = signal('');
  readonly demoAccounts = [
    { name: 'Admin', email: 'admin@example.com', role: 'Admin' },
    { name: 'Alice', email: 'alice@example.com', role: 'User' },
    { name: 'Bob', email: 'bob@example.com', role: 'User' },
    { name: 'Charlie', email: 'charlie@example.com', role: 'User' },
  ];
  email = '';
  password = '';

  constructor() {
    if (this.auth.hasToken()) {
      this.busy.set(true);
      this.auth.loadUser().pipe(finalize(() => this.busy.set(false))).subscribe({
        next: () => { if (!['/loans', '/reservations', '/notifications', '/fines', '/history', '/settings'].includes(this.router.url)) void this.router.navigateByUrl('/books'); },
        error: () => {
          this.auth.logout();
          this.error.set('We could not restore your session. Please sign in again.');
        },
      });
    }
  }

  login(form: NgForm) {
    if (this.busy()) return;
    this.signIn();
  }

  openRegistration() { this.password = ''; this.error.set(''); this.success.set(''); this.registering.set(true); }
  accountCreated(email: string) {
    this.email = email;
    this.registering.set(false);
    this.success.set('Account created. You can now sign in.');
  }

  loginDemo(email: string) {
    if (this.busy()) return;
    this.email = email;
    this.password = 'LibraryDemo123!';
    this.signIn();
  }

  private signIn() {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.auth.login(this.email.trim(), this.password)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => { this.password = ''; void this.router.navigateByUrl('/books'); },
        error: (error: HttpErrorResponse) => {
          this.auth.logout();
          this.error.set(error.status === 0 || error.status >= 500
            ? 'Unable to connect to the library. Please check that the server is running and try again.'
            : typeof error.error?.detail === 'string'
              ? error.error.detail : 'Sign-in failed. Please try again.');
        },
      });
  }

  logout() {
    this.auth.logout();
    this.password = '';
    this.error.set('');
    this.success.set('');
  }
}
