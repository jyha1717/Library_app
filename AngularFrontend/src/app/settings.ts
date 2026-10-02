import { Component, ElementRef, inject, signal, viewChild, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from './auth.service';
import { PasswordField } from './password-field';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, PasswordField],
  styleUrl: './account-forms.css',
  template: `
    <h1>Settings</h1>
    <section class="profile" aria-label="Profile information">
      <h2>Profile</h2>
      <dl>
        @for (field of profileFields; track field.key) {
          <dt>{{ field.label }}</dt>
          <dd>
            @if (editing() === field.key) {
              <form (ngSubmit)="saveProfile()" novalidate [attr.aria-busy]="profileBusy()">
                <label class="profile-input-label" [for]="'edit-' + field.key">{{ field.label }}</label>
                @if (field.key === 'interests') {
                  <textarea [id]="'edit-' + field.key" name="profileValue" rows="4" [(ngModel)]="profileValue" [disabled]="profileBusy()" aria-describedby="edit-interests-help"></textarea>
                  <p id="edit-interests-help" class="hint">One interest per line. Spaces within an interest are welcome.</p>
                } @else {
                  <input [id]="'edit-' + field.key" name="profileValue" type="text" [autocomplete]="field.key" [(ngModel)]="profileValue" [disabled]="profileBusy()" />
                }
                @if (profileError()) { <p class="error" role="alert">{{ profileError() }}</p> }
                <div class="actions">
                  <button type="submit" class="primary" [disabled]="profileBusy()">{{ profileBusy() ? 'Saving...' : 'Save' }}</button>
                  <button type="button" [disabled]="profileBusy()" (click)="cancelProfile()">Cancel</button>
                </div>
              </form>
            } @else {
              <div class="profile-value"><span>{{ profileText(field.key) || 'Not set' }}</span><button type="button" [attr.aria-label]="'Edit ' + field.label.toLowerCase()" [disabled]="profileBusy()" (click)="editProfile(field.key)">Edit</button></div>
            }
          </dd>
        }
      </dl>
      <button type="button" (click)="open()">Change password</button>
      @if (success()) { <p class="success" role="status">{{ success() }}</p> }
    </section>
    <dialog #passwordDialog aria-labelledby="change-title" (cancel)="cancel($event)">
      <h2 id="change-title">Change password</h2>
      <form (ngSubmit)="submit()" novalidate [attr.aria-busy]="busy()">
        <app-password-field fieldId="old-password" label="Old password" [(value)]="password" [disabled]="busy()" />
        <app-password-field fieldId="change-password" label="New password" autocomplete="new-password" [(value)]="newPassword" [disabled]="busy()" />
        <app-password-field fieldId="confirm-password" label="Re-type new password" autocomplete="new-password" [(value)]="repeatPassword" [disabled]="busy()" />
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <div class="actions">
          <button type="button" [disabled]="busy()" (click)="close()">Cancel</button>
          <button type="submit" class="primary" [disabled]="busy()">{{ busy() ? 'Saving...' : 'Save password' }}</button>
        </div>
      </form>
    </dialog>`,
})
export class Settings {
  readonly auth = inject(AuthService);
  readonly profileFields = [
    { key: 'email', label: 'Email address' },
    { key: 'name', label: 'Name' },
    { key: 'interests', label: 'Interests' },
  ] as const;
  readonly editing = signal<'email' | 'name' | 'interests' | null>(null);
  readonly profileBusy = signal(false);
  readonly profileError = signal('');
  profileValue = '';
  profileText(field: 'email' | 'name' | 'interests') {
    const user = this.auth.user();
    return field === 'interests' ? user?.interests?.join('\n') ?? '' : user?.[field] ?? '';
  }
  editProfile(field: 'email' | 'name' | 'interests') {
    if (this.profileBusy()) return;
    this.profileValue = this.profileText(field);
    this.profileError.set(''); this.success.set(''); this.editing.set(field);
  }
  cancelProfile() { if (!this.profileBusy()) { this.editing.set(null); this.profileValue = ''; this.profileError.set(''); } }
  saveProfile() {
    const field = this.editing();
    if (!field || this.profileBusy()) return;
    const value = field === 'interests' ? this.profileValue.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : this.profileValue;
    this.profileBusy.set(true); this.profileError.set(''); this.success.set('');
    this.auth.updateProfile(field, value).pipe(finalize(() => this.profileBusy.set(false))).subscribe({
      next: () => { this.editing.set(null); this.profileValue = ''; this.success.set(`${this.profileFields.find(item => item.key === field)!.label} updated successfully.`); },
      error: error => this.profileError.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to save this change. Please try again.'),
    });
  }
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('passwordDialog');
  private readonly fields = viewChildren(PasswordField);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  password = ''; newPassword = ''; repeatPassword = '';

  open() { this.clear(); this.error.set(''); this.success.set(''); this.dialog().nativeElement.showModal(); }
  private clear() { this.password = ''; this.newPassword = ''; this.repeatPassword = ''; this.fields().forEach(field => field.visible.set(false)); }
  close() { if (!this.busy()) { this.dialog().nativeElement.close(); this.clear(); } }
  cancel(event: Event) { if (this.busy()) event.preventDefault(); else this.clear(); }
  submit() {
    if (this.busy()) return;
    this.error.set('');
    if (this.newPassword !== this.repeatPassword) { this.error.set('The passwords do not match.'); return; }
    this.busy.set(true);
    this.auth.changePassword(this.password, this.newPassword).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => { this.dialog().nativeElement.close(); this.clear(); this.success.set('Password changed successfully.'); },
      error: error => this.error.set(typeof error.error?.detail === 'string' ? error.error.detail : 'Unable to change your password. Please try again.'),
    });
  }
}
