import { test, expect } from '@playwright/test';

for (const role of ['User', 'Admin']) {
  test(`${role} blocks duplicate catalogue loans and reservations`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { role, email: 'me@example.com' } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: ['available', 'waiting'].map(id => ({ _id: id, title: id, authors: [], topics: [] })) }));
    await page.route('**/api/copy/retrieve', route => {
      const id = route.request().postDataJSON()._id;
      return route.fulfill({ json: [{ _id: id + '-old', status: 'onLoan' }, ...(id === 'available' ? [{ _id: 'new-copy', status: 'available' }] : [])] });
    });
    const suffix = role === 'Admin' ? 'retrieve_all' : 'retrieve';
    await page.route(`**/api/loan/${suffix}`, route => route.fulfill({ json: ['available', 'waiting'].map(id => ({ copyId: { $oid: id + '-old' }, userId: { $oid: 'alice' }, returnedAt: null })) }));
    await page.route(`**/api/reservation/${suffix}`, route => route.fulfill({ json: ['available', 'waiting'].map(bookId => ({ bookId, userId: 'bob', status: 'waiting' })) }));
    await page.route('**/api/users/retrieve', route => route.fulfill({ json: [
      { _id: 'alice', email: 'alice@example.com', role: 'User' },
      { _id: 'bob', email: 'bob@example.com', role: 'User' },
      { _id: 'charlie', email: 'charlie@example.com', role: 'User' },
    ] }));
    await page.goto('/books');
    for (const [action, book] of [['Borrow', 'available'], ['Reserve', 'waiting']]) {
      const button = page.getByRole('button', { name: `${action} ${book}`, exact: true });
      if (role === 'User') {
        await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: book, exact: true }) })).toContainText('Already borrowed');
        await expect(button).toHaveCount(0); continue;
      }
      await button.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('option[value="alice"]')).toHaveText('alice@example.com (already borrowed)');
      await expect(dialog.locator('option[value="alice"]')).toBeDisabled();
      await expect(dialog.locator('option[value="bob"]')).toHaveText('bob@example.com (already reserved)');
      await expect(dialog.locator('option[value="bob"]')).toBeDisabled();
      await expect(dialog.locator('option[value="charlie"]')).toBeEnabled();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    if (role === 'User') {
      // History must not block new loans or reservations.
      await page.route(`**/api/loan/${suffix}`, route => route.fulfill({ json: [{ copyId: 'available-old', returnedAt: '2026-09-28' }] }));
      await page.route(`**/api/reservation/${suffix}`, route => route.fulfill({ json: [{ bookId: 'waiting', status: 'cancelled' }] }));
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Borrow available', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Reserve waiting', exact: true })).toBeEnabled();
    }
  });
}
