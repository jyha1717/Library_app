import { test, expect } from '@playwright/test';

for (const role of ['User', 'Admin']) {
  test(`${role} navigation and simulated clock`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: { email: 'demo@example.com', role } }));
    await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
    let time = '2026-09-28T02:30:15Z';
    let writes = 0;
    await page.route('**/api/time/retrieve', route => {
      expect(route.request().headers()['authorization']).toBe('Bearer token');
      return route.fulfill({ json: { current_time: { $date: time } } });
    });
    await page.route('**/api/time/set', route => {
      expect(role).toBe('Admin');
      expect(route.request().postDataJSON()).toEqual({ set_to: '2026-10-28T02:30:15.000Z' });
      expect(route.request().headers()['authorization']).toBe('Bearer token');
      time = route.request().postDataJSON().set_to;
      writes++;
      return route.fulfill({ json: {} });
    });
    await page.goto('/books');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Book catalogue' })).toBeVisible();
    await expect(page.getByLabel('Current library time')).toContainText('28 Sep 2026, 10:30:');
    if (role === 'User') {
      await expect(page.getByRole('button', { name: 'Set time', exact: true })).toHaveCount(0);
    } else {
      await page.getByRole('navigation').getByRole('button', { name: 'Set time', exact: true }).click();
      const dialog = page.getByRole('dialog');
      for (const [label, value] of Object.entries({ Year: '2026', Month: '9', Day: '28', Hour: '10', Minute: '30', Second: '15' })) {
        await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
      }
      await dialog.getByLabel('Month', { exact: true }).fill('2');
      await dialog.getByLabel('Day', { exact: true }).fill('30');
      await expect(dialog.getByRole('button', { name: 'Set time', exact: true })).toBeDisabled();
      await dialog.getByLabel('Month', { exact: true }).fill('8');
      await dialog.getByLabel('Day', { exact: true }).fill('28');
      await dialog.getByRole('button', { name: 'Set time', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('later than');
      expect(writes).toBe(0);
      await dialog.getByLabel('Month', { exact: true }).fill('10');
      await dialog.getByRole('button', { name: 'Set time', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByLabel('Current library time')).toContainText('28 Oct 2026, 10:30:');
      expect(writes).toBe(1);
    }
  });
}
