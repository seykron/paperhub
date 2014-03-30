/** Manages GitHub repository operations.
 *
 * @param {GithubClient} client Initialized Github client. Cannot be null.
 * @param {String} repositoryName Name of the repository managed by this class.
 *    Cannot be null or empty.
 * @constructor
 */
module.exports = function GithubRepository(client, repository) {

  /** Current repository instace.
   * @type {GithubRepository}
   * @private
   * @fieldOf GithubRepository#
   */
  var instance = this;

  /** Memcached item component.
   * @type {Function}
   * @private
   * @fieldOf GithubRepository#
   */
  var CacheItem = require('./CacheItem');

  /** Single file in the repository.
   * @type {Function}
   * @private
   * @fieldOf GithubRepository#
   */
  var File = require("./File");

  /** Cache item for this repository.
   * @type {CacheItem}
   * @private
   * @fieldOf GithubRepository#
   */
  var cacheItem = new CacheItem(client.getId());

  /** Utility to extend objects.
   * @type {Function}
   * @private
   * @fieldOf GithubRepository#
   */
  var extend = require("extend");

  /** Repository default branch.
   * @param {String} branchName Name of the required branch. Cannot be null or
   *    empty.
   * @param {Function} callback Receives an error and the branch object as
   *    parameters. Cannot be null.
   * @type {Object}
   * @private
   * @methodOf GithubRepository#
   */
  var getBranch = function (branchName, callback) {
    cacheItem.retrieve("branches", function (err, branches) {
      var branchesItem = branches || {};

      if (err) {
        callback(err, null);
        return;
      }
      if (branches && branches.hasOwnProperty(branchName)) {
        callback(null, branches[branchName]);
      } else {
        client.api.repos.getBranch({
          user: client.getUserName(),
          repo: repository.name,
          branch: branchName
        }, function (err, branch) {
          if (err) {
            callback(err, null);
            return;
          }
          branchesItem[branch.name] = branch;
          cacheItem.store("branches", branchesItem, function (err) {
            callback(err, branch);
          });
        });
      }
    });
  };

  /** Retrieves the tree with the specified id.
   * @param {String} sha Required tree id. Cannot be null or empty.
   * @param {Boolean} recursive Whether to retrieve the full tree or only the
   *    first level. Cannot be null.
   * @param {Function} callback Receives an error and the required tree as
   *    parameters. Cannot be null.
   * @private
   * @methodOf GithubRepository#
   */
  var getTree = function (sha, recursive, callback) {
    cacheItem.retrieve("trees", function (err, trees) {
      var treesItem = trees || {};

      if (err) {
        callback(err, null);
        return;
      }

      if (trees && trees.hasOwnProperty(sha)) {
        callback(null, trees[sha]);
      } else {
        client.api.gitdata.getTree({
          user: client.getUserName(),
          repo: repository.name,
          sha: sha,
          recursive: recursive
        }, function (err, treeData) {
          if (err) {
            callback(err, null);
            return;
          }
          treesItem[treeData.sha] = treeData.tree;
          cacheItem.store("trees", treesItem, function (err) {
            callback(err, treeData.tree);
          });
        });
      }
    });
  };

  return extend(instance, repository, {

    /** Retrieves the repository default branch.
     * @param {Function} callback Receives an error and the default branch as
     *    parameters. Cannot be null.
     */
    getDefaultBranch: function (callback) {
      getBranch(repository.default_branch, callback);
    },

    /** Retrieves all files in the specified branch.
     *
     * @param {String|Object} branch Branch name or instance that contains the
     *    required tree. Cannot be null.
     * @param {Boolean} recursive Indicates whether files must be retrieved
     *    recursively or just the root directory. Cannot be null.
     * @param {Function} callback Receives an error and the list of files as
     *    parameters.
     */
    getFiles: function (branch, recursive, callback) {
      var processTree = function (err, tree) {
        var documents;

        if (err) {
          callback(err, null);
          return;
        }
        documents = tree.filter(function (item) {
          return item.type === "blob";
        }).map(function (blob) {
          return new File(client, instance, blob);
        });
        callback(null, documents);
      };
      if (typeof branch === "string") {
        getBranch(branch, function (err, requiredBranch) {
          if (err) {
            callback(err, null);
            return;
          }
          getTree(requiredBranch.commit.sha, recursive, processTree);
        });
      } else {
        getTree(branch.commit && branch.commit.sha, recursive, processTree);
      }
    }
  });
};
