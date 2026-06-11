/**
 * config/policies.js
 *
 * Complete policies file — all 4 phases.
 * This is the FULL file — replace your existing policies.js with this.
 *
 * Policy chain order matters: isAuthenticated runs BEFORE isAdmin.
 * isAuthenticated sets req.user — isAdmin then checks req.user.role.
 */

module.exports.policies = {
  AuthController: {
    register: true,
    login: true,
    logout: true,
    me: ["isAuthenticated"],
  },
  DocumentController: {
    "*": ["isAuthenticated", "isAdmin"],
  },
  ChatController: {
    "*": ["isAuthenticated"],
  },
  SearchController: {
    "*": ["isAuthenticated"],
  },
  FeedbackController: {
    "*": ["isAuthenticated"],
  },

  AdminController: {
    "*": ["isAuthenticated", "isAdmin"],
  },
};
