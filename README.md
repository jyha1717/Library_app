# Data4Life Take Home Assignment

This is my attempt at the take home assignment as assigned by Data4Life.

The task is to come up with a Library that handles the following use cases:

- Book catalogue management, with features like adding and removing books
- Lending and returning the books, with features like late fee charges, tracking the days
- Reserve already lent books with features like notification when available
- User management, with features like user profile, history, interests, payments

Since I am allowed to use any technology stack of my choice, I have decided to go with Angular for the frontend, Python for the backend and MongoDB for the database due to familiarity with these tools.

As there is no restriction on the use of AI to develop this tool, I used it extensively, especially for the Angular portion which I am less familiar with.
However, I ensured that I designed the database schema and did the Python backend programming by myself, with AI only acting as a backseat advisor.

Chat history with the Codex AI tool is available at ChatHistory.txt

## Prerequisites and Python dependencies

- NodeJS v24.16.0
- Python 3.14.5
- Python dependencies are located in requirements.txt

## Schema

The following MongoDB schema was chosen:

### `users`

Accounts for both members and administrators.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Stable account identifier. |
| `email` | string | Unique sign-in email; editable. References to the user remain unchanged when it changes. |
| `passwordHash` | string | Salted bcrypt password hash; excluded from user API responses. |
| `role` | string | `User` or `Admin`. Registration creates a `User`. |
| `name` | string | Editable display name. |
| `interests` | array of strings | Editable interests used to match book topics. |
| `createdAt` | date | Account creation time. |

Emails must be unique; two users cannot have the same email.

### `books`

One document per catalogue title, independently of how many physical copies exist.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Title identifier. |
| `title` | string | Book title. |
| `authors` | array of strings | Author names. |
| `topics` | array of strings | Subject/topic labels. |
| `archivedAt` | date or null | `null` for an active title; otherwise the archival time. |
| `createdAt` | date | Title creation time. |

Archiving preserves copies and transaction history. A title may be archived only when it has no non-withdrawn copies; a title with no copies is also eligible. Unarchiving sets `archivedAt` back to `null`.

### `copies`

One document per physical copy.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Individual copy identifier. |
| `bookId` | ObjectId | References `books._id`. |
| `status` | string | `available`, `onLoan`, `reserved` or `withdrawn`. |
| `createdAt` | date | Copy creation time. |

| Status | Meaning |
| --- | --- |
| `available` | Can be borrowed. New copies start in this state. |
| `onLoan` | Currently borrowed. |
| `reserved` | Allocated to a ready reservation awaiting collection. |
| `withdrawn` | Removed from circulation while retaining its history. |

Only available copies can be withdrawn. New copies cannot be added to archived titles.

### `loans`

One document per borrowing transaction, retained after return.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Loan identifier. |
| `userId` | ObjectId | References the borrower's `users._id`, including when an admin acts on their behalf. |
| `copyId` | ObjectId | References `copies._id`. |
| `bookId` | ObjectId | References `books._id`; must match the referenced copy's `bookId`. |
| `borrowedAt` | date | Borrowing time. |
| `dueAt` | date | Due time; currently 14 days after borrowing. |
| `returnedAt` | date or null | `null` while active; return time once completed. |

`bookId` is stored directly to support title-level duplicate-loan checks.

At most one active loan can exist simultaneously per copy.

### `reservations`

One document per user's reservation of a title. A physical copy is allocated when available.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Reservation identifier. |
| `userId` | ObjectId | References `users._id`. |
| `bookId` | ObjectId | References the requested `books._id`. |
| `status` | string | `waiting`, `ready`, `fulfilled` or `cancelled`. |
| `createdAt` | date | Reservation time, used for FIFO queue ordering. |
| `allocatedCopyId` | ObjectId or null | References `copies._id`; initially `null` until allocation. |
| `readyAt` | date or null | Allocation time; initially `null`. |

| Status | Meaning |
| --- | --- |
| `waiting` | In the title's queue, without an allocated copy. |
| `ready` | A copy has been allocated and can be collected. |
| `fulfilled` | The reserved copy has been borrowed and a loan created. |
| `cancelled` | The reservation has been cancelled. |

Allocated copy and ready-time fields are retained when a ready reservation is fulfilled or cancelled. Use `status`, not the presence of `allocatedCopyId`, to determine whether allocation is still active. Returned or released copies go to the oldest waiting reservation by `createdAt`; otherwise they become available.

### `fines`

One document per fined loan, with payment recorded in full.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Fine identifier. |
| `loanId` | ObjectId | References `loans._id`; unique across fines. |
| `userId` | ObjectId | References the borrower's `users._id`. |
| `amount` | integer | Amount in SGD cents. |
| `assessedAt` | date | Time the fine was assessed on return. |
| `paidAt` | date or null | `null` while unpaid; payment time once paid in full. |

There is no separate fine status, payment collection or partial-payment amount. Payment is simulated by setting `paidAt`. The current late fee is 50 cents per started overdue day: `ceil((returnedAt - dueAt) / 86400 seconds) * 50`, applied only when the return is late.

At most one fine can be generated per loan.

### `notifications`

In-app messages for fine assessment and reservation availability.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | ObjectId | Notification identifier. |
| `userId` | ObjectId | References the recipient's `users._id`. |
| `type` | string | Currently `fineIssued` or `reservationAvailable`. |
| `title` | string | Message heading. |
| `content` | string | Message body. |
| `createdAt` | date | Notification creation time. |
| `readAt` | date or null | `null` for unread messages; time marked read otherwise. |
| `loanId` | ObjectId, optional | References `loans._id` for a fine notification. |
| `reservationId` | ObjectId, optional | References `reservations._id` for an availability notification. |

Recipient emails are looked up from `users`; they are not duplicated in stored notifications, loans, reservations or fines.

## Assumptions & Design Choices

As the features above are for reference and can be designed with certain assumptions, these were the assumptions and design choices I made in this project:

- For books, I provision the concept of both 'books' and 'copies'. This is to allow for a book to have multiple copies, more realistically simulating a real-life library implementation.
- Users can only borrow and reserve one copy of a given book at one time. All copies of the same book are assumed to be fungible, and hence reservation and borrowing of books does not allow the user to choose a specific copy.
- If a book has available copies to be borrowed, users are not allowed to reserve it.
- Active reservations have two types - waiting or ready. If a reservation is waiting, there is no current copy assigned to it, and we are waiting for a copy to be returned before we can proceed further. If a reservation is ready, a copy is available and has been earmarked for that specific user, and can be borrowed at any time.
- There are two roles, Admin and User. The Admin is able to oversee all loans, reservations, fines and history for all users. The Admin is also able to add or remove books and copies of books.
- Books, copies, loans, reservations, fines and notifications are not allowed to be deleted for archival and record-keeping purposes. To simulate deletion, we allow for books to be archived, copies to be withdrawn, loans to be returned, reservations to be fulfilled or cancelled, fines to be paid and notifications to be read.
- Only copies that are currently available can be withdrawn by the admin. In order to withdraw a copy that is on loan or reserved, it must first be returned or cancelled respectively.
- Only books that have 0 active (i.e., available, on loan or reserved) copies can be archived. To archive a book, withdraw all available copies first.
- To allow the time-keeping functionality to be tested, we allow for admins to manually set the clock in the frontend.
- For security and authentication, a bearer token is used. This token is generated upon login, and is sent to the backend with every request. This bearer token tells the system which user initiated the request, and is used for role-based authentication purposes.
- Fines must be paid in full, there is no partial payment available.
- Times are stored in UTC and displayed in Singapore time (GMT+8)

## Starting the app

- First, MongoDB needs to be set up on the local machine. The database name used is hard-coded as 'Data4Life'. The connection should thus be at the following: `mongodb://localhost:27017/Data4Life`
- Next, install Python 3.14.5 on your device, and install the packages by calling `python -m pip install -r requirements.txt`
- In the root folder, run `python seed_database.py` to reset the system to its initial state. This does the following:
    - Reset the time delay offset to 0 seconds
    - Deletes all data and repopulates the MongoDB database with sample data. This will delete all existing data, and add 1 Admin, 3 Users, 5 books, 6 copies, 4 loans, 2 reservations, 2 fines and 3 notifications.
- Navigate to the AngularFrontend folder and run the command `npm install` to install necessary packages, then `npm start` to start the frontend. This will start the Angular frontend on port 4200.
- In a separate terminal, navigate to the PythonBackend folder and run `python app.py` to start the backend. This will start the Python backend on port 8000.
- Both Angular and Python scripts should be running simultaneously in two separate terminals.
- Open `http://localhost:4200` in your browser to access the frontend.

## Demo Credentials

For this demo, 1 admin and 3 user accounts have been seeded. The account emails are as follows:
- admin@example.com (Admin)
- alice@example.com
- bob@example.com
- charlie@example.com

All of them use the standard default password LibraryDemo123!

## Frontend Features

The frontend page features the following tabs:

### Login Page

- When a user first accesses the homepage, a login screen will appear. Users can type in their email address and password to login. For demo ease-of-use, we pre-fill the admin and user accounts for one-click login.
- Additionally, users without an account can create a new user using the 'create new user' button. They should fill in their email address, password (twice, to ensure a match), name and interests. Interests can be left blank.

### Set time (admin only)

- This feature allows admins to manually set the clock, for testing purposes. To ensure no time paradox occurs, we only allow admins to set the time forward, not backwards.

### Notifications

- This allows users to see notifications in two categories: fines meted out to the user, as well as reservations that have become available. Users are able to mark notifications as read.
- Admins are able to see all notifications to all users, and can mark them as read on their behalf.

### Book catalogue

- This allows users and admins to see a listing of books, by title, author, topics and copies by status.
- Users are only able to view non-archived books, admins will be able to view both archived and non-archived books.
- Sorting is in place for titles, authors and topics.
- Filtering is in place for authors and topics. To allow for users' interests to be catered for, we allow the user to automatically filter topics which they have indicated interest in.
- Books are colour-coded: green for books that have available copies, yellow for books that only have copies that are loaned out or reserved, and red for books where no copies are available, loaned out or reserved.
- Users are able to borrow copies of green books or reserve copies of yellow books, if there is no current copy borrowed or reserved by the user. Users can also view the copies of books by status.
- If the user is not eligible to borrow or reserve the book, the button will instead read 'Already borrowed' or 'Already reserved' and redirect the user to the loans and reservations page respectively.
- Admins can additionally borrow or reserve copies for any eligible user.
- Admins are able to add a new book to the system using the 'Add new book' button, and can add copies of existing books in the 'View copies' overlay.
- Admins can also withdraw copies of books that are currently listed as 'Available', and archive books which all copies have been withdrawn.

### Loans

- Users can view their active loans in this tab, by title, author, topics, copy ID, borrow date and due date.
- Sorting is in place for title, authors, topics, borrow date and due date.
- Filtering is in place for authors and topics. Similarly, topic filtering also allows users to select their interests.
- Loans are colour-coded: Green for books whose due date are greater than 3 days away, yellow for books due within 3 days or less, and red for books that are already overdue.
- Users are able to return books at the current time.
- Admins can view all loans and return books on behalf of any user.

### Reservations

- Users can view their active reservations in this tab, by title, author, topics and status.
- Sorting is in place for title, authors and topics.
- Filtering is in place for authors, topics and status. Similarly, topic filtering also allows users to select their interests. Filtering for status allows users to select 'ready' or 'waiting'.
- Reservations are colour-coded: Green for reservations that are ready, and yellow for reservations that are waiting.
- Ready reservations allow the user to immediately borrow the book from this page.
- All ready and waiting reservations can be cancelled by the user.
- Admins can view, borrow books or cancel reservations for any user.

### Fines

- Users can view their active fines in this tab, by loan ID, amount and date assessed at.
- Sorting is available for amount and date assessed at.
- Users can pay their fines in full using the 'Pay fine' button.
- Admins are additionally able to pay off fines for any user.

### History

- This tab contains histories of loans, reservations and fines for each user. These values are only for reference and they cannot be edited by either users or admins.
- Tables are broadly similar to the main loans, reservations and fines with the following differences:
    - Loans: Only returned loans are visible. Due date is replaced by Return date
    - Reservations: Only fulfilled and cancelled reservations are visible. Filtering for status allows users to select 'fulfilled' or 'cancelled'.
    - Fines: Only paid fines are visible. Also includes column for when fine was paid at.
- Admins are able to view history for any user.

### Settings

- This tab allows users to change their email address, name, interests and password.
- For password changes, the system requires the user to key in their old password along with their new, for verification.

## Demo walkthrough

The following steps can be done for an end-to-end borrowing demo:

- Register a new user and edit their profile and interests.
- As admin, add a new title and 2 copies.
- As the new user, borrow one copy of the book.
- As admin, borrow one copy of the book on behalf of Alice.
- As Bob, reserve the book.
- As admin, reserve the book on behalf of Charlie.
- As admin, advance the clock by 15 days or more.
- As Alice, return the book. Check that Alice receives a notification regarding the fine.
- As Alice, read the notification and pay the fine. Check that the fine appears in history.
- Ensure that Bob is allocated the reservation ahead of Charlie since he reserved the book first. Check that Bob receives a notification regarding the book's availability.
- As Bob, read the notification and collect the reservation. Immediately return it. Ensure no fine is charged as the book is returned on time.
- Ensure that Charlie is now allocated the reservation. Check that Charlie receives a notification regarding the book's availability.
- As admin, read the notification for Charlie, collect the reservation and immediately return it. Ensure no fine is charged as the book is returned on time.
- As admin, return the book for the new user, ensure the new user receives a notification regarding the fine.
- As admin, read the notification for the new user and pay the fine.
- As admin, withdraw both copies of the book and archive it.
- As a user who borrowed or reserved this book, ensure the book is no longer visible in the book listing, but visible in the user's history.