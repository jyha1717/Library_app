import { test, expect } from '@playwright/test';

for (const role of ['User', 'Admin']) {
  test(`${role} edits profile inline, cancels drafts and retains failed edits`, async ({ page }) => {
    const user = { email: 'old@example.com', name: 'Old Name', interests: ['Science fiction'], role };
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: user }));
    await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29T00:00:00Z' } }));
    let calls = 0;
    await page.route('**/api/users/change_*', route => {
      calls++;
      expect(route.request().headers()['authorization']).toBe('Bearer token');
      const field = route.request().url().split('change_')[1] as 'email' | 'name' | 'interests';
      const value = field === 'email' ? 'new@example.com' : field === 'name' ? 'New Name' : ['Science fiction', 'Local history'];
      expect(route.request().postDataJSON()).toEqual({ [field]: value });
      if (calls === 1) return route.fulfill({ status: 400, json: { detail: 'Please try again' } });
      Object.assign(user, { [field]: value });
      return route.fulfill({ json: { detail: 'Saved' } });
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Edit name', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Discard me');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(calls).toBe(0);
    await expect(page.getByText('Old Name', { exact: true })).toBeVisible();
    for (const [label, value] of [['Email address', 'new@example.com'], ['Name', 'New Name'], ['Interests', 'Science fiction\n\nLocal history']]) {
      await page.getByRole('button', { name: 'Edit ' + label.toLowerCase(), exact: true }).click();
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      if (label === 'Email address') {
        await expect(page.getByRole('alert')).toHaveText('Please try again');
        await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.session-bar')).toContainText(value);
      }
      await expect(page.getByRole('status')).toHaveText(label + ' updated successfully.');
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    }
    await page.reload();
    const profile = page.getByRole('region', { name: 'Profile information' });
    await expect(profile).toContainText('new@example.com');
    await expect(profile).toContainText('New Name');
    await expect(profile).toContainText('Local history');
  });
}
