#!/usr/bin/node

var CONVERT_CMD = __dirname + "/compile-document.sh";
var PAD_URL = process.env.PAD_URL;
var PAD_API_KEY = process.env.PAD_API_KEY;

var express = require('express');
var engines = require('consolidate');
var app = express();
var execFile = require("child_process").execFile;
var fs = require("fs");
var git = require("gift");
var path = require("path");
var http = require("http");
var gm = require("gm").subClass({ imageMagick: true });
var crypto = require("crypto");
var passport = require("passport");
var pad = require('etherpad-lite-client').connect({
  apikey: PAD_API_KEY,
  host: process.env.PAD_HOST,
  port: process.env.PAD_PORT
});
var GitHubStrategy = require("passport-github").Strategy;
var GitHubApi = require("github");
var github = new GitHubApi({
  version: "3.0.0",
  protocol: "https"
});

app.use(express.bodyParser({
  keepExtensions: true,
  uploadDir: __dirname + '/tmp'
}));
app.set("view engine", "handlebars");
app.set("views", __dirname);
app.engine('html', engines.handlebars);

// Setup for passport.
app.use(express.cookieParser());
app.use(express.session({ secret: 'keyboard cat' }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + '/public'));

var buildFilesTree = function (root, callback) {
  var files = [];
  var path = [];

  var nextNode = function (children, node, fn) {
    var currentPath = path.join("/");

    if (children.length === 0) {
      path.pop();
      fn(null, files);
      return;
    }
    if (node.contents) {
      node.contents(function (err, nodes) {
        if (err) {
          fn(err, null);
          return;
        }
        path.push(node.name);
        nextNode(nodes, nodes.shift(),
          nextNode.bind(null, children, children.shift(), fn));
      });
    } else {
      if (currentPath && currentPath.substr(0, 1) !== "/") {
        currentPath = "/" + currentPath;
      }
      if (path.length > 0 && currentPath.substr(-1, 1) !== "/") {
        currentPath += "/";
      }

      files.push(currentPath + node.name);
      nextNode(children, children.shift(), fn);
    }
  };

  root.contents(function (err, children) {
    if (children) {
      nextNode(children, children.shift(), callback);
    } else {
      callback(null, []);
    }
  });
};

var getDocumentId = function (req) {
  var repoName = req.param("repo") || "default";
  var file = req.param("file") || "untitled-document.md";
  var hash = crypto.createHash("sha1");
  var documentId;

  if (repoName.substr(-1, 1) !== "/") {
    repoName += "/";
  }

  documentId = (repoName + "_" + file).replace(/[\/\\:\.]/ig, "_");

  // Hashes the document name, if possible.
  hash.update(documentId);

  return hash.digest("hex");
};

var resolveFile = function (req, localRepo) {
  var file = req.param("file");
  var fullPath = null;

  if (!file) {
    fullPath = path.join(localRepo, getDocumentId(req));
  } else if (file) {
    fullPath = path.join(localRepo, file.replace(/(\/)*\.\.(\/)*|^\//ig, ''));
  }

  // Normalizes path, just to avoid scriptkiddies.
  return fullPath;
};

var openRepo = function (req, callback) {
  var remoteRepo = req.param("repo");
  var repoName = remoteRepo || "default";
  var localRepo = path.join(__dirname, "workspace", repoName
    .replace(/[\/\\:]/ig, "_"));
  var requiredFile = req.param("file");
  var proceed = function (repo) {
    buildFilesTree(repo.tree(), function (err, files) {
      var filesMap = files.map(function (file) {
        return {
          repo: remoteRepo,
          name: file
        };
      });
      callback(err, repo, filesMap, resolveFile(req, localRepo));
    });
  };

  if (fs.existsSync(localRepo)) {
    proceed(git(localRepo));
  } else {
    fs.mkdirSync(localRepo);

    if (remoteRepo) {
      git.clone(remoteRepo, localRepo, function (err, repo) {
        if (err) {
          callback(err);
        } else {
          proceed(repo);
        }
      });
    } else {
      // Default local repository.
      git.init(localRepo, function (err, repo) {
        if (err) {
          callback(err);
        } else {
          proceed(repo);
        }
      });
    }
  }
};

var createPadIfNotExists = function (documentId, text, callback) {
  pad.getLastEdited({
    padID: documentId
  }, function (err, data) {
    if (err) {
      // Pad does not exist.
      pad.createPad({
        padID: documentId
      }, function (err, data) {
        if (err) {
          callback(err);
          return;
        }
        pad.setText({
          padID: documentId,
          text: text
        }, function (err, data) {
          callback(err);
        });
      });
    } else {
      callback(null);
    }
  });
};

var sendResponse = function (req, res, error, files) {
  github.repos.getFromUser({
    user: req.user && req.user.username
  }, function (err, repos) {
    res.render("index.html", {
      error: error,
      repo: req.param("repo"),
      gitFiles: files,
      file: req.param("file"),
      user: req.user,
      repos: repos,
      documentId: getDocumentId(req),
      PAD_URL: PAD_URL
    });
  });
};

app.get('/', function (req, res) {
  openRepo(req, function (err, repo, files, currentFile) {
    var preview = req.param("preview");
    var page = req.param("page") || 0;
    var previewFile = currentFile + "." + page + ".png";
    var outputFile = currentFile + ".pdf";
    var documentId = getDocumentId(req);

    if (fs.existsSync(currentFile)) {
      if (preview) {
        gm(outputFile + "[" + page + "]").write(previewFile, function (err) {
          if (err) {
            sendResponse(req, res, "Preview does not exist, did you invoked " +
              "convert first? :)", files);
          } else {
            res.sendfile(previewFile);
          }
        });
      } else {
        fs.readFile(currentFile, function (err, document) {
          createPadIfNotExists(documentId, document.toString(), function (err) {
            sendResponse(req, res, err, files);
          });
        });
      }
    } else {
      sendResponse(req, res, err, files);
    }
  });
});

app.post("/", function (req, res) {
  openRepo(req, function (err, repo, files, currentFile) {
    var outputFile = currentFile + ".pdf";
    var params = [currentFile, "-o " + outputFile];

    pad.getText({
      padID: getDocumentId(req)
    }, function (err, document) {
      if (err) {
        sendResponse(req, res, err, files);
        return;
      }

      fs.writeFileSync(currentFile, document.text);

      execFile(CONVERT_CMD, params, function (error, stdout, stderr) {
        if (error) {
          sendResponse(req, res, stderr.toString(), files);
        } else {
          res.download(outputFile, "document.pdf", function (err) {
            if (err) {
              sendResponse(req, res, err, files);
            }
          });
        }
      });
    });
  });
});
passport.serializeUser(function(user, done) {
  done(null, user);
});
passport.deserializeUser(function(obj, done) {
  done(null, obj);
});
passport.use(new GitHubStrategy({
  clientID: process.env.GH_CLIENT_ID,
  clientSecret: process.env.GH_CLIENT_SECRET,
  callbackURL: "http://localhost:7000/auth/github/callback",
  scope: "user,public_repo"
}, function(accessToken, refreshToken, profile, done) {
  github.authenticate({
    type: "oauth",
    token: accessToken
  });
  done(null, profile);
}));

app.get('/auth/github', passport.authenticate('github'));
app.get('/auth/github/callback', passport.authenticate('github', {
  failureRedirect: '/login'
}), function(req, res) {
  // Successful authentication, redirect home.
  res.redirect('/');
});

app.listen(7000);
