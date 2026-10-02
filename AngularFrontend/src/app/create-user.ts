import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from './auth.service';
import { PasswordField } from './password-field';

@Component({
  selector: 'app-create-user',
  imports: [FormsModule, PasswordField],
  styleUrl: './account-forms.css',
  template: `
    <h1 id="page-title">Create new user</h1>
    <form (ngSubmit)="submit()" novalidate [attr.aria-busy]="busy()">
      <label for="new-email">Email address</label>
      <input id="new-email" name="email" type="text" autocomplete="email" required [(ngModel)]="email" [disabled]="busy()" />
      <app-password-field fieldId="new-password" autocomplete="new-password" [required]="true" [(value)]="password" [disabled]="busy()" />
      <app-password-field fieldId="repeat-password" label="Re-type password" autocomplete="new-password" [required]="true" [(value)]="repeatPassword" [disabled]="busy()" />
      <label for="new-name">Name</label>
      <input id="new-name" name="name" autocomplete="name" required [(ngModel)]="name" [disabled]="busy()" />
      <label for="new-interests">Interests</label>
      <textarea id="new-interests" name="interests" rows="4" [(ngModel)]="interests" [disabled]="busy()" aria-describedby="interests-hint"></textarea>
      <p id="interests-hint" class="hint">Optional. One interest per line. Spaces within an interest are welcome.</p>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <div class="actions">
        <button type="button" [disabled]="busy()" (click)="cancelled.emit()">Back to sign in</button>
        <button type="submit" class="primary" [disabled]="busy()">{{ busy() ? 'Creating...' : 'Create account' }}</button>
      </div>
    </form>`,
})
export class CreateUser {
  private readonly auth = inject(AuthService);
  readonly created = output<string>();
  readonly cancelled = output<void>();
  readonly busy = signal(false);
  readonly error = signal('');
  email = ''; password = ''; repeatPassword = ''; name = ''; interests = '';

  submit() {
    if (this.busy()) return;
    this.error.set('');
    if (![this.email, this.password, this.repeatPassword, this.name].every(value => value.trim().length > 0)) {
      this.error.set('Email address, password, re-type password and name cannot be blank.');
      return;
    }
    if (this.password !== this.repeatPassword) { this.error.set('The passwords do not match.'); return; }
    this.busy.set(true);
    this.auth.createUser({ email: this.email, password: this.password, name: this.name,
      interests: this.interests.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    }).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => { this.password = ''; this.repeatPassword = ''; this.created.emit(this.email); },
      error: error => this.error.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to create your account. Please try again.'),
    });
  }
}
