import { test, expect } from '@playwright/test';

for (const role of ['User', 'Admin']) {
  test(`${role} can view copies${role === 'Admin' ? ' and add multiple copies' : ' without adding them'}`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'demo-token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'demo@example.com', role } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: { $oid: 'book-1' }, title: 'Test book', authors: ['Author'], topics: ['Science'], archivedAt: null }] }));
    const copies = [{ _id: { $oid: 'copy-1' }, bookId: { $oid: 'book-1' }, status: 'onLoan', createdAt: { $date: '2026-09-27T04:00:00Z' } }];
    copies.push({ ...copies[0], _id: { $oid: 'withdrawn-copy' }, status: 'withdrawn' });
    await page.route('**/api/copy/retrieve', route => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ _id: 'book-1' });
      expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
      return route.fulfill({ json: copies });
    });
    await page.route('**/api/copy/add', route => {
      expect(role).toBe('Admin');
      expect(route.request().postDataJSON()).toEqual({ _id: 'book-1', count: 2 });
      expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
      copies.push(...[2, 3].map(i => ({ ...copies[0], _id: { $oid: `copy-${i}` }, status: 'available' })));
      return route.fulfill({ status: 201, json: { detail: 'Copies added' } });
    });
    await page.goto('/books');
    const summary = page.locator('app-copy-counts');
    await expect(summary.locator('[data-status=onLoan] dd')).toHaveText('1');
    await expect(summary.locator('[data-status=reserved] dd')).toHaveText('0');
    if (role === 'Admin') await expect(summary.locator('[data-status=withdrawn] dd')).toHaveText('1');
    else await expect(summary.locator('[data-status=withdrawn]')).toHaveCount(0);
    await page.getByRole('button', { name: 'View copies of Test book' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('rowheader', { name: 'copy-1' })).toBeVisible();
    await expect(dialog.getByRole('cell', { name: 'On loan', exact: true })).toBeVisible();
    await expect(dialog.getByText('27 Sep 2026, 12:00').first()).toBeVisible();
    await expect(dialog.locator('[data-status=onLoan] dd')).toHaveText('1');
    await expect(dialog.locator('[data-status=available] dd')).toHaveText('0');
    await expect(dialog.locator('[data-status=reserved] dd')).toHaveText('0');
    if (role === 'User') {
      await expect(dialog.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^Reactivate copy/ })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^Withdraw copy/ })).toHaveCount(0);
      await expect(dialog.locator('[data-status=withdrawn]')).toHaveCount(0);
      await expect(dialog.getByRole('rowheader', { name: 'withdrawn-copy' })).toHaveCount(0);
      await expect(dialog.getByRole('heading', { name: 'Copies (1)', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Add copies', exact: true })).toHaveCount(0);
    } else {
      await expect(dialog.locator('[data-status=withdrawn] dd')).toHaveText('1');
      await expect(dialog.getByRole('rowheader', { name: 'withdrawn-copy' })).toBeVisible();
      await dialog.getByLabel('Number of new copies').fill('0');
      await expect(dialog.getByRole('button', { name: 'Add copies', exact: true })).toBeDisabled();
      await dialog.getByLabel('Number of new copies').fill('1.5');
      await expect(dialog.getByRole('button', { name: 'Add copies', exact: true })).toBeDisabled();
      await dialog.getByLabel('Number of new copies').fill('2');
      await dialog.getByRole('button', { name: 'Add copies', exact: true }).click();
      await expect(dialog.getByRole('rowheader', { name: 'copy-3' })).toBeVisible();
      await expect(dialog.getByText('2 copies added successfully.')).toBeVisible();
      await expect(dialog.locator('[data-status=available] dd')).toHaveText('2');
      await expect(dialog.getByRole('heading', { name: 'Copies (4)', exact: true })).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Close copies' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(summary.locator('[data-status=available] dd')).toHaveText(role === 'Admin' ? '2' : '0');
  });
}


test('admin withdraws available copies and archive eligibility follows live counts', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
  const statuses = ['available', 'onLoan', 'reserved', 'withdrawn', 'empty', 'failed'];
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: statuses.map(status => ({ _id: status, title: status, authors: [], topics: [], archivedAt: null })) }));
  let withdrawn = false;
  await page.route('**/api/copy/retrieve', route => {
    const id = route.request().postDataJSON()._id;
    if (id === 'failed') return route.fulfill({ status: 500, json: {} });
    return route.fulfill({ json: id === 'empty' ? [] : [{ _id: { $oid: 'copy-' + id }, bookId: id, status: id === 'available' && withdrawn ? 'withdrawn' : id, createdAt: '2026-09-28T00:00:00Z' }] });
  });
  let attempts = 0;
  await page.route('**/api/copy/withdraw', route => {
    expect(route.request().postDataJSON()).toEqual({ copy_id: 'copy-available' });
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    if (++attempts === 1) return route.fulfill({ status: 400, json: { detail: 'Unable to withdraw' } });
    withdrawn = true;
    return route.fulfill({ json: null });
  });
  await page.goto('/books');
  const archive = (title: string) => page.getByRole('button', { name: 'Manage archive status for ' + title, exact: true });
  await expect(archive('withdrawn')).toBeVisible();
  await expect(archive('empty')).toBeVisible();
  for (const status of ['available', 'onLoan', 'reserved', 'failed']) await expect(archive(status)).toHaveCount(0);
  await page.getByRole('button', { name: 'View copies of available', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Withdraw copy copy-available', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Unable to withdraw');
  await dialog.getByRole('button', { name: 'Withdraw copy copy-available', exact: true }).click();
  await expect(dialog.getByRole('cell', { name: 'Withdrawn', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Withdraw copy/ })).toHaveCount(0);
  await expect(dialog.locator('[data-status=withdrawn] dd')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Close copies' }).click();
  await expect(archive('available')).toBeVisible();
  for (const status of ['onLoan', 'reserved', 'withdrawn']) {
    await page.getByRole('button', { name: 'View copies of ' + status, exact: true }).click();
    await expect(dialog.getByRole('cell', { name: status === 'onLoan' ? 'On loan' : status === 'reserved' ? 'Reserved' : 'Withdrawn', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Withdraw copy/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close copies' }).click();
  }
});

for (const archived of [false, true]) {
  test(`admin can restore withdrawn copies only for active books (archived=${archived})`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'admin@example.com', role: 'Admin' } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: [{ _id: 'book', title: 'Restorable book', authors: [], topics: [], archivedAt: archived ? '2026-09-28T00:00:00Z' : null }] }));
    let status = 'withdrawn';
    await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'copy', bookId: 'book', status, createdAt: '2026-09-28T00:00:00Z' }] }));
    let attempts = 0;
    await page.route('**/api/copy/reactivate', route => {
      expect(archived).toBe(false);
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ copy_id: 'copy' });
      expect(route.request().headers()['authorization']).toBe('Bearer token');
      if (++attempts === 1) return route.fulfill({ status: 400, json: { detail: 'Cannot restore this copy' } });
      status = 'available';
      return route.fulfill({ json: null });
    });
    await page.goto('/books');
    await page.getByRole('button', { name: 'View copies of Restorable book', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('cell', { name: 'Withdrawn', exact: true })).toBeVisible();
    const restore = dialog.getByRole('button', { name: 'Reactivate copy copy', exact: true });
    if (archived) {
      await expect(restore).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^Withdraw copy/ })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Add copies', exact: true })).toHaveCount(0);
      return;
    }
    await restore.click();
    await expect(dialog.getByRole('alert')).toHaveText('Cannot restore this copy');
    await restore.click();
    await expect(dialog.getByRole('cell', { name: 'Available', exact: true })).toBeVisible();
    await expect(restore).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Withdraw copy copy', exact: true })).toBeVisible();
    await expect(dialog.locator('[data-status=available] dd')).toHaveText('1');
    await dialog.getByRole('button', { name: 'Close copies' }).click();
    await expect(page.locator('app-copy-counts [data-status=available] dd')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Manage archive status for Restorable book', exact: true })).toHaveCount(0);
  });
}
