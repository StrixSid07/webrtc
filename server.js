// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: "*", // Change in production!
//   },
// });

// app.use(express.static("public"));
// const PORT = process.env.PORT || 3000;

// const roomHosts = new Map(); // roomId -> socketId of host

// io.on("connection", (socket) => {
//   console.log("User connected:", socket.id);

//   socket.on("join-room", ({ roomId, isHost }) => {
//     const hostId = roomHosts.get(roomId);

//     if (isHost && hostId) {
//       socket.emit("host-exists");
//       return;
//     }

//     socket.join(roomId);
//     socket.roomId = roomId;
//     socket.isHost = isHost;

//     if (isHost) {
//       roomHosts.set(roomId, socket.id);
//     }

//     const clients = [...(io.sockets.adapter.rooms.get(roomId) || [])];
//     const otherUsers = clients.filter((id) => id !== socket.id);

//     socket.emit("existing-users", otherUsers);
//     socket.to(roomId).emit("user-joined", socket.id);
//   });

//   socket.on("offer", (data) => {
//     socket.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
//   });

//   socket.on("answer", (data) => {
//     socket.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
//   });

//   socket.on("ice-candidate", (data) => {
//     socket.to(data.to).emit("ice-candidate", {
//       from: socket.id,
//       candidate: data.candidate,
//     });
//   });

//   socket.on("stop-stream", () => {
//     socket.to(socket.roomId).emit("stop-stream");
//   });

//   socket.on("disconnect", () => {
//     const roomId = socket.roomId;

//     if (socket.isHost) {
//       roomHosts.delete(roomId);
//       socket.to(roomId).emit("host-disconnected");
//     } else {
//       socket.to(roomId).emit("user-left", socket.id);
//     }
//     console.log("User disconnected:", socket.id);
//   });
// });

// server.listen(PORT, () => {
//   console.log(`Server running at http://localhost:${PORT}`);
// });

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

// Enhanced room management
class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room object
  }

  createRoom(roomId, hostId) {
    const room = {
      id: roomId,
      host: {
        id: hostId,
        isStreaming: false,
        connectionState: "connecting",
      },
      viewers: new Map(), // viewerId -> viewer object
      createdAt: new Date(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  addViewer(roomId, viewerId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const viewer = {
      id: viewerId,
      connectionState: "connecting",
      connectedAt: new Date(),
    };

    room.viewers.set(viewerId, viewer);
    return viewer;
  }

  removeViewer(roomId, viewerId) {
    const room = this.getRoom(roomId);
    if (room) {
      room.viewers.delete(viewerId);
    }
  }

  removeRoom(roomId) {
    this.rooms.delete(roomId);
  }

  updateHostState(roomId, state) {
    const room = this.getRoom(roomId);
    if (room) {
      room.host.connectionState = state;
      if (state === "streaming") {
        room.host.isStreaming = true;
      }
    }
  }

  updateViewerState(roomId, viewerId, state) {
    const room = this.getRoom(roomId);
    if (room && room.viewers.has(viewerId)) {
      room.viewers.get(viewerId).connectionState = state;
    }
  }

  getRoomStats(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    return {
      roomId: room.id,
      host: {
        isOnline: true,
        isStreaming: room.host.isStreaming,
        connectionState: room.host.connectionState,
      },
      viewers: {
        count: room.viewers.size,
        list: Array.from(room.viewers.values()).map((v) => ({
          id: v.id,
          connectionState: v.connectionState,
          connectedAt: v.connectedAt,
        })),
      },
      createdAt: room.createdAt,
    };
  }
}

const roomManager = new RoomManager();

// Enhanced socket connection management
class SocketManager {
  constructor() {
    this.sockets = new Map(); // socketId -> socket info
  }

  addSocket(socket, roomId, role) {
    this.sockets.set(socket.id, {
      socket,
      roomId,
      role, // 'host' or 'viewer'
      connectedAt: new Date(),
    });
    socket.roomId = roomId;
    socket.role = role;
  }

  removeSocket(socketId) {
    this.sockets.delete(socketId);
  }

  getSocket(socketId) {
    return this.sockets.get(socketId);
  }

  getSocketsByRoom(roomId) {
    return Array.from(this.sockets.values()).filter((s) => s.roomId === roomId);
  }
}

const socketManager = new SocketManager();

// Standardized response format
function createResponse(success, message, data = null, error = null) {
  return {
    success,
    message,
    data,
    error,
    timestamp: new Date().toISOString(),
  };
}

io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);

  // API: Join room as host
  socket.on("join-as-host", ({ roomId }) => {
    try {
      if (!roomId || typeof roomId !== "string") {
        socket.emit(
          "host-response",
          createResponse(false, "Invalid room ID", null, "INVALID_ROOM_ID")
        );
        return;
      }

      const existingRoom = roomManager.getRoom(roomId);
      if (existingRoom) {
        socket.emit(
          "host-response",
          createResponse(false, "Room already has a host", null, "HOST_EXISTS")
        );
        return;
      }

      // Create room and join
      socket.join(roomId);
      roomManager.createRoom(roomId, socket.id);
      socketManager.addSocket(socket, roomId, "host");

      console.log(
        `[${new Date().toISOString()}] Host ${
          socket.id
        } created room: ${roomId}`
      );

      socket.emit(
        "host-response",
        createResponse(true, "Successfully joined as host", {
          roomId,
          hostId: socket.id,
          viewersCount: 0,
        })
      );
    } catch (error) {
      console.error("Error in join-as-host:", error);
      socket.emit(
        "host-response",
        createResponse(false, "Internal server error", null, "SERVER_ERROR")
      );
    }
  });

  // API: Join room as viewer
  socket.on("join-as-viewer", ({ roomId }) => {
    try {
      if (!roomId || typeof roomId !== "string") {
        socket.emit(
          "viewer-response",
          createResponse(false, "Invalid room ID", null, "INVALID_ROOM_ID")
        );
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        socket.emit(
          "viewer-response",
          createResponse(
            false,
            "Room not found or host not available",
            null,
            "ROOM_NOT_FOUND"
          )
        );
        return;
      }

      // Join room
      socket.join(roomId);
      roomManager.addViewer(roomId, socket.id);
      socketManager.addSocket(socket, roomId, "viewer");

      console.log(
        `[${new Date().toISOString()}] Viewer ${
          socket.id
        } joined room: ${roomId}`
      );

      // Notify viewer
      socket.emit(
        "viewer-response",
        createResponse(true, "Successfully joined as viewer", {
          roomId,
          viewerId: socket.id,
          hostId: room.host.id,
          isHostStreaming: room.host.isStreaming,
        })
      );

      // Notify host about new viewer
      socket.to(room.host.id).emit(
        "viewer-joined",
        createResponse(true, "New viewer joined", {
          viewerId: socket.id,
          viewersCount: room.viewers.size,
        })
      );
    } catch (error) {
      console.error("Error in join-as-viewer:", error);
      socket.emit(
        "viewer-response",
        createResponse(false, "Internal server error", null, "SERVER_ERROR")
      );
    }
  });

  // API: Host starts streaming
  socket.on("start-streaming", () => {
    try {
      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo || socketInfo.role !== "host") {
        socket.emit(
          "streaming-response",
          createResponse(
            false,
            "Only hosts can start streaming",
            null,
            "UNAUTHORIZED"
          )
        );
        return;
      }

      const room = roomManager.getRoom(socketInfo.roomId);
      if (!room) {
        socket.emit(
          "streaming-response",
          createResponse(false, "Room not found", null, "ROOM_NOT_FOUND")
        );
        return;
      }

      roomManager.updateHostState(socketInfo.roomId, "streaming");

      console.log(
        `[${new Date().toISOString()}] Host ${
          socket.id
        } started streaming in room: ${socketInfo.roomId}`
      );

      // Notify host
      socket.emit(
        "streaming-response",
        createResponse(true, "Streaming started successfully", {
          roomId: socketInfo.roomId,
          viewersCount: room.viewers.size,
        })
      );

      // Notify all viewers to initiate connection
      socket.to(socketInfo.roomId).emit(
        "host-streaming",
        createResponse(true, "Host started streaming", {
          hostId: socket.id,
          action: "initiate-connection",
        })
      );
    } catch (error) {
      console.error("Error in start-streaming:", error);
      socket.emit(
        "streaming-response",
        createResponse(false, "Internal server error", null, "SERVER_ERROR")
      );
    }
  });

  // API: WebRTC Offer (from host to viewer)
  socket.on("send-offer", ({ viewerId, offer }) => {
    try {
      if (!viewerId || !offer) {
        socket.emit(
          "webrtc-error",
          createResponse(
            false,
            "Missing viewerId or offer",
            null,
            "INVALID_PARAMS"
          )
        );
        return;
      }

      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo || socketInfo.role !== "host") {
        socket.emit(
          "webrtc-error",
          createResponse(
            false,
            "Only hosts can send offers",
            null,
            "UNAUTHORIZED"
          )
        );
        return;
      }

      console.log(
        `[${new Date().toISOString()}] Forwarding offer from host ${
          socket.id
        } to viewer ${viewerId}`
      );

      // Forward offer to specific viewer
      socket.to(viewerId).emit(
        "receive-offer",
        createResponse(true, "Received offer from host", {
          hostId: socket.id,
          offer: offer,
        })
      );
    } catch (error) {
      console.error("Error in send-offer:", error);
      socket.emit(
        "webrtc-error",
        createResponse(false, "Failed to send offer", null, "SERVER_ERROR")
      );
    }
  });

  // API: WebRTC Answer (from viewer to host)
  socket.on("send-answer", ({ hostId, answer }) => {
    try {
      if (!hostId || !answer) {
        socket.emit(
          "webrtc-error",
          createResponse(
            false,
            "Missing hostId or answer",
            null,
            "INVALID_PARAMS"
          )
        );
        return;
      }

      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo || socketInfo.role !== "viewer") {
        socket.emit(
          "webrtc-error",
          createResponse(
            false,
            "Only viewers can send answers",
            null,
            "UNAUTHORIZED"
          )
        );
        return;
      }

      console.log(
        `[${new Date().toISOString()}] Forwarding answer from viewer ${
          socket.id
        } to host ${hostId}`
      );

      // Forward answer to host
      socket.to(hostId).emit(
        "receive-answer",
        createResponse(true, "Received answer from viewer", {
          viewerId: socket.id,
          answer: answer,
        })
      );

      // Update viewer state
      roomManager.updateViewerState(socketInfo.roomId, socket.id, "connecting");
    } catch (error) {
      console.error("Error in send-answer:", error);
      socket.emit(
        "webrtc-error",
        createResponse(false, "Failed to send answer", null, "SERVER_ERROR")
      );
    }
  });

  // API: ICE Candidate exchange
  socket.on("send-ice-candidate", ({ targetId, candidate }) => {
    try {
      if (!targetId || !candidate) {
        socket.emit(
          "webrtc-error",
          createResponse(
            false,
            "Missing targetId or candidate",
            null,
            "INVALID_PARAMS"
          )
        );
        return;
      }

      console.log(
        `[${new Date().toISOString()}] Forwarding ICE candidate from ${
          socket.id
        } to ${targetId}`
      );

      // Forward ICE candidate to target
      socket.to(targetId).emit(
        "receive-ice-candidate",
        createResponse(true, "Received ICE candidate", {
          fromId: socket.id,
          candidate: candidate,
        })
      );
    } catch (error) {
      console.error("Error in send-ice-candidate:", error);
      socket.emit(
        "webrtc-error",
        createResponse(
          false,
          "Failed to send ICE candidate",
          null,
          "SERVER_ERROR"
        )
      );
    }
  });

  // API: Connection established (called by both host and viewer)
  socket.on("connection-established", ({ targetId }) => {
    try {
      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo) return;

      console.log(
        `[${new Date().toISOString()}] Connection established between ${
          socket.id
        } and ${targetId}`
      );

      if (socketInfo.role === "host") {
        roomManager.updateViewerState(socketInfo.roomId, targetId, "connected");

        // Notify host about successful connection
        socket.emit(
          "viewer-connected",
          createResponse(true, "Viewer successfully connected", {
            viewerId: targetId,
          })
        );
      } else {
        roomManager.updateViewerState(
          socketInfo.roomId,
          socket.id,
          "connected"
        );

        // Notify viewer about successful connection
        socket.emit(
          "host-connected",
          createResponse(true, "Successfully connected to host", {
            hostId: targetId,
          })
        );
      }
    } catch (error) {
      console.error("Error in connection-established:", error);
    }
  });

  // API: Stop streaming
  socket.on("stop-streaming", () => {
    try {
      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo || socketInfo.role !== "host") {
        socket.emit(
          "streaming-response",
          createResponse(
            false,
            "Only hosts can stop streaming",
            null,
            "UNAUTHORIZED"
          )
        );
        return;
      }

      const room = roomManager.getRoom(socketInfo.roomId);
      if (room) {
        room.host.isStreaming = false;
        roomManager.updateHostState(socketInfo.roomId, "connected");
      }

      console.log(
        `[${new Date().toISOString()}] Host ${
          socket.id
        } stopped streaming in room: ${socketInfo.roomId}`
      );

      // Notify host
      socket.emit(
        "streaming-response",
        createResponse(true, "Streaming stopped successfully")
      );

      // Notify all viewers
      socket.to(socketInfo.roomId).emit(
        "host-stopped",
        createResponse(true, "Host stopped streaming", {
          action: "cleanup-connection",
        })
      );
    } catch (error) {
      console.error("Error in stop-streaming:", error);
      socket.emit(
        "streaming-response",
        createResponse(false, "Internal server error", null, "SERVER_ERROR")
      );
    }
  });

  // API: Get room statistics
  socket.on("get-room-stats", ({ roomId }) => {
    try {
      if (!roomId) {
        socket.emit(
          "room-stats",
          createResponse(false, "Room ID required", null, "INVALID_PARAMS")
        );
        return;
      }

      const stats = roomManager.getRoomStats(roomId);
      if (!stats) {
        socket.emit(
          "room-stats",
          createResponse(false, "Room not found", null, "ROOM_NOT_FOUND")
        );
        return;
      }

      socket.emit(
        "room-stats",
        createResponse(true, "Room statistics retrieved", stats)
      );
    } catch (error) {
      console.error("Error in get-room-stats:", error);
      socket.emit(
        "room-stats",
        createResponse(false, "Internal server error", null, "SERVER_ERROR")
      );
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    try {
      const socketInfo = socketManager.getSocket(socket.id);
      if (!socketInfo) return;

      const { roomId, role } = socketInfo;
      console.log(
        `[${new Date().toISOString()}] ${role} ${
          socket.id
        } disconnected from room: ${roomId}`
      );

      if (role === "host") {
        // Host disconnected - notify all viewers and cleanup room
        socket.to(roomId).emit(
          "host-disconnected",
          createResponse(true, "Host disconnected", {
            action: "cleanup-room",
          })
        );

        roomManager.removeRoom(roomId);
        console.log(
          `[${new Date().toISOString()}] Room ${roomId} removed due to host disconnect`
        );
      } else {
        // Viewer disconnected - notify host and remove from room
        const room = roomManager.getRoom(roomId);
        if (room) {
          roomManager.removeViewer(roomId, socket.id);

          socket.to(room.host.id).emit(
            "viewer-disconnected",
            createResponse(true, "Viewer disconnected", {
              viewerId: socket.id,
              viewersCount: room.viewers.size,
            })
          );
        }
      }

      socketManager.removeSocket(socket.id);
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  const stats = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    activeRooms: roomManager.rooms.size,
    activeSockets: socketManager.sockets.size,
    uptime: process.uptime(),
  };
  res.json(stats);
});

// Room info endpoint
app.get("/room/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  const stats = roomManager.getRoomStats(roomId);

  if (!stats) {
    return res
      .status(404)
      .json(createResponse(false, "Room not found", null, "ROOM_NOT_FOUND"));
  }

  res.json(createResponse(true, "Room information retrieved", stats));
});

server.listen(PORT, () => {
  console.log(`🚀 WebRTC Streaming Server running at http://localhost:${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
