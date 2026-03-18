import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import { Strategy } from "passport-local";
import dotenv from "dotenv";
import multer from "multer";

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

// Makes matches available in ALL templates automatically
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

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login",
  })
);

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

    res.render("pages/dashboard", {
      user: req.user,
      players: players.rows,
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
    // Find first LIVE match
    const liveMatch = await db.query(
      "SELECT id FROM matches WHERE status='LIVE' ORDER BY id ASC LIMIT 1"
    );

    if (liveMatch.rows.length > 0) {
      return res.redirect(`/live/${liveMatch.rows[0].id}`);
    }

    // Fallback: first match
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

    // Always fetch home team players — visible to everyone
    const result = await db.query(
      "SELECT * FROM players WHERE team=$1 ORDER BY id ASC",
      [match.teama]
    );
    const players = result.rows;

    // Still track logged-in user's team for the panel tag
    const team = req.isAuthenticated() ? req.user.team : match.teama;

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
   START SERVER
========================= */

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});