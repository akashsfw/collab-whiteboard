import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

// Singleton socket — created once and reused across pages
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = SERVER_URL
      ? io(SERVER_URL, { autoConnect: false, withCredentials: true })
      : io({ autoConnect: false, withCredentials: true });
  }
  return socket;
}
