/**
 * HTTP Server Settings
 * (sails.config.http)
 *
 * Configuration for the underlying HTTP server in Sails.
 * (for additional recommended settings, see `config/env/production.js`)
 *
 * For more information on configuration, check out:
 * https://sailsjs.com/config/http
 */

module.exports.http = {
  /****************************************************************************
   *                                                                           *
   * Sails/Express middleware to run for every HTTP request.                   *
   * (Only applies to HTTP requests -- not virtual WebSocket requests.)        *
   *                                                                           *
   * https://sailsjs.com/documentation/concepts/middleware                     *
   *                                                                           *
   ****************************************************************************/

  middleware: {
    /***************************************************************************
     *                                                                          *
     * The order in which middleware should be run for HTTP requests.           *
     * (This Sails app's routes are handled by the "router" middleware below.)  *
     *                                                                          *
     ***************************************************************************/

    // order: [
    //   'cookieParser',
    //   'session',
    //   'bodyParser',
    //   'compress',
    //   'poweredBy',
    //   'router',
    //   'www',
    //   'favicon',
    // ],

    /***************************************************************************
     *                                                                          *
     * The body parser that will handle incoming multipart HTTP requests.       *
     *                                                                          *
     * https://sailsjs.com/config/http#?customizing-the-body-parser             *
     *                                                                          *
     ***************************************************************************/

    bodyParser: (function _configureBodyParser() {
      var skipper = require("skipper");
      var middlewareFn = skipper({
        strict: true,
        // Skip parsing for file upload routes - let multer handle them
        onBodyParserError: function (err, req, res, next) {
          return res.serverError(err);
        },
      });

      // Return a function that skips multipart for our upload route
      return function (req, res, next) {
        // Skip Skipper for /api/documents/upload - let multer handle it
        if (req.path === "/api/documents/upload" && req.method === "POST") {
          return next();
        }
        // Use Skipper for all other routes
        return middlewareFn(req, res, next);
      };
    })(),
  },
};
