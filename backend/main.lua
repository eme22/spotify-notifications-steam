local logger = require("logger")
local millennium = require("millennium")

-- Safely initialize LuaJIT FFI for 100% silent windowless process spawning
local success_ffi, ffi = pcall(require, "ffi")
if success_ffi then
    pcall(function()
        ffi.cdef[[
            typedef void* HANDLE;
            typedef struct _STARTUPINFOA {
                unsigned long cb;
                char* lpReserved;
                char* lpDesktop;
                char* lpTitle;
                unsigned long dwX;
                unsigned long dwY;
                unsigned long dwXSize;
                unsigned long dwYSize;
                unsigned long dwXCountChars;
                unsigned long dwYCountChars;
                unsigned long dwFillAttribute;
                unsigned long dwFlags;
                unsigned short wShowWindow;
                unsigned short cbReserved2;
                char* lpReserved2;
                HANDLE hStdInput;
                HANDLE hStdOutput;
                HANDLE hStdError;
            } STARTUPINFOA, *LPSTARTUPINFOA;

            typedef struct _PROCESS_INFORMATION {
                HANDLE hProcess;
                HANDLE hThread;
                unsigned long dwProcessId;
                unsigned long dwThreadId;
            } PROCESS_INFORMATION, *LPPROCESS_INFORMATION;

            int CreateProcessA(
                const char* lpApplicationName,
                char* lpCommandLine,
                void* lpProcessAttributes,
                void* lpThreadAttributes,
                int bInheritHandles,
                unsigned long dwCreationFlags,
                void* lpEnvironment,
                const char* lpCurrentDirectory,
                LPSTARTUPINFOA lpStartupInfo,
                LPPROCESS_INFORMATION lpProcessInformation
            );

            int CloseHandle(HANDLE hObject);
        ]]
    end)
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
            local success = ffi.C.CreateProcessA(
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
                ffi.C.CloseHandle(pi.hProcess)
                ffi.C.CloseHandle(pi.hThread)
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

function get_windows_media()
    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local state_file = backend_dir .. "media_state.json"
    
    local file = io.open(state_file, "r")
    if not file then
        return "null"
    end
    local content = file:read("*a")
    file:close()
    return content
end

function control_windows_media(...)
    local args = {...}
    logger:info("control_windows_media called with " .. tostring(#args) .. " arguments")
    for i, v in ipairs(args) do
        logger:info("Arg " .. tostring(i) .. ": type=" .. type(v) .. " value=" .. tostring(v))
    end
    
    local command = nil
    if #args > 0 then
        if type(args[1]) == "table" then
            logger:info("Arg 1 is a table:")
            for k, val in pairs(args[1]) do
                logger:info("  Key: " .. tostring(k) .. " Value: " .. tostring(val))
            end
            command = args[1][1] or args[1]["command"] or args[1]["0"]
        elseif type(args[1]) == "string" then
            command = args[1]
        end
        
        if not command and #args > 1 then
            if type(args[2]) == "string" then
                command = args[2]
            elseif type(args[2]) == "table" then
                logger:info("Arg 2 is a table:")
                for k, val in pairs(args[2]) do
                    logger:info("  Key: " .. tostring(k) .. " Value: " .. tostring(val))
                end
                command = args[2][1] or args[2]["command"] or args[2]["0"]
            end
        end
    end
    
    if not command then
        logger:error("No command string found in arguments!")
        return "error"
    end
    
    logger:info("Resolved command to send: " .. tostring(command))
    
    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local command_file = backend_dir .. "media_command.txt"
    
    local file = io.open(command_file, "w")
    if not file then
        return "error"
    end
    file:write(command)
    file:close()
    return "success"
end

local function on_load()
    logger:info("Spotify Notifications Backend loaded")
    
    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local daemon_exe = backend_dir .. "MediaDaemon.exe"
    
    -- Silently launch the background media daemon using FFI (100% windowless)
    local cmd = '"' .. daemon_exe .. '"'
    logger:info("Launching MediaDaemon.exe silently...")
    local launched = run_silently(cmd)
    
    if not launched then
        logger:warn("FFI silent launch failed or not available. Falling back to start execution...")
        local fb_cmd = 'start "" "' .. daemon_exe .. '"'
        os.execute(fb_cmd)
    else
        logger:info("Media daemon launched successfully via FFI.")
    end
    
    millennium.ready()
end

-- Called when your plugin is unloaded (plugin disabled or Steam shutting down).
-- NOTE: If Steam crashes or is force-closed, this may not be called.
local function on_unload()
    logger:info("Spotify Notifications Backend unloading...")
    
    -- Gracefully stop the C# daemon by sending the "stop" command
    control_windows_media("stop")
    logger:info("Sent stop command to media daemon.")
    
    logger:info("Spotify Notifications Backend unloaded")
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("Spotify Notifications Backend: frontend loaded")
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload
}
