const express = require('express')
const https = require('https')
const fs = require('fs')
const app = express()
var cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
let allowOrigin = '*' // origin|*|null

// Fire-and-forget notification to the Slack security-response bot (see slackbot/).
// Bot isn't required for the app to run - if it's not up, this just logs and continues.
const SLACKBOT_ALERT_URL = process.env.SLACKBOT_ALERT_URL || 'http://127.0.0.1:3001/internal/alert';
function notifySecurityAlert(payload) {
  fetch(SLACKBOT_ALERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.log('Could not reach slackbot alert endpoint (is it running?): ' + err.message);
  });
}



var router = express.Router()

app.set('view engine', 'ejs')
app.set('trust proxy', true)
app.use(cookieParser())

//Hack static for default CORS (no custom headers) including allowing POST
app.post("*appInit", function(req, res, next) {
  req.method = "GET";
  console.log("Override!!")
  next();
});

function blockIfNoCookie(req, res) {
  console.log(req.hostname + ":" + JSON.stringify(req.cookies))
  if (req.path.startsWith("/json-") && req.cookies.superSecretSession == null) {
    console.log("Blocking request");
    res.status(400).send('missing authorization header');
    return true;
  } else {
    return false;
  }
}
// Hack content types - used to fake json requests where result is just a static
// file
app.use(function (req, res, next) {


  if (req.path.startsWith("/json-")) {
    console.log("Setting content type to JSON")
    res.setHeader('Content-Type', "application/json");
    res.setHeader('Vary', "Origin");
  }
  if (req.path.startsWith("/json-default/")) {
    console.log(req.get('Origin'))
  } else if (false && req.path.startsWith("/json-cors-wildcard/")) {

    if (allowOrigin == "origin" && req.get("Origin") != null) {
      res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));
    } else if (allowOrigin == "*") {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } // else default to not setting header

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Accept-Encoding, Accept-Language, Authorization, Cache-Control, Content-Type, X-Requested-With, Range, origin');
    //res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      return res.send(200);
    } else {
      return next();
    }
  } else if (req.path.startsWith("/json-cors-wildcard/")) {
    if (allowOrigin == "origin" && req.get("Origin") != null) {
      res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));
    } else if (allowOrigin == "*") {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } // else default to not setting header

    res.setHeader('Access-Control-Allow-Credentials', 'true');

    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-XSS-Protection', '1; mode=block');
  } else if (req.path.startsWith("/json-cors-origin/")) {
    const origin = req.get("Origin");

    if (origin != null) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', "https://" + req.hostname + ":3000");
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Security detection hook (Part 5): a credentialed cross-origin request against this
    // route is exactly the signature of the Part 1 CORS-theft attack - flag it live.
    const ownOrigins = ["https://" + req.hostname + ":3000", "https://www.nc.com:3000", "https://localhost:3000"];
    if (origin != null && !ownOrigins.includes(origin) && req.cookies.superSecretSession != null) {
      console.log("SECURITY ALERT: possible CORS data theft in progress from origin " + origin);
      notifySecurityAlert({
        type: 'cyber_attack_suspected',
        origin,
        ip: req.ip,
        path: req.path,
        userAgent: req.get('User-Agent'),
      });
    }
  }

  if (blockIfNoCookie(req, res)) {
    return null;
  }
  return next();
})

app.use(express.static('public'))
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/login', function (req, res) {
  res.cookie('superSecretSession',"123", { maxAge: 900000, httpOnly: false })
  console.log('cookie have created successfully');
  res.render('index')
})

app.get('/', function (req, res) {
  console.log("Audit log: Received request from: " + req.ip)
  res.render('index')
})

app.get('/cors/explicit/', function (req, res) {
  res.render('cors/explicit')
})

app.get('/cors/allow-origin/:thing', function (req, res) {
  res.render('cors/allow-origin/' + req.params.thing);
})
app.get('/local-storage/:thing', function (req, res) {
  res.render('local-storage/' + req.params.thing);
})

app.options('/local-storage/yummy', function(req, res) {
  res.setHeader('Vary', "Origin");
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-type');

  if (req.get("Origin") != null) {
    res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));
  } else {
    res.setHeader('Access-Control-Allow-Origin', "https://" + req.hostname + ":3000");
  }
  res.sendStatus(200);
});

app.put('/local-storage/yummy', function(req, res) {
  res.setHeader('Vary', "Origin");
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-type');
  if (req.get("Origin") != null) {
    res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));
  } else {
    res.setHeader('Access-Control-Allow-Origin', "https://" + req.hostname + ":3000");
  }
  console.log("Stole some more stuff: ", console.log(req.body))
  //console.log("Stole some more stuff: " + console.log(req.body))

  res.sendStatus(200);
});


https.createServer(
  {
    key: fs.readFileSync("www.nc.com.key"),
    cert: fs.readFileSync("www.nc.com.pem"),
  },
    app).listen(3000, ()=>{
  console.log('server is running at port 3000 with https')
});
