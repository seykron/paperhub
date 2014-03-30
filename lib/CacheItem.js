/** Represents a single item in the cache. It defines a namespace based on the
 * id to store additional information on this scope.
 * @param {String} id Item unique id. Cannot be null or empty.
 * @constructor
 */
module.exports = function CacheItem (id) {

  /** Item lifetime, in seconds (3 months).
   * @type {Number}
   * @constant
   * @private
   * @fieldOf CacheItem#
   */
  var DEFAULT_LIFETIME = 7776000;

  /** Memcached client library.
   * @type {Function}
   * @private
   * @fieldOf CacheItem#
   */
  var Memcached = require('memcached');

  /** Memcached client.
   * @type {Memcached}
   * @private
   * @fieldOf CacheItem#
   */
  var memcached = new Memcached(process.env.MEMCACHED_URL);

  return {

    /** Retrieves an item from the cache. The cache is used to anonymously
     * retrieve data associated to a github account once it provided access to
     * repositories.
     *
     * @param {String} key Required item key. Cannot be null or empty.
     * @param {Function} callback Receives an error and the value as parameters.
     *    Cannot be null.
     */
    retrieve: function (key, callback) {
      memcached.get(id, function (err, data) {
        if (err) {
          callback(err, null);
          return;
        }
        if (data) {
          callback(null, data[key]);
        } else {
          memcached.set(id, {}, DEFAULT_LIFETIME, function (err) {
            callback(err, null);
          });
        }
      });
    },

    /** Stores an item in the cache. Items will be stored in the scope of this
     * client.
     *
     * @param {String} key Item key. Cannot be null or empty.
     * @param {Object} value Any data to store. Cannot be null.
     * @param {Function} callback Receives an error and the stored item. Cannot
     *    be null.
     */
    store: function (key, value, callback) {
      memcached.get(id, function (err, data) {
        var item = data || {};

        if (err) {
          callback(err, null);
          return;
        }
        item[key] = value;

        if (data) {
          memcached.replace(id, item, DEFAULT_LIFETIME, function (err) {
            callback(err, value);
          });
        } else {
          memcached.set(id, item, DEFAULT_LIFETIME, function (err) {
            callback(err, value);
          });
        }
      });
    }
  };
};
