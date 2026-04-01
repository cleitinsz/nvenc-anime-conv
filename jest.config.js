module.exports = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^electron$": "<rootDir>/tests/__mocks__/electron.js",
  },
  testMatch: ["**/tests/**/*.test.js"],
};
