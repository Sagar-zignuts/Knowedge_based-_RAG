require("dotenv").config();
const { Pool } = require("pg");
const {
  host,
  port,
  user,
  database,
  max,
  idleTimeoutMillis,
} = require("pg/lib/defaults");

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  sails.log.error("Unexpected PG pool error:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  async testConnection() {
    const client = await pool.connect();
    try {
      await client.query("SELECT NOW()");
      sails.log.info("PostgreSQL connected successfully.");
    } finally {
      client.release();
    }
  },
};
