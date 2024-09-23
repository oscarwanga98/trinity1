const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Redis = require("redis");
const h3 = require("h3-js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Redis setup

// const redisClient = Redis.createClient({
//   host: "127.0.0.1", // or 'localhost'
//   port: 6379, // Default Redis port
// });

const redisClient = Redis.createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST, // Use environment variable or default to '127.0.0.1'
    port: process.env.REDIS_PORT, // Use environment variable or default to port 6379}
  },
});

// const redisClient = Redis.createClient({
//   password: "67BwfZE74KKpDNmX7fqnKzK68wowUOJ0",
//   socket: {
//     host: "redis-14469.c16.us-east-1-3.ec2.redns.redis-cloud.com",
//     port: 14469,
//   },
// });
// Function to start Redis client connection
async function startRedisClient() {
  try {
    // Await connection to Redis
    await redisClient.connect();
    console.log("Connected to Redis");
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
    process.exit(1); // Exit the process if Redis connection fails
  }
}

// Express route for home page
app.get("/", (req, res) => {
  res.send("WebSocket and REST API server running");
});

// WebSocket event handling
wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "driver-location-update") {
        const { driverId, latitude, longitude } = data;
        const h3Index = h3.latLngToCell(latitude, longitude, 9);

        // Update driver's location in Redis
        await redisClient.set(
          `driver:${driverId}`,
          JSON.stringify({ h3Index, latitude, longitude })
        );
        console.log(`Driver ${driverId} location updated: ${h3Index}`);
      } else if (data.type === "rider-request") {
        const { riderId, latitude, longitude } = data;
        const riderH3Index = h3.latLngToCell(latitude, longitude, 9);

        // Fetch nearby drivers from Redis
        const nearbyDrivers = await getNearbyDrivers(riderH3Index);
        ws.send(
          JSON.stringify({ type: "nearby-drivers", drivers: nearbyDrivers })
        );
        console.log(
          `Rider ${riderId} nearby drivers: ${JSON.stringify(nearbyDrivers)}`
        );
      }
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
      ws.send(JSON.stringify({ type: "error", message: "Server error" }));
    }
  });
});

// Helper to get nearby drivers
async function getNearbyDrivers(h3Index) {
  const nearbyIndexes = h3.gridDisk(h3Index, 3);
  const drivers = [];

  // Get all drivers' keys from Redis
  const driverKeys = await redisClient.keys(`driver:*`);
  for (const key of driverKeys) {
    const driverData = await redisClient.get(key);
    const driverLocation = JSON.parse(driverData);

    // Check if the driver's location matches the nearby indexes
    if (nearbyIndexes.includes(driverLocation.h3Index)) {
      drivers.push({ driverId: key.split(":")[1], location: driverLocation });
    }
  }
  return drivers;
}

// HTML page to display stored driver data in Redis
app.get("/drivers", async (req, res) => {
  try {
    const driverKeys = await redisClient.keys("driver:*");
    let driverDataHtml =
      "<h1>Stored Drivers in Redis</h1><table border='1'><tr><th>Driver ID</th><th>H3 Index</th><th>Latitude</th><th>Longitude</th></tr>";

    for (const key of driverKeys) {
      const driverData = await redisClient.get(key);
      const driver = JSON.parse(driverData);
      driverDataHtml += `<tr>
        <td>${key.split(":")[1]}</td>
        <td>${driver.h3Index}</td>
        <td>${driver.latitude}</td>
        <td>${driver.longitude}</td>
      </tr>`;
    }
    driverDataHtml += "</table>";

    res.send(driverDataHtml);
  } catch (error) {
    console.error("Error fetching driver data:", error);
    res.status(500).send("Error fetching driver data from Redis.");
  }
});

// Start the Redis client and then start the server
startRedisClient().then(() => {
  // Start the server after the Redis client is ready
  server.listen(8080, () => {
    console.log("Server running on http://localhost:8080");
  });
});

// Properly handle process termination to close the Redis client
process.on("SIGINT", () => {
  redisClient.quit();
  console.log("Redis client closed");
  process.exit(0);
});
