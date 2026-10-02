import { test, expect } from '@playwright/test';

test('login, bearer authentication, refresh, and logout', async ({ page }) => {
  await page.route('**/api/users/login', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'alice@example.com', password: 'demo-password' });
    expect(route.request().headers()['authorization']).toBeUndefined();
    await route.fulfill({ json: { access_token: 'demo-token', token_type: 'bearer' } });
  });
  await page.route('**/api/users/me', async route => {
    expect(route.request().headers()['authorization']).toBe('Bearer demo-token');
    await route.fulfill({ json: { email: 'alice@example.com', role: 'User' } });
  });
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await page.getByLabel('Email address').fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('alice@example.com', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('data4life.accessToken'))).toBe('demo-token');
  await page.reload();
  await expect(page.getByText('alice@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('data4life.accessToken'))).toBeNull();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('incorrect credentials show an error without storing a token', async ({ page }) => {
  await page.route('**/api/users/login', route => route.fulfill({ status: 400, json: { detail: 'Incorrect username or password' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('Email address').fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect username or password');
  expect(await page.evaluate(() => sessionStorage.getItem('data4life.accessToken'))).toBeNull();
});

test('invalid saved session is cleared', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'expired-token'));
  await page.route('**/api/users/me', route => route.fulfill({ status: 400, json: { detail: 'Token Expired' } }));
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Please sign in again');
  expect(await page.evaluate(() => sessionStorage.getItem('data4life.accessToken'))).toBeNull();
});
