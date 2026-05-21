local logger = require("logger")
local millennium = require("millennium")

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
    
    -- Silently launch the background media daemon
    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local ps_script = backend_dir .. "media_daemon.ps1"
    local vbs_script = backend_dir .. "launch_daemon.vbs"
    local cmd = 'wscript.exe //B "' .. vbs_script .. '" "' .. ps_script .. '"'
    os.execute(cmd)
    
    millennium.ready()
end

-- Called when your plugin is unloaded (plugin disabled or Steam shutting down).
-- NOTE: If Steam crashes or is force-closed, this may not be called.
local function on_unload()
    logger:info("Spotify Notifications Backend unloading...")
    
    -- Silently stop the background media daemon
    local script_path = debug.getinfo(1, "S").source:sub(2)
    local backend_dir = script_path:match("(.*[/\\])") or ""
    local vbs_script = backend_dir .. "launch_daemon.vbs"
    local cmd = 'wscript.exe //B "' .. vbs_script .. '" "stop"'
    os.execute(cmd)
    
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
