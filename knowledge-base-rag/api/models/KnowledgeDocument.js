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
    title: { type: "string", required: true },
    type: {
      type: "string",
      isIn: ["pdf", "text", "markdown", "url", "image"],
      required: true,
    },
    status: {
      type: "string",
      isIn: ["pending", "indexing", "indexed", "failed"],
      defaultsTo: "pending",
    },
    filePath: { type: "string" },
    sourceUrl: { type: "string" },
    uploadedBy: { model: "user" },
    chunkCount: { type: "number", defaultsTo: 0 },
    errorMsg: { type: "string" },
    metadata: { type: "json", defaultsTo: {} },
  },
  beforeCreate: function (record, proceed) {
    record.id = uuidv4();
    return proceed();
  },
};
