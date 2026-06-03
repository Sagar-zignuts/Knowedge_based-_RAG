module.exports = async function (req, res, proceed) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return proceed();
};
