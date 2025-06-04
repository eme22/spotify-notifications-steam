# Spotify Notifications for Steam

A Millennium plugin that integrates Spotify with Steam to show notifications when new songs start playing.

## Features

- 🎵 **Dual API Support**: Works with both Spotify Playback API (no authentication needed) and official Spotify Web API
- 🔌 **Automatic Fallback**: Tries Playback API first, falls back to Spotify Web API if unavailable
- 🔐 **Secure OAuth Authentication**: Uses Spotify's official OAuth 2.0 flow when using Web API
- 🔄 **Automatic Token Refresh**: Handles token expiration and refreshes automatically
- 🎨 **Rich Notifications**: Shows song name, artist, and album artwork in Steam notifications
- ⚙️ **Easy Setup**: Multiple setup options depending on your preference
- 🎮 **Steam Native**: Integrates seamlessly with Steam's notification system

## Two Setup Options

### Option 1: Spotify Playback API (Recommended - No Auth Required)

This method uses a local HTTP server that connects to Spotify directly - **no authentication needed!**

1. **Download and run the Playback API server**:
   ```powershell
   python setup_playback_server.py
   ```
   Choose option 4 to download, install dependencies, and run the server.

2. **Test the connection**:
   ```powershell
   python test_api.py
   ```

### Option 2: Spotify Web API (Fallback - Requires Auth)

If the Playback API is not available, the plugin will automatically fall back to the official Spotify Web API.

#### Prerequisites for Web API
- **Spotify Premium Account** - Required for Spotify Web API access
- **Spotify Developer App** - You'll need to create one for API credentials

#### Spotify Developer Setup (for Web API fallback)

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications)
2. Create a new app or use an existing one
3. Set the **Redirect URI** to: `http://localhost:8888/callback`
4. Note your **Client ID** and **Client Secret**

## Plugin Installation

### Prerequisites
- **[Millennium](https://github.com/SteamClientHomebrew/Millennium)** - Steam client modification framework
- **Python 3.7+** - For the backend Spotify integration

### 1. Install the Plugin

1. Clone or download this plugin to your Millennium plugins directory
2. Install dependencies:
   ```powershell
   cd spotify-notifications-steam
   pnpm install
   py -m pip install -r backend/requirements.txt
   ```

### 2. Choose Your Setup Method

#### Method A: Playback API (Recommended)
```powershell
# Download and run the Playback API server
python setup_playback_server.py

# Test the connection
python test_api.py
```

#### Method B: Web API Setup (if Playback API not available)

3. Configure Spotify credentials:
   ```powershell
   # Copy the template and edit with your credentials
   copy backend/.env.template backend/.env
   # Edit backend/.env with your Spotify Client ID and Secret
   ```

4. Build the plugin:
   ```powershell
   pnpm run build
   ```

### 3. Usage

1. Launch Steam with Millennium
2. The plugin will load automatically
3. Press **Ctrl+Shift+S** to open the control panel
4. Click "Authenticate Spotify" (opens browser for OAuth)
5. Click "Start Monitoring" to begin tracking playback
6. Play music on Spotify and enjoy Steam notifications!

## Configuration

Edit `backend/.env` with your Spotify app credentials:

```env
SPOTIFY_CLIENT_ID=your_actual_client_id
SPOTIFY_CLIENT_SECRET=your_actual_client_secret
```

## Architecture

### Backend (`backend/main.py`)
- **SpotifyManager**: Handles OAuth authentication, token management, and playback monitoring
- **SpotifyCallbackServer**: HTTP server for OAuth callback handling  
- **Backend API**: Exposes methods for frontend communication

### Frontend (`frontend/index.tsx`)
- **SpotifyNotifications**: Receives backend notifications and displays them in Steam
- **Control Panel**: UI for authentication and monitoring controls
- **Backend Communication**: Uses Millennium's callable functions for backend interaction

## API Reference

### Backend → Frontend
- `SpotifyNotifications.sendNotification(data)`: Sends notification to Steam

### Frontend → Backend  
- `Backend.authenticate_spotify()`: Triggers OAuth authentication flow
- `Backend.get_current_track()`: Gets currently playing track info
- `Backend.start_monitoring()`: Starts playback monitoring
- `Backend.stop_monitoring()`: Stops playback monitoring

## Troubleshooting

### Authentication Issues
- Verify your Spotify app has the correct redirect URI: `http://localhost:8888/callback`
- Check that your `.env` file contains valid credentials
- Try deleting `.spotify_cache` to force re-authentication

### No Notifications Appearing
- Ensure monitoring is started via the control panel
- Check browser console for error messages
- Verify you're playing music on the same Spotify account

### Control Panel Not Visible
- Press `Ctrl+Shift+S` to toggle visibility
- Panel auto-hides after 10 seconds by default

### Python/Dependencies Issues
- Ensure Python 3.7+ is installed
- Run: `py -m pip install -r backend/requirements.txt`
- Check that all imports work: `py -c "import spotipy; print('OK')"`

## Development

The plugin follows Millennium's architecture:
- Backend runs in Python with Spotify API access
- Frontend runs in Steam's Chromium context  
- Communication via callable functions and exposed objects

To contribute:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source under the MIT License. See LICENSE file for details.

## Credits

- Built for [Millennium](https://github.com/SteamClientHomebrew/Millennium)
- Uses [Spotipy](https://github.com/plamere/spotipy) for Spotify API integration
- Inspired by the need for better music integration in Steam
```
pnpm run dev
```

Then ensure your plugin template is in your plugins folder. 
`%MILLENNIUM_PATH%/plugins/plugin_template`, and select it from the "Plugins" tab within steam, or run `millennium plugins enable plugin_template`

#### Note:
**MILLENNIUM_PATH** =
* Steam Path (ex: `C:\Program Files (x86)\Steam`) (Windows)
* `~/.millennium` (Unix)

## Next Steps

https://docs.steambrew.app/developers/plugins/learn