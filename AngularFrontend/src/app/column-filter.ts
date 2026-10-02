import { Component, ElementRef, input, model, signal, viewChild } from '@angular/core';
export const filterKey = (value: string) => value.trim().toLowerCase();
export function filterOptions(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) if (filterKey(value) && !unique.has(filterKey(value))) unique.set(filterKey(value), value.trim());
  return [...unique].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}
export function matchesFilter(values: string[] | undefined, selected: string[] | null) {
  return selected === null || (values ?? []).some(value => selected.includes(filterKey(value)));
}
@Component({
  selector: 'app-column-filter',
  template: `
    <button type="button" class="funnel" [class.active]="value() !== null" [attr.aria-label]="label()" [title]="label()"
      aria-haspopup="dialog" [attr.aria-expanded]="opened()" (click)="open()">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 3h16l-6 7v6l-4 2v-8Z" /></svg>
    </button>
    <dialog #dialog [attr.aria-label]="label()" (close)="opened.set(false)">
      <h2>{{ label() }}</h2>
      @if (interests() !== null) {
        <button type="button" (click)="useInterests()">Filter by my interests</button>
        @if (!interests()!.length) { <p>You have no interests set. Add interests in Settings.</p> }
      }
      @if (options().length) {
        <div class="selection"><button type="button" (click)="selectAll()">Select all</button><button type="button" (click)="draft.set([])">Clear all</button></div>
        <div class="choices">
          @for (option of options(); track option.key) {
            <label><input type="checkbox" [checked]="draft().includes(option.key)" (change)="toggle(option.key)" />{{ option.label }}</label>
          }
        </div>
      } @else { <p>No values available.</p> }
      <div class="actions"><button type="button" (click)="dialog.close()">Cancel</button><button type="button" class="primary" (click)="confirm()">Confirm</button></div>
    </dialog>`,
  styles: `
    :host { display: inline-block; vertical-align: middle; margin-left: 6px; }
    button { font: inherit; cursor: pointer; border: 1px solid #b9c8bb; padding: 8px 12px; border-radius: 6px; color: #214f41; background: transparent; }
    .funnel { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 4px; }
    .funnel.active, .primary { background: #214f41; color: white; }
    dialog { width: min(420px, calc(100vw - 48px)); max-height: 80dvh; overflow: auto; border: 1px solid #dce3d8; border-radius: 14px; padding: 24px; background: #fffefb; color: #293d32; font: 14px/1.5 sans-serif; text-align: left; }
    dialog::backdrop { background: #14271d99; }
    h2 { margin: 0 0 18px; font-size: 20px; }
    .selection, .actions { display: flex; gap: 10px; margin-top: 16px; }
    .actions { justify-content: flex-end; }
    .choices { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; max-height: 40dvh; overflow: auto; }
    label { display: flex; gap: 10px; align-items: center; cursor: pointer; }
    input { accent-color: #214f41; width: 18px; height: 18px; flex-shrink: 0; }
    button:focus-visible, input:focus-visible { outline: 3px solid #a9c7b8; outline-offset: 2px; }
  `,
})
export class ColumnFilter {
  readonly label = input.required<string>();
  readonly options = input<{ key: string; label: string }[]>([]);
  readonly interests = input<string[] | null>(null);
  readonly value = model<string[] | null>(null);
  readonly draft = signal<string[]>([]);
  readonly opened = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  open() { this.draft.set(this.value() === null ? this.options().map(option => option.key) : [...this.value()!]); this.opened.set(true); this.dialog().nativeElement.showModal(); }
  toggle(key: string) { this.draft.update(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key]); }
  selectAll() { this.draft.set(this.options().map(option => option.key)); }
  useInterests() { const interests = new Set((this.interests() ?? []).map(filterKey)); this.draft.set(this.options().filter(option => interests.has(filterKey(option.label))).map(option => option.key)); }
  confirm() { this.value.set(this.options().length && this.options().every(option => this.draft().includes(option.key)) ? null : [...this.draft()]); this.dialog().nativeElement.close(); }
}
