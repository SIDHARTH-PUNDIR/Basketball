import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import { Strategy } from "passport-local";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
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
  if (req.originalUrl.includes("tournaments")) {
    cb(null, "public/assets/tournaments/");
  } else if (req.originalUrl.includes("add-player")) {
    cb(null, "public/assets/players/");
  } else {
    cb(null, "public/assets/");
  }
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
app.use(async (req, res, next) => {
  res.locals.user = req.user;
  try {
    const matches = await db.query(`
      SELECT * FROM tournament_matches
      ORDER BY 
        CASE 
          WHEN status = 'LIVE' THEN 1
          WHEN match_date = CURRENT_DATE THEN 2
          WHEN match_date > CURRENT_DATE THEN 3
          ELSE 4
        END,
        match_date ASC
      LIMIT 4
    `);

    res.locals.matches = matches.rows;

  } catch (err) {
    console.log("MATCH LOAD ERROR:", err);
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

app.get("/tournaments/create", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  res.render("pages/create-tournament");
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
 if (!req.isAuthenticated() || req.user.is_admin) {
    return res.redirect("/");
  }

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

  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  if (!req.file) {
    console.log("❌ No file uploaded");
    return res.send("Image upload failed");
  }

  const { name, role, position } = req.body;
  const team = req.user.team;

  const image = "/assets/players/" + req.file.filename;

  console.log("✅ FILE:", req.file);
  console.log("✅ USER:", req.user);

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
    // 1️⃣ LIVE
    let result = await db.query(
      "SELECT id FROM tournament_matches WHERE status='LIVE' LIMIT 1"
    );

    if (result.rows.length > 0) {
      return res.redirect(`/live/${result.rows[0].id}`);
    }

    // 2️⃣ TODAY
    result = await db.query(`
      SELECT id FROM tournament_matches 
      WHERE match_date = CURRENT_DATE
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      return res.redirect(`/live/${result.rows[0].id}`);
    }

    // 3️⃣ ANY MATCH (🔥 FALLBACK)
    result = await db.query(`
      SELECT id FROM tournament_matches 
      ORDER BY id ASC LIMIT 1
    `);

    if (result.rows.length > 0) {
      return res.redirect(`/live/${result.rows[0].id}`);
    }

    res.send("No matches available");

  } catch (err) {
    console.log(err);
    res.send("Error loading live page");
  }
});
app.get("/live/:matchId", async (req, res) => {
  const matchId = req.params.matchId;

  try {
   const matchResult = await db.query(
  "SELECT * FROM tournament_matches WHERE id=$1",
  [matchId]
);

    const match = matchResult.rows[0];

    // ✅ Fetch both teams
    const teamAPlayers = await db.query(
      "SELECT * FROM players WHERE LOWER(team)=LOWER($1)",
      [match.teama]
    );

    const teamBPlayers = await db.query(
      "SELECT * FROM players WHERE LOWER(team)=LOWER($1)",
      [match.teamb]
    );

    console.log("TEAM A:", teamAPlayers.rows.length);
    console.log("TEAM B:", teamBPlayers.rows.length);

    res.render("pages/live", {
      matchId,
      match,
      teamAPlayers: teamAPlayers.rows,
      teamBPlayers: teamBPlayers.rows
    });

  } catch (err) {
    console.log("LIVE PAGE ERROR:", err);
    res.send("Error loading live page");
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

 socket.on("update_clock", ({ matchId, time, quarter, running }) => {
  io.emit(`clock_${matchId}`, { time, quarter, running });
  console.log(`Clock updated: ${time} ${quarter} running=${running}`);
});
socket.on("update_player_stats", ({ matchId, playerId, points, fouls, assists, rebounds }) => {
  io.emit(`player_stats_${matchId}`, { playerId, points, fouls, assists, rebounds });
  console.log(`Player stats updated: match ${matchId} player ${playerId}`);
});
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});





/* =========================
   PLAYERS API (for admin panel)
========================= */
app.get("/api/match/:id/players", async (req, res) => {
  const matchId = req.params.id;

  try {
    // Get the match to find team names
    const matchResult = await db.query(
  "SELECT * FROM tournament_matches WHERE id=$1",
  [matchId]
);

    if (matchResult.rows.length === 0) {
      return res.json([]);
    }

    const match = matchResult.rows[0];

    // Fetch players from both teams
    const players = await db.query(
      `SELECT id, name, position, team 
       FROM players 
       WHERE LOWER(team) = LOWER($1) OR LOWER(team) = LOWER($2)
       ORDER BY team, id ASC`,
      [match.teama, match.teamb]
    );

    res.json(players.rows);

  } catch (err) {
    console.log("PLAYERS API ERROR:", err);
    res.json([]);
  }
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
  tournaments: result.rows,
  user: req.user   // ADD THIS
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
    const leaderboard = await db.query(
  `SELECT * FROM tournament_teams
   WHERE tournament_id=$1
   ORDER BY points DESC, wins DESC`,
  [id]
);
    let matches = { rows: [] };

// 🔥 ONLY LOAD MATCHES IF TEAMS EXIST
if (teams.rows.length > 0) {
  matches = await db.query(
    "SELECT * FROM tournament_matches WHERE tournament_id=$1 ORDER BY match_date ASC",
    [id]
  );
}
    const users = await db.query("SELECT id, team FROM users ORDER BY team ASC");

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
  isRegistered,
  user: req.user,
  users: users.rows ,  // ✅ THIS WAS MISSING
   leaderboard: leaderboard.rows 
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
  const { type } = req.body;

  try {
    const teams = await db.query(
      "SELECT * FROM tournament_teams WHERE tournament_id=$1",
      [tournamentId]
    );

    const teamList = teams.rows;

    // ❌ delete old fixtures first
    await db.query(
      "DELETE FROM tournament_matches WHERE tournament_id=$1",
      [tournamentId]
    );

    // =========================
    // 🟠 ROUND ROBIN
    // =========================
    if (type === "round") {
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
    }

    // =========================
    // 🔴 KNOCKOUT
    // =========================
    else if (type === "knockout") {

      if (teamList.length < 4) {
        return res.redirect(`/tournaments/${tournamentId}`);
      }

      // shuffle teams
      const shuffled = teamList.sort(() => 0.5 - Math.random());

      // SEMI FINALS
      await db.query(
        `INSERT INTO tournament_matches 
         (tournament_id, teama, teamb, status, round) 
         VALUES ($1,$2,$3,'UPCOMING','SEMI FINAL')`,
        [tournamentId, shuffled[0].team_name, shuffled[1].team_name]
      );

      await db.query(
        `INSERT INTO tournament_matches 
         (tournament_id, teama, teamb, status, round) 
         VALUES ($1,$2,$3,'UPCOMING','SEMI FINAL')`,
        [tournamentId, shuffled[2].team_name, shuffled[3].team_name]
      );

      // FINAL placeholder
      await db.query(
        `INSERT INTO tournament_matches 
         (tournament_id, teama, teamb, status, round) 
         VALUES ($1,'TBD','TBD','UPCOMING','FINAL')`,
        [tournamentId]
      );
    }

    res.redirect(`/tournaments/${tournamentId}`);

  } catch (err) {
    console.log(err);
    res.redirect("/admin");
  }
});


/* =========================
   CREATE TOURNAMENT
========================= */

app.post("/tournaments/create", upload.single("image"), async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const { name, location, start_date, end_date, max_teams } = req.body;

  const imagePath = req.file
    ? "/assets/tournaments/" + req.file.filename
    : "/assets/tournaments/default.png";

  try {
    await db.query(
      `INSERT INTO tournaments 
       (name, location, start_date, end_date, max_teams, status, image, created_by) 
       VALUES ($1,$2,$3,$4,$5,'UPCOMING',$6,$7)`,
      [
        name,
        location,
        start_date,
        end_date,
        max_teams,
        imagePath,
        req.user.id
      ]
    );

    res.redirect("/tournaments");

  } catch (err) {
    console.log("CREATE TOURNAMENT ERROR:", err);
    res.redirect("/tournaments");
  }
});
/* =========================
   DELETE TOURNAMENT
========================= */

app.post("/tournaments/:id/delete", async (req, res) => {
  const { id } = req.params;

  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const result = await db.query(
      "SELECT * FROM tournaments WHERE id=$1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.redirect("/tournaments");
    }

    const tournament = result.rows[0];

    if (req.user.is_admin || req.user.id === tournament.created_by) {

      // delete related data first
      await db.query(
        "DELETE FROM tournament_teams WHERE tournament_id=$1",
        [id]
      );

      await db.query(
        "DELETE FROM tournament_matches WHERE tournament_id=$1",
        [id]
      );

      await db.query(
        "DELETE FROM tournaments WHERE id=$1",
        [id]
      );
    }

    res.redirect("/tournaments");

  } catch (err) {
    console.log("DELETE TOURNAMENT ERROR:", err);
    res.redirect("/tournaments");
  }
});/* =========================
   ADD TEAM (SAFE)
========================= */
app.post("/tournaments/:id/add-team", async (req, res) => {
  const { id } = req.params;
  const { team_id } = req.body;

  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const result = await db.query(
      "SELECT * FROM tournaments WHERE id=$1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.redirect("/tournaments");
    }

    const tournament = result.rows[0];

    if (req.user.is_admin || req.user.id === tournament.created_by) {

      // 🔥 GET TEAM NAME FROM USERS TABLE
      const teamData = await db.query(
        "SELECT team FROM users WHERE id=$1",
        [team_id]
      );

      if (teamData.rows.length === 0) {
        return res.redirect(`/tournaments/${id}`);
      }

      const teamName = teamData.rows[0].team;

      // ✅ PREVENT DUPLICATE
      const check = await db.query(
        "SELECT * FROM tournament_teams WHERE tournament_id=$1 AND LOWER(team_name)=LOWER($2)",
        [id, teamName]
      );

      if (check.rows.length === 0) {
        await db.query(
          "INSERT INTO tournament_teams (tournament_id, team_name) VALUES ($1,$2)",
          [id, teamName]
        );
      }
    }

    res.redirect(`/tournaments/${id}`);

  } catch (err) {
    console.log("ADD TEAM ERROR:", err);
    res.redirect(`/tournaments/${id}`);
  }
});
/* =========================
   REMOVE TEAM (FIXED)
========================= */
app.post("/tournaments/:tid/remove-team/:teamId", async (req, res) => {
  const { tid, teamId } = req.params;

  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // 1. Verify the tournament exists and the user has permission
    const tournamentResult = await db.query(
      "SELECT * FROM tournaments WHERE id=$1",
      [tid]
    );

    if (tournamentResult.rows.length === 0) return res.redirect("/tournaments");

    const tournament = tournamentResult.rows[0];

   if (true) {
      
      // 2. Delete the team registration
      await db.query(
        "DELETE FROM tournament_teams WHERE id=$1 AND tournament_id=$2",
        [teamId, tid]
      );

      // 3. FORCE DELETE ALL FIXTURES
      // Since the team list has changed, the old schedule is invalid.
      await db.query(
        "DELETE FROM tournament_matches WHERE tournament_id=$1",
        [tid]
      );
      
      console.log(`Cleared teams and fixtures for tournament ${tid}`);
    }

    res.redirect(`/tournaments/${tid}`);

  } catch (err) {
    console.error("REMOVE TEAM ERROR:", err);
    res.redirect(`/tournaments/${tid}`);
  }
});

/* =========================
    UPDATE MATCH RESULT
========================= */

app.post("/matches/:id/result", async (req, res) => {
  const { id } = req.params;
  const { scoreA, scoreB } = req.body;

  try {
    const match = await db.query(
      "SELECT * FROM tournament_matches WHERE id=$1",
      [id]
    );

    const m = match.rows[0];

    let winner, loser;

    if (scoreA > scoreB) {
      winner = m.teama;
      loser = m.teamb;
    } else {
      winner = m.teamb;
      loser = m.teama;
    }

    // ✅ update match
    await db.query(
      "UPDATE tournament_matches SET scorea=$1, scoreb=$2, status='FINAL', winner=$3 WHERE id=$4",
      [scoreA, scoreB, winner, id]
    );
    // =========================
// 🔴 SEMI → FINAL AUTO UPDATE
// =========================
if (m.round === "SEMI FINAL") {

  const semis = await db.query(
    "SELECT * FROM tournament_matches WHERE tournament_id=$1 AND round='SEMI FINAL'",
    [m.tournament_id]
  );

  const finished = semis.rows.filter(x => x.status === "FINAL");

  if (finished.length === 2) {
    const winner1 = finished[0].winner;
    const winner2 = finished[1].winner;

    await db.query(
      `UPDATE tournament_matches 
       SET teama=$1, teamb=$2 
       WHERE tournament_id=$3 AND round='FINAL'`,
      [winner1, winner2, m.tournament_id]
    );
  }
}

    // ✅ update winner
    await db.query(
      `UPDATE tournament_teams 
       SET wins = wins + 1,
           matches_played = matches_played + 1,
           points = points + 2
       WHERE tournament_id=$1 AND team_name=$2`,
      [m.tournament_id, winner]
    );

    // ✅ update loser
    await db.query(
      `UPDATE tournament_teams 
       SET losses = losses + 1,
           matches_played = matches_played + 1
       WHERE tournament_id=$1 AND team_name=$2`,
      [m.tournament_id, loser]
    );

    res.redirect(`/tournaments/${m.tournament_id}`);

  } catch (err) {
    console.log(err);
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





/* =========================
 Standings
========================= */
app.get("/standings", async (req, res) => {
  try {
    const tournamentsResult = await db.query(`
      SELECT id, name FROM tournaments ORDER BY name ASC
    `);
    const tournaments = tournamentsResult.rows;

    // JOIN to get tournament name alongside each match
    const matchesResult = await db.query(`
      SELECT m.*, t.name AS tournament_name
      FROM tournament_matches m
      LEFT JOIN tournaments t ON t.id = m.tournament_id
      ORDER BY m.tournament_id ASC, m.match_date ASC NULLS LAST, m.round ASC
    `);
    const allMatches = matchesResult.rows;

    const matchesByTournament = {};
    tournaments.forEach(t => { matchesByTournament[t.id] = []; });
    allMatches.forEach(m => {
      if (matchesByTournament[m.tournament_id]) {
        matchesByTournament[m.tournament_id].push(m);
      }
    });

    res.render("pages/standings", {
      tournaments,
      allMatches,
      matchesByTournament,
      totalMatches: allMatches.length,
      user: req.user,
    });

  } catch (err) {
    console.error("[/standings]", err.message);
    res.status(500).send(`Error: ${err.message}`);
  }
});
httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});