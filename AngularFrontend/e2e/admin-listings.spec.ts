import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/loan/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/loan/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [] }));
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'admin-token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
  await page.route('**/api/users/lookup', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer admin-token');
    const id = route.request().postDataJSON().user_id;
    expect(['alice-id', 'bob-id']).toContain(id);
    return route.fulfill({ json: { _id: id, email: id === 'alice-id' ? 'alice@example.com' : 'bob@example.com' } });
  });
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-28T00:00:00Z' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book-1', title: 'Demo book', authors: ['An Author'], topics: ['History'], archivedAt: null }] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy-1', bookId: 'book-1', status: 'onLoan' }] }));
});

for (const kind of ['loan', 'reservation', 'fine']) {
  test(`admin ${kind} table shows owners, colours and refresh without actions`, async ({ page }) => {
    const loans = [
      { _id: 'loan-1', copyId: 'copy-1', userId: { $oid: 'alice-id' }, returnedAt: null, borrowedAt: '2026-09-01T00:00:00Z', dueAt: '2026-09-20T00:00:00Z' },
      { _id: 'loan-2', copyId: 'copy-1', userId: 'bob-id', returnedAt: null, borrowedAt: '2026-09-25T00:00:00Z', dueAt: '2026-10-09T00:00:00Z' },
      { _id: 'old-loan', copyId: 'copy-1', returnedAt: '2026-09-01T00:00:00Z' },
    ];
    const reservations = [
      { _id: 'r-1', bookId: 'book-1', userId: { $oid: 'alice-id' }, status: 'waiting' },
      { _id: 'r-2', bookId: 'book-1', userId: 'bob-id', status: 'ready' },
      { _id: 'r-3', bookId: 'book-1', status: 'cancelled' },
    ];
    const fines = [
      { _id: 'f-1', loanId: 'loan-1', userId: { $oid: 'alice-id' }, amount: 100, assessedAt: '2026-09-28T00:00:00Z', paidAt: null },
      { _id: 'f-2', loanId: 'loan-2', userId: 'bob-id', amount: 50, assessedAt: '2026-09-28T00:00:00Z', paidAt: '2026-09-28T00:00:00Z' },
    ];
    let requests = 0;
    await page.route(`**/api/${kind}/retrieve_all`, route => {
      requests++;
      expect(route.request().headers()['authorization']).toBe('Bearer admin-token');
      if (requests === 2) return route.fulfill({ status: 500, json: {} });
      return route.fulfill({ json: kind === 'loan' ? loans : kind === 'reservation' ? reservations : fines });
    });
    await page.goto(`/${kind}s`);
    await expect(page.getByRole('columnheader', { name: 'User email' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(1);
    await expect(page.locator('tbody tr')).toHaveCount(kind === 'fine' ? 1 : 2);
    await expect(page.locator('tbody button')).toHaveCount(kind === 'loan' ? 2 : kind === 'reservation' ? 3 : 1);
    await expect(page.getByRole('cell', { name: 'alice@example.com', exact: true })).toBeVisible();
    if (kind !== 'fine') await expect(page.getByRole('cell', { name: 'bob@example.com', exact: true })).toBeVisible();
    await expect(page.locator('tbody tr.row-green')).toHaveCount(kind === 'fine' ? 0 : 1);
    await expect(page.locator(kind === 'reservation' ? 'tbody tr.row-yellow' : 'tbody tr.row-red')).toHaveCount(kind === 'fine' ? 0 : 1);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Unable to load');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(kind === 'fine' ? 1 : 2);
    expect(requests).toBe(3);
    if (kind === 'reservation') {
      for (const action of ['cancel', 'borrow']) {
        let calls = 0;
        await page.route(`**/api/reservation/${action}`, route => {
          calls++;
          expect(route.request().postDataJSON()).toEqual({ reservation_id: action === 'cancel' ? 'r-1' : 'r-2', user_id: action === 'cancel' ? 'alice-id' : 'bob-id' });
          expect(route.request().headers()['authorization']).toBe('Bearer admin-token');
          reservations[action === 'cancel' ? 0 : 1].status = action === 'cancel' ? 'cancelled' : 'fulfilled';
          return route.fulfill({ json: {} });
        });
        const button = page.locator('tbody').getByRole('button', { name: action === 'cancel' ? 'Cancel reservation' : 'Borrow', exact: true }).first();
        await button.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(action === 'cancel' ? 'alice@example.com' : 'bob@example.com');
        await dialog.getByRole('button', { name: action === 'cancel' ? 'Keep reservation' : 'Cancel', exact: true }).click();
        expect(calls).toBe(0);
        await button.click();
        await dialog.getByRole('button', { name: action === 'cancel' ? 'Confirm cancellation' : 'Confirm borrow', exact: true }).click();
        await expect(page.locator('tbody tr')).toHaveCount(action === 'cancel' ? 1 : 0);
        expect(calls).toBe(1);
      }
    }
    if (kind === 'fine') {
      let calls = 0;
      await page.route('**/api/fine/pay', route => {
        calls++;
        expect(route.request().postDataJSON()).toEqual({ fine_id: 'f-1', user_id: 'alice-id' });
        expect(route.request().headers()['authorization']).toBe('Bearer admin-token');
        if (calls === 1) return route.fulfill({ status: 400, json: { detail: 'Try again' } });
        return route.fulfill({ json: { ...fines[0], paidAt: '2026-09-28T00:00:00Z' } });
      });
      await page.getByRole('button', { name: 'Pay fine', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('alice@example.com');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(calls).toBe(0);
      await page.getByRole('button', { name: 'Pay fine', exact: true }).click();
      await dialog.getByRole('button', { name: 'Confirm payment', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText('Try again');
      await dialog.getByRole('button', { name: 'Confirm payment', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
    }
    if (kind === 'loan') {
      let returns = 0;
      await page.route('**/api/loan/return', route => {
        returns++;
        expect(route.request().postDataJSON()).toEqual({ loan_id: 'loan-1', user_id: 'alice-id' });
        expect(route.request().headers()['authorization']).toBe('Bearer admin-token');
        loans[0].returnedAt = '2026-09-28T00:00:00Z';
        return route.fulfill({ json: {} });
      });
      await page.locator('tbody tr').first().getByRole('button').click();
      await expect(page.getByRole('dialog')).toContainText('alice@example.com');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(returns).toBe(0);
      await page.locator('tbody tr').first().getByRole('button').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm return', exact: true }).click();
      await expect(page.locator('tbody tr')).toHaveCount(1);
      expect(returns).toBe(1);
    }
  });
}
