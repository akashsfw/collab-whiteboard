# CollabBoard 🎨

A real-time collaborative web whiteboard application inspired by WBO, featuring access controls, interactive YouTube video embeds, rich text hyperlinks, image uploads, and live multi-user cursor tracking.

## ✨ Features

- **Real-Time Collaboration**: Instant bidirectional synchronization powered by Socket.io and Fabric.js.
- **Role-Based Access Control**:
  - **Observer Mode (Default)**: Anyone visiting the room link joins as a read-only viewer. Drawing tools and canvas modifications are disabled.
  - **Editor Mode (Password Protected)**: Observers can unlock editor tools by submitting the room's password (hashed securely with bcrypt).
- **Interactive YouTube Embeds**: Paste any YouTube video URL to embed a floating, movable, resizable player that maintains its exact coordinate space during canvas panning and zooming.
- **Rich Hyperlinks**: Attach clickable URLs to text or shape objects on the canvas with open-in-tab navigation.
- **Image Uploading**: Drag-and-drop or select image files directly onto the whiteboard canvas.
- **Multi-User Presence**: See other users' live cursors and activity in real-time.
- **Pan & Zoom**: Smooth canvas navigation with mouse wheel zooming and Alt+Drag panning.

---

## 🛠 Tech Stack

- **Frontend**: React (Vite), Tailwind CSS, Fabric.js, React Router
- **Backend**: Node.js, Express, Socket.io, bcryptjs, nanoid

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Akashsfw/collab-whiteboard.git
cd collab-whiteboard

# Install dependencies for both server and client
npm run install:all
```

### 2. Run the Application

In two separate terminals:

**Start the Backend Server (Port 4000):**
```bash
npm run dev:server
```

**Start the Frontend App (Port 5173):**
```bash
npm run dev:client
```

Open `http://localhost:5173` in your browser.

---

## 🔒 Security & Architecture

- **Password Security**: Room passwords are never stored in plain text; bcrypt hashing with 12 salt rounds is applied on room creation.
- **Event Gating**: Socket.io server verifies the socket connection's role before processing or broadcasting any drawing, media, or canvas modification events.
