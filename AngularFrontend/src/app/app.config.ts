import { History } from './history';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';
import { provideRouter } from '@angular/router';
import { Books } from './books';
import { Loans } from './loans';
import { Reservations } from './reservations';
import { Notifications } from './notifications';
import { Fines } from './fines';
import { Settings } from './settings';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter([
      { path: 'books', component: Books },
      { path: 'loans', component: Loans },
      { path: 'reservations', component: Reservations },
      { path: 'notifications', component: Notifications },
      { path: 'fines', component: Fines },
      { path: 'history', component: History },
      { path: 'settings', component: Settings },
      { path: '', pathMatch: 'full', redirectTo: 'books' },
      { path: '**', redirectTo: 'books' },
    ]),
  ]
};
