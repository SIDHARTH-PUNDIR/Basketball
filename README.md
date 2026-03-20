# 🏀 CourtCommand
### Real-Time Basketball Tournament Management System

CourtCommand is a full-stack web application for managing basketball tournaments with real-time updates, live match tracking, and an interactive court interface.

---

## 🚀 Features

- 🎯 Tournament creation & management
- 👥 Team & player management
- 📅 Match scheduling
- 🏀 Live court visualization
- 🔄 Real-time updates (Socket.io)
- 📊 Standings & leaderboard
- 🔐 Authentication (Local + Google OAuth)
- 📁 Image/file uploads

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| 💻 Frontend | EJS, HTML, CSS, JavaScript |
| ⚙️ Backend | Node.js, Express.js |
| 🗄️ Database | PostgreSQL (pg) |
| 🔌 Real-Time | Socket.io |
| 🔐 Auth | Passport.js (Local + Google OAuth) |

---

## 📦 Dependencies
```bash
npm install express ejs pg socket.io dotenv bcrypt express-session passport passport-local passport-google-oauth20 multer body-parser
```

---

## 📂 Project Structure
```
CourtCommand/
│
├── public/
├── views/
├── routes/
├── controllers/
├── models/
├── socket/
│
├── server.js
├── package.json
└── README.md
```

---

## 🗄️ Database Schema (PostgreSQL)

### 📌 1. Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  team TEXT,
  password TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false
);
```

> 👉 Stores authentication + roles (admin/user)

---

### 📌 2. Players Table
```sql
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team TEXT NOT NULL,
  image TEXT,
  position TEXT
);
```

> 👉 Stores player details (PG, SG, SF, PF, C)

---

### 📌 3. Tournaments Table
```sql
CREATE TABLE tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  location VARCHAR(100),
  start_date DATE,
  end_date DATE,
  max_teams INT DEFAULT 8,
  status VARCHAR(20) DEFAULT 'UPCOMING',
  image VARCHAR(200),
  created_by INT
);
```

> 👉 Stores tournament info

---

### 📌 4. Tournament Teams
```sql
CREATE TABLE tournament_teams (
  id SERIAL PRIMARY KEY,
  tournament_id INT REFERENCES tournaments(id),
  team_name VARCHAR(50),
  registered_at TIMESTAMP DEFAULT now(),
  matches_played INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  points INT DEFAULT 0
);
```

> 👉 Tracks team performance in tournaments

---

### 📌 5. Tournament Matches
```sql
CREATE TABLE tournament_matches (
  id SERIAL PRIMARY KEY,
  tournament_id INT REFERENCES tournaments(id),
  teama VARCHAR(50),
  teamb VARCHAR(50),
  scorea INT DEFAULT 0,
  scoreb INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'UPCOMING',
  match_date DATE,
  round VARCHAR(20)
);
```

> 👉 Stores match data + scores

---

## 🔗 Relationships

- One tournament → many teams
- One tournament → many matches
- Teams → indirectly linked via tournament
- Users → create/manage tournaments

---

## ⚙️ Database Setup

**Export DB**
```bash
pg_dump -U postgres -d courtx > database.sql
```

**Import DB**
```bash
psql -U postgres -d courtx -f database.sql
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:
```env
PORT=3000

DB_USER=postgres
DB_HOST=localhost
DB_NAME=courtx
DB_PASSWORD=yourpassword
DB_PORT=5432

SESSION_SECRET=your_secret

GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_secret
```

---

## ▶️ Run Project
```bash
npm install
npm start
```

> 👉 Open in browser: [http://localhost:3000](http://localhost:3000)
