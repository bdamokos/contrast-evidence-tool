module.exports = {
  testDir: "./tests",
  use: {
    baseURL: "http://localhost:8000"
  },
  webServer: {
    command: "python3 -m http.server 8000",
    url: "http://localhost:8000",
    reuseExistingServer: true,
    timeout: 10000
  }
};
