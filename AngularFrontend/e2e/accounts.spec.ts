import { test, expect } from '@playwright/test';

test('create account checks matching passwords and preserves spaces in interests', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/users/create', route => {
    requests++;
    expect(route.request().headers()['authorization']).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ email: 'new@example.com', password: 'demo', name: 'New Reader', interests: ['Science fiction', 'Local history'] });
    if (requests === 1) return route.fulfill({ status: 400, json: { detail: 'Email address already exists' } });
    return route.fulfill({ json: { email: 'new@example.com' } });
  });
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('secret');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create new user', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create new user', exact: true })).toBeVisible();
  await page.getByLabel('Email address').fill('new@example.com');
  await page.getByLabel('Name', { exact: true }).fill('New Reader');
  await page.getByLabel('Interests', { exact: true }).fill('Science fiction\n\nLocal history');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  await page.getByLabel('Re-type password', { exact: true }).fill('different');
  await page.getByRole('button', { name: 'Show re-type password', exact: true }).click();
  await expect(page.getByLabel('Re-type password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  expect(requests).toBe(0);
  await page.getByLabel('Re-type password', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email address already exists');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account created');
  await expect(page.getByLabel('Email address')).toHaveValue('new@example.com');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

for (const role of ['User', 'Admin']) {
  test(`${role} profile uses full user response and changes password with bearer token`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
    await page.route('**/api/users/me', route => route.fulfill({ json: {
      _id: { $oid: 'user-id' }, email: 'reader@example.com', role, name: 'Demo Reader',
      interests: ['Science fiction', 'History'], createdAt: { $date: '2026-09-28T00:00:00Z' },
    } }));
    await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-28T00:00:00Z' } }));
    let calls = 0;
    await page.route('**/api/users/change_password', route => {
      calls++;
      expect(route.request().headers()['authorization']).toBe('Bearer token');
      expect(route.request().postDataJSON()).toEqual({ password: 'old', new_password: 'new' });
      if (calls === 1) return route.fulfill({ status: 400, json: { detail: 'Incorrect old password' } });
      return route.fulfill({ json: { detail: 'Successfully changed password' } });
    });
    await page.goto('/settings');
    await expect(page.getByRole('navigation').getByRole('link').last()).toHaveText('Settings');
    await expect(page.getByRole('region', { name: 'Profile information' })).toContainText('Demo Reader');
    await expect(page.getByRole('region', { name: 'Profile information' })).toContainText('Science fiction');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Old password', { exact: true }).fill('old');
    await dialog.getByLabel('New password', { exact: true }).fill('new');
    await dialog.getByRole('button', { name: 'Save password' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('The passwords do not match.');
    expect(calls).toBe(0);
    await dialog.getByLabel('Re-type new password', { exact: true }).fill('new');
    await dialog.getByRole('button', { name: 'Save password' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Incorrect old password');
    await dialog.getByRole('button', { name: 'Save password' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Password changed successfully.');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(dialog.getByLabel('Old password', { exact: true })).toHaveValue('');
  });
}


test('registration requires nonblank identity and password fields but allows empty interests', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/users/create', route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ email: 'new@example.com', password: ' demo ', name: 'New Reader', interests: [] });
    return route.fulfill({ json: { email: 'new@example.com' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new user', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create new user', exact: true })).toBeVisible();
  const values = { 'Email address': 'new@example.com', 'Password': ' demo ', 'Re-type password': ' demo ', 'Name': 'New Reader' };
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries(values)) {
    for (const blank of ['', '   ']) {
      await page.getByLabel(label, { exact: true }).fill(blank);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('cannot be blank');
      expect(calls).toBe(0);
    }
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account created');
  expect(calls).toBe(1);
});
