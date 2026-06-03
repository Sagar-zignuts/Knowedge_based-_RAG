/**
 * Policy Mappings
 * (sails.config.policies)
 *
 * Policies are simple functions which run **before** your actions.
 *
 * For more information on configuring policies, check out:
 * https://sailsjs.com/docs/concepts/policies
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
};
