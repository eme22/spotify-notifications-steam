# Spotify Notifications for Steam

This plugin integrates Spotify with Steam to show notifications when a new song starts playing.

## Setup Instructions

### 1. Spotify App Configuration

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications)
2. Create a new app or use an existing one
3. Set the **Redirect URI** to: `http://localhost:8888/callback`
4. Note down your **Client ID** and **Client Secret**

### 2. Configure the Plugin

1. Copy `backend/.env.template` to `backend/.env`
2. Edit `backend/.env` and replace the placeholder values with your Spotify credentials:
   ```
   SPOTIFY_CLIENT_ID=your_actual_client_id
   SPOTIFY_CLIENT_SECRET=your_actual_client_secret
   ```

### 3. Install Dependencies

Navigate to the backend directory and install Python dependencies:
```bash
cd backend
pip install -r requirements.txt
```

### 4. Using the Plugin

1. Launch Steam with the Millennium plugin loaded
2. The plugin will attempt to authenticate automatically if credentials are cached
3. If authentication is needed, open the control panel via the Millennium settings interface
4. Click "Authenticate Spotify" - this will open your browser for OAuth
5. Click "Start Monitoring" to begin tracking your Spotify playback
6. You'll receive Steam notifications when new songs start playing

## Features

- **Automatic Authentication**: Caches tokens and refreshes them automatically
- **Real-time Monitoring**: Tracks your Spotify playback every 5 seconds
- **Steam Notifications**: Shows native Steam notifications with song info and album art
- **OAuth Flow**: Secure authentication using Spotify's OAuth 2.0
- **Error Handling**: Automatically re-authenticates when tokens expire

## Architecture

### Backend (`main.py`)
- `SpotifyManager`: Handles OAuth, token management, and track monitoring
- `SpotifyCallbackServer`: HTTP server for OAuth callback handling
- `Backend`: Exposes methods for frontend communication

### Frontend (`index.tsx`)
- `SpotifyNotifications`: Receives notifications from backend and displays them in Steam
- Control panel for manual authentication and monitoring control
- Backend communication using callable functions

## API Methods

### Backend → Frontend
- `SpotifyNotifications.sendNotification(data)`: Sends notification to Steam

### Frontend → Backend
- `Backend.authenticate_spotify()`: Trigger authentication flow
- `Backend.get_current_track()`: Get currently playing track
- `Backend.start_monitoring()`: Start track monitoring
- `Backend.stop_monitoring()`: Stop track monitoring

## Troubleshooting

### Authentication Issues
- Ensure your Spotify app has the correct redirect URI
- Check that your `.env` file has valid credentials
- Try deleting the `.spotify_cache` file to force re-authentication

### No Notifications
- Make sure monitoring is started
- Check console logs for errors
- Verify you're playing music on the same Spotify account

### Accessing the Control Panel
- Open the control panel via the Millennium settings interface (Millennium settings -> Plugins -> Spotify & Windows Media Notifications -> Settings/Configuration).

## Development

The plugin follows the Millennium plugin architecture:
- Backend runs in Python with access to Spotify API
- Frontend runs in Steam's Chromium context
- Communication via callable functions and exposed objects

## License

This project is open source. See LICENSE file for details.
