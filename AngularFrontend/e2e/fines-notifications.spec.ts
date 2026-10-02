import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'user@example.com', role: 'User' } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-28T00:00:00Z' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
});

test('notifications show newest first and mark read without confirmation', async ({ page }) => {
  const older = { _id: 'old', title: 'Older message', content: 'Already read', createdAt: '2026-09-01T00:00:00Z', readAt: '2026-09-02T00:00:00Z' };
  const newer = { _id: { $oid: 'new' }, title: 'New message', content: 'Your book is ready.', createdAt: { $date: '2026-09-28T00:00:00Z' }, readAt: null as unknown };
  await page.route('**/api/notification/retrieve', route => route.fulfill({ json: [older, newer] }));
  await page.route('**/api/notification/read', route => {
    expect(route.request().postDataJSON()).toEqual({ notification_id: 'new' });
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    newer.readAt = { $date: '2026-09-28T01:00:00Z' };
    return route.fulfill({ json: newer });
  });
  await page.goto('/notifications');
  await expect(page.getByRole('navigation').getByRole('link')).toHaveText(['Notifications1', 'Book catalogue', 'My loans', 'My reservations', 'My fines', 'History', 'Settings']);
  await expect(page.locator('tbody tr').first()).toContainText('New message');
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Read', exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('fines exclude paid history and require confirmation before full payment', async ({ page }) => {
  const unpaid = { _id: { $oid: 'fine-1' }, loanId: { $oid: 'loan-1' }, amount: 150, assessedAt: { $date: '2026-09-28T00:00:00Z' }, paidAt: null as unknown };
  const paid = { _id: 'fine-2', loanId: 'loan-2', amount: 50, assessedAt: '2026-09-20T00:00:00Z', paidAt: '2026-09-21T00:00:00Z' };
  await page.route('**/api/fine/retrieve', route => route.fulfill({ json: [unpaid, paid] }));
  let payments = 0;
  await page.route('**/api/fine/pay', route => {
    expect(route.request().postDataJSON()).toEqual({ fine_id: 'fine-1' });
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    payments++;
    if (payments === 1) return route.fulfill({ status: 400, json: { detail: 'Please try again' } });
    unpaid.paidAt = { $date: '2026-09-28T01:00:00Z' };
    return route.fulfill({ json: unpaid });
  });
  await page.goto('/fines');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr.row-green, tbody tr.row-red')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /^SGD\s*1\.50$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Pay fine' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/SGD\s*1\.50/);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(payments).toBe(0);
  await page.getByRole('button', { name: 'Pay fine' }).click();
  await dialog.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Please try again');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pay fine' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('empty states, retrieval failure and admin access', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/notification/retrieve', route => ++attempts === 1 ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: [] }));
  await page.route('**/api/fine/retrieve', route => route.fulfill({ json: [] }));
  await page.goto('/notifications');
  await expect(page.getByRole('alert')).toContainText('Unable to load');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'No notifications yet' })).toBeVisible();
  await page.getByRole('link', { name: 'My fines', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No outstanding fines', exact: true })).toBeVisible();
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
  await page.route('**/api/notification/retrieve_all', route => route.fulfill({ json: [] }));
  for (const path of ['/notifications']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'All notifications' })).toBeVisible();
  }
});
