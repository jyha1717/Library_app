import { test, expect } from '@playwright/test';

for (const role of ['User', 'Admin']) {
  test(`${role} history contains only returned loans, completed reservations and paid fines`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { role, email: 'me@example.com' } }));
    await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29T00:00:00Z' } }));
    await page.route('**/api/users/lookup', route => route.fulfill({ json: { email: 'alice@example.com' } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book', title: 'Archived book', authors: ['Author'], topics: ['History'], archivedAt: '2026-09-29' }] }));
    await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy', bookId: 'book', status: 'withdrawn' }] }));
    const suffix = role === 'Admin' ? 'retrieve_all' : 'retrieve';
    await page.route(`**/api/loan/${suffix}`, route => route.fulfill({ json: [null, '2026-09-28'].map((returnedAt, i) => ({ _id: 'loan-' + i, copyId: 'copy', userId: 'alice', borrowedAt: '2026-09-01', dueAt: '2026-09-15', returnedAt })) }));
    await page.route(`**/api/reservation/${suffix}`, route => route.fulfill({ json: ['waiting', 'ready', 'fulfilled', 'cancelled'].map(status => ({ _id: status, bookId: 'book', userId: 'alice', status })) }));
    await page.route(`**/api/fine/${suffix}`, route => route.fulfill({ json: [null, '2026-09-28'].map((paidAt, i) => ({ _id: 'fine-' + i, loanId: 'loan-' + i, userId: 'alice', amount: 50, assessedAt: '2026-09-20', paidAt })) }));
    await page.goto('/history');
    for (const selector of ['app-loans', 'app-reservations', 'app-fines']) {
      const section = page.locator(selector);
      await expect(section.locator('tbody tr')).toHaveCount(selector === 'app-reservations' ? 2 : 1);
      await expect(section.locator('tbody button')).toHaveCount(0);
      await expect(section.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCount(0);
      if (role === 'Admin') await expect(section.getByRole('cell', { name: 'alice@example.com', exact: true })).toHaveCount(selector === 'app-reservations' ? 2 : 1);
    }
    const reservations = page.locator('app-reservations');
    await expect(reservations.locator('tbody')).toContainText('fulfilled');
    await expect(reservations.locator('tbody')).toContainText('cancelled');
    for (const status of ['Fulfilled', 'Cancelled']) {
      await reservations.getByRole('button', { name: 'Filter reservation status', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Filter reservation status', exact: true });
      await expect(dialog.getByRole('checkbox')).toHaveCount(2);
      await dialog.getByRole('button', { name: 'Clear all', exact: true }).click();
      await dialog.getByRole('checkbox', { name: status, exact: true }).check();
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(reservations.locator('tbody tr')).toHaveCount(1);
      await expect(reservations.getByRole('cell', { name: status.toLowerCase(), exact: true })).toBeVisible();
      await reservations.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(reservations.locator('tbody tr')).toHaveCount(1);
    }
    await expect(page.locator('app-fines').getByRole('columnheader', { name: 'Status', exact: true })).toHaveCount(0);
    await expect(page.locator('app-fines').getByRole('columnheader', { name: 'Paid at (SGT)', exact: true })).toBeVisible();
    await expect(page.locator('app-loans').getByRole('columnheader', { name: 'Return date (SGT)', exact: true })).toBeVisible();
    await expect(page.locator('app-loans').getByRole('cell', { name: '28 Sep 2026, 08:00', exact: true })).toBeVisible();
    await expect(page.locator('app-loans tbody')).toContainText('Archived book');
    await page.locator('app-loans').getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('app-loans tbody tr')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: role === 'Admin' ? 'All History' : 'History', exact: true })).toBeVisible();
  });
}

test('admin notifications show owners between status and actions and support marking read', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { role: 'Admin', email: 'admin@example.com' } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29T00:00:00Z' } }));
  await page.route('**/api/users/lookup', route => route.fulfill({ json: { email: 'alice@example.com' } }));
  const item = { _id: 'notice', userId: { $oid: 'alice' }, title: 'A notice', content: 'Message', createdAt: '2026-09-29', readAt: null as string | null };
  await page.route('**/api/notification/retrieve_all', route => route.fulfill({ json: [item] }));
  await page.route('**/api/notification/read', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    expect(route.request().postDataJSON()).toEqual({ notification_id: 'notice', user_id: 'alice' });
    item.readAt = '2026-09-29';
    return route.fulfill({ json: item });
  });
  await page.goto('/notifications');
  await expect(page.getByRole('columnheader')).toHaveText(['Title', 'Message', 'Created at (SGT)', 'Status', 'User email', 'Actions']);
  await expect(page.getByRole('navigation').locator('a, button')).toHaveText(['Set time', 'All notifications', 'Book catalogue', 'All loans', 'All reservations', 'All fines', 'All History', 'Settings']);
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByRole('cell', { name: 'Read', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'alice@example.com', exact: true })).toBeVisible();
});
