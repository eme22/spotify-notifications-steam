local logger = require("logger")
local millennium = require("millennium")

local function on_load()
    logger:info("Spotify Notifications Backend loaded")
    millennium.ready()
end

-- Called when your plugin is unloaded (plugin disabled or Steam shutting down).
-- NOTE: If Steam crashes or is force-closed, this may not be called.
local function on_unload()
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
