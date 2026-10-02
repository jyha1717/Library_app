import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/loan/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/loan/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve_all', route => route.fulfill({ json: [] }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [] }));
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'user@example.com', role: 'User' } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-28T00:00:00Z' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: { $oid: 'book-1' }, title: 'Reserved book', authors: ['Author'], topics: ['History'], archivedAt: null }] }));
});

test('user sees ready/waiting reservations and can refresh the page', async ({ page }) => {
  await page.route('**/api/reservation/retrieve', route => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    return route.fulfill({ json: ['ready', 'waiting', 'fulfilled', 'cancelled'].map(status => ({ _id: { $oid: status }, bookId: { $oid: 'book-1' }, status })) });
  });
  await page.goto('/books');
  await page.getByRole('link', { name: 'My reservations' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('cell', { name: 'ready', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'waiting', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'ready', exact: true }) })).toHaveClass(/row-green/);
  await expect(page.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'waiting', exact: true }) })).toHaveClass(/row-yellow/);
  await expect(page.getByRole('rowheader', { name: 'Reserved book' })).toHaveCount(2);
  await expect(page.getByRole('cell', { name: 'Author', exact: true })).toHaveCount(2);
  await expect(page.locator('tbody').getByText('History', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cancel reservation', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Borrow', exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My reservations' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page).toHaveURL(/\/reservations$/);
});

test('failed request can be retried and empty state is shown', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/reservation/retrieve', route => ++attempts === 1 ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: [] }));
  await page.goto('/reservations');
  await expect(page.getByRole('alert')).toContainText('Unable to load');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'No current reservations' })).toBeVisible();
});

test('admin loads all reservations instead of personal reservations', async ({ page }) => {
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
  let calls = 0;
  await page.route('**/api/reservation/retrieve', route => { calls++; return route.fulfill({ json: [] }); });
  await page.route('**/api/reservation/retrieve_all', route => route.fulfill({ json: [] }));
  await page.goto('/reservations');
  await expect(page.getByRole('heading', { name: 'All reservations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No current reservations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My reservations' })).toHaveCount(0);
  expect(calls).toBe(0);
});

test('cancel waiting and ready reservations and confirm borrowing', async ({ page }) => {
  let items = [{ _id: { $oid: 'waiting-id' }, bookId: 'book-1', status: 'waiting' }, { _id: { $oid: 'ready-id' }, bookId: 'book-1', status: 'ready' }];
  await page.route('**/api/reservation/retrieve', route => route.fulfill({ json: items }));
  await page.route('**/api/reservation/cancel', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    const id = route.request().postDataJSON().reservation_id;
    expect(['waiting-id', 'ready-id']).toContain(id);
    items = items.filter(item => item._id.$oid !== id);
    return route.fulfill({ json: {} });
  });
  let borrowed = false;
  await page.route('**/api/reservation/borrow', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    expect(route.request().postDataJSON()).toEqual({ reservation_id: 'ready-id' });
    borrowed = true;
    items = [];
    return route.fulfill({ json: {} });
  });
  await page.goto('/reservations');
  await page.locator('tbody tr').filter({ hasText: 'waiting' }).getByRole('button', { name: 'Cancel reservation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep reservation' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('tbody tr').filter({ hasText: 'waiting' }).getByRole('button', { name: 'Cancel reservation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Borrow', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('14 days');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(borrowed).toBe(false);
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('heading', { name: 'No current reservations' })).toBeVisible();
  items = [{ _id: { $oid: 'ready-id' }, bookId: 'book-1', status: 'ready' }];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Borrow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm borrow' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'No current reservations' })).toBeVisible();
  expect(borrowed).toBe(true);
});

test('reserve from catalogue sends book ID and displays API errors', async ({ page }) => {
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy', status: 'onLoan' }] }));
  let calls = 0;
  await page.route('**/api/reservation/new', route => {
    expect(route.request().postDataJSON()).toEqual({ book_id: 'book-1' });
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    return ++calls === 1 ? route.fulfill({ json: {} }) : route.fulfill({ status: 400, json: { detail: 'Reservation already exists' } });
  });
  await page.goto('/books');
  await page.getByRole('button', { name: 'Reserve Reserved book', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Reserve Reserved book', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('View its status in My reservations');
  await page.getByRole('button', { name: 'Reserve Reserved book', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Reservation already exists');
});
