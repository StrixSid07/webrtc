const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

const roomHosts = new Map(); // track host socket per room

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, isHost }) => {
    const hostId = roomHosts.get(roomId);

    if (isHost && hostId) {
      socket.emit("host-exists");
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = isHost;

    if (isHost) {
      roomHosts.set(roomId, socket.id);
    }

    // Get all clients in room excluding current socket
    const clients = [...(io.sockets.adapter.rooms.get(roomId) || [])];
    const otherUsers = clients.filter((id) => id !== socket.id);

    socket.emit("existing-users", otherUsers);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("offer", (data) => {
    socket.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  socket.on("stop-stream", () => {
    socket.to(socket.roomId).emit("stop-stream");
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;

    if (socket.isHost) {
      roomHosts.delete(roomId);
      socket.to(roomId).emit("host-disconnected");
    } else {
      socket.to(roomId).emit("user-left", socket.id);
    }
    console.log("User disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
