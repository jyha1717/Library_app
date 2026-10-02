import { test, expect, Page } from '@playwright/test';

const initialBook = { _id: 'book-1', title: 'The Night Sky', authors: ['Amira Patel', 'Daniel Lee'], topics: ['Science', 'Astronomy'], archivedAt: null };

async function session(page: Page, role: string) {
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'demo-token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'reader@example.com', role } }));
}

test('member sees title, authors and topics, but no admin action or archived books', async ({ page }) => {
  await session(page, 'User');
  await page.route('**/api/book/retrieve', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
    return route.fulfill({ json: [initialBook, { ...initialBook, _id: 'archived', title: 'Archived title', archivedAt: '2026-01-01' }] });
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/books$/);
  await expect(page.getByRole('rowheader', { name: 'The Night Sky' })).toBeVisible();
  await expect(page.getByText('Amira Patel, Daniel Lee')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Topics', exact: true }).getByText('Astronomy', { exact: true })).toBeVisible();
  await expect(page.getByText('Archived title')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /Archived at/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Manage archive status/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add new book' })).toHaveCount(0);
});

test('admin submits trimmed arrays and sees the refreshed catalogue', async ({ page }) => {
  await session(page, 'Admin');
  const books = [initialBook];
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: books }));
  await page.route('**/api/book/add', async route => {
    expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
    expect(route.request().postDataJSON()).toEqual({ title: 'New title', authors: ['First Author', 'Second Author'], topics: ['History', 'Science'] });
    const book = { _id: 'book-2', ...route.request().postDataJSON(), archivedAt: null };
    books.push(book);
    await route.fulfill({ json: book });
  });
  await page.goto('/books');
  await page.getByRole('button', { name: 'Add new book' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add book', exact: true })).toBeDisabled();
  await dialog.getByLabel('Title', { exact: true }).fill(' New title ');
  await dialog.getByLabel('Authors', { exact: true }).fill(' First Author\nSecond Author\n ');
  await dialog.getByLabel('Topics', { exact: true }).fill('History\nScience');
  await dialog.getByRole('button', { name: 'Add book', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'New title' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Book added successfully.');
});

test('list failure can be retried and failed saves preserve input', async ({ page }) => {
  await session(page, 'Admin');
  let attempts = 0;
  await page.route('**/api/book/retrieve', route => ++attempts === 1
    ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: [] }));
  await page.route('**/api/book/add', route => route.fulfill({ status: 400, json: { detail: 'Invalid book' } }));
  await page.goto('/books');
  await expect(page.getByRole('alert')).toContainText('could not load');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'No books yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Add new book' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Draft title');
  await dialog.getByLabel('Authors', { exact: true }).fill('An Author');
  await dialog.getByLabel('Topics', { exact: true }).fill('Science');
  await dialog.getByRole('button', { name: 'Add book', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Invalid book');
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Draft title');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add new book' })).toBeFocused();
});

test('admin sees all rows and archives then restores a book', async ({ page }) => {
  await session(page, 'Admin');
  const active = { ...initialBook, archivedAt: null as string | null };
  const wire = (book: typeof active) => ({ ...book, _id: { $oid: book._id }, archivedAt: book.archivedAt ? { $date: book.archivedAt } : null });
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const archived = { ...initialBook, _id: 'book-2', title: 'Old title', archivedAt: '2026-09-27T02:30:00Z' };
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [wire(active), wire(archived)] }));
  for (const action of ['archive', 'unarchive']) {
    await page.route(`**/api/book/${action}`, async route => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
      expect(route.request().postDataJSON()).toEqual({ _id: 'book-1' });
      active.archivedAt = action === 'archive' ? '2026-09-27T04:00:00Z' : null;
      await route.fulfill({ json: wire(active) });
    });
  }
  await page.goto('/books');
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'The Night Sky' }) });
  await expect(page.getByRole('columnheader', { name: /Archived at/ })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Old title' })).toBeVisible();
  await expect(page.getByText('27 Sep 2026, 10:30')).toBeVisible();
  await expect(row.locator('.archive-date')).toBeEmpty();
  await row.getByRole('button', { name: /Manage archive status/ }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await dialog.getByLabel('Archived', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.locator('.archive-date')).toHaveText('27 Sep 2026, 12:00');
  await row.getByRole('button', { name: /Manage archive status/ }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Archived', { exact: true })).toBeChecked();
  await dialog.getByLabel('Archived', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.locator('.archive-date')).toBeEmpty();
  await expect(page.getByRole('status')).toHaveText('Book restored successfully.');
  expect(pageErrors).toEqual([]);
});

test('archive cancellation does not send a request and failure keeps the dialog open', async ({ page }) => {
  await session(page, 'Admin');
  let calls = 0;
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [initialBook] }));
  await page.route('**/api/book/archive', route => {
    calls++;
    return route.fulfill({ status: 400, json: { detail: 'Book not found' } });
  });
  await page.goto('/books');
  const manage = page.getByRole('button', { name: /Manage archive status/ });
  await manage.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Archived', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toBe(0);
  await manage.click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Archived', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Archived', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Book not found');
  await expect(page.locator('.archive-date')).toBeEmpty();
  expect(calls).toBe(1);
});
