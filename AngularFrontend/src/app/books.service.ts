import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';

export interface Book {
  _id: string;
  title: string;
  authors: string[];
  topics: string[];
  archivedAt?: string | null;
}
export type NewBook = Pick<Book, 'title' | 'authors' | 'topics'>;

interface ApiBook extends Omit<Book, '_id' | 'archivedAt'> {
  _id: string | { $oid: string };
  archivedAt?: string | { $date: string | { $numberLong: string } } | null;
}

function normalizeBook(book: ApiBook): Book {
  const date = book.archivedAt;
  const value = date && typeof date === 'object' ? date.$date : date;
  return {
    ...book,
    _id: typeof book._id === 'string' ? book._id : book._id.$oid,
    archivedAt: value && typeof value === 'object'
      ? new Date(Number(value.$numberLong)).toISOString() : value,
  };
}

@Injectable({ providedIn: 'root' })
export class BooksService {
  private readonly http = inject(HttpClient);
  retrieve() {
    return this.http.get<ApiBook[]>('/api/book/retrieve').pipe(map(books => books.map(normalizeBook)));
  }
  add(book: NewBook) {
    return this.http.post<ApiBook>('/api/book/add', book).pipe(map(normalizeBook));
  }
  setArchived(id: string, archived: boolean) {
    return this.http.post<ApiBook>(`/api/book/${archived ? 'archive' : 'unarchive'}`, { _id: id }).pipe(map(normalizeBook));
  }
}
