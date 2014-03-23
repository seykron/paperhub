#!/usr/bin/node

var CONVERT_CMD = __dirname + "/compile-document.sh";
var GIT_BASE = __dirname + "/workspace";

var express = require('express');
var engines = require('consolidate');
var app = express();
var execFile = require("child_process").execFile;
var fs = require("fs");
var git = require("gift");

app.use(express.bodyParser({
  keepExtensions: true,
  uploadDir: __dirname + '/tmp'
}));
app.set("view engine", "handlebars");
app.set("views", __dirname);
app.engine('html', engines.handlebars);

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
    nextNode(children, children.shift(), callback);
  });
};

var openRepo = function (remoteRepo, localRepo, callback) {
  var proceed = function (repo) {
    buildFilesTree(repo.tree(), function (err, files) {
      callback(err, repo, files.map(function (file) {
        return {
          repo: remoteRepo,
          name: file
        };
      }));
    });  
  };

  if (fs.existsSync(localRepo)) {
    proceed(git(localRepo));
  } else {
    fs.mkdirSync(localRepo);

    git.clone(remoteRepo, localRepo, function (err, repo) {
      if (err) {
        callback(err);
      } else {
        proceed(repo);
      }
    });
  }
};

var loadFile = function (localRepo, file, callback) {
  var requiredFile = file;
  if (!requiredFile) {
    callback();
    return;
  }
  // Normalizes path, just to avoid scriptkiddies.
  requiredFile = requiredFile.replace(/(\/)*\.\.(\/)*|^\//ig, '');
  fs.readFile(localRepo + "/" + requiredFile, callback);
};

app.get('/', function (req, res) {
  var localRepo;
  var remoteRepo = req.param("repo");

  if (remoteRepo) {
    localRepo = GIT_BASE + "/" + remoteRepo.replace(/[\/\\:]/ig, "_");

    openRepo(remoteRepo, localRepo, function (err, repo, files) {
      loadFile(localRepo, req.param("file"), function (err, document) {
        res.render("index.html", {
          error: err,
          repo: remoteRepo,
          gitFiles: files,
          document: document
        });
      });
    });
  } else {
    res.render("index.html");
  }
});

app.post("/", function (req, res) {
  var tempFile = __dirname + "/data-" + Date.now() +
    Math.floor((Math.random() * 37159)) + ".md";
  var params = [tempFile, "-o " + tempFile + ".pdf"];

  fs.writeFileSync(tempFile, req.body.document);

  execFile(CONVERT_CMD, params, function (error, stdout, stderr) {
    if (error) {
      res.render("index.html", {
        error: stderr.toString(),
        document: req.body.document
      });
      fs.unlinkSync(tempFile);
    } else {
      res.download(tempFile + ".pdf", "document.pdf", function (err) {
        fs.unlinkSync(tempFile);
        fs.unlinkSync(tempFile + ".pdf");
      });
    }
  });  
});

app.listen(7000);
