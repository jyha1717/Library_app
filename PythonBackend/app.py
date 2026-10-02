from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify
from flask_pymongo import PyMongo
from flask_bcrypt import Bcrypt
import jwt
from bson import ObjectId
import json
import math

app = Flask(__name__)

# --- CONFIGURATION ---
app.config['MONGO_URI'] = 'mongodb://localhost:27017/Data4Life'
SECRET_KEY = 'jskfkjiweajijfkjc'
ALGORITHM = 'HS256'

# Initialize extensions
mongo = PyMongo(app)
bcrypt = Bcrypt(app)

def get_now():
    with open('timedelay.json', 'r') as file:
        x = json.load(file)
    offset = x['offset']
    output = datetime.now(timezone.utc) + timedelta(seconds=offset)
    return output
    
def validate_token(request):
    token = request.headers.get('Authorization')
    if not token:
        return False, 'Token is missing'
    parts = token.split()
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        return False, 'Invalid Authorization Header'
    token = parts[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        current_user = mongo.db.users.find_one({'_id': ObjectId(payload['_id'])})
        if not current_user:
            return False,'User Not Found'
        return True,current_user
    except jwt.ExpiredSignatureError:
        return False,'Token Expired'
    except jwt.InvalidTokenError:
        return False,'Invalid Token'

def get_password_hash(password):
    return bcrypt.generate_password_hash(password).decode('utf-8')

@app.route('/ping', methods = ['POST'])
def api_ping():
    return jsonify({'detail': 'success'}), 200

# Set time
@app.route('/time/set', methods = ['POST'])
def api_time_set():
    now = get_now()
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    set_to = datetime.fromisoformat(data['set_to'])
    if set_to <= now:
        return jsonify({'detail': 'Unable to set time backwards'}), 400
    seconds_offset = int((set_to-now).total_seconds())
    
    with open('timedelay.json', 'r') as file:
        x = json.load(file)
        
    x['offset'] += seconds_offset

    with open('timedelay.json', 'w') as file:
        json.dump(x,file)
    
    return jsonify({}), 200
   
@app.route('/time/retrieve', methods = ['POST'])
def api_time_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    now = get_now()
    return jsonify({'current_time': now}), 200

# Users, authentication, etc

@app.route('/users/login', methods=['POST'])
def api_users_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
        
    if not email or not password:
        return jsonify({'detail': 'Missing username or password'}), 400
        
    # Find user in MongoDB
    user = mongo.db.users.find_one({'email': email})
    if not user or not bcrypt.check_password_hash(user['passwordHash'], password):
        return jsonify({'detail': 'Incorrect username or password'}), 400
    
    # Generate JWT token
    expiration = datetime.now(timezone.utc) + timedelta(minutes=600)
    token = jwt.encode({'_id':str(user['_id']), 'exp': expiration}, SECRET_KEY, algorithm=ALGORITHM)
    
    return jsonify({'access_token': token, 'token_type': 'bearer'}), 200

@app.route('/users/me', methods=['GET'])
def api_users_me():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    else:
        del payload['passwordHash']
        return jsonify(payload), 200

@app.route('/users/lookup', methods=['POST'])
def api_users_lookup():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    user_id = ObjectId(data['user_id'])
    user = mongo.db.users.find_one({'_id': user_id})
    del user['passwordHash']
    return jsonify(user),200

@app.route('/users/retrieve', methods = ['GET'])
def api_users_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    users = list(mongo.db.users.find({}))
    for user in users:
        del user['passwordHash']
    return jsonify(users),200
    
@app.route('/users/create', methods=['POST'])
def api_users_create():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    interests = data.get('interests')
    
    now = get_now()
    
    # Find user in MongoDB
    user = mongo.db.users.find_one({'email': email})
    if user:
        return jsonify({'detail': 'Email address already exists'}), 400
    
    password_hash = get_password_hash(password)
    
    new_user = {
        'email': email,
        "passwordHash": password_hash,
        "role": "User",
        "name": name,
        "interests": interests,
        "createdAt": now
        }
    mongo.db.users.insert_one(new_user)
    del new_user['passwordHash']
    return jsonify(new_user),200

@app.route('/users/change_password', methods=['POST'])
def api_users_change_password():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    data = request.get_json()
    password = data.get('password')
    new_password = data.get('new_password')
    user = mongo.db.users.find_one({'_id': user_id})
    password_hash = user['passwordHash']
    if not bcrypt.check_password_hash(password_hash, password):
        return jsonify({'detail': 'Incorrect password'}), 400
    else:
        new_password_hash = get_password_hash(new_password)
        mongo.db.users.update_one({'_id': user_id}, {'$set': {'passwordHash': new_password_hash}})
        return jsonify({'detail': 'Successfully changed password'}), 200

@app.route('/users/change_email', methods=['POST'])
def api_users_change_email():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    data = request.get_json()
    email = data.get('email')
    mongo.db.users.update_one({'_id': user_id}, {'$set': {'email': email}})
    return jsonify({'detail': 'Successfully changed email'}), 200

@app.route('/users/change_name', methods=['POST'])
def api_users_change_name():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    data = request.get_json()
    name = data.get('name')
    mongo.db.users.update_one({'_id': user_id}, {'$set': {'name': name}})
    return jsonify({'detail': 'Successfully changed name'}), 200

@app.route('/users/change_interests', methods=['POST'])
def api_users_change_interests():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    data = request.get_json()
    interests = data.get('interests')
    mongo.db.users.update_one({'_id': user_id}, {'$set': {'interests': interests}})
    return jsonify({'detail': 'Successfully changed interests'}), 200

# Book Management
@app.route('/book/add', methods=['POST'])
def api_book_add():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    authors = data.get('authors')
    title = data.get('title')
    topics = data.get('topics')
    now = get_now()
    book_item = {
        'archivedAt': None,
        'authors': authors,
        'createdAt': now,
        'title': title,
        'topics':topics
        }
    mongo.db.books.insert_one(book_item)
    return jsonify(book_item),200

@app.route('/book/retrieve', methods=['GET'])
def api_book_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    books = list(mongo.db.books.find({}))
    return jsonify(books),200

@app.route('/book/archive', methods=['POST'])
def api_book_archive():
    success,payload = validate_token(request)
    now = get_now()
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    _id = ObjectId(data.get('_id'))
    book = mongo.db.books.find_one({'_id': _id})
    if not book:
        return jsonify({'detail': 'Book not found'}), 400
    active_copies = mongo.db.copies.find_one({'bookId': _id, 'status':{'$ne':'withdrawn'}})
    if active_copies:
        return jsonify({'detail': 'Active copies available'}), 400
    if not book.get('archivedAt'):
        mongo.db.books.update_one({'_id': _id}, {'$set': {'archivedAt': now}})
        book['archivedAt'] = now
    return jsonify(book), 200

@app.route('/book/unarchive', methods=['POST'])
def api_book_unarchive():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    _id = ObjectId(data.get('_id'))
    book = mongo.db.books.find_one({'_id': _id})
    if not book:
        return jsonify({'detail': 'Book not found'}), 400
    mongo.db.books.update_one({'_id': _id}, {'$set': {'archivedAt': None}})
    book['archivedAt'] = None
    return jsonify(book), 200

# Copies

@app.route('/copy/add', methods = ['POST'])
def api_copy_add():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    book_id = ObjectId(data.get('_id'))
    book = mongo.db.books.find_one({'_id': book_id, 'archivedAt': None})
    if not book:
        return jsonify({'detail': 'Book not found'}), 400
    count = data.get('count')
    now = get_now()
    for _ in range(count):
        copy_item = {
              'bookId': book_id,
              'createdAt': now,
              'status': 'available'
              }
        mongo.db.copies.insert_one(copy_item)
    return jsonify(copy_item), 200

@app.route('/copy/retrieve', methods = ['POST'])
def api_copy_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    data = request.get_json()
    _id = ObjectId(data.get('_id'))
    books = list(mongo.db.copies.find({'bookId': _id}))
    return jsonify(books),200

@app.route('/copy/borrow', methods = ['POST'])
def api_copy_borrow():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    now = get_now()
    copy_id = ObjectId(data.get('copy_id'))
    book = mongo.db.copies.find_one({'_id':copy_id})
    
    # Check if book exists
    if not book:
        return jsonify({'detail': 'Book does not exist'}), 400
    book_id = book['bookId']
    
    # Check if existing loan exists
    existing_loan = mongo.db.loans.find_one({'bookId':book_id,'userId':user_id,'returnedAt':None})
    if existing_loan:
        return jsonify({'detail': 'Book already borrowed'}), 400
    
    # Check if existing reservation exists
    existing_reservation = mongo.db.reservations.find_one({'bookId':book_id,'userId':user_id,'status':{'$in': ['waiting', 'ready']}})
    if existing_reservation:
        return jsonify({'detail': 'Reservation already exists'}), 400
    
    due = now + timedelta(days=14)
    result = mongo.db.copies.update_one(
        {'_id': copy_id, 'status': 'available'},
        {'$set': {'status': 'onLoan'}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Copy does not exist or is unavailable'
        }), 400
    loan_item = {
        'borrowedAt': now,
        'copyId': copy_id,
        'bookId': book_id,
        'dueAt': due,
        'returnedAt': None,
        'userId': user_id
        }
    mongo.db.loans.insert_one(loan_item)
    return jsonify(loan_item),200

@app.route('/copy/withdraw', methods = ['POST'])
def api_copy_withdraw():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    copy_id = ObjectId(data.get('copy_id'))
    copy = mongo.db.copies.find_one({'_id': copy_id, 'status': 'available'})
    if not copy:
        return jsonify({'detail': 'Copy is not available'}), 400
    book_id = copy.get('bookId')
    book = mongo.db.books.find_one({'_id': book_id, 'archivedAt': None})
    if not book:
        return jsonify({'detail': 'Book is not available'}), 400
    result = mongo.db.copies.update_one(
        {'_id': copy_id, 'status': 'available'},
        {'$set': {'status': 'withdrawn'}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Copy does not exist or is unavailable'
        }), 400
    return jsonify(), 200

@app.route('/copy/reactivate', methods = ['POST'])
def api_copy_reactivate():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    data = request.get_json()
    copy_id = ObjectId(data.get('copy_id'))
    copy = mongo.db.copies.find_one({'_id': copy_id, 'status': 'withdrawn'})
    if not copy:
        return jsonify({'detail': 'Copy is not available'}), 400
    book_id = copy.get('bookId')
    book = mongo.db.books.find_one({'_id': book_id, 'archivedAt': None})
    if not book:
        return jsonify({'detail': 'Book is not available'}), 400
    result = mongo.db.copies.update_one(
        {'_id': copy_id, 'status': 'withdrawn'},
        {'$set': {'status': 'available'}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Copy does not exist or is unavailable'
        }), 400
    return jsonify(), 200

# Loans

@app.route('/loan/retrieve', methods = ['GET'])
def api_loan_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    loans = list(mongo.db.loans.find({'userId': user_id}))
    return jsonify(loans),200

@app.route('/loan/retrieve_all', methods = ['GET'])
def api_loan_retrieve_all():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    loans = list(mongo.db.loans.find({}))
    return jsonify(loans),200

@app.route('/loan/return', methods = ['POST'])
def api_loan_return():
    now = get_now()
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    data = request.get_json()
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    loan_id = ObjectId(data.get('loan_id'))
    loan = mongo.db.loans.find_one({'_id': loan_id, 'userId': user_id, 'returnedAt': None})
    if not loan:
        return jsonify({'detail': 'Loan not found'}), 400
    result = mongo.db.loans.update_one(
        {'_id': loan_id, 'userId': user_id, 'returnedAt': None},
        {'$set': {'returnedAt': now}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Loan does not exist or is unavailable'
        }), 400
    
    copy_id = loan['copyId']
    copy = mongo.db.copies.find_one({'_id': copy_id})
    book_id = copy['bookId']
    book = mongo.db.books.find_one({'_id': book_id})
    title = book['title']
    
    # Fine
    dueAt = loan.get('dueAt').replace(tzinfo=timezone.utc)
    seconds_overdue = (now-dueAt).total_seconds()
    if seconds_overdue > 0:
        days_overdue = math.ceil(seconds_overdue/86400)
        fine = 50*days_overdue
        fine_item = {        
            'amount': fine,
            'assessedAt': now,
            'loanId': loan_id,
            'paidAt': None,
            'userId': user_id
            }
        mongo.db.fines.insert_one(fine_item)
        amount_dollars = f'{fine//100}.{str(fine%100).zfill(2)}'
        notification_item = {
            'content': f'A late return fee of SGD {amount_dollars} is due for {title}.',
            'createdAt': now,
            'loanId': loan_id,
            'readAt': None,
            'title': 'Late return fee',
            'type': 'fineIssued',
            'userId': user_id
            }
        mongo.db.notifications.insert_one(notification_item)
    
    # Reservation
    
    reservations = list(mongo.db.reservations.find({'bookId': book_id, 'allocatedCopyId': None, 'status': 'waiting'}))
    if not reservations: #make book available
        mongo.db.copies.update_one(
            {'_id': copy_id},
            {'$set': {'status': 'available'}}
            )
    else:
        reservation = min(reservations, key = lambda x: x['createdAt'])
        reservation_id = reservation['_id']
        new_user_id = reservation['userId']
        mongo.db.reservations.update_one(
            {'_id': reservation_id},
            {'$set': {'allocatedCopyId': copy_id, 'readyAt': now, 'status': 'ready'}}
            )
        mongo.db.copies.update_one(
            {'_id': copy_id},
            {'$set': {'status': 'reserved'}}
            )
        notification_item = {
            'content': f'{title} is ready for collection.',
            'createdAt': now,
            'readAt': None,
            'reservationId': reservation_id,
            'title': 'Your reserved book is ready',
            'type': 'reservationAvailable',
            'userId': new_user_id
            }
        mongo.db.notifications.insert_one(notification_item)
        
    loan['returnedAt'] = now
    return jsonify(loan), 200

# Reservations

@app.route('/reservation/retrieve', methods = ['GET'])
def api_reservation_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    reservations = list(mongo.db.reservations.find({'userId': user_id}))
    return jsonify(reservations),200

@app.route('/reservation/retrieve_all', methods = ['GET'])
def api_reservation_retrieve_all():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    reservations = list(mongo.db.reservations.find({}))
    return jsonify(reservations),200

@app.route('/reservation/new', methods = ['POST'])
def api_reservation_new():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    now = get_now()
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    book_id = ObjectId(data.get('book_id'))
    
    # Check that book exists
    book = mongo.db.books.find_one({'_id': book_id, 'archivedAt': None})
    if not book:
        return jsonify({'detail': 'Book does not exist or is unavailable'}), 400
    
    # Check if active reservation exists
    reservation = mongo.db.reservations.find_one({'bookId': book_id, 'userId': user_id, 'status': {'$in': ['waiting', 'ready']}})
    if reservation:
        return jsonify({'detail': 'Reservation already exists'}), 400
    
    # Check if copy is already available
    copy = mongo.db.copies.find_one({'bookId': book_id, 'status': 'available'})
    if copy:
        return jsonify({'detail': 'Copy already available'}), 400
    
    # Check if active loan exists
    loan = mongo.db.loans.find_one({'bookId': book_id, 'userId': user_id, 'returnedAt': None})
    if loan:
        return jsonify({'detail': 'Existing loan exists'}), 400
    
    # Check that copies of the book do exist
    copy = mongo.db.copies.find_one({'bookId': book_id, 'status': {'$in': ['onLoan','reserved']}})
    if not copy:
        return jsonify({'detail': 'No circulating copies available for reservation'}), 400
    
    reservation_item = {
        "allocatedCopyId": None,
        "bookId": book_id,
        "createdAt": now,
        "readyAt": None,
        "status": "waiting",
        "userId": user_id
        }
    mongo.db.reservations.insert_one(reservation_item)
    return jsonify(reservation_item),200

@app.route('/reservation/borrow', methods = ['POST'])
def api_reservation_borrow():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    now = get_now()
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    reservation_id = ObjectId(data.get('reservation_id'))
    reservation = mongo.db.reservations.find_one({'userId': user_id, 'status': 'ready', '_id': reservation_id})
    if not reservation:
        return jsonify({'detail': 'Reservation not found'}), 400
    
    copy_id = reservation['allocatedCopyId']
    book_id = reservation['bookId']
    
    # Check if active loan exists
    loan = mongo.db.loans.find_one({'bookId': book_id, 'userId': user_id, 'returnedAt': None})
    if loan:
        return jsonify({'detail': 'Existing loan exists'}), 400
    
    result = mongo.db.copies.update_one(
        {'_id': copy_id, 'status': 'reserved'},
        {'$set': {'status': 'onLoan'}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Copy does not exist or is unavailable'
        }), 400
    
    result = mongo.db.reservations.update_one(
        {'userId': user_id, 'status': 'ready', '_id': reservation_id},
        {'$set': {'status': 'fulfilled'}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Reservation does not exist or is unavailable'
        }), 400
    
    due = now + timedelta(days=14)
    loan_item = {
        'borrowedAt': now,
        'copyId': copy_id,
        'bookId': book_id,
        'dueAt': due,
        'returnedAt': None,
        'userId': user_id
        }
    mongo.db.loans.insert_one(loan_item)
    return jsonify(loan_item),200

@app.route('/reservation/cancel', methods = ['POST'])
def api_reservation_cancel():
    success,payload = validate_token(request)
    now = get_now()
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    reservation_id = ObjectId(data.get('reservation_id'))
    reservation = mongo.db.reservations.find_one(
        {
            'userId': user_id,
            'status': {'$in': ['waiting', 'ready']},
            '_id': reservation_id
        })
    if not reservation:
        return jsonify({'detail': 'Reservation not found'}), 400
    
    status = reservation['status']
    
    if status == 'waiting':
        result = mongo.db.reservations.update_one(
            {'userId': user_id, '_id': reservation_id},
            {'$set': {'status': 'cancelled'}}
            )
        if result.modified_count != 1:
            return jsonify({
                'detail': 'Reservation does not exist or is unavailable'
            }), 400
    elif status == 'ready':
        result = mongo.db.reservations.update_one(
            {'userId': user_id, '_id': reservation_id},
            {'$set': {'status': 'cancelled'}}
            )
        if result.modified_count != 1:
            return jsonify({
                'detail': 'Reservation does not exist or is unavailable'
            }), 400
        copy_id = reservation['allocatedCopyId']
        book_id = reservation['bookId']
        book = mongo.db.books.find_one({'_id': book_id})
        title = book['title']
        reservations = list(mongo.db.reservations.find({'bookId': book_id, 'allocatedCopyId': None, 'status': 'waiting'}))
        if not reservations: #make book available
            mongo.db.copies.update_one(
                {'_id': copy_id},
                {'$set': {'status': 'available'}}
                )
        else:
            reservation = min(reservations, key = lambda x: x['createdAt'])
            reservation_id = reservation['_id']
            new_user_id = reservation['userId']
            mongo.db.reservations.update_one(
                {'_id': reservation_id},
                {'$set': {'allocatedCopyId': copy_id, 'readyAt': now, 'status': 'ready'}}
                )
            mongo.db.copies.update_one(
                {'_id': copy_id},
                {'$set': {'status': 'reserved'}}
                )
            notification_item = {
                'content': f'{title} is ready for collection.',
                'createdAt': now,
                'readAt': None,
                'reservationId': reservation_id,
                'title': 'Your reserved book is ready',
                'type': 'reservationAvailable',
                'userId': new_user_id
                }
            mongo.db.notifications.insert_one(notification_item)
    
    return jsonify(reservation), 200

# Fines
@app.route('/fine/retrieve', methods = ['GET'])
def api_fine_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    fines = list(mongo.db.fines.find({'userId': user_id}))
    return jsonify(fines),200

@app.route('/fine/retrieve_all', methods = ['GET'])
def api_fine_retrieve_all():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    fines = list(mongo.db.fines.find({}))
    return jsonify(fines),200

@app.route('/fine/pay', methods = ['POST'])
def api_fine_pay():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    now = get_now()
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    fine_id = ObjectId(data.get('fine_id'))
    fine = mongo.db.fines.find_one({'paidAt': None,'_id': fine_id,'userId': user_id})
    if not fine:
        return jsonify({'detail': 'Fine not found'}), 400
    
    result = mongo.db.fines.update_one(
        {'paidAt': None,'_id': fine_id,'userId': user_id},
        {'$set': {'paidAt': now}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Fine does not exist or is unavailable'
        }), 400
    
    fine['paidAt'] = now
    return jsonify(fine),200

# Notifications
@app.route('/notification/retrieve', methods = ['GET'])
def api_notification_retrieve():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    user_id = payload['_id']
    notifications = list(mongo.db.notifications.find({'userId': user_id}))
    
    notifications = sorted(notifications, key = lambda x: x['createdAt'], reverse = True)
    return jsonify(notifications),200

@app.route('/notification/retrieve_all', methods = ['GET'])
def api_notification_retrieve_all():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    role = payload['role']
    if role!='Admin':
        return jsonify({'detail': f'Role {role} is not allowed to perform this function'}), 400
    notifications = list(mongo.db.notifications.find({}))
    notifications = sorted(notifications, key = lambda x: x['createdAt'], reverse = True)
    return jsonify(notifications),200

@app.route('/notification/read', methods = ['POST'])
def api_notification_read():
    success,payload = validate_token(request)
    if not success:
        return jsonify({'detail': payload}), 400
    now = get_now()
    role = payload['role']
    data = request.get_json()
    if role == 'User':
        user_id = payload['_id']
    else:
        user_id = ObjectId(data.get('user_id'))
    notification_id = ObjectId(data.get('notification_id'))
    notification = mongo.db.notifications.find_one({'readAt': None,'_id': notification_id,'userId': user_id})
    if not notification:
        return jsonify({'detail': 'Notification not found'}), 400
    
    result = mongo.db.notifications.update_one(
        {'readAt': None,'_id': notification_id,'userId': user_id},
        {'$set': {'readAt': now}}
        )
    if result.modified_count != 1:
        return jsonify({
            'detail': 'Notification does not exist or is unavailable'
        }), 400
    
    notification['readAt'] = now
    return jsonify(notification),200

if __name__ == '__main__':
    app.run(port=8000)