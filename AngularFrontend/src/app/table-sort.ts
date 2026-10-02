import { Component, input, model } from '@angular/core';

export type SortValue = string | number | string[] | null | undefined;
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function sortRows<T>(rows: readonly T[], key: string, direction: string, value: (row: T, key: string) => SortValue): T[] {
  if (!key) return [...rows];
  return [...rows].sort((a, b) => {
    const left = value(a, key), right = value(b, key);
    // Keep unavailable values at the end in either direction.
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : collator.compare(Array.isArray(left) ? left.join(', ') : String(left), Array.isArray(right) ? right.join(', ') : String(right));
    return direction === 'desc' ? -comparison : comparison;
  });
}

@Component({
  selector: 'app-table-sort',
  template: `
    <span class="arrows">
      @for (order of ['asc', 'desc']; track order) {
        <button type="button" [class.active]="sortKey() === column() && direction() === order"
          [attr.aria-pressed]="sortKey() === column() && direction() === order"
          [attr.aria-label]="'Sort ' + label() + (order === 'asc' ? ' ascending' : ' descending')"
          [title]="'Sort ' + label() + (order === 'asc' ? ' ascending' : ' descending')" (click)="sort(order)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path [attr.d]="order === 'asc' ? 'M8 13V3 M3 8l5-5 5 5' : 'M8 3v10 M3 8l5 5 5-5'" />
          </svg>
        </button>
      }
    </span>`,
  styles: `
    :host { display: inline-block; vertical-align: middle; margin-left: 6px; }
    .arrows { display: inline-flex; gap: 2px; }
    button { display: grid; place-items: center; width: 26px; height: 28px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #68716a; cursor: pointer; padding: 3px; }
    button:hover { border-color: #b9c8bb; }
    button.active { color: white; background: #214f41; }
    button:focus-visible { outline: 3px solid #a9c7b8; outline-offset: 2px; }
  `,
})
export class TableSort {
  readonly column = input.required<string>();
  readonly label = input.required<string>();
  readonly sortKey = model('');
  readonly direction = model('asc');
  sort(order: string) {
    if (this.sortKey() === this.column() && this.direction() === order) { this.sortKey.set(''); return; }
    this.direction.set(order); this.sortKey.set(this.column());
  }
}
