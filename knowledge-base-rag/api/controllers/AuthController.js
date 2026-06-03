const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

module.exports = {
  register: async function (req, res) {
    try {
      const { name, email, password, role } = req.body;
      if (!name || !email || !password) {
        return res.badRequest({
          error: "name, email and password are required",
        });
      }
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) return res.badRequest({ error: "Email already registered" });

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: role === "admin" ? "admin" : "user",
      }).fetch();

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
      );
      return res.json({ token, user });
    } catch (err) {
      sails.log.error("AuthController.register:", err);
      return res.serverError({ error: err.message });
    }
  },

  login: async function (req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.badRequest({ error: "email and password are required" });
      }
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) return res.status(401).json({ error: "Invalid credentials" });

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
      );
      return res.json({ token, user });
    } catch (err) {
      sails.log.error("AuthController.login:", err);
      return res.serverError({ error: err.message });
    }
  },

  me: async function (req, res) {
    return res.json({ user: req.user });
  },

  logout: async function (req, res) {
    return res.json({ message: "Logged out successfully" });
  },
};
