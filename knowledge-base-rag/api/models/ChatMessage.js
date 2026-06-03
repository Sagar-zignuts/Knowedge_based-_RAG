const { v4: uuidv4 } = require("uuid");

module.exports = {
  dontUseObjectIds: true,
  primaryKey: "id",
  attributes: {
    id: {
      type: "string",
      columnName: "_id",
      autoIncrement: false,
    },
    sessionId: { type: "string", required: true },
    role: { type: "string", isIn: ["user", "assistant"], required: true },
    content: { type: "string", required: true },
    sources: { type: "json", defaultsTo: [] },
  },
  beforeCreate: function (record, proceed) {
    record.id = uuidv4();
    return proceed();
  },
};
