import { test, expect } from '@playwright/test';

test('user badge polls, preserves count on errors and clears when notifications are read', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { role: 'User', email: 'user@example.com' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/loan/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/reservation/retrieve', route => route.fulfill({ json: [] }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29' } }));
  const items = [{ _id: 'one', title: 'One', content: 'First', createdAt: '2026-09-29', readAt: null as string | null }];
  let fail = false;
  await page.route('**/api/notification/retrieve', route => fail ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: items }));
  await page.route('**/api/notification/read', route => {
    expect(route.request().headers()['authorization']).toBe('Bearer token');
    const item = items.find(item => item._id === route.request().postDataJSON().notification_id)!;
    item.readAt = '2026-09-29';
    return route.fulfill({ json: item });
  });
  await page.goto('/books');
  const badge = page.locator('.unread-badge');
  await expect(badge).toHaveText('1');
  items.push({ ...items[0], _id: 'two', title: 'Two' });
  await page.clock.fastForward(10000);
  await expect(badge).toHaveText('2');
  fail = true;
  await page.clock.fastForward(10000);
  await expect(badge).toHaveText('2');
  fail = false;
  await page.getByRole('link', { name: /Notifications/ }).click();
  await expect(page.locator('tbody tr.notification-read')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark as read', exact: true }).first().click();
  await expect(badge).toHaveText('1');
  await expect(page.locator('tbody tr.notification-read')).toHaveCount(1);
  await expect(page.locator('tbody tr.notification-read td').first()).toHaveCSS('background-color', 'rgb(229, 229, 229)');
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.clock.fastForward(10000);
  await expect(badge).toHaveCount(0);
});

test('admin has no badge and read notifications are grey', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { role: 'Admin', email: 'admin@example.com' } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29' } }));
  await page.route('**/api/users/lookup', route => route.fulfill({ json: { email: 'user@example.com' } }));
  let personalRequests = 0;
  await page.route('**/api/notification/retrieve', route => { personalRequests++; return route.fulfill({ json: [] }); });
  await page.route('**/api/notification/retrieve_all', route => route.fulfill({ json: [null, '2026-09-29'].map((readAt, i) => ({ _id: String(i), userId: 'user', title: 'Notice ' + i, content: 'Message', createdAt: '2026-09-29', readAt })) }));
  await page.goto('/notifications');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr.notification-read')).toHaveCount(1);
  await expect(page.locator('tbody tr.notification-read td').first()).toHaveCSS('background-color', 'rgb(229, 229, 229)');
  await expect(page.locator('.unread-badge')).toHaveCount(0);
  expect(personalRequests).toBe(0);
});
