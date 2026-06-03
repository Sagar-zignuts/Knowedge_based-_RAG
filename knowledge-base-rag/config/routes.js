/**
 * Route Mappings
 * (sails.config.routes)
 *
 * Your routes tell Sails what to do each time it receives a request.
 *
 * For more information on configuring custom routes, check out:
 * https://sailsjs.com/anatomy/config/routes-js
 */

module.exports.routes = {
  "POST /api/auth/register": "AuthController.register",
  "POST /api/auth/login": "AuthController.login",
  "POST /api/auth/logout": "AuthController.logout",
  "GET  /api/auth/me": "AuthController.me",

  "POST   /api/documents/upload": "DocumentController.upload",
  "POST   /api/documents/url": "DocumentController.addUrl",
  "GET    /api/documents": "DocumentController.list",
  "GET    /api/documents/:id": "DocumentController.find",
  "DELETE /api/documents/:id": "DocumentController.destroy",
  "GET    /api/documents/:id/status": "DocumentController.status",

  "POST   /api/chat/session": "ChatController.createSession",
  "GET    /api/chat/sessions": "ChatController.listSessions",
  "POST   /api/chat/message": "ChatController.message",
  "GET    /api/chat/stream": "ChatController.stream",
  "GET    /api/chat/:sessionId": "ChatController.history",
  "DELETE /api/chat/:sessionId": "ChatController.clearSession",

  "GET    /api/search": "SearchController.search",
  "POST   /api/feedback": "FeedbackController.create",
};
