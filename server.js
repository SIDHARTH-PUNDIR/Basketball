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

/* =========================
   VIEW ENGINE
========================= */

app.set("view engine", "ejs");

/* =========================
   MIDDLEWARE
========================= */

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


/* =========================
   MULTER IMAGE UPLOAD
========================= */

const storage = multer.diskStorage({

destination: function (req, file, cb) {
cb(null, "public/assets/players");
},

filename: function (req, file, cb) {
cb(null, Date.now() + "-" + file.originalname);
}

});

const upload = multer({ storage: storage });


/* =========================
   GLOBAL USER ACCESS
========================= */

app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});
/* =========================
   DATABASE CONNECTION
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
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register");
});


/* =========================
   REGISTER USER
========================= */

app.post("/register", async (req, res) => {

  const name = req.body.name;
  const email = req.body.email;
  const team = req.body.team;
  const password = req.body.password;

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

    const user = result.rows[0];

    req.login(user, (err) => {
      if (err) {
        console.log(err);
      }
      return res.redirect("/dashboard");
    });

  } catch (err) {
    console.log(err);
  }

});

/* =========================
   LOGIN USER
========================= */

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login",
  })
);
/* =========================
   ADD PLAYER PAGE
========================= */

app.get("/add-player", (req, res) => {
  res.render("add-player");
});


/* =========================
   ADD PLAYER
========================= */

app.post("/add-player", upload.single("image"), async (req, res) => {

  const name = req.body.name;
  const role = req.body.role;
  const team = req.user.team;
  const position = req.body.position;

  const image = "/assets/players/" + req.file.filename;

  try {

   await db.query(
"INSERT INTO players (name,role,team,image,position) VALUES ($1,$2,$3,$4,$5)",
[name,role,team,image,position]
);
    res.redirect("/dashboard");

  } catch (err) {
    console.log(err);
  }

});
app.post("/remove-player/:id", async (req, res) => {

  const id = req.params.id;
  const team = req.user.team;

  try {

    await db.query(
      "DELETE FROM players WHERE id = $1 AND team = $2",
      [id, team]
    );

    res.redirect("/dashboard");

  } catch (err) {
    console.log(err);
  }

});
/* =========================
   DASHBOARD (PROTECTED)
========================= */

app.get("/dashboard", async (req, res) => {

if (!req.isAuthenticated()) {
return res.redirect("/login");
}

try {

const team = req.user.team;

const players = await db.query(
"SELECT * FROM players WHERE team=$1 ORDER BY id ASC",
[team]
);

res.render("dashboard", {
user: req.user,
players: players.rows
});

} catch (err) {
console.log(err);
}

});
/* =========================
   LOGOUT
========================= */

app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

/* =========================
   PASSPORT LOCAL STRATEGY
========================= */

passport.use(
  new Strategy(
    { usernameField: "email" },
    async function verify(email, password, cb) {

      try {

        const result = await db.query(
          "SELECT * FROM users WHERE email=$1",
          [email]
        );

        if (result.rows.length === 0) {
          return cb(null, false);
        }

        const user = result.rows[0];

        const valid = await bcrypt.compare(password, user.password);

        if (valid) {
          return cb(null, user);
        } else {
          return cb(null, false);
        }

      } catch (err) {
        return cb(err);
      }

    }
  )
);

/* =========================
   SESSION MANAGEMENT
========================= */

passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

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
   /assign-position
========================= */
app.post("/assign-position", async (req, res) => {

  if (!req.isAuthenticated()) {
    return res.sendStatus(401);
  }

  const { playerId, position } = req.body;

  console.log(req.body); // debug

  try {

    await db.query(
      "UPDATE players SET position = NULL WHERE position = $1 AND team = $2",
      [position, req.user.team]
    );

    await db.query(
      "UPDATE players SET position = $1 WHERE id = $2 AND team = $3",
      [position, playerId, req.user.team]
    );

    res.sendStatus(200);

  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }

});
/* =========================
   START SERVER
========================= */

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});