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
    messageId: { type: "string", required: true },
    userId: { model: "user" },
    rating: { type: "number", min: 1, max: 5, required: true },
    comment: { type: "string" },
  },
  beforeCreate: function (record, proceed) {
    record.id = uuidv4();
    return proceed();
  },
};
