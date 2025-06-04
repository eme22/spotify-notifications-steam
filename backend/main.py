import Millennium, PluginUtils # type: ignore
logger = PluginUtils.Logger()

import time
import threading
import webbrowser
import os
import traceback
import spotipy
import socketio
import requests
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv

class SpotifyPlaybackAPI:
    """Handles connection to Spotify Playback HTTP server via Socket.IO"""
    
    def __init__(self, host='127.0.0.1', port=8443):
        self.host = host
        self.port = port
        self.sio = socketio.Client(handle_sigint=False)
        self.connected = False
        self.current_track = None
        self.monitoring = False
        self.monitor_thread = None
        
        # Setup event handlers
        self.sio.on('connect', self._on_connect)
        self.sio.on('disconnect', self._on_disconnect)
        self.sio.on('player_data', self._on_player_data)
    
    def _on_connect(self):
        """Handle socket connection"""
        logger.log("Connected to Spotify Playback API")
        self.connected = True
    
    def _on_disconnect(self):
        """Handle socket disconnection"""
        logger.log("Disconnected from Spotify Playback API")
        self.connected = False
    def _on_player_data(self, data):
        """Handle received player data"""
        try:
            self.current_track = data
        except Exception as e:
            logger.error(f"Error processing player data: {e}")
    
    def is_server_available(self):
        """Check if the Playback API server is available by testing Socket.IO connection"""
        try:
            # Create a temporary socket client to test connectivity
            test_sio = socketio.Client(handle_sigint=False)
            test_connected = False
            
            # Set up a simple connect handler
            @test_sio.event
            def connect():
                nonlocal test_connected
                test_connected = True
            
            # Try to connect with a short timeout
            test_sio.connect(f'http://{self.host}:{self.port}', wait_timeout=3)
            
            # Give it a moment to establish connection
            import time
            time.sleep(0.5)
            
            # Clean up
            if test_connected:
                test_sio.disconnect()
            
            return test_connected
            
        except Exception as e:
            logger.log(f"Server availability check failed: {e}")
            return False
    
    def connect(self):
        """Connect to the Playback API server"""
        try:
            if not self.is_server_available():
                logger.log("Playback API server not available")
                return False
            
            logger.log(f"Connecting to Spotify Playback API at {self.host}:{self.port}")
            self.sio.connect(f'http://{self.host}:{self.port}')
            
            # Wait a moment for connection to establish
            time.sleep(1)
            return self.connected
        except Exception as e:
            logger.error(f"Failed to connect to Playback API: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from the Playback API server"""
        try:
            if self.connected:
                self.sio.disconnect()
            self.stop_monitoring()
        except Exception as e:
            logger.error(f"Error disconnecting from Playback API: {e}")
    
    def get_current_track(self):
        """Get current track data"""
        try:
            if not self.connected:
                return None
            
            # Request current data
            self.sio.emit('getdata')
            
            # Wait a moment for response
            time.sleep(0.5)
            
            if self.current_track and isinstance(self.current_track, dict):
                track_data = self.current_track.get('track', {})
                
                # Handle both string and dict formats
                if isinstance(track_data, str):
                    if track_data == "No track info yet" or not track_data:
                        return None
                    return {
                        'name': track_data,
                        'artist': 'Unknown',
                        'album': 'Unknown',
                        'image_url': '',
                        'duration_ms': 0,
                        'progress_ms': 0,
                        'track_id': track_data
                    }
                elif isinstance(track_data, dict):
                    return {
                        'name': track_data.get('name', 'Unknown'),
                        'artist': track_data.get('artist', 'Unknown'),
                        'album': track_data.get('album', 'Unknown'),
                        'image_url': track_data.get('image_url', ''),
                        'duration_ms': track_data.get('duration_ms', 0),
                        'progress_ms': track_data.get('progress_ms', 0),
                        'track_id': track_data.get('id', track_data.get('name', ''))
                    }
            
            return None
        except Exception as e:
            logger.error(f"Error getting current track from Playback API: {e}")
            return None
    
    def start_monitoring(self):
        """Start monitoring for track changes"""
        try:
            if self.monitoring:
                return True
            
            if not self.connected:
                return False
            
            logger.log("Starting Playback API monitoring")
            self.monitoring = True
            self.monitor_thread = threading.Thread(target=self._monitor_loop)
            self.monitor_thread.daemon = True
            self.monitor_thread.start()
            return True
        except Exception as e:
            logger.error(f"Failed to start Playback API monitoring: {e}")
            return False
    
    def stop_monitoring(self):
        """Stop monitoring"""
        try:
            self.monitoring = False
            if self.monitor_thread and self.monitor_thread.is_alive():
                self.monitor_thread.join(timeout=5)
        except Exception as e:
            logger.error(f"Error stopping Playback API monitoring: {e}")
    
    def _monitor_loop(self):
        """Monitor loop for track changes"""
        logger.log("Playback API monitoring loop started")
        last_track_id = None
        
        while self.monitoring:
            try:
                current_track = self.get_current_track()
                
                if current_track and current_track.get('track_id') != last_track_id:
                    logger.log(f"New track detected via Playback API: {current_track['name']}")
                    last_track_id = current_track.get('track_id')
                    # This will be handled by SpotifyManager
                    return current_track
                
                time.sleep(2)
                
            except Exception as e:
                logger.error(f"Error in Playback API monitoring loop: {e}")
                time.sleep(5)
        
        logger.log("Playback API monitoring loop ended")

class SpotifyCallbackServer(BaseHTTPRequestHandler):
    """HTTP server to handle Spotify OAuth callback"""
    
    def do_GET(self):
        try:
            if self.path.startswith('/callback'):
                query_components = parse_qs(urlparse(self.path).query)
                code = query_components.get('code', [None])[0]
                
                if code:
                    # Store the authorization code
                    SpotifyManager.auth_code = code
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    self.wfile.write(b'<html><body><h1>Authorization successful!</h1><p>You can close this window.</p><script>window.close();</script></body></html>')
                    logger.log("Authorization code received successfully")
                else:
                    self.send_response(400)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    self.wfile.write(b'<html><body><h1>Authorization failed!</h1><p>No code received.</p></body></html>')
                    logger.error("No authorization code received")
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            logger.error(f"Error in callback server: {e}")
            try:
                self.send_response(500)
                self.end_headers()
            except:
                pass  # If we can't send response, just log and continue
    
    def log_message(self, format, *args):
        # Suppress HTTP server logs
        pass

class SpotifyManager:
    """Manages Spotify API integration and current track monitoring"""
    
    auth_code: str | None = None  # Store auth code globally for callback server
    
    def __init__(self):
        try:
            self.sp = None
            self.oauth = None
            self.current_track = None
            self.monitoring = False
            self.monitor_thread = None
            self.callback_server = None
            self.server_thread = None
            
            # Playback API support
            self.playback_api = None
            self.using_playback_api = False

            logger.log("Initializing SpotifyManager")
            
            # Try to initialize Playback API first
            try:
                self.playback_api = SpotifyPlaybackAPI()
                if self.playback_api.connect():
                    self.using_playback_api = True
                    logger.log("Successfully connected to Spotify Playback API")
                else:
                    logger.log("Playback API not available, will use spotipy as fallback")
            except Exception as e:
                logger.log(f"Failed to connect to Playback API: {e}, using spotipy fallback")

            # Check if Spotify libraries are available for fallback
            if not spotipy or not SpotifyOAuth:
                if not self.using_playback_api:
                    logger.error("Neither Playback API nor Spotify libraries are available.")
                    return
                else:
                    logger.log("Spotipy not available, but Playback API is working")

            # Set credentials from environment or hardcoded values (for spotipy fallback)
            if not self.using_playback_api:
                os.environ['SPOTIFY_CLIENT_ID'] = os.getenv('SPOTIFY_CLIENT_ID', 'eb85d9af3e2c4310b1bc2fae3322188e')
                os.environ['SPOTIFY_CLIENT_SECRET'] = os.getenv('SPOTIFY_CLIENT_SECRET', 'd3cd0932fc844f568630475ed0b9776e')
                
                # Spotify app credentials
                self.client_id = os.environ.get('SPOTIFY_CLIENT_ID', 'your_client_id_here')
                self.client_secret = os.environ.get('SPOTIFY_CLIENT_SECRET', 'your_client_secret_here')
                self.redirect_uri = 'http://127.0.0.1:8888/callback'
                
                if self.client_id == 'your_client_id_here' or self.client_secret == 'your_client_secret_here':
                    logger.log("Warning: Using placeholder credentials. Please set proper Spotify credentials.")
                
                self.setup_oauth()
            
            logger.log("SpotifyManager initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize SpotifyManager: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
    
    def setup_oauth(self):
        """Setup Spotify OAuth"""
        try:
            if not SpotifyOAuth:
                logger.error("SpotifyOAuth not available")
                return False
                
            logger.log("Setting up Spotify OAuth")
            scope = "user-read-currently-playing user-read-playback-state"
            
            # Use a proper cache directory in user's temp or app data folder
            cache_dir = os.path.join(os.path.expanduser("~"), ".spotify_cache")
            try:
                os.makedirs(cache_dir, exist_ok=True)
                cache_path = os.path.join(cache_dir, "spotify_token_cache")
                logger.log(f"Using cache path: {cache_path}")
            except Exception as e:
                logger.error(f"Failed to create cache directory, using temp: {e}")
                # Fallback to temp directory
                import tempfile
                cache_path = os.path.join(tempfile.gettempdir(), "spotify_token_cache")
            
            self.oauth = SpotifyOAuth(
                client_id=self.client_id,
                client_secret=self.client_secret,
                redirect_uri=self.redirect_uri,
                scope=scope,
                cache_path=cache_path
            )
            logger.log("Spotify OAuth setup complete")
            return True
        except Exception as e:
            logger.error(f"Failed to setup OAuth: {e}")
            return False
    def start_callback_server(self):
        """Start the HTTP server to handle OAuth callback"""
        try:
            logger.log("Starting callback server for Spotify OAuth")
            self.callback_server = HTTPServer(('127.0.0.1', 8888), SpotifyCallbackServer)
            self.server_thread = threading.Thread(target=self.callback_server.serve_forever)
            self.server_thread.daemon = True
            self.server_thread.start()
            logger.log("Callback server started on http://127.0.0.1:8888")
            return True
        except Exception as e:
            logger.error(f"Failed to start callback server: {e}")
            return False
    
    def stop_callback_server(self):
        """Stop the HTTP callback server"""
        try:
            logger.log("Stopping callback server")
            if self.callback_server:
                self.callback_server.shutdown()
                self.callback_server.server_close()
                logger.log("Callback server stopped")
        except Exception as e:
            logger.error(f"Error stopping callback server: {e}")
    def authenticate(self):
        """Authenticate with Spotify"""
        try:
            # If using Playback API, authentication is not needed
            if self.using_playback_api:
                logger.log("Using Playback API - no authentication required")
                return True
            
            logger.log("Authenticating with Spotify using spotipy")
            
            if not self.oauth:
                logger.error("OAuth not initialized")
                return False
            
            # Try to get cached token first
            token_info = self.oauth.get_cached_token()
            
            if not token_info or self.oauth.is_token_expired(token_info):
                logger.log("Token expired or not found, starting authentication flow")
                
                # Start callback server
                if not self.start_callback_server():
                    return False
                
                # Open browser for authorization
                try:
                    auth_url = self.oauth.get_authorize_url()
                    logger.log(f"Opening browser for Spotify authorization")
                    webbrowser.open(auth_url)
                except Exception as e:
                    logger.error(f"Failed to open browser: {e}")
                    self.stop_callback_server()
                    return False
                
                # Wait for authorization code
                timeout = 60  # 60 seconds timeout
                start_time = time.time()
                while not SpotifyManager.auth_code and (time.time() - start_time) < timeout:
                    time.sleep(1)
                
                if not SpotifyManager.auth_code:
                    logger.error("Authorization timeout - no code received")
                    self.stop_callback_server()
                    return False
                
                # Exchange code for token
                try:
                    token_info = self.oauth.get_access_token(SpotifyManager.auth_code)
                    SpotifyManager.auth_code = None  # Reset for next time
                except Exception as e:
                    logger.error(f"Failed to exchange code for token: {e}")
                    self.stop_callback_server()
                    return False
                  # Stop callback server
                self.stop_callback_server()
            
            if token_info and token_info.get('access_token'):
                try:
                    self.sp = spotipy.Spotify(auth=token_info['access_token'])
                    # Test the connection
                    self.sp.current_user()
                    logger.log("Successfully authenticated with Spotify")
                    return True
                except Exception as e:
                    logger.error(f"Failed to create Spotify client: {e}")
                    return False
            else:
                logger.error("Failed to get access token")
                return False
        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            self.stop_callback_server()
            return False
    
    def get_current_track(self):
        """Get currently playing track from Spotify"""
        try:
            # Try Playback API first
            if self.using_playback_api and self.playback_api:
                track_info = self.playback_api.get_current_track()
                if track_info:
                    return track_info
                else:
                    logger.log("No track info from Playback API")
            
            # Fallback to spotipy
            if not self.sp:
                logger.log("Neither Playback API nor Spotify client available")
                return None
            
            current = self.sp.current_playback()
            
            if current and current.get('is_playing'):
                track = current.get('item')
                if track:
                    # Safely get image URL
                    image_url = ''
                    try:
                        images = track.get('album', {}).get('images', [])
                        if images:
                            image_url = images[0].get('url', '')
                    except:
                        pass
                    
                    track_info = {
                        'name': track.get('name', 'Unknown'),
                        'artist': ', '.join([artist['name'] for artist in track.get('artists', [])]),
                        'album': track.get('album', {}).get('name', 'Unknown'),
                        'image_url': image_url,
                        'duration_ms': track.get('duration_ms', 0),
                        'progress_ms': current.get('progress_ms', 0),
                        'track_id': track.get('id', '')
                    }
                    logger.log(f"Retrieved track via spotipy: {track_info['name']} by {track_info['artist']}")
                    return track_info
            return None
            
        except Exception as e:
            logger.error(f"Error getting current track: {e}")
            # Try to re-authenticate if token might be expired (only for spotipy)
            if not self.using_playback_api and ("token" in str(e).lower() or "unauthorized" in str(e).lower() or "401" in str(e)):
                logger.log("Token seems expired, trying to re-authenticate")
                try:
                    if self.authenticate():
                        return self.get_current_track()                
                except Exception as auth_e:
                    logger.error(f"Re-authentication failed: {auth_e}")
            return None

    def start_monitoring(self):
        """Start monitoring Spotify for track changes"""
        try:
            if self.monitoring:
                logger.log("Already monitoring Spotify")
                return True
            
            # Check if we can monitor with either API
            if self.using_playback_api and self.playback_api:
                logger.log("Starting Spotify monitoring with Playback API")
            elif self.sp:
                logger.log("Starting Spotify monitoring with spotipy")
            else:
                logger.error("Cannot start monitoring - no API available")
                return False
            
            self.monitoring = True
            self.monitor_thread = threading.Thread(target=self._monitor_loop)
            self.monitor_thread.daemon = True
            self.monitor_thread.start()
            logger.log("Started Spotify monitoring")
            return True
        except Exception as e:
            logger.error(f"Failed to start monitoring: {e}")
            return False
    
    def stop_monitoring(self):
        """Stop monitoring Spotify"""
        try:
            logger.log("Stopping Spotify monitoring")
            self.monitoring = False
            if self.monitor_thread and self.monitor_thread.is_alive():
                self.monitor_thread.join(timeout=5)
            logger.log("Stopped Spotify monitoring")
        except Exception as e:
            logger.error(f"Error stopping monitoring: {e}")
    
    def _monitor_loop(self):
        """Main monitoring loop"""
        logger.log("Spotify monitoring loop started")
        consecutive_errors = 0
        max_consecutive_errors = 5
        
        while self.monitoring:
            try:
                current_track = self.get_current_track()
                if current_track and (not self.current_track or 
                                    current_track['track_id'] != self.current_track.get('track_id')):
                    # New track detected
                    self.current_track = current_track
                    logger.log(f"New track detected: {current_track['name']} by {current_track['artist']}")
                    
                    # Notify frontend
                    self._notify_frontend(current_track)
                
                # Reset error counter on success
                consecutive_errors = 0
                
                # Check every 5 seconds
                time.sleep(2)
                
            except Exception as e:
                consecutive_errors += 1
                logger.error(f"Error in monitoring loop (attempt {consecutive_errors}): {e}")
                
                if consecutive_errors >= max_consecutive_errors:
                    logger.error(f"Too many consecutive errors ({consecutive_errors}), stopping monitoring")
                    self.monitoring = False
                    break
                
                # Wait longer on error
                time.sleep(10)
        
        logger.log("Spotify monitoring loop ended")
    def _notify_frontend(self, track_info):
        """Notify frontend about new track"""
        try:
            # Send primitive parameters instead of complex object
            title = 'Now Playing...'
            icon = track_info.get('image_url', '')
            track_name = track_info['name']
            track_artist = track_info['artist']
            track_album = track_info['album']
            
            # Call frontend method with individual primitive parameters
            Millennium.call_frontend_method("SpotifyNotifications.sendNotification", params=[
                title, icon, track_name, track_artist, track_album
            ])
            logger.log(f"Sent notification to frontend for: {track_info['name']}")
            
        except Exception as e:
            logger.error(f"Failed to notify frontend: {e}")

# Global Spotify manager instance - initialize with error handling
spotify_manager = None
try:
    spotify_manager = SpotifyManager()
except Exception as e:
    logger.error(f"Failed to initialize SpotifyManager: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")

class Backend:
    @staticmethod 
    def receive_frontend_message(message: str, status: bool, count: int):
        try:
            logger.log(f"received: {[message, status, count]}")
            return True
        except Exception as e:
            logger.error(f"Error in receive_frontend_message: {e}")
            return False
    
    @staticmethod
    def authenticate_spotify():
        """Authenticate with Spotify (called from frontend)"""
        try:
            logger.log("Frontend requested Spotify authentication")
            if not spotify_manager:
                logger.error("SpotifyManager not initialized")
                return False
            
            success = spotify_manager.authenticate()
            if success:
                spotify_manager.start_monitoring()
            return success
        except Exception as e:
            logger.error(f"Error in authenticate_spotify: {e}")
            return False
    
    @staticmethod
    def get_current_track():
        """Get current track info (called from frontend)"""
        try:
            if not spotify_manager:
                logger.error("SpotifyManager not initialized")
                return None
            return spotify_manager.get_current_track()
        except Exception as e:
            logger.error(f"Error in get_current_track: {e}")
            return None
    
    @staticmethod
    def start_monitoring():
        """Start monitoring (called from frontend)"""
        try:
            if not spotify_manager:
                return {"error": "SpotifyManager not initialized"}
            
            # Check if we have either API available
            if not spotify_manager.using_playback_api and not spotify_manager.sp:
                return {"error": "Not authenticated"}
            
            success = spotify_manager.start_monitoring()
            return {"success": success}
        except Exception as e:
            logger.error(f"Error in start_monitoring: {e}")
            return {"error": str(e)}
    
    @staticmethod
    def stop_monitoring():
        """Stop monitoring (called from frontend)"""
        try:
            if not spotify_manager:
                return {"error": "SpotifyManager not initialized"}
            
            spotify_manager.stop_monitoring()
            return {"success": True}
        except Exception as e:
            logger.error(f"Error in stop_monitoring: {e}")
            return {"error": str(e)}
        
class Plugin:
    def __init__(self):
        self.initialized = False

    # if steam reloads, i.e. from a new theme being selected, or for other reasons, this is called. 
    # with the above said, that means this may be called more than once within your backends lifespan 
    def _front_end_loaded(self):
        try:
            # The front end has successfully mounted in the steam app. 
            # You can now use Millennium.call_frontend_method()
            logger.log("The front end has loaded!")
            
            # Try to authenticate with Spotify automatically if we have cached credentials
            if spotify_manager:
                try:
                    if spotify_manager.authenticate():
                        logger.log("Auto-authenticated with Spotify successfully")
                        spotify_manager.start_monitoring()
                    else:
                        logger.log("Spotify authentication required - waiting for frontend request")
                except Exception as e:
                    logger.error(f"Auto-authentication failed: {e}")
            else:
                logger.error("SpotifyManager not available")
        except Exception as e:
            logger.error(f"Error in _front_end_loaded: {e}")

    def _load(self):
        try:
            # This code is executed when your plugin loads. 
            # notes: thread safe, running for entire lifespan of millennium
            logger.log(f"bootstrapping spotify notifications plugin, millennium {Millennium.version()}")
            
            # Load environment variables if dotenv is available
            if load_dotenv:
                try:
                    env_path = os.path.join(os.path.dirname(__file__), '.env')
                    if os.path.exists(env_path):
                        load_dotenv(env_path)
                        logger.log("Loaded environment variables from .env file")
                except Exception as e:
                    logger.error(f"Failed to load .env file: {e}")
            
            self.initialized = True
            Millennium.ready() # this is required to tell Millennium that the backend is ready.
            logger.log("Plugin loaded successfully")
            
        except Exception as e:
            logger.error(f"Error in _load: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            # Still mark as ready even if there were errors
            try:
                Millennium.ready()
            except:
                pass

    def _unload(self):
        try:
            logger.log("unloading spotify notifications plugin")
            # Clean up Spotify monitoring
            if spotify_manager:
                spotify_manager.stop_monitoring()
                spotify_manager.stop_callback_server()
            logger.log("Plugin unloaded successfully")
        except Exception as e:
            logger.error(f"Error in _unload: {e}")