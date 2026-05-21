using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;
using System.Text.Json;

namespace MediaDaemon
{
    class Program
    {
        private static readonly string _stateFile = Path.Combine(AppContext.BaseDirectory, "media_state.json");
        private static readonly string _commandFile = Path.Combine(AppContext.BaseDirectory, "media_command.txt");
        private static readonly ManualResetEvent _exitEvent = new ManualResetEvent(false);
        private static readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

        private static GlobalSystemMediaTransportControlsSessionManager? _manager;
        private static GlobalSystemMediaTransportControlsSession? _currentSession;
        private static FileSystemWatcher? _watcher;
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

                // Setup native directory/file watcher for event-driven commands
                SetupCommandWatcher();

                // Initialize SMTC Session Manager and events
                await InitializeSessionManagerAsync();

                // Setup periodic timer (runs every 1.5 seconds only to sync progress while playing)
                _periodicTimer = new Timer(OnPeriodicTimer, null, 1500, 1500);

                // Wait indefinitely in a sleep state until stop command is received
                _exitEvent.WaitOne();
            }
            catch (Exception)
            {
                // Silently write null state on critical failure before exit
                await WriteNullStateAsync();
            }
            finally
            {
                Cleanup();
            }
        }

        private static void SetupCommandWatcher()
        {
            var dir = Path.GetDirectoryName(_commandFile);
            if (string.IsNullOrEmpty(dir)) return;

            if (!Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            // Clean up any old command file on startup
            if (File.Exists(_commandFile))
            {
                try { File.Delete(_commandFile); } catch { }
            }

            _watcher = new FileSystemWatcher(dir, Path.GetFileName(_commandFile))
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
                EnableRaisingEvents = true
            };

            _watcher.Created += OnCommandFileEvent;
            _watcher.Changed += OnCommandFileEvent;
        }

        private static async void OnCommandFileEvent(object sender, FileSystemEventArgs e)
        {
            // Small delay to ensure writer has finished updating the file lock
            await Task.Delay(30);
            await HandleCommandFileAsync();
        }

        private static async Task HandleCommandFileAsync()
        {
            if (!File.Exists(_commandFile)) return;

            string cmd = "";
            int attempts = 5;
            while (attempts > 0)
            {
                try
                {
                    cmd = (await File.ReadAllTextAsync(_commandFile)).Trim().ToLower();
                    try { File.Delete(_commandFile); } catch { }
                    break;
                }
                catch (IOException)
                {
                    attempts--;
                    await Task.Delay(20);
                }
                catch
                {
                    break;
                }
            }

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

                    // Force immediate rewrite of state after command
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

                    var json = JsonSerializer.Serialize(stateObj);
                    await File.WriteAllTextAsync(_stateFile, json);

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
                try
                {
                    await File.WriteAllTextAsync(_stateFile, "null");
                    _lastTrackId = "null";
                    _lastStatus = "";
                    _lastWriteTime = DateTime.UtcNow;
                }
                catch
                {
                    // Suppress file writes issues
                }
            }
        }

        private static void Cleanup()
        {
            try
            {
                if (_watcher != null)
                {
                    _watcher.EnableRaisingEvents = false;
                    _watcher.Dispose();
                    _watcher = null;
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

                // Write final null state synchronously on exit to be absolutely reliable
                if (File.Exists(_stateFile))
                {
                    try { File.WriteAllText(_stateFile, "null"); } catch { }
                }
            }
            catch { }
        }
    }
}
