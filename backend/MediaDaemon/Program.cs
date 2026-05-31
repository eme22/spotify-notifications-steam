using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;
using System.Text.Json;

namespace MediaDaemon
{
    class Program
    {
        private static string _cachedJsonState = "null";
        private static HttpListener? _httpListener;
        private static int _port;
        private static readonly ManualResetEvent _exitEvent = new ManualResetEvent(false);
        private static readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

        private static GlobalSystemMediaTransportControlsSessionManager? _manager;
        private static GlobalSystemMediaTransportControlsSession? _currentSession;
        private static Timer? _periodicTimer;

        // State caching variables to optimize writing and resources
        private static string _lastTrackId = "";
        private static string _lastStatus = "";
        private static int _lastProgress = 0;
        private static DateTime? _lastWriteTime = null;
        private static string _cachedThumbnailBase64 = "";

        [STAThread]
        static async Task Main(string[] args)
        {
            try
            {
                // Hook process exit events for cleanup
                AppDomain.CurrentDomain.ProcessExit += (s, e) => Cleanup();

                // 1. Get free TCP port and write to port.txt for Lua to handshake
                _port = GetFreeTcpPort();
                string portFile = Path.Combine(AppContext.BaseDirectory, "port.txt");
                await File.WriteAllTextAsync(portFile, _port.ToString());

                // 2. Start dynamic local HTTP server
                StartHttpServer(_port);

                // Initialize SMTC Session Manager and events
                await InitializeSessionManagerAsync();

                // Setup periodic timer (runs every 1.5 seconds only to sync progress while playing)
                _periodicTimer = new Timer(OnPeriodicTimer, null, 1500, 1500);

                // Wait indefinitely in a sleep state until stop command is received
                _exitEvent.WaitOne();
            }
            catch (Exception)
            {
                // Silently clear cached state on critical failure before exit
                await WriteNullStateAsync();
            }
            finally
            {
                Cleanup();
            }
        }

        private static int GetFreeTcpPort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static void StartHttpServer(int port)
        {
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://127.0.0.1:{port}/");
            _httpListener.Start();

            Task.Run(async () =>
            {
                while (_httpListener != null && _httpListener.IsListening)
                {
                    try
                    {
                        var context = await _httpListener.GetContextAsync();
                        _ = Task.Run(() => HandleRequestAsync(context));
                    }
                    catch
                    {
                        if (_httpListener == null || !_httpListener.IsListening) break;
                    }
                }
            });
        }

        private static async Task HandleRequestAsync(HttpListenerContext context)
        {
            var req = context.Request;
            var res = context.Response;

            // Configure CORS to authorize requests from Steam's Chromium process
            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = (int)HttpStatusCode.OK;
                res.Close();
                return;
            }

            try
            {
                if (req.Url?.AbsolutePath == "/state" && req.HttpMethod == "GET")
                {
                    byte[] buffer = Encoding.UTF8.GetBytes(_cachedJsonState);
                    res.ContentType = "application/json";
                    res.ContentLength64 = buffer.Length;
                    await res.OutputStream.WriteAsync(buffer, 0, buffer.Length);
                }
                else if (req.Url?.AbsolutePath == "/command" && req.HttpMethod == "POST")
                {
                    string cmd = req.QueryString["cmd"]?.ToLower() ?? "";
                    await ExecuteCommandAsync(cmd);
                    res.StatusCode = (int)HttpStatusCode.OK;
                }
                else
                {
                    res.StatusCode = (int)HttpStatusCode.NotFound;
                }
            }
            catch
            {
                res.StatusCode = (int)HttpStatusCode.InternalServerError;
            }
            finally
            {
                res.Close();
            }
        }

        private static async Task ExecuteCommandAsync(string cmd)
        {
            if (string.IsNullOrEmpty(cmd)) return;

            if (cmd == "stop")
            {
                _exitEvent.Set();
                return;
            }

            if (_currentSession != null)
            {
                try
                {
                    switch (cmd)
                    {
                        case "play":
                            await _currentSession.TryPlayAsync();
                            break;
                        case "pause":
                            await _currentSession.TryPauseAsync();
                            break;
                        case "next":
                            await _currentSession.TrySkipNextAsync();
                            break;
                        case "previous":
                            await _currentSession.TrySkipPreviousAsync();
                            break;
                    }

                    // Force immediate rewrite of state after command execution
                    await Task.Delay(150);
                    await WriteCurrentStateAsync(_currentSession, forceWrite: true);
                }
                catch
                {
                    // Suppress command execution exceptions
                }
            }
        }

        private static async Task InitializeSessionManagerAsync()
        {
            try
            {
                _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                if (_manager != null)
                {
                    _manager.CurrentSessionChanged += OnCurrentSessionChanged;
                    await UpdateCurrentSessionAsync();
                }
                else
                {
                    await WriteNullStateAsync();
                }
            }
            catch
            {
                await WriteNullStateAsync();
            }
        }

        private static async void OnCurrentSessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args)
        {
            await UpdateCurrentSessionAsync();
        }

        private static async Task UpdateCurrentSessionAsync()
        {
            if (_manager == null) return;

            try
            {
                var newSession = _manager.GetCurrentSession();

                if (newSession != _currentSession)
                {
                    if (_currentSession != null)
                    {
                        try
                        {
                            _currentSession.PlaybackInfoChanged -= OnPlaybackInfoChanged;
                            _currentSession.MediaPropertiesChanged -= OnMediaPropertiesChanged;
                            _currentSession.TimelinePropertiesChanged -= OnTimelinePropertiesChanged;
                        }
                        catch { }
                    }

                    _currentSession = newSession;

                    if (_currentSession != null)
                    {
                        _currentSession.PlaybackInfoChanged += OnPlaybackInfoChanged;
                        _currentSession.MediaPropertiesChanged += OnMediaPropertiesChanged;
                        _currentSession.TimelinePropertiesChanged += OnTimelinePropertiesChanged;
                    }

                    await WriteCurrentStateAsync(_currentSession, forceWrite: true);
                }
            }
            catch
            {
                await WriteNullStateAsync();
            }
        }

        private static async void OnPlaybackInfoChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args)
        {
            await WriteCurrentStateAsync(sender);
        }

        private static async void OnMediaPropertiesChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args)
        {
            await WriteCurrentStateAsync(sender);
        }

        private static async void OnTimelinePropertiesChanged(GlobalSystemMediaTransportControlsSession sender, TimelinePropertiesChangedEventArgs args)
        {
            await WriteCurrentStateAsync(sender);
        }

        private static async void OnPeriodicTimer(object? state)
        {
            if (_currentSession != null)
            {
                try
                {
                    var info = _currentSession.GetPlaybackInfo();
                    if (info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                    {
                        await WriteCurrentStateAsync(_currentSession);
                    }
                }
                catch { }
            }
        }

        private static async Task WriteCurrentStateAsync(GlobalSystemMediaTransportControlsSession? session, bool forceWrite = false)
        {
            if (!await _writeLock.WaitAsync(1000)) return;
            try
            {
                if (session == null)
                {
                    await WriteNullStateAsyncInternal();
                    return;
                }

                GlobalSystemMediaTransportControlsSessionMediaProperties? props = null;
                try
                {
                    props = await session.TryGetMediaPropertiesAsync();
                }
                catch
                {
                    // Suppress WinRT transient errors
                }

                if (props == null || string.IsNullOrEmpty(props.Title))
                {
                    await WriteNullStateAsyncInternal();
                    return;
                }

                var timeline = session.GetTimelineProperties();
                var playbackInfo = session.GetPlaybackInfo();

                string currentTrackId = $"{props.Artist}|{props.Title}";
                string currentStatus = playbackInfo.PlaybackStatus.ToString();
                int currentProgress = (int)timeline.Position.TotalMilliseconds;

                // Extract base64 thumbnail ONLY if track changed or thumbnail is uncached
                if (currentTrackId != _lastTrackId || string.IsNullOrEmpty(_cachedThumbnailBase64))
                {
                    string oldThumbnail = _cachedThumbnailBase64;
                    _cachedThumbnailBase64 = "";

                    if (currentTrackId != _lastTrackId && !string.IsNullOrEmpty(oldThumbnail))
                    {
                        // Track has changed. We want to avoid writing the previous track's thumbnail.
                        // Retry up to 5 times (with 150ms delay) to let Windows SMTC update the thumbnail reference.
                        int attempts = 5;
                        while (attempts > 0)
                        {
                            if (props.Thumbnail != null)
                            {
                                try
                                {
                                    using var stream = await props.Thumbnail.OpenReadAsync();
                                    using var reader = new DataReader(stream);
                                    await reader.LoadAsync((uint)stream.Size);
                                    var bytes = new byte[stream.Size];
                                    reader.ReadBytes(bytes);
                                    string extracted = Convert.ToBase64String(bytes);

                                    if (extracted != oldThumbnail)
                                    {
                                        _cachedThumbnailBase64 = extracted;
                                        break;
                                    }
                                }
                                catch
                                {
                                    // Suppress and retry
                                }
                            }

                            attempts--;
                            if (attempts > 0)
                            {
                                await Task.Delay(150);
                                var newProps = await session.TryGetMediaPropertiesAsync();
                                if (newProps != null)
                                {
                                    props = newProps;
                                }
                            }
                        }
                    }

                    // Fallback / standard extraction if it's the first track, or if retry loop didn't succeed,
                    // or if props.Thumbnail is null (meaning no image)
                    if (string.IsNullOrEmpty(_cachedThumbnailBase64) && props.Thumbnail != null)
                    {
                        try
                        {
                            using var stream = await props.Thumbnail.OpenReadAsync();
                            using var reader = new DataReader(stream);
                            await reader.LoadAsync((uint)stream.Size);
                            var bytes = new byte[stream.Size];
                            reader.ReadBytes(bytes);
                            _cachedThumbnailBase64 = Convert.ToBase64String(bytes);
                        }
                        catch
                        {
                            // Suppress base64 / thumbnail extraction errors
                        }
                    }
                }

                // Smart write condition
                bool shouldWrite = forceWrite || _lastWriteTime == null || currentTrackId != _lastTrackId || currentStatus != _lastStatus;

                if (!shouldWrite)
                {
                    int expectedProgress = _lastProgress;
                    var now = DateTime.UtcNow;
                    if (currentStatus == "Playing" && _lastWriteTime.HasValue)
                    {
                        expectedProgress = _lastProgress + (int)(now - _lastWriteTime.Value).TotalMilliseconds;
                    }
                    int drift = Math.Abs(currentProgress - expectedProgress);

                    if (drift > 3000)
                    {
                        shouldWrite = true; // Seek or desync
                    }
                    else if ((now - _lastWriteTime!.Value).TotalSeconds >= 15)
                    {
                        shouldWrite = true; // Periodic sync
                    }
                }

                if (shouldWrite)
                {
                    var stateObj = new
                    {
                        title = props.Title,
                        artist = props.Artist,
                        album = props.AlbumTitle,
                        duration = (int)timeline.EndTime.TotalMilliseconds,
                        progress = currentProgress,
                        status = currentStatus,
                        image = _cachedThumbnailBase64
                    };

                    _cachedJsonState = JsonSerializer.Serialize(stateObj);

                    _lastTrackId = currentTrackId;
                    _lastStatus = currentStatus;
                    _lastProgress = currentProgress;
                    _lastWriteTime = DateTime.UtcNow;

                    // Proactively trigger garbage collection after processing images/track changes to keep RAM < 12MB
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                }
            }
            catch
            {
                await WriteNullStateAsyncInternal();
            }
            finally
            {
                _writeLock.Release();
            }
        }

        private static async Task WriteNullStateAsync()
        {
            await _writeLock.WaitAsync();
            try
            {
                await WriteNullStateAsyncInternal();
            }
            finally
            {
                _writeLock.Release();
            }
        }

        private static async Task WriteNullStateAsyncInternal()
        {
            if (_lastTrackId != "null")
            {
                _cachedJsonState = "null";
                _lastTrackId = "null";
                _lastStatus = "";
                _lastWriteTime = DateTime.UtcNow;
            }
            await Task.CompletedTask;
        }

        private static void Cleanup()
        {
            try
            {
                if (_httpListener != null)
                {
                    try { _httpListener.Stop(); } catch { }
                    try { _httpListener.Close(); } catch { }
                    _httpListener = null;
                }

                if (_periodicTimer != null)
                {
                    _periodicTimer.Dispose();
                    _periodicTimer = null;
                }

                if (_currentSession != null)
                {
                    try
                    {
                        _currentSession.PlaybackInfoChanged -= OnPlaybackInfoChanged;
                        _currentSession.MediaPropertiesChanged -= OnMediaPropertiesChanged;
                        _currentSession.TimelinePropertiesChanged -= OnTimelinePropertiesChanged;
                    }
                    catch { }
                    _currentSession = null;
                }

                if (_manager != null)
                {
                    try
                    {
                        _manager.CurrentSessionChanged -= OnCurrentSessionChanged;
                    }
                    catch { }
                    _manager = null;
                }

                // Delete handshake port file if left over on abnormal shutdown
                string portFile = Path.Combine(AppContext.BaseDirectory, "port.txt");
                if (File.Exists(portFile))
                {
                    try { File.Delete(portFile); } catch { }
                }
            }
            catch { }
        }
    }
}
