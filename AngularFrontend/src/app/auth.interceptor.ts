import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenStore } from './token-store';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(TokenStore).get();
  // Only send credentials to this application's API, never unrelated hosts.
  if (token && request.url.startsWith('/api/') && !['/api/users/login', '/api/users/create'].includes(request.url)) {
    request = request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(request);
};
