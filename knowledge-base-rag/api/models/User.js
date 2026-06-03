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
    name: { type: "string", required: true },
    email: { type: "string", required: true, unique: true, isEmail: true },
    passwordHash: { type: "string", required: true },
    role: { type: "string", isIn: ["admin", "user"], defaultsTo: "user" },
    isActive: { type: "boolean", defaultsTo: true },
  },
  customToJSON: function () {
    const obj = { ...this };
    delete obj.passwordHash;
    return obj;
  },
  beforeCreate: function (record, proceed) {
    record.id = uuidv4();
    return proceed();
  },
};
