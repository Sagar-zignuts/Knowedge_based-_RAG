const jwt = require("jsonwebtoken");
require("dotenv").config();

module.exports = async function (req, res, proceed) {
  let token = null;

  // First try Authorization header (for Postman / API clients)
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // If no header — try query param (for SSE / EventSource from browser)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  // No token found anywhere
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ id: decoded.id });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "User not found or inactive" });
    }
    req.user = user;
    return proceed();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
