const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId }) => {
    socket.join(roomId);
    socket.roomId = roomId; // Track room per socket
    console.log(`${socket.id} joined room ${roomId}`);

    const clients = [...(io.sockets.adapter.rooms.get(roomId) || [])];
    const otherUsers = clients.filter((id) => id !== socket.id);

    // Notify new user about others
    socket.emit("existing-users", otherUsers);

    // Notify existing users about new one
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("offer", (data) => {
    socket.to(data.to).emit("offer", {
      from: socket.id,
      sdp: data.sdp,
    });
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", {
      from: socket.id,
      sdp: data.sdp,
    });
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (roomId) {
      socket.to(roomId).emit("user-left", socket.id);
    }
    console.log("User disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
