import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/loan/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/loan/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [] }));
});

for (const role of ['User', 'Admin']) {
  test(`${role} sees availability colours and appropriate borrow action`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'demo-token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'demo@example.com', role } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: ['Green', 'Yellow', 'Red', 'Empty'].map(title => ({ _id: title, title, authors: ['Author'], topics: [], archivedAt: null })) }));
    let borrowed = false;
    await page.route('**/api/copy/retrieve', route => {
      const id = route.request().postDataJSON()._id;
      return route.fulfill({ json: id === 'Empty' ? [] : [{ _id: { $oid: 'chosen-copy' }, status: id === 'Green' ? (borrowed ? 'onLoan' : 'available') : id === 'Yellow' ? 'reserved' : 'withdrawn' }] });
    });
    await page.route('**/api/copy/borrow', route => {
      expect(route.request().postDataJSON()).toEqual({ copy_id: 'chosen-copy', ...(role === 'Admin' ? { user_id: 'reader-id' } : {}) });
      expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
      borrowed = true;
      return route.fulfill({ json: { copyId: { $oid: 'chosen-copy' } } });
    });
    await page.route('**/api/users/retrieve', route => route.fulfill({ json: [{ _id: { $oid: 'reader-id' }, email: 'reader@example.com', role: 'User' }, { _id: 'admin-id', email: 'admin@example.com', role: 'Admin' }] }));
    await page.goto('/books');
    const row = (title: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: title, exact: true }) });
    await expect(row('Green')).toHaveClass(/copies-available/);
    await expect(row('Yellow')).toHaveClass(/copies-waiting/);
    await expect(row('Red')).toHaveClass(/copies-unavailable/);
    await expect(row('Empty')).toHaveClass(/copies-unavailable/);
    {
      await expect(page.getByRole('button', { name: /^Borrow / })).toHaveCount(1);
      await page.getByRole('button', { name: 'Borrow Green', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('14 days');
      expect(borrowed).toBe(false);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(borrowed).toBe(false);
      await expect(dialog).not.toBeVisible();
      await page.getByRole('button', { name: 'Borrow Green', exact: true }).click();
      if (role === 'Admin') {
        await expect(dialog.getByRole('button', { name: 'Confirm borrow', exact: true })).toBeDisabled();
        await expect(dialog.locator('option')).toHaveCount(2);
        await dialog.getByLabel('Borrow for').selectOption('reader-id');
      }
      await dialog.getByRole('button', { name: 'Confirm borrow', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('status')).toContainText(role === 'Admin' ? 'Borrowed "Green" for reader@example.com' : 'You have borrowed "Green"');
      await expect(row('Green')).toHaveClass(/copies-waiting/);
      await expect(page.getByRole('button', { name: /^Borrow / })).toHaveCount(0);
    }
  });
}

test('unavailable copy conflict is reported and counts refresh', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'demo-token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'user@example.com', role: 'User' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book', title: 'Book', authors: [], topics: [] }] }));
  let conflict = false;
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy', status: conflict ? 'onLoan' : 'available' }] }));
  await page.route('**/api/copy/borrow', route => {
    conflict = true;
    return route.fulfill({ status: 400, json: { detail: 'Copy does not exist or is unavailable' } });
  });
  await page.goto('/books');
  await page.getByRole('button', { name: 'Borrow Book', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm borrow', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Copy does not exist or is unavailable');
  await expect(page.locator('tr.copies-waiting')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Borrow Book', exact: true })).toHaveCount(0);
});


test('admin reserves for a selected member only after confirmation', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { role: 'Admin', email: 'admin@example.com' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book', title: 'Book', authors: [], topics: [] }] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy', status: 'onLoan' }] }));
  await page.route('**/api/users/retrieve', route => route.fulfill({ json: [{ _id: { $oid: 'alice' }, role: 'User', email: 'alice@example.com', name: 'Alice Tan' }, { _id: 'admin', role: 'Admin', email: 'admin@example.com' }] }));
  let calls = 0;
  await page.route('**/api/reservation/new', route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ book_id: 'book', user_id: 'alice' });
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    return route.fulfill({ json: {} });
  });
  await page.goto('/books');
  await page.getByRole('button', { name: 'Reserve Book', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm reservation', exact: true })).toBeDisabled();
  await expect(dialog.locator('option')).toHaveText(['Choose a user', 'alice@example.com / Alice Tan']);
  await dialog.getByLabel('Reserve for').selectOption('alice');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Reserve Book', exact: true }).click();
  await dialog.getByLabel('Reserve for').selectOption('alice');
  await dialog.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reserved "Book" for alice@example.com');
  expect(calls).toBe(1);
});
