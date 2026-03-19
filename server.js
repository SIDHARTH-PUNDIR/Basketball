import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import { Strategy } from "passport-local";
import dotenv from "dotenv";
import multer from "multer";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const port = 3000;
const saltRounds = 10;

app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/assets/players");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

/* =========================
   DB CONNECTION
========================= */

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

db.connect();

/* =========================
   GLOBAL MIDDLEWARE
========================= */

app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

app.use(async (req, res, next) => {
  try {
    const matches = await db.query("SELECT * FROM matches ORDER BY id ASC");
    res.locals.matches = matches.rows;
  } catch (err) {
    res.locals.matches = [];
  }
  next();
});

/* =========================
   ROUTES
========================= */

app.get("/", async (req, res) => {
  res.render("pages/index");
});

app.get("/login", (req, res) => {
  res.render("pages/login");
});

app.get("/register", (req, res) => {
  res.render("pages/register");
});
app.get("/admin", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  if (!req.user.is_admin) {
   return res.redirect("/");
  }

  res.render("pages/admin");
});

/* =========================
   REGISTER
========================= */

app.post("/register", async (req, res) => {
  const { name, email, team, password } = req.body;

  try {
    const checkUser = await db.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (checkUser.rows.length > 0) {
      return res.redirect("/login");
    }

    const hash = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      "INSERT INTO users(name,email,team,password) VALUES($1,$2,$3,$4) RETURNING *",
      [name, email, team, hash]
    );

    req.login(result.rows[0], (err) => {
      if (err) console.log(err);
      return res.redirect("/dashboard");
    });

  } catch (err) {
    console.log(err);
  }
});

/* =========================
   LOGIN
========================= */
app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {

    if (err) return next(err);
    if (!user) return res.redirect("/login");

    req.login(user, (err) => {
      if (err) return next(err);

      // 🔥 ROLE-BASED REDIRECT
      if (user.is_admin) {
        return res.redirect("/admin");
      } else {
        return res.redirect("/dashboard");
      }
    });

  })(req, res, next);
});

/* =========================
   DASHBOARD
========================= */

app.get("/dashboard", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const players = await db.query(
      "SELECT * FROM players WHERE team=$1 ORDER BY id ASC",
      [req.user.team]
    );

    const tournaments = await db.query(
      "SELECT * FROM tournaments ORDER BY start_date ASC"
    );

    // ✅ ADD THIS HERE
    const registered = await db.query(
      "SELECT tournament_id FROM tournament_teams WHERE team_name=$1",
      [req.user.team]
    );

    res.render("pages/dashboard", {
      user: req.user,
      players: players.rows,
      tournaments: tournaments.rows,
      registered: registered.rows   // ✅ PASS TO EJS
    });

  } catch (err) {
    console.log(err);
  }
});

/* =========================
   ADD PLAYER
========================= */

app.get("/add-player", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.render("pages/add-player");
});

app.post("/add-player", upload.single("image"), async (req, res) => {
  const { name, role, position } = req.body;
  const team = req.user.team;
  const image = "/assets/players/" + req.file.filename;

  try {
    await db.query(
      "INSERT INTO players (name,role,team,image,position) VALUES ($1,$2,$3,$4,$5)",
      [name, role, team, image, position]
    );

    res.redirect("/dashboard");

  } catch (err) {
    console.log(err);
  }
});

/* =========================
   REMOVE PLAYER
========================= */

app.post("/remove-player/:id", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM players WHERE id=$1 AND team=$2",
      [req.params.id, req.user.team]
    );

    res.redirect("/dashboard");

  } catch (err) {
    console.log(err);
  }
});

/* =========================
   LIVE ROUTES
========================= */

app.get("/live", async (req, res) => {
  try {
    const liveMatch = await db.query(
      "SELECT id FROM matches WHERE status='LIVE' ORDER BY id ASC LIMIT 1"
    );

    if (liveMatch.rows.length > 0) {
      return res.redirect(`/live/${liveMatch.rows[0].id}`);
    }

    const firstMatch = await db.query(
      "SELECT id FROM matches ORDER BY id ASC LIMIT 1"
    );

    if (firstMatch.rows.length > 0) {
      return res.redirect(`/live/${firstMatch.rows[0].id}`);
    }

    res.redirect("/");

  } catch (err) {
    console.log(err);
    res.redirect("/");
  }
});

app.get("/live/:matchId", async (req, res) => {
  const matchId = req.params.matchId;

  try {
    const matchResult = await db.query(
      "SELECT * FROM matches WHERE id=$1", [matchId]
    );
    const match = matchResult.rows[0];

    const result = await db.query(
      "SELECT * FROM players WHERE LOWER(team)=LOWER($1) ORDER BY id ASC",
      [match.teama]
    );
    const players = result.rows;

    const team = match.teama;

    console.log("MATCH TEAM:", match.teama);
    console.log("PLAYERS FOUND:", players.length);

    res.render("pages/live", {
      matchId,
      players,
      team,
      match,
      baseUrl: `${req.protocol}://${req.get('host')}`
    });

  } catch (err) {
    console.log(err);
  }
});

/* =========================
   ADMIN
========================= */

app.get("/admin", (req, res) => {
  res.render("pages/admin");
});

/* =========================
   LOGOUT
========================= */

app.get("/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

/* =========================
   PASSPORT
========================= */

passport.use(
  new Strategy({ usernameField: "email" },
    async (email, password, cb) => {
      try {
        const result = await db.query(
          "SELECT * FROM users WHERE email=$1",
          [email]
        );

        if (result.rows.length === 0) return cb(null, false);

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);

        return valid ? cb(null, user) : cb(null, false);

      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => cb(null, user.id));

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await db.query(
      "SELECT * FROM users WHERE id=$1",
      [id]
    );
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

/* =========================
   HTTP SERVER + SOCKET.IO
========================= */

const httpServer = createServer(app);
const io = new Server(httpServer);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Update score
  socket.on("update_score", async ({ matchId, scorea, scoreb }) => {
    try {
      await db.query(
        "UPDATE matches SET scorea=$1, scoreb=$2 WHERE id=$3",
        [scorea, scoreb, matchId]
      );

      io.emit(`match_${matchId}`, { scorea, scoreb });
      console.log(`Score updated: match ${matchId} → ${scorea} - ${scoreb}`);

    } catch (err) {
      console.log(err);
    }
  });

  // New play-by-play event
  socket.on("new_event", ({ matchId, time, text, type }) => {
    io.emit(`event_${matchId}`, { time, text, type });
    console.log(`New event: match ${matchId} → [${type}] ${text}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

/* =========================
   TOURNAMENTS
========================= */

app.get("/tournaments", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM tournaments ORDER BY start_date ASC"
    );
    res.render("pages/tournaments", {
      tournaments: result.rows
    });
  } catch (err) {
    console.log(err);
  }
});

app.get("/tournaments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const tournament = await db.query(
      "SELECT * FROM tournaments WHERE id=$1", [id]
    );

    const teams = await db.query(
      "SELECT * FROM tournament_teams WHERE tournament_id=$1 ORDER BY registered_at ASC",
      [id]
    );

    const matches = await db.query(
      "SELECT * FROM tournament_matches WHERE tournament_id=$1 ORDER BY match_date ASC",
      [id]
    );

    // Check if logged-in user's team is already registered
    let isRegistered = false;
    if (req.isAuthenticated()) {
      const check = await db.query(
        "SELECT * FROM tournament_teams WHERE tournament_id=$1 AND LOWER(team_name)=LOWER($2)",
        [id, req.user.team]
      );
      isRegistered = check.rows.length > 0;
    }

    res.render("pages/tournament-detail", {
      tournament: tournament.rows[0],
      teams: teams.rows,
      matches: matches.rows,
      isRegistered
    });

  } catch (err) {
    console.log(err);
  }
});

// Register team for tournament
app.post("/tournaments/:id/register", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const { id } = req.params;

  try {
    // Check if already registered
    const check = await db.query(
      "SELECT * FROM tournament_teams WHERE tournament_id=$1 AND LOWER(team_name)=LOWER($2)",
      [id, req.user.team]
    );

    if (check.rows.length === 0) {
      await db.query(
        "INSERT INTO tournament_teams (tournament_id, team_name) VALUES ($1, $2)",
        [id, req.user.team]
      );
    }

    res.redirect(`/tournaments/${id}`);

  } catch (err) {
    console.log(err);
  }
});
app.post("/admin/generate-fixtures/:tournamentId", async (req, res) => {
  const { tournamentId } = req.params;

  try {
    const teams = await db.query(
      "SELECT * FROM tournament_teams WHERE tournament_id=$1",
      [tournamentId]
    );

    const teamList = teams.rows;

    // Round robin — every team plays every other team
    for (let i = 0; i < teamList.length; i++) {
      for (let j = i + 1; j < teamList.length; j++) {
        await db.query(
          `INSERT INTO tournament_matches 
           (tournament_id, teama, teamb, status, round) 
           VALUES ($1, $2, $3, 'UPCOMING', 'GROUP')`,
          [tournamentId, teamList[i].team_name, teamList[j].team_name]
        );
      }
    }

    res.redirect("/admin");

  } catch (err) {
    console.log(err);
    res.redirect("/admin");
  }
});



/* =========================
   News
========================= */

app.get("/news", (req, res) => {

    const news = [
        {
            _id: "1",
            title: "Final Match Announced",
            date: "March 18, 2026",
            author: "Admin",
            description: "The final match will be held this Sunday...",
           image: "/assets/news/match.jpg"
        }
    ];

    res.render("pages/news", { news });
});


httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});