import { test, expect } from '@playwright/test';

test('loan colours follow simulated time and update when the server clock advances', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'user@example.com', role: 'User' } }));
  let now = '2030-01-01T00:00:00Z';
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: now } }));
  const dates = ['2030-01-05T00:00:00Z', '2030-01-04T00:00:00Z', '2030-01-02T00:00:00Z', '2029-12-31T00:00:00Z'];
  await page.route('**/api/loan/retrieve', route => route.fulfill({ json: dates.map((dueAt, i) => ({ _id: `loan-${i}`, copyId: `copy-${i}`, dueAt: { $date: dueAt }, returnedAt: null })) }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  await page.goto('/loans');
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveClass(/row-green/);
  await expect(rows.nth(1)).toHaveClass(/row-yellow/);
  await expect(rows.nth(2)).toHaveClass(/row-yellow/);
  await expect(rows.nth(3)).toHaveClass(/row-red/);
  now = '2030-01-10T00:00:00Z';
  await page.reload();
  await expect(page.locator('tbody tr.row-red')).toHaveCount(4);
});

test('member loans resolve book details, exclude returns, and survive refresh', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'user@example.com', role: 'User' } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-28T00:00:00Z' } }));
  let returned = false;
  await page.route('**/api/loan/return', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    expect(route.request().postDataJSON()).toEqual({ loan_id: 'loan-1' });
    returned = true;
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/loan/retrieve', route => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    return route.fulfill({ json: [
      { _id: { $oid: 'loan-1' }, copyId: { $oid: 'copy-1' }, returnedAt: returned ? { $date: '2026-09-29T00:00:00Z' } : null, borrowedAt: { $date: '2026-09-28T02:30:00Z' }, dueAt: '2026-10-12T02:30:00Z' },
      { _id: 'loan-2', copyId: 'copy-2', returnedAt: { $date: '2026-01-01' } },
    ] });
  });
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book', title: 'Borrowed book', authors: ['Author'], topics: ['History'], archivedAt: '2026-01-01' }] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: { $oid: 'copy-1' }, status: 'onLoan' }] }));
  await page.goto('/books');
  await page.getByRole('link', { name: 'My loans' }).click();
  await expect(page.getByRole('rowheader', { name: 'Borrowed book' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'copy-1', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Author', exact: true })).toBeVisible();
  await expect(page.locator('tbody').getByText('History', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '28 Sep 2026, 10:30', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '12 Oct 2026, 10:30', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Return Borrowed book', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('rowheader', { name: 'Borrowed book' })).toBeVisible();
  await expect(page).toHaveURL(/\/loans$/);
  await page.getByRole('button', { name: 'Return Borrowed book', exact: true }).click();
  expect(returned).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(returned).toBe(false);
  await page.getByRole('button', { name: 'Return Borrowed book', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm return', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Returned' })).toContainText('Returned');
  await expect(page.getByRole('heading', { name: 'No current loans' })).toBeVisible();
});

test('admin loads all loans instead of personal loans', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  let requests = 0;
  await page.route('**/api/loan/retrieve', route => { requests++; return route.fulfill({ json: [] }); });
  await page.route('**/api/loan/retrieve_all', route => route.fulfill({ json: [] }));
  await page.goto('/loans');
  await expect(page.getByRole('heading', { name: 'All loans', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No current loans' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My loans' })).toHaveCount(0);
  expect(requests).toBe(0);
});
