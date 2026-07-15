local logger = require("logger")
local millennium = require("millennium")

-- Safely initialize LuaJIT FFI for 100% silent windowless process spawning and Sleep API
local success_ffi, ffi = pcall(require, "ffi")
local kernel32 = nil
if success_ffi then
    pcall(function()
        ffi.cdef[[
            typedef void* HANDLE;
            typedef struct _STARTUPINFOA {
                uint32_t cb;
                char* lpReserved;
                char* lpDesktop;
                char* lpTitle;
                uint32_t dwX;
                uint32_t dwY;
                uint32_t dwXSize;
                uint32_t dwYSize;
                uint32_t dwXCountChars;
                uint32_t dwYCountChars;
                uint32_t dwFillAttribute;
                uint32_t dwFlags;
                uint16_t wShowWindow;
                uint16_t cbReserved2;
                char* lpReserved2;
                HANDLE hStdInput;
                HANDLE hStdOutput;
                HANDLE hStdError;
            } STARTUPINFOA, *LPSTARTUPINFOA;

            typedef struct _PROCESS_INFORMATION {
                HANDLE hProcess;
                HANDLE hThread;
                uint32_t dwProcessId;
                uint32_t dwThreadId;
            } PROCESS_INFORMATION, *LPPROCESS_INFORMATION;

            int32_t __stdcall CreateProcessA(
                const char* lpApplicationName,
                char* lpCommandLine,
                void* lpProcessAttributes,
                void* lpThreadAttributes,
                int32_t bInheritHandles,
                uint32_t dwCreationFlags,
                void* lpEnvironment,
                const char* lpCurrentDirectory,
                LPSTARTUPINFOA lpStartupInfo,
                LPPROCESS_INFORMATION lpProcessInformation
            );

            int32_t __stdcall CloseHandle(HANDLE hObject);
            void __stdcall Sleep(uint32_t dwMilliseconds);
        ]]
    end)
    local success_k32, k32 = pcall(ffi.load, "kernel32")
    if success_k32 then
        kernel32 = k32
    end
end

local function run_silently(cmd)
    if success_ffi then
        local ok, err = pcall(function()
            local si = ffi.new("STARTUPINFOA")
            si.cb = ffi.sizeof(si)
            si.dwFlags = 0x00000001 -- STARTF_USESHOWWINDOW
            si.wShowWindow = 0 -- SW_HIDE

            local pi = ffi.new("PROCESS_INFORMATION")

            -- Writable buffer for CommandLine parameter
            local cmd_buf = ffi.new("char[?]", #cmd + 1)
            ffi.copy(cmd_buf, cmd)

            -- CREATE_NO_WINDOW = 0x08000000
            local k32_lib = kernel32 or ffi.C
            local success = k32_lib.CreateProcessA(
                nil,
                cmd_buf,
                nil,
                nil,
                0,
                0x08000000,
                nil,
                nil,
                si,
                pi
            )

            if success ~= 0 then
                k32_lib.CloseHandle(pi.hProcess)
                k32_lib.CloseHandle(pi.hThread)
                return true
            end
            return false
        end)
        if ok and err then
            return true
        end
    end
    return false
end

-- Global variable to cache the MediaDaemon web server port
local daemon_port = nil

function get_daemon_port()
    return tostring(daemon_port or "0")
end

-- Fetch info+ logs from the daemon HTTP /logs endpoint and forward to Lua logger
function get_daemon_logs()
    if not daemon_port or daemon_port == 0 then return "" end

    local ok, result = pcall(function()
        local cmd = 'curl -s --max-time 2 "http://127.0.0.1:' .. tostring(daemon_port) .. '/logs"'
        local handle = io.popen(cmd)
        if not handle then return "" end
        local response = handle:read("*a")
        handle:close()

        if response and #response > 0 then
            for line in response:gmatch("[^\n]+") do
                local level, msg = line:match("^(%w+): (.+)$")
                if level and msg then
                    if level == "ERROR" then
                        logger:error("[Daemon] " .. msg)
                    elseif level == "WARN" then
                        logger:warn("[Daemon] " .. msg)
                    elseif level == "INFO" then
                        logger:info("[Daemon] " .. msg)
                    end
                end
            end
        end
        return response or ""
    end)

    if not ok then return "" end
    return result
end

local function on_load()
    logger:info("Spotify Notifications Backend loaded")

    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local daemon_exe = backend_dir .. "mediadaemon.exe"
    local port_file = backend_dir .. "port.txt"

    -- Ensure any leftover port.txt is cleaned up
    os.remove(port_file)

    -- Check if dev mode is enabled (marker file created by deploy.ps1 -Dev)
    local dev_marker = backend_dir .. ".daemon-dev"
    local is_dev = false
    local f_dev = io.open(dev_marker, "r")
    if f_dev then
        is_dev = true
        f_dev:close()
    end

    -- Silently launch the background media daemon using FFI (100% windowless)
    local cmd = '"' .. daemon_exe .. '"'
    if is_dev then
        cmd = cmd .. " --dev"
    end
    logger:info("Launching MediaDaemon silently...")
    local launched = run_silently(cmd)

    if not launched then
        logger:warn("FFI silent launch failed or not available. Falling back to start execution...")
        local fb_cmd = 'start "" "' .. daemon_exe .. '"'
        os.execute(fb_cmd)
    else
        logger:info("Media daemon launched successfully via FFI.")
    end

    -- Poll for the port.txt handshake file (up to 20 attempts, 2 seconds max)
    local port = nil
    for i = 1, 20 do
        local f = io.open(port_file, "r")
        if f then
            port = f:read("*a"):gsub("%s+", "")
            f:close()
            os.remove(port_file) -- Delete immediately after discovery
            break
        end

        if success_ffi then
            pcall(function() (kernel32 or ffi.C).Sleep(100) end)
        else
            -- Basic fallback busy sleep if FFI is completely disabled
            local t = os.clock()
            while os.clock() - t < 0.1 do end
        end
    end

    if port and tonumber(port) then
        daemon_port = tonumber(port)
        logger:info("Media daemon API discovered and listening on localhost port: " .. tostring(daemon_port))
        -- Fetch any startup logs from the daemon
        pcall(get_daemon_logs)
    else
        logger:error("Media daemon port.txt handshake timed out or failed!")
    end

    millennium.ready()
end

-- Called when your plugin is unloaded (plugin disabled or Steam shutting down).
local function on_unload()
    logger:info("Spotify Notifications Backend unloading...")

    -- Fetch remaining daemon logs before shutdown
    pcall(get_daemon_logs)

    -- Gracefully stop the daemon by invoking its HTTP API command endpoint
    if daemon_port then
        logger:info("Sending stop command to MediaDaemon API on port " .. tostring(daemon_port))
        local stop_cmd = 'curl -X POST "http://127.0.0.1:' .. tostring(daemon_port) .. '/command?cmd=stop"'
        run_silently(stop_cmd)
    end

    logger:info("Spotify Notifications Backend unloaded")
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("Spotify Notifications Backend: frontend loaded")
    -- Forward any accumulated daemon logs to Lua logger
    pcall(get_daemon_logs)
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload
}
