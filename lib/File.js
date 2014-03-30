/** Represents a file in both GitHub and Etherpad.
 *
 * @param {GithubClient} client Client used to read file from github. Cannot be
 *    null.
 * @param {GithubRepository} repository Repository that owns this file. Cannot
 *    be null.
 * @param {Object} blob Object that contains file information. Cannot be null.
 * @constructor
 */
module.exports = function File(client, repository, blob) {

  /** Node's Path API.
   * @type {Object}
   * @private
   * @fieldOf File#
   */
  var path = require("path");

  /** Node's File System API.
   * @type {Object}
   * @private
   * @fieldOf File#
   */
  var fs = require("fs");

  /** Node's utility to run executable files.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var execFile = require("child_process").execFile;

  /** Command to convert file to PDF.
   * @type {String}
   * @constant
   * @private
   * @fieldOf File#
   */
  var CONVERT_CMD = path.join(__dirname, "..", "/compile-document.sh");

  /** Current file instace.
   * @type {File}
   * @private
   * @fieldOf File#
   */
  var instance = this;

  /** Memcached item component.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var CacheItem = require('./CacheItem');

  /** Node's Buffer API.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var Buffer = require("buffer").Buffer;

  /** Utility to extend objects.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var extend = require("extend");

  /** Lightweight HTTP client.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var request = require("request");

  /** Underscore utils library.
   * @type {Object}
   * @private
   * @fieldOf File#
   */
  var _ = require("underscore");

  /** Crypto API for hashing.
   * @type {Object}
   * @private
   * @fieldOf File#
   */
  var crypto = require("crypto");

  /** Library to perform operations over images.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var gm = require("gm").subClass({ imageMagick: true });

  /** Utility to create directories recursively.
   * @type {Function}
   * @private
   * @fieldOf File#
   */
  var mkdirp = require("mkdirp");

  /** Cache item for this file.
   * @type {CacheItem}
   * @private
   * @fieldOf File#
   */
  var cacheItem = new CacheItem(client.getId());

  /** Etherpad documents client.
   * @type {Object}
   * @private
   * @fieldOf File#
   */
  var pad = require('etherpad-lite-client').connect({
    apikey: process.env.PAD_API_KEY,
    host: process.env.PAD_HOST,
    port: process.env.PAD_PORT
  });

  /** Finds a file revision in the remote repository. It retrieves the revision
   * from cache if possible.
   *
   * @param {String} revisionId Id of the revision to retrieve. Cannot be null
   *    or empty.
   * @param {Function} callback Receives an error, the revision, the file, and
   *    a flag indicating whether the file changed in relation to HEAD. Cannot
   *    be null.
   * @private
   * @methodOf File#
   */
  var findRevisionById = function(revisionId, callback) {
    instance.getRevisions(function(err, revisions) {
      var revision;

      if (err) {
        callback(err, null);
        return;
      }

      if (revisionId) {
        revision = _.find(revisions, function (revision) {
          return revision.sha === revisionId;
        });
      } else {
        revision = revisions.shift();
      }

      if (revision.content) {
        callback(null, revision);
        return;
      }

      client.api.repos.compareCommits({
        user: client.getUserName(),
        repo: repository.name,
        head: revision.sha,
        base: revision.prev || revision.sha
      }, function (err, patch) {
        var file;

        if (err) {
          callback(err);
          return;
        }
        file = _.find(patch.files || [], function (file) {
          return file.filename === blob.path;
        });
        callback(null, revision, file, patch.status === "identical");
      });
    });
  };

  /** Stores the revision content into the cache.
   * @param {String} revisionId Id of the revision to store. Cannot be null or
   *    empty.
   * @param {String} content Content to store. Cannot be null.
   * @param {Function} callback Receives an error and the content as parameters.
   *    Cannot be null.
   * @private
   * @methodOf File#
   */
  var storeContent = function (revisionId, content, callback) {
    cacheItem.retrieve("revisions", function (err, revisions) {
      var revision;

      if (err) {
        callback(err, null);
        return;
      }
      if (revisions && revisions.hasOwnProperty(blob.path)) {
        revision = _.find(revisions[blob.path], function (revisionData) {
          return revisionData.sha === revisionId;
        });

        revision.content = content;
        cacheItem.store("revisions", revisions, function (err) {
          callback(err, content);
        });
      } else {
        callback(null, content);
      }
    });
  };

  /** Gets file content at the specified revision.
   * @param {String} revisionId Id of the required revision. If it is null, the
   *    HEAD version of the file will be retrieved.
   * @param {Function} callback Receives an error and the file contents as
   *    String.
   * @private
   * @methodOf File#
   */
  var getContent = function (revisionId, callback) {
    findRevisionById(revisionId, function (err, revision, file, identical) {
      if (err) {
        callback(err, null);
        return;
      }
      if (revision.content) {
        callback(null, revision.content);
      } else {
        if (identical) {
          client.api.repos.getContent({
            user: client.getUserName(),
            repo: repository.name,
            path: blob.path
          }, function (err, data) {
            var content;

            if (err) {
              callback(err, null);
              return;
            }
            content = new Buffer(data.content, "base64");
            storeContent(revision.sha, content.toString(), callback);
          });
        } else {
          request(file.raw_url, function (err, response, body) {
            if (err) {
              callback(err, null);
              return;
            }
            storeContent(revision.sha, body, callback);
          });
        }
      }
    });
  };

  /** Creates the pad with the specified text if it does not already exist.
   * @param {String} documentId Id of the pad to create. Cannot be null or
   *    empty.
   * @param {String} text Pad content. Cannot be null.
   * @param {Function} callback Receives an error as parameter. Cannot be null.
   * @private
   * @methodOf File#
   */
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

  /** Retrieves the file path in the local file system.
   * @param {Function} callback Receives an error and the file path as
   *    parameters. Cannot be null.
   * @private
   * @methodOf File#
   */
  var getLocalPath = function (callback) {
    var workingDir = path.join(__dirname, "..", "workspace",
      repository.full_name, path.dirname(blob.path));
    var fileName = path.basename(blob.path);

    var updateContent = function () {
      pad.getText({
        padID: instance.id
      }, function (err, document) {
        if (err) {
          callback(err);
        } else {
          fs.writeFileSync(path.join(workingDir, fileName), document.text);
          callback(null, path.join(workingDir, fileName));
        }
      });
    };

    if (!fs.existsSync(workingDir)) {
      mkdirp(workingDir, function (err) {
        if (err) {
          callback(err);
        } else {
          updateContent();
        }
      });
    } else {
      updateContent();
    }
  };

  return extend(instance, blob, {

    /** File unique id. It depends on the selected revision. */
    id: blob.sha,

    /** Initializes this file at the specified revision. The file must be
     * initialized in order to synchronize content between Github and Etherpad.
     *
     * @param {String} revision Revision of the file content. If null, it
     *    assumes the HEAD revision.
     * @param {Function} callback Receives an error as parameter. Cannot be
     *    null.
     */
    initialize: function (revision, callback) {
      getContent(revision, function (err, content) {
        var hash = crypto.createHash("sha1");

        if (err) {
          callback(err, null);
          return;
        }
        if (revision) {
          hash.update(blob.sha + "_" + revision);
          instance.id = hash.digest("hex");
        }
        createPadIfNotExists(instance.id, content.toString(), callback);
      });
    },

    /** Retrieves the list of revisions of this file.
     * @param {Function} callback Receives an error and the list of revisions
     *    of this file. Cannot be null.
     */
    getRevisions: function (callback) {
      cacheItem.retrieve("revisions", function (err, revisions) {
        var revisionsItem = revisions || {};

        if (err) {
          callback(err, null);
          return ;
        }

        if (revisions && revisions.hasOwnProperty(blob.path)) {
          callback(null, revisions[blob.path]);
        } else {
          client.api.repos.getCommits({
            user: client.getUserName(),
            repo: repository.name,
            path: blob.path
          }, function (err, commits) {
            var plainRevisions = [];

            if (err) {
              callback(err, null);
              return;
            }
            _.each(commits, function (commit, index) {
              var parent = null;
              if (commit.parents.length) {
                parent = commit.parents.shift()
              }
              plainRevisions.push({
                sha: commit.sha,
                prev: parent && parent.sha,
                content: null
              });
            });

            revisionsItem[blob.path] = plainRevisions;
            cacheItem.store("revisions", revisionsItem, function (err) {
              callback(null, plainRevisions);
            });
          });
        }
      });
    },

    /** Converts this file to PDF using the default template.
     * @param {Function} callback Receives the output file path. Cannot be null.
     */
    convert: function (callback) {
      getLocalPath(function (err, localPath) {
        var outputFile = localPath + ".pdf";
        var params = [localPath, "-o " + outputFile];

        if (err) {
          callback(err);
          return;
        }

        execFile(CONVERT_CMD, params, function (error, stdout, stderr) {
          if (error) {
            callback(error);
          } else {
            callback(null, outputFile);
          }
        });
      });
    },

    /** Makes a preview image for this document. If the document is not
     * converted to PDF, it forces the convertion first.
     *
     * @param {Number} page Number of page to make a preview of. Cannot be null.
     * @param {Function} callback Receives the preview file path. Cannot be
     *    null.
     */
    preview: function (page, callback) {
      var doPreview = function (localPath, outputFile) {
        var previewFile = localPath + "." + page + ".png";

        gm(outputFile + "[" + page + "]").write(previewFile, function (err) {
          callback(err, previewFile);
        });
      };
      getLocalPath(function (err, localPath) {
        var outputFile = localPath + ".pdf";

        if (!fs.existsSync(outputFile)) {
          instance.convert(function (err) {
            if (err) {
              callback(err);
            } else {
              doPreview(localPath, outputFile);
            }
          });
        } else {
          doPreview(localPath, outputFile);
        }
      })
    }
  });
};
