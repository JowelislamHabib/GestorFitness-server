# 🚀 GestorFitness Backend Server

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-Framework-lightgray)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-success)](https://www.mongodb.com/)
[![GitHub Server](https://img.shields.io/badge/GitHub-Server-blue)](https://github.com/JowelislamHabib/GestorFitness-server)

The backend server for the **GestorFitness** B2C fitness marketplace. It handles the core business logic, secure JWT authentication, database operations, and powers the entire platform's data layer via robust REST APIs.

---

## Tech Stack & Dependencies

- **Runtime Environment:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB Atlas (Native Node.js Driver)
- **Authentication:** BetterAuth (JWT tokens via `jose-cjs`)
- **Security:** Helmet, CORS, dotenv for secure environment variables.

---

## Getting Started

Follow these steps to set up the backend server locally:

### 1. Clone the Repository

```bash
git clone https://github.com/JowelislamHabib/GestorFitness-server.git
cd GestorFitness-server
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory and configure the following variables:

```env
PORT=8000
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:3000
```

### 4. Run the Server

```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:8000`.

---

## Complete API Documentation

The server exposes comprehensive RESTful API endpoints secured by strict role-based access control (`verifyToken`, `verifyAdmin`, `verifyTrainer`, `verifyNotBlocked`).

### Users API

| Method    | Endpoint             | Description                                | Access Level  |
| :-------- | :------------------- | :----------------------------------------- | :------------ |
| **GET**   | `/users/me`          | Fetch the currently logged-in user profile | Authenticated |
| **GET**   | `/users`             | Fetch all registered users                 | Admin         |
| **PATCH** | `/users/:id/block`   | Soft block a user from performing actions  | Admin         |
| **PATCH** | `/users/:id/unblock` | Unblock a restricted user                  | Admin         |

### Notifications API

| Method     | Endpoint                               | Description                                  | Access Level  |
| :--------- | :------------------------------------- | :------------------------------------------- | :------------ |
| **GET**    | `/notifications/:userId`               | Fetch recent notifications for a user        | Authenticated |
| **PATCH**  | `/notifications/:id/read`              | Mark a specific notification as read         | Authenticated |
| **PATCH**  | `/notifications/user/:userId/read-all` | Mark all notifications as read for a user    | Authenticated |
| **DELETE** | `/notifications/:id`                   | Delete a specific notification               | Authenticated |
| **DELETE** | `/notifications/user/:userId`          | Delete all notifications for a specific user | Authenticated |

### Forum Posts API

| Method     | Endpoint                | Description                                                 | Access Level               |
| :--------- | :---------------------- | :---------------------------------------------------------- | :------------------------- |
| **POST**   | `/forum-posts`          | Create a new community forum post                           | Authenticated, Not Blocked |
| **GET**    | `/forum-posts`          | Fetch all forum posts (supports pagination, search, filter) | Public                     |
| **GET**    | `/forum-posts/:id`      | Fetch details of a single forum post                        | Public                     |
| **PATCH**  | `/forum-posts/:id`      | Edit/Update an existing forum post                          | Post Owner / Admin         |
| **DELETE** | `/forum-posts/:id`      | Delete a forum post                                         | Post Owner / Admin         |
| **POST**   | `/forum-posts/:id/vote` | Upvote or downvote a forum post                             | Authenticated              |

### Forum Comments API

| Method     | Endpoint                        | Description                              | Access Level               |
| :--------- | :------------------------------ | :--------------------------------------- | :------------------------- |
| **GET**    | `/forum-posts/:postId/comments` | Fetch all comments under a specific post | Public                     |
| **POST**   | `/forum-posts/:postId/comments` | Add a comment to a specific post         | Authenticated, Not Blocked |
| **PATCH**  | `/forum-comments/:id`           | Edit an existing comment                 | Comment Owner / Admin      |
| **PATCH**  | `/forum-comments/:id/like`      | Like or unlike a specific comment        | Authenticated              |
| **DELETE** | `/forum-comments/:id`           | Delete a comment                         | Comment Owner / Admin      |

### Trainer Applications API

| Method    | Endpoint                    | Description                                         | Access Level               |
| :-------- | :-------------------------- | :-------------------------------------------------- | :------------------------- |
| **POST**  | `/trainer-applications`     | Submit an application to become a trainer           | Authenticated, Not Blocked |
| **GET**   | `/trainer-applications`     | Fetch applications (can filter by userId or status) | Authenticated              |
| **PATCH** | `/trainer-applications/:id` | Approve or reject an application and leave feedback | Admin                      |

### Classes API

| Method     | Endpoint                 | Description                                        | Access Level |
| :--------- | :----------------------- | :------------------------------------------------- | :----------- |
| **POST**   | `/classes`               | Create a new fitness class                         | Trainer      |
| **GET**    | `/classes/stats/summary` | Get summary statistics of classes for a dashboard  | Trainer      |
| **GET**    | `/classes`               | Fetch all classes (supports pagination, filtering) | Public       |
| **GET**    | `/classes/:id`           | Fetch details of a single class                    | Public       |
| **PATCH**  | `/classes/:id/status`    | Change class status (Approve/Reject/Pending)       | Admin        |
| **PATCH**  | `/classes/:id`           | Update class details                               | Trainer      |
| **DELETE** | `/classes/:id`           | Delete a class                                     | Trainer      |

### Bookings & Transactions API

| Method   | Endpoint                             | Description                                          | Access Level               |
| :------- | :----------------------------------- | :--------------------------------------------------- | :------------------------- |
| **POST** | `/bookings`                          | Book a class and record a Stripe payment transaction | Authenticated, Not Blocked |
| **GET**  | `/bookings`                          | Fetch all platform bookings/transactions             | Admin                      |
| **GET**  | `/bookings/user/:userId`             | Fetch all class bookings made by a specific user     | Authenticated              |
| **GET**  | `/bookings/trainer/:trainerId`       | Fetch all bookings for classes owned by a trainer    | Trainer                    |
| **GET**  | `/bookings/class/:classId/attendees` | Fetch a list of attendees for a specific class       | Trainer                    |

### Favorite Classes API

| Method     | Endpoint                    | Description                                 | Access Level  |
| :--------- | :-------------------------- | :------------------------------------------ | :------------ |
| **GET**    | `/favorite-classes/:userId` | Fetch a list of a user's favorite classes   | Authenticated |
| **POST**   | `/favorite-classes`         | Add a class to a user's favorites list      | Authenticated |
| **DELETE** | `/favorite-classes`         | Remove a class from a user's favorites list | Authenticated |

### Health Check API

| Method  | Endpoint | Description                               | Access Level |
| :------ | :------- | :---------------------------------------- | :----------- |
| **GET** | `/`      | Root endpoint to verify server is running | Public       |

---

## Security Details

- **Role-Based Middlewares:** Uses custom middlewares (`verifyToken`, `verifyAdmin`, `verifyTrainer`) to intercept requests and deny unauthorized actions before reaching business logic.
- **State Protection (`verifyNotBlocked`):** "Soft blocked" users can still read data but cannot perform POST operations (like commenting or booking classes).
