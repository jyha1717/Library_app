"""Drop and reseed Data4Life. Requires: pip install pymongo bcrypt."""
import os
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from pymongo import MongoClient
import bcrypt
import json

def oid(group, number):
    return ObjectId(f"d4f00000{group:08x}{number:08x}")


def password_hash(password):
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password_bytes, salt).decode('utf-8')
    return password_hash


def seed():
    time_delay = {"offset": 0}
    with open('PythonBackend/timedelay.json', 'w') as file:
        json.dump(time_delay,file)
        
    client = MongoClient(os.environ.get("MONGODB_URI", "mongodb://localhost:27017/"), serverSelectionTimeoutMS=5000)
    db = client["Data4Life"]
    client.admin.command("ping")
    now = datetime.now(timezone.utc)
    day = lambda n: now + timedelta(days=n)
    users = [oid(1, i) for i in range(1, 5)]
    books = [oid(2, i) for i in range(1, 5)]
    copies = [oid(3, i) for i in range(1, 7)]
    loans = [oid(4, i) for i in range(1, 5)]
    reservations = [oid(5, i) for i in range(1, 3)]

    data = {
        "users": [
            dict(_id=users[i], email=email, passwordHash=password_hash("LibraryDemo123!"), role=role,
                 name=name, interests=interests, createdAt=day(-60))
            for i, (email, role, name, interests) in enumerate([
                ("admin@example.com", "Admin", "Alex Librarian", ["Technology"]),
                ("alice@example.com", "User", "Alice Tan", ["Fiction", "Science"]),
                ("bob@example.com", "User", "Bob Lim", ["Technology", "History"]),
                ("charlie@example.com", "User", "Charlie Lee", ["Fiction", "History"]),
            ])
        ],
        "books": [
            dict(_id=books[i], title=title, authors=authors, topics=topics,
                 archivedAt=None, createdAt=day(-50))
            for i, (title, authors, topics) in enumerate([
                ("The Clockwork Garden", ["Maya Chen"], ["Fiction", "Fantasy"]),
                ("A Practical Guide to Databases", ["Daniel Lee", "Sara Noor"], ["Technology"]),
                ("Discovering the Night Sky", ["Amira Patel"], ["Science", "Astronomy"]),
                ("Stories of Old Harbour", ["Evan Tan"], ["History"]),
            ])
        ],
        "copies": [
            dict(_id=copies[i], bookId=books[b], status=status, createdAt=day(-45))
            for i, (b, status) in enumerate([
                (0, "available"), (0, "onLoan"), (1, "reserved"),
                (2, "onLoan"), (3, "available"), (3, "withdrawn"),
            ])
        ],
        "loans": [
            dict(_id=loans[0], userId=users[1], copyId=copies[0], bookId=books[0], borrowedAt=day(-35), dueAt=day(-21), returnedAt=day(-19)),
            dict(_id=loans[1], userId=users[2], copyId=copies[1], bookId=books[0], borrowedAt=day(-18), dueAt=day(-4), returnedAt=None),
            dict(_id=loans[2], userId=users[1], copyId=copies[2], bookId=books[1], borrowedAt=day(-17), dueAt=day(-3), returnedAt=day(-1)),
            dict(_id=loans[3], userId=users[2], copyId=copies[3], bookId=books[2], borrowedAt=day(-5), dueAt=day(9), returnedAt=None),
        ],
        "reservations": [
            dict(_id=reservations[0], userId=users[2], bookId=books[1], status="ready", createdAt=day(-4), allocatedCopyId=copies[2], readyAt=day(-1)),
            dict(_id=reservations[1], userId=users[1], bookId=books[2], status="waiting", createdAt=day(-2), allocatedCopyId=None, readyAt=None),
        ],
        "fines": [
            dict(_id=oid(6, 1), loanId=loans[0], userId=users[1], amount=100, assessedAt=day(-19), paidAt=day(-18)),
            dict(_id=oid(6, 2), loanId=loans[2], userId=users[1], amount=100, assessedAt=day(-1), paidAt=None),
        ],
        "notifications": [
            dict(_id=oid(7, 1), userId=users[2], type="reservationAvailable", title="Your reserved book is ready",
                 content="A Practical Guide to Databases is ready for collection.", createdAt=day(-1), readAt=None, reservationId=reservations[0]),
            dict(_id=oid(7, 2), userId=users[1], type="fineIssued", title="Late return fee",
                 content="A late return fee of SGD 1.00 is due for A Practical Guide to Databases.", createdAt=day(-1), readAt=None, loanId=loans[2]),
            dict(_id=oid(7, 3), userId=users[1], type="fineIssued", title="Late return fee",
                 content="A late return fee of SGD 1.00 was assessed for The Clockwork Garden.", createdAt=day(-19), readAt=day(-18), loanId=loans[0]),
        ],
    }

    # Prepare all sample data before clearing the target database.
    client.drop_database("Data4Life")
    print("Cleared Data4Life. Recreating collections and indexes.")
    for name in data:
        db.create_collection(name)

    db.users.create_index("email", unique=True)
    db.fines.create_index("loanId", unique=True)
    db.copies.create_index([("bookId", 1), ("status", 1)])
    db.loans.create_index("copyId", unique=True, partialFilterExpression={"returnedAt": {"$type": "null"}}, name="one_active_loan_per_copy")
    db.loans.create_index([("userId", 1), ("borrowedAt", -1)])
    db.reservations.create_index([("bookId", 1), ("status", 1), ("createdAt", 1)])
    db.notifications.create_index([("userId", 1), ("createdAt", -1)])
    db.fines.create_index([("userId", 1), ("paidAt", 1)])

    for name, documents in data.items():
        db[name].insert_many(documents)
        print(f"{name}: {db[name].count_documents({})} documents")
    client.close()


if __name__ == "__main__":
    seed()
