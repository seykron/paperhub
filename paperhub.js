#!/usr/bin/node

var GithubClient = new require("./lib/GithubClient")
var GitHubStrategy = require("passport-github").Strategy;
var Memcached = require('memcached');

var extend = require("extend");
var express = require('express');
var engines = require('consolidate');
var passport = require("passport");
var async = require("async");
var _ = require("underscore");

var app = express();
var memcached = new Memcached(process.env.MEMCACHED_URL);

app.use(express.bodyParser({
  keepExtensions: true,
  uploadDir: __dirname + '/tmp'
}));
app.set("view engine", "handlebars");
app.set("views", __dirname);
app.engine('html', engines.handlebars);

// Setup for passport.
app.use(express.cookieParser());
app.use(express.cookieSession({
  key: "ph.sid",
  secret: "key cat"
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + '/public'));

var createContext = function (req, callback) {
  var repoName = req.param("repo") || "default";
  var fileId = req.param("file");
  var revisionId = req.param("revision");
  var client = new GithubClient(repoName, req.user);

  async.waterfall([
    function initRepos(fn) {
      client.listRepositories(function (err, repos) {
        fn(null, {
          repos: repos
        });
      });
    },
    function initCommonConfig(context, fn) {
      fn(null, extend(context, {
        PAD_URL: process.env.PAD_URL,
        user: req.user
      }));
    },
    function initRepo(context, fn) {
      client.getContextRepository(function (err, repo) {
        fn(err, extend(context, {
          repo: repo
        }));
      });
    },
    function initFiles(context, fn) {
      var repo = context.repo;

      repo.getFiles(repo.default_branch, true, function (err, files) {
        var currentFile;

        if (err) {
          return fn(err);
        }
        if (fileId) {
          currentFile = _.find(files, function (file) {
            return file.sha === fileId;
          });
          if (!currentFile) {
            fn(new Error("File not found: " + fileId));
            return;
          }
        }
        fn(null, extend(context, {
          files: files,
          currentFile: currentFile
        }));
      });
    },
    function initRevisions(context, fn) {
      if (!context.currentFile) {
        fn(null, context);
        return;
      }
      context.currentFile.getRevisions(function (err, revisions) {
        var currentRevision;

        if (err) {
          fn(err);
          return;
        }
        if (revisionId) {
          currentRevision = _.find(revisions, function (revision) {
            return revision.sha === revisionId;
          });
          if (!currentRevision) {
            fn(new Error("Revision not found: " + revisionId));
            return;
          }
        }
        context.currentFile.initialize(currentRevision && currentRevision.sha,
          function (err) {
            fn(err, extend(context, {
              revisions: revisions,
              currentRevision: currentRevision
            }));
          });
      });
    }
  ], function (err, context) {
    callback(err, context);
  });
};

app.get('/preview', function (req, res) {
  createContext(req, function (err, context) {
    var page = req.param("page") || 0;
    var customErr = err;

    if (!context.currentFile) {
      customErr = new Error("File not specified.");
    }
    if (customErr) {
      res.render("index.html", extend(context, {
        error: customErr
      }));
      return;
    }
    context.currentFile.preview(page, function (err, previewFile) {
      if (err) {
        res.render("index.html", extend(context, {
          error: customErr
        }));
      } else {
        res.sendfile(previewFile);
      }
    });
  });
});

app.get('/convert', function (req, res) {
  createContext(req, function (err, context) {
    var customErr = err;

    if (!context.currentFile) {
      customErr = new Error("File not specified.");
    }
    if (customErr) {
      res.render("index.html", extend(context, {
        error: customErr
      }));
      return;
    }
    context.currentFile.convert(function (err, outputFile) {
      if (err) {
        res.render("index.html", extend(context, {
          error: customErr
        }));
      } else {
        res.download(outputFile, "document.pdf", function (err) {
          if (err) {
            throw err;
          }
        });
      }
    });
  });
});

app.get("/", function (req, res) {
  createContext(req, function (err, context) {
    res.render("index.html", extend(context, {
      error: err
    }));
  });
});

passport.serializeUser(function(user, done) {
  done(null, user.id);
});
passport.deserializeUser(function(id, done) {
  memcached.get("/accounts/" + id, function (err, user) {
    done(err, user);
  });
});
passport.use(new GitHubStrategy({
  clientID: process.env.GH_CLIENT_ID,
  clientSecret: process.env.GH_CLIENT_SECRET,
  callbackURL: "http://localhost:7000/auth/github/callback",
  scope: "user,public_repo"
}, function(accessToken, refreshToken, profile, done) {
  memcached.get("/accounts/" + profile.id, function (err, user) {
    if (err) {
      done(err);
    } else {
      profile.accessToken = accessToken;

      if (user) {
        memcached.replace("/accounts/" + profile.id, profile,
          7200, function (err) {
            done(err, profile);
          });
        done(null, user);
      } else {
        memcached.set("/accounts/" + profile.id, profile,
          7200, function (err) {
            done(err, profile);
          });
      }
    }
  });
}));

app.get('/auth/github', passport.authenticate('github'));
app.get('/auth/github/callback', passport.authenticate('github', {
  failureRedirect: '/login'
}), function(req, res) {
  // Successful authentication, redirect home.
  res.redirect('/');
});

app.listen(7000);
