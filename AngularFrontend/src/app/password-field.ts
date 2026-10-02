import { Component, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-password-field',
  imports: [FormsModule],
  template: `
    <label [for]="fieldId()">{{ label() }}</label>
    <div class="password-wrap">
      <input [id]="fieldId()" [type]="visible() ? 'text' : 'password'" [autocomplete]="autocomplete()"
        [ngModel]="value()" (ngModelChange)="value.set($event)" [disabled]="disabled()" [required]="required()" />
      <button type="button" [attr.aria-label]="(visible() ? 'Hide ' : 'Show ') + label().toLowerCase()"
        [attr.aria-pressed]="visible()" [disabled]="disabled()" (click)="visible.set(!visible())">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          @if (visible()) { <path d="m3 3 18 18" /> }
        </svg>
      </button>
    </div>`,
  styles: `
    :host { display: block; } label { display: block; font-weight: 600; font-size: 13px; margin: 20px 0 8px; }
    .password-wrap { display: flex; border: 1px solid #cbd3c9; border-radius: 8px; background: white; }
    input { width: 100%; min-width: 0; min-height: 48px; padding: 12px 14px; border: 0; border-radius: 8px; font: inherit; background: transparent; }
    button { display: grid; place-items: center; flex-shrink: 0; width: 44px; background: transparent; border: 0; border-radius: 8px; color: #214f41; cursor: pointer; }
    input:focus-visible, button:focus-visible { outline: 3px solid #a9c7b8; outline-offset: 2px; }
  `,
})
export class PasswordField {
  readonly fieldId = input.required<string>();
  readonly label = input('Password');
  readonly autocomplete = input('current-password');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly value = model('');
  readonly visible = signal(false);
}
