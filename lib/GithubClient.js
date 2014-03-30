module.exports = function GithubClient (id, user) {

  /** Current instance.
   * @type {GithubClient}
   * @private
   */
  var client = this;

  /** Utility to extend objects.
   * @type {Function}
   * @private
   * @fieldOf GithubRepository#
   */
  var extend = require("extend");

  /** Github API client.
   * @type {Function}
   * @private
   * @fieldOf GithubClient#
   */
  var GitHubApi = require("github");

  /** Github repository manager.
   * @type {Function}
   * @private
   * @fieldOf GithubClient#
   */
  var GithubRepository = require("./GithubRepository");

  /** Memcached item component.
   * @type {Function}
   * @private
   * @fieldOf GithubClient#
   */
  var CacheItem = require('./CacheItem');

  /** Github API client instance.
   * @type {Object}
   * @private
   * @fieldOf GithubClient#
   */
  var github = new GitHubApi({
    version: "3.0.0",
    protocol: "https"
  });

  /** Cache item for this client.
   * @type {CacheItem}
   * @private
   * @fieldOf GithubClient#
   */
  var cacheItem = new CacheItem(id);

  /** Name of the repository associated to the provided id.
   * @type {String}
   * @private
   * @fieldOf GithubClient#
   */
  var contextRepoName = id.substr(id.lastIndexOf("/") + 1);

  // Constructor method.
  (function __constructor() {
    if (user && user.accessToken) {
      github.authenticate({
        type: "oauth",
        token: user.accessToken
      });
    }
  }());

  return extend(client, {

    /** Configured Github API for this client.
     * @type {Object}
     */
    api: github,

    /** Returns the client unique id.
     * @return {String} a valid id, never null or empty.
     */
    getId: function () {
      return id;
    },

    /** Returns the Github user name currently configured for this client.
     * @return {Object} A valid user name, or null if it is not yet configured.
     */
    getUserName: function () {
      return user && user.username;
    },

    /** Returns the repository related to this client according to the provided
     * id.
     * @param {Function} callback Receives an error and the required repository
     *    as parameters.
     */
    getContextRepository: function (callback) {
      cacheItem.retrieve("repo", function (err, repo) {
        if (err) {
          callback(err);
          return;
        }
        if (repo) {
          callback(null, new GithubRepository(client, repo));
        } else {
          github.repos.get({
            user: user && user.username,
            repo: contextRepoName
          }, function (err, remoteRepo) {
            if (err) {
              callback(err, null);
            } else {
              cacheItem.store("repo", new GithubRepository(client, remoteRepo),
                callback);
            }
          });
        }
      });
    },

    /** Lists all repositories available for the current user.
     * @param {Function} callback Receives an error and a list of
     *    GithubRepository as parameters. Cannot be null.
     */
    listRepositories: function (callback) {
      github.repos.getFromUser({
        user: user && user.username
      }, function (err, repos) {
        if (err) {
          callback(err, null);
          return;
        } else {
          callback(null, repos.map(function (repo) {
            return new GithubRepository(client, repo);
          }));
        }
      });
    }
  });
};
