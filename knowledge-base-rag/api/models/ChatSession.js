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
    sessionId: { type: "string", required: true, unique: true },
    userId: { model: "user", required: true },
    title: { type: "string", defaultsTo: "New conversation" },
    messageCount: { type: "number", defaultsTo: 0 },
  },
  beforeCreate: function (record, proceed) {
    record.id = uuidv4();
    return proceed();
  },
};
