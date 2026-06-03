const jwt = require("jsonwebtoken");

module.exports = async (req, res, proceed) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
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
